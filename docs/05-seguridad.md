# 05. Seguridad y endurecimiento (fase 7) — EN CURSO

Se hace primero lo barato y de poco riesgo. Wazuh va al final y en versión mínima (es lo que más RAM pide).

## Estado

| Medida (fase 7) | Estado |
|---|---|
| Pod Security Admission en `tienda` | Hecha: `baseline` obligatorio, `restricted` en aviso |
| Contenedores sin root, sistema de archivos de solo lectura | Hecha en web, API y worker (cumplen `restricted`). RabbitMQ y MongoDB también |
| Autenticación y límite de frecuencia en el ingress | Hecha: toda escritura (método distinto de `GET`, `HEAD` y `OPTIONS`) pide HTTPS, contraseña y límite |
| Usuarios de base de datos con mínimo privilegio | MongoDB ya lo cumplía y MariaDB está hecha (la API usa un usuario de solo lectura). Redis: pendiente |
| TLS con cert-manager | Hecha: CA propia y HTTPS en el ingress. Las escrituras de la API solo entran por HTTPS |
| Verificación de firmas con Kyverno | Pendiente |
| kube-bench (CIS) | Pendiente |
| Wazuh (manager, indexador, panel y agentes) | Pendiente, al final |

## Pod Security Admission

El namespace `tienda` lleva estas etiquetas (`deploy/platform/operators/namespaces.yaml`):

| Etiqueta | Nivel | Qué hace |
|---|---|---|
| `pod-security.kubernetes.io/enforce` | `baseline` | Rechaza pods privilegiados, con `hostPath`, etc. |
| `pod-security.kubernetes.io/warn` | `restricted` | Avisa al crear un pod que no cumple |
| `pod-security.kubernetes.io/audit` | `restricted` | Lo anota en el log de auditoría |

Se probó antes con una simulación en el servidor (`kubectl label --dry-run=server --overwrite ns tienda pod-security.kubernetes.io/enforce=restricted`).
Con `restricted` obligatorio fallarían 11 pods que crean los operadores de las bases de datos:

| Pods | Qué incumplen |
|---|---|
| `mariadb-0..2` y `maxscale-0..1` | `allowPrivilegeEscalation`, capacidades y perfil `seccomp` |
| `redis-0..2` y `redis-s-0..2` (Sentinel) | lo mismo, y además corren como root |

Los pods de la API, la web, el worker, RabbitMQ y MongoDB ya cumplen `restricted`. Para pasar `tienda` a `restricted` obligatorio hay que
configurar el `securityContext` en los recursos de MariaDB, MaxScale y Redis. Eso reinicia las bases de datos, así que se deja para el final.

`observability` no lleva etiquetas: el agente de OpenTelemetry usa `hostPath` para leer los logs de los contenedores (incumple hasta `baseline`).

## Autenticación y límite en el ingress

Toda **escritura** (cualquier método que no sea `GET`, `HEAD` ni `OPTIONS`, en cualquier ruta) solo se acepta por HTTPS. La ruta de Traefik
(`IngressRoute tienda-escrituras`, en `deploy/base/ingress.yaml`) escucha en el puerto `websecure` y aplica estos middlewares, en este orden:

1. `limite-escrituras`: 20 peticiones por segundo por IP, con ráfaga de 40. Va antes de la contraseña para frenar los intentos a ciegas.
2. `auth-admin`: usuario y contraseña (`basicAuth`) del Secret `ingress-admin-auth`, cifrado con SOPS en `credentials/dev/`. Después de comprobarla
   quita la cabecera `Authorization`: la contraseña no sigue hacia nginx ni la API.

Se decide **por método y no por ruta** a propósito (hallazgo 23): Traefik y nginx no leen igual algunas rutas (por ejemplo `/%2Fapi/...`: Traefik no
la ve como `/api` y nginx sí) y la API no tiene autenticación propia. Excepciones:

- `POST /otlp/v1/traces`: la telemetría del navegador, que nginx manda al Collector. Es una ruta exacta; cualquier variante pide contraseña.
- Grafana (`grafana.localhost`): su `Ingress` tiene prioridad 200, más alta que la de estas reglas (100), y no pasa por ellas (hallazgo 25).

Por HTTP, `IngressRoute tienda-escrituras-http` no procesa la escritura: responde `308` hacia HTTPS (en dev, al puerto 8443). Hacen falta las dos
rutas porque el `Ingress` de la tienda acepta todo bajo `/` y sin contraseña (hallazgo 21). Ese `Ingress` solo escucha en `web` y `websecure`: sin la
anotación `router.entrypoints` Traefik también lo publicaba en el entrypoint `metrics` (9100), donde no hay ruta de escrituras (hallazgo 24).

Las **lecturas** (`GET`, `HEAD`, `OPTIONS`) siguen abiertas y sin límite, por HTTP y por HTTPS: las pruebas de desempeño deben medir el sistema, no el limitador.

Para ver la contraseña (usuario `admin`) y usarla (`tienda-ca.crt` se exporta en la sección siguiente):

```bash
ADMIN_PASS=$(kubectl -n tienda get secret ingress-admin-auth -o jsonpath='{.data.password}' | base64 -d)
curl -s --cacert tienda-ca.crt -u "admin:$ADMIN_PASS" -X POST https://localhost:8443/api/cache/clear
```

El botón «Clear Redis catalog cache» de la página hace un `POST`, así que el navegador pide el usuario y la contraseña. Abre la página por
`https://localhost:8443`: por HTTP las escrituras no se procesan.

Para cambiar la contraseña: `sops credentials/dev/ingress-admin-auth.yaml`, editar `password`, hacer el PR y esperar a Flux.

## TLS con cert-manager

cert-manager (`HelmRelease` en `deploy/platform/operators/cert-manager.yaml`, namespace `cert-manager`) crea y renueva los certificados. Los objetos
de la tienda están en `deploy/base/tls.yaml`, en el namespace `tienda`:

| Objeto | Qué hace |
|---|---|
| `Issuer autofirmado` | Solo firma la CA |
| `Certificate tienda-ca` | La CA propia (10 años, conserva su clave al renovarse). Solo puede firmar `localhost` y 127.0.0.0/8 (restricción de nombres). Su Secret `tienda-ca` guarda la clave y no debe salir del clúster |
| `Issuer tienda-ca` | Firma con esa CA |
| `Certificate tienda-tls` | El certificado de `localhost` (90 días). cert-manager lo renueva solo, 30 días antes de que venza |

`tienda-escrituras` carga el Secret `tienda-tls`. Traefik elige el certificado por el nombre que pide el cliente (SNI), así que las lecturas por
`https://localhost:8443` usan el mismo. Si el Secret faltara, Traefik solo avisa en su log y usa su certificado por defecto: la ruta con contraseña sigue.

Para confiar en la CA, exporta el certificado público (la clave no se toca):

```bash
kubectl -n tienda get secret tienda-ca -o jsonpath='{.data.tls\.crt}' | base64 -d > tienda-ca.crt
curl --cacert tienda-ca.crt https://localhost:8443/        # sin -k
```

En el navegador, importa `tienda-ca.crt` como autoridad en su gestor de certificados (sección «Autoridades»). Sin eso avisa que el sitio no es de confianza.
Se importa una vez por clúster: si se recrea el clúster o se borra el Secret `tienda-ca`, cert-manager crea una CA nueva y hay que importarla otra vez.

Para comprobar la entrada completa (no escribe nada; la contraseña se lee a un archivo temporal y no se imprime):

```bash
bash scripts/verificar-ingress.sh        # lecturas por HTTP y HTTPS, escrituras redirigidas por HTTP y con contraseña por HTTPS, rutas raras y Grafana
```

## Usuarios de las bases de datos

Cada servicio entra con el mínimo que necesita:

| Servicio | MariaDB | MongoDB | Redis |
|---|---|---|---|
| API | `store_api`: solo `SELECT` en `store` | `store-app`: `readWrite` solo en `store_reviews` | sin contraseña (pendiente) |
| Worker | no la usa | `store-app` | no lo usa |
| Job `catalog-init` | `store_app`: todos los permisos sobre `store` (crea las tablas y carga el catálogo) | `store-app` | no lo usa |

La API solo hace `SELECT` en MariaDB (catálogo, comprobar que el producto existe y las sondas), así que `store_api` no puede escribir ni cambiar
tablas aunque alguien lograra ejecutar SQL desde la API. Lo declaran un `User` y un `Grant` del operador (`deploy/platform/data/mariadb.yaml`); la
contraseña (`api-password`) va en el Secret `mariadb-credentials`, cifrado con SOPS. Docker Compose no cambia: sigue con `store_app`.

`store_api` permite 60 conexiones (6 pods de la API, el máximo del HPA, por 10 del pool). El usuario `store_app` que crea el operador solo permite 20,
y con más de 2 pods de la API habría errores de «demasiadas conexiones» durante las pruebas de desempeño.

Comprobar los permisos (la contraseña de root se lee a una variable sin imprimirla):

```bash
ROOT=$(kubectl -n tienda get secret mariadb-credentials -o jsonpath='{.data.root-password}' | base64 -d)
kubectl -n tienda exec mariadb-0 -c mariadb -- env MYSQL_PWD="$ROOT" mariadb -u root -e "SHOW GRANTS FOR store_api@'%'"
```

## Límites conocidos

| Tema | Detalle |
|---|---|
| CA propia | Ningún navegador confía en ella hasta que se importa `tienda-ca.crt` (una vez por clúster). Una CA pública como Let's Encrypt pide un dominio real |
| Clave de la CA | Vive en el Secret `tienda-ca`. La pueden leer los pods con permiso de leer Secrets (MongoDB, Traefik, Grafana, Loki, los operadores y Flux). Por eso la CA solo puede firmar nombres locales |
| Solo `localhost` | El certificado y la CA son para `localhost`. En `prod` (Etapa 6): entrar por un nombre, ponerlo en `dnsNames` de `deploy/base/tls.yaml` y ampliar `permitted` de la CA. Por IP el cliente no manda SNI y Traefik usa su certificado por defecto (haría falta un `TLSStore`) |
| La redirección 308 | Evita que la escritura se procese por HTTP, pero no recupera una contraseña que el cliente ya mandó en esa petición. Escribe siempre `https://` |
| cert-manager en Kubernetes 1.37 | cert-manager 1.21 declara soporte para Kubernetes 1.33 a 1.36 y este clúster es 1.37 (K3s). Está fuera de su tabla oficial |
| Webhook de cert-manager | Los `Issuer` y `Certificate` van en la capa `apps`. Si el webhook de cert-manager (1 réplica) no responde, `apps` no aplica cambios hasta que vuelva (Flux reintenta cada 2 minutos) |
| TLS solo en la entrada | Dentro del clúster (Traefik a la web, API a las bases, AMQP) el tráfico va sin cifrar. El mTLS entre servicios es opcional en el plan y no se hizo |
| Grafana sin el certificado de la tienda | `grafana.localhost` sigue con el certificado por defecto de Traefik y por HTTP |
| Un solo usuario | Todas las escrituras comparten `admin`. No hay usuarios por persona |
| Mongo y Redis sin usuario por servicio | La API y el worker comparten `store-app` en MongoDB; Redis no tiene contraseña |
| `prod` sin Secret | `credentials/prod/` aún no existe (Etapa 6). Crear `ingress-admin-auth` **antes** de desplegar `prod`: por el código de Traefik, si falta el Secret la ruta de escrituras se descarta y caerían en el `Ingress` sin contraseña. No está probado (hallazgo 22) |
| El límite es por IP | En k3d todas las peticiones llegan con la IP de la puerta de enlace de Docker, así que el límite es de todo el tráfico de escritura |
