# 03. Observabilidad con OpenTelemetry y Grafana LGTM (fase 6) — HECHA (alcance mínimo)

## Arquitectura

```text
navegador (SDK web) --/otlp/v1/traces--> nginx (módulo OTel) --gRPC--> OTel Collector (gateway) --> Tempo (trazas)
                                            | traceparent                 ^   |--> Mimir (métricas, OTLP)
                                            v                             |   |--> Loki (logs, OTLP)
                                          API (SDK de Node) --OTLP/HTTP---+
OTel Collector (agente, DaemonSet): logs de contenedores + kubelet + métricas descubiertas por anotaciones (RabbitMQ) --> gateway
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

## Tableros y alertas

Carpeta **Tienda** en Grafana. Los tableros son JSON en `deploy/platform/observability/dashboards/`; Kustomize los junta en el ConfigMap
`grafana-dashboards-tienda` (etiqueta `grafana_dashboard=1`) y el sidecar de Grafana los carga solo.

| Tablero | Qué muestra |
|---|---|
| Tienda · API (RED) | peticiones por segundo, % de errores 5xx, latencia p50/p95/p99, por código de estado y por pod, conexiones a MongoDB |
| Tienda · Caché | % de aciertos de Redis, aciertos y fallos por segundo, % por pod |
| Tienda · Nodos y pods | CPU, memoria y red por nodo; CPU y memoria por pod de `tienda`; contenedores no listos; reinicios en la última hora |
| Tienda · RabbitMQ | Nodos del clúster; mensajes listos y sin confirmar por cola; consumidores; mensajes por segundo (recibidos, entregados y confirmados); envíos a la DLQ; memoria por nodo; conexiones y canales |

Alertas (Alerting → Alert rules, grupos `tienda-slo` y `tienda-colas`). Viven en `grafana.yaml`, llave `alerting`:

| Regla | Se activa cuando |
|---|---|
| API: más de 0,5 % de errores 5xx | la razón de 5xx sobre el total (ventana de 5 min) pasa de 0,5 % durante 5 min (SLO de disponibilidad de 99,5 %) |
| API: p95 de latencia mayor a 500 ms | el p95 (ventana de 5 min) pasa de 0,5 s durante 5 min |
| RabbitMQ: hay mensajes en `reviews.dlq` | la DLQ tiene al menos 1 mensaje listo durante 1 min |
| RabbitMQ: más de 100 mensajes esperando en `reviews.created` | la profundidad de la cola pasa de 100 durante 5 min |
| RabbitMQ: `reviews.created` sin consumidores | el máximo de consumidores baja de 1 durante 2 min (también si deja de llegar la métrica) |

Límites conocidos: no hay punto de contacto (solo se ven en Grafana). Sin tráfico no hay datos y las reglas quedan en OK, así que una
caída total no dispara; hace falta una regla de ausencia cuando haya pruebas sintéticas. Solo se probó el caso sano (no hay 5xx en el tráfico de prueba).

## Probado (2026-11-15)

Un Grafana 12.3.1 local con el provisioning que renderiza el chart y Mimir en vivo: los 4 tableros cargan en la carpeta Tienda, las 40 consultas
devuelven valores y las 5 reglas se evalúan sin error. El retraso de los consumidores se aproxima con la profundidad y el número de consumidores:
RabbitMQ no expone la edad del mensaje más viejo.

## Pendiente

Tablero de Galera, exportador de MariaDB, burn rate con varias ventanas, `nagios/kubernetes.cfg`
(monitor externo), NetworkPolicies del namespace `observability` (Etapa 5), punto de contacto de las alertas, probar el SDK del
navegador en un navegador real.

## Datos útiles

- Mimir pone `job="<namespace>/<service.name>"`: la API es `job="tienda/tienda-api"`. Las métricas no llevan `_total` ni `_seconds`.
- La API no sabe la ruta (`http_route`): no hay desglose por ruta en las métricas.
- Las métricas OTLP se guardan cada 60 s, por eso el datasource Mimir tiene `timeInterval: 60s` (así `$__rate_interval` es de 4 min o más). Con 15 s, los `rate()` de los tableros salían vacíos.
- El agente descubre métricas con las anotaciones `io.opentelemetry.discovery.metrics.<puerto>/{enabled,scraper,config}` en el pod, no con `prometheus.io/*`. Ejemplo en `deploy/platform/data/rabbitmq.yaml` (`scraper: prometheus`). Las métricas de RabbitMQ llegan con `job="tienda/rabbitmq"` e `instance="<ip>:15692"`.
- Las métricas `k8s_deployment_*`, `k8s_daemonset_*`, `k8s_statefulset_*`, `k8s_hpa_*` y `k8s_job_*` llegan sin etiquetas (una sola serie): no sirven para tableros. Para nombres de nodo y pod se une con `target_info`.
- La ruta `/otlp/v1/traces` de nginx es pública (el navegador la necesita); tiene límite de 10 envíos/s global, solo `POST` y 1 MB.
