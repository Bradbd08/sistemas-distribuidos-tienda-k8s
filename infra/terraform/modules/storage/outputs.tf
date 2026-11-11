output "storage_class_name" {
  description = "Nombre de la StorageClass que conserva los volúmenes."
  value       = kubernetes_storage_class_v1.retain.metadata[0].name
}
