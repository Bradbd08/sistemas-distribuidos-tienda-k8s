# Versión fija (no "22-alpine") para que el build sea reproducible.
FROM node:22.23.4-alpine

WORKDIR /app

# pnpm en lugar de npm. La versión queda fija para que el build sea siempre igual.
RUN corepack enable && corepack prepare pnpm@12.18.0 --activate

# Primero solo los archivos de dependencias, para aprovechar la caché de Docker.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY index.js init-db.js ./

USER node

EXPOSE 8080

# "node" directo (sin npm) para que la app reciba SIGTERM y cierre bien.
CMD ["node", "index.js"]
