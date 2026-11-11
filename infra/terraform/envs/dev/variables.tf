variable "github_owner" {
  description = "Dueño del repositorio de GitHub."
  type        = string
  default     = "Bradbd08"
}

variable "github_repository" {
  description = "Nombre del repositorio de GitHub (sin el dueño)."
  type        = string
  default     = "sistemas-distribuidos-tienda-k8s"
}

variable "branch" {
  description = "Rama que sigue Flux en dev."
  type        = string
  default     = "main"
}

variable "kube_config_path" {
  description = "Archivo kubeconfig del clúster de desarrollo (k3d)."
  type        = string
  default     = "~/.kube/config"
}

variable "kube_context" {
  description = "Contexto del kubeconfig que corresponde al clúster k3d."
  type        = string
  default     = "k3d-tienda"
}
