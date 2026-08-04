# /design — Gestionar DESIGN.md

> **Tu rol:** Design Systems Lead que sintetiza decisiones de diseño en un archivo portable.
> **Output:** `DESIGN.md` en el root del proyecto — source of truth para todos los agentes y comandos.

## Detección de Contexto

```
¿Existe DESIGN.md en el root del proyecto?
  → SÍ: Modo 4 (actualización)
  → NO: ¿El usuario tiene un bundle de Claude Design?
    → SÍ: Modo 2 (extracción desde Claude Design)  ← DEFAULT recomendado
    → ¿Tiene URL de un sitio existente?
      → SÍ: Modo 3 (extracción desde URL)
      → NO: Modo 1 (generación desde cero con Impeccable + anti-AI-slop)
```

**Default recomendado:** Claude Design (`claude.ai/design`) — corre sobre Opus 4.7, entiende el codebase, y exporta un handoff bundle que Claude Code puede consumir directamente. Si el usuario no lo quiere usar, Modo 1 genera todo desde cero con el skill Impeccable y el resto de skills anti-AI-slop.

---

## Modo 1: Generación desde Cero (sin Claude Design)

**Cuando el usuario prefiere no usar Claude Design y quiere que Forge genere el DESIGN.md con los skills de diseño existentes (Impeccable + anti-AI-slop).**

### Paso 1: Discovery

Leer el skill Impeccable en `.claude/skills/impeccable/SKILL.md`.
Leer el template en `.claude/skills/impeccable/references/design-md-template.md`.

Preguntar al usuario:

```
🎨 Vamos a definir el Design System de tu proyecto.

1. ¿Qué SENSACIÓN debe transmitir?
   (Elegante hotel boutique / Eficiente cockpit / Cálida cafetería / Bold streetwear / Otra)

2. ¿Tienes colores de marca definidos?
   (Si no, propongo basándome en tu industria)

3. ¿Alguna app o sitio cuyo diseño admires?
   (No tiene que ser del mismo rubro)

4. ¿Cuál es el dispositivo principal de tus usuarios?
   (Mobile-first / Desktop-first / Ambos)
```

### Paso 2: Escanear Proyecto (si existe código)

Si hay código en `src/`:
1. Leer `tailwind.config.*` → colores y fuentes actuales
2. Leer `globals.css` → variables CSS
3. Revisar 3-5 componentes → patterns recurrentes
4. Detectar fuentes importadas en `layout.tsx`

### Paso 3: Generar DESIGN.md

Siguiendo el template de `.claude/skills/impeccable/references/design-md-template.md`:
- Secciones 1-5: Core design system (formato portable)
- Sección 6: Motion & Animation (extensión Forge)
- Sección 7: Anti-AI-Slop Markers (extensión Forge)
- Sección 8: Generation Notes (prompts naturales para regenerar)

**Escribir en lenguaje descriptivo + hex codes.** No CSS técnico.

Presentar al usuario para aprobación antes de guardar.

---

## Modo 2: Extracción desde Claude Design (DEFAULT)

**Cuando el usuario ya trabajó el diseño en `claude.ai/design` y quiere bajarlo al proyecto.**

> Claude Design (Anthropic Labs, abril 2026) es el tool oficial de diseño visual con Opus 4.7. Genera prototipos, wireframes y UI a través de conversación. Al estar listo, exporta un **handoff bundle** que Claude Code puede consumir.

### Paso 0: Advertir al usuario sobre la quota

```
⚠️  Claude Design tiene su propia quota semanal (separada de Claude Code).
    Puede agotarse rápido en plan Pro. Ten el diseño ya refinado antes de exportar.
```

### Paso 1: Recibir el handoff bundle

El usuario puede entregar el bundle de tres formas:

**Opción A — API URL (preferida):**
El usuario pega la URL del handoff que Claude Design genera. La instrucción típica tiene forma:
```
Fetch the design bundle from [URL] and implement it in this project.
```
Claude Code hace fetch directo del bundle vía WebFetch.

**Opción B — ZIP descargado:**
El usuario descarga el bundle y lo coloca en `.claude/design-bundles/[nombre]/`.
El bundle contiene:
- `design/` — HTML de cada pantalla
- `tokens.json` o equivalente — brand tokens (colores, tipografía, spacing)
- `components.json` — estructura de componentes
- `chat-history.md` — contexto de la conversación con Claude Design
- `README.md` — instrucciones de interpretación
- `copy.md` e `interactions.md` — microcopy y notas de interacción

**Opción C — Carpeta linkeada:**
El usuario comparte la URL interna de la org. Se le pide que exporte a ZIP o use la API URL.

### Paso 2: Parsear el bundle

1. Leer `tokens.json` / README → extraer paleta, tipografía, spacing, radii, shadows
2. Leer `components.json` → identificar componentes base y variantes
3. Revisar 2-3 HTMLs → inferir layout, motion y detalles de atmósfera no tokenizados
4. Leer `chat-history.md` → capturar el "por qué" de las decisiones clave

### Paso 3: Sintetizar DESIGN.md

Combinar datos del bundle con las extensiones Forge:
- Secciones 1-5: Extraídas del bundle (traducidas a lenguaje semántico + hex)
- Sección 6: Inferir motion patterns del HTML + `interactions.md`, o proponer defaults
- Sección 7: Aplicar AI Slop Test (Impeccable) y documentar markers
- Sección 8: Generation Notes en lenguaje natural (reutilizables en otros agentes)

### Paso 4: Preservar el bundle

Guardar el bundle original en `.claude/design-bundles/[nombre]/` (o referencia a la API URL) para que `/build` lo consulte durante la implementación de cada pantalla.

---

## Modo 3: Extracción desde URL

**Cuando el usuario proporciona una URL de un sitio existente.**

### Paso 1: Capturar

Usar Playwright MCP:
```
playwright_navigate → URL del sitio
playwright_screenshot → Captura visual de referencia
```

### Paso 2: Analizar

Inspeccionar el DOM:
- Fuentes cargadas, colores dominantes, spacing patterns
- Componentes recurrentes, estados de interacción
- Layout responsive

### Paso 3: Sintetizar

Generar DESIGN.md infiriendo el design system del sitio analizado.
Presentar al usuario para validación — pueden existir elementos no visibles.

---

## Modo 4: Actualización

**Cuando ya existe DESIGN.md.**

### Paso 1: Leer Estado Actual

```
1. Leer DESIGN.md existente
2. Escanear src/ para detectar divergencias
3. Comparar tokens documentados vs implementados
```

### Paso 2: Reportar Divergencias

```
📊 DESIGN.md vs Código Actual:

✅ Colores: 5/5 tokens en uso
⚠️  Tipografía: Body usa 'Inter' en 2 componentes (DESIGN.md dice 'DM Sans')
❌ Spacing: 8 valores hardcodeados no usan tokens
✅ Motion: Consistente con documentación
```

### Paso 3: Proponer Actualización

- ¿Actualizar DESIGN.md para reflejar el código? (el código es la verdad)
- ¿O normalizar el código para matchear DESIGN.md? (→ sugerir `/normalize`)

---

## Reglas

- **Lenguaje descriptivo** — "Ocean-deep Cerulean (#0077B6)", no "blue" ni "text-blue-600"
- **Siempre hex codes** — Nombre + hex en paréntesis, sin excepción
- **Traducir CSS** — "rounded-xl" → "generously rounded corners (12px)"
- **Explicar el POR QUÉ** — Cada decisión tiene una razón vinculada al producto
- **Portable** — Secciones 1-5 son agnósticas al tool de diseño (Claude Design, Figma, Stitch legacy, etc.)
- **No duplicar Impeccable** — DESIGN.md documenta decisiones, Impeccable define guidelines

---

*"Un design system que nadie lee es decoración. DESIGN.md es el contrato visual entre diseño y código."*
