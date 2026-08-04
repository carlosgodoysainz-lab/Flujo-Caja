---
name: project-auditor
description: "Auditoría full-project (TODO src/, no solo el diff) en 4 dimensiones — Seguridad, Datos/RLS, Cache & Rendimiento, Calidad Web — con UN reporte priorizado y un Audit Score compuesto (0-100). Cruza la threat-db de ~77 amenazas (corre sus golden_path_checks como ripgrep), consulta get_advisors de Supabase, y delega calidad web a web-quality. Úsalo cuando el usuario pida 'audita todo el proyecto', 'auditoría completa', 'está listo para producción', 'revisa seguridad y performance', o ejecute /temple. NO confundir con /inspeccionar (ese solo revisa el git diff vs main)."
allowed-tools: Read, Grep, Glob, Bash, Task
metadata:
  author: forge
  version: "1.0.0"
---

# Project Auditor — Auditoría Full-Project

> *"El herrero no entrega la pieza por verla brillar. La templa, la golpea, y mide si aguanta."*

## Propósito

Un solo comando (`/temple`) que audita **TODO el proyecto** — ripgrep sobre `src/`
completo, no solo el diff — en 4 dimensiones y entrega **un reporte priorizado con
un Audit Score compuesto**. Reutiliza piezas que ya existen en Forge; **NO duplica
su lógica**:

- **threat-db.yaml** (`.claude/skills/la-herreria/references/threat-db.yaml`, ~77 amenazas) — corre cada `golden_path_check` automatizable como ripgrep
- **security-scan.sh** (`.claude/hooks/security-scan.sh`) — mismos regex de secrets/CORS/innerHTML, pero full-project (el hook solo mira staged files)
- **categorías de `/inspeccionar`** — aplicadas full-project en vez de al diff
- **web-quality skill** — la dimensión Calidad Web se delega aquí
- **supabase skill** — `get_advisors(type:"security")` / `get_advisors(type:"performance")` vía MCP

## Cuándo activarse

- Usuario ejecuta `/temple` (full / `quick` / `security` / `datos` / `cache` / `web` / `compare` / `--deep`)
- Usuario pregunta: "¿está listo para producción?", "audita todo el proyecto", "revisa seguridad y performance", "¿qué tan seguro/rápido es esto?"
- **NO** activarse para revisar solo el diff de una branch — eso es `/inspeccionar`.

## Las 4 Dimensiones

### 🔒 Dimensión 1 — Seguridad (peso 30%)

Cruza la threat-db y corre los checks automatizables sobre `src/` completo.

**Detección (full-project):**

1. **Leer** `.claude/skills/la-herreria/references/threat-db.yaml`. Para cada
   threat cuyo `golden_path_check` sea un `grep`/`grep -r`/`grep -rE`, correrlo
   como ripgrep sobre `src/`. Checks clave (verbatim de la threat-db):

   | id | severity | ripgrep |
   |----|----------|---------|
   | GP-008 service_role en client | critical | `rg -n 'service_role\|SUPABASE_SERVICE' src/` → flag si NO está en archivo server-only |
   | GP-006 API key IA en bundle | critical | `rg -n 'OPENROUTER\|OPENAI\|ANTHROPIC' src/` → flag fuera de server |
   | OWASP-A01-002 userId del cliente confiado | critical | `rg -n 'body\.userId\|req\.query\.userId\|params\.userId' src/` |
   | OWASP-A03-001 SQL injection por interpolación | critical | `rg -nE 'execute_sql.*\$\{\|rpc.*\+' src/` |
   | OWASP-A03-003 command injection | critical | `rg -nE '(exec\|spawn\|execSync)\(' src/app src/features` |
   | OWASP-A02-001 secrets en localStorage | high | `rg -n 'localStorage' src/ \| rg -i 'token\|auth\|session\|key'` |
   | OWASP-A02-002 secrets en console | high | `rg -ni 'console\.log' src/ \| rg -i 'token\|password\|secret\|key'` |
   | OWASP-A03-002 XSS innerHTML | high | `rg -n 'dangerouslySetInnerHTML' src/` |
   | OWASP-A07-001 getSession en data code | high | `rg -n 'getSession' src/` → solo debe aparecer en middleware |
   | OWASP-A10-001 SSRF | high | `rg -nE 'fetch\(.*req\.\|fetch\(.*body\.' src/app` |
   | GP-011 Supabase URL hardcoded | high | `rg -n 'supabase\.co' src/` → solo `process.env` |
   | BLOG-001 CORS wildcard | high | `rg -nE "Access-Control-Allow-Origin.*['\"]\*['\"]" src/ next.config.ts` |
   | BLOG-002 open redirect | high | `rg -n 'redirect\|returnUrl\|callbackUrl' src/` → verificar validación |
   | PRIV-006 PII en URL | medium | `rg -nE 'router\.push.*(token\|email)' src/` |

2. **Reusar `security-scan.sh`** (no reimplementar): los mismos patrones de secrets
   sobre TODO `src/`: `AKIA[0-9A-Z]{16}`, `(sk-[a-zA-Z0-9]{20,}\|pk_live_\|sk_live_\|sk_test_)`,
   asignaciones `(password|secret|api_key|access_token|private_key) = "…"` (excluir
   `process.env`, `YOUR_`, `CHANGE_ME`, `example`, `placeholder`), y JWT crudos fuera de `.env`.

3. **Categorías CRITICAL de `/inspeccionar` full-project:** glob `src/app/api/**/route.ts`
   y leer cada uno → verificar `getUser()`/auth antes de tocar datos; `"use client"` con
   imports de secrets; `!` (non-null) sobre datos de API/DB; `as` casts sin validación Zod.

**Sub-score 0-100 (Seguridad):** empezar en 100. Por hallazgo: `critical −20`,
`high −10`, `medium −4`, `low −1`. Floor en 0. Reportar cobertura:
`threats automatizables corridos: X/N`.

### 🗄️ Dimensión 2 — Datos & Supabase/RLS (peso 25%)

**Detección:**

1. **Si Supabase conectado (MCP disponible):** llamar `get_advisors(type:"security")`
   → tablas sin RLS + políticas permisivas. También `get_advisors(type:"performance")`
   → índices faltantes / seq scans (esto **alimenta también la dimensión Cache**).
   Patrón idéntico al skill `supabase` (paso "Verificar Seguridad").
2. **Si InsForge** (`NEXT_PUBLIC_INSFORGE_URL` en `.env`): no hay advisor MCP de
   seguridad → **fallback estático**: por cada `CREATE TABLE` en migraciones, verificar
   que exista su `ALTER TABLE … ENABLE ROW LEVEL SECURITY` correspondiente.
3. **Estático siempre** (categorías Supabase de `/inspeccionar`):
   - `.single()` sin manejo de `null`: `rg -n '\.single\(\)' src/`
   - queries sin filtro `user_id` en tablas de usuario (leer data-access)
   - `service_role`/`supabaseAdmin` en client → ya cubierto por GP-008
   - políticas con `USING (true)`: revisar migraciones (OWASP-A01-004)

**Sub-score 0-100:** mismo decremento por severidad. Reportar `tablas con RLS: X/Y`.
**Si MCP no disponible:** marcar el sub-check como "no verificado vía MCP" y **NO
penalizar** por lo no observable (solo por lo estático) — patrón token-auditor con
logs ausentes.

### ⚡ Dimensión 3 — Cache & Rendimiento (peso 25%) — la dimensión nueva, primera clase

Detección full-project. Cada patrón es un ripgrep ejecutable:

| Check | ripgrep / fuente | Señal | Severidad |
|-------|------------------|-------|-----------|
| Client fetch sin cache | archivos `"use client"` con `fetch(` y sin `useSWR`/`useQuery` | fetch crudo en client sin capa de cache | medium |
| Sin estrategia de cache de datos | `rg -c 'useSWR\|@tanstack/react-query' src/` == 0 pero hay fetch en client | proyecto sin cache de datos | medium |
| Next fetch sin cache config | `fetch(` en `src/app` (Server Component) sin `next:`/`cache:`/`revalidate` adyacente | fetch sin política de cache explícita | low |
| Falta `revalidate` | `page.tsx` sin `export const revalidate` | sin ISR declarado | low |
| `force-dynamic` excesivo | `rg -n "force-dynamic" src/app` | opt-out de cache, posible regresión | medium |
| N+1 queries | query dentro de `.map(async`/`for … of {` (también flaggeado por /inspeccionar) | N+1 | high |
| Índices faltantes | `get_advisors(type:"performance")` (Supabase) | FK sin índice / seq scan | high |
| Sin cache headers / CDN | `rg -n 'Cache-Control\|s-maxage\|stale-while-revalidate' src/ next.config.ts` == 0 en API/headers | sin edge/CDN caching | medium |
| `<img>` crudo | `rg -n '<img ' src/` | imagen sin optimizar (falta `next/image`) | low |
| Imports pesados sin lazy | `rg -nE "from ['\"](recharts\|three\|monaco\|@?chart)" src/` sin `dynamic(` | bundle bloat | medium |
| Web Vitals / bundle | delegar a **web-quality** (bloque Performance) y plegar su veredicto aquí | LCP/INP/CLS, bundle budget | — |

> **Regla anti-doble-conteo:** el bloque **Performance** de web-quality se cuenta
> AQUÍ (Cache), no en Calidad Web. Calidad Web se queda solo con a11y + SEO +
> best-practices + npm audit. Así cada hallazgo vive en exactamente una dimensión.

**Sub-score 0-100:** decremento por severidad según la columna de arriba.

### 🌐 Dimensión 4 — Calidad Web (peso 20%)

**Delegar a web-quality** — NO reimplementar. Leer `.claude/skills/web-quality/SKILL.md`
y aplicar SOLO sus categorías **Accessibility (WCAG 2.1 AA)**, **SEO** y
**Best Practices** + `npm audit` (OWASP-A06-001 deps vulnerables). El bloque
**Performance** de web-quality va en la dimensión Cache. Si Playwright MCP está
disponible, web-quality usa Lighthouse; si no, análisis estático del código.

**Sub-score 0-100:** mapear las severidades de web-quality (Critical/High/Medium/Low)
al mismo decremento (`−20/−10/−4/−1`).

## Cálculo del Audit Score compuesto

```
Composite = 0.30·Seguridad + 0.25·Datos + 0.25·Cache + 0.20·CalidadWeb
```

**Rangos (espejo de audit-tokens):**
- **85-100** → 🟢 Excelente. Listo para producción.
- **70-84** → 🟡 Bueno. 2-3 fixes antes de deploy.
- **50-69** → 🟠 Mejorable. Al menos un área crítica.
- **< 50** → 🔴 Crítico. Bloquear deploy hasta remediar.

**Regla de bloqueo:** cualquier hallazgo `critical` marca **"⛔ BLOQUEA DEPLOY"**
sin importar el número — un score de 88 con un `service_role` expuesto sigue siendo
deploy-blocker.

## Orquestación

- **`quick` y single-dimension → inline.** No se justifica spawnear subagents para un
  pase rápido o una sola dimensión.
- **`full` → 3 subagents en paralelo** vía `Task` + síntesis (mantiene el contexto
  principal ligero — la cultura token-budget que `/audit-tokens` Check 5/6 premia):
  - **qa-auditor** → dimensión Calidad Web (a11y/SEO/best-practices/Lighthouse, es su rol)
  - **supabase-admin** (o **db-architect** para índices/N+1) → dimensión Datos/RLS
  - Seguridad (threat-db ripgrep) + resto de Cache → inline o vía `Agent(Explore)`

  El contexto principal recibe solo los **resúmenes** de cada subagent y produce el
  reporte sintetizado + el score compuesto.

## Capa profunda `--deep` (opt-in, NO hard-depend de codex)

Detección:
```bash
command -v codex >/dev/null 2>&1 && [ -n "$OPENAI_API_KEY" ]
```
- **Si disponible:** correr `/adversarial-review` (4 agentes atacantes), leer su
  **Resilience Score (0-100)** del reporte `reviews/adversarial-*.md`, y **plegarlo
  en la dimensión Seguridad**: `Seguridad_final = 0.6·Seguridad_estático + 0.4·Resilience`.
  Anotar en la cobertura.
- **Si NO disponible:** continuar static-only. **Nunca fallar ni bloquear** por
  ausencia de codex. Mensaje: *"Capa profunda omitida — instala codex + OPENAI_API_KEY
  para activarla (opcional)."*

## Destino del output

1. **`AUDIT-<YYYY-MM-DD>.md`** en la raíz del proyecto (precedente: `/plan` escribe
   `SECURITY-AUDIT-[nombre].md` y `BLUEPRINT-*.md` a raíz).
2. **`.context/audits/<YYYY-MM-DD>.json`** — snapshot para `/temple compare`
   (precedente exacto: `/retro` escribe `.context/retros/*.json`).

Schema del JSON:
```json
{
  "date": "YYYY-MM-DD",
  "composite": 78,
  "dimensions": { "seguridad": 72, "datos": 80, "cache": 65, "web": 88 },
  "findings": { "critical": 1, "high": 4, "medium": 9, "low": 6 },
  "coverage": { "owasp": "7/10", "threatdb_run": "14/27", "rls_tables": "5/6" },
  "deep_layer": { "ran": false, "resilience_score": null }
}
```

**`compare`:** `ls -t .context/audits/*.json` → cargar el más reciente → tabla de
deltas por dimensión (↑/↓ pp), idéntica al modo compare de `/retro`.

## Plantilla del reporte

Producir exactamente este template (con los números reales del proyecto):

```markdown
# 🔨 Temple — Auditoría Full-Project — [YYYY-MM-DD]

**Audit Score: XX/100** — [🟢 Excelente / 🟡 Bueno / 🟠 Mejorable / 🔴 Crítico]
[⛔ BLOQUEA DEPLOY — si hay hallazgos críticos]

---

## 📋 Resumen ejecutivo

[2-3 líneas: dónde sangra más, el fix de mayor ROI, veredicto de deploy]

---

## Score por dimensión

| Dimensión | Peso | Sub-score | Hallazgos (C/H/M/L) | Estado |
|-----------|------|-----------|---------------------|--------|
| 🔒 Seguridad | 30% | XX/100 | x/x/x/x | 🟢/🟡/🔴 |
| 🗄️ Datos & RLS | 25% | XX/100 | x/x/x/x | 🟢/🟡/🔴 |
| ⚡ Cache & Rend. | 25% | XX/100 | x/x/x/x | 🟢/🟡/🔴 |
| 🌐 Calidad Web | 20% | XX/100 | x/x/x/x | 🟢/🟡/🔴 |

---

## 🔴 Críticos (bloquean deploy)

- **[dim][threat-id]** Descripción. `archivo:línea`
  - **Impacto:** por qué importa
  - **Fix:** cambio concreto

## 🟠 Alta prioridad

## 🟡 Media prioridad

---

## 🎯 Top fixes (priorizados por impacto)

### 1. [Fix de mayor impacto]
**Archivo:** `path/to/file:line` · **Dimensión:** [dim] · **Severidad:** [sev]
**Acción:** [edit concreto o comando]

### 2. …

---

## 📊 Cobertura

- OWASP: X/10 categorías evaluadas
- threat-db: X/N checks automatizables corridos
- RLS: X/Y tablas con políticas (vía `get_advisors` / estático)
- web-quality: [ejecutado vía Lighthouse / análisis estático]
- Capa profunda (adversarial): [no corrida / Resilience XX/100]
```

## Instrucciones al auditor

1. **Medir antes de juzgar.** Correr cada ripgrep / MCP real antes de asignar
   🔴/🟡/🟢 y el sub-score. No inventar hallazgos.
2. **Reusar, no reimplementar.** threat-db, security-scan.sh, web-quality y las
   categorías de `/inspeccionar` son la fuente — no copiar su lógica al skill.
3. **No penalizar lo no observable.** Sin MCP de Supabase → marcar "no verificado",
   no restar puntos (patrón token-auditor con logs ausentes).
4. **Un hallazgo, una dimensión.** Aplicar la regla anti-doble-conteo (Performance
   cuenta en Cache, no en Calidad Web).
5. **Read-only.** Este skill **solo audita**. Los fixes los aprueba el usuario.
   Nunca commitear, pushear ni editar código sin aprobación explícita.
6. **Paths absolutos** en todo hallazgo accionable.
7. **`quick`** = solo críticos de cada dimensión, sin score detallado ni subagents.

## Herramientas a usar

- `Read` — threat-db.yaml, web-quality/SKILL.md, `route.ts`, migraciones, configs
- `Glob` — `src/app/api/**/route.ts`, `supabase/migrations/*.sql`, `src/**/*.tsx`
- `Grep` — los `golden_path_check` de la threat-db sobre `src/`
- `Bash` — solo para ripgrep agregado (`rg -c`, `rg -l`) y `command -v codex`
- `Task` — subagents (qa-auditor / supabase-admin / db-architect) en modo `full`
- MCP Supabase — `get_advisors(type:"security")` y `get_advisors(type:"performance")`

## Relacionado

- `/inspeccionar` — el mismo checklist pero sobre el **diff** (pre-landing, rápido)
- `/adversarial-review` — la capa profunda que `--deep` invoca
- `/web-audit` (web-quality) — la dimensión Calidad Web en detalle
- `/audit-tokens` (token-auditor) — auditoría de eficiencia de **tokens** (distinto eje)
