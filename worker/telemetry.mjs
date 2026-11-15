// Instrumentación de OpenTelemetry del worker: trazas y métricas por OTLP/HTTP hacia el Collector.
// Se carga antes que el worker:   node --import ./telemetry.mjs index.js
//
// Solo se activa si existe OTEL_EXPORTER_OTLP_ENDPOINT. Propaga la traza por las cabeceras de los mensajes de
// RabbitMQ: la reseña sale en la misma traza que la petición de la API. Es la misma idea que application/telemetry.mjs.
if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  // El worker es ESM: este hook permite parchear mongodb y amqplib cuando se importan.
  const { register } = await import("node:module");
  register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);

  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
  const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-http");
  const { PeriodicExportingMetricReader } = await import("@opentelemetry/sdk-metrics");
  const { HttpInstrumentation } = await import("@opentelemetry/instrumentation-http");
  const { AmqplibInstrumentation } = await import("@opentelemetry/instrumentation-amqplib");
  const { MongoDBInstrumentation } = await import("@opentelemetry/instrumentation-mongodb");

  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: 15_000,
    }),
    instrumentations: [
      new HttpInstrumentation({
        // Las sondas de Kubernetes no generan trazas.
        ignoreIncomingRequestHook: (request) => request.url === "/healthz" || request.url === "/readyz",
      }),
      new AmqplibInstrumentation(),
      new MongoDBInstrumentation(),
    ],
  });
  sdk.start();
}
