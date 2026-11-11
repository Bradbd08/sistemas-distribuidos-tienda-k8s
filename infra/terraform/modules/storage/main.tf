# StorageClass para las bases de datos. Usa el mismo aprovisionador que viene con K3s (local-path),
# pero con reclaimPolicy Retain: si alguien borra un PVC, el volumen (y los datos) se conserva.
resource "kubernetes_storage_class_v1" "retain" {
  metadata {
    name = var.name
  }

  storage_provisioner    = "rancher.io/local-path"
  reclaim_policy         = "Retain"
  volume_binding_mode    = "WaitForFirstConsumer"
  allow_volume_expansion = false
}
