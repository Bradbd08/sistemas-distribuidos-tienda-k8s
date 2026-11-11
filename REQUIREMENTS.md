# REQUIREMENTS.md — Cómo levantar el proyecto en cada laptop

> **Para personas y para agentes de IA** (Antigravity, Claude Code, etc.). `AGENTS.md` apunta a este archivo.
> Léelo completo antes de ejecutar comandos. Se actualiza conforme avanza la Parte 2.
> Última actualización: 2026-11-11.

## 1. Qué es este proyecto

Tienda de 3 capas (web Nginx → API Node.js → Redis, MariaDB Galera y MongoDB) de la materia **Sistemas Distribuidos**.

| Parte | Qué es | Estado |
|---|---|---|
| 1 | Todo en una laptop con Docker Compose (HAProxy, Keepalived, Nagios, laboratorio de pruebas) | Hecha y verificada |
| 2 | Migrar a Kubernetes (K3s) según el [PLATFORM-MIGRATION-PLAN.md](https://github.com/tuxtter/distributedsystems/blob/main/PLATFORM-MIGRATION-PLAN.md) del profe | En curso: fases 0 y 2 del plan hechas en k3d (sección 5.1) |

**Entrega de la Parte 2: 30/11/2026.** Documentación de la implementación, repositorio del proyecto y resultados de las pruebas de desempeño. En equipo, debe haber **un nodo del clúster en cada computadora**.

Las dos laptops del equipo:

| Nombre | Sistema | Papel en el clúster real (sección 6) |
|---|---|---|
| **laptop A** | Manjaro Linux | servidor K3s (plano de control) |
| **laptop B** | Windows 11 Pro + WSL2 (Ubuntu 24.04) | nodo K3s (agente) |

## 2. Reglas para agentes de IA (obligatorias)

1. **Idioma:** responde y documenta en español.
2. **Python:** usa `uv` (`uv run`, `uv pip install`, `uv tool install`). Nunca `pip`.
3. **JavaScript:** usa `pnpm`. Nunca `npm` ni `yarn`. Respeta `pnpm-lock.yaml` (`pnpm install --frozen-lockfile`).
4. **Versiones:** instala solo las de la sección 3. No actualices nada por tu cuenta.
5. **Datos:** nunca ejecutes `docker compose down -v`, `docker volume rm`, `k3d cluster delete`, `kubectl delete namespace` ni `kubectl delete pvc` si la persona no lo pidió en ese mismo mensaje. Borran datos.
6. **Secretos:** nunca subas a git `.env`, kubeconfig, el token de K3s, claves de Tailscale, claves `age`/SOPS ni archivos `*.tfstate`. Nunca los pegues en el chat ni en logs.
7. **Un paso a la vez:** después de cada paso corre su comando de verificación y muestra la salida. Si falla, **detente**: copia el error exacto y avisa. No improvises cambios en el sistema (firewall, kernel, servicios) que este archivo no pida.
8. **No cambies el diseño** de `docker-compose.yml` ni de `deploy/` sin avisar. `docker-compose.yml` ya trae dos arreglos de arranque (chequeo de salud de Galera y espera de MongoDB). No los reviertas.
9. **Permisos de administrador** (`sudo`, PowerShell como administrador): pídele a la persona que los ejecute y explícale qué hace cada comando.

## 3. Requisitos

### 3.1 Equipo

| | Mínimo | Recomendado |
|---|---|---|
| RAM libre | 8 GB | 16 GB |
| CPU | 4 núcleos | 8 o más |
| Disco libre | 30 GB | 60 GB |

### 3.2 Software

| Herramienta | Versión probada | Para qué | Cómo verificar |
|---|---|---|---|
| Docker Engine / Docker Desktop | 29.x | contenedores y Compose | `docker --version` |
| Docker Compose | v2.20 o más (probado con 5.6) | Parte 1 | `docker compose version` |
| Git | reciente | repositorio | `git --version` |
| Node.js | 22 LTS o más | correr o probar la API fuera de Docker | `node -v` |
| pnpm | 12.x | paquetes de JavaScript | `pnpm -v` |
| uv | 0.13 o más | paquetes de Python (solo si usas Python fuera de Docker) | `uv --version` |
| kubectl | 1.37.2 | hablar con el clúster | `kubectl version --client` |
| Helm | 4.3.1 | instalar charts | `helm version --short` |
| Flux CLI | 2.10.0 | GitOps | `flux --version` |
| Terraform | 1.17.1 | infraestructura como código | `terraform version` |
| kubeconform | 0.8.0 | validar manifiestos | `kubeconform -v` |
| k3d | 5.9.0 | clúster K3s dentro de Docker (desarrollo) | `k3d version` |
| K3s | v1.37.2+k3s1 | clúster real (sección 6) | `k3s --version` |

### 3.3 Instalar las herramientas del clúster (sin sudo)

```bash
bash scripts/install-cli-tools.sh          # instala kubectl, helm, flux, terraform, kubeconform y k3d en ~/.local/bin
bash scripts/install-cli-tools.sh --check  # solo revisa (código 1 si falta algo)
```

Cada descarga se verifica con la suma SHA-256 que publica el proyecto. `~/.local/bin` debe estar en el `PATH`.

**En Windows** todo se corre **dentro de WSL2** (Ubuntu), excepto Docker Desktop y los pasos de PowerShell como administrador. Docker Desktop debe tener activada la integración con la distro de WSL (Settings → Resources → WSL integration).

## 4. Parte 1: Docker Compose (verificado en la laptop A)

```bash
# 1) Crear el .env con contraseñas al azar (si ya tienes un .env de la Parte 1, úsalo y salta este paso)
while IFS= read -r l; do
  case "$l" in *change-this-*) echo "${l%%=*}=$(openssl rand -hex 16)" ;; *) echo "$l" ;; esac
done < .env.example > .env && chmod 600 .env

# 2) Levantar todo (la primera vez tarda unos 50 segundos)
docker compose up -d --build

# 3) Levantar el laboratorio de pruebas (después del paso 2: usa su red)
(cd resilience-lab && docker compose up -d --build)
```

**Verificar** (todo debe dar `200`):

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost/                 # tienda
curl -s -o /dev/null -w '%{http_code}\n' http://localhost/api/health       # API
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8090/            # laboratorio
docker compose ps --all    # 22 contenedores "running" y catalog-init en "exited (0)"
```

Nagios: http://localhost:8088/nagios, usuario `nagiosadmin`, clave en `NAGIOSADMIN_PASSWORD` del `.env`.

**Apagar sin perder datos:** primero el laboratorio y luego el stack, sin `-v`:

```bash
(cd resilience-lab && docker compose down) && docker compose down
```

Puertos de la laptop que ocupa la Parte 1: `80`, `8088` y `8090`.

## 5. Parte 2, modo desarrollo: clúster K3s dentro de Docker (verificado en la laptop A)

Sirve para desarrollar y probar sin depender de la otra laptop. Es K3s real (misma versión), con 3 nodos y etcd embebido, como pide el plan.

```bash
bash scripts/install-cli-tools.sh
k3d cluster create tienda \
  --image rancher/k3s:v1.37.2-k3s1 \
  --servers 3 --agents 0 \
  --port "8081:80@loadbalancer" --port "8443:443@loadbalancer" \
  --registry-create tienda-registry:0.0.0.0:5000 \
  --timeout 300s
```

**Verificar:**

```bash
kubectl get nodes -o wide      # 3 nodos "Ready", roles control-plane,etcd, versión v1.37.2+k3s1
kubectl get pods -A            # coredns, traefik, metrics-server y svclb en "Running"
```

Puertos de la laptop: `8081` (HTTP del clúster), `8443` (HTTPS), `5000` (registro de imágenes). Puede convivir con la Parte 1.

Borrar (solo si la persona lo pide): `k3d cluster delete tienda`.

### 5.1 Desplegar la tienda en el clúster de desarrollo (fases 0 y 2 del plan)

Cada capa necesita la anterior: corre los pasos en este orden, desde la raíz del repo (contexto `k3d-tienda`). Necesitas unos 3 GB de RAM libres para esto, además del clúster.

```bash
# 1) Controladores de Flux. Sin Git todavía: el repositorio de GitHub entra con Terraform y Flux.
flux install --context k3d-tienda

# 2) Operadores de MariaDB, MongoDB y Redis (son HelmRelease de Flux). Tarda ~1 minuto.
kubectl apply -k deploy/platform/operators
kubectl -n flux-system wait --for=condition=Ready helmrelease --all --timeout=540s

# 3) Contraseñas de desarrollo al azar. Viven solo en el clúster (no van a git) y no cambia las que ya existen.
bash scripts/create-dev-secrets.sh

# 4) Bases de datos: MariaDB Galera + MaxScale, MongoDB (replica set de 3) y Redis + Sentinel. ~5 minutos la primera vez.
kubectl apply -k deploy/platform/data
kubectl -n tienda wait --for=condition=Ready mariadb/mariadb maxscale/maxscale --timeout=900s
kubectl -n tienda wait --for=jsonpath='{.status.phase}'=Running mongodbcommunity/mongodb --timeout=900s

# 5) Imágenes web y API sin root, al registro del clúster (localhost:5000).
bash scripts/build-images.sh dev

# 6) La tienda: web, API, Job de inicialización, Ingress de Traefik, HPA y PDB.
kubectl apply -k deploy/overlays/dev
kubectl -n tienda wait --for=condition=complete job/catalog-init --timeout=240s
kubectl -n tienda rollout status deploy/api && kubectl -n tienda rollout status deploy/web

# 7) Aislamiento de red (default-deny y permisos por capa). Siempre al final.
kubectl apply -k deploy/platform/network-policies
```

**Verificar:**

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8081/        # 200
curl -si http://localhost:8081/api/health | grep -i x-request-trace
# traefik -> web-... -> service/api -> api-... -> galera-lb -> mongodb -> redis
kubectl -n tienda get pods                    # todo Running y Ready; catalog-init en Completed
kubectl -n tienda get mariadb,maxscale,mongodbcommunity,redisreplication   # todos Ready o Running
```

**Cambiar el código y redesplegar:** `bash scripts/build-images.sh dev && kubectl -n tienda rollout restart deploy/api deploy/web`.

**Qué reemplaza a qué (Compose → Kubernetes):** HAProxy y Keepalived → Ingress de Traefik y Services; `web1-3` → Deployment `web`; `app1-3` → Deployment `api`; `galera1-3` y `galera-lb` → MariaDB Galera + MaxScale (Service `maxscale`); `mongodb` → replica set de 3 miembros; `redis` → master, 2 réplicas y 3 Sentinel (Service `redis-master`); las redes `edge`, `application` y `database` → NetworkPolicies.

## 6. Parte 2, modo entrega: clúster K3s real, un nodo por laptop

> **⚠ POR VALIDAR.** Estos pasos siguen la documentación oficial de K3s y de WSL, pero aún no se han corrido en la laptop B.
> Si un paso falla, no improvises: copia el error exacto (y la salida de `journalctl -u k3s-agent -n 100 --no-pager`) y avisa.

### 6.1 Elegir la red entre las dos laptops

Las dos laptops deben alcanzarse entre sí. Puertos que K3s necesita abiertos entre nodos:

| Protocolo | Puerto | Quién → quién | Para qué |
|---|---|---|---|
| TCP | 6443 | laptop B → laptop A | API de Kubernetes y registro de nodos |
| UDP | 8472 | entre las dos | red de pods (Flannel VXLAN) |
| TCP | 10250 | entre las dos | métricas del kubelet |

**Opción 1, misma red (LAN):** la más simple. Úsala si las dos laptops están en el mismo Wi-Fi y no se bloquean entre ellas. Desventaja: si el router cambia la IP (DHCP), hay que reinstalar el nodo.

**Opción 2, Tailscale:** IPs fijas (`100.x.y.z`) que funcionan en cualquier red. Instala Tailscale en las dos laptops (misma cuenta o tailnet), y usa esas IPs como `IP_A` e `IP_B`. Agrega `--flannel-iface tailscale0` a los dos comandos de K3s de abajo. Para las pruebas de desempeño, procura que las laptops estén en la misma LAN: así Tailscale usa la ruta directa.

**Cómo decidir:** con el servidor de la laptop A ya instalado (6.3), corre esto desde la laptop B. Si responde `pong`, usa la opción 1; si no, la opción 2:

```bash
ping -c 3 "$IP_A"
curl -sk --max-time 5 "https://$IP_A:6443/ping"
```

### 6.2 Preparar la laptop B (Windows 11 + WSL2)

Requisito: Windows 11 versión 22H2 o más nueva (`winver`) y WSL actualizado (`wsl --update`, `wsl --version`).

1. Crea o edita `%UserProfile%\.wslconfig` (en PowerShell: `notepad $env:UserProfile\.wslconfig`):

   ```ini
   [wsl2]
   networkingMode=mirrored
   memory=8GB
   processors=4
   ```

   `mirrored` hace que WSL use la misma red que Windows, y así la laptop A puede alcanzar el nodo. `memory` limita la RAM de WSL (por defecto toma el 50 %). Ajusta los números a tu equipo.

2. En **PowerShell como administrador**, permite conexiones entrantes hacia WSL:

   ```powershell
   Set-NetFirewallHyperVVMSetting -Name '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -DefaultInboundAction Allow
   ```

3. Instala Ubuntu si no lo tienes (`wsl --install -d Ubuntu-24.04`) y activa systemd. Dentro de Ubuntu:

   ```bash
   printf '[boot]\nsystemd=true\n' | sudo tee /etc/wsl.conf
   ```

4. En PowerShell: `wsl.exe --shutdown`. Abre Ubuntu otra vez y verifica:

   ```bash
   systemctl is-system-running      # "running" o "degraded" (ambos sirven)
   ip -4 addr show                  # debe mostrar la misma IP que Windows (mirrored)
   ```

5. Clona el repo y corre `bash scripts/install-cli-tools.sh` dentro de Ubuntu (sección 3.3).

WSL apaga su máquina virtual cuando queda inactiva: **mantén una terminal de Ubuntu abierta** mientras uses el clúster. Si se apagó, el nodo pasa a `NotReady` y vuelve solo al abrir Ubuntu.

### 6.3 Laptop A: instalar el servidor

Necesita `sudo` (pide la contraseña). Pídele a la persona que lo corra en su terminal.

```bash
export IP_A=<IP de la laptop A en la red elegida>        # sección 6.1
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION="v1.37.2+k3s1" sh -s - server \
  --cluster-init --node-name lap-a --node-ip "$IP_A" --advertise-address "$IP_A" \
  --tls-san "$IP_A" --secrets-encryption
```

Verificar y sacar el token (el token es un secreto: pásalo a la laptop B por un canal privado, nunca por git):

```bash
sudo k3s kubectl get nodes                      # lap-a en "Ready"
sudo cat /var/lib/rancher/k3s/server/node-token # el token
```

Para usar `kubectl` sin `sudo` en la laptop A:

```bash
mkdir -p ~/.kube && sudo install -m 600 -o "$USER" -g "$USER" /etc/rancher/k3s/k3s.yaml ~/.kube/config-real
export KUBECONFIG=~/.kube/config-real
```

Los puertos `80` y `443` de la laptop A los usa Docker Compose (Parte 1): si el servicio de Traefik de K3s no arranca por eso, apaga Compose o avisa para cambiar los puertos de Traefik.

### 6.4 Laptop B: unir el nodo

Dentro de Ubuntu (WSL2). El token no debe quedar en archivos del repo ni en el historial compartido.

```bash
export IP_A=<IP de la laptop A>
export IP_B=<IP de la laptop B en la misma red>
read -rs K3S_TOKEN && export K3S_TOKEN       # pega el token y Enter (no se muestra)
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION="v1.37.2+k3s1" K3S_URL="https://$IP_A:6443" \
  sh -s - agent --node-name lap-b --node-ip "$IP_B"
sudo systemctl status k3s-agent --no-pager
```

### 6.5 Verificar el clúster (desde la laptop A)

```bash
kubectl get nodes -o wide     # lap-a y lap-b en "Ready"
kubectl get pods -A -o wide   # pods repartidos en las dos laptops (columna NODE)
```

Con eso se cumple lo que pidió el profe: un nodo del clúster en cada computadora.

### 6.6 Pendiente de documentar aquí

Cómo llegan las imágenes a la laptop B (GHCR o registro local), cómo se despliega con Flux y cómo correr las pruebas de desempeño. Se agrega conforme se implementa.

## 7. Límites conocidos

- Con solo 2 laptops, el plano de control de K3s **no es de alta disponibilidad** (etcd necesita 3 miembros, o 1). El modo desarrollo (sección 5) sí tiene 3 nodos con etcd.
- La API se conecta a `galera1` directo en Compose (`DB_HOST: galera1`), aunque el README dice `galera-lb`. Si `galera1` cae, la API falla. En Kubernetes esto se resuelve con un proxy de base de datos.
- HAProxy (Parte 1) no tiene `option redispatch`: cuando un nodo web cae por pocos segundos, las peticiones que le tocan esperan hasta ~8 s. Se midió en las pruebas de Chaos Monkey.
- El README de la Parte 1 dice Nagios en el puerto 8080 con clave `nagios`. Lo real es el puerto 8088 y la clave del `.env`.
- **MongoDB:** el plan nombra al "MongoDB Community Operator", pero ese repositorio está archivado desde noviembre de 2025. Se usa su sucesor, MongoDB Controllers for Kubernetes (chart `mongodb-kubernetes` 1.15.0), que trae el mismo recurso `MongoDBCommunity`. Solo vigila el namespace donde corre, por eso su operador está en `tienda`.
- **MaxScale** (proxy de MariaDB) tiene licencia BSL: es gratis para este proyecto, pero no es software libre.
- **Redis:** la imagen que usa el operador es `redis:v7.0.15`, antigua. Trivy puede marcarla en CI; si pasa, se actualiza la etiqueta en `deploy/platform/data/redis.yaml`.
- **Flux en dev** está instalado sin Git: los manifiestos se aplican a mano con `kubectl apply -k` (sección 5.1). El repositorio y `flux bootstrap` llegan con Terraform.
- **`deploy/overlays/prod`** tiene `OWNER/REPO` y `PENDIENTE` como marcadores hasta que exista el repositorio de GitHub; no se despliega todavía.
- Las contraseñas de la base de datos son una por servicio con todos los permisos de su base, igual que en Compose. El mínimo privilegio, Redis con clave y Pod Security `restricted` llegan con el endurecimiento (fase 7).

## 8. Lista de verificación para la entrega (30/11/2026)

- [ ] Las dos laptops tienen el repo en la misma versión (`git log -1`).
- [ ] `kubectl get nodes` muestra un nodo por laptop, los dos en `Ready`.
- [ ] La tienda responde desde el clúster (HTTP 200 y la traza pasa por los pods).
- [ ] Documentación de la implementación (carpeta `docs/`).
- [ ] Resultados de las pruebas de desempeño (carpeta `docs/resultados/`).
- [ ] Repositorio del proyecto en GitHub, sin secretos (`git log -p | grep -i password` no debe mostrar claves reales).

## 9. Texto para pegarle al agente de IA

> Lee `AGENTS.md` y `REQUIREMENTS.md` completos. Verifica con la sección 3.2 qué herramientas faltan e instálalas con `bash scripts/install-cli-tools.sh`. Después ejecuta la sección 6.2 (laptop B) pidiéndome los pasos que necesiten administrador. Muestra la salida de cada comando de verificación y detente si algo falla. No cambies nada que el documento no pida.
