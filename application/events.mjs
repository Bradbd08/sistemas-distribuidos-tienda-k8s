// Publicador de eventos hacia RabbitMQ. index.js lo importa solo si existe RABBITMQ_URL (Kubernetes); en Docker Compose
// no existe y la API se comporta como antes. Guía: docs/04-mensajeria.md.
//
// La conexión es perezosa: se abre en el primer envío y se reabre sola. Si RabbitMQ no responde, publicar() falla rápido
// y el que llama decide qué hacer (guardar la reseña directo en MongoDB). RabbitMQ nunca forma parte de /readyz.
import amqp from "amqplib";
import { declararTopologia } from "./topology.mjs";

const url = process.env.RABBITMQ_URL;
const ESPERA_CONEXION_MS = 3000;
const ESPERA_CONFIRMACION_MS = 5000;
const ENFRIAMIENTO_MS = 5000;

let estado = null; // { conexion, canal } mientras haya conexión
let conectando = null; // promesa de la conexión en curso, compartida por las peticiones simultáneas
let ultimoFallo = 0;

const conLimite = (promesa, ms, mensaje) => {
  let temporizador;
  const limite = new Promise((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new Error(mensaje)), ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(temporizador));
};

const conectar = async () => {
  const intento = amqp.connect(url);
  let conexion;
  try {
    conexion = await conLimite(intento, ESPERA_CONEXION_MS, "RabbitMQ no respondió");
  } catch (error) {
    // Si la conexión llega tarde, se cierra para no dejarla abierta sin dueño.
    intento.then((tarde) => tarde.close()).catch(() => {});
    throw error;
  }
  conexion.on("error", () => {}); // el error llega también como "close"
  conexion.on("close", () => {
    if (estado?.conexion === conexion) estado = null;
  });
  try {
    const canal = await conexion.createConfirmChannel();
    canal.on("error", () => {});
    canal.on("close", () => {
      if (estado?.canal === canal) estado = null;
    });
    await declararTopologia(canal);
    return { conexion, canal };
  } catch (error) {
    await conexion.close().catch(() => {});
    throw error;
  }
};

const obtenerCanal = async () => {
  if (estado) return estado.canal;
  // Tras un fallo no se reintenta durante unos segundos: así las peticiones no esperan 3 s cada una.
  if (Date.now() - ultimoFallo < ENFRIAMIENTO_MS) throw new Error("RabbitMQ no disponible");
  conectando ??= conectar()
    .then((nuevo) => (estado = nuevo))
    .catch((error) => {
      ultimoFallo = Date.now();
      throw error;
    })
    .finally(() => {
      conectando = null;
    });
  return (await conectando).canal;
};

// Publica un mensaje JSON persistente y espera la confirmación del broker (en colas de quórum: ya está en la mayoría).
export const publicar = async (cola, cuerpo) => {
  const canal = await obtenerCanal();
  const confirmado = new Promise((resolve, reject) => {
    canal.sendToQueue(
      cola,
      Buffer.from(JSON.stringify(cuerpo)),
      { persistent: true, contentType: "application/json", ...(cuerpo.id && { messageId: cuerpo.id }) },
      (error) => (error ? reject(error) : resolve()),
    );
  });
  await conLimite(confirmado, ESPERA_CONFIRMACION_MS, "RabbitMQ no confirmó el mensaje");
};

export const cerrar = async () => {
  const actual = estado;
  estado = null;
  await actual?.conexion.close().catch(() => {});
};
