# 03. Observabilidad con OpenTelemetry y Grafana LGTM (fase 6) — EN CURSO

## Arquitectura

```text
navegador (SDK web) --/otlp/v1/traces--> nginx (módulo OTel) --gRPC--> OTel Collector (gateway) --> Tempo (trazas)
                                            | traceparent                 ^   |--> Mimir (métricas, OTLP)
                                            v                             |   |--> Loki (logs, OTLP)
                                          API (SDK de Node) --OTLP/HTTP---+
OTel Collector (agente, DaemonSet): logs de contenedores + kubelet + descubrimiento Prometheus --> gateway
Grafana (http://grafana.localhost:8081): Mimir, Loki y Tempo enlazados (traza <-> logs <-> métricas)
```

| Pieza | Cómo | Notas |
|---|---|---|
| Loki 3.6 | chart `loki` 7.6.0, un solo binario, disco 2 Gi | sin Minio ni cachés |
| Tempo 2.9 | chart `tempo` 1.24.4, un solo binario, disco 2 Gi | |
| Mimir 3.2 | StatefulSet propio en modo monolítico, disco 3 Gi | el chart distribuido necesita decenas de pods y Minio |
| Grafana 12 | chart `grafana` 10.5.15, contraseña en Secret cifrado con SOPS | `credentials/dev/grafana-admin.yaml` |
| Collectors | chart `opentelemetry-collector` 0.178.3: gateway (Deployment) y agente (DaemonSet) | k8sattributes, logs, kubeletstats |
| API | `application/telemetry.mjs` con `--import`; solo se activa con `OTEL_EXPORTER_OTLP_ENDPOINT` | Compose no cambia |
| nginx | imagen `-otel` + `load_module`, `otel_trace_context propagate` | |
| Navegador | `web/src/telemetry.js` empaquetado con esbuild | muestra el Trace ID en la página |

## Verificado (2026-11-11)

Una petición con `traceparent` conocido produce **una sola traza** con spans de `tienda-web` y `tienda-api` (12 spans: HTTP, MariaDB,
Redis y MongoDB). Mimir recibe `http_server_request_duration_*`, `catalog_cache_hits/misses`, métricas del kubelet y del clúster.
Loki recibe los logs con metadatos de Kubernetes. Las 3 fuentes de datos de Grafana están en `OK`.

## Pendiente

Tableros (RED, caché, nodos y pods, Galera, RabbitMQ), alertas y SLO con burn rate, exportador de MariaDB, `nagios/kubernetes.cfg`
(monitor externo), NetworkPolicies del namespace `observability`, probar el SDK del navegador en un navegador real.

## Datos útiles

- Mimir pone `job="<namespace>/<service.name>"`: la API es `job="tienda/tienda-api"`. Las métricas no llevan `_total` ni `_seconds`.
- La API no sabe la ruta (`http_route`): no hay desglose por ruta en las métricas.
- La ruta `/otlp/v1/traces` de nginx es pública (el navegador la necesita); tiene límite de 10 envíos/s global, solo `POST` y 1 MB.
