# Documentación de la Parte 2: migración a Kubernetes

Implementa el [plan de migración del profe](https://github.com/tuxtter/distributedsystems/blob/main/PLATFORM-MIGRATION-PLAN.md)
sobre la tienda de 3 capas de la Parte 1 (Docker Compose). Cómo levantar el proyecto: [`REQUIREMENTS.md`](../REQUIREMENTS.md).

| Documento | De qué trata | Fases del plan |
|---|---|---|
| [01-kubernetes.md](01-kubernetes.md) | La tienda en Kubernetes: imágenes, manifiestos, datos con operadores, red | 0 y 2 |
| [02-gitops-iac-cicd.md](02-gitops-iac-cicd.md) | Terraform, FluxCD, SOPS y GitHub Actions | 1, 4 y 5 |
| [03-observabilidad.md](03-observabilidad.md) | OpenTelemetry y Grafana LGTM | 6 |
| [04-mensajeria.md](04-mensajeria.md) | RabbitMQ, el worker, reintentos y DLQ | 3 |
| [hallazgos.md](hallazgos.md) | Problemas encontrados, su causa y cómo se resolvieron | todas |

Los resultados de las pruebas de desempeño irán en `docs/resultados/` (fase 8).

## Estado

| Etapa | Fases del plan | Estado |
|---|---|---|
| 1. Imágenes, manifiestos y datos | 0 y 2 | Hecha |
| 2. Terraform, Flux y GitHub Actions | 1, 4 y 5 | Hecha (lo no probado está marcado en 02-gitops-iac-cicd.md) |
| 3. OpenTelemetry y Grafana LGTM | 6 | Hecha con alcance mínimo (pendientes en 03-observabilidad.md) |
| 4. RabbitMQ y worker | 3 | Hecha, falta tablero y alertas de RabbitMQ |
| 5. Wazuh y endurecimiento | 7 | Pendiente |
| 6. Clúster real, pruebas y entrega | 8 | Pendiente |
