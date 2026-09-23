# /adversarial-review — Revisión Adversarial de Código

Lanza 4 agentes atacantes que intentan activamente ROMPER tu código.
A diferencia de `/review-loop` (que busca calidad), esto busca **vulnerabilidades**.

**Codex es opcional.** Con `codex` + `OPENAI_API_KEY` los atacantes corren en otro proveedor
(sesgos distintos, que es lo que hace valiosa una revisión adversarial). Sin eso, corre el
**panel nativo** con los agentes que Forge ya trae: mismo reporte, mismo Resilience Score.

---

## Cuándo usar

| Situación | Comando |
|-----------|---------|
| Review de calidad general | `/review-loop` |
| **Buscar vulnerabilidades y fallos** | **`/adversarial-review`** |
| Review de producto/UX | `/fragua-review` |

Úsalo después de completar una feature, antes de deploy, o cuando quieras stress-test.

---

## Los 4 Agentes Atacantes

| Agente | Rol | Busca |
|--------|-----|-------|
| El Intruso | Pentester senior | OWASP Top 10, injection, auth bypass, IDOR, secrets |
| El Caos | Chaos engineer | Race conditions, cascadas, memory leaks, consistencia |
| El Destructor | QA adversarial | Boundary values, unicode, prototype pollution, dates |
| El Saboteador | Usuario malicioso | Doble-click, back button, expired sessions, offline |

---

## Protocolo de Ejecución

Al recibir `/adversarial-review [scope opcional]`, ejecutar:

### Paso 1: Setup

```bash
set -e

# jq hace falta en las dos rutas
command -v jq >/dev/null 2>&1 || { echo "Error: jq requerido. brew install jq"; exit 1; }

# Elegir ruta: Codex si hay binario Y credencial; si no, panel nativo.
# Misma expresión que usa /temple --deep, para que las dos decidan igual.
if command -v codex >/dev/null 2>&1 && [ -n "$OPENAI_API_KEY" ]; then
  MODO_REVISION=codex
else
  MODO_REVISION=nativo
fi
echo "Modo de revisión: ${MODO_REVISION}"

# Generar Attack ID
ATTACK_ID="$(date +%Y%m%d-%H%M%S)-$(openssl rand -hex 3 2>/dev/null || head -c 3 /dev/urandom | od -An -tx1 | tr -d ' \n')"

# Config de Codex: solo si vamos por esa ruta (no tocar ~/.codex de quien no usa Codex)
if [ "$MODO_REVISION" = "codex" ]; then
# Asegurar multi-agent habilitado
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
fi

chmod +x .claude/hooks/adversarial-attack.sh
fi

mkdir -p reviews

echo ""
echo "Adversarial Review activado"
echo "  Attack ID: ${ATTACK_ID}"
echo "  Report:    reviews/adversarial-${ATTACK_ID}.md"
echo ""
```

### Paso 2a: Ejecutar ataque (solo si `MODO_REVISION=codex`)

```bash
.claude/hooks/adversarial-attack.sh "$ATTACK_ID" "reviews/adversarial-${ATTACK_ID}.md" "$SCOPE"
```

Donde `$SCOPE` es el argumento opcional que el usuario pasó (ej: "auth flow", "payment system", "API routes").

Si no se pasó scope, dejar vacío — el ataque cubrirá todo el proyecto.

### Paso 2b: Panel nativo (si `MODO_REVISION=nativo`)

Lanza los mismos vectores con los agentes de Forge, **en paralelo vía `Task`**, y escribe
el **mismo reporte** en `reviews/adversarial-${ATTACK_ID}.md`. No hay agentes nuevos: cada
fila del Attack Surface Summary tiene dueño.

| Vector (fila del reporte) | Agente | Qué ataca |
|---|---|---|
| El Intruso (Seguridad) | `codebase-analyst` | Corre los `golden_path_check` de `.claude/skills/la-herreria/references/threat-db.yaml` sobre `src/` y cruza el PASE 1 de `.claude/commands/inspeccionar.md` (injection, auth boundaries, frontera server/client) |
| El Caos (Resilience) | `backend-specialist` | Race conditions y estados imposibles en Server Actions y API Routes, cascadas de fallo, reintentos sin idempotencia, promesas sin `catch` |
| El Destructor (Edge Cases) | `testing-engineer` | Boundary values, unicode, fechas y zonas horarias, prototype pollution, payloads vacíos y gigantes |
| El Saboteador (UX) | `qa-auditor` | Doble-click, back button, sesión expirada, offline, estados de error faltantes. **Solo si el proyecto tiene UI de navegador** |

- Si el proyecto usa Supabase, **`supabase-admin`** corre dentro del brief de El Intruso
  (RLS por tabla + `get_advisors`) y sus hallazgos se consolidan en esa misma fila: es una
  extensión, no una fila nueva. El conteo de atacantes del encabezado no cambia (3, o 4 con UI).
- **Si tu plataforma no puede lanzar subagentes** (Codex y Gemini no tienen `Task`), corre
  los revisores **en secuencia en el mismo hilo**, uno por vez, cerrando cada uno con su
  línea `VEREDICTO:` antes de empezar el siguiente.
- Consolida con la **misma fórmula** que usa la ruta Codex:
  `Resilience Score = 100 - (críticos*25 + altos*10 + medios*3 + bajos*1)`, mínimo 0, y la
  misma plantilla de reporte (`## Resilience Score`, `## Attack Surface Summary`,
  `## CRÍTICOS` / `ALTOS` / `MEDIOS` / `BAJOS`, `## Vectores Resistidos`).
- En el encabezado del reporte, anota la cobertura: `Modo: nativo` y, si algún revisor
  quedó incompleto, dilo ahí (ver contrato de abajo).

#### Contrato `VEREDICTO` (aplica a los dos paneles nativos de Forge)

Cada revisor **termina su respuesta con esta línea literal y nada después**:

```
VEREDICTO: PASA
```

o `VEREDICTO: FALLA`.

- Una respuesta **sin** esa línea cuenta como **FALLA**, nunca como aprobación — porque un
  subagente que se quedó sin turnos devuelve hallazgos truncados y sin veredicto, y leer ese
  silencio como "pasó" es exactamente el modo de falla que esta regla mata.
- Un revisor sin veredicto se marca `FALLA (sin veredicto)` y **se relanza una vez**,
  nombrándole los archivos que no mencionó. Si a la segunda tampoco cierra, el reporte lo
  declara `FALLA (revisión incompleta)` y lo anota en la cobertura.
- Un revisor en FALLA **no** resta puntos del Resilience Score (el score sale de los
  hallazgos, no de los veredictos): lo que hace es marcar la cobertura como parcial, para
  que nadie lea un 92/100 que salió de tres revisores mudos.
- Un revisor incompleto **nunca** contribuye a "Vectores Resistidos": no probó nada.

### Paso 3: Presentar resultados

Lee el reporte generado en `reviews/adversarial-${ATTACK_ID}.md` y presenta al usuario:

1. **Resilience Score** — el número principal (X/100)
2. **Attack Surface Summary** — la tabla resumen
3. **CRÍTICOS primero** — estos necesitan fix inmediato
4. Para cada hallazgo: vector + reproducción + fix recomendado
5. **Vectores Resistidos** — destacar lo que SÍ aguantó (refuerza confianza)
6. Preguntar: "¿Qué vulnerabilidades quieres abordar primero?"

**REGLAS:**
- Presenta TODOS los críticos, no omitas ninguno
- Para cada hallazgo, ofrece tu evaluación independiente (¿estás de acuerdo? ¿es un falso positivo?)
- Sugiere priorización: críticos → altos → medios
- Si el Resilience Score es < 50: recomendar pausar deployment
- Si el Resilience Score es > 80: felicitar pero no bajar la guardia
