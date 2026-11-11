# AGENTS.md — instrucciones para agentes de IA en este repositorio

**Antes de ejecutar cualquier comando, lee `REQUIREMENTS.md` completo.** Ahí está cómo levantar el proyecto
en cada laptop (Parte 1 con Docker Compose y Parte 2 con un clúster K3s), las versiones exactas y cómo verificar cada paso.

Resumen de las reglas (el detalle está en la sección 2 de `REQUIREMENTS.md`):

- Responde y documenta en **español**.
- Python con **uv**, JavaScript con **pnpm**. Nunca `pip`, `npm` ni `yarn`.
- Nunca borres datos: nada de `docker compose down -v`, `docker volume rm`, `k3d cluster delete`,
  `kubectl delete namespace` ni `kubectl delete pvc` sin que la persona lo pida en ese mismo mensaje.
- Nunca subas a git ni pegues en el chat secretos: `.env`, kubeconfig, token de K3s, claves de Tailscale,
  claves `age`/SOPS, `*.tfstate`.
- Un paso a la vez: corre el comando de verificación y muestra la salida. Si algo falla, detente y avisa con el error exacto.
- Los pasos con `sudo` o PowerShell como administrador los corre la persona; tú le explicas qué hace cada comando.
- No cambies `docker-compose.yml` ni `deploy/` sin avisar.

El plan que se está implementando es el [PLATFORM-MIGRATION-PLAN.md](https://github.com/tuxtter/distributedsystems/blob/main/PLATFORM-MIGRATION-PLAN.md) del profe.
Entrega: 30/11/2026.
