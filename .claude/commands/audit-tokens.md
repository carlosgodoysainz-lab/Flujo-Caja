# /audit-tokens — Auditoria de Eficiencia de Tokens

Analiza el proyecto Forge actual y entrega un reporte con:
- **Token Efficiency Score** (0-100)
- **Hallazgos** categorizados (🔴 critico / 🟡 mejorable / 🟢 optimo)
- **Top 5 fixes** accionables con estimacion de ahorro

Audita 8 dimensiones: tamano del contexto (CLAUDE.md + AGENTS.md importado), hooks con matcher wildcard, bloat
de memoria, patrones de uso en logs, diversidad de tools, uso de subagentes,
prompts estaticos grandes, y aprendizajes acumulados.

## Ejecucion

Leer y ejecutar `.claude/skills/token-auditor/SKILL.md`.

## Ejemplo

```
/audit-tokens
```
