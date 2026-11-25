// Pruebas de la lógica del worker:  node --test worker/handlers.test.mjs   (sin dependencias, no hace falta pnpm install)
import assert from "node:assert/strict";
import { test } from "node:test";
import { crearManejadores, esDuplicado, espera, MensajeInvalido, procesar, validarResena } from "./handlers.mjs";

const valida = {
  id: "0123456789abcdef01234567",
  sku: "ST-001",
  reviewer: "  Ana  ",
  rating: 5,
  comment: " Muy bueno ",
  createdAt: "2026-11-15T12:00:00.000Z",
};

test("validarResena acepta una reseña válida, recorta espacios y convierte la fecha", () => {
  const { id, doc } = validarResena(valida);
  assert.equal(id, valida.id);
  assert.deepEqual(doc, { sku: "ST-001", reviewer: "Ana", rating: 5, comment: "Muy bueno", createdAt: new Date(valida.createdAt) });
});

test("validarResena rechaza lo que la API no aceptaría", () => {
  const malos = [
    null,
    [],
    "texto",
    { ...valida, id: "xyz" },
    { ...valida, id: "0123456789ABCDEF01234567" },
    { ...valida, sku: "ST 001" },
    { ...valida, reviewer: "   " },
    { ...valida, reviewer: "x".repeat(81) },
    { ...valida, rating: 0 },
    { ...valida, rating: 6 },
    { ...valida, rating: 2.5 },
    { ...valida, rating: "5" },
    { ...valida, comment: "" },
    { ...valida, comment: "x".repeat(1001) },
    { ...valida, createdAt: "ayer" },
    { ...valida, createdAt: 1700000000 },
  ];
  for (const cuerpo of malos) {
    assert.throws(() => validarResena(cuerpo), MensajeInvalido, JSON.stringify(cuerpo));
  }
});

test("espera crece al doble y se detiene en 30 s", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(espera), [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
});

test("esDuplicado reconoce el código 11000 de MongoDB", () => {
  assert.equal(esDuplicado({ code: 11000 }), true);
  assert.equal(esDuplicado(new Error("otro")), false);
  assert.equal(esDuplicado(undefined), false);
});

test("reviews.created guarda la reseña y trata la clave duplicada como ya procesada", async () => {
  const guardadas = [];
  const base = { publicar: async () => {}, llamarApi: async () => 200 };
  const guarda = crearManejadores({ ...base, insertarResena: async (id, doc) => guardadas.push([id, doc.sku]) });
  await guarda["reviews.created"](valida);
  assert.deepEqual(guardadas, [[valida.id, "ST-001"]]);

  const duplicada = crearManejadores({ ...base, insertarResena: async () => Promise.reject(Object.assign(new Error("dup"), { code: 11000 })) });
  await duplicada["reviews.created"](valida);

  const caida = crearManejadores({ ...base, insertarResena: async () => Promise.reject(new Error("MongoDB caído")) });
  await assert.rejects(caida["reviews.created"](valida), /MongoDB caído/);
});

test("catalog.changed pide repoblar y catalog.refresh llama a la API", async () => {
  const publicados = [];
  const llamadas = [];
  let estado = 200;
  const m = crearManejadores({
    insertarResena: async () => {},
    publicar: async (cola, cuerpo) => publicados.push([cola, cuerpo.scope]),
    llamarApi: async (ruta) => (llamadas.push(ruta), estado),
  });
  await m["catalog.changed"]({});
  assert.deepEqual(publicados, [["catalog.refresh", "products"]]);
  await m["catalog.refresh"]({});
  assert.deepEqual(llamadas, ["/products/cheapest"]);
  estado = 503;
  await assert.rejects(m["catalog.refresh"]({}), /503/);
});

const armar = (manejar, extra = {}) => {
  const registro = { esperas: [], republicados: [], mensajes: [] };
  const opciones = {
    cola: "reviews.created",
    contenido: Buffer.from(JSON.stringify(valida)),
    intento: 1,
    maxIntentos: 5,
    conDlq: true,
    manejar,
    esperar: async (ms) => registro.esperas.push(ms),
    republicar: async (cola, contenido, intento) => registro.republicados.push([cola, intento, contenido.length > 0]),
    registrar: (texto) => registro.mensajes.push(texto),
    ...extra,
  };
  return { registro, opciones };
};

test("procesar confirma el mensaje cuando el manejador funciona", async () => {
  const { opciones, registro } = armar(async () => {});
  assert.equal(await procesar(opciones), "ack");
  assert.deepEqual(registro.republicados, []);
});

test("procesar manda a la DLQ el JSON roto y los mensajes inválidos de reviews.created", async () => {
  const roto = armar(async () => {}, { contenido: Buffer.from("{no es json") });
  assert.equal(await procesar(roto.opciones), "dlq");

  const invalido = armar(async () => {
    throw new MensajeInvalido("rating inválido");
  });
  assert.equal(await procesar(invalido.opciones), "dlq");
  assert.deepEqual(invalido.registro.republicados, []);
});

test("procesar descarta (ack) lo inválido de las colas sin DLQ", async () => {
  const roto = armar(async () => {}, { cola: "catalog.refresh", conDlq: false, contenido: Buffer.from("no json") });
  assert.equal(await procesar(roto.opciones), "ack");
});

test("procesar reintenta con espera creciente y republica con intento + 1", async () => {
  const { opciones, registro } = armar(async () => {
    throw new Error("MongoDB caído");
  });
  assert.equal(await procesar(opciones), "ack");
  assert.deepEqual(registro.esperas, [1000]);
  assert.deepEqual(registro.republicados, [["reviews.created", 2, true]]);

  const tercero = armar(async () => {
    throw new Error("MongoDB caído");
  }, { intento: 3 });
  await procesar(tercero.opciones);
  assert.deepEqual(tercero.registro.esperas, [4000]);
  assert.deepEqual(tercero.registro.republicados, [["reviews.created", 4, true]]);
});

test("procesar manda a la DLQ al agotar los intentos y no republica", async () => {
  const { opciones, registro } = armar(
    async () => {
      throw new Error("MongoDB caído");
    },
    { intento: 5 },
  );
  assert.equal(await procesar(opciones), "dlq");
  assert.deepEqual(registro.republicados, []);
  assert.deepEqual(registro.esperas, []);
});

test("procesar propaga el error si no puede republicar (el mensaje vuelve a la cola sin confirmarse)", async () => {
  const { opciones } = armar(
    async () => {
      throw new Error("MongoDB caído");
    },
    {
      republicar: async () => {
        throw new Error("RabbitMQ caído");
      },
    },
  );
  await assert.rejects(procesar(opciones), /RabbitMQ caído/);
});
