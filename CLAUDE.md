# Forge para Claude Code

@AGENTS.md

> El Factory OS canónico vive en `AGENTS.md` (importado arriba con `@AGENTS.md`),
> el mismo archivo que leen Codex y OpenCode: un solo cerebro para todos tus
> agentes. Este archivo solo añade lo que Claude Code hace distinto.

## Capacidades nativas en Claude Code

- **TodoWrite:** tracking de progreso estructurado. Úsalo para fases del
  Blueprint, no para subtareas atomicas. El Yunque lo invoca por fase.
- **AskUserQuestion:** branching con opciones (max 4). Úsalo cuando haya 2-3
  alternativas claras con tradeoffs. Recomienda una con "(Recommended)".
  No lo uses para confirmaciones binarias triviales — esas van en texto.
- **Slash commands:** los 44 comandos viven en `.claude/commands/*.md`. Se
  invocan con `/nombre` literal.
- **Skills:** 22 skills en `.claude/skills/<nombre>/SKILL.md`. Se cargan al
  matchear sus triggers.
- **Subagents:** 12 agentes en `.claude/agents/*.md`. Invocados con `Agent`.
- **Hooks:** configurados en `.claude/settings.json` (PreToolUse,
  UserPromptSubmit, PostToolUse, Stop). 9 scripts bash en `.claude/hooks/`.
- **MCPs:** configurados en `.mcp.json` (formato JSON nativo). Plantilla en
  `.claude/example.mcp.json`.

## Convenciones de paths

Las rutas que ves son literales para ti: todos los archivos del proyecto Forge
viven bajo `.claude/`.

## Comportamiento esperado

- **Plan mode:** respeta el flow `IDEA → /plan → Blueprint → /build`. NUNCA
  escribas codigo sin Blueprint aprobado.
- **El Yunque:** motor de ejecucion en `.claude/prompts/el-yunque.md`.
  Invocado por `/build` cuando el usuario elige "Build Manual".
- **La Forja:** modo paralelo con worktrees, en `.claude/skills/la-forja/`.
- **Pausa explicita:** si el output excede contexto util, pausa con
  `[PAUSADO — X de Y completo. Envia "continuar" para reanudar desde: Z]`.
- **Auto-Blindaje:** los aprendizajes universales van en la zona
  `FORGE:PRESERVE` de `AGENTS.md` (los lee cualquier agente). Aquí abajo, solo
  lo que aplica exclusivamente a Claude Code.

---

<!-- FORGE:PRESERVE:START — Todo lo que está debajo de esta línea es tuyo. /update-forge y forge update nunca lo tocan. -->

## Aprendizajes (Auto-Blindaje Activo)

### 2025-01-09: Usar npm run dev, no next dev
- **Error**: Puerto hardcodeado causa conflictos
- **Fix**: Siempre usar `npm run dev` (auto-detecta puerto)

### 2026-03-09: La Forja — Proteccion de disco obligatoria
- **Error**: 5 agentes sandbox llenaron 765GB del disco
- **Fix**: Symlink node_modules, typecheck en vez de build por fase, validar espacio libre, monitor de 2GB/sandbox

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
