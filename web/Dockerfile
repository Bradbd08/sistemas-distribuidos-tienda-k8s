FROM nginxinc/nginx-unprivileged:1.31-alpine

# El entrypoint de la imagen procesa esta plantilla con envsubst al arrancar (solo las variables
# que cumplen NGINX_ENVSUBST_FILTER) y escribe /etc/nginx/conf.d/default.conf.
COPY templates/default.conf.template /etc/nginx/templates/default.conf.template

# Un solo index.html para todos los pods: el marcador __WEB_NODE__ se reemplaza por el nombre del pod.
COPY site/index.html catalog.js catalog.css /usr/share/nginx/html/

# Dónde está la API. En Kubernetes es el Service "api" del mismo namespace.
ENV API_UPSTREAM=api:8080 \
    NGINX_ENVSUBST_FILTER=^API_

# La imagen base corre como el usuario 101 (sin root) y escucha en 8080.
EXPOSE 8080
