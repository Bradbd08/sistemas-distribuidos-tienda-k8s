# 01. La tienda en Kubernetes (fases 0 y 2)

## Qué reemplaza a qué

| Parte 1 (Docker Compose) | Parte 2 (Kubernetes) |
|---|---|
| HAProxy + Keepalived (`presentation-*`) | Ingress de Traefik (viene con K3s) y Services |
| `web1-3` (nginx) | Deployment `web` (nginx sin root), HPA de 2 a 6 réplicas |
| `application-lb-*` + `app1-3` | Service `api` + Deployment `api`, HPA de 2 a 6 réplicas |
| `galera1-3` + `galera-lb` (HAProxy) | MariaDB Galera de 3 nodos + MaxScale (Service `maxscale`) con MariaDB Operator |
| `mongodb` (1 nodo) | MongoDB con replica set de 3 miembros (operador MCK) |
| `redis` (1 nodo) | Redis con 1 master, 2 réplicas y 3 Sentinel (OpsTree redis-operator) |
| `catalog-init` | Job `catalog-init` (idempotente) |
| Redes `edge`, `application`, `database` | NetworkPolicies: `default-deny` y permisos por capa |

Se conserva la traza de la página (`X-Request-Trace`): `traefik -> web-<pod> -> service/api -> api-<pod> -> redis/galera/mongodb`.

## Capas del repositorio

| Carpeta | Contenido |
|---|---|
| `web/`, `application/` | Imágenes: `web/Dockerfile` (nginx sin root, plantilla con `API_UPSTREAM`), `application/Dockerfile` |
| `deploy/platform/operators/` | Namespaces y los 3 operadores como `HelmRelease` de Flux |
| `deploy/platform/data/` | MariaDB + MaxScale, MongoDB y Redis (recursos de los operadores) y PDB |
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

## Verificación (2026-11-11)

`http://localhost:8081` responde 200 con la traza completa; la caché hace miss y luego hit; una reseña se escribe y se lee; 20 pods
`Ready`; Galera con 3 nodos `Primary`; el aislamiento de red se probó con pods temporales (la API llega a sus tres bases y a nada
más, la web solo a la API, un pod sin etiqueta a nada). Tras reiniciar la laptop completa, los datos se conservaron (ver [hallazgos](hallazgos.md)).

## Pendiente de estas fases

- MetalLB (fase 2): no se usó. En k3d no hace falta y entre dos laptops por Tailscale no puede haber una IP flotante; K3s trae ServiceLB. A confirmar en la etapa 6.
- Usuarios de base de datos con mínimo privilegio, Redis con clave y Pod Security `restricted`: fase 7.
