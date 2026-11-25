# Resultados de las pruebas de desempeño

Medido el 2026-11-24 en el clúster dev (k3d con 3 servidores, todos en la laptop A) con el commit `261d057` de `main`.
La tienda se probó por el ingress (Traefik) en `http://localhost:8081`. Los datos crudos están en [`2026-11-24-dev/`](2026-11-24-dev/).

Laptop A: Intel Core i5-1235U (12 hilos) y 15 GiB de RAM. Con el clúster completo arriba la laptop usaba unos 9 GiB.

## Resultados frente a la Parte 1

| Prueba | Parte 1 (Docker Compose) | Parte 2 (K3s, dev) |
|---|---|---|
| ab, 1000 peticiones, concurrencia 20, ruta `/` | 1469,64 req/s, media 13,6 ms, p95 29 ms, p99 36 ms, 0 fallos | 7914 req/s, media 2,5 ms, p95 4 ms, p99 5 ms, 0 fallos |
| ab, 1000 peticiones, concurrencia 20, ruta `/api/products/cheapest` (con caché en Redis) | no se midió | 2132 req/s, media 9,4 ms, p95 17 ms, p99 22 ms, 0 fallos |
| Siege, 30 s, 20 usuarios, 3 rutas | 901,55 trans/s, 100 % de disponibilidad, 27 263 transacciones | 3491 trans/s, 100 %, 107 641 transacciones, 0 fallos |
| Siege, 120 s, 50 usuarios, 3 rutas | no se midió | 3668 trans/s, 100 %, 441 465 transacciones, 0 fallos |

Las 3 rutas de Siege son `/`, `/api/health` y `/api/products/cheapest`. Todo es lectura (GET).

## Cómo leer la comparación

- La Parte 1 se midió en otra sesión y con otra configuración (Compose con HAProxy y Keepalived). Es una referencia, no una comparación exacta.
- ab se corrió sin keep-alive, igual que en la Parte 1.
- Siege se corrió con `connection = keep-alive`, como lo hace un navegador. Sin keep-alive el cliente agotó sus puertos locales y abortó al llegar a 1024 conexiones fallidas, aunque las 62 826 respuestas que sí llegaron fueron `200`. Esos intentos se guardaron en [`2026-11-24-dev/intento-1-sin-keepalive/`](2026-11-24-dev/intento-1-sin-keepalive/).
- Las escrituras (POST) pasan por un límite de frecuencia en el ingress (ver [05-seguridad.md](../05-seguridad.md)) y no se midieron.

## Nivel de servicio

Las alertas de SLO de Grafana (ver [03-observabilidad.md](../03-observabilidad.md)) vigilan más de 0,5 % de errores 5xx y un p95 mayor a 500 ms.
En estas pruebas hubo 0 errores. La petición más lenta tardó 0,14 s en Siege y 28 ms en ab.

## Escalado automático (HPA)

- Antes de la carga: `web` con 2 réplicas y `api` con 5 ([`04-hpa-antes.txt`](2026-11-24-dev/04-hpa-antes.txt)).
- Con Siege de 50 usuarios, los dos llegaron al máximo de 6 réplicas, con la CPU en 594 % (`web`) y 950 % (`api`) del objetivo de 70 % ([`14-hpa-durante-carga.txt`](2026-11-24-dev/14-hpa-durante-carga.txt) y [`04b-hpa-despues.txt`](2026-11-24-dev/04b-hpa-despues.txt)).
- Bajo carga los 3 nodos usaron entre 14 % y 27 % de CPU ([`15-top-nodos-bajo-carga.txt`](2026-11-24-dev/15-top-nodos-bajo-carga.txt)).

## Estado del clúster durante la captura

| Archivo | Qué muestra |
|---|---|
| [`00-entorno.txt`](2026-11-24-dev/00-entorno.txt) | Commit desplegado, CPU, memoria y versiones |
| [`01-nodos.txt`](2026-11-24-dev/01-nodos.txt) | 3 nodos en `Ready` |
| [`02-flux-kustomizations.txt`](2026-11-24-dev/02-flux-kustomizations.txt) | 8 capas de Flux en `True` sobre `main@261d057` |
| [`03-pods.txt`](2026-11-24-dev/03-pods.txt) | 56 pods, ninguno con problemas |
| [`05-curl-traza.txt`](2026-11-24-dev/05-curl-traza.txt) | `200` y la traza `traefik -> web -> api -> redis` |

## Límites conocidos

- Dev corre los 3 nodos en una sola laptop: no mide la red real entre laptops. El clúster real de 2 laptops aún no se probó (ver `REQUIREMENTS.md`, sección 6).
- Las notificaciones de Flux llegan a GitHub, pero este rechaza el token con `403 Resource not accessible by personal access token` ([`06-estados-github.txt`](2026-11-24-dev/06-estados-github.txt)). Falta crear el token con permiso de escritura en «Commit statuses». No afecta al despliegue.
- El cambio de la traza del navegador (PR #34) no está en las imágenes de dev: no se reconstruyeron para esta prueba.
