#!/usr/bin/env bash
# ============================================================
# Forge — Prompt Preflight Hook (UserPromptSubmit)
# ============================================================
# Mira el prompt ANTES de que se procese, buscando credenciales vivas.
#
# Este hook SÍ previene. `UserPromptSubmit` dispara antes de que el prompt
# se envíe, y `exit 2` lo bloquea y lo borra — la credencial no sale.
# Por eso el trato es híbrido, según qué tan inequívoco sea el hallazgo:
#
#   BLOQUEA (exit 2) — formato reconocible, falso positivo casi imposible,
#   y la fuga sería irreversible:
#     aws-access-key · sk-api-key · stripe-live-key · jwt
#
#   AVISA (exit 0 + additionalContext) — patrón laxo que se dispara con
#   código de ejemplo pegado; tragarse ese prompt enseña a desactivar el hook:
#     assigned-secret
#
# Fail-open: cualquier error inesperado deja pasar el prompt en silencio.
# Un hook de seguridad que rompe la sesión se desinstala en una semana.
#
# El log guarda el NOMBRE del patrón y nunca el texto del prompt: un log con
# la credencial dentro sería la fuga que este hook dice evitar.
# ============================================================

LOG_FILE=".claude/logs/prompt-preflight.log"

log() {
  mkdir -p "$(dirname "$LOG_FILE")"
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*" >> "$LOG_FILE"
}

# Fail-open: ante cualquier error, el prompt pasa. No se emite nada a stdout:
# en esta fase, todo stdout de un `exit 0` se inyecta al contexto del modelo.
trap 'log "ERROR: hook aborted at line $LINENO"; exit 0' ERR

HOOK_INPUT=$(cat)

# El esquema stdin de UserPromptSubmit no está publicado y las fuentes
# discrepan entre `prompt` y `prompt_text`, así que se aceptan ambos. Si
# ninguno aparece, se escanea el payload entero: los otros campos son rutas
# y enums, así que el ruido es nulo y el hook nunca se queda ciego por un
# cambio de nombre de campo aguas arriba.
PROMPT=$(echo "$HOOK_INPUT" \
  | grep -oE '"prompt(_text)?"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' \
  | head -1) || true
[ -n "$PROMPT" ] || PROMPT="$HOOK_INPUT"

# El texto llega escapado como JSON: `password = "x"` viaja como
# `password = \"x\"`. Sin des-escapar, la barra invertida se cuela entre el
# `=` y la comilla y el patrón `assigned-secret` nunca dispara — verificado.
PROMPT=$(printf '%s' "$PROMPT" | sed 's/\\"/"/g; s/\\[nrt]/ /g; s/\\\\/\\/g')

# --- Patrones que BLOQUEAN ----------------------------------------------
# Los cuatro salen de security-scan.sh (:67, :72, :77, :85). La rama
# `sk_test_` de :72 se deja fuera a propósito: es la llave de ejemplo de la
# documentación de Stripe y no hay nada que rotar.
#
# `sk-api-key` extiende su fuente, y es deliberado: `sk-[a-zA-Z0-9]{20,}`
# exige 20 alfanuméricos SEGUIDOS tras `sk-`, así que se le escapan los dos
# formatos que un usuario tiene hoy — `sk-proj-…` (OpenAI) y `sk-ant-api03-…`
# (Anthropic), ambos con guiones antes del cuerpo. Verificado. Se añade la
# rama con prefijo conocido en vez de abrir la clase a `[-_]`, que con 20+
# caracteres bloquearía texto normal con guiones.
HIT=""
if   echo "$PROMPT" | grep -qE 'AKIA[0-9A-Z]{16}'; then
  HIT="aws-access-key"
elif echo "$PROMPT" | grep -qE 'sk-(proj|ant|or|svcacct|admin)-[a-zA-Z0-9_-]{16,}|sk-[a-zA-Z0-9]{20,}'; then
  HIT="sk-api-key"
elif echo "$PROMPT" | grep -qE '(pk_live_|sk_live_)[a-zA-Z0-9]+'; then
  HIT="stripe-live-key"
elif echo "$PROMPT" | grep -qE 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+'; then
  HIT="jwt"
fi

if [ -n "$HIT" ]; then
  log "blocked: $HIT"
  # exit 2 bloquea el prompt y lo borra; el mensaje sale por stderr.
  echo "🔒 Forge detuvo este prompt: parece incluir una credencial viva ($HIT)." >&2
  echo "   No se envió. Ponla en .env.local y referénciala con process.env." >&2
  echo "   Si ya la habías pegado antes, rótala." >&2
  exit 2
fi

# --- Patrón que solo AVISA ----------------------------------------------
# `assigned-secret` es el laxo: salta con cualquier `password = "…"`, incluido
# el de un test de ejemplo. Mismas exclusiones que security-scan.sh:79, más
# las llaves de prueba de Stripe.
#
# La clase de comillas se arma en una variable. Escribirla como `["\x27]` es
# el bug que tuvo security-scan.sh durante releases: POSIX dice que la barra
# invertida es LITERAL dentro de una expresión entre corchetes, así que BSD y
# GNU grep leen esa clase como {", \, x, 2, 7} — sin la comilla simple.
# (ugrep sí la interpreta como hex, por eso no se ve en toda máquina.)
# Corregido en security-scan.sh con este mismo patrón (D-048).
Q="\"'"
if echo "$PROMPT" | grep -qEi "(password|secret|api_key|apikey|access_token|private_key)[[:space:]]*[=:][[:space:]]*[$Q][^$Q]{8,}"; then
  if ! echo "$PROMPT" | grep -qE '(process\.env|YOUR_|CHANGE_ME|example|placeholder|<.*>|sk_test_|pk_test_)'; then
    log "hit: assigned-secret"
    printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"%s"}}\n' \
      "Aviso de Forge: este prompt parece incluir un secreto asignado en código. Si es una credencial real, dile al usuario que la rote y la mueva a .env.local."
    exit 0
  fi
fi

# Sin hallazgo: silencio absoluto. Cualquier stdout aquí se volvería
# instrucción para el modelo.
exit 0
