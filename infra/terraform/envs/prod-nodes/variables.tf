variable "nodes" {
  description = "Las laptops del clúster real: nombre => IP de Tailscale y rol (server o agent)."
  type = map(object({
    ip   = string
    role = string
  }))
}

variable "k3s_version" {
  description = "Versión de K3s (la misma en todos los nodos)."
  type        = string
  default     = "v1.37.2+k3s1"
}
