#!/usr/bin/env bash
# Crea las contraseñas de desarrollo del namespace "tienda" con valores al azar.
# Solo crea las que NO existen (volver a correrlo no cambia contraseñas ya en uso).
# Nunca imprime los valores. No van a git: en prod las reemplaza SOPS (Etapa 2).
# Uso: bash scripts/create-dev-secrets.sh        (clúster: contexto k3d-tienda, o KUBE_CONTEXT=...)
set -euo pipefail

ctx="${KUBE_CONTEXT:-k3d-tienda}"
k() { kubectl --context "$ctx" -n tienda "$@"; }

# mk <secret> <clave>...   -> un Secret con una contraseña al azar por cada clave
mk() {
  local name="$1"; shift
  if k get secret "$name" >/dev/null 2>&1; then echo "ya existe: $name"; return; fi
  local args=() key
  for key in "$@"; do args+=(--from-literal="$key=$(openssl rand -hex 16)"); done
  k create secret generic "$name" "${args[@]}" >/dev/null && echo "creado:    $name"
}

mk mariadb-credentials root-password app-password
mk mongodb-app-password password
