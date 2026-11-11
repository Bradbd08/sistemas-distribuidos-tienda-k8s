# Plan de direcciones y puertos del clúster real. No crea recursos: valida las IP y calcula lo que
# necesitan los demás módulos (banderas de K3s) y la documentación (puertos que deben estar abiertos).
locals {
  servers = { for name, n in var.nodes : name => n if n.role == "server" }

  # El primer servidor (por nombre) inicia el clúster con etcd embebido (--cluster-init).
  first_server = sort(keys(local.servers))[0]

  required_ports = [
    { protocol = "TCP", port = 6443, between = "agentes -> servidor", purpose = "API de Kubernetes y registro de nodos" },
    { protocol = "UDP", port = 8472, between = "entre todos los nodos", purpose = "red de pods (Flannel VXLAN)" },
    { protocol = "TCP", port = 10250, between = "entre todos los nodos", purpose = "métricas del kubelet" },
  ]
}
