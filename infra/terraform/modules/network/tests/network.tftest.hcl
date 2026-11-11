# Pruebas del módulo network. Se corren con:  terraform -chdir=infra/terraform/modules/network test
variables {
  nodes = {
    lap-a = { ip = "100.101.102.103", role = "server" }
    lap-b = { ip = "100.101.102.104", role = "agent" }
  }
}

run "acepta_dos_laptops_en_tailscale" {
  command = plan

  assert {
    condition     = output.first_server == "lap-a" && output.server_ip == "100.101.102.103"
    error_message = "El primer servidor debe ser lap-a con su IP de Tailscale."
  }

  assert {
    condition     = output.common_flags == "--flannel-iface tailscale0"
    error_message = "Flannel debe usar la interfaz tailscale0."
  }
}

run "rechaza_una_ip_fuera_del_rango_de_tailscale" {
  command = plan

  variables {
    nodes = {
      lap-a = { ip = "192.168.1.10", role = "server" }
    }
  }

  expect_failures = [var.nodes]
}

run "rechaza_un_cluster_sin_servidor" {
  command = plan

  variables {
    nodes = {
      lap-b = { ip = "100.101.102.104", role = "agent" }
    }
  }

  expect_failures = [var.nodes]
}

run "rechaza_un_rol_desconocido" {
  command = plan

  variables {
    nodes = {
      lap-a = { ip = "100.101.102.103", role = "master" }
    }
  }

  expect_failures = [var.nodes]
}

run "rechaza_pods_que_se_traslapan_con_los_nodos" {
  command = plan

  variables {
    cluster_cidr = "100.64.0.0/16"
  }

  expect_failures = [var.cluster_cidr]
}
