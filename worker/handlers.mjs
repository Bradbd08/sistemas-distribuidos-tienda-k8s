// Lógica del worker sin dependencias externas: así se prueba con "node --test" sin instalar nada.

export class MensajeInvalido extends Error {}

const OBJECT_ID = /^[0-9a-f]{24}$/;
const SKU = /^[A-Za-z0-9-]{1,64}$/;

// Mismas reglas que la API al recibir la reseña. Devuelve el id y el documento listo para MongoDB.
export const validarResena = (cuerpo) => {
  const invalido = (motivo) => {
    throw new MensajeInvalido(motivo);
  };
  if (cuerpo === null || typeof cuerpo !== "object" || Array.isArray(cuerpo)) invalido("el cuerpo no es un objeto");
  const { id, sku, reviewer, rating, comment, createdAt } = cuerpo;
  if (typeof id !== "string" || !OBJECT_ID.test(id)) invalido("id no es un ObjectId de 24 caracteres hexadecimales");
  if (typeof sku !== "string" || !SKU.test(sku)) invalido("sku inválido");
  const autor = typeof reviewer === "string" ? reviewer.trim() : "";
  if (autor.length < 1 || autor.length > 80) invalido("reviewer inválido");
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) invalido("rating inválido");
  const texto = typeof comment === "string" ? comment.trim() : "";
  if (texto.length < 1 || texto.length > 1000) invalido("comment inválido");
  const fecha = typeof createdAt === "string" ? new Date(createdAt) : new Date(Number.NaN);
  if (Number.isNaN(fecha.getTime())) invalido("createdAt inválido");
  return { id, doc: { sku, reviewer: autor, rating, comment: texto, createdAt: fecha } };
};

// Código de MongoDB para "clave duplicada": la reseña ya se había guardado.
export const esDuplicado = (error) => error?.code === 11000;

// Espera antes de reintentar el intento n (1, 2, 3...): 1 s, 2 s, 4 s... hasta 30 s.
export const espera = (intento) => Math.min(30_000, 1000 * 2 ** (intento - 1));

// Qué hace cada cola con un mensaje ya convertido de JSON.
export const crearManejadores = ({ insertarResena, publicar, llamarApi }) => ({
  "reviews.created": async (cuerpo) => {
    const { id, doc } = validarResena(cuerpo);
    try {
      await insertarResena(id, doc);
    } catch (error) {
      if (!esDuplicado(error)) throw error;
    }
  },
  // La API ya borró la clave: aquí solo se pide repoblar la caché, en un único mensaje.
  "catalog.changed": async () => {
    await publicar("catalog.refresh", { scope: "products", at: new Date().toISOString() });
  },
  "catalog.refresh": async () => {
    const estado = await llamarApi("/products/cheapest");
    if (estado < 200 || estado >= 300) throw new Error(`la API respondió ${estado}`);
  },
});

// Procesa un mensaje y devuelve qué hacer con el original: "ack" (confirmarlo) o "dlq" (rechazarlo sin
// devolverlo a la cola; RabbitMQ lo manda a reviews.dlq). Si falla de forma pasajera, espera, republica el mensaje
// con intento + 1 y lo confirma: así el contador de intentos lo lleva el worker.
export const procesar = async ({ cola, contenido, intento, manejar, republicar, esperar, maxIntentos, conDlq, registrar }) => {
  const sinRetorno = conDlq ? "dlq" : "ack";
  let cuerpo;
  try {
    cuerpo = JSON.parse(contenido.toString("utf8"));
  } catch {
    registrar(`${cola}: el mensaje no es JSON`);
    return sinRetorno;
  }
  try {
    await manejar(cuerpo);
    return "ack";
  } catch (error) {
    if (error instanceof MensajeInvalido) {
      registrar(`${cola}: mensaje inválido (${error.message})`);
      return sinRetorno;
    }
    if (intento >= maxIntentos) {
      registrar(`${cola}: agotó ${maxIntentos} intentos (${error.message})`);
      return sinRetorno;
    }
    const ms = espera(intento);
    registrar(`${cola}: el intento ${intento} de ${maxIntentos} falló (${error.message}); se reintenta en ${ms} ms`);
    await esperar(ms);
    await republicar(cola, contenido, intento + 1);
    return "ack";
  }
};
