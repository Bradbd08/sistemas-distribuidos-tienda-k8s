#!/usr/bin/env bash
# Instala en ~/.local/bin (sin sudo) las herramientas de línea de comandos del proyecto.
#
# Uso:
#   bash scripts/install-cli-tools.sh            instala lo que falte o esté en otra versión
#   bash scripts/install-cli-tools.sh --check    solo muestra qué hay instalado (código 1 si falta algo)
#
# Funciona en Linux x86_64 y arm64 (Manjaro, Ubuntu dentro de WSL2). Cada descarga se compara
# con la suma SHA-256 que publica el mismo proyecto. Necesita: curl, tar, sha256sum y
# unzip (o python3).
set -euo pipefail

# Versiones probadas (noviembre de 2026). Si las cambias, cambia también REQUIREMENTS.md.
KUBECTL_VERSION="1.37.2"      # debe estar a una versión menor del K3s (v1.37.2+k3s1)
HELM_VERSION="4.3.1"
FLUX_VERSION="2.10.0"
TERRAFORM_VERSION="1.17.1"
KUBECONFORM_VERSION="0.8.0"
K3D_VERSION="5.9.0"           # K3s dentro de Docker, para desarrollar en una sola laptop
SOPS_VERSION="3.13.3"         # cifra los Secrets que van a git
AGE_VERSION="1.3.2"           # claves que usa SOPS
TFLINT_VERSION="0.66.0"       # linter de Terraform

# age no publica un archivo de sumas: estas son las SHA-256 de los .tar.gz de la versión fijada.
AGE_SHA256_AMD64="cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10"
AGE_SHA256_ARM64="6b8dc4333c53a5a57c9e5834e3a48f92605d7154014cd07269ff3327db5d37f4"

BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
MODO="instalar"
[ "${1:-}" = "--check" ] && MODO="revisar"

[ "$(uname -s)" = "Linux" ] || { echo "Este script es para Linux. En Windows úsalo dentro de WSL2." >&2; exit 1; }
case "$(uname -m)" in
  x86_64 | amd64) ARCH=amd64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) echo "Arquitectura no soportada: $(uname -m)" >&2; exit 1 ;;
esac

# Cada descarga va a su propia carpeta temporal, que se borra al terminar.
TEMPORALES=()
limpiar() { if [ "${#TEMPORALES[@]}" -gt 0 ]; then rm -rf "${TEMPORALES[@]}"; fi; }
trap limpiar EXIT
nueva_carpeta() { T="$(mktemp -d)"; TEMPORALES+=("$T"); }

bajar() { curl -fsSL --retry 3 --connect-timeout 15 --max-time 600 -o "$2" "$1"; }

# suma_de <archivo de sumas> <nombre>: imprime la suma del archivo con ese nombre.
# Ignora el "*" del modo binario y una carpeta delante del nombre (k3d usa "_dist/k3d-linux-amd64").
suma_de() {
  awk -v n="$2" '{ f = $2; sub(/^\*/, "", f); sub(/^.*\//, "", f); if (f == n) { print $1; exit } }' "$1"
}

# verificar <archivo> <suma esperada>
verificar() {
  local real
  if [ -z "$2" ]; then
    echo "ERROR: no encontré la suma SHA-256 de $(basename "$1") en el archivo de sumas." >&2
    exit 1
  fi
  real="$(sha256sum "$1" | cut -d' ' -f1)"
  if [ "$real" != "$2" ]; then
    echo "ERROR: la suma SHA-256 de $(basename "$1") no coincide." >&2
    echo "  esperada: $2" >&2
    echo "  real:     $real" >&2
    exit 1
  fi
}

# descomprimir_zip <zip> <archivo dentro> <carpeta destino>
descomprimir_zip() {
  if command -v unzip > /dev/null 2>&1; then
    unzip -q -o "$1" "$2" -d "$3"
  else
    python3 -I -m zipfile -e "$1" "$3"
  fi
}

# version_de <herramienta>: imprime la versión instalada en BIN_DIR, o nada.
version_de() {
  case "$1" in
    kubectl)     "$BIN_DIR/kubectl" version --client 2> /dev/null | sed -n 's/^Client Version: v//p' ;;
    helm)        "$BIN_DIR/helm" version --template '{{.Version}}' 2> /dev/null | sed 's/^v//; s/+.*$//' ;;
    flux)        "$BIN_DIR/flux" --version 2> /dev/null | awk '{print $NF}' ;;
    terraform)   "$BIN_DIR/terraform" version 2> /dev/null | sed -n '1s/^Terraform v//p' ;;
    kubeconform) "$BIN_DIR/kubeconform" -v 2> /dev/null | sed 's/^v//' ;;
    k3d)         "$BIN_DIR/k3d" version 2> /dev/null | sed -n '1s/^k3d version v//p' ;;
    sops)        "$BIN_DIR/sops" --version 2> /dev/null | sed -n '1s/^sops \([0-9.]*\).*/\1/p' ;;
    age)         "$BIN_DIR/age" --version 2> /dev/null | sed 's/^v//' ;;
    tflint)      "$BIN_DIR/tflint" --version 2> /dev/null | sed -n '1s/^TFLint version //p' ;;
  esac
}

instalar_kubectl() {
  nueva_carpeta
  local base="https://dl.k8s.io/release/v$KUBECTL_VERSION/bin/linux/$ARCH"
  bajar "$base/kubectl" "$T/kubectl"
  bajar "$base/kubectl.sha256" "$T/kubectl.sha256"
  verificar "$T/kubectl" "$(cut -d' ' -f1 "$T/kubectl.sha256")"
  install -m 0755 "$T/kubectl" "$BIN_DIR/kubectl"
}

instalar_helm() {
  nueva_carpeta
  local archivo="helm-v$HELM_VERSION-linux-$ARCH.tar.gz"
  bajar "https://get.helm.sh/$archivo" "$T/$archivo"
  bajar "https://get.helm.sh/$archivo.sha256sum" "$T/sumas"
  verificar "$T/$archivo" "$(suma_de "$T/sumas" "$archivo")"
  tar -xzf "$T/$archivo" -C "$T"
  install -m 0755 "$T/linux-$ARCH/helm" "$BIN_DIR/helm"
}

instalar_flux() {
  nueva_carpeta
  local archivo="flux_${FLUX_VERSION}_linux_${ARCH}.tar.gz"
  local base="https://github.com/fluxcd/flux2/releases/download/v$FLUX_VERSION"
  bajar "$base/$archivo" "$T/$archivo"
  bajar "$base/flux_${FLUX_VERSION}_checksums.txt" "$T/sumas"
  verificar "$T/$archivo" "$(suma_de "$T/sumas" "$archivo")"
  tar -xzf "$T/$archivo" -C "$T" flux
  install -m 0755 "$T/flux" "$BIN_DIR/flux"
}

instalar_terraform() {
  nueva_carpeta
  local archivo="terraform_${TERRAFORM_VERSION}_linux_${ARCH}.zip"
  local base="https://releases.hashicorp.com/terraform/$TERRAFORM_VERSION"
  bajar "$base/$archivo" "$T/$archivo"
  bajar "$base/terraform_${TERRAFORM_VERSION}_SHA256SUMS" "$T/sumas"
  verificar "$T/$archivo" "$(suma_de "$T/sumas" "$archivo")"
  descomprimir_zip "$T/$archivo" terraform "$T"
  install -m 0755 "$T/terraform" "$BIN_DIR/terraform"
}

instalar_kubeconform() {
  nueva_carpeta
  local archivo="kubeconform-linux-$ARCH.tar.gz"
  local base="https://github.com/yannh/kubeconform/releases/download/v$KUBECONFORM_VERSION"
  bajar "$base/$archivo" "$T/$archivo"
  bajar "$base/CHECKSUMS" "$T/sumas"
  verificar "$T/$archivo" "$(suma_de "$T/sumas" "$archivo")"
  tar -xzf "$T/$archivo" -C "$T" kubeconform
  install -m 0755 "$T/kubeconform" "$BIN_DIR/kubeconform"
}

instalar_k3d() {
  nueva_carpeta
  local base="https://github.com/k3d-io/k3d/releases/download/v$K3D_VERSION"
  bajar "$base/k3d-linux-$ARCH" "$T/k3d-linux-$ARCH"
  bajar "$base/checksums.txt" "$T/sumas"
  verificar "$T/k3d-linux-$ARCH" "$(suma_de "$T/sumas" "k3d-linux-$ARCH")"
  install -m 0755 "$T/k3d-linux-$ARCH" "$BIN_DIR/k3d"
}

instalar_sops() {
  nueva_carpeta
  local archivo="sops-v${SOPS_VERSION}.linux.${ARCH}"
  local base="https://github.com/getsops/sops/releases/download/v$SOPS_VERSION"
  bajar "$base/$archivo" "$T/$archivo"
  bajar "$base/sops-v${SOPS_VERSION}.checksums.txt" "$T/sumas"
  verificar "$T/$archivo" "$(suma_de "$T/sumas" "$archivo")"
  install -m 0755 "$T/$archivo" "$BIN_DIR/sops"
}

instalar_age() {
  nueva_carpeta
  local archivo="age-v${AGE_VERSION}-linux-${ARCH}.tar.gz" esperada
  case "$ARCH" in
    amd64) esperada="$AGE_SHA256_AMD64" ;;
    arm64) esperada="$AGE_SHA256_ARM64" ;;
  esac
  bajar "https://github.com/FiloSottile/age/releases/download/v$AGE_VERSION/$archivo" "$T/$archivo"
  verificar "$T/$archivo" "$esperada"
  tar -xzf "$T/$archivo" -C "$T" age/age age/age-keygen
  install -m 0755 "$T/age/age" "$BIN_DIR/age"
  install -m 0755 "$T/age/age-keygen" "$BIN_DIR/age-keygen"
}

instalar_tflint() {
  nueva_carpeta
  local archivo="tflint_linux_${ARCH}.zip"
  local base="https://github.com/terraform-linters/tflint/releases/download/v$TFLINT_VERSION"
  bajar "$base/$archivo" "$T/$archivo"
  bajar "$base/checksums.txt" "$T/sumas"
  verificar "$T/$archivo" "$(suma_de "$T/sumas" "$archivo")"
  descomprimir_zip "$T/$archivo" tflint "$T"
  install -m 0755 "$T/tflint" "$BIN_DIR/tflint"
}

FALTAN=0

# procesar <herramienta> <versión esperada> <función instaladora>
procesar() {
  local nombre="$1" esperada="$2" funcion="$3" actual
  actual="$(version_de "$nombre" || true)"
  if [ "$actual" = "$esperada" ]; then
    printf '  %-12s %-8s ya instalado\n' "$nombre" "$esperada"
    return 0
  fi
  if [ "$MODO" = "revisar" ]; then
    printf '  %-12s %-8s FALTA (hay: %s)\n' "$nombre" "$esperada" "${actual:-nada}"
    FALTAN=$((FALTAN + 1))
    return 0
  fi
  printf '  %-12s %-8s instalando (antes: %s)...\n' "$nombre" "$esperada" "${actual:-nada}"
  "$funcion"
  actual="$(version_de "$nombre" || true)"
  if [ "$actual" != "$esperada" ]; then
    echo "ERROR: después de instalar, $nombre dice '$actual' y esperaba '$esperada'." >&2
    exit 1
  fi
}

mkdir -p "$BIN_DIR"
echo "Herramientas en $BIN_DIR ($MODO):"
procesar kubectl "$KUBECTL_VERSION" instalar_kubectl
procesar helm "$HELM_VERSION" instalar_helm
procesar flux "$FLUX_VERSION" instalar_flux
procesar terraform "$TERRAFORM_VERSION" instalar_terraform
procesar kubeconform "$KUBECONFORM_VERSION" instalar_kubeconform
procesar k3d "$K3D_VERSION" instalar_k3d
procesar sops "$SOPS_VERSION" instalar_sops
procesar age "$AGE_VERSION" instalar_age
procesar tflint "$TFLINT_VERSION" instalar_tflint

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    echo
    echo "AVISO: $BIN_DIR no está en tu PATH. Agrega esta línea a ~/.bashrc o ~/.zshrc:"
    echo "  export PATH=\"$BIN_DIR:\$PATH\""
    ;;
esac

if [ "$MODO" = "revisar" ] && [ "$FALTAN" -gt 0 ]; then
  exit 1
fi
