---
description: "Actualiza Forge en este proyecto con `forge update` — merge 3-way determinista que preserva tu codigo, tus archivos custom y tus aprendizajes."
---

# Update Forge

Actualiza las herramientas de Forge (`.claude/` + la zona Forge de tu
archivo de contexto) a la ultima version, **sin tocar tu codigo**.

Desde V4.3 esto lo hace el CLI de Node de forma **determinista** (antes era un
merge manual fragil que podia perder ediciones o acumular huerfanos). Tu trabajo
es invocar `forge update`, leer su salida y ayudar a resolver conflictos.

## Proceso

### 1. Verifica que el CLI este disponible

```bash
forge --version
```

Si dice `forge: command not found`, el usuario no tiene el binario enlazado.
Pidele que lo haga una sola vez (ajusta `~/.forge` a donde clono Forge):

```bash
cd ~/.forge/tools/forge-cli && git pull && npm install && npm run build && npm link
```

Si tiene un `alias forge` viejo que tapa el binario, `command forge doctor --fix`
lo elimina (con backup).

### 2. Vista previa (dry-run)

```bash
forge update --dry-run
```

Muestra el plan: cuantos archivos **nuevos / actualizados / en conflicto /
removidos**. Reportaselo al usuario antes de aplicar.

### 3. Aplica

El working tree debe estar limpio para que el update sea un diff revisable. Si
hay cambios sin commitear, pidele al usuario que commitee o haga stash primero
(o usa `--force` si esta consciente del riesgo).

```bash
forge update
```

### 4. Reporta y resuelve conflictos

`forge update` **nunca** pisa en silencio un archivo oficial que el usuario
edito: conserva el suyo y deja la version nueva como `<archivo>.forge-new`.

- Lista los archivos en conflicto (busca `*.forge-new` bajo `.claude/`).
- Para cada uno: compara el `.forge-new` con el archivo actual, fusiona los
  cambios del template que el usuario quiera conservar, y al terminar **borra el
  `.forge-new`**.
- Si el update avisa que el archivo de contexto (CLAUDE.md / AGENTS.md / GEMINI.md
  / .cursorrules segun tu plataforma) **no tenia el marker** `FORGE:PRESERVE:START`,
  agregalo encima
  de los aprendizajes del usuario para que el proximo update renueve la zona
  Forge de forma segura.

## Que toca y que no

- ✅ Actualiza: `.claude/**` (commands, skills, agents, prompts,
  PRPs, ai_templates, design-systems), `example.mcp.json`, y la zona Forge del
  archivo de contexto.
- 🔒 Nunca toca: `src/`, `package.json`, configs, `.mcp.json`, `.env*`, ni tu
  zona preservada de contexto (aprendizajes y Auto-Blindaje).
- 💾 Backup automatico en `.forge/backups/` antes de escribir.

## Notas

- El CLI conoce su propia ruta de instalacion: `forge update` no necesita ningun
  alias para encontrar el source (a diferencia del `/update-forge` viejo).
- Proyectos creados antes de V4.3 no tienen `.forge/manifest.json`: el primer
  `forge update` degrada a "sobrescribe template + preserva lo desconocido" (sin
  deteccion de conflictos esa vez) y escribe el manifest, de modo que el
  siguiente update ya es preciso.
- **Multi-plataforma (V4.4):** `forge update` sin flags **auto-detecta** los
  targets presentes (`.claude`/`.codex`/`.opencode`/`.cursor`/`.gemini`) y
  actualiza cada uno. Usa `--target=<x>` para acotar a uno. El merge de la zona
  preservada aplica a CLAUDE.md / AGENTS.md / GEMINI.md / .cursorrules segun el
  target.
