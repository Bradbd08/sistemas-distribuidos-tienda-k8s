# Paso previo del clúster real: valida el plan de direcciones y genera un script de instalación por laptop.
# Es una raíz aparte (con estado local) porque el estado de ../prod vive DENTRO del clúster que estos
# scripts instalan: antes de instalarlo no hay dónde guardarlo.
#
# Uso (después de instalar Tailscale en las dos laptops y copiar terraform.tfvars.example a terraform.tfvars):
#   terraform -chdir=infra/terraform/envs/prod-nodes init && terraform -chdir=infra/terraform/envs/prod-nodes apply
# Salida: infra/terraform/envs/prod-nodes/generated/install-<laptop>.sh (no va a git).
module "network" {
  source = "../../modules/network"

  nodes = var.nodes
}

module "k3s_nodes" {
  source = "../../modules/k3s-nodes"

  nodes        = module.network.nodes
  first_server = module.network.first_server
  server_ip    = module.network.server_ip
  common_flags = module.network.common_flags
  server_flags = module.network.server_flags
  k3s_version  = var.k3s_version
  output_dir   = "${path.root}/generated"
}
