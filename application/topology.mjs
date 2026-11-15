// Topología de RabbitMQ. Este archivo es IDÉNTICO en application/ y en worker/ (el CI los compara con diff):
// si una cola ya existe, RabbitMQ rechaza (406) declararla con argumentos distintos.
// Las colas se declaran desde el código porque el Messaging Topology Operator exige cert-manager.
export const DLX = "reviews.dlx";

// Todas son colas de quórum (replicadas en los 3 nodos). reviews.created manda a reviews.dlq, vía el exchange
// reviews.dlx, los mensajes que el worker rechaza sin devolverlos a la cola.
export const COLAS = {
  "reviews.created": {
    "x-queue-type": "quorum",
    // Solo protege contra un consumidor que muere con el mensaje sin confirmar: en RabbitMQ 4.3 las devoluciones con
    // requeue no cuentan, por eso los reintentos los lleva el worker en la cabecera x-attempt.
    "x-delivery-limit": 5,
    "x-dead-letter-exchange": DLX,
    "x-dead-letter-routing-key": "reviews.dlq",
  },
  "reviews.dlq": { "x-queue-type": "quorum" },
  "catalog.changed": { "x-queue-type": "quorum" },
  "catalog.refresh": { "x-queue-type": "quorum" },
};

export const declararTopologia = async (canal) => {
  await canal.assertExchange(DLX, "direct", { durable: true });
  for (const [nombre, argumentos] of Object.entries(COLAS)) {
    await canal.assertQueue(nombre, { durable: true, arguments: argumentos });
  }
  await canal.bindQueue("reviews.dlq", DLX, "reviews.dlq");
};
