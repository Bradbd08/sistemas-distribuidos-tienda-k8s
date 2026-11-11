output "nodes" {
  description = "Los nodos, ya validados."
  value       = var.nodes
}

output "first_server" {
  description = "Nombre del servidor que inicia el clúster."
  value       = local.first_server
}

output "server_ip" {
  description = "IP del servidor que inicia el clúster (la usan los agentes para unirse)."
  value       = local.servers[local.first_server].ip
}

output "common_flags" {
  description = "Banderas de K3s para servidores y agentes."
  value       = "--flannel-iface ${var.interface}"
}

output "server_flags" {
  description = "Banderas de K3s solo para servidores."
  value       = "--cluster-cidr ${var.cluster_cidr} --service-cidr ${var.service_cidr}"
}

output "required_ports" {
  description = "Puertos que deben poder alcanzarse entre los nodos."
  value       = local.required_ports
}
