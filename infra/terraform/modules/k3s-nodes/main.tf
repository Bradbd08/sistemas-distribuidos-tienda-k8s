# Escribe un script de instalación por nodo. Terraform NO se conecta a las laptops: instalar K3s
# necesita sudo (con contraseña) y en la laptop B corre dentro de WSL2, así que lo corre una persona.
# Los scripts no llevan secretos: el token del servidor se pide al ejecutarlos y no se muestra.
resource "local_file" "install" {
  for_each = var.nodes

  filename        = "${var.output_dir}/install-${each.key}.sh"
  file_permission = "0755"
  content = templatefile(
    "${path.module}/templates/${each.value.role == "server" ? "k3s-server" : "k3s-agent"}.sh.tftpl",
    {
      node_name    = each.key
      ip           = each.value.ip
      k3s_version  = var.k3s_version
      server_ip    = var.server_ip
      common_flags = var.common_flags
      server_flags = var.server_flags
      cluster_init = each.key == var.first_server
    }
  )
}
