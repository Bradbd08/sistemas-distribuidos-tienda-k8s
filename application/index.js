import { createServer } from "node:http";
import { metrics } from "@opentelemetry/api";
import { MongoClient, ObjectId } from "mongodb";
import mysql from "mysql2/promise";
import { createClient } from "redis";

const required = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

// RabbitMQ es opcional: solo existe RABBITMQ_URL en Kubernetes. En Docker Compose no se importa nada y la API guarda
// las reseñas directo en MongoDB, como siempre. Guía: docs/04-mensajeria.md.
const eventos = process.env.RABBITMQ_URL ? await import("./events.mjs") : null;

// Métricas propias para el tablero de la caché. Si OpenTelemetry no está activo (Docker Compose), no hacen nada.
const meter = metrics.getMeter("tienda-api");
const cacheHits = meter.createCounter("catalog.cache.hits", { description: "Lecturas del catálogo servidas desde Redis" });
const cacheMisses = meter.createCounter("catalog.cache.misses", { description: "Lecturas del catálogo que fueron a MariaDB" });

const pool = mysql.createPool({
  host: required("DB_HOST"),
  port: Number(process.env.DB_PORT || 3306),
  database: required("DB_NAME"),
  user: required("DB_USER"),
  password: required("DB_PASSWORD"),
  waitForConnections: true,
  connectionLimit: 10,
});

// Si existe MONGO_URI (por ejemplo la cadena de conexión que genera el operador de MongoDB en
// Kubernetes, con todos los miembros del replica set), se usa tal cual. Si no, se arma con
// MONGO_HOST, MONGO_PORT, MONGO_USER y MONGO_PASSWORD, como en Docker Compose.
const mongo = process.env.MONGO_URI
  ? new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 })
  : new MongoClient(
      `mongodb://${required("MONGO_HOST")}:${Number(process.env.MONGO_PORT || 27017)}/${encodeURIComponent(required("MONGO_DB"))}`,
      {
        auth: {
          username: required("MONGO_USER"),
          password: required("MONGO_PASSWORD"),
        },
        authSource: "admin",
        serverSelectionTimeoutMS: 5000,
      },
    );
const redis = createClient({
  socket: {
    host: required("REDIS_HOST"),
    port: Number(process.env.REDIS_PORT || 6379),
  },
});
redis.on("error", (error) => console.error("Redis client error:", error));

// Se vuelve true al recibir SIGTERM. /readyz responde 503 para que Kubernetes saque este pod del Service.
let shuttingDown = false;

class HttpError extends Error {
  constructor(statusCode, message, trace) {
    super(message);
    this.statusCode = statusCode;
    this.trace = trace;
  }
}

const readJsonBody = async (request) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) {
      throw new HttpError(413, "Request body is too large");
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
};

const sendJson = (response, statusCode, payload, trace = []) => {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "x-request-trace": trace.join(" -> "),
  });
  response.end(JSON.stringify(payload));
};

// En Kubernetes los pods pueden arrancar antes que las bases de datos. Reintenta en vez de salir.
const connectWithRetry = async (name, connect, attempts = 60, delayMs = 2000) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await connect();
      return;
    } catch (error) {
      if (attempt >= attempts) throw error;
      console.log(`${name} no está listo; reintento ${attempt}/${attempts}: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
};

const start = async () => {
  await Promise.all([connectWithRetry("MongoDB", () => mongo.connect()), redis.connect()]);
  const reviews = mongo.db(required("MONGO_DB")).collection("product_reviews");
  const productsCacheKey = "store:products:cheapest";
  const server = createServer((request, response) => {
    const trace = [
      request.headers["x-presentation-lb"] || "presentation-lb-unknown",
      request.headers["x-web-node"] || "web-node-unknown",
      request.headers["x-application-lb"] || "application-lb-unknown",
      process.env.APPLICATION_NODE || "app-node-unknown",
    ];
    void (async () => {
      const pathname = new URL(request.url, "http://localhost").pathname;

      // Sonda de vida (liveness): el proceso responde. No toca las bases de datos, para que una
      // caída de la base no reinicie en cadena todos los pods de la API.
      if (request.method === "GET" && pathname === "/healthz") {
        sendJson(response, 200, { status: "ok" });
        return;
      }

      // Sonda de disponibilidad (readiness): el pod atiende tráfico solo si llega a las tres bases
      // de datos. Si falla alguna, el manejador de errores de abajo responde 503.
      if (request.method === "GET" && pathname === "/readyz") {
        if (shuttingDown) {
          sendJson(response, 503, { status: "shutting-down" });
          return;
        }
        await Promise.all([pool.query("SELECT 1"), mongo.db().command({ ping: 1 }), redis.ping()]);
        sendJson(response, 200, { status: "ready" });
        return;
      }

      if (request.method === "GET" && pathname === "/health") {
        await Promise.all([pool.query("SELECT 1"), mongo.db().command({ ping: 1 }), redis.ping()]);
        sendJson(response, 200, { status: "ok" }, [...trace, "galera-lb", "mongodb", "redis"]);
        return;
      }

      if (request.method === "GET" && pathname === "/") {
        sendJson(response, 200, {
          service: "store-catalog-api",
          products: "/products/cheapest",
          reviews: "/products/{sku}/reviews",
        }, trace);
        return;
      }

      if (request.method === "GET" && pathname === "/products/cheapest") {
        trace.push("redis");
        const cached = await redis.get(productsCacheKey);
        if (cached) {
          cacheHits.add(1);
          trace.push("cache hit");
          sendJson(response, 200, JSON.parse(cached), trace);
          return;
        }
        cacheMisses.add(1);
        trace[trace.length - 1] = "redis (cache miss)";
        let dbLabel = "galera-lb";
        try {
          const [hostRows] = await pool.query("SELECT @@hostname AS host");
          if (hostRows?.[0]?.host) dbLabel = `galera (${hostRows[0].host})`;
        } catch {}
        trace.push(dbLabel);
        const [products] = await pool.execute(
          "SELECT id, sku, name, description, price FROM products ORDER BY price ASC, id ASC LIMIT 10",
        );
        trace.push("redis (cache write)");
        await redis.set(productsCacheKey, JSON.stringify(products), { EX: 60 });
        sendJson(response, 200, products, trace);
        return;
      }

      if (request.method === "POST" && pathname === "/cache/clear") {
        const removed = await redis.del(productsCacheKey);
        // Aviso opcional: el worker repuebla la caché. Nunca debe impedir ni retrasar de más el borrado.
        await eventos
          ?.publicar("catalog.changed", { scope: "products", at: new Date().toISOString() })
          .catch((error) => console.error("catalog.changed no se publicó:", error.message));
        sendJson(
          response,
          200,
          { cacheKey: productsCacheKey, cacheEntryRemoved: removed === 1 },
          [...trace, "redis (delete catalog cache)"],
        );
        return;
      }

      const reviewMatch = pathname.match(/^\/products\/([A-Za-z0-9-]+)\/reviews$/);
      if (reviewMatch && request.method === "GET") {
        const productSku = reviewMatch[1];
        const productReviews = await reviews
          .find({ sku: productSku })
          .sort({ createdAt: -1 })
          .limit(50)
          .project({ _id: 0, reviewer: 1, rating: 1, comment: 1, createdAt: 1 })
          .toArray();
        sendJson(response, 200, { sku: productSku, reviews: productReviews }, [...trace, "mongodb"]);
        return;
      }

      if (reviewMatch && request.method === "POST") {
        if (!request.headers["content-type"]?.includes("application/json")) {
          throw new HttpError(415, "Content-Type must be application/json");
        }
        const body = await readJsonBody(request);
        if (body === null || typeof body !== "object" || Array.isArray(body)) {
          throw new HttpError(400, "Request body must be a JSON object");
        }
        const reviewer = typeof body.reviewer === "string" ? body.reviewer.trim() : "";
        const comment = typeof body.comment === "string" ? body.comment.trim() : "";
        if (
          reviewer.length < 1 ||
          reviewer.length > 80 ||
          !Number.isInteger(body.rating) ||
          body.rating < 1 ||
          body.rating > 5 ||
          comment.length < 1 ||
          comment.length > 1000
        ) {
          throw new HttpError(400, "Provide reviewer, rating (1-5), and comment within the allowed lengths");
        }
        trace.push("galera1 (product lookup)");
        const [matches] = await pool.execute("SELECT 1 FROM products WHERE sku = ? LIMIT 1", [
          reviewMatch[1],
        ]);
        if (matches.length === 0) {
          throw new HttpError(404, "Product not found", trace);
        }
        const review = {
          sku: reviewMatch[1],
          reviewer,
          rating: body.rating,
          comment,
          createdAt: new Date(),
        };
        // Con RabbitMQ la reseña se encola y el worker la guarda (202). Si no hay RabbitMQ o falla, se guarda aquí (201).
        // El _id se crea antes de publicar: si el mensaje llegara tarde tras un fallo, el worker ve la clave
        // duplicada y lo da por procesado.
        const _id = new ObjectId();
        if (eventos) {
          try {
            await eventos.publicar("reviews.created", { id: _id.toString(), ...review });
            sendJson(response, 202, { id: _id.toString(), ...review, status: "queued" }, [...trace, "rabbitmq (reviews.created)"]);
            return;
          } catch (error) {
            console.error("RabbitMQ no disponible; la reseña se guarda directo en MongoDB:", error.message);
            trace.push("rabbitmq (no disponible)");
          }
        }
        await reviews.insertOne({ _id, ...review });
        sendJson(response, 201, { id: _id.toString(), ...review }, [...trace, "mongodb (insert review)"]);
        return;
      }

      sendJson(response, 404, { error: "Not found" }, trace);
    })().catch((error) => {
      if (!(error instanceof HttpError)) {
        console.error("Request failed:", error);
      }
      if (response.headersSent) {
        response.destroy();
        return;
      }
      sendJson(
        response,
        error instanceof HttpError ? error.statusCode : 503,
        { error: error instanceof HttpError ? error.message : "Service temporarily unavailable" },
        error instanceof HttpError && error.trace ? error.trace : trace,
      );
    });
  });

  server.listen(8080, "0.0.0.0", () => {
    console.log("Store catalog API listening on port 8080");
  });

  const shutdown = () => {
    shuttingDown = true;
    server.close(() => {
      void Promise.all([pool.end(), mongo.close(), redis.quit(), eventos?.cerrar()]).then(() => process.exit(0));
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

start().catch((error) => {
  console.error("Application startup failed:", error);
  process.exitCode = 1;
});