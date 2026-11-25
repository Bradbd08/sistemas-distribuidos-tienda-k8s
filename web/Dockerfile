# Etapa 1: empaqueta el SDK de OpenTelemetry para el navegador (src/telemetry.js) en un solo archivo.
FROM node:22.23.4-alpine AS navegador
WORKDIR /build
RUN corepack enable && corepack prepare pnpm@12.18.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY src ./src
RUN pnpm run build

# Etapa 2: nginx sin root con el módulo OpenTelemetry (la variante "-otel" de la imagen).
FROM nginxinc/nginx-unprivileged:1.31-alpine-otel

# Actualiza los paquetes de Alpine con parches publicados después de la imagen base (Trivy los marca) y carga
# el módulo de OpenTelemetry: la imagen lo trae pero no lo activa. La imagen vuelve a correr sin root después.
USER root
RUN apk upgrade --no-cache \
 && sed -i '1i load_module modules/ngx_otel_module.so;' /etc/nginx/nginx.conf
USER 101

# El entrypoint de la imagen procesa esta plantilla con envsubst al arrancar (solo las variables
# que cumplen NGINX_ENVSUBST_FILTER) y escribe /etc/nginx/conf.d/default.conf.
COPY templates/default.conf.template /etc/nginx/templates/default.conf.template

# Un solo index.html para todos los pods: el marcador __WEB_NODE__ se reemplaza por el nombre del pod.
COPY site/index.html catalog.js catalog.css /usr/share/nginx/html/
COPY --from=navegador /build/dist/telemetry.js /usr/share/nginx/html/telemetry.js

# API_UPSTREAM: dónde está la API (en Kubernetes, el Service "api").
# OTEL_EXPORTER_ENDPOINT / OTEL_COLLECTOR_HTTP: el gateway del Collector (gRPC para nginx, HTTP para las trazas del navegador).
ENV API_UPSTREAM=api:8080 \
    OTEL_EXPORTER_ENDPOINT=otel-gateway.observability:4317 \
    OTEL_COLLECTOR_HTTP=otel-gateway.observability:4318 \
    NGINX_ENVSUBST_FILTER="^(API|OTEL)_"

# La imagen base corre como el usuario 101 (sin root) y escucha en 8080.
EXPOSE 8080
