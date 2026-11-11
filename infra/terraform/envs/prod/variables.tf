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
  description = "Rama que sigue Flux en prod. Es la puerta de promoción: solo llega código aprobado por pull request."
  type        = string
  default     = "release"
}

variable "kube_config_path" {
  description = "Archivo kubeconfig del clúster real (ver REQUIREMENTS.md sección 6.3)."
  type        = string
  default     = "~/.kube/config-real"
}

variable "kube_context" {
  description = "Contexto del kubeconfig del clúster real."
  type        = string
  default     = "default"
}
