# Hallazgos y problemas

Cada fila es algo que falló o no era como se esperaba, con su causa real y cómo se resolvió.

| # | Qué pasó | Causa | Solución |
|---|---|---|---|
| 1 | El plan nombra al "MongoDB Community Operator" | Ese repositorio está archivado desde noviembre de 2025 | Se usa su sucesor MCK 1.15.0, que trae el mismo recurso `MongoDBCommunity` |
| 2 | nginx no generaba su configuración con el sistema de archivos de solo lectura | El entrypoint escribe `/etc/nginx/conf.d` y nginx usa `/tmp` | `emptyDir` en esas dos rutas |
| 3 | Trivy marcó vulnerabilidades altas y críticas corregibles en las dos imágenes | Paquetes de Alpine desactualizados (web) y dependencias empaquetadas de `npm` (API) | `apk upgrade` en `web`; en la API se quita `npm`, que no se usa en ejecución |
| 4 | Los pods corrían la imagen **vieja** aunque se había reconstruido | Etiqueta mutable `dev` con `IfNotPresent`: el nodo reutiliza su copia | `imagePullPolicy: Always`. Se detectó comparando el digest del pod con el del registro |
| 5 | Tras reiniciar la laptop, el clúster k3d no volvía (`ServiceUnavailable`) | Docker reasignó las IP de `server-1` y `server-2`; etcd las buscaba en las direcciones viejas y no formó quórum. A los 15 min `k3s` se apagó solo | Detener esos dos nodos y arrancarlos en orden para recuperar sus IP. No se borró nada |
| 6 | MongoDB no quedaba listo tras el reinicio | La sonda de disponibilidad del agente lee un Secret de la API de Kubernetes y mi NetworkPolicy no lo permitía. Como el StatefulSet arranca en orden, los miembros 1 y 2 ni se creaban | Permitir salida a la API (443 y 6443) en la política de `mongodb` |
| 7 | Tras reiniciar, Galera mostraba `recovery status not completed` | Se apagaron los 3 nodos a la vez | El operador ejecutó su recuperación y eligió el nodo más avanzado. Las reseñas se conservaron |
| 8 | Redis perdía el master cada vez que Flux aplicaba el CR | Flux agrega a cada objeto las etiquetas `kustomize.toolkit.fluxcd.io/*` y el operador de Redis las copia al `selector`, que es inmutable. Con el CR ya creado, el operador no podía actualizar el StatefulSet de Sentinel | Anotación `kustomize.toolkit.fluxcd.io/ssa: IfNotPresent` en el CR: Flux lo crea desde Git pero no lo vuelve a aplicar |
| 9 | `cidrcontains` no existe en Terraform 1.17 | — | Se calcula con `cidrhost("<ip>/<prefijo>", 0)` y se prueba con `terraform test` |
| 10 | El merge de un pull request a `main` fue bloqueado | Unir sin revisión humana requiere permiso del usuario | El usuario autorizó a unir mis propios PRs cuando el CI esté en verde |
| 11 | El `otel-agent` quedó en `CrashLoopBackOff` y Flux mantuvo suspendidas `apps` y `network-policies` | Los pipelines de logs y metrics del chart usan los receivers `otlp` y `prometheus`; al ponerlos en `null` el colector falla con `references receiver "otlp" which is not configured` | No anular receivers. Se comprueba antes del PR con `helm template` y `otelcol validate` |
| 12 | Los tableros de la API salían en «Sin datos» aunque Mimir tenía los datos | El datasource Mimir declaraba `timeInterval: 15s`, pero las métricas OTLP llegan cada 60 s: `$__rate_interval` quedaba en 1 min y cada `rate()` caía sobre una sola muestra. Las consultas probadas a mano con `[5m]` sí devolvían datos | `timeInterval: 60s` en el datasource. Se probó con un Grafana local y el provisioning real, contando los valores de cada panel |
| 13 | El operador de RabbitMQ más reciente no arrancaría | Desde la v2.22.0 trae webhooks con `failurePolicy: Fail` que dependen de cert-manager, y el clúster no lo tiene. Tampoco hay chart oficial, y las imágenes del chart de Bitnami ya no existen | Se fija la v2.21.1 (la última sin cert-manager) copiando su manifiesto al repo, con su suma SHA-256 en el encabezado. Se sube de versión cuando llegue cert-manager |
| 14 | Trivy marcó el manifiesto del operador de RabbitMQ (KSV-0014, 0041, 0053 y 0056) | Es el manifiesto de terceros: el operador necesita permisos sobre Secrets, Services y `pods/exec` para administrar los clústeres | `skip-files` solo para ese archivo en `ci.yml`; el resto de `deploy/` sigue escaneado |
| 15 | Las métricas de RabbitMQ no llegaban a Mimir aunque los pods tenían anotaciones `prometheus.io/*` | El preset `annotationDiscovery` del agente usa el descubrimiento por hints del `receiver_creator`, que lee anotaciones `io.opentelemetry.discovery.metrics.<puerto>/...`. El comentario de `otel-agent.yaml` decía lo contrario | Anotaciones del formato correcto, solo para el puerto 15692, con `scraper: prometheus`. Se probó a mano en un pod: 240 series en Mimir en menos de un minuto |

## Qué demostraron los incidentes

- **Los datos sobreviven a un reinicio completo** del clúster (5 a 7): las reseñas de MongoDB y el catálogo de MariaDB se conservaron.
- Las **NetworkPolicies de denegar todo** necesitan probarse reiniciando los pods, no solo mirando que los actuales sigan listos (6).
- Con **GitOps** hay que probar qué hace Flux sobre objetos que ya existían (8) y no suponer que adopta sin cambios.
- Un tablero se prueba **dentro de Grafana**, no solo con PromQL a mano: `$__rate_interval` depende del datasource y una consulta que funciona con `[5m]` puede salir vacía en el panel (12).
