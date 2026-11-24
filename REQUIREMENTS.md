# REQUIREMENTS.md — Cómo levantar el proyecto en cada laptop

> **Para personas y para agentes de IA** (Antigravity, Claude Code, etc.). `AGENTS.md` apunta a este archivo.
> Léelo completo antes de ejecutar comandos. Se actualiza conforme avanza la Parte 2.
> Última actualización: 2026-11-15.

## 1. Qué es este proyecto

Tienda de 3 capas (web Nginx → API Node.js → Redis, MariaDB Galera y MongoDB) de la materia **Sistemas Distribuidos**.

| Parte | Qué es | Estado |
|---|---|---|
| 1 | Todo en una laptop con Docker Compose (HAProxy, Keepalived, Nagios, laboratorio de pruebas) | Hecha y verificada |
| 2 | Migrar a Kubernetes (K3s) según el [PLATFORM-MIGRATION-PLAN.md](https://github.com/tuxtter/distributedsystems/blob/main/PLATFORM-MIGRATION-PLAN.md) del profe | En curso: fases 0 a 7 hechas en el clúster de desarrollo (k3d, sección 5); faltan el clúster real (sección 6) y la fase 8. Wazuh es opcional por indicación del profe |

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
| sops | 3.13.3 | cifrar los Secrets que van a git | `sops --version` |
| age | 1.3.2 | claves de SOPS | `age --version` |
| tflint | 0.66.0 | linter de Terraform | `tflint --version` |
| K3s | v1.37.2+k3s1 | clúster real (sección 6) | `k3s --version` |

### 3.3 Instalar las herramientas del clúster (sin sudo)

```bash
bash scripts/install-cli-tools.sh          # instala kubectl, helm, flux, terraform, kubeconform, k3d, sops, age y tflint en ~/.local/bin
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

# 2) Operadores de MariaDB, MongoDB y Redis y cert-manager (HelmRelease de Flux), y el de RabbitMQ (manifiesto de la release). Tarda ~1 minuto.
kubectl apply -k deploy/platform/operators
kubectl -n flux-system wait --for=condition=Ready helmrelease --all --timeout=540s

# 3) Contraseñas de desarrollo al azar. Viven solo en el clúster (no van a git) y no cambia las que ya existen.
bash scripts/create-dev-secrets.sh

# 4) Bases de datos y cola: MariaDB Galera + MaxScale, MongoDB (replica set de 3), Redis + Sentinel y RabbitMQ (3 nodos). ~5 minutos la primera vez.
kubectl apply -k deploy/platform/data
kubectl -n tienda wait --for=condition=Ready mariadb/mariadb maxscale/maxscale --timeout=900s
kubectl -n tienda wait --for=jsonpath='{.status.phase}'=Running mongodbcommunity/mongodb --timeout=900s
kubectl -n tienda wait --for=condition=AllReplicasReady rabbitmqcluster/rabbitmq --timeout=900s

# 5) Imágenes web, API y worker sin root, al registro del clúster (localhost:5000).
bash scripts/build-images.sh dev

# 6) La tienda: web, API, worker, Job de inicialización, Ingress de Traefik, HPA y PDB.
kubectl apply -k deploy/overlays/dev
kubectl -n tienda wait --for=condition=complete job/catalog-init --timeout=240s
kubectl -n tienda rollout status deploy/api && kubectl -n tienda rollout status deploy/web && kubectl -n tienda rollout status deploy/worker

# 7) Aislamiento de red (default-deny y permisos por capa). Siempre al final.
kubectl apply -k deploy/platform/network-policies
```

**Verificar:**

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8081/        # 200
curl -si http://localhost:8081/api/health | grep -i x-request-trace
# traefik -> web-... -> service/api -> api-... -> galera-lb -> mongodb -> redis
kubectl -n tienda get pods                    # todo Running y Ready; catalog-init en Completed
kubectl -n tienda get mariadb,maxscale,mongodbcommunity,redisreplication,rabbitmqcluster   # todos Ready, Running o True
```

**Ojo:** este flujo manual no crea el Secret `ingress-admin-auth` (solo Flux lo trae, cifrado con SOPS). Sin él las escrituras de la API pueden quedar sin contraseña
(hallazgo 22): para desarrollo usa la sección 5.2.

**Cambiar el código y redesplegar:** `bash scripts/build-images.sh dev && kubectl -n tienda rollout restart deploy/api deploy/web deploy/worker`.

**Qué reemplaza a qué (Compose → Kubernetes):** HAProxy y Keepalived → Ingress de Traefik y Services; `web1-3` → Deployment `web`; `app1-3` → Deployment `api`; (nuevo) Deployment `worker` + RabbitMQ para las reseñas asíncronas ([`docs/04-mensajeria.md`](docs/04-mensajeria.md)); `galera1-3` y `galera-lb` → MariaDB Galera + MaxScale (Service `maxscale`); `mongodb` → replica set de 3 miembros; `redis` → master, 2 réplicas y 3 Sentinel (Service `redis-master`); las redes `edge`, `application` y `database` → NetworkPolicies.

### 5.2 GitOps: Terraform, Flux y SOPS (fases 1, 4 y 5)

Desde la Etapa 2, en dev **Flux** sigue la rama `main` de https://github.com/Bradbd08/sistemas-distribuidos-tienda-k8s: lo que hacen a mano los
pasos 2, 4, 6 y 7 de la sección 5.1 lo hace Flux a partir de Git. Cambiar el clúster es: rama, pull request, CI en verde, merge a `main`, y Flux despliega.
Qué hace cada pieza: [`docs/02-gitops-iac-cicd.md`](docs/02-gitops-iac-cicd.md).

**Arrancar Flux con Git en un clúster k3d nuevo** (una vez). Con Flux, las contraseñas salen de `credentials/dev/` (cifradas): NO corras
`scripts/create-dev-secrets.sh`, que es solo para el flujo manual de la 5.1.

```bash
# 1) Namespace de Flux y la clave que descifra los Secrets (la clave privada nunca va a git; respáldala)
kubectl create namespace flux-system
kubectl -n flux-system create secret generic sops-age --from-file=age.agekey="$HOME/.config/sops/age/keys.txt"

# 2) Imágenes al registro local (Flux las usa en dev)
bash scripts/build-images.sh dev

# 3) Terraform arranca Flux. El token de gh solo registra la llave de despliegue en GitHub; no se guarda.
terraform -chdir=infra/terraform/envs/dev init
GITHUB_TOKEN="$(gh auth token)" terraform -chdir=infra/terraform/envs/dev apply
```

**Verificar:**

```bash
flux get kustomizations      # operators, secrets, data, observability, apps y network-policies en True (notifications suspendida)
kubectl -n tienda get pods   # todo Ready
bash scripts/verificar-ingress.sh   # lecturas por HTTP y HTTPS; toda escritura solo por HTTPS y con contraseña (docs/05-seguridad.md)
```

**Secretos con SOPS** (`SOPS_AGE_KEY_FILE` apunta a la clave privada):

```bash
export SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/keys.txt"
sops credentials/dev/mariadb-credentials.yaml       # editar: descifra y vuelve a cifrar al guardar
sops --encrypt --in-place credentials/dev/<nuevo>.yaml
```

**Forzar una reconciliación:** `flux reconcile source git flux-system && flux reconcile kustomization apps`.

**Si algo se rompe después de reiniciar la laptop:** mira [`docs/hallazgos.md`](docs/hallazgos.md) (filas 5 a 7). El caso más común está en la sección 7.

## 6. Parte 2, modo entrega: clúster K3s real, un nodo por laptop

> **⚠ POR VALIDAR.** Estos pasos siguen la documentación oficial de K3s, Tailscale y WSL, pero aún no se han corrido en la laptop B.
> Si un paso falla, no improvises: copia el error exacto (y la salida de `journalctl -u k3s-agent -n 100 --no-pager`) y avisa.

Decisiones del 2026-11-24:

- **Red:** Tailscale en las dos laptops. En la laptop B va **dentro de Ubuntu (WSL2)**, no en Windows, para que exista la interfaz `tailscale0` que usa K3s.
- **La laptop B tiene 8 GB:** es un nodo ligero. Al unirse recibe el taint `tienda/ligero=true:NoSchedule` y solo corre los pods que lo toleran: web, API, worker y el agente de OpenTelemetry. Todo lo pesado (bases de datos, RabbitMQ, observabilidad y Flux) queda en la laptop A. WSL2 se limita a 4 GB.
- **Imágenes:** GHCR público. La laptop B las baja de `ghcr.io` sin contraseña.

Puertos que K3s usa entre los nodos. Van por Tailscale: no hay que abrir nada en los firewalls.

| Protocolo | Puerto | Quién → quién | Para qué |
|---|---|---|---|
| TCP | 6443 | laptop B → laptop A | API de Kubernetes y registro de nodos |
| UDP | 8472 | entre las dos | red de pods (Flannel VXLAN) |
| TCP | 10250 | entre las dos | métricas y logs del kubelet |

### 6.1 Tailscale en la laptop A

Con `sudo` (lo corre la persona):

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo systemctl enable --now tailscaled
sudo tailscale up            # abre el enlace que muestra e inicia sesión
tailscale ip -4              # la IP_A (100.x.y.z)
```

Para que la laptop B entre a tu red de Tailscale sin usar tu cuenta: en la consola de Tailscale, **Settings → Keys → Generate auth key** (de un solo uso). Es un secreto: pásala por un canal privado.

### 6.2 Preparar la laptop B (Windows 11 + WSL2)

Requisito: Windows 11 22H2 o más nuevo (`winver`) y WSL actualizado (`wsl --update`, `wsl --version`).

1. Limita la RAM de WSL. En PowerShell, `notepad $env:UserProfile\.wslconfig`, y deja:

   ```ini
   [wsl2]
   memory=4GB
   ```

   Windows se queda con los otros 4 GB. No hace falta `networkingMode=mirrored` ni abrir el firewall de Hyper-V: el tráfico del clúster entra por Tailscale.

2. Instala Ubuntu si no lo tienes (`wsl --install -d Ubuntu-24.04`) y activa systemd. Dentro de Ubuntu:

   ```bash
   printf '[boot]\nsystemd=true\n' | sudo tee /etc/wsl.conf
   ```

3. En PowerShell: `wsl.exe --shutdown`. Abre Ubuntu otra vez y verifica:

   ```bash
   systemctl is-system-running      # "running" o "degraded" (ambos sirven)
   free -h                          # total cerca de 4 GB
   ```

4. Tailscale dentro de Ubuntu, con la clave de un solo uso de la sección 6.1:

   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   read -rs TS_KEY                                   # pega la clave y Enter (no se muestra)
   sudo tailscale up --auth-key="$TS_KEY" && unset TS_KEY
   tailscale ip -4                                   # la IP_B (100.x.y.z)
   tailscale ping <IP_A>                             # "via <ip>:<puerto>" = directo; "via DERP" = por relevo
   ```

   Si solo sale por DERP, el clúster funciona pero más lento. Para las pruebas de desempeño, pongan las dos laptops en la misma red Wi-Fi.

5. Clona el repo y corre `bash scripts/install-cli-tools.sh` dentro de Ubuntu (sección 3.3).

WSL apaga su máquina virtual cuando queda inactiva: **mantén una terminal de Ubuntu abierta** mientras uses el clúster. Si se apagó, el nodo pasa a `NotReady` y vuelve solo al abrir Ubuntu.

### 6.3 Laptop A: instalar el servidor

1. Libera RAM: apaga Compose y el clúster de desarrollo (no se borran datos):

   ```bash
   docker compose stop          # en la carpeta del repo
   k3d cluster stop tienda
   ```

2. Genera los scripts de instalación con Terraform (fase 1 del plan). Copia `infra/terraform/envs/prod-nodes/terraform.tfvars.example` a `terraform.tfvars` (no va a git), pon las dos IP de Tailscale y corre:

   ```bash
   terraform -chdir=infra/terraform/envs/prod-nodes init
   terraform -chdir=infra/terraform/envs/prod-nodes apply
   ```

   Salen `generated/install-lap-a.sh` e `install-lap-b.sh`. Solo llevan IP, no secretos.

3. Instala el servidor (pide `sudo`) y saca el token. El token es un secreto: pásalo a la laptop B por un canal privado, nunca por git.

   ```bash
   bash infra/terraform/envs/prod-nodes/generated/install-lap-a.sh
   sudo cat /var/lib/rancher/k3s/server/node-token
   ```

4. Para usar `kubectl` sin `sudo`:

   ```bash
   mkdir -p ~/.kube && sudo install -m 600 -o "$USER" -g "$USER" /etc/rancher/k3s/k3s.yaml ~/.kube/config-real
   export KUBECONFIG=~/.kube/config-real
   ```

### 6.4 Laptop B: unir el nodo

Dentro de Ubuntu. Corre el `install-lap-b.sh` que te pase la laptop A (`bash install-lap-b.sh`; pide el token sin mostrarlo). Equivale a:

```bash
read -rs K3S_TOKEN && export K3S_TOKEN       # pega el token y Enter (no se muestra)
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION="v1.37.2+k3s1" K3S_URL="https://<IP_A>:6443" \
  sh -s - agent --node-name lap-b --node-ip <IP_B> --flannel-iface tailscale0 \
  --node-taint tienda/ligero=true:NoSchedule
sudo systemctl status k3s-agent --no-pager
```

El taint solo se pone al registrar el nodo. Si el nodo se unió sin él, agrégalo desde la laptop A: `kubectl taint node lap-b tienda/ligero=true:NoSchedule`.

### 6.5 Verificar el clúster (desde la laptop A)

```bash
kubectl get nodes -o wide                       # lap-a y lap-b en "Ready"
kubectl describe node lap-b | grep Taints       # tienda/ligero=true:NoSchedule
kubectl get pods -A -o wide --field-selector spec.nodeName=lap-b   # solo web, api, worker y otel-agent
kubectl top node                                # RAM usada en cada laptop
```

Con eso se cumple lo que pidió el profe: un nodo del clúster en cada computadora.

### 6.6 Desplegar `prod` con Flux

Los Secrets de prod están en `credentials/prod/`, cifrados con **su propia clave age** (la de dev no los descifra). La clave privada vive en `~/.config/sops/age/prod.txt` de la laptop A: respáldala (por ejemplo, en un gestor de contraseñas). Sin ella no se pueden descifrar. La contraseña de las escrituras de prod está en `~/.config/tienda/ingress-admin-prod.txt`.

1. Antes de arrancar Flux, la clave que descifra los Secrets:

   ```bash
   # --kubeconfig fija el clúster real: sin él, kubectl usa el contexto de dev (k3d-tienda)
   kubectl --kubeconfig ~/.kube/config-real create namespace flux-system
   kubectl --kubeconfig ~/.kube/config-real -n flux-system create secret generic sops-age --from-file=age.agekey="$HOME/.config/sops/age/prod.txt"
   ```

2. Pendiente: arrancar Flux con Terraform (`envs/prod`) y correr las pruebas de desempeño. Se agrega conforme se implementa.

## 7. Límites conocidos

- Con solo 2 laptops, el plano de control de K3s **no es de alta disponibilidad** (etcd necesita 3 miembros, o 1). El modo desarrollo (sección 5) sí tiene 3 nodos con etcd.
- La API se conecta a `galera1` directo en Compose (`DB_HOST: galera1`), aunque el README dice `galera-lb`. Si `galera1` cae, la API falla. En Kubernetes esto se resuelve con un proxy de base de datos.
- HAProxy (Parte 1) no tiene `option redispatch`: cuando un nodo web cae por pocos segundos, las peticiones que le tocan esperan hasta ~8 s. Se midió en las pruebas de Chaos Monkey.
- El README de la Parte 1 dice Nagios en el puerto 8080 con clave `nagios`. Lo real es el puerto 8088 y la clave del `.env`.
- **Reinicio de la laptop con k3d:** si `kubectl` responde `ServiceUnavailable` más de 2 minutos, Docker pudo reasignar las IP de los nodos (etcd las busca en las direcciones viejas y no forma quórum). Compruébalo y recupéralo sin borrar nada:
  ```bash
  docker inspect -f '{{.Name}} {{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' k3d-tienda-server-0 k3d-tienda-server-1 k3d-tienda-server-2   # esperado: .2, .3 y .4
  docker stop k3d-tienda-server-1 k3d-tienda-server-2 && docker start k3d-tienda-server-1 && docker start k3d-tienda-server-2   # en este orden
  ```
  Los datos se conservan. Las bases tardan unos minutos en recuperarse (Galera ejecuta su procedimiento de recuperación).
- **MongoDB:** el plan nombra al "MongoDB Community Operator", pero ese repositorio está archivado desde noviembre de 2025. Se usa su sucesor, MongoDB Controllers for Kubernetes (chart `mongodb-kubernetes` 1.15.0), que trae el mismo recurso `MongoDBCommunity`. Solo vigila el namespace donde corre, por eso su operador está en `tienda`.
- **MaxScale** (proxy de MariaDB) tiene licencia BSL: es gratis para este proyecto, pero no es software libre.
- **Redis:** la imagen que usa el operador es `redis:v7.0.15`, antigua. Trivy puede marcarla en CI; si pasa, se actualiza la etiqueta en `deploy/platform/data/redis.yaml`.
- **Flux en dev** sigue la rama `main` del repositorio (sección 5.2). La sección 5.1 aplica lo mismo a mano, sin Git.
- **`prod`** todavía no se ha desplegado: la rama `release` va atrás de `main` y falta arrancar Flux en el clúster real (sección 6.6).
- Las contraseñas de las bases son al azar en los dos flujos (5.1 con `scripts/create-dev-secrets.sh`, 5.2 con SOPS). La API usa un usuario de solo lectura en MariaDB (`store_api`) y `tienda` exige Pod Security `restricted`. Redis queda sin contraseña: riesgo aceptado (docs/05-seguridad.md).

## 8. Lista de verificación para la entrega (30/11/2026)

- [ ] Las dos laptops tienen el repo en la misma versión (`git log -1`).
- [ ] `kubectl get nodes` muestra un nodo por laptop, los dos en `Ready`.
- [ ] La tienda responde desde el clúster (HTTP 200 y la traza pasa por los pods).
- [ ] Documentación de la implementación (carpeta `docs/`).
- [ ] Resultados de las pruebas de desempeño (carpeta `docs/resultados/`).
- [ ] CI en verde en `main` y `flux get kustomizations` con todo en `True` en los dos clústeres.
- [ ] Repositorio del proyecto en GitHub, sin secretos (`git log -p | grep -i password` no debe mostrar claves reales).

## 9. Texto para pegarle al agente de IA

> Lee `AGENTS.md` y `REQUIREMENTS.md` completos. Verifica con la sección 3.2 qué herramientas faltan e instálalas con `bash scripts/install-cli-tools.sh`. Después ejecuta la sección 6.2 (laptop B) pidiéndome los pasos que necesiten administrador. Muestra la salida de cada comando de verificación y detente si algo falla. No cambies nada que el documento no pida.
