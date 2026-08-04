---
name: add-ui-kit
description: |
  Genera una ruta /ui que es la fuente operativa de diseño del proyecto — no una galería bonita,
  sino el contrato visual entre agentes. Incluye por cada componente: todas las variantes,
  todos los estados, qué tokens CSS usa, cuándo usarlo / cuándo no, y motion spec.
  También genera patrones SaaS completos (dashboard, tabla, onboarding, empty state),
  un motion system como archivo separado, y un COMPONENT_RULES.md que los agentes leen.

  Dos modos:
  - FRESH: proyecto nuevo. Entrevista de branding → tokens → motion system → showcase completo.
  - REDESIGN: proyecto existente. Scan de inconsistencias → reporte → estandarización.

  Usar cuando: "genera el ui kit", "add ui kit", "component showcase", "biblioteca de componentes",
  "quiero ver todos los componentes", "storybook", "kitchen sink", "componentes ui", "ui playground",
  "rediseña los componentes", "estandariza el ui", "los componentes se ven diferentes".

  Pre-requisito: shadcn/ui instalado (npx shadcn@latest init).
  NO USAR para: auditorías de accesibilidad (usar /web-audit), rediseño completo de marca (usar /redesign).
allowed-tools: Bash(npm *), Bash(npx *), Bash(find *), Bash(grep *), Bash(ls *), Read, Write, Edit, Glob, Grep
---

# Add UI Kit — Component Showcase

La ruta `/ui` es la fuente de verdad visual del proyecto.
Cuando existe este archivo, ningún agente puede inventar variantes nuevas de componentes —
SIEMPRE referencia lo que está en `/ui` antes de crear cualquier cosa.

El objetivo no es una galería. Es un contrato: cada componente documenta qué tokens usa,
cuándo aplica, qué animar y cómo. Los agentes que construyen features leen esto primero.

**PRIMER PASO SIEMPRE:** Detectar el modo correcto antes de ejecutar nada.

---

## Cuándo ejecutar este skill en el pipeline de Forge

### Proyecto nuevo (pasó por /plan)

```
/plan → Blueprint + DESIGN.md generado (Step 8 del pipeline)
            ↓
       /add-ui-kit   ← AQUÍ, después de /plan y ANTES de /build
            ↓        Detecta DESIGN.md → lo usa como base de tokens
       Design Discovery (referencias visuales + enriquecimiento de DESIGN.md)
            ↓
       Showcase generado → /ui disponible
            ↓
       /build → agentes leen /ui antes de crear cualquier componente
```

DESIGN.md del /plan define la estructura del design system, pero la Design Discovery
de este skill añade referencias visuales reales (apps que le gustan al usuario,
capturas de pantalla) que la generación automática del /plan no puede incluir.

### Proyecto existente (REDESIGN)

```
Proyecto corriendo con UI ya construida
            ↓
       /add-ui-kit   ← AQUÍ, en cualquier momento
            ↓
       Scan de inconsistencias (colores hardcodeados, fuentes AI-slop, motion roto)
            ↓
       Design Discovery (define la identidad visual nueva del redesign)
            ↓
       Showcase regenerado + globals.css actualizado
            ↓
       COMPONENT_RULES.md como enforcement para los agentes
```

En REDESIGN, la Discovery es especialmente importante porque el proyecto puede tener
un sistema visual inconsistente o generado por IA sin identidad propia.

---

## Sección 0: Filosofía

Un showcase sin contexto operativo es decoración. El problema del AI slop no es que los
componentes se vean mal — es que los agentes los generan sin entender cuándo usarlos,
cómo animarlos, qué token de color aplica, o cuál es el estado vacío correcto.

Este skill resuelve eso generando documentación ejecutable: el showcase mismo muestra
cómo se ven, y el `COMPONENT_RULES.md` explica las reglas que el agente debe seguir.

Regla de producción: el showcase solo se renderiza en desarrollo. En producción retorna
un 404 o un mensaje neutral. Nunca exponer la ruta `/ui` como feature pública.

---

## Sección 1: Detección de Modo

### Paso 1A — Verificar si el proyecto ya tiene UI construida

```bash
find src -name "*.tsx" | grep -v "node_modules" | wc -l
```

Si el resultado es > 10 archivos TSX → **MODO REDESIGN**
Si el resultado es ≤ 10 archivos TSX → **MODO FRESH**

### Paso 1B — Verificar si ya existe DESIGN.md

```bash
ls -la DESIGN.md 2>/dev/null && echo "EXISTS" || echo "MISSING"
```

Si existe → leerlo completo antes de continuar. Los tokens ahí son la autoridad.
Si no existe → el skill generará los tokens desde la entrevista.

### Paso 1C — Verificar shadcn/ui instalado

```bash
ls src/components/ui/ 2>/dev/null | head -5 || echo "NO_SHADCN"
```

Si NO_SHADCN → detener y decir al usuario: "Ejecuta `npx shadcn@latest init` primero, luego vuelve a correr /add-ui-kit."

### Paso 1D — Verificar Agentation y feedback previo

```bash
# Check if Agentation toolbar is installed
grep -r "agentation\|Agentation" src/ --include="*.tsx" --include="*.ts" 2>/dev/null | head -3 || echo "NO_AGENTATION"

# Check if there's previous feedback to incorporate
ls -la UI_FEEDBACK.md 2>/dev/null && echo "HAS_FEEDBACK" || echo "NO_FEEDBACK"
```

Si HAS_FEEDBACK → leer `UI_FEEDBACK.md` completo antes de continuar.
  Mostrar al usuario el feedback encontrado y confirmar qué cambios se incorporarán.
  El feedback informa los tokens, variantes y reglas del showcase regenerado.

Si NO_AGENTATION → las instrucciones del showcase muestran la versión básica de feedback (solo texto).
Si HAS_AGENTATION → las instrucciones muestran la integración con Agentation (anotaciones visuales).

---

## Sección 2: Design Discovery — Sesión de Referencias + Identidad Visual

Ejecutar en AMBOS modos antes de generar el showcase.
En FRESH: sesión completa.
En REDESIGN: si DESIGN.md existe con tokens ya definidos, preguntar solo la Parte A
(referencias visuales) para enriquecer lo que ya hay.

Esta no es una entrevista rápida de 5 preguntas. Es una sesión de discovery donde
el usuario comparte qué apps le gustan, qué estilo busca, y qué quiere evitar.
El resultado es un conjunto de tokens informados por referencias reales, no solo por
descripciones abstractas.

**Estructura del Discovery (3 partes con ramificación):**

```
Parte A — Referencias visuales (siempre)
   │
   ├─ Si el usuario nombra una marca específica:
   │     → leer library/<slug>/DESIGN.md como hint
   │     → continuar a Parte B (afinar identidad sobre ese hint)
   │
   ├─ Si el usuario es vago ("no sé", "lo que recomiendes", "no tengo marca"):
   │     → Parte A.5 — 5 Visual Directions deterministas
   │     → si elige direction → tokens verbatim → SKIP Parte B → Procesamiento
   │     → si elige "custom" → Parte B
   │
   └─ Si el usuario tiene marca clara propia:
         → continuar a Parte B con esa marca como input
```

---

### Parte A — Recopilación de Referencias (SIEMPRE, ambos modos)

Presentar al usuario este bloque completo:

```
Antes de generar el UI Kit, necesito entender qué te inspira visualmente.

PASO 1 — SOFTWARE DE REFERENCIA
Nombra 1 a 3 apps, SaaS o sitios web cuyo diseño te gusta.
Pueden ser competidores, productos que usas, o simplemente diseño que admiras.

Ejemplos: Linear, Notion, Stripe, Vercel, Loom, Figma, Raycast, Arc,
          Superhuman, Clerk, Resend, Supabase, PlanetScale, Cron...

¿Cuáles son los tuyos?

PASO 2 — CAPTURAS DE PANTALLA (opcional pero muy valioso)
Si tienes capturas de pantalla de interfaces que te gustan
— ya sean de esas apps u otras — pégalas aquí directamente.
Puedo analizar el estilo visual, los colores, la tipografía y los patrones de layout.

PASO 3 — QUÉ QUIERES EVITAR
¿Hay algún estilo visual que definitivamente NO quieres?
Ej: "nada con gradients morados", "sin bordes muy redondeados", 
    "no quiero que parezca una app de consumidor masivo", "nada genérico de Material Design"
```

Esperar las respuestas antes de continuar. Procesar según el caso:

**Caso 1 — El usuario nombra una marca que está en `library/`:**

Si menciona Linear, Stripe, Vercel, Apple, Notion, Tesla, Cursor, Supabase,
Anthropic (slug `claude/`), Cohere, Mistral, ElevenLabs, Spotify, Webflow,
Sanity, Airbnb, o cualquier slug listado en
[`design-systems/library/INDEX.md`](../../design-systems/library/INDEX.md):

1. Leer `forge/.claude/design-systems/library/<slug>/DESIGN.md` completo
2. Mostrar al usuario: "Encontré el DESIGN.md de [marca] en la library — es una
   referencia inspirada en su lenguaje. ¿Quieres que lo use como base y lo
   adaptemos a tu proyecto, o prefieres tomar solo algunos elementos?"
3. Saltar a Parte B con ese DESIGN.md cargado como contexto

**Caso 2 — El usuario es vago / indeciso:**

Señales: "no sé", "lo que recomiendes", "no tengo color de marca", "elige tú",
"algo limpio pero no genérico", "necesito ayuda decidir", "como Linear pero diferente".

→ Pasar a **Parte A.5** (5 visual directions deterministas).

**Caso 3 — El usuario tiene marca clara propia:**

Marca con colores, fuente y guidelines ya definidos por él.
→ Pasar a Parte B con esa marca como input fuerte.

**Caso 4 — Capturas de pantalla pegadas:**

Analizar para extraer:
- Color dominante y acento (extraer hex aproximado)
- Estilo tipográfico (weight, tamaño relativo de headings vs body)
- Densidad de información por pantalla
- Uso de bordes, sombras, y espacio

→ Combinar con el caso anterior que aplique.

---

### Parte A.5 — 5 Visual Directions Deterministas

Esta sección **solo se ejecuta** si el usuario fue vago en Parte A (Caso 2).
Si el usuario nombró una marca o tiene la suya propia, saltar directo a Parte B.

El propósito: en lugar de improvisar paletas y tipografías desde una descripción
abstracta, ofrecer 5 direcciones pre-curadas con OKLch palette + font stack +
posture ya resueltos. Una elección → 80% del resultado en 30 segundos sin
parálisis ni model freestyle.

**Antes de mostrar las direcciones, leer el spec canónico:**

```
Read forge/.claude/skills/add-ui-kit/references/directions.md
```

Ese archivo contiene los 5 specs completos (paleta OKLch + fonts + posture +
cross-references al library). NO improvisar — los valores son determinísticos
y deben ir verbatim al `globals.css` del proyecto.

**Bloque a presentar al usuario:**

```
No hay marca clara — perfecto, tengo 5 direcciones visuales pre-curadas.
Cada una trae paleta OKLch, font stack y "cómo se comporta" ya resueltos.
Una elección y armamos el UI Kit en torno a ella.

  [1] Editorial — Monocle / FT Magazine
      Print-magazine. Whitespace generoso, serif headlines, papel + tinta + un acento cálido.
      Acento: rust cálido. Vibe: Monocle, NYT Magazine.

  [2] Modern Minimal — Linear / Vercel
      Software-native, near-greyscale, un único acento saturado. La cromática desaparece.
      Acento: cobalt. Vibe: Linear, Vercel, Notion 2024.

  [3] Warm & Soft — Stripe pre-2020 / Headspace
      Cream backgrounds, radii suaves, friendly fintech sin caer en cute.
      Acento: terracotta. Vibe: Stripe pre-2020, Mercury, Substack.

  [4] Tech / Utility — Datadog / GitHub
      Data-dense, mono-friendly, info per square inch. Para engineers y operators.
      Acento: signal green. Vibe: Datadog, GitHub, Sentry.

  [5] Brutalist / Experimental — Are.na / Yale
      Tipografía gritada, grid visible, serif oversized. Fealdad deliberada como confianza.
      Acento: hot red. Vibe: Are.na, Yale Center, MSCHF.

Escribe el número (1–5).
O escribe "custom" si prefieres entrevista a medida con preguntas abiertas.
También puedes pedir un override de acento ("3 pero con verde en vez de terracotta").
```

**Procesamiento de la respuesta:**

- Si el usuario escribe `1`–`5`:
  1. Cargar el spec correspondiente desde `references/directions.md`
  2. Aplicar tokens **verbatim** (los valores OKLch van sin modificación al `:root`)
  3. Si hay accent override (ej: "3 pero con verde"), cambiar SOLO `--accent`,
     dejando bg/surface/fg/muted/border intactos
  4. Ofrecer leer 1-2 cross-references del library:
     "Elegiste [direction]. ¿Quieres que lea library/[slug]/DESIGN.md para
     mostrarte cómo se ve este lenguaje aplicado a un producto real antes de
     generar el showcase?"
  5. **SKIP Parte B** — saltar directo a "Procesamiento de Respuestas"
     (más abajo en esta misma sección). Los tokens ya están resueltos.

- Si el usuario escribe `custom` (o cualquier texto que no es número 1–5):
  → Continuar a Parte B (entrevista abierta tradicional).

- Si el usuario combina ("mitad 2 mitad 4"):
  → Rechazar la combinación. Decir: "Mezclar direcciones es lo que produce
  AI slop. Elige una como base y luego ajustamos detalles. O escribe 'custom'
  para una entrevista abierta sin direcciones predefinidas."

**Reglas críticas (de `references/directions.md` — mantener estrictas):**

1. Tokens van **verbatim**. No re-mapear OKLch a "el color más cercano que conozco".
   Tailwind 3.4+ y todos los browsers modernos soportan OKLch nativamente.
2. Posture es contrato. Si la direction dice "sin sombras", no se agregan.
   Si dice "monospace como body", no se cambia "porque es más legible".
3. La única personalización permitida es el accent override (un solo token).
4. No combinar direcciones. Si el usuario insiste, ofrecer `custom` en su lugar.

---

### Parte B — Identidad Visual

Esta sección se ejecuta cuando:
- El usuario tiene marca clara propia (Caso 3 de Parte A)
- El usuario nombró una marca de la library (Caso 1) y queremos afinar tokens
- El usuario eligió `custom` en Parte A.5

Si el usuario eligió una de las 5 direcciones en Parte A.5, **saltar esta sección**
y pasar directo a "Procesamiento de Respuestas".

Después de las referencias, hacer estas preguntas (también en un solo bloque):

```
Con esas referencias en mente, responde esto para terminar de definir los tokens:

1. COLOR — ¿Tienes un color de marca definido?
   Si sí: dime el hex o descríbelo ("azul marino oscuro", "verde pizarra")
   Si no: yo elijo uno coherente con tus referencias y lo justificaré

2. MODO DE FONDO — ¿Prefieres:
   A) Light mode por defecto (fondo blanco/crema, texto oscuro)
   B) Dark mode por defecto (fondo oscuro, texto claro)
   C) Los dos, con toggle

3. TIPOGRAFÍA — ¿Tienes fuente preferida?
   Si no, dime el tono que buscas: técnico, editorial, humanista, geométrico, o clásico
   Inter, Roboto y Arial están prohibidos — hacen que todo se vea igual

4. NIVEL DE DETALLE VISUAL (influye en radios, sombras, densidad):
   A) Muy limpio — casi sin decoración, espacio generoso
   B) Equilibrado — sistema claro con detalles cuidados
   C) Rico en detalles — texturas, sombras, componentes muy trabajados
```

---

### Tabla de Fuentes Recomendadas por Personalidad

Usar esta tabla para sugerir fuentes cuando el usuario no tenga una:

| Personalidad | Fuentes recomendadas | Carácter |
|---|---|---|
| Clean/Minimal | Geist Sans, Plus Jakarta Sans | Geométrico moderno, mucho espacio |
| Bold/Saturated | Syne, Space Grotesk | Carácter fuerte, letras únicas |
| Soft/Rounded | DM Sans, Nunito | Amigable, curvas orgánicas |
| Sharp/Professional | IBM Plex Sans, Outfit | Neutro técnico, alta legibilidad |
| Dark/Focused | JetBrains Mono, Fira Code (como display) | Técnico, terminal, dev aesthetic |

Referencias de software → fuentes típicas de esos productos:
- Linear, Vercel, Raycast → Geist, Inter alternativa (pero buscar diferenciación)
- Notion, Cron → Plus Jakarta Sans, DM Sans
- Stripe, Clerk → Sohne, Söhne — alternativa: IBM Plex Sans
- Figma → Inter (prohibido como default — buscar alternativa)
- Supabase → Space Grotesk

---

### Procesamiento de Respuestas

Tres caminos llegan aquí:

**Camino 1 — Vino de Parte A.5 (visual direction elegida):**

Los tokens ya están resueltos verbatim del spec en `references/directions.md`.
Mostrar al usuario los OKLch + fonts + posture y pedir confirmación:

```
TOKENS APLICADOS — [nombre del proyecto] · [direction-id]

Direction:        [Editorial Monocle / Modern Minimal / Warm & Soft / Tech Utility / Brutalist]
Background:       oklch(...)  → --background
Surface:          oklch(...)  → --card
Foreground:       oklch(...)  → --foreground
Muted:            oklch(...)  → --muted-foreground
Border:           oklch(...)  → --border
Accent:           oklch(...)  → --accent / --primary  [+ override del usuario si lo pidió]
Display font:     [stack]     → --font-display
Body font:        [stack]     → --font-body
Mono font:        [stack si aplica] → --font-mono
Posture:          [bullets del spec]
```

Si vino de aquí, NO calcular Personalidad/Audiencia/Border radius — son
implícitos del posture de la direction (ver el archivo de referencia).

**Camino 2 — Vino de Parte B (entrevista tradicional / marca propia / library):**

Calcular tokens desde las respuestas + referencias + capturas:

```
TOKENS CALCULADOS — [nombre del proyecto]

Color primario:    [hex] → --primary en shadcn
Color acento:      [hex] → --accent en shadcn
Color fondo:       [hex] → --background
Color superficie:  [hex] → --card
Color borde:       [hex] → --border
Texto principal:   [hex] → --foreground
Texto secundario:  [hex] → --muted-foreground
Fuente:            [nombre + Google Fonts import]
Border radius:     [2px / 6px / 8px / 12px / 16px] → --radius
Shadow style:      [none / subtle / medium / dramatic]
Personalidad:      [A/B/C/D/E]
Audiencia:         [A/B/C]
```

**Camino 3 — Vino de Parte A con marca específica de la library:**

Tomar los tokens del `library/<slug>/DESIGN.md` como base y permitir al
usuario adaptar (cambiar primario, suavizar radii, ajustar densidad). El
output es híbrido: estructura del library entry + ajustes del usuario.

---

En los tres casos: mostrar al usuario y pedir confirmación. Solo continuar
cuando confirme.

### Instalación de Componentes shadcn

```bash
# Base — siempre
npx shadcn@latest add button input card badge separator
npx shadcn@latest add dialog sheet dropdown-menu popover tooltip
npx shadcn@latest add table select textarea switch checkbox
npx shadcn@latest add avatar skeleton alert progress tabs
npx shadcn@latest add scroll-area command
```

---

## Sección 3: Motion System

Crear este archivo ANTES de generar el showcase. Es una dependencia del showcase.

### Archivo: `src/features/ui-kit/motion.ts`

```ts
/**
 * Motion system — Single source of truth for all animations.
 * Agents MUST use these values. Never add arbitrary transition durations.
 *
 * Safe properties to animate: transform, opacity, filter, color, background-color
 * NEVER animate: width, height, padding, margin, top, left, right, bottom
 * Reason: animating layout properties triggers reflow on every frame — kills performance.
 */

export const motion = {
  duration: {
    instant: "75ms",   // Icon swaps, checkmarks appearing
    sm:      "150ms",  // Hover states, focus rings, small badge changes
    md:      "200ms",  // Entrances, state changes, dropdown open
    lg:      "350ms",  // Page transitions, drawer slides, modal appear
    xl:      "500ms",  // Complex sequences, orchestrated multi-element animations
  },
  easing: {
    // Default for most interactions — snaps into position, smooth stop
    default: "cubic-bezier(0.16, 1, 0.3, 1)",     // ease-out-expo
    // Elements entering the screen
    enter:   "cubic-bezier(0.0, 0.0, 0.2, 1)",
    // Elements leaving the screen
    exit:    "cubic-bezier(0.4, 0.0, 1, 1)",
    // Subtle bounce — use RARELY, only for delightful micro-interactions
    spring:  "cubic-bezier(0.34, 1.56, 0.64, 1)",
  },
  // Tailwind shorthand classes (generate these in tailwind.config if needed)
  tw: {
    hover:      "transition-colors duration-[150ms] ease-out",
    enter:      "transition-all duration-[200ms] cubic-bezier(0.0,0.0,0.2,1)",
    exit:       "transition-all duration-[200ms] cubic-bezier(0.4,0.0,1,1)",
    drawer:     "transition-transform duration-[350ms] cubic-bezier(0.16,1,0.3,1)",
    modal:      "transition-all duration-[200ms] cubic-bezier(0.16,1,0.3,1)",
  },
  // What to animate (always) vs what to NEVER animate
  safe:   ["transform", "opacity", "filter", "color", "background-color", "border-color", "box-shadow"],
  unsafe: ["width", "height", "padding", "margin", "top", "left", "right", "bottom", "max-height"],
}

// Tailwind classes for common animation patterns
export const motionClasses = {
  // Fade in from bottom (list items, cards entering)
  fadeInUp: "animate-in fade-in slide-in-from-bottom-2 duration-200",
  // Fade in (overlays, tooltips)
  fadeIn:   "animate-in fade-in duration-150",
  // Zoom in (modals, dialogs)
  zoomIn:   "animate-in zoom-in-95 fade-in duration-200",
  // Slide in from right (drawers, side panels)
  slideInRight: "animate-in slide-in-from-right duration-[350ms]",
}
```

---

## Sección 4: Generación del Component Showcase

Crear los siguientes archivos. El showcase se organiza en dos partes:
- **Part 1 — Design Tokens & Components**: Colors, Typography, Buttons, Inputs, Cards, Badges, Alerts, Navigation, Loading, Tabs, Avatars, Toast/Feedback, Empty States.
- **Part 2 — SaaS Patterns**: composiciones reales de pantallas SaaS con los componentes ensamblados.

### Componente: `src/features/ui-kit/components/viewport-toggle.tsx`

Crear este componente antes del showcase principal. Envuelve todo el contenido del showcase:

```tsx
// ViewportToggle — simula viewports dentro del showcase sin iframes
//
// Tres modos:
//   "desktop" → sin restricción de ancho (ancho completo del browser)
//   "tablet"  → max-width: 768px, centrado, con sombra lateral para indicar el recorte
//   "mobile"  → max-width: 375px, centrado, con sombra lateral
//
// El toggle (3 botones) siempre está en ancho completo, fijo en la parte superior del showcase
// El contenido interno transiciona: transition-all duration-[350ms] cubic-bezier(0.16,1,0.3,1)
// Estado persistido en localStorage ("ui-kit-viewport") para recordar preferencia entre recargas
//
// Indicador visual: el viewport activo tiene fondo bg-primary/10 y texto text-primary
// Íconos: Monitor (desktop), Tablet (tablet), Smartphone (mobile) de Lucide
```

### Archivo: `src/app/ui/page.tsx`

```tsx
/**
 * Component Showcase — Visual source of truth for the project.
 * Every agent building UI MUST reference this page.
 * No new component variants without updating this file first.
 */
import { ComponentShowcase } from "@/features/ui-kit/components/component-showcase"

export const metadata = {
  title: "UI Kit — Component Library",
  description: "Visual source of truth. Development only.",
}

export default function UIKitPage() {
  if (process.env.NODE_ENV === "production") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Not available in production.</p>
      </div>
    )
  }
  return <ComponentShowcase />
}
```

### Archivo: `src/features/ui-kit/components/component-showcase.tsx`

Generar este archivo completo con todas las secciones descritas a continuación.
La estructura general es:

```tsx
"use client"
// Imports: React, todos los componentes shadcn instalados, motion, lucide icons
// Constante BRAND con los tokens del proyecto
// Función principal ComponentShowcase
//   → Header con info del proyecto y tokens de color
//   → Secciones Part 1: componentes individuales
//   → Secciones Part 2: SaaS patterns
//   → Footer
// Helper: función Section
// Helper: función TokenRow (para mostrar qué CSS variable usa cada componente)
```

#### Constante BRAND (reemplazar con valores reales del usuario)

```tsx
// ============================================================
// BRAND TOKENS — Generated from branding interview.
// Update here → reflects everywhere in the showcase.
// Primary source: globals.css CSS variables.
// ============================================================
const BRAND = {
  name: "[NOMBRE_PROYECTO]",
  primaryHex: "[HEX_PRIMARIO]",
  accentHex: "[HEX_ACENTO]",
  font: "[FUENTE]",
  personality: "[PERSONALIDAD]",  // Clean / Bold / Soft / Sharp / Dark
  audience: "[AUDIENCIA]",        // Consumer / B2B / Power User
  radius: "[RADIUS]",             // e.g. "8px"
}
```

#### Estructura de cada sección de componente

Cada sección del showcase debe seguir este patrón. No omitir ningún campo:

```tsx
<Section
  title="Nombre del Componente"
  description="Qué hace. Una línea."
  tokens={["--primary", "--primary-foreground"]}   // CSS vars que usa
  when="Cuándo usar este componente."
  whenNot="Cuándo NO usar — alternativa preferida."
  motion="Property: opacity + transform. Duration: 150ms. Easing: ease-out-expo."
>
  {/* Todas las variantes */}
  {/* Todos los estados: default, hover (descripción), focus, disabled, loading, error, empty */}
  {/* Al menos un ejemplo en contexto SaaS */}
</Section>
```

#### Secciones Part 1 — Componentes a generar

**1. Color Palette**
- Tokens: `--primary`, `--secondary`, `--accent`, `--muted`, `--destructive`, `--background`, `--card`, `--border`, `--foreground`, `--muted-foreground`
- Mostrar swatches con el nombre del token y su CSS var
- Regla: nunca hardcodear hex en componentes — solo estas variables
- Nota de dark mode: todos los tokens cambian automáticamente con `.dark`

**2. Typography**
- Niveles: Display/Hero, H1, H2, H3, H4/Card Title, Body, Small/Caption, Mono/Code
- Tokens: `--font-sans`, `font-size` scale de Tailwind
- Regla: máximo 3 tamaños de texto por pantalla. Usar `tracking-tight` en headings grandes.
- Cuando NO: no usar `text-xs` para texto que requiere lectura sostenida

**3. Buttons**
- Variantes: `default`, `secondary`, `outline`, `ghost`, `destructive`, `link`
- Tamaños: `sm`, `default`, `lg`
- Estados: default, hover, focus-visible (ring), loading (con spinner), disabled
- Tokens: `--primary`, `--primary-foreground`, `--secondary`, `--destructive`
- Motion: `background-color` + `opacity` en 150ms ease-out-expo
- Cuando NO: no usar `default` para acciones secundarias en un mismo contexto — confunde jerarquía
- Ejemplo en contexto: par de botones "Guardar cambios" (default) + "Cancelar" (ghost) en un form

**4. Form Inputs**
- Input: estados default, focused (ring), error (border-destructive + mensaje), disabled, filled, con ícono izquierdo, con ícono derecho
- Select: cerrado, abierto (descripción), disabled
- Textarea: default, resize-none con rows fijo, error
- Switch: on, off, disabled
- Checkbox: unchecked, checked, indeterminate, disabled
- Tokens: `--input`, `--ring`, `--destructive`, `--muted`
- Motion: `box-shadow` (ring) en 150ms. `border-color` en 150ms.
- Cuándo NO: no usar Switch para opciones que requieren confirmación explícita — usar Checkbox + Submit

**5. Cards**
- Variante Default: con borde, sin sombra — listas, contenido estático
- Variante Elevated: sin borde, con `shadow-md` — elementos destacados, modales-like
- Variante Accent: `border-primary/20 bg-primary/5` — KPIs, info clave de marca
- Tokens: `--card`, `--card-foreground`, `--border`, `--primary`
- Motion: `box-shadow` en 200ms al hover en cards clickeables. `transform: scale(1.01)` solo si la card navega.
- Cuándo NO: no usar Elevated dentro de otra Card — no anidar sombras

**6. Badges y Status**
- Variantes: `default`, `secondary`, `outline`, `destructive`
- Semantic: success (verde), warning (amarillo), info (azul), neutral (muted)
- Status con dot: Online / Offline / Pending
- Tokens: `--primary`, `--secondary`, `--destructive`, `--muted`
- Motion: aparición con `animate-in fade-in duration-[75ms]`
- Cuándo NO: no usar Badges para acciones — son informativos, nunca clickeables como botón primario

**7. Alerts**
- Tipos: info (default), success, warning, destructive/error
- Estructura: siempre con `AlertTitle` + `AlertDescription` + ícono apropiado
- Tokens: `--border`, `--background`, colores semánticos para variantes
- Motion: `animate-in fade-in slide-in-from-top-1 duration-[200ms]` al aparecer
- Cuándo NO: no usar Alert para feedback inline de un campo — usar texto de error bajo el input

**8. Navigation e Iconografía**
- Sidebar nav: item activo, item hover, item con badge de notificación
- Top nav: con búsqueda, con avatar, con notificaciones
- Íconos canónicos: Lucide Outline — nunca mezclar con otras librerías
- Regla de tamaño: `h-4 w-4` para inline, `h-5 w-5` para sidebar, `h-6 w-6` para standalone
- Tokens: `--muted-foreground` para íconos inactivos, `--foreground` para activos
- Motion: nav item hover: `background-color` en 150ms. Active indicator: `transform` en 200ms.

**9. Loading States**
- Skeleton: imitar el layout exacto del componente que carga — nunca un skeleton genérico
  - Ejemplo: skeleton de un dashboard card (número grande + label)
  - Ejemplo: skeleton de una fila de tabla
  - Ejemplo: skeleton de un perfil de usuario (avatar + nombre + bio)
- Progress: determinado (con valor), indeterminado (pulse)
- Spinner inline: para botones en loading state
- Tokens: `--muted` para skeleton
- Motion: `animate-pulse` para skeleton. `animate-spin` para spinner.
- Cuándo NO: no usar spinner de pantalla completa para cargas de datos — usar skeleton que imita el layout

**10. Tabs**
- Variante default (fondo muted)
- Máximo 5 tabs antes de considerar dropdown o sidebar nav
- Con contenido en cada tab (no tabs vacíos)
- Tokens: `--muted`, `--background`, `--primary`
- Motion: underline/background del tab activo: `transform` en 150ms
- Cuándo NO: no usar Tabs para flujos con progreso — usar Stepper/pasos numerados

**11. Avatars**
- Tamaños: `h-8 w-8` (sm), default `h-10 w-10`, `h-14 w-14` (lg)
- Con imagen: avatar real
- Con fallback: iniciales (siempre implementar — la imagen puede fallar)
- Avatar group: `-space-x-2` con `border-2 border-background`, contador "+N"
- Tokens: `--muted`, `--border` para el ring del avatar group
- Cuándo NO: no usar avatar como icono genérico de "usuario desconocido" — usar un ícono de Lucide

**12. Toast y Feedback**
- Si shadcn Sonner o Toast está instalado: mostrar variantes success, error, warning, info con acción opcional
- Si no está instalado: mostrar el patrón correcto con nota de qué instalar
- Regla: los toasts son para acciones asíncronas completadas. Para errores de form usar mensajes inline.
- Motion: `slide-in-from-bottom` + `fade-in` en 200ms. Exit: `slide-out-to-right` en 150ms.

**13. Empty States**
- Para CADA componente que muestra datos, debe existir su empty state correspondiente
- Estructura canónica: SVG illustration (simple, inline) + heading + description + CTA primario
- Variantes: lista vacía, error de carga, sin resultados de búsqueda, primer uso (onboarding)
- Tokens: `--muted-foreground`, `--muted`, `--primary` para el CTA
- Cuándo NO: no mostrar empty state con un spinner — son estados mutuamente excluyentes

#### Secciones Part 2 — SaaS Patterns

Esta es la sección que diferencia este showcase de una galería genérica.
Mostrar composiciones completas de pantallas SaaS reales.

**Pattern A — Dashboard KPI Row**

```tsx
// Fila de 4 cards de métricas con skeleton loading simulado
// Estructura: card con número grande + label + delta (trend up/down con color semántico)
// Estado loading: skeleton que imita exactamente el layout de las cards
// Estado error: inline error message con botón retry
// Ejemplo real: MRR, Churn, DAU, Conversion Rate
```

**Pattern B — Data Table con Filtros**

```tsx
// Header: título de sección + botón "Nuevo elemento" + search input + filtros
// Tabla: con columnas tipadas, row actions (dropdown con Edit/Delete), checkbox de selección
// Estado vacío: empty state apropiado dentro de la tabla
// Estado loading: skeleton de filas
// Paginación: prev/next + contador "1-10 de 47"
// Nota: usar shadcn Table + DropdownMenu para row actions
```

**Pattern C — Onboarding Step**

```tsx
// Progress indicator en la parte superior (ej: "Paso 2 de 4")
// Heading del paso + description
// Form con campos relevantes
// CTA: "Continuar" (default) + "Atrás" (ghost)
// Skip link si el paso es opcional
// Nota: no usar Modal para onboarding — flujo de página completa
```

**Pattern D — Sidebar Navigation**

```tsx
// Layout: sidebar fijo izquierdo + área de contenido
// Sidebar: logo/brand, nav items con íconos, sección inferior con avatar + settings
// Estado activo: bg-accent + texto foreground
// Estado hover: bg-muted
// Colapsable: versión solo-íconos en mobile
// Nota: mostrar la estructura de layout, no una sidebar funcional completa
```

**Pattern E — Empty State Completo**

```tsx
// Versión A: primera vez (onboarding) — ilustración SVG + heading motivador + CTA primario
// Versión B: sin resultados de búsqueda — ilustración diferente + "No encontramos X para 'query'" + botón limpiar filtros
// Versión C: error de carga — ícono de error + mensaje técnico + botón retry
// Regla: cada versión tiene un SVG inline diferente — no reutilizar el mismo para todos
```

**Pattern F — Form Page (Auth)**

```tsx
// Layout centrado: card con form + logo en la parte superior
// Campos: email + password + show/hide password toggle
// Validación visible: errores inline, no alertas globales
// CTA: botón de submit con loading state
// Link a "¿Olvidaste tu contraseña?" + "Crear cuenta"
// Nota: este pattern es para login/registro. No OAuth en el sprint inicial.
```

**Pattern G — Navbar Responsive**

```tsx
// Variante Desktop (≥ 768px):
//   Logo izquierda | Nav links centrados o izquierda | Avatar + CTA derecha
//   Nav links: hover → bg-muted en 150ms. Active → dot indicator o underline con color primary
//   Sticky: bg-background/80 con backdrop-blur-sm al hacer scroll
//
// Variante Mobile (< 768px):
//   Logo izquierda | Hamburger (Menu icon) derecha
//   Al click → Sheet desde la derecha:
//     - Todos los nav links en vertical con padding generoso
//     - Separador antes del avatar/perfil
//     - Avatar + nombre + email del usuario en la parte inferior del Sheet
//     - Botón de cierre (X) en la esquina superior derecha del Sheet
//   Hamburger → X: transform rotate en 200ms ease-out-expo
//   Sheet entrada: slide-in-from-right en 350ms ease-out-expo
//
// Bottom Tab Bar (alternativa para apps con 3-5 secciones planas):
//   Barra fija position: fixed bottom-0 con bg-background/95 + backdrop-blur
//   4-5 items: ícono (h-5 w-5) + label pequeño (text-xs)
//   Item activo: text-primary + ícono filled si el set lo permite, o con dot indicator
//   Nunca más de 5 items — si hay más, el 5to es "Más" con dropdown
//   Safe area en iOS: padding-bottom: env(safe-area-inset-bottom)
//
// Tokens: --background, --border, --primary, --muted, --foreground, --muted-foreground
// Cuándo usar Sheet (hamburger): nav con > 3 items o jerarquía compleja
// Cuándo usar Bottom Tab: apps con navegación plana entre 3-5 secciones equivalentes
// Cuándo NO usar Bottom Tab: apps de contenido con scroll profundo (confunde con scroll)
```

---

## Sección 4.5: Sistema de Feedback

El showcase incluye un sistema de feedback integrado que escribe a `UI_FEEDBACK.md`.
Este archivo es leído por el skill en re-runs para incorporar los cambios solicitados.
También se integra con Agentation para anotaciones visuales directamente sobre los componentes.

### Panel How-To (instrucciones dentro del showcase)

Renderizar un panel colapsable al inicio del showcase, antes de la primera sección.
Abierto por defecto la primera vez. Estado (open/closed) persistido en localStorage (`"ui-kit-howto"`).

**Versión sin Agentation (NO_AGENTATION):**

```
Cómo mejorar el UI Kit

Este showcase es la fuente de verdad visual del proyecto.
Los agentes de Claude Code leen esta página antes de crear cualquier componente.

Para mejorar lo que ves aquí:
  1. Encuentra algo que quieras cambiar (un radio muy redondeado, un color incorrecto, etc.)
  2. Haz clic en el ícono ✏️ junto al título de esa sección
  3. Describe el cambio con precisión: "el radius de los botones se siente muy redondo para un SaaS B2B"
  4. Guarda — se escribe automáticamente en UI_FEEDBACK.md
  5. Vuelve a Claude Code y corre /add-ui-kit
     Claude lee tu feedback y propone los cambios específicos

El archivo UI_FEEDBACK.md también se puede editar directamente en tu editor.
Cada entrada tiene sección, fecha y descripción del cambio.

¿Quieres marcar directamente sobre los componentes?
Instala Agentation: /agentation en Claude Code.
Con Agentation puedes anotar visualmente qué quieres cambiar y
Claude Code entiende exactamente el elemento afectado.
```

**Versión con Agentation instalado (HAS_AGENTATION):**

```
Cómo mejorar el UI Kit

Este showcase es la fuente de verdad visual del proyecto.
Los agentes de Claude Code leen esta página antes de crear cualquier componente.

Opción A — Feedback de texto:
  1. Clic en ✏️ junto al título de la sección
  2. Describe el cambio ("el radius de los botones es demasiado redondo")
  3. Guarda → se escribe en UI_FEEDBACK.md

Opción B — Anotaciones visuales con Agentation (recomendado):
  1. Activa la barra de Agentation (esquina inferior izquierda de la pantalla)
  2. Haz clic sobre el componente exacto que quieres cambiar
  3. Escribe tu anotación directamente sobre el elemento
  4. Copia el texto de anotación generado por Agentation
  5. Pégalo en el campo "Anotaciones Agentation" del feedback panel de esa sección
  6. Guarda → se escribe en UI_FEEDBACK.md con contexto visual preciso

Cuando corras /add-ui-kit, Claude Code lee UI_FEEDBACK.md y propone cambios específicos.
Las anotaciones de Agentation le dan contexto visual — sabe exactamente qué elemento cambiar.
```

### Archivo: `src/app/ui/actions.ts`

```ts
"use server"
import { appendFile, writeFile } from "fs/promises"
import { join } from "path"
import { existsSync } from "fs"

const FEEDBACK_FILE = join(process.cwd(), "UI_FEEDBACK.md")
const HEADER = "# UI Feedback\n\nNotas para mejorar el Component Showcase.\n" +
  "Claude Code lee este archivo en el próximo /add-ui-kit y propone los cambios.\n\n---\n"

export async function saveFeedback(
  section: string,
  feedback: string,
  agentationNotes?: string
) {
  if (!existsSync(FEEDBACK_FILE)) {
    await writeFile(FEEDBACK_FILE, HEADER, "utf-8")
  }
  const timestamp = new Date().toLocaleString("es-MX", {
    timeZone: "America/Mexico_City",
    dateStyle: "short",
    timeStyle: "short",
  })
  const agentationBlock = agentationNotes?.trim()
    ? `\n**Anotaciones Agentation:**\n\`\`\`\n${agentationNotes.trim()}\n\`\`\`\n`
    : ""
  const entry = `\n## ${section}\n**Fecha:** ${timestamp}  \n**Feedback:** ${feedback}${agentationBlock}\n---\n`
  await appendFile(FEEDBACK_FILE, entry, "utf-8")
}

export async function clearFeedback() {
  await writeFile(FEEDBACK_FILE, HEADER, "utf-8")
}
```

### Componente: `src/features/ui-kit/components/feedback-panel.tsx`

```tsx
// FeedbackButton — ícono Pencil de Lucide, size h-4 w-4
//   Posición: inline junto al título de cada Section, visible solo en hover del header de la sección
//   opacity-0 group-hover:opacity-100 transition-opacity duration-[150ms]
//   Al click: expande FeedbackForm inline (no modal, no Sheet)
//
// FeedbackForm — panel inline bajo el título de sección
//   - Textarea: placeholder "¿Qué cambiarías en esta sección?"
//     rows={3}, resize-none, max-w-lg
//   - Campo "Anotaciones Agentation" (solo si HAS_AGENTATION prop === true):
//     Textarea pequeño, placeholder "Pega aquí las anotaciones de Agentation..."
//     rows={2}, con label explicativo
//   - Botones: "Guardar" (default, sm) + "Cancelar" (ghost, sm)
//   - Estado saving: botón con spinner, disabled
//   - Estado saved: checkmark + "Guardado en UI_FEEDBACK.md" fade-in, luego cierra el panel en 1.5s
//   - Estado error: mensaje de error inline con opción de reintentar
//
// GlobalFeedbackButton — botón flotante fixed bottom-4 right-4
//   "Ver feedback" con ícono MessageSquare
//   Al click: abre Sheet lateral desde la derecha
//   Sheet contenido:
//     - Título: "Feedback guardado"
//     - Muestra el contenido de UI_FEEDBACK.md (fetch desde un endpoint o leer inline)
//     - Nota: "Corre /add-ui-kit en Claude Code para incorporar estos cambios"
//     - Botón "Limpiar todo el feedback" (destructive, llama clearFeedback())
//       Con confirmación: "¿Seguro? Esto borra todo el feedback guardado." + "Sí, limpiar" / "Cancelar"
//
// Props del componente Section (actualizar el helper Section existente):
//   Agregar prop opcional: hasFeedback?: boolean (default: true)
//   Agregar prop: hasAgentation?: boolean (se pasa desde BRAND o context)
```

### Cómo pasar el flag de Agentation al showcase

En `component-showcase.tsx`, al inicio del componente:

```tsx
// Detect Agentation at build time via env or file check
// The skill sets this based on Step 1D detection
const HAS_AGENTATION = process.env.NEXT_PUBLIC_HAS_AGENTATION === "true"
```

Si el skill detectó HAS_AGENTATION en el Paso 1D, agregar al `.env.local`:
```
NEXT_PUBLIC_HAS_AGENTATION=true
```

---

## Sección 5: Archivo COMPONENT_RULES.md

Crear este archivo en la raíz del proyecto. Es el contrato que los agentes leen antes de
crear cualquier componente. No es un resumen — es enforcement explícito.

### Archivo: `COMPONENT_RULES.md`

```markdown
# Component Rules — [NOMBRE_PROYECTO]

Agentes: leer este archivo antes de crear o modificar cualquier componente UI.
Última actualización: [FECHA]

---

## Regla 1 — Referencia el showcase primero

Antes de crear cualquier componente, abre http://localhost:3000/ui.
Si el componente que necesitas ya existe ahí, usa esa variante exacta.
No crear variantes nuevas sin actualizar el showcase primero.

## Regla 2 — Tokens de color, nunca hex

Correcto:   className="bg-primary text-primary-foreground"
Incorrecto: className="bg-[#3B82F6] text-white"

Tokens disponibles de shadcn:
bg-background, bg-card, bg-muted, bg-primary, bg-secondary, bg-accent,
bg-destructive, bg-border, bg-input, bg-ring
text-foreground, text-muted-foreground, text-primary, text-secondary,
text-accent, text-destructive

## Regla 3 — Fuente del proyecto

La fuente es [FUENTE]. Nunca cambiarla a Inter, Roboto, o Arial.
Si necesitas mono, usa font-mono (JetBrains Mono o Fira Code según config).

## Regla 4 — Motion system

Importar de: @/features/ui-kit/motion
Duraciones: instant(75ms), sm(150ms), md(200ms), lg(350ms), xl(500ms)
Easing default: cubic-bezier(0.16, 1, 0.3, 1)
Animar solo: transform, opacity, filter, color, background-color, border-color
NUNCA animar: width, height, padding, margin, top, left

## Regla 5 — Los 4 estados obligatorios

Todo componente que carga datos debe implementar los 4 estados:
1. Loading: skeleton que imita el layout real (no spinner genérico)
2. Error: mensaje + botón retry
3. Empty: ilustración + heading + CTA
4. Data: el render principal

## Regla 6 — Iconografía

Solo Lucide React (outline series).
Tamaños: h-4 w-4 (inline), h-5 w-5 (sidebar/nav), h-6 w-6 (standalone)
Nunca mezclar con Heroicons, FontAwesome, u otras librerías.

## Regla 7 — Accesibilidad no negociable

- Todos los botones icon-only necesitan aria-label
- Todos los inputs necesitan label asociado (htmlFor ↔ id)
- Focus visible siempre: nunca outline-none sin ring equivalente
- Botones en loading state: disabled={isLoading} aria-busy={isLoading}

## Regla 8 — Variantes canónicas de Button

Solo estas 6 variantes: default, secondary, outline, ghost, destructive, link
No crear custom variants con className ad-hoc.
Jerarquía por pantalla: máximo 1 default (CTA primario), resto secondary/outline/ghost.

## Regla 9 — Cards

Variante Default (con borde): listas, contenido estático, dashboards
Variante Elevated (shadow-md, sin borde): elementos destacados
Variante Accent (border-primary/20 bg-primary/5): KPIs, info de marca
No anidar Cards elevadas dentro de otras Cards.

## Regla 10 — Empty States

Cada componente con datos tiene su empty state.
No reutilizar el mismo SVG illustration para todos los empty states.
La ilustración debe ser temáticamente relacionada con el tipo de contenido vacío.
El CTA del empty state debe ser la acción principal que crea el primer elemento.
```

---

## Sección 6: Anti-Slop Gate

Correr este checklist ANTES de dar el mensaje final al usuario.
Si algún punto falla, reportarlo explícitamente con qué archivo tiene el problema
y cómo se arregla. No marcar como completo si hay failures.

```
ANTI-SLOP GATE — checklist obligatorio antes de finalizar

[ ] 1. FUENTE DISTINTIVA
    Verificar: el showcase no usa Inter, Roboto, ni Arial en ningún lugar.
    Check: grep -r "font-inter\|Inter\|Roboto\|Arial" src/features/ui-kit/ src/app/ui/
    Si falla: reemplazar con la fuente definida en la entrevista.

[ ] 2. SIN HEX HARDCODEADOS
    Verificar: ningún componente usa colores hex directos ni clases Tailwind
    con colores hardcodeados (bg-blue-500, text-purple-700, etc.) para
    colores de marca. Los colores semánticos de shadcn están permitidos
    (bg-destructive, text-muted-foreground, etc.).
    Check: grep -r 'bg-\[#\|text-\[#\|border-\[#' src/features/ui-kit/
    Si falla: reemplazar con CSS variables de shadcn.

[ ] 3. SIN GRADIENT PURPLE-TO-BLUE EN ACCIONES
    Verificar: ningún botón CTA, card de acción, o elemento interactivo
    usa gradient de purple a blue (el cliché #1 del AI slop).
    Check: grep -r "from-purple\|to-blue\|from-violet\|to-indigo" src/features/ui-kit/
    Si falla: reemplazar con color sólido del sistema de tokens.

[ ] 4. SIN 3-CARD IDENTICAL GRIDS EN SAAS PATTERNS
    Verificar: el Pattern A (KPI row) tiene variación visual real entre las 4 cards
    (diferente color de ícono, diferente trend, diferente formato de número).
    No son 4 cards idénticas con diferente número.
    Check: revisión manual del JSX del Pattern A.
    Si falla: agregar variación a los datos de ejemplo y al estilo de cada card.

[ ] 5. MOTION: SOLO TRANSFORM/OPACITY
    Verificar: ninguna animación en el showcase anima width, height, padding,
    margin, top, left, right, bottom.
    Check: grep -r "transition.*width\|transition.*height\|transition.*padding\|transition.*margin" src/features/ui-kit/
    Si falla: reemplazar con transform equivalente (scale, translate).

[ ] 6. DARK MODE: TODOS LOS TOKENS FUNCIONAN
    Verificar: ningún color en el showcase usa clases que no tienen equivalente dark.
    Señales de fallo: bg-white, bg-gray-900, text-gray-800 hardcodeados.
    Check: grep -r "bg-white\|bg-gray-900\|text-gray-800\|text-black\b" src/features/ui-kit/
    Si falla: reemplazar con bg-background, bg-foreground, text-foreground.

[ ] 7. EMPTY STATES PRESENTES
    Verificar: el showcase muestra un empty state para cada componente que
    acepta datos (la tabla, los KPI cards, la lista de items).
    Check: revisión manual — ¿existe una subsección "Estado vacío" en cada
    componente con datos del showcase?
    Si falla: agregar las subsecciones de empty state faltantes.

[ ] 8. SIN MODALS PARA ACCIONES INLINE
    Verificar: en los SaaS Patterns, ninguna acción que cabe en un inline form
    o un dropdown abre un modal completo.
    Ejemplos de fallo: modal para confirmar delete de un item de lista sin
    consecuencias graves, modal para editar un nombre corto.
    Check: revisión manual del JSX de los SaaS Patterns.
    Si falla: reemplazar modal con inline form, popover, o sheet lateral.
```

Reportar resultado antes del mensaje final:

```
ANTI-SLOP GATE — Resultado:
✅ [N]/8 checks pasaron
[Si hay failures]:
❌ Check [N] — [descripción del problema en archivo X]
   Fix aplicado: [qué se cambió]
```

Solo mostrar "UI Kit generado" si todos los checks pasan.
Si hay failures no resueltos, resolverlos primero.

---

## Sección 7: MODO REDESIGN — Proyecto Existente

Ejecutar cuando el proyecto ya tiene UI construida (> 10 archivos TSX).

### Paso A — Scan de Componentes Actuales

```bash
# Componentes personalizados (fuera de ui/)
find src -name "*.tsx" -not -path "*/ui/*" -not -path "*node_modules*"

# Componentes shadcn instalados
ls src/components/ui/

# Colores hardcodeados (AI slop detector)
grep -rn "bg-blue\|bg-purple\|bg-slate\|text-blue\|border-blue\|bg-\[#\|text-\[#" src --include="*.tsx" | head -30

# Fuente problemática
grep -rn "Inter\|font-inter\|Roboto\|Arial" src --include="*.tsx" --include="*.css" | head -10

# Gradients problemáticos
grep -rn "from-purple\|to-blue\|from-violet\|to-indigo" src --include="*.tsx" | head -10

# Inconsistencias de motion (animando layout properties)
grep -rn "transition.*width\|transition.*height\|transition.*padding" src --include="*.tsx" | head -10
```

### Paso B — Análisis de Inconsistencias

Categorizar los problemas encontrados:

1. **Colores hardcodeados** — mismo elemento con hex en diferentes páginas en lugar de CSS var
2. **Radios mixtos** — `rounded-sm` en un componente, `rounded-xl` en otro del mismo tipo
3. **Sombras inconsistentes** — `shadow-md`, `shadow-lg`, `shadow-sm` sin sistema
4. **Tipografía rota** — diferentes font-size para el mismo nivel de jerarquía
5. **Botones fragmentados** — botones primarios que se ven diferentes en cada página
6. **Motion problemático** — animando width/height o usando duraciones arbitrarias
7. **Fuente AI-slop** — usando Inter, Roboto, o Arial como fuente principal

### Paso C — Reporte de Hallazgos (esperar confirmación antes de cambiar nada)

```
SCAN COMPLETADO — [nombre del proyecto]

Archivos TSX analizados: [N]
Páginas con UI: [N]

INCONSISTENCIAS ENCONTRADAS:
CRITICO  [N] — colores hex hardcodeados sin CSS variable
MEDIO    [N] — radios o sombras mixtas en elementos del mismo tipo
MENOR    [N] — motion animando layout properties

COMPONENTES A ESTANDARIZAR:
- Button: [N variantes encontradas → se unifican a 6 canónicas]
- Input:  [N estilos diferentes → se unifican a 1 base + estados]
- Card:   [N variantes → se unifican a 3 canónicas]
- [otros según lo encontrado]

PLAN DE ACCIÓN:
1. Entrevista de branding para establecer tokens (si DESIGN.md no existe)
2. Actualizar globals.css con CSS variables
3. Generar showcase como referencia
4. Reemplazar valores hardcodeados en [lista de archivos]

¿Procedo? Los archivos existentes se modifican DESPUÉS de que confirmes.
```

Esperar confirmación. Si el usuario confirma:
1. Continuar con Sección 2 (entrevista de branding si no hay DESIGN.md)
2. Generar el showcase (Sección 4)
3. Actualizar `globals.css` con los nuevos tokens
4. Reemplazar hardcoded values en los archivos listados

---

## Sección 8: Flujo de Ejecución Completo

```
1.  Detectar modo (FRESH vs REDESIGN)
2.  Verificar shadcn instalado — detener si falta
3.  Verificar Agentation + leer UI_FEEDBACK.md si existe
4.  Leer DESIGN.md si existe
5.  Discovery (Sección 2):
    a) Parte A — Recopilar referencias visuales (siempre)
    b) Si el usuario nombró marca de library/ → leer ese DESIGN.md como hint
    c) Si el usuario fue vago → Parte A.5 (5 visual directions deterministas)
       - Read references/directions.md
       - Mostrar las 5 opciones; aplicar tokens verbatim si elige 1-5
       - SKIP Parte B si eligió direction
    d) Parte B — Identidad (solo si A.5 no resolvió o usuario eligió "custom")
    e) Procesamiento → confirmar tokens con el usuario
6.  REDESIGN: Scan de archivos → reporte de inconsistencias → confirmar con usuario
7.  Si HAS_FEEDBACK: mostrar al usuario qué feedback se incorporará → confirmar
8.  Crear src/features/ui-kit/motion.ts
9.  Instalar componentes shadcn faltantes
10. Crear src/features/ui-kit/components/viewport-toggle.tsx
11. Crear src/app/ui/actions.ts (Server Actions del feedback)
12. Crear src/features/ui-kit/components/feedback-panel.tsx
13. Crear src/features/ui-kit/components/component-showcase.tsx
    con: How-To panel + ViewportToggle + Part 1 + Part 2 (incluye Pattern G)
    + FeedbackButton por sección + GlobalFeedbackButton flotante
14. Sustituir todos los placeholders con valores reales del usuario
    (si vino de A.5: usar OKLch verbatim; si vino de B: usar tokens calculados)
15. Si HAS_AGENTATION: agregar NEXT_PUBLIC_HAS_AGENTATION=true al .env.local
16. Crear src/app/ui/page.tsx
17. Crear src/features/ui-kit/index.ts con los exports
18. REDESIGN: Actualizar globals.css y tailwind.config con tokens estandarizados
19. Crear COMPONENT_RULES.md en la raíz del proyecto
20. Actualizar CLAUDE.md del proyecto con la regla de consistencia visual
21. Correr Anti-Slop Gate (Sección 6) — resolver failures antes de continuar
22. Mostrar mensaje final
```

### Actualizar CLAUDE.md del proyecto

Si existe `CLAUDE.md` en la raíz del proyecto, agregar esta sección:

```markdown
## UI Kit — Regla de Consistencia Visual

El proyecto tiene un Component Showcase en `/ui` (solo desarrollo).
Leer `COMPONENT_RULES.md` antes de crear cualquier componente UI.

Reglas mínimas:
- Verificar `/ui` antes de crear un componente — puede que ya exista
- Colores: solo CSS variables de shadcn, nunca hex hardcodeados
- Íconos: solo Lucide Outline (h-4 w-4 inline, h-5 w-5 nav)
- Motion: importar de @/features/ui-kit/motion — no duraciones arbitrarias
- Los 4 estados: loading (skeleton), error, empty, data — siempre los 4
```

### Archivos creados al finalizar

```
src/
├── app/
│   ├── ui/page.tsx                                      ← Ruta del showcase
│   └── ui/actions.ts                                    ← Server Actions (feedback)
└── features/ui-kit/
    ├── components/
    │   ├── component-showcase.tsx                       ← Showcase principal
    │   ├── viewport-toggle.tsx                          ← Toggle Desktop/Tablet/Mobile
    │   └── feedback-panel.tsx                           ← Feedback por sección + botón flotante
    ├── motion.ts                                        ← Motion system
    └── index.ts                                         ← Exports

COMPONENT_RULES.md                                       ← Enforcement para agentes
UI_FEEDBACK.md                                           ← Creado al primer save de feedback
```

---

## Sección 9: Mensaje Final

Al terminar, después de que el Anti-Slop Gate pase, mostrar:

```
UI Kit generado.

Ruta del showcase: http://localhost:3000/ui

Archivos creados:
  src/app/ui/page.tsx
  src/features/ui-kit/components/component-showcase.tsx
  src/features/ui-kit/motion.ts
  COMPONENT_RULES.md

Componentes documentados:
  Part 1 — Color Palette, Typography, Buttons, Form Inputs, Cards,
            Badges, Alerts, Navigation, Loading States, Tabs, Avatars,
            Toast/Feedback, Empty States
  Part 2 — Dashboard KPI Row, Data Table, Onboarding Step,
            Sidebar Nav, Empty State patterns, Form/Auth Page

Motion system:
  duration.sm  150ms  → hover, focus rings
  duration.md  200ms  → entrances, state changes
  duration.lg  350ms  → drawers, page transitions
  easing       cubic-bezier(0.16, 1, 0.3, 1) → ease-out-expo

Sistema de feedback integrado:
  Ícono en cada sección → feedback inline → se guarda en UI_FEEDBACK.md
  Botón flotante (bottom-right) → ver todo el feedback guardado + limpiar
  Loop: /add-ui-kit (REDESIGN) lee UI_FEEDBACK.md → incorpora cambios automáticamente

  Con Agentation (/agentation en Claude Code):
  Marca directamente sobre los componentes → pega la anotación en el feedback panel
  Claude Code ve exactamente qué elemento cambiar — no solo una descripción de texto

Para el resto del desarrollo:
  1. Leer COMPONENT_RULES.md antes de crear cualquier componente
  2. Verificar /ui — si el componente existe, usar esa variante exacta
  3. Agregar componentes nuevos al showcase primero, luego usarlos en features
  4. Motion: importar de @/features/ui-kit/motion, nunca hardcodear duraciones
  5. Viewport toggle (Desktop/768px/375px) para ver cómo se ve en mobile antes de hacer cambios
```
