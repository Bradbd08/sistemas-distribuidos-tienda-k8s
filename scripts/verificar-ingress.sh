#!/usr/bin/env bash
# Comprueba la entrada de la tienda (Traefik): las lecturas funcionan por HTTP y HTTPS, las escrituras de la API no se
# procesan por HTTP y por HTTPS piden contraseña. No escribe nada: las escrituras llevan un cuerpo inválido y la API
# responde 400 sin guardar. Termina con código 1 si algo falla.
# Uso: bash scripts/verificar-ingress.sh [URL_HTTP] [URL_HTTPS]   (por defecto, el clúster k3d de desarrollo)
set -euo pipefail
umask 077

http="${1:-http://localhost:8081}"
https="${2:-https://localhost:8443}"
ctx="${KUBE_CONTEXT:-k3d-tienda}"
ruta="/api/products/ZZ-000/reviews" # un SKU que no existe y un cuerpo inválido: no se guarda nada
json=(-H 'content-type: application/json' -d '{}')

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
# Del clúster salen solo el certificado público de la CA y la contraseña; van a archivos privados y no se imprimen.
kubectl --context "$ctx" -n tienda get secret tienda-ca -o jsonpath='{.data.tls\.crt}' | base64 -d > "$tmp/ca.crt"
printf 'user = "admin:%s"\n' "$(kubectl --context "$ctx" -n tienda get secret ingress-admin-auth -o jsonpath='{.data.password}' | base64 -d)" > "$tmp/auth"

fallos=0
# comprobar <formato de curl -w> <valor esperado> <qué se prueba> <argumentos de curl...>
comprobar() {
  local formato="$1" esperado="$2" nombre="$3" valor
  shift 3
  valor="$(curl -s -o /dev/null -w "$formato" --max-time 10 "$@" || true)"
  if [ "$valor" = "$esperado" ]; then
    echo "ok     $nombre ($valor)"
  else
    echo "FALLA  $nombre: se esperaba $esperado y llegó $valor"
    fallos=$((fallos + 1))
  fi
}

codigo='%{http_code}'
comprobar "$codigo" 200 "lectura por HTTP" "$http/"
comprobar "$codigo" 200 "lectura por HTTPS con la CA de la tienda" --cacert "$tmp/ca.crt" "$https/"
comprobar "$codigo" 308 "escritura por HTTP: se redirige, no se procesa" -X POST "${json[@]}" "$http$ruta"
comprobar '%{redirect_url}' "$https$ruta" "la redirección apunta al HTTPS" -X POST "${json[@]}" "$http$ruta"
comprobar "$codigo" 401 "escritura por HTTPS sin contraseña" --cacert "$tmp/ca.crt" -X POST "${json[@]}" "$https$ruta"
comprobar "$codigo" 401 "escritura por HTTPS con // en la ruta" --cacert "$tmp/ca.crt" -X POST "${json[@]}" "$https/$ruta"
comprobar "$codigo" 400 "escritura por HTTPS con contraseña llega a la API" --cacert "$tmp/ca.crt" -K "$tmp/auth" -X POST "${json[@]}" "$https$ruta"

if [ "$fallos" -eq 0 ]; then
  echo "Todo bien."
else
  echo "$fallos comprobaciones fallaron."
  exit 1
fi
