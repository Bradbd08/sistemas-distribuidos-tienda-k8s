output "private_key_pem" {
  description = "Llave privada SSH de Flux. La usa el provider flux del entorno para hablar con Git."
  value       = tls_private_key.flux.private_key_pem
  sensitive   = true
}
