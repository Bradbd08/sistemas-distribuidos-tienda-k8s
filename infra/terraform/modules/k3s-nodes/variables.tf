variable "k3s_version" {
  description = "Versión de K3s. Debe ser la misma en todos los nodos."
  type        = string
  default     = "v1.37.2+k3s1"
}

variable "nodes" {
  description = "Nodos: nombre => IP y rol. Sale del módulo network."
  type = map(object({
    ip   = string
    role = string
  }))
}

variable "first_server" {
  description = "Nombre del servidor que inicia el clúster (--cluster-init)."
  type        = string
}

variable "server_ip" {
  description = "IP del primer servidor: a ella se unen los demás nodos."
  type        = string
}

variable "common_flags" {
  description = "Banderas de K3s para servidores y agentes."
  type        = string
  default     = ""
}

variable "server_flags" {
  description = "Banderas de K3s solo para servidores."
  type        = string
  default     = ""
}

variable "output_dir" {
  description = "Carpeta donde se escriben los scripts de instalación (no va a git)."
  type        = string
}
