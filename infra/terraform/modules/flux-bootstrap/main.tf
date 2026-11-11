# Arranca Flux en el clúster y lo conecta al repositorio por SSH con una llave de despliegue propia
# de este entorno. Terraform solo instala Flux: lo que se despliega lo decide Git (clusters/<entorno>/).
#
# La llave privada vive en el estado de Terraform (Secret del clúster, ver backend.tf) y en el Secret
# flux-system/flux-system. Nunca se escribe en disco ni en el repositorio.
resource "tls_private_key" "flux" {
  algorithm   = "ECDSA"
  ecdsa_curve = "P256"
}

# Con escritura: Flux guarda en Git sus manifiestos y las etiquetas de imagen que actualiza.
resource "github_repository_deploy_key" "flux" {
  title      = "flux-${var.environment}"
  repository = var.github_repository
  key        = tls_private_key.flux.public_key_openssh
  read_only  = false
}

resource "flux_bootstrap_git" "this" {
  depends_on = [github_repository_deploy_key.flux]

  # Los manifiestos vienen dentro del provider: no se descargan de GitHub al arrancar.
  embedded_manifests = true
  path               = var.cluster_path
  components_extra   = var.components_extra
  interval           = "1m0s"

  # Destruir este recurso desinstalaría Flux del clúster. Para hacerlo a propósito, quita esta línea primero.
  lifecycle {
    prevent_destroy = true
  }
}
