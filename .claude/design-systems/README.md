# Design Systems

Sistemas de diseño y patrones visuales listos para usar en proyectos Forge.

Hay dos tipos de sistemas en esta carpeta:

1. **Patrones de estilo** (5) — sistemas agnósticos de marca aplicables a cualquier proyecto
2. **Library de marcas** (129) — `DESIGN.md` portables inspirados en marcas reconocidas, importados de [`nexu-io/open-design`](https://github.com/nexu-io/open-design)

---

## Patrones de estilo (agnósticos de marca)

| Sistema | Descripción | Estado |
|---------|-------------|--------|
| [Liquid Glass](./liquid-glass/) | Vidrio líquido con blur y animaciones fluidas | ✅ Completo |
| [Neumorphism](./neumorphism/) | Soft UI con sombras duales (raised/inset) | ✅ Completo |
| [Neobrutalism](./neobrutalism/) | Bordes duros, sombras sólidas, colores vibrantes | ✅ Completo |
| [Bento Grid](./bento-grid/) | Layout modular estilo Apple/bento box | ✅ Completo |
| [Gradient Mesh](./gradient-mesh/) | Fondos fluidos estilo Stripe/Linear/Vercel | ✅ Completo |

Estructura:
```
design-systems/
└── [nombre-sistema]/
    ├── [nombre-sistema].md   # Documentación técnica
    └── images/
        └── [referencia].png  # Capturas de referencia visual
```

**Cómo usar:**

```
/landing con estilo liquid-glass
Crea un dashboard usando el design system neumorphism
```

---

## Library de marcas (referencia portable)

129 `DESIGN.md` inspirados en marcas reconocidas: Linear, Stripe, Vercel,
Apple, Notion, Tesla, Cursor, Supabase, Anthropic, Cohere, Mistral,
ElevenLabs, X.AI, Spotify, Webflow, Sanity, Airbnb, y muchas más.

**Catálogo completo:** [`library/INDEX.md`](./library/INDEX.md)
**Atribución y licencia:** [`library/ATTRIBUTION.md`](./library/ATTRIBUTION.md)

Categorías disponibles: AI & LLM · Automotive · Backend & Data · Bold &
Expressive · Creative & Artistic · Developer Tools · E-Commerce & Retail ·
Fintech & Crypto · Layout & Structure · Media & Consumer · Modern & Minimal ·
Productivity & SaaS · Professional & Corporate · Retro & Nostalgic · Themed
& Unique.

Estructura:
```
design-systems/library/
├── INDEX.md
├── ATTRIBUTION.md
├── LICENSE
├── linear-app/DESIGN.md
├── stripe/DESIGN.md
├── vercel/DESIGN.md
└── ... (129 carpetas total)
```

### Reglas de uso

> Estos sistemas son **referencia para discutir, no plantilla a clonar**.

Cuando el usuario diga "quiero estilo Linear" o nombre una marca conocida:

1. Buscar `library/<slug>/DESIGN.md` en [INDEX.md](./library/INDEX.md)
2. Leer ese DESIGN.md completo antes de generar tokens
3. Preguntar al usuario qué le gusta y qué le incomoda del referente
4. Usarlo como hint en el system prompt — nunca como output literal

Si todos los Forge-built SaaS terminan viéndose como clones de Linear o
Stripe, el sistema falla. El objetivo es **inspirar**, no **replicar**.

### Comandos que consumen la library

- **`/add-ui-kit`** — en Discovery Parte A, si el usuario nombra una marca, lee su DESIGN.md como contexto
- **`/design`** — puede inicializar el `DESIGN.md` del proyecto desde una marca de la library
- **`/redesign`** — puede ofrecer marcas similares al estado visual actual del proyecto como north stars
- **`/landing`, `/website-3d`** — admiten hint `inspired-by:<slug>` para generar marketing pages

---

*Parte del Forge V1 Design System.*
