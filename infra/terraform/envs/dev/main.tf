# Entorno de desarrollo: el clúster k3d "tienda" (se crea con k3d, ver REQUIREMENTS.md sección 5).
# Terraform arranca Flux en él y crea la StorageClass que conserva los volúmenes.
#
# Uso:  GITHUB_TOKEN="$(gh auth token)" terraform -chdir=infra/terraform/envs/dev apply
# (el token solo se usa para registrar la llave de despliegue en GitHub; no se guarda).

provider "github" {
  owner = var.github_owner
}

provider "kubernetes" {
  config_path    = pathexpand(var.kube_config_path)
  config_context = var.kube_context
}

provider "flux" {
  kubernetes = {
    config_path    = pathexpand(var.kube_config_path)
    config_context = var.kube_context
  }
  git = {
    url    = "ssh://git@github.com/${var.github_owner}/${var.github_repository}.git"
    branch = var.branch
    ssh = {
      username    = "git"
      private_key = module.flux.private_key_pem
    }
  }
}

module "flux" {
  source = "../../modules/flux-bootstrap"

  github_repository = var.github_repository
  environment       = "dev"
  cluster_path      = "clusters/dev"
}

module "storage" {
  source = "../../modules/storage"
}
