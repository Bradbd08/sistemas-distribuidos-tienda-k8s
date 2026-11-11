# 02. Terraform, FluxCD, SOPS y GitHub Actions (fases 1, 4 y 5)

## Flujo de trabajo

```text
cambio -> rama -> pull request -> CI (ci.yml) -> merge a main -> Flux de dev despliega
                                                      |
                                    release.yml: imágenes a GHCR, Trivy, cosign, SBOM
                                                      |
                 tag vX.Y.Z -> imágenes X.Y.Z -> Flux image automation (prod) escribe la etiqueta en la rama release
```

| Entorno | Clúster | Rama que sigue Flux | Imágenes |
|---|---|---|---|
| dev | k3d `tienda` (3 servidores con etcd) | `main` | registro local `tienda-registry:5000` (etiqueta `dev`) |
| prod | las dos laptops (K3s real) | `release` (se llega con un pull request de `main`) | GHCR `ghcr.io/bradbd08/tienda-{web,api}` |

## Terraform (`infra/terraform`)

| Módulo | Qué hace |
|---|---|
| `network` | Valida el plan de direcciones (IP de Tailscale, rangos que no se traslapan) y calcula las banderas de K3s y los puertos. Tiene 5 pruebas (`terraform test`) |
| `k3s-nodes` | Escribe un script de instalación por laptop. No se conecta a ellas: instalar K3s necesita `sudo` y la laptop B corre en WSL2 |
| `flux-bootstrap` | Llave de despliegue SSH propia del entorno, registrada en GitHub, y `flux_bootstrap_git`. Lleva `prevent_destroy` |
| `storage` | StorageClass `local-path-retain` (conserva el volumen si se borra el PVC) |

| Entorno | Qué aplica | Estado |
|---|---|---|
| `envs/dev` | Flux + StorageClass | Aplicado |
| `envs/prod-nodes` | Genera los scripts de K3s (estado local) | Probado la generación; los scripts los corre una persona |
| `envs/prod` | Flux + StorageClass sobre el clúster real | Validado, sin aplicar (el clúster aún no existe) |

**Estado remoto con bloqueo:** backend `kubernetes` (Secret `tfstate-default-<entorno>` en `kube-system` y un Lease como candado). El
estado vive dentro del clúster, así que `prod-nodes` es una raíz aparte con estado local: antes de instalar el clúster no hay dónde guardarlo.

## FluxCD (`clusters/<entorno>`)

Cuatro capas con `dependsOn`: `operators`, `secrets`, `data`, `apps` y `network-policies` (cada una espera a la anterior).

| Caso de uso del plan | Cómo se resuelve |
|---|---|
| Arranque del clúster | Terraform instala Flux y lo apunta a `clusters/<entorno>` |
| Promoción entre entornos | dev sigue `main`; prod sigue `release`, y a `release` solo se llega por pull request |
| Orden de dependencias | `dependsOn` con `wait: true` |
| Corrección de deriva y rollback | Flux revierte cambios manuales; el rollback es `git revert` |
| Secretos | SOPS con age: `credentials/<entorno>/*.yaml` cifrado; Flux descifra con `flux-system/sops-age` |
| Automatización de imágenes | `clusters/prod/image-automation.yaml` (ver límites) |
| Notificaciones | `deploy/platform/notifications/`: estado del commit en GitHub. Suspendido hasta tener el token |

**Protección de datos:** las capas `data` y `secrets` no usan `prune`, tienen `deletionPolicy: Orphan`, y los namespaces y las bases de
datos llevan `prune: disabled`. Borrar un archivo del repositorio no borra una base de datos ni sus volúmenes.

## GitHub Actions (`.github/workflows`)

| Workflow | Cuándo | Qué hace |
|---|---|---|
| `ci.yml` | Pull request | shellcheck, actionlint, sintaxis de la API, kubeconform en cada capa, Secrets cifrados, checkov, Trivy (config e imágenes), Terraform (fmt, validate, tflint, pruebas, checkov) |
| `release.yml` | `main` (si cambian las imágenes) y tags `vX.Y.Z` | Construye y sube a GHCR con etiqueta `sha-<commit>` (y `X.Y.Z` en tags), Trivy, firma con cosign sin llaves y adjunta el SBOM |
| `terraform.yml` | Pull request a `infra/` | `plan` y `apply` manual, solo con runner autoalojado (ver límites) |
| `dependabot.yml` | Semanal | Acciones, imágenes base, pnpm y providers de Terraform |

Todas las acciones están fijadas por SHA de commit. Los permisos son mínimos por job (`packages: write` y `id-token: write` solo en el release).

Excepciones elegidas a propósito en checkov: `CKV_K8S_11` (sin límite de CPU, por el throttling), `CKV_K8S_35` (la API lee los
secretos de variables de entorno, 12-factor) y `CKV_K8S_43` (sin digest: dev usa una etiqueta mutable y prod toma la que fija Flux).

## Límites y lo que no se probó

| Tema | Detalle |
|---|---|
| `terraform plan/apply` en CI | El estado vive dentro de los clústeres y Terraform necesita permisos de administrador del repo: los runners de GitHub no pueden. Los jobs están escritos pero solo corren con un runner autoalojado en la laptop A y `TF_SELF_HOSTED=true`. **No probado** |
| Image automation | Escrita y validada con kubeconform, pero **no probada**: necesita el clúster real y credenciales de GHCR (los paquetes de un repo privado son privados) |
| Aprobación manual y protección de ramas | Dependen del plan de GitHub para repos privados |
| Pruebas unitarias | La API no tiene todavía; el CI solo revisa que compile |
| Firma con cosign | Sin llaves: la identidad del workflow (repositorio y commit) queda en el registro público Rekor |
| Clave age | Está en `~/.config/sops/age/keys.txt` de la laptop A. Si se pierde no se pueden editar los Secrets cifrados (se regeneran): hay que respaldarla |
