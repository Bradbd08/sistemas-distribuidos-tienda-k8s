import { createServer, get } from "node:http";
import amqp from "amqplib";
import { MongoClient, ObjectId } from "mongodb";
import { crearManejadores, procesar } from "./handlers.mjs";
import { declararTopologia } from "./topology.mjs";

// Consume las colas de RabbitMQ: guarda las reseñas en MongoDB y repuebla la caché del catálogo.
// Qué hace con cada mensaje, los reintentos y la DLQ: handlers.mjs. Las colas: topology.mjs. Guía: docs/04-mensajeria.md.
const requerida = (nombre) => {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}`);
  return valor;
};

const COLAS = ["reviews.created", "catalog.changed", "catalog.refresh"];
const maxIntentos = Number(process.env.MAX_ATTEMPTS || 5);
const apiUrl = process.env.API_URL || "http://api:8080";
const puertoSalud = Number(process.env.PORT || 8081);
const mongo = new MongoClient(requerida("MONGO_URI"), { serverSelectionTimeoutMS: 5000 });

let listo = false; // los consumidores ya están registrados
let cerrando = false; // llegó SIGTERM
let enVuelo = 0; // mensajes que se están procesando

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// En Kubernetes los pods pueden arrancar antes que RabbitMQ y MongoDB. Reintenta en vez de salir.
const conReintentos = async (nombre, conectar, intentos = 60, ms = 2000) => {
  for (let n = 1; ; n += 1) {
    try {
      return await conectar();
    } catch (error) {
      if (n >= intentos) throw error;
      console.log(`${nombre} no está listo; reintento ${n}/${intentos}: ${error.message}`);
      await dormir(ms);
    }
  }
};

// GET a la API con node:http: OpenTelemetry así propaga la traza. Devuelve el código de estado.
const llamarApi = (ruta) =>
  new Promise((resolve, reject) => {
    const peticion = get(new URL(ruta, apiUrl), { timeout: 10_000 }, (respuesta) => {
      respuesta.resume();
      respuesta.on("end", () => resolve(respuesta.statusCode));
    });
    peticion.on("timeout", () => peticion.destroy(new Error("la API no respondió en 10 s")));
    peticion.on("error", reject);
  });

// Sondas de Kubernetes: /healthz = el proceso responde; /readyz = ya consume las colas.
createServer((peticion, respuesta) => {
  const ruta = new URL(peticion.url, "http://localhost").pathname;
  const estado = ruta === "/healthz" ? 200 : ruta === "/readyz" ? (listo && !cerrando ? 200 : 503) : 404;
  respuesta.writeHead(estado);
  respuesta.end();
}).listen(puertoSalud, "0.0.0.0");

const start = async () => {
  await conReintentos("MongoDB", () => mongo.connect());
  const resenas = mongo.db(requerida("MONGO_DB")).collection("product_reviews");

  const conexion = await conReintentos("RabbitMQ", () => amqp.connect(requerida("RABBITMQ_URL")));
  // Si se pierde RabbitMQ el pod sale y Kubernetes lo reinicia; los mensajes sin confirmar vuelven a la cola.
  const caida = (que) => () => {
    if (cerrando) return;
    console.error(`${que} con RabbitMQ; el pod se reinicia para reconectar.`);
    process.exit(1);
  };
  conexion.on("error", (error) => console.error("RabbitMQ:", error.message));
  conexion.on("close", caida("Se cerró la conexión"));
  const canal = await conexion.createConfirmChannel();
  canal.on("error", (error) => console.error("Canal de RabbitMQ:", error.message));
  canal.on("close", caida("Se cerró el canal"));
  await declararTopologia(canal);
  await canal.prefetch(5);

  // Publica y espera la confirmación del broker.
  const publicar = (cola, cuerpo, cabeceras) =>
    new Promise((resolve, reject) => {
      const contenido = Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(JSON.stringify(cuerpo));
      canal.sendToQueue(cola, contenido, { persistent: true, contentType: "application/json", headers: cabeceras }, (error) =>
        error ? reject(error) : resolve(),
      );
    });

  const manejadores = crearManejadores({
    // El _id es el id del mensaje: si llega repetido, MongoDB lo rechaza como duplicado y se da por procesado.
    insertarResena: (id, doc) => resenas.insertOne({ _id: new ObjectId(id), ...doc }),
    publicar: (cola, cuerpo) => publicar(cola, cuerpo),
    llamarApi,
  });
  const republicar = (cola, contenido, intento) => publicar(cola, contenido, { "x-attempt": intento });

  const atender = async (cola, mensaje) => {
    if (mensaje === null) {
      console.error(`RabbitMQ canceló el consumo de ${cola}; el pod se reinicia.`);
      process.exit(1);
    }
    enVuelo += 1;
    try {
      const accion = await procesar({
        cola,
        contenido: mensaje.content,
        intento: Number(mensaje.properties.headers?.["x-attempt"] || 1),
        manejar: manejadores[cola],
        republicar,
        esperar: dormir,
        maxIntentos,
        conDlq: cola === "reviews.created",
        registrar: (texto) => console.log(texto),
      });
      if (accion === "ack") canal.ack(mensaje);
      else canal.nack(mensaje, false, false); // sin requeue: RabbitMQ lo manda a reviews.dlq
    } catch (error) {
      // No se pudo ni reintentar (por ejemplo, cayó RabbitMQ): el mensaje vuelve a la cola, no se pierde.
      console.error(`${cola}: ${error.message}`);
      try {
        canal.nack(mensaje, false, true);
      } catch {}
    } finally {
      enVuelo -= 1;
    }
  };

  const consumidores = [];
  for (const cola of COLAS) {
    const { consumerTag } = await canal.consume(cola, (mensaje) => void atender(cola, mensaje));
    consumidores.push(consumerTag);
  }
  listo = true;
  console.log(`Worker escuchando ${COLAS.join(", ")} (hasta ${maxIntentos} intentos por mensaje)`);

  const apagar = async () => {
    if (cerrando) return;
    cerrando = true;
    listo = false;
    try {
      for (const etiqueta of consumidores) await canal.cancel(etiqueta);
      const limite = Date.now() + 20_000;
      while (enVuelo > 0 && Date.now() < limite) await dormir(200);
      await canal.close();
      await conexion.close();
      await mongo.close();
    } catch (error) {
      console.error("Error al cerrar:", error.message);
    }
    process.exit(0);
  };
  process.on("SIGINT", apagar);
  process.on("SIGTERM", apagar);
};

start().catch((error) => {
  console.error("El worker no pudo arrancar:", error);
  process.exit(1);
});
