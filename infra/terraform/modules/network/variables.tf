# Terraform no tiene una función "cidrcontains". Para saber si una IP está dentro de un rango se compara la
# dirección de red que resulta de aplicar el prefijo del rango: cidrhost("<ip>/<prefijo>", 0) == cidrhost(rango, 0).
# Dos rangos se traslapan si, con el prefijo más corto de los dos, sus direcciones de red coinciden.

variable "nodes" {
  description = "Nodos del clúster real: nombre => IP de Tailscale y rol (server o agent)."
  type = map(object({
    ip   = string
    role = string
  }))

  validation {
    condition     = alltrue([for n in values(var.nodes) : contains(["server", "agent"], n.role)])
    error_message = "El rol de cada nodo debe ser \"server\" o \"agent\"."
  }

  validation {
    condition     = length([for n in values(var.nodes) : n if n.role == "server"]) >= 1
    error_message = "Hace falta al menos un nodo con rol \"server\"."
  }

  validation {
    condition = alltrue([
      for n in values(var.nodes) :
      can(regex("^[0-9]{1,3}(\\.[0-9]{1,3}){3}$", n.ip)) &&
      try(cidrhost("${n.ip}/${split("/", var.node_cidr)[1]}", 0) == cidrhost(var.node_cidr, 0), false)
    ])
    error_message = "La IP de cada nodo debe ser válida y estar dentro de node_cidr (Tailscale usa 100.64.0.0/10)."
  }
}

variable "node_cidr" {
  description = "Rango de las IP de los nodos. Tailscale asigna direcciones de 100.64.0.0/10."
  type        = string
  default     = "100.64.0.0/10"
}

variable "interface" {
  description = "Interfaz de red que usa Flannel (VXLAN) entre los nodos."
  type        = string
  default     = "tailscale0"
}

variable "cluster_cidr" {
  description = "Rango de las IP de los pods."
  type        = string
  default     = "10.42.0.0/16"

  validation {
    condition = (
      cidrhost("${cidrhost(var.cluster_cidr, 0)}/${min(tonumber(split("/", var.cluster_cidr)[1]), tonumber(split("/", var.node_cidr)[1]))}", 0)
      != cidrhost("${cidrhost(var.node_cidr, 0)}/${min(tonumber(split("/", var.cluster_cidr)[1]), tonumber(split("/", var.node_cidr)[1]))}", 0)
    )
    error_message = "cluster_cidr no puede traslaparse con node_cidr."
  }
}

variable "service_cidr" {
  description = "Rango de las IP de los Services."
  type        = string
  default     = "10.43.0.0/16"

  validation {
    condition = (
      cidrhost("${cidrhost(var.service_cidr, 0)}/${min(tonumber(split("/", var.service_cidr)[1]), tonumber(split("/", var.cluster_cidr)[1]))}", 0)
      != cidrhost("${cidrhost(var.cluster_cidr, 0)}/${min(tonumber(split("/", var.service_cidr)[1]), tonumber(split("/", var.cluster_cidr)[1]))}", 0)
    )
    error_message = "service_cidr no puede traslaparse con cluster_cidr."
  }

  validation {
    condition = (
      cidrhost("${cidrhost(var.service_cidr, 0)}/${min(tonumber(split("/", var.service_cidr)[1]), tonumber(split("/", var.node_cidr)[1]))}", 0)
      != cidrhost("${cidrhost(var.node_cidr, 0)}/${min(tonumber(split("/", var.service_cidr)[1]), tonumber(split("/", var.node_cidr)[1]))}", 0)
    )
    error_message = "service_cidr no puede traslaparse con node_cidr."
  }
}
