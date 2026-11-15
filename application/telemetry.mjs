// Instrumentación de OpenTelemetry: trazas y métricas por OTLP/HTTP hacia el Collector.
// Se carga antes que la API:   node --import ./telemetry.mjs index.js
//
// Solo se activa si existe OTEL_EXPORTER_OTLP_ENDPOINT. En Docker Compose no hay Collector, así que ahí la
// API arranca exactamente como antes. Lo demás (nombre del servicio, atributos) viene de las variables OTEL_*.
if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  // La API es ESM: este hook permite parchear mysql2, mongodb y redis cuando se importan. Debe registrarse
  // antes de que index.js los importe (por eso se importa el SDK después, de forma dinámica).
  const { register } = await import("node:module");
  register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);

  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
  const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-http");
  const { PeriodicExportingMetricReader } = await import("@opentelemetry/sdk-metrics");
  const { HttpInstrumentation } = await import("@opentelemetry/instrumentation-http");
  const { MySQL2Instrumentation } = await import("@opentelemetry/instrumentation-mysql2");
  const { MongoDBInstrumentation } = await import("@opentelemetry/instrumentation-mongodb");
  const { RedisInstrumentation } = await import("@opentelemetry/instrumentation-redis");
  // Propaga la traza por las cabeceras de los mensajes de RabbitMQ: la reseña y el worker salen en la misma traza.
  const { AmqplibInstrumentation } = await import("@opentelemetry/instrumentation-amqplib");

  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: 15_000,
    }),
    instrumentations: [
      new HttpInstrumentation({
        // Las sondas de Kubernetes no generan trazas ni cuentan en las métricas RED.
        ignoreIncomingRequestHook: (request) => request.url === "/healthz" || request.url === "/readyz",
      }),
      new MySQL2Instrumentation(),
      new MongoDBInstrumentation(),
      new RedisInstrumentation(),
      new AmqplibInstrumentation(),
    ],
  });
  sdk.start();
}
