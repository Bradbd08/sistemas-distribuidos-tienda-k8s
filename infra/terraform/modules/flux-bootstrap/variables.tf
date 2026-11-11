variable "github_repository" {
  description = "Nombre del repositorio de GitHub (sin el dueño)."
  type        = string
}

variable "environment" {
  description = "Nombre del entorno (dev o prod). Se usa en el título de la llave de despliegue."
  type        = string
}

variable "cluster_path" {
  description = "Carpeta del repositorio que Flux sincroniza para este clúster (por ejemplo clusters/dev)."
  type        = string
}

variable "components_extra" {
  description = "Controladores extra de Flux. Los de imágenes permiten actualizar las etiquetas desde Git."
  type        = set(string)
  default     = ["image-reflector-controller", "image-automation-controller"]
}
