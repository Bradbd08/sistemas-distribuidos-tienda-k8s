output "storage_class_name" {
  description = "StorageClass que conserva los volúmenes al borrar un PVC."
  value       = module.storage.storage_class_name
}
