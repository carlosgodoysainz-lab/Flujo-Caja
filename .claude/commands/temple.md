# /temple — Auditoría Full-Project (4 dimensiones, score compuesto)

> *"El acero se templa antes de soportar carga."*

Auditoría integral de **TODO el proyecto** (no solo el diff) en 4 dimensiones, con
UN reporte priorizado y un **Audit Score compuesto (0-100)**. Reúne en un comando
lo que antes exigía combinar `/inspeccionar` + `/web-audit` + checks de seguridad +
Supabase advisors.

A diferencia de `/inspeccionar` (solo el `git diff` vs main), `/temple` barre `src/`
completo con ripgrep, cruza la threat-db de ~77 amenazas, consulta los advisors de
Supabase vía MCP, y escribe un reporte versionable.

## Dimensiones

| Dimensión | Peso | Qué cubre |
|-----------|------|-----------|
| 🔒 Seguridad | 30% | threat-db.yaml, secrets, injection, auth/trust boundaries |
| 🗄️ Datos & Supabase/RLS | 25% | `get_advisors(security)`, RLS, filtros `user_id`, `service_role` |
| ⚡ Cache & Rendimiento | 25% | fetch sin cache, `revalidate`, N+1, índices, CDN, Web Vitals |
| 🌐 Calidad Web | 20% | A11y + SEO + Best Practices + `npm audit` (vía web-quality) |

## Modos de invocación

| Modo | Sintaxis | Qué hace |
|------|----------|----------|
| Full (default) | `/temple` | Las 4 dimensiones + reporte + score compuesto |
| Quick | `/temple quick` | Checklist rápido pre-deploy (solo críticos, sin score detallado) |
| Una dimensión | `/temple security` · `datos` · `cache` · `web` | Solo esa dimensión |
| Compare | `/temple compare` | Compara contra el último snapshot en `.context/audits/` |
| Capa profunda | `/temple --deep` | Añade `/adversarial-review` (opt-in, requiere codex) |

## Ejecución

Lee y ejecuta `.claude/skills/project-auditor/SKILL.md`.

## Ejemplo

```
/temple
/temple cache
/temple quick
/temple compare
/temple --deep
```
