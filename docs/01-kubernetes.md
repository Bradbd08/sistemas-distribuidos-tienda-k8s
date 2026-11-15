# 01. La tienda en Kubernetes (fases 0 y 2)

## Qué reemplaza a qué

| Parte 1 (Docker Compose) | Parte 2 (Kubernetes) |
|---|---|
| HAProxy + Keepalived (`presentation-*`) | Ingress de Traefik (viene con K3s) y Services |
| `web1-3` (nginx) | Deployment `web` (nginx sin root), HPA de 2 a 6 réplicas |
| `application-lb-*` + `app1-3` | Service `api` + Deployment `api`, HPA de 2 a 6 réplicas |
| (no existía) | Deployment `worker` (2 réplicas, sin Service ni HPA) y RabbitMQ de 3 nodos |
| `galera1-3` + `galera-lb` (HAProxy) | MariaDB Galera de 3 nodos + MaxScale (Service `maxscale`) con MariaDB Operator |
| `mongodb` (1 nodo) | MongoDB con replica set de 3 miembros (operador MCK) |
| `redis` (1 nodo) | Redis con 1 master, 2 réplicas y 3 Sentinel (OpsTree redis-operator) |
| `catalog-init` | Job `catalog-init` (idempotente) |
| Redes `edge`, `application`, `database` | NetworkPolicies: `default-deny` y permisos por capa |

Se conserva la traza de la página (`X-Request-Trace`): `traefik -> web-<pod> -> service/api -> api-<pod> -> redis/galera/mongodb`.

## Capas del repositorio

| Carpeta | Contenido |
|---|---|
| `web/`, `application/`, `worker/` | Imágenes: `web/Dockerfile` (nginx sin root, plantilla con `API_UPSTREAM`), `application/Dockerfile` y `worker/Dockerfile` (consume las colas de RabbitMQ, ver [04-mensajeria.md](04-mensajeria.md)) |
| `deploy/platform/operators/` | Namespaces, los 3 operadores como `HelmRelease` de Flux y el RabbitMQ Cluster Operator (manifiesto de la release, copiado) |
| `deploy/platform/data/` | MariaDB + MaxScale, MongoDB, Redis y RabbitMQ (recursos de los operadores) y PDB |
| `deploy/base/` y `deploy/overlays/{dev,prod}/` | La tienda: Deployments, Services, HPA, PDB, Job, Ingress (Kustomize) |
| `deploy/platform/network-policies/` | Aislamiento de red |

Orden de despliegue: operadores, contraseñas, datos, aplicación y, al final, las políticas de red.

## Decisiones

| Decisión | Motivo |
|---|---|
| Pods sin root, UID alto (10101 web, 10001 API), sistema de archivos de solo lectura, sin capacidades | Fase 7 del plan y checkov (CKV_K8S_40); las imágenes siguen declarando 101 y 1000 y Kubernetes las sobrescribe |
| nginx con `emptyDir` en `/tmp` y `/etc/nginx/conf.d` | Con el sistema de archivos de solo lectura, la plantilla se procesa al arrancar y nginx escribe en `/tmp` |
| La API no abre el puerto hasta conectar con MongoDB y Redis | Por eso lleva `startupProbe` (hasta 3 min); vida (`/healthz`) y disponibilidad (`/readyz`) están separadas para que una caída de la base no reinicie en cadena todos los pods |
| `preStop` con `sleep` de 5 s y `maxUnavailable: 0` | Da tiempo a que Traefik y el Service saquen al pod antes de cerrarlo |
| HPA por CPU con requests, sin límite de CPU | Un límite de CPU provoca throttling; el requests basta para escalar |
| MaxScale como proxy de Galera | Lo pide el plan (MaxScale o ProxySQL). Su licencia es BSL: gratis para este proyecto, no es software libre |
| Una cuenta por servicio con todos los permisos de su base | Igual que en Compose. El mínimo privilegio se hace en la fase 7 |
| Redis solo como caché | Los datos se reconstruyen (TTL de 60 s), así que no hace falta que persistan |
| RabbitMQ Cluster Operator fijado en la v2.21.1 y copiado a `operators/` | No hay chart oficial. Desde la v2.22.0 el operador exige cert-manager, que aún no está instalado; se sube de versión cuando llegue (Etapa 5). Trivy no escanea ese archivo porque es de terceros |
| Las colas se declaran desde el código, no con el Messaging Topology Operator | Ese operador también exige cert-manager |
| RabbitMQ con 768 Mi por nodo y sin límite de CPU | El operador pide 1 CPU y 2 Gi por nodo, que la laptop no aguanta |

## Verificación (2026-11-11)

`http://localhost:8081` responde 200 con la traza completa; la caché hace miss y luego hit; una reseña se escribe y se lee; 20 pods
`Ready`; Galera con 3 nodos `Primary`; el aislamiento de red se probó con pods temporales (la API llega a sus tres bases y a nada
más, la web solo a la API, un pod sin etiqueta a nada). Tras reiniciar la laptop completa, los datos se conservaron (ver [hallazgos](hallazgos.md)).

## Pendiente de estas fases

- MetalLB (fase 2): no se usó. En k3d no hace falta y entre dos laptops por Tailscale no puede haber una IP flotante; K3s trae ServiceLB. A confirmar en la etapa 6.
- Usuarios de base de datos con mínimo privilegio, Redis con clave y Pod Security `restricted`: fase 7.
