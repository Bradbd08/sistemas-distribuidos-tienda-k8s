# Versión fija (no "22-alpine") para que el build sea reproducible. Mismo patrón que application/Dockerfile.
FROM node:22.23.4-alpine

WORKDIR /app

# pnpm en lugar de npm. La versión queda fija para que el build sea siempre igual.
RUN corepack enable && corepack prepare pnpm@12.18.0 --activate

# Primero solo los archivos de dependencias, para aprovechar la caché de Docker.
# pnpm-workspace.yaml lleva la decisión sobre los scripts de instalación (allowBuilds).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

# npm no se usa (instalamos con pnpm y arrancamos con "node"). Quitarlo elimina sus dependencias
# empaquetadas, que son las que Trivy marcaba, y reduce la superficie de ataque.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY index.js handlers.mjs topology.mjs telemetry.mjs ./

USER node

# Puerto de las sondas de Kubernetes (/healthz y /readyz). El worker no recibe tráfico de nadie más.
EXPOSE 8081

# "node" directo (sin npm) para que el worker reciba SIGTERM y cierre bien.
CMD ["node", "index.js"]
