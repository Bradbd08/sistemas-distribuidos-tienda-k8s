# Estado remoto con bloqueo en el clúster REAL: Secret tfstate-default-prod con un Lease como candado.
# Ese clúster debe existir antes de `terraform init` (se instala con ../prod-nodes).
# Los bloques backend no admiten variables, por eso los valores van fijos.
terraform {
  backend "kubernetes" {
    secret_suffix  = "prod"
    namespace      = "kube-system"
    config_path    = "~/.kube/config-real"
    config_context = "default"
  }
}
