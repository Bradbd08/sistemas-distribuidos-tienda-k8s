# 05. Seguridad y endurecimiento (fase 7) — EN CURSO

Se hace primero lo barato y de poco riesgo. Wazuh va al final y en versión mínima (es lo que más RAM pide).

## Estado

| Medida (fase 7) | Estado |
|---|---|
| Pod Security Admission en `tienda` | Hecha: `baseline` obligatorio, `restricted` en aviso |
| Contenedores sin root, sistema de archivos de solo lectura | Hecha en web, API y worker (cumplen `restricted`). RabbitMQ y MongoDB también |
| Autenticación y límite de frecuencia en el ingress | Hecha para las escrituras de la API |
| Usuarios de base de datos con mínimo privilegio | MongoDB ya lo cumple. MariaDB y Redis: pendiente |
| TLS con cert-manager | Pendiente |
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

Las **escrituras** de la API (`POST`, `PUT`, `PATCH` y `DELETE` bajo `/api`) pasan por una ruta de Traefik (`IngressRoute tienda-escrituras`,
en `deploy/base/ingress.yaml`) con dos middlewares, en este orden:

1. `limite-escrituras`: 20 peticiones por segundo por IP, con ráfaga de 40. Va antes de la contraseña para frenar los intentos a ciegas.
2. `auth-admin`: usuario y contraseña (`basicAuth`) del Secret `ingress-admin-auth`, cifrado con SOPS en `credentials/dev/`.

Las **lecturas** (`GET`, `HEAD`, `OPTIONS`) siguen abiertas y sin límite: las pruebas de desempeño deben medir el sistema, no el limitador.

Para ver la contraseña (usuario `admin`):

```bash
ADMIN_PASS=$(kubectl -n tienda get secret ingress-admin-auth -o jsonpath='{.data.password}' | base64 -d)
curl -s -u "admin:$ADMIN_PASS" -X POST http://localhost:8081/api/cache/clear
```

El botón «Clear Redis catalog cache» de la página hace un `POST`, así que el navegador pide el usuario y la contraseña.

Para cambiar la contraseña: `sops credentials/dev/ingress-admin-auth.yaml`, editar `password`, hacer el PR y esperar a Flux.

## Límites conocidos

| Tema | Detalle |
|---|---|
| Sin TLS | La contraseña viaja sin cifrar dentro de la red local hasta que llegue cert-manager |
| Un solo usuario | Todas las escrituras comparten `admin`. No hay usuarios por persona |
| `prod` sin Secret | `credentials/prod/` aún no existe (Etapa 6): sin el Secret `ingress-admin-auth` las escrituras de `prod` no pasan |
| El límite es por IP | En k3d todas las peticiones llegan con la IP de la puerta de enlace de Docker, así que el límite es de todo el tráfico de escritura |
