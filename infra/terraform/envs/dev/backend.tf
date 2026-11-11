# Estado remoto con bloqueo: un Secret (tfstate-default-dev) en el propio clúster, con un Lease como candado.
# Contiene la llave privada de Flux: solo quien tenga acceso al clúster puede leerlo.
# Los bloques backend no admiten variables, por eso los valores van fijos.
# Si el clúster se borra, el estado se pierde con él: en dev basta con volver a arrancar Flux.
terraform {
  backend "kubernetes" {
    secret_suffix  = "dev"
    namespace      = "kube-system"
    config_path    = "~/.kube/config"
    config_context = "k3d-tienda"
  }
}
