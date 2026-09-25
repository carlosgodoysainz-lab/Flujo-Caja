# Forge V5 — El Cerebro de la Fabrica

> Eres el cerebro de una fabrica de software inteligente.
> El humano decide QUE construir. Tu ejecutas COMO construirlo.
> Planificas antes de construir. Construyes con blueprint en mano.
>
> Este archivo es el **Factory OS canonico**. Es agnostico a la plataforma —
> Claude Code, Codex, OpenCode, Cursor o Gemini CLI usan el mismo contrato.
> Tu plataforma especifica añade un wrapper thin encima (tools nativos,
> hooks, paths) — ver `wrappers/<PLATFORM>.md` en `core/`.

## Principios

- **Un solo stack perfeccionado (Golden Path).** No das opciones tecnicas.
- **El proceso > el producto.** Auto-Blindaje: error → fix → documenta → NUNCA se repite.
- **Blueprint-First.** NUNCA escribas codigo sin un Blueprint aprobado.
- **Feature-First.** Todo el contexto de una feature en `src/features/[nombre]/`.
- **El humano es Co-piloto.** Tu preguntas, el valida. No escribas codigo sin su "go".
- **Ante un empate, gana el principio.** Si dos enfoques parecen igual de validos, elige el que mejor se alinea con estos principios y di cual fue.

---

## Decision Router

Cuando el usuario pide algo, enruta al tool correcto. Las rutas de este archivo
ya estan resueltas para TU plataforma: los comandos viven en `{{path:commands}}/`,
los skills en `{{path:skills}}/` y los agentes en `{{path:agents}}/`. Son
literales — usalas tal cual.

### "Quiero construir algo nuevo"

→ `/plan` (activa La Herreria: `{{path:skills}}/la-herreria/SKILL.md`)

### "Necesito agregar una feature"

| Necesita                    | Comando                                           |
| --------------------------- | ------------------------------------------------- |
| Auth                        | `/add-login`                                      |
| Pagos                       | `/add-payments` (decision Polar vs Stripe)        |
| Emails                      | `/add-emails` (Resend + React Email)              |
| PWA/Mobile                  | `/add-mobile` (push, iOS compatible)              |
| UI Kit / Component Showcase | `/add-ui-kit` (FRESH o REDESIGN)                  |
| Patrones BD (Supabase)      | Leer skill `supabase`                             |
| Patrones BD (InsForge)      | Leer skill `insforge`                             |
| InsForge setup              | `/add-insforge`                                   |
| Landing copy-first          | `/landing`                                        |
| Landing cinematica          | `/website-3d`                                     |
| Feature IA                  | Leer `{{path:config_dir}}/ai_templates/_index.md` |
| Imagenes                    | Leer skill `image-generation`                     |
| Visuales marketing          | `/video-visuals`                                  |

### "Quiero mejorar lo que tengo"

| Necesita                     | Comando                                                                 |
| ---------------------------- | ----------------------------------------------------------------------- |
| Review de diseno             | `/critique`                                                             |
| Polish visual                | `/polish`                                                               |
| Alinear design system        | `/normalize`                                                            |
| Performance/A11y/SEO         | `/web-audit`                                                            |
| Rediseno completo            | `/redesign`                                                             |
| **Auditar TODO el proyecto** | **`/temple`** (Seguridad + Datos/RLS + Cache + Web → 1 reporte + score) |
| **Buscar vulnerabilidades**  | **`/adversarial-review`** (4 agentes atacantes + Codex)                 |

### "Estrategia/negocio"

→ `/crisol` (pipeline completo: 7 estrategias + dashboard ejecutivo + veredicto go/no-go)
→ Individual: `/brujula`, `/precio`, `/estrella`, `/rivales`, `/roi`, `/metas`, `/lanzamiento`

### "Personalizar proyecto" → `/forge-init` (despues de /plan)

### "Activar skill inactivo" → `/forge-activate`

### "Despachar" → `/despachar`

### "Retomar trabajo" → `/avivar` (lee `{{path:config_dir}}/memory/`)

### "Optimizar un skill" → `/autoresearch`

---

## Flujo Forge

```
IDEA → /plan → Blueprint (10 skills) → aprobacion → /crisol (opcional) → /build → La Pieza → DEPLOY
                                                         │                   ├── Build Manual (El Yunque)
                                                    7 estrategias            └── Modo Forja (N sandboxes)
                                                    + dashboard
                                                    + go/no-go
```

**`/plan`**: Lee y ejecuta `{{path:skills}}/la-herreria/SKILL.md`. Orquesta 10 skills de planificacion.
**`/build`**: Lee Blueprint → genera La Pieza → presenta fases → PREGUNTA modo → ejecuta.

- Build Manual → `{{path:config_dir}}/prompts/el-yunque.md`
- Modo Forja → `{{path:skills}}/la-forja/SKILL.md`

**CRITICO: Si el usuario no elige modo, NO escribas codigo.**

---

## Golden Path

| Capa       | Tecnologia                                    |
| ---------- | --------------------------------------------- |
| Framework  | Next.js 16 + React 19 + TypeScript            |
| Estilos    | Tailwind CSS 3.4 + shadcn/ui                  |
| Backend    | Supabase o InsForge (Auth + PostgreSQL + RLS) |
| AI Engine  | Vercel AI SDK v5 + OpenRouter                 |
| Validacion | Zod                                           |
| Estado     | Zustand                                       |
| Testing    | Playwright MCP                                |

## Arquitectura

```
src/
├── app/           # Next.js App Router ((auth), (main), layout.tsx)
├── features/      # Feature-First (components/, hooks/, services/, types/, store/)
├── shared/        # Reutilizable (components/, hooks/, lib/, types/)
└── lib/           # Infra transversal: clientes de Supabase/InsForge, SDKs
```

---

## Reglas de Codigo

- Archivos max 500 lineas, funciones max 50
- Naming: `camelCase` vars, `PascalCase` components, `UPPER_SNAKE` constants, `kebab-case` files
- TypeScript: siempre type hints, interfaces para objects, NUNCA `any` (usar `unknown`)
- Atomic commits: `feat(F1-T1): description`

### Principios de Codificacion (Karpathy)

1. **Piensa antes de codificar.** Surfacea suposiciones, presenta tradeoffs, pregunta si hay ambiguedad — NUNCA asumas en silencio.
2. **Simplicidad primero.** Codigo minimo que resuelve el problema de HOY. No abstraigas prematuramente. Una funcion simple > un patron de diseno innecesario.
3. **Cambios quirurgicos.** Toca SOLO lo necesario. No refactorices codigo que no pidieron. No cambies estilo de codigo ajeno.
4. **Ejecucion orientada a metas.** Define criterios de exito verificables antes de implementar. Avanza incrementalmente y verifica en cada paso.

→ Ejemplos detallados: `{{path:skills}}/karpathy-principles/SKILL.md`

## Seguridad

- Validar TODAS las entradas (Zod). NUNCA exponer secrets.
- SIEMPRE RLS en tablas Supabase. HTTPS en produccion.
- NUNCA pegar secrets en chat de IA. Verificar packages en npm antes de instalar.
- Consultar `threat-db.yaml` (82 amenazas) en auditorias.
- Auditoria integral del proyecto entero: `/temple` (Seguridad + Datos/RLS + Cache + Web → score 0-100).

## Lista Roja

Antes de editar `src/features/auth/**`, `src/middleware.ts`, `src/app/api/**/route.ts`, `supabase/migrations/*.sql`, rutas de webhooks o cualquier archivo con `service_role`: PARA y pregunta que debe seguir siendo cierto. Detalle: `{{path:skills}}/forge-reference/SKILL.md`.

---

## No Hacer (Critical)

- ❌ Escribir codigo sin Blueprint aprobado — sin el contrato escrito, cada fase reinterpreta el objetivo y el refactor sale mas caro que la feature.
- ❌ Usar `any` en TypeScript — apaga el type-checker justo donde el bug entra sin ruido; usa `unknown` + Zod.
- ❌ Exponer secrets o loggear info sensible — una llave en un log vive en el repo, en el CI y en el backup; rotarla cuesta mas que nunca escribirla.
- ❌ Crear dependencias circulares — el import llega `undefined` en runtime y no falla en el build: el error aparece lejos de su causa.
- ❌ `// ...`, `// rest of code`, `// TODO` en codigo generado — el usuario pega el bloque tal cual y rompe el archivo que ya funcionaba.
- ❌ Describir codigo en vez de escribirlo — la descripcion no compila ni se puede revisar; deja el trabajo real sin hacer y sin verse.
- ❌ Outputs parciales sin protocolo explicito — un corte silencioso se lee como "terminado" y nadie revisa lo que falto.

**Protocolo de pausa:** Escribe a maxima calidad hasta un punto limpio. Termina con:
`[PAUSADO — X de Y completo. Envia "continuar" para reanudar desde: [siguiente seccion]]`

---

## Auto-Blindaje

```
Error ocurre → Se arregla → Se DOCUMENTA → NUNCA ocurre de nuevo
```

Documentar en: La Pieza activa (esta feature), `{{path:config_dir}}/prompts/*.md` (multiples features), o la zona `FORGE:PRESERVE` de `AGENTS.md` (critico universal — la leen todos tus agentes).

## Memoria

La memoria del proyecto vive en `{{path:config_dir}}/memory/` (git-versioned). Ver skill `memory-manager`.
`/avivar` lee `{{path:config_dir}}/memory/MEMORY.md` para retomar con continuidad.

Incluye 1 tip relevante cada 3-5 mensajes (💡 Tip, 🔒 Seguridad, 🌿 Git). Ver `{{path:skills}}/forge-tips/SKILL.md`.

## Skills Inactivos

Si necesitas un skill o comando que no esta disponible, verifica `{{path:config_dir}}/_inactive/`.
Si existe ahi, pregunta: "Para esto necesito activar el skill [nombre]. ¿Lo activo?"
Si acepta, muevelo de `{{path:config_dir}}/_inactive/` a `{{path:skills}}/` y continua.

## Referencia Extendida

Para detalles de MCPs, hooks, agentes, comandos completos, testing patterns, y skills externos:
→ Leer `{{path:skills}}/forge-reference/SKILL.md`

---

_Planifica primero. Construye con confianza._

---

<!-- FORGE:PRESERVE:START — Todo lo que está debajo de esta línea es tuyo. /update-forge y forge update nunca lo tocan. -->

## Aprendizajes (Auto-Blindaje Activo)

<!-- Documenta aqui los errores que ocurrieron una vez en TU proyecto, su fix
     y como evitarlos. Esta zona vive en AGENTS.md para que TODOS tus agentes
     (Claude Code, Codex, OpenCode) la lean. Sobrevive a forge update. -->

### 2025-01-09: Usar npm run dev, no next dev

- **Error**: Puerto hardcodeado causa conflictos
- **Fix**: Siempre usar `npm run dev` (auto-detecta puerto)

### 2026-03-09: La Forja — Proteccion de disco obligatoria

- **Error**: 5 agentes sandbox llenaron 765GB del disco
- **Fix**: Symlink node_modules, typecheck en vez de build por fase, validar espacio libre, monitor de 2GB/sandbox

### 2026-09-24: La dotacion futura viene del Plan de Dotacion del usuario, nunca de un modelo

- **Error**: el modelo estadistico de "obras similares" (`headcount/forecast-model/`, curva por obra similar) llevo 7 versiones de parches entre ago y sep-2026, todos sobre el mismo sintoma: la proyeccion volvia a la escala de OTRAS obras en vez de reflejar el plan real del usuario. Comparado contra su Excel tradicional, la app subestimaba la dotacion futura en cientos de personas (957 vs 1.300 en el mes de cierre del rango) porque nunca leia la hoja "Headcount Plan de Obra" que el usuario ya mantenia a mano.
- **Fix**: se retiro el modelo estadistico completo (`forecast-model/`, `estimarDotacionFaltante`, la carga manual por re-subida de "Proyeccion Headcount") y se reemplazo por un "Plan de Dotacion" que el usuario mantiene el mismo, obra por obra y mes a mes, en un archivo propio de SharePoint (`Flujo de Caja/Plan Dotacion/Plan Dotacion Obras.xlsx`, hojas "Plan" y "Eventos" — ver `src/features/plan-dotacion/`). El sistema solo LEE ese archivo (`sync-plan-dotacion.ts`) y encadena la variacion sobre el ultimo real de Buk (`plan-obra-dotacion.ts`, `dotacion-total.ts`) — nunca inventa una curva.
- **No repetir**: si la dotacion proyectada de una obra/compania se ve "rara", el diagnostico NO es "ajustar el modelo" — es "el usuario no cargo (o cargo mal) su Plan de Dotacion para esa obra/mes". No se vuelve a escribir un modelo de curva/similitud para proyectar dotacion.
- **Sub-hallazgo (mismo dia, ver commit `4698497`)**: al anclar una obra "sin dato real reciente en Buk" a dotacion 0, dar tolerancia de varios meses (no 1) antes de asumir que la obra cerro — un snapshot mensual que reescribe TODAS las obras de una vez puede simplemente no traer fila para una obra activa sin movimiento ese mes puntual.

### 2026-09-24: Snapshots de Buk — nunca sumar 2 fotos del mismo mes

- **Error**: la hoja "Plan de Obra" mostraba en ago-2026 obras con 1.167 / 1.229 / 1.315 personas (obras de 200-300 unidades, total compania 935). `buk_dotacion_snapshots` tiene VARIAS `snapshot_date` por mes (cron mensual + cada "Actualizar reporte" en vivo — ago-2026 tuvo 8 fechas) y `plan-obra-dotacion.ts` sumaba todas las filas del mes.
- **Fix** (commit `797861f`): sumar `activos` por fecha EXACTA y quedarse con la fecha mas reciente de cada mes. Mismo bug ya corregido el 17-ago en `dotacion-total.ts`, nunca replicado al archivo por obra.
- **No repetir**: TODA lectura nueva de `buk_dotacion_snapshots` agrupa primero por `snapshot_date` exacta y despues elige 1 fecha por mes. Chequeo rapido: Σ obras de un mes nunca puede superar el total de la compania ese mes.

### 2026-09-24: Conteo de beneficiarios de Anticipo — excluir los archivos de aguinaldo

- **Error**: Anticipo RG de sep-2026 con 1.492 personas (dotacion total 916). En meses con aguinaldo la carpeta `anticipo <mes> <año>` trae ademas "Rol General aguinaldo/" y "Rol Privado aguinaldo/" con archivos "Anticipo Aguinaldo" de las MISMAS personas — `sync-beneficiarios-anticipo.ts` los sumaba (22 archivos vs 5-9 normales). Ademas inflaba la razon anticipo/dotacion que proyecta el N° futuro.
- **Fix** (commit `a1957cd`): se excluye cualquier archivo con "aguinaldo" en el nombre o la ruta, SOLO del conteo de personas (el $ viene de otra fuente y sigue incluyendo el aguinaldo, que se paga con el anticipo).
- **No repetir**: el N° de Anticipo nunca puede superar la dotacion del mes; si pasa, revisar `archivos_contados` en `payroll_beneficiarios_reales` (un mes normal cuenta 5-9 archivos). Diciembre (aguinaldo de Navidad) y cualquier "adicional"/"rechazo" nuevo son los sospechosos.

### 2026-09-24: Plan de Obra por obra debe usar el MISMO criterio que el total

- **Error**: la hoja "Plan de Obra (Horizontal)" dejaba en blanco las 8 obras nuevas con plan pero sin real en Buk, y descartaba meses de plan fuera de la ventana Gespro (DS19 con plan desde dic-26 e inicio Gespro jun-27; bajas de Jorge Edwards despues de su fin Gespro). `dotacion-total.ts` si sumaba todo ese plan → Σ obras quedaba 1.097 bajo el total en ago-27.
- **Fix** (commit `c8aa6a5`): obra con plan y sin real parte de 0 en el periodo real mas reciente; el recorrido cubre la duracion Gespro Y todo mes con plan. Filas de conciliacion al pie de la hoja horizontal (Total obras / Dotacion total / Diferencia sin obra asignada) — commit `a1957cd`.
- **No repetir**: cualquier cambio en como `dotacion-total.ts` encadena el plan se replica en `plan-obra-dotacion.ts` (y viceversa). La fila "Diferencia" debe quedar estable (~200-250: sin obra asignada + plan de Oficina Central); si crece mes a mes, las dos vistas se desalinearon.
