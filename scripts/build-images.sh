#!/usr/bin/env bash
# Construye las imágenes web, API y worker y las sube al registro del clúster k3d (localhost:5000).
# Dentro del clúster se llaman tienda-registry:5000/tienda-web, tienda-registry:5000/tienda-api
# y tienda-registry:5000/tienda-worker.
# Uso: bash scripts/build-images.sh [etiqueta]      (por defecto: dev)
set -euo pipefail
cd "$(dirname "$0")/.."

tag="${1:-dev}"
registry="${REGISTRY:-localhost:5000}"

for pair in web:web application:api worker:worker; do
  dir="${pair%%:*}"
  image="$registry/tienda-${pair##*:}:$tag"
  docker build -t "$image" "$dir"
  docker push "$image"
  echo "OK $image  $(docker inspect --format '{{index .RepoDigests 0}}' "$image")"
done
