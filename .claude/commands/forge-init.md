---
description: "Personaliza CLAUDE.md, README.md y skills activos segun el tipo de proyecto. Ejecutar despues de /plan cuando el Blueprint ya existe."
---

# /forge-init — Personalizar Proyecto

> *"La fragua se adapta a la pieza, no al reves."*

Transforma este proyecto de template generico a proyecto especifico, sin perder el core de Forge.

---

## Instrucciones

### Paso 1: Detectar Contexto

Busca estos archivos en la raiz del proyecto (en este orden de prioridad):

1. `BLUEPRINT-*.md`
2. `AI-FEATURE-BRIEF-*.md`
3. `BMC-*.md`
4. `PDR-*.md`

Si NO existe ninguno, mostrar:

```
No encontre un Blueprint o documento de planificacion.

Ejecuta /plan primero para generar el Blueprint de tu proyecto.
Despues vuelve a ejecutar /forge-init.
```

Y detener la ejecucion.

Si existe al menos uno, extraer:

- **PROJECT_NAME**: Nombre del proyecto (del titulo del Blueprint o BMC)
- **BUILD_MODE**: Tipo de proyecto. Buscar en el documento la seleccion de modo:
  - SaaS Completo
  - MVP para Validar
  - Herramienta Interna
  - Landing Page
  - Feature con IA
  - Si no es claro, preguntar al usuario
- **DESCRIPTION**: Descripcion en 1 linea (del PDR o Blueprint)
- **FEATURES**: Lista de features principales (del Blueprint)

Mostrar al usuario lo detectado y pedir confirmacion:

```
Detecte tu proyecto:

  Nombre:      [PROJECT_NAME]
  Tipo:        [BUILD_MODE]
  Descripcion: [DESCRIPTION]
  Features:    [lista]

¿Es correcto? (si / corregir)
```

Esperar confirmacion antes de continuar.

---

### Paso 2: Customizar CLAUDE.md (Parcial)

**IMPORTANTE: NO reescribir CLAUDE.md completo. Solo hacer ediciones quirurgicas.**

#### 2a. Agregar seccion "Proyecto Activo" despues del titulo

Insertar justo despues del titulo H1 (la primera linea del archivo, con la
forma `# Forge V… — El Cerebro de la Fabrica`, sea cual sea el numero de
version) y antes del blockquote de la cita. NO dependas del numero de version
del titulo: anclate al H1 que empieza con `# Forge`.

```markdown
## Proyecto Activo

| Campo | Valor |
|-------|-------|
| Nombre | [PROJECT_NAME] |
| Tipo | [BUILD_MODE] |
| Descripcion | [DESCRIPTION] |
| Features | [lista separada por comas] |

> Personalizado por /forge-init. Core Forge intacto. Usa /forge-activate para skills adicionales.
```

#### 2b. Podar el Decision Router (NO reemplazarlo)

**IMPORTANTE: El Decision Router de V4 esta organizado en subsecciones
(`### "Quiero construir algo nuevo"`, `### "Necesito agregar una feature"`,
`### "Quiero mejorar lo que tengo"`, `### "Estrategia/negocio"`, mas entradas
de una linea). NUNCA lo reemplaces por una tabla plana. Solo PODA las filas
irrelevantes para el BUILD_MODE, conservando los encabezados de subseccion,
la notacion agnostica de plataforma (`.claude/.codex/.cursor`) y toda fila que
no aparezca en la lista de poda.**

Reglas de poda:

- **Conserva siempre** la navegacion core: `/plan`, `/build`, `/forge-init`,
  `/forge-activate`, `/despachar`, `/avivar`, y la subseccion completa
  "Quiero mejorar lo que tengo" (`/critique`, `/polish`, `/normalize`,
  `/web-audit`, `/redesign`, `/adversarial-review`).
- **Elimina** unicamente las filas cuyo comando/skill fue movido a `_inactive/`
  en el Paso 4, mas las filas claramente ajenas al BUILD_MODE (tabla abajo).
- Si una subseccion queda vacia tras podar, elimina tambien su encabezado.
- Mantén intacto el parrafo introductorio del Router (la nota sobre `.claude/X`).
- Justo antes del `---` que cierra el Decision Router, agrega esta linea:
  `<!-- Router podado por /forge-init (BUILD_MODE=[BUILD_MODE]). Filas inactivas restaurables con /forge-activate. -->`

Filas/entradas a podar segun BUILD_MODE (todo lo no listado se conserva):

| BUILD_MODE | Podar del Router |
|---|---|
| **SaaS Completo** | Landing cinematica (`/website-3d`) · Imagenes (`image-generation`) · Visuales marketing (`/video-visuals`) |
| **MVP para Validar** | Landing cinematica (`/website-3d`) · Imagenes · Visuales marketing · subseccion completa "Estrategia/negocio" (`/crisol` + individuales) |
| **Landing Page** | Pagos (`/add-payments`) · Emails (`/add-emails`) · PWA/Mobile (`/add-mobile`) · Patrones BD Supabase **e** InsForge · InsForge setup (`/add-insforge`) · Feature IA · Imagenes · Visuales marketing · subseccion "Estrategia/negocio" · "Optimizar un skill" (`/autoresearch`) — **CONSERVA** `/landing` y `/website-3d` |
| **Feature con IA** | Landing cinematica (`/website-3d`) · Visuales marketing (`/video-visuals`) · subseccion "Estrategia/negocio" — **CONSERVA** Feature IA, Imagenes y Patrones BD |
| **Herramienta Interna** | Pagos (`/add-payments`) · Landing copy-first (`/landing`) · Landing cinematica (`/website-3d`) · Imagenes · Visuales marketing · subseccion "Estrategia/negocio" |

> La lista de poda esta alineada con los skills que el Paso 4 mueve a
> `_inactive/`: si un skill se desactiva, su fila del Router se poda, y
> viceversa. No desactives una fila cuyo skill sigue activo.

---

### Paso 3: Generar README.md

Crear (o sobrescribir) `README.md` en la raiz del proyecto:

```markdown
# [PROJECT_NAME]

[DESCRIPTION]

## Stack

- Next.js 16 + React 19 + TypeScript
- Tailwind CSS 3.4 + shadcn/ui
[Agregar segun BUILD_MODE:]
- Supabase (Auth + PostgreSQL + RLS)    ← NO incluir para Landing
- Vercel AI SDK v5 + OpenRouter         ← SOLO para Feature con IA
- Zod (validacion)
- Zustand (estado)                      ← NO incluir para Landing

## Setup Local

\```bash
npm install
cp .env.local.example .env.local
# Configurar las variables en .env.local
npm run dev
\```

## Estructura del Proyecto

\```
src/
├── app/           # Next.js App Router
├── features/      # Arquitectura Feature-First
│   └── [feature]/ # components/, hooks/, services/, types/
└── shared/        # Componentes y utilidades compartidas
\```

## Features Principales

[Lista de features del Blueprint]

## Comandos Disponibles

[Lista filtrada de comandos segun BUILD_MODE — mismos que el Decision Router]

---

*Construido con [Forge](https://github.com/carlos-dominguez-faber/forge)*
```

**IMPORTANTE:** Reemplazar los `\``` con ``` reales (sin backslash). El backslash es solo escape para este documento.

---

### Paso 4: Mover Skills Irrelevantes

Crear directorio `_inactive` si no existe:
```bash
mkdir -p .claude/_inactive
```

Mover skills segun BUILD_MODE:

| BUILD_MODE | Skills a mover a `_inactive/` |
|---|---|
| **SaaS Completo** | website-3d, video-visuals, image-generation |
| **MVP para Validar** | website-3d, el-crisol, video-visuals, image-generation |
| **Landing Page** | la-forja, el-crisol, add-payments, add-emails, add-mobile, supabase, autoresearch, video-visuals, image-generation |
| **Feature con IA** | website-3d, el-crisol, video-visuals |
| **Herramienta Interna** | website-3d, el-crisol, add-payments, video-visuals, image-generation |

Para cada skill a mover:
```bash
mv .claude/skills/[skill-name] .claude/_inactive/
```

**NUNCA mover estos skills core** (siempre deben quedarse activos):
- karpathy-principles
- memory-manager
- forge-tips
- forge-reference
- impeccable
- web-quality
- la-herreria
- skill-creator
- token-auditor

---

### Paso 5: Confirmar al Usuario

Mostrar resumen de todo lo realizado:

```
Proyecto personalizado: [PROJECT_NAME]

  CLAUDE.md  — Seccion "Proyecto Activo" agregada + Decision Router filtrado a [BUILD_MODE]
  README.md  — Generado con stack, setup y features del proyecto
  Skills     — [N] activos de [total] (los relevantes para [BUILD_MODE])
               [N] movidos a _inactive/: [lista]

Todo el core de Forge sigue intacto (principios, reglas, seguridad, auto-blindaje).

Si durante el build necesitas un skill que fue desactivado,
te preguntare si quieres reactivarlo. Tambien puedes usar /forge-activate
para ver y activar skills en cualquier momento.

→ Siguiente paso: /build
```

---

## Notas Tecnicas

- Este comando es **idempotente**: si se ejecuta dos veces, detecta la seccion "Proyecto Activo" existente y la actualiza en vez de duplicarla.
- Los skills en `_inactive/` NO se borran, solo se mueven. Son completamente reversibles.
- El CLAUDE.md mantiene TODAS las reglas, principios Karpathy, seguridad, Auto-Blindaje, Golden Path, y arquitectura.
- Solo se modifica el Decision Router (para reducir ruido) y se agrega identidad del proyecto.
