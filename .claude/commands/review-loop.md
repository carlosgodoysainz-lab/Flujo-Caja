# /review-loop — Loop Automático de Revisión de Código

Implementa una tarea, lanza una revisión independiente con Codex (OpenAI) multi-agente,
y luego aborda el feedback — todo automáticamente vía Stop hook.

**Codex es opcional.** Con `codex` + `OPENAI_API_KEY` la revisión corre en otro proveedor
(sesgos distintos). Sin eso, el Stop hook devuelve el brief del **panel nativo** — los mismos
4 revisores con agentes de Forge — y el loop sigue igual. Ver README sección "Review Loop".

En el panel nativo aplica el contrato `VEREDICTO` definido en
`.claude/commands/adversarial-review.md`: cada revisor cierra con `VEREDICTO: PASA` o
`VEREDICTO: FALLA`, y una respuesta sin esa línea cuenta como FALLA — nunca como aprobación.

---

## Protocolo de Ejecución

Al recibir `/review-loop <tarea>`, ejecutar este setup primero:

```bash
set -e

# 1. Verificar dependencias (jq hace falta en las dos rutas; codex es opcional)
command -v jq >/dev/null 2>&1 || { echo "Error: jq requerido. brew install jq"; exit 1; }
if command -v codex >/dev/null 2>&1 && [ -n "$OPENAI_API_KEY" ]; then
  echo "Modo de revisión: codex"
else
  echo "Modo de revisión: nativo (sin codex) — el Stop hook lanzará el panel de agentes de Forge"
fi

# 2. Prevenir loops duplicados
if [ -f .claude/review-loop.local.md ]; then
  echo "Error: Ya hay un review loop activo. Usa /cancel-review primero."
  exit 1
fi

# 3. Generar Review ID único
REVIEW_ID="$(date +%Y%m%d-%H%M%S)-$(openssl rand -hex 3 2>/dev/null || head -c 3 /dev/urandom | od -An -tx1 | tr -d ' \n')"

# 4. Habilitar multi-agent en Codex
CODEX_CONFIG="${HOME}/.codex/config.toml"
if [ ! -f "$CODEX_CONFIG" ]; then
  mkdir -p "${HOME}/.codex"
  printf '[features]\nmulti_agent = true\n' > "$CODEX_CONFIG"
  echo "Creado ~/.codex/config.toml con multi_agent habilitado"
elif ! grep -qE '^\s*multi_agent\s*=\s*true' "$CODEX_CONFIG"; then
  if grep -qE '^\[features\]' "$CODEX_CONFIG"; then
    if [ "$(uname)" = "Darwin" ]; then
      sed -i '' '/^\[features\]/a\'$'\n''multi_agent = true' "$CODEX_CONFIG"
    else
      sed -i '/^\[features\]/a multi_agent = true' "$CODEX_CONFIG"
    fi
  else
    printf '\n[features]\nmulti_agent = true\n' >> "$CODEX_CONFIG"
  fi
  echo "multi_agent habilitado en ~/.codex/config.toml"
else
  echo "Codex multi-agent: ya habilitado"
fi

# 5. Registrar Stop hook en .claude/settings.json
mkdir -p .claude
SETTINGS_FILE=".claude/settings.json"
HOOK_CMD=".claude/hooks/stop-hook.sh"

if [ ! -f "$SETTINGS_FILE" ]; then
  echo '{}' > "$SETTINGS_FILE"
fi

# Agregar Stop hook si no existe ya
if ! jq -e '.hooks.Stop' "$SETTINGS_FILE" > /dev/null 2>&1; then
  jq '. + {"hooks": {"Stop": [{"hooks": [{"type": "command", "command": ".claude/hooks/stop-hook.sh", "timeout": 900, "statusMessage": "Review loop: verificando fase..."}]}]}}' \
    "$SETTINGS_FILE" > "${SETTINGS_FILE}.tmp" && mv "${SETTINGS_FILE}.tmp" "$SETTINGS_FILE"
  echo "Stop hook registrado en .claude/settings.json"
else
  echo "Stop hook: ya registrado"
fi

# 6. Crear directorio de reviews
mkdir -p .claude reviews

# 7. Crear state file
cat > .claude/review-loop.local.md << STATE_EOF
---
active: true
phase: task
review_id: ${REVIEW_ID}
started_at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
---

$ARGUMENTS
STATE_EOF

echo ""
echo "Review Loop activado"
echo "  ID:    ${REVIEW_ID}"
echo "  Fase:  1/2 (implementar)"
echo "  Review: reviews/review-${REVIEW_ID}.md (se genera al terminar)"
echo ""
echo "Implementa la tarea. Al terminar, Codex revisará automáticamente."
```

Después de que el setup complete sin errores, **implementa la tarea descrita en los argumentos**.
Trabaja de forma completa y rigurosa. Escribe código limpio, bien estructurado.

Cuando creas que la tarea está terminada, para. El Stop hook tomará control automáticamente:
1. Lanzará Codex multi-agente para una revisión independiente
2. Te presentará el reporte para que lo abordes

**REGLAS:**
- Completa la tarea al máximo antes de parar
- No pares prematuramente
- No tienes que gestionar el review — el hook lo hace
