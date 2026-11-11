output "install_scripts" {
  description = "Script de instalación de cada laptop. Los corre una persona con sudo."
  value       = module.k3s_nodes.install_scripts
}

output "required_ports" {
  description = "Puertos que deben poder alcanzarse entre las laptops."
  value       = module.network.required_ports
}
