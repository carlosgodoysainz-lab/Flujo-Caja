# 5 Visual Directions — Specs canónicos

Cinco direcciones visuales pre-curadas con paleta OKLch + font stack + posture
ya resueltos. Cuando el usuario no tiene marca clara y dice "lo que recomiendes",
Discovery (Parte A.5 del SKILL.md) muestra estas 5 opciones.

Una vez elegida, los tokens van **verbatim** al `globals.css` del proyecto. No
improvisar valores intermedios — esa es la razón de que sean determinísticas.

Adaptado de `nexu-io/open-design` (Apache-2.0). Atribución completa en
[`design-systems/library/ATTRIBUTION.md`](../../../design-systems/library/ATTRIBUTION.md).

---

## 1 · Editorial — Monocle / FT Magazine

**id:** `editorial-monocle`

**Mood:** Print-magazine. Whitespace generoso, headlines serif grandes, paleta
restringida (papel off-white + tinta + un único acento cálido). Confiado y
silenciosamente inteligente.

**Referencias:** Monocle, The Financial Times Weekend, NYT Magazine, It's Nice That.

**Cross-reference en library:** [`library/theverge/`](../../../design-systems/library/theverge/), [`library/wired/`](../../../design-systems/library/wired/), [`library/editorial/`](../../../design-systems/library/editorial/), [`library/publication/`](../../../design-systems/library/publication/).

**Tokens — drop into `globals.css`:**

```css
:root {
  --bg:      oklch(97% 0.012 80);   /* off-white paper */
  --surface: oklch(99% 0.005 80);
  --fg:      oklch(20% 0.02 60);    /* ink */
  --muted:   oklch(48% 0.015 60);
  --border:  oklch(89% 0.012 80);
  --accent:  oklch(58% 0.16 35);    /* warm rust / clay */

  --font-display: 'Iowan Old Style', 'Charter', Georgia, serif;
  --font-body:    -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}
```

**Posture (cómo se comporta):**
- Display serif, body sans, mono SOLO para metadata
- Sin sombras, sin cards rounded — los borders + whitespace hacen el trabajo
- Una imagen decisiva, recortada solo en la parte inferior
- Kicker / eyebrow en mono uppercase. Un solo color de acento, usado máximo 2 veces

---

## 2 · Modern Minimal — Linear / Vercel

**id:** `modern-minimal`

**Mood:** Silencioso, preciso, software-native. System fonts, paleta casi
greyscale, un único acento saturado. La cromática desaparece para que el
contenido sea lo único que registra.

**Referencias:** Linear, Vercel, Notion 2024, Stripe docs.

**Cross-reference en library:** [`library/linear-app/`](../../../design-systems/library/linear-app/), [`library/vercel/`](../../../design-systems/library/vercel/), [`library/stripe/`](../../../design-systems/library/stripe/), [`library/notion/`](../../../design-systems/library/notion/), [`library/raycast/`](../../../design-systems/library/raycast/), [`library/superhuman/`](../../../design-systems/library/superhuman/).

**Tokens:**

```css
:root {
  --bg:      oklch(99% 0.002 240);
  --surface: oklch(100% 0 0);
  --fg:      oklch(18% 0.012 250);
  --muted:   oklch(54% 0.012 250);
  --border:  oklch(92% 0.005 250);
  --accent:  oklch(58% 0.18 255);   /* cobalt */

  --font-display: -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif;
  --font-body:    -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
}
```

**Posture:**
- Letter-spacing ajustado en display (-0.02em)
- Solo hairline borders, sin sombras excepto en dropdowns/modales
- Numéricos mono con `font-variant-numeric: tabular-nums`
- Nav sticky con frosted blur, layouts content-led (sin hero illustrations)
- Un único color de acento: links + primary CTA, nada más

---

## 3 · Warm & Soft — Stripe pre-2020 / Headspace

**id:** `warm-soft`

**Mood:** Fondos crema, acento suave, radii gentiles. Se lee como una revista
de producto reflexiva — amigable sin caer en cute. Bueno para fintech, wellness,
indie SaaS.

**Referencias:** Stripe pre-2020, Headspace, Substack, Mercury.

**Cross-reference en library:** [`library/wise/`](../../../design-systems/library/wise/), [`library/cafe/`](../../../design-systems/library/cafe/), [`library/clay/`](../../../design-systems/library/clay/), [`library/warm-editorial/`](../../../design-systems/library/warm-editorial/), [`library/elegant/`](../../../design-systems/library/elegant/).

**Tokens:**

```css
:root {
  --bg:      oklch(97% 0.018 70);   /* warm cream */
  --surface: oklch(99% 0.008 70);
  --fg:      oklch(22% 0.02 50);
  --muted:   oklch(50% 0.018 50);
  --border:  oklch(90% 0.014 70);
  --accent:  oklch(64% 0.13 28);    /* terracotta */

  --font-display: 'Tiempos Headline', 'Newsreader', 'Iowan Old Style', Georgia, serif;
  --font-body:    'Söhne', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
}
```

**Posture:**
- Display serif, body sans suave
- Radii gentiles (12–16px) — nunca esquinas duras 0px en content cards
- Acento único usado para primary CTA + un flourish editorial (una comilla, una stat)
- Inner glow suave en hero cards en lugar de drop shadows
- Evitar íconos genéricos — usar screenshots reales / fotografías / ilustraciones

---

## 4 · Tech / Utility — Datadog / GitHub

**id:** `tech-utility`

**Mood:** Data-dense, monospace-friendly, dark o light + grid. Hecho para
ingenieros y operators que quieren información por pulgada cuadrada, no vibes.

**Referencias:** Datadog, GitHub, Cloudflare dashboard, Sentry.

**Cross-reference en library:** [`library/sentry/`](../../../design-systems/library/sentry/), [`library/posthog/`](../../../design-systems/library/posthog/), [`library/clickhouse/`](../../../design-systems/library/clickhouse/), [`library/mongodb/`](../../../design-systems/library/mongodb/), [`library/dashboard/`](../../../design-systems/library/dashboard/).

**Tokens:**

```css
:root {
  --bg:      oklch(98% 0.005 250);
  --surface: oklch(100% 0 0);
  --fg:      oklch(22% 0.02 240);
  --muted:   oklch(50% 0.018 240);
  --border:  oklch(90% 0.008 240);
  --accent:  oklch(58% 0.16 145);   /* signal green */

  --font-display: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif;
  --font-body:    -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif;
  --font-mono:    'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace;
}
```

**Posture:**
- Sans display + sans body (una sola familia) está OK — utility manda sobre editorial
- Tabular numerics en todos lados, mono para code / IDs / hashes
- Tablas densas con hairline borders, sin row striping
- Status pills inline (success / warn / danger) con backgrounds tinted restrained
- Evitar: hero images, headlines oversized, copy de marketing — mostrar el producto

---

## 5 · Brutalist / Experimental — Are.na / Yale

**id:** `brutalist-experimental`

**Mood:** Tipografía gritada. Grid visible. System sans + un único serif
oversized. Fealdad deliberada como confianza. Excelente para arte, indie,
agencias, manifesto pages.

**Referencias:** Are.na, Yale Center for British Art, MSCHF, Read.cv.

**Cross-reference en library:** [`library/brutalism/`](../../../design-systems/library/brutalism/), [`library/neobrutalism/`](../../../design-systems/library/neobrutalism/), [`library/expressive/`](../../../design-systems/library/expressive/).

**Tokens:**

```css
:root {
  --bg:      oklch(96% 0.004 100);  /* off-white printer paper */
  --surface: oklch(100% 0 0);
  --fg:      oklch(15% 0.02 100);
  --muted:   oklch(40% 0.02 100);
  --border:  oklch(15% 0.02 100);   /* borders are full-strength fg */
  --accent:  oklch(60% 0.22 25);    /* hot red */

  --font-display: 'Times New Roman', 'Iowan Old Style', Georgia, serif;
  --font-body:    ui-monospace, 'IBM Plex Mono', 'JetBrains Mono', Menlo, monospace;
}
```

**Posture:**
- Display = serif a tamaños extremos: `clamp(80px, 12vw, 200px)`
- Body = monospace — sí, monospace como body, deliberadamente
- Borders a full strength (1.5–2px), no muted greys
- Layouts asimétricos: una columna 70%, la otra 30%
- Casi sin border-radius (0–2px). Sin sombras. Sin gradients
- Links subrayados, sin decoración hover — la tipografía carga el peso

---

## Tabla resumen — para mostrar al usuario

| # | Direction | Mood en una línea | Acento | Referencia más conocida |
|---|---|---|---|---|
| 1 | Editorial Monocle | Print-magazine, serif headlines, papel off-white | Rust cálido | Monocle |
| 2 | Modern Minimal | Software-native, near-greyscale, un acento saturado | Cobalt | Linear |
| 3 | Warm & Soft | Crema, radii suaves, friendly fintech | Terracotta | Stripe pre-2020 |
| 4 | Tech / Utility | Data-dense, mono-friendly, info per square inch | Signal green | Datadog |
| 5 | Brutalist | Type gritada, grid visible, fealdad deliberada | Rojo hot | Are.na |

---

## Reglas de aplicación (CRÍTICO)

1. **Verbatim, no aproximación.** Cuando el usuario elige una direction, los
   valores OKLch de `palette` van al `:root` SIN modificación. No re-mapear a
   "el azul más cercano que conozco". OKLch es soportado nativamente por
   Tailwind 3.4+ y todos los browsers modernos.

2. **Posture es contrato, no sugerencia.** Si la direction dice "sin sombras",
   no se agregan sombras "porque queda mejor". Si dice "monospace como body",
   no se cambia a sans "porque es más legible". El usuario eligió esta
   direction porque su mood es coherente — romperlo destruye el resultado.

3. **Accent override es la única personalización.** Si el usuario dice "me
   gusta Modern Minimal pero con verde en vez de azul", solo se cambia el
   token `--accent`. El resto de la paleta (bg/surface/fg/muted/border) se
   queda. Cambiar más es perder la coherencia.

4. **Refresca cross-references al library.** Si el usuario pidió una direction,
   ofrecer leer 1-2 sistemas relacionados de `library/` para que vea ejemplos
   completos del lenguaje. Ejemplo: "Elegiste Modern Minimal. ¿Quieres que
   lea library/linear-app/DESIGN.md para mostrarte cómo se ve este lenguaje
   aplicado a un producto real?"

5. **No combinar directions.** El usuario elige UNA. "Mitad Editorial mitad
   Tech Utility" no es una opción — eso es lo que da el AI slop. Si el usuario
   insiste, ofrecer la opción `custom` que cae al flujo de Parte B (entrevista
   abierta) en lugar de mezclar.
