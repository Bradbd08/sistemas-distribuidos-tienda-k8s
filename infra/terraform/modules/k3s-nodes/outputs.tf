output "install_scripts" {
  description = "Ruta del script de instalación de cada nodo."
  value       = { for name, f in local_file.install : name => f.filename }
}
