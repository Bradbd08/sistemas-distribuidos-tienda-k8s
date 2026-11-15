# 04. Mensajería con RabbitMQ y el worker (fase 3)

La API ya no escribe las reseñas en MongoDB ella sola. Las publica en una cola y un servicio nuevo, el `worker`, las guarda.
Así la respuesta es rápida y un fallo de MongoDB no pierde la reseña: se reintenta.

## Arquitectura

```text
Reseñas:
  cliente --POST--> API --publica (con confirmación)--> [reviews.created] --> worker --insert (_id = id)--> MongoDB
          <--202--                                           |  error: espera y republica con x-attempt+1
                                                             |  5 intentos o mensaje inválido: nack sin requeue
                                                             v
                                                       [reviews.dlq]  (por el exchange reviews.dlx)

Caché:
  POST /cache/clear --> API --> [catalog.changed] --> worker --> [catalog.refresh] --> worker --GET /products/cheapest--> API --> Redis

RabbitMQ: 3 nodos, colas de quórum. Sin RabbitMQ la API escribe directo en MongoDB (modo degradado).
```

| Pieza | Qué hace |
|---|---|
| API (`application/events.mjs`) | Publica con confirmación del broker. `RABBITMQ_URL` es opcional |
| RabbitMQ 4.3.7 | 3 nodos. Lo despliega el RabbitMQ Cluster Operator (`deploy/platform/data/rabbitmq.yaml`) |
| Worker (`worker/`, imagen `tienda-worker`) | 2 réplicas, sin Service y sin HPA. Consume las colas. Sondas en el puerto 8081 (`/healthz` y `/readyz`) |
| `topology.mjs` | Declara las colas. Hay una copia en `application/` y otra en `worker/`, idénticas (el CI las compara con `diff`) |

## Colas

Todas son de quórum y durables. Se declaran desde el código, con los mismos argumentos en la API y en el worker.

| Cola | Argumentos | Para qué |
|---|---|---|
| `reviews.created` | `x-queue-type: quorum`, `x-delivery-limit: 5`, `x-dead-letter-exchange: reviews.dlx`, `x-dead-letter-routing-key: reviews.dlq` | Reseñas nuevas |
| `reviews.dlq` | `x-queue-type: quorum` | Reseñas que no se pudieron procesar. Está enlazada al exchange `reviews.dlx` (direct, durable) con la clave `reviews.dlq` |
| `catalog.changed` | `x-queue-type: quorum` | Aviso de que el catálogo cambió (lo publica `POST /cache/clear`) |
| `catalog.refresh` | `x-queue-type: quorum` | Orden de repoblar la caché |

Las colas de catálogo no tienen DLQ.

## Mensajes

Todos son JSON en UTF-8 y persistentes.

`reviews.created`:

```json
{
  "id": "6736f1a2c4e5b8a1d2f3a4b5",
  "sku": "ST-001",
  "reviewer": "Ana",
  "rating": 5,
  "comment": "Muy buen producto",
  "createdAt": "2026-11-15T18:30:00.000Z"
}
```

| Campo | Regla |
|---|---|
| `id` | ObjectId de 24 caracteres hexadecimales (lo genera la API) |
| `sku` | SKU de un producto que existe en MariaDB |
| `reviewer` | Texto de 1 a 80 caracteres |
| `rating` | Entero de 1 a 5 |
| `comment` | Texto de 1 a 1000 caracteres |
| `createdAt` | Fecha ISO-8601 |
| cabecera `x-attempt` | Opcional. Entero. Si falta, es el intento 1 |

`catalog.changed` y `catalog.refresh`:

```json
{ "scope": "products", "at": "2026-11-15T18:30:00.000Z" }
```

## Flujo de una reseña

1. `POST /products/{sku}/reviews` valida igual que antes y comprueba el producto en MariaDB.
2. Si existe `RABBITMQ_URL` y RabbitMQ responde, la API genera un ObjectId y publica en `reviews.created`. Espera la confirmación del broker.
3. Responde **202** con `{id, sku, reviewer, rating, comment, createdAt, status: "queued"}`. La reseña aún no está en MongoDB.
4. El worker la consume y la inserta con `_id = id`. Si la clave ya existe (clave duplicada), el mensaje ya se procesó: confirma y sigue. Por eso el proceso es idempotente.
5. `GET /products/{sku}/reviews` la muestra unos instantes después.

## Flujo de la caché

1. `POST /cache/clear` borra la clave de Redis y responde igual que antes.
2. Si hay RabbitMQ, publica además `catalog.changed`. No bloquea ni falla si RabbitMQ no está.
3. El worker recibe `catalog.changed` y publica `catalog.refresh`.
4. El worker recibe `catalog.refresh` y hace `GET {API_URL}/products/cheapest`. Eso repuebla la caché con una sola consulta a MariaDB.
5. Si falla `MAX_ATTEMPTS` veces, el mensaje se descarta con un aviso en el log. La caché expira sola a los 60 s.

## Reintentos y DLQ

| Situación | Qué hace el worker |
|---|---|
| Error al procesar (por ejemplo, MongoDB no responde) | Espera `min(30 s, 2^(n-1) s)`, republica en la misma cola con la cabecera `x-attempt = n+1` y confirma el original |
| Llega a `MAX_ATTEMPTS` (5) | `nack` **sin requeue**. RabbitMQ lo manda a `reviews.dlq` por el exchange `reviews.dlx` |
| Mensaje inválido (JSON roto o fuera del esquema) | `nack` sin requeue de inmediato: va directo a la DLQ |
| El worker muere con el mensaje sin confirmar | RabbitMQ lo entrega de nuevo. `x-delivery-limit: 5` evita que se repita sin fin |

**Hallazgo (probado en el clúster, 2026-11-15):** en RabbitMQ 4.3.7 las devoluciones con requeue **no cuentan** contra `x-delivery-limit`.
Con límite 3 hicimos 6 devoluciones y ningún mensaje llegó a la DLQ. Por eso el contador de intentos va en la cabecera `x-attempt` y lo lleva el
worker. El `x-delivery-limit` queda solo como red de seguridad para los consumidores que mueren.

## Modo degradado y fallas

| Qué falla | Qué pasa |
|---|---|
| No hay `RABBITMQ_URL` (Docker Compose) | La API inserta directo en MongoDB y responde 201, como antes |
| `RABBITMQ_URL` existe pero RabbitMQ no responde, o falla la publicación | La API inserta directo en MongoDB, responde 201 y deja un aviso en el log |
| Cae un nodo de RabbitMQ | Las colas de quórum siguen con 2 de 3 nodos. Si cae el líder, otro nodo toma el liderazgo |
| Caen 2 o más nodos | La cola pierde la mayoría y no acepta mensajes. La API cae al modo degradado |
| Cae un worker | El otro sigue. Lo que tenía sin confirmar vuelve a la cola |
| Caen los 2 workers | Los mensajes esperan en la cola. Se procesan al volver |
| Cae MongoDB | El worker reintenta con espera. Pasados 5 intentos, la reseña va a la DLQ (no se pierde) |

**Probado en el clúster (2026-11-15)** con una cola de prueba equivalente: quórum de 3 nodos. Se borró el pod líder, el liderazgo pasó a otro
nodo y no se perdió ningún mensaje (19 = 17 + 5 publicados - 3 consumidos). Cada nodo de RabbitMQ usa unos 130 MiB reales (límite 768 Mi).

## Prueba de punta a punta (2026-11-15)

Con el clúster dev, la API y el worker desplegados por Flux:

| Prueba | Resultado |
|---|---|
| Reseña por la API (`POST` con `curl`) | 202 con `status: "queued"`; aparece en el `GET` unos 2 s después |
| La misma reseña publicada 2 veces (mismo `id`) | Queda 1 sola (clave duplicada = ya procesada) |
| Mensaje inválido en `reviews.created` | El worker lo avisa en el log y va a `reviews.dlq` (1 mensaje) |
| 40 reseñas por la API y se borra el pod líder de las colas a los 2 s | 40 aceptadas (202), 40 guardadas, ninguna repetida. Latencia máxima 0,32 s. El worker conectado a ese nodo se reinicia y vuelve en segundos |
| Traza en Tempo | `tienda-web` → `tienda-api` (POST, SELECT, publish) → `tienda-worker` (`reviews.created process`, `insert product_reviews`): la traza cruza RabbitMQ por las cabeceras del mensaje |

## Cómo probarlo

Los comandos son de este clúster (`http://localhost:8081`, namespace `tienda`).

**1. Publicar una reseña y verla guardada:**

```bash
curl -s -X POST http://localhost:8081/api/products/ST-001/reviews \
  -H 'Content-Type: application/json' \
  -d '{"reviewer":"Prueba","rating":5,"comment":"Reseña por la cola"}'
# {"id":"...","status":"queued",...}   (HTTP 202)
sleep 2
curl -s http://localhost:8081/api/products/ST-001/reviews    # la reseña aparece
kubectl -n tienda logs deploy/worker --tail=5                # el worker la procesó
```

**2. Ver las colas** (las cifras tardan unos segundos en actualizarse):

```bash
kubectl -n tienda exec rabbitmq-server-0 -c rabbitmq -- rabbitmqctl list_queues name type messages consumers
```

Para la API de administración (publicar o mover mensajes) lee la contraseña a variables del shell, sin imprimirla, y abre el túnel:

```bash
RMQ_USER=$(kubectl -n tienda get secret rabbitmq-default-user -o jsonpath='{.data.username}' | base64 -d)
RMQ_PASS=$(kubectl -n tienda get secret rabbitmq-default-user -o jsonpath='{.data.password}' | base64 -d)
kubectl -n tienda port-forward svc/rabbitmq 15672 &     # al terminar: kill %1
sleep 2
```

**3. Forzar un mensaje inválido y verlo en `reviews.dlq`:**

```bash
curl -s -u "$RMQ_USER:$RMQ_PASS" -X POST http://localhost:15672/api/exchanges/%2F/amq.default/publish \
  -H 'Content-Type: application/json' \
  -d '{"properties":{"delivery_mode":2},"routing_key":"reviews.created","payload":"esto no es json","payload_encoding":"string"}'
# {"routed":true}
sleep 5
kubectl -n tienda exec rabbitmq-server-0 -c rabbitmq -- rabbitmqctl list_queues name messages    # reviews.dlq: 1
kubectl -n tienda logs deploy/worker --tail=5      # aviso de mensaje inválido
```

Para ver los mensajes sin quitarlos de la DLQ (`ack_requeue_true` los deja en su sitio):

```bash
curl -s -u "$RMQ_USER:$RMQ_PASS" -X POST http://localhost:15672/api/queues/%2F/reviews.dlq/get \
  -H 'Content-Type: application/json' -d '{"count":5,"ackmode":"ack_requeue_true","encoding":"auto"}' \
  | python3 -c 'import sys, json; [print(m["payload"]) for m in json.load(sys.stdin)]'
```

**4. Probar la caída de un nodo:** `kubectl -n tienda delete pod rabbitmq-server-0`. El operador lo recrea (el volumen no se borra).
Mientras tanto, publica reseñas con el paso 1: siguen entrando con 202. El modo degradado (201) se ve en Docker Compose, donde `RABBITMQ_URL` no existe.

## Runbook

Antes de cualquier paso, ten a mano las variables y el port-forward del paso 2.

**Cola atascada** (`messages` sube y no baja):

1. `consumers` en 0: el worker no está conectado. `kubectl -n tienda get pods -l app.kubernetes.io/name=worker` y `kubectl -n tienda logs deploy/worker`.
2. `consumers` mayor que 0 pero los mensajes no bajan: mira el log del worker. Casi siempre es MongoDB o la API caída (`kubectl -n tienda get mongodbcommunity`).
3. `kubectl -n tienda rollout restart deploy/worker` si el worker quedó colgado. Los mensajes no se pierden: están en la cola.
4. Si el worker no puede abrir conexiones, revisa las NetworkPolicies del worker y de RabbitMQ (`kubectl -n tienda get networkpolicy`).
5. Un nodo de RabbitMQ caído: `kubectl -n tienda get pods -l app.kubernetes.io/name=rabbitmq`. Con 2 de 3 nodos todo sigue funcionando.

**Mensajes en la DLQ:**

1. Ver cuántos hay y qué dicen (ver el paso 3 de arriba). Lee el log del worker para saber por qué fallaron.
2. Arregla la causa primero (MongoDB, la API o el mensaje mismo).
3. Reprocesar un mensaje: se guarda en un archivo, se publica en `reviews.created` y solo entonces se confirma que llegó. Se publica solo el `payload`,
   así el mensaje vuelve a empezar en el intento 1.

```bash
# Saca 1 mensaje de la DLQ y lo guarda (queda fuera de la cola: no pierdas el archivo).
curl -s -u "$RMQ_USER:$RMQ_PASS" -X POST http://localhost:15672/api/queues/%2F/reviews.dlq/get \
  -H 'Content-Type: application/json' -d '{"count":1,"ackmode":"ack_requeue_false","encoding":"auto"}' > dlq-mensaje.json
# Lo vuelve a publicar en reviews.created
python3 - <<'EOF' | curl -s -u "$RMQ_USER:$RMQ_PASS" -X POST http://localhost:15672/api/exchanges/%2F/amq.default/publish \
    -H 'Content-Type: application/json' -d @-
import json
m = json.load(open("dlq-mensaje.json"))[0]
print(json.dumps({"properties": {"delivery_mode": 2}, "routing_key": "reviews.created", "payload": m["payload"], "payload_encoding": "string"}))
EOF
# {"routed":true}   <- si dice false, publica a mano desde dlq-mensaje.json
```

Si el mensaje es inválido de verdad, volverá a la DLQ. Corrige el JSON en `dlq-mensaje.json` antes de publicarlo. No subas ese archivo a git.

**Respaldar las definiciones** (colas, exchanges, enlaces, políticas y usuarios; no los mensajes):

```bash
curl -s -u "$RMQ_USER:$RMQ_PASS" http://localhost:15672/api/definitions > definiciones-rabbitmq.json
```

El archivo lleva los hashes de las contraseñas de los usuarios: guárdalo fuera de git.

## Límites conocidos

| Tema | Detalle |
|---|---|
| Operador en la v2.21.1 | Desde la v2.22.0 el operador exige cert-manager, que el clúster no tiene. Se sube cuando llegue (Etapa 5) |
| Sin TLS | El AMQP y la administración van sin cifrar dentro del clúster |
| Sin usuarios por servicio | La API y el worker usan el usuario por defecto `rabbitmq-default-user`. El mínimo privilegio queda para la fase 7 |
| Sin KEDA | Los workers son 2 réplicas fijas. No escalan por el largo de la cola |
| Sin DLQ en las colas de catálogo | Si fallan 5 veces se descartan con un aviso. La caché expira sola a los 60 s |
| Sin pruebas con broker real en CI | El CI revisa la sintaxis y corre las pruebas de los manejadores (`node --test worker/handlers.test.mjs`). Las colas se probaron a mano en el clúster |
| El retraso de los consumidores se aproxima | Hay alertas por profundidad de `reviews.created`, por mensajes en `reviews.dlq` y por falta de consumidores (ver [03-observabilidad.md](03-observabilidad.md)). RabbitMQ no expone la edad del mensaje más viejo |
| El worker se reinicia si pierde RabbitMQ | Sale y Kubernetes lo levanta en segundos. Con muchas caídas seguidas el reinicio se espacia (CrashLoopBackOff). Pasar a reconectar dentro del proceso si las pruebas de caos lo exigen |
| Un componente nuevo con NetworkPolicies nuevas bloquea Flux la primera vez | La capa `network-policies` depende de `apps`, y `apps` espera a que el worker esté listo; sin la política, el worker no llega a MongoDB. La primera vez se aplicó a mano: `kubectl apply --server-side -k deploy/platform/network-policies`. Mejor: unir las políticas en un PR antes que el componente |
| El 202 no garantiza que la reseña ya esté en MongoDB | Es consistencia eventual. Si algo falla, la reseña puede acabar en la DLQ |
