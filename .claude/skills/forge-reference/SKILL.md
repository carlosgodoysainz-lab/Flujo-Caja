---
name: forge-reference
description: |
  Referencia extendida de Forge: MCPs, hooks, agentes, comandos completos, testing patterns,
  skills externos. Contenido movido de CLAUDE.md para mantenerlo bajo 200 lineas.
  Consultar cuando necesites detalles de MCPs, hooks, lista completa de comandos, o agentes.
allowed-tools: Read
---

# Forge Reference — Detalles Extendidos

Contenido de referencia para consulta on-demand. No necesitas leer esto en cada sesion.

---

## MCPs: Sentidos y Manos

### Next.js DevTools MCP - Quality Control
Conectado via `/_next/mcp`. Ve errores build/runtime en tiempo real.
- `init` → Inicializa contexto
- `nextjs_call` → Lee errores, logs, estado
- `nextjs_docs` → Busca en docs oficiales

### Playwright MCP - Ojos
- `playwright_navigate` → Navega a URL
- `playwright_screenshot` → Captura visual
- `playwright_click/fill` → Interactua con elementos

### Supabase MCP - Manos (Backend)
- `execute_sql` → SELECT, INSERT, UPDATE, DELETE
- `apply_migration` → CREATE TABLE, ALTER, indices, RLS
- `list_tables` → Ver estructura de BD
- `get_advisors` → Detectar tablas sin RLS

---

## Hooks (8, fail-open)

Principio fail-open: Si un hook falla, aprueba la accion. Nunca atrapa al usuario.

| Hook | Tipo | Que Hace |
|------|------|----------|
| `prompt-preflight.sh` | UserPromptSubmit | Mira el prompt antes de enviarlo: bloquea credenciales de formato inequivoco, avisa de secretos asignados |
| `pre-commit-validation.sh` | PreToolUse | TypeScript typecheck antes de commit |
| `security-scan.sh` | PreToolUse | Detecta secretos, CORS `*`, debug stmts |
| `auto-format.sh` | PostToolUse | Prettier automatico |
| `test-runner.sh` | PostToolUse | Tests relacionados al archivo editado |
| `tool-usage-tracker.sh` | PostToolUse | Trackea uso de herramientas por sesion |
| `log-tool-usage.sh` | PostToolUse | Audit log de ejecuciones |
| `stop-hook.sh` | Stop | Review Loop al terminar sesion |

Activar: `cp .claude/example.settings.json .claude/settings.json`

---

## Agentes Especializados (12)

| Agente | Rol |
|--------|-----|
| `frontend-specialist` | UI/UX implementation |
| `backend-specialist` | APIs, DB, server logic |
| `codebase-analyst` | Debugging, refactoring |
| `supabase-admin` | DB, RLS, migrations |
| `vercel-deployer` | Deploy, CI/CD |
| `validacion-calidad` | Testing, QA |
| `gestor-documentacion` | Docs, changelogs |
| `design-critic` | Evaluacion de diseno UX/UI |
| `qa-auditor` | Accessibility + Performance + Security |
| `db-architect` | Schemas, indexacion, query optimization |
| `testing-engineer` | Unit, integration, contract tests |
| `observability-engineer` | Logging, Sentry, metricas, health checks |

---

## Comandos Completos

### Pipeline
- `/plan` — Planificacion (10 skills → Blueprint)
- `/build` — Construccion (Blueprint → La Pieza → Build Manual o Modo Forja)

### Setup
- `/onboarding` — Ruta personalizada para nuevos usuarios
- `/forge-check` — Diagnostico del entorno
- `/avivar` — Retomar contexto del proyecto

### Standalone (Add-X)
- `/add-login` — Auth con Supabase
- `/add-payments` — Pagos (decision Polar vs Stripe)
- `/add-emails` — Emails transaccionales (Resend)
- `/add-mobile` — PWA + push notifications
- `/landing` — Landing page copy-first + anti-AI-slop
- `/website-3d` — Landing cinematica scroll-stop
- `/redesign` — Audita → reporte → fixes

### Design Quality
- `/design` — Genera/extrae/actualiza DESIGN.md
- `/critique` — Evaluacion UX/design (10 dimensiones + AI slop)
- `/polish` — Refinamientos visuales sistematicos
- `/normalize` — Alinear UI con design system
- `/web-audit` — 150+ checks (Performance, A11y, SEO)

### Strategy
- `/brujula` — Product Vision + Strategy Canvas
- `/precio` — Pricing y monetizacion
- `/estrella` — North Star Metric
- `/rivales` — Analisis competitivo + battlecards

### Business
- `/roi` — Metricas SaaS + dashboard HTML
- `/graduate` — MVP → production-ready plan
- `/kanban` — Tablero por User Story
- `/metas` — OKRs + Outcome Roadmap
- `/lanzamiento` — Go-to-Market + launch plan

### Engineering
- `/despachar` — Ship: merge, typecheck, lint, build, review, commit, push, PR
- `/inspeccionar` — Review pre-landing (11 categorias)
- `/temple` — Auditoria full-project: Seguridad + Datos/RLS + Cache + Web → score compuesto 0-100
- `/fragua-review` — Review con mentalidad founder
- `/retro` — Retrospectiva de ingenieria

### Review Loop
- `/review-loop <tarea>` — Implementa + 4 agentes Codex en paralelo
- `/cancel-review` — Cancela loop activo

### Meta
- `/autoresearch` — Auto-optimizacion de skills (patron Karpathy)
- `/video-visuals` — Visuales estilo sketchnote

### Lifecycle
- `/update-forge` — Actualizar Forge
- `/eject-forge` — Quitar Forge (`forge eject`, conserva lo tuyo) o exportar copia limpia (`forge export`)

### Dev
- `npm run dev` — Servidor (auto-detecta puerto 3000-3006)
- `npm run build` — Build produccion
- `npm run typecheck` — Verificar tipos
- `npm run lint` — ESLint
- `npm run commit` — Conventional Commits

---

## La Pieza (Blueprints de Features)

Ubicacion: `.claude/PRPs/`

| Archivo | Proposito |
|---------|-----------|
| `pieza-base.md` | Template base para SaaS/MVP/Tool/Landing |
| `pieza-ai.md` | Template para features con IA |
| `PIEZA-[nombre].md` | La Pieza generada para el proyecto |

---

## Testing (Patron AAA)

```typescript
test('should calculate total with tax', () => {
  // Arrange
  const items = [{ price: 100 }, { price: 200 }];
  const taxRate = 0.1;
  // Act
  const result = calculateTotal(items, taxRate);
  // Assert
  expect(result).toBe(330);
});
```

---

## Lista Roja (rutas que obligan a parar)

Seis rutas que, cuando aparecen en el diff, obligan a **parar y preguntar** antes de
seguir. No es un modo ni un nivel: una ruta esta en la lista o no esta.

El disparador es mecanico — `git diff --name-only` — no el juicio del agente. Es la
hermana determinista del Decision Check de El Yunque: mismo efecto (pausar), disparador
distinto (una ruta, no una intuicion).

| Regla | Amenazas que la respaldan | Severidad |
|---|---|---|
| `src/features/auth/**` | `OWASP-A07-001` (getSession en vez de getUser), `GP-012` | high |
| `src/middleware.ts` | `GP-012` (rutas protegidas sin middleware), `BLOG-001` (CORS) | high |
| `src/app/api/**/route.ts` | `OWASP-A01-002` (confia en el userId del cliente), `GP-002`, `OWASP-A10-001`, `BLOG-007` | critical |
| `src/app/api/webhooks/**` | `BLOG-004` (firma sin verificar), `PAY-001`..`PAY-005` | critical |
| `supabase/migrations/*.sql` | `OWASP-A01-001` (tablas de usuario sin RLS) | critical |
| cualquier archivo con `service_role` | `GP-008` (service role key en codigo cliente) | critical |

Las cinco primeras son de **ruta**. La sexta es de **contenido**, porque `service_role`
puede aparecer en cualquier archivo.

### El matcher

```bash
# Reglas de ruta
git diff --name-only origin/main...HEAD | grep -E \
  '^(src/features/auth/|src/middleware\.ts$|src/app/api/.*/route\.ts$|src/app/api/webhooks/|supabase/migrations/.*\.sql$)'

# Regla de contenido
git diff --name-only origin/main...HEAD \
  | xargs grep -lE 'service_role|SUPABASE_SERVICE' 2>/dev/null
```

Usa `grep`, no `ripgrep`: esto corre en el proyecto del cliente, donde `rg` puede no
estar instalado. Un check que aborta se lee igual que un proyecto limpio (D-037).

### Que hace el agente cuando hay hit

```markdown
🔴 **Lista Roja** — este cambio toca [N] archivo(s) que la threat-db marca:

| Archivo | Amenaza | Severidad |
|---|---|---|
| src/middleware.ts | GP-012 — Missing middleware for protected routes | high |

Antes de seguir, dime en una linea que debe seguir siendo cierto despues del cambio.
```

Y espera la respuesta. **Sin hit, no dice nada** — igual que el Decision Check.

### Por que la lista no crece

Seis reglas caben en la cabeza. Una lista de veinte dispara en cada commit, y una pausa
que dispara siempre es una pausa que el usuario aprende a saltar. **Una ruta entra solo
si una amenaza `critical` o `high` de la threat-db la nombra explicitamente**, y hay un
test que verifica que cada id citado aqui exista en el YAML.

## Skills Externos (Extensiones Opcionales)

### Impeccable (17 comandos de diseno)
```bash
npx skills add pbakaus/impeccable
```

### Web Quality (6 skills de auditoria)
```bash
npx skills add addyosmani/web-quality-skills
```

### Agency Agents (61 agentes)
```bash
# Copiar desde github.com/msitarzewski/agency-agents
```

### gstack (Browser QA)
```bash
git clone https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack && ./setup
```
