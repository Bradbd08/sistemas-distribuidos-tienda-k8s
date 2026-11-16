#!/usr/bin/env bash
# Comprueba la entrada de la tienda (Traefik): las lecturas funcionan por HTTP y HTTPS, las escrituras no se procesan por
# HTTP y por HTTPS piden contraseña, también con rutas raras que Traefik y nginx leen distinto. No escribe nada: las
# escrituras llevan un cuerpo inválido y la API responde 400 sin guardar. Termina con código 1 si algo falla.
# Uso: [KUBE_CONTEXT=contexto] bash scripts/verificar-ingress.sh [URL_HTTP] [URL_HTTPS]   (por defecto, el k3d de desarrollo)
# En la Etapa 6 usa en las URLs un nombre que esté en el certificado (dnsNames de deploy/base/tls.yaml).
set -euo pipefail
umask 077

http="${1:-http://localhost:8081}"
https="${2:-https://localhost:8443}"
ctx="${KUBE_CONTEXT:-k3d-tienda}"
ruta="/api/products/ZZ-000/reviews" # un SKU que no existe y un cuerpo inválido: no se guarda nada
json=(-H 'content-type: application/json' -d '{}')

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# leer <Secret> <llave>: imprime el dato decodificado. Si falta, dice cuál y termina (no sigue con un valor vacío).
leer() {
  local valor
  valor="$(kubectl --context "$ctx" -n tienda get secret "$1" -o "jsonpath={.data.$2}" 2>/dev/null | base64 -d)" || valor=""
  if [ -z "$valor" ]; then
    echo "Falta el dato $2 del Secret $1 (contexto $ctx)" >&2
    exit 1
  fi
  printf '%s' "$valor"
}

# Del clúster salen solo el certificado público de la CA y la contraseña; van a archivos privados y no se imprimen.
leer tienda-ca 'tls\.crt' > "$tmp/ca.crt"
pass="$(leer ingress-admin-auth password)"
printf 'user = "admin:%s"\n' "$pass" > "$tmp/auth"
unset pass
ca=(--cacert "$tmp/ca.crt")

fallos=0
# comprobar <formato de curl -w> <valor esperado> <qué se prueba> <argumentos de curl...>
comprobar() {
  local formato="$1" esperado="$2" nombre="$3" valor
  shift 3
  valor="$(curl -sS -o /dev/null -w "$formato" --max-time 10 "$@" || true)"
  if [ "$valor" = "$esperado" ]; then
    echo "ok     $nombre ($valor)"
  else
    echo "FALLA  $nombre: se esperaba '$esperado' y llegó '$valor'"
    fallos=$((fallos + 1))
  fi
}

codigo='%{http_code}'
comprobar "$codigo" 200 "lectura por HTTP" "$http/"
comprobar "$codigo" 200 "lectura por HTTPS con la CA de la tienda" "${ca[@]}" "$https/"
comprobar "$codigo" 308 "escritura por HTTP: se redirige, no se procesa" -X POST "${json[@]}" "$http$ruta"
comprobar '%{redirect_url}' "$https$ruta" "la redirección apunta al HTTPS" -X POST "${json[@]}" "$http$ruta"
comprobar "$codigo" 401 "escritura por HTTPS sin contraseña" "${ca[@]}" -X POST "${json[@]}" "$https$ruta"
comprobar "$codigo" 400 "escritura por HTTPS con contraseña llega a la API" "${ca[@]}" -K "$tmp/auth" -X POST "${json[@]}" "$https$ruta"

# Rutas que Traefik y nginx leen distinto: ninguna debe llegar a la API sin contraseña (hallazgos 21 y 23).
for variante in "//api/products/ZZ-000/reviews" "/./api/products/ZZ-000/reviews" "/%61pi/products/ZZ-000/reviews" \
  "/%2Fapi/products/ZZ-000/reviews" "/otlp/..%2Fapi/products/ZZ-000/reviews"; do
  comprobar "$codigo" 401 "HTTPS sin contraseña, ruta $variante" "${ca[@]}" --path-as-is -X POST "${json[@]}" "$https$variante"
  comprobar "$codigo" 308 "HTTP, ruta $variante, se redirige" --path-as-is -X POST "${json[@]}" "$http$variante"
done

# Grafana comparte los puertos de la entrada: sus POST no deben pedir la contraseña de la tienda (hallazgo 25).
comprobar '%header{www-authenticate}' '' "Grafana no pasa por la contraseña de la tienda" -X POST -H 'Host: grafana.localhost' "${json[@]}" "$http/api/ds/query"

if [ "$fallos" -eq 0 ]; then
  echo "Todo bien."
else
  echo "$fallos comprobaciones fallaron."
  exit 1
fi
