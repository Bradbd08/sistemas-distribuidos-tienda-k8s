// Trazas del navegador con OpenTelemetry. Cada fetch hacia la API crea un span y envía el encabezado
// traceparent, así la traza continúa en nginx y en la API (una sola traza desde el clic hasta la base de datos).
// Los spans salen por /otlp/v1/traces: el navegador no puede hablar con el Collector, nginx los reenvía.
// esbuild empaqueta este archivo en dist/telemetry.js (ver web/Dockerfile).
import { trace } from "@opentelemetry/api";
import { BatchSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";

// Muestra en la página el ID de la última traza, para pegarlo en Grafana (Explore > Tempo).
const showTraceId = {
  onStart() {},
  onEnd(span) {
    const target = document.getElementById("trace-id");
    if (target && String(span.attributes["url.full"] ?? "").includes("/api/")) {
      target.textContent = span.spanContext().traceId;
    }
  },
  forceFlush: async () => {},
  shutdown: async () => {},
};

const provider = new TracerProvider({
  resource: resourceFromAttributes({ "service.name": "tienda-browser", "service.namespace": "tienda" }),
  spanProcessors: [
    new BatchSpanProcessor(new OTLPTraceExporter({ url: "/otlp/v1/traces" }), { scheduledDelayMillis: 1000 }),
    showTraceId,
  ],
});
trace.setGlobalTracerProvider(provider);

registerInstrumentations({
  // No se traza el propio envío de trazas.
  instrumentations: [new FetchInstrumentation({ ignoreUrls: [/\/otlp\//] })],
});
