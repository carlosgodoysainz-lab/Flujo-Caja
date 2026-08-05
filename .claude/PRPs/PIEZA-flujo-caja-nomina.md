# La Pieza: Flujo de Caja Nómina

> **Estado**: PENDIENTE
> **Blueprint origen**: `BLUEPRINT-flujo-caja-nomina.md`
> **Fecha**: 2026-08-04
> **Build Mode**: Herramienta Interna

---

## Objetivo

Reemplazar el Excel manual "Flujo de Caja" por una herramienta que ingiere en vivo los datos reales de pagos y plan de obras desde SharePoint, calcula la proyección de caja de nómina, estima automáticamente la dotación faltante de 10 obras vía histórico de Buk, y produce el reporte tanto como dashboard vivo como archivo HTML exportable/adjuntable por correo — con el mismo formato visual que los dashboards Gespro de referencia de Maestra.

## Por Qué

| Problema del Usuario                                                                 | Cómo lo Resuelve                                                                          |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Datos de pago dispersos en SharePoint con naming inconsistente, cargados a mano      | Ingesta automática vía Microsoft Graph con búsqueda por patrón mes/año                    |
| 10 de 25 obras sin dotación proyectada (huecos "amarillos" del Excel)                | Modelo de estimación basado en histórico real de Buk, con trazabilidad de cada estimación |
| Reporte hoy vive solo en un Excel, no se puede distribuir como los dashboards Gespro | Export HTML autocontenido, idéntico patrón al envío semanal de Gespro por correo          |
| Sin auditoría de quién cambió qué número en un dato financiero sensible              | `audit_log` inmutable + trazabilidad de cada override manual y cada corrida del modelo    |

**Impacto medible**: elimina la actualización manual mensual del Excel (~horas/mes), cierra 10 huecos de proyección hoy vacíos, y da a Carlos un reporte enviable por correo en el mismo formato ya validado por Gerencia Inmobiliaria.

## Qué

### Criterios de Éxito (Definition of Done)

- [ ] Carlos se loguea con su cuenta Microsoft `@maestra.cl` y accede a `/reporte`
- [ ] Un refresh manual ingiere Plan de Obras Gespro + Pagos Mensuales (remuneraciones/reliquidaciones) sin intervención manual
- [ ] Las 10 obras sin dato manual (La Compañía, Agua Santa, Lira III, Distrito Centro, Altos del Elqui, Esmeralda, Serrano B, Vista Llacolén C, General Mackenna 2, Pintor Cicarelli III) quedan con headcount estimado y trazable
- [ ] `/reporte` replica visualmente el formato de los dashboards Gespro de referencia (paleta, KPIs, línea de tiempo, semáforo)
- [ ] Botón "Descargar HTML" produce un archivo autocontenido, adjuntable a un correo, sin dependencias externas
- [ ] Cero RUT o nombre de persona en las tablas de montos de remuneración
- [ ] `get_advisors` sin vulnerabilidades críticas

### Happy Path

Carlos abre la app → login Microsoft → click "Actualizar reporte" → la app busca en SharePoint el Excel de Plan de Obras Gespro más reciente y los archivos de Pagos Mensuales del período → parsea y agrega los montos (sin PII) → recalcula el flujo de caja con las fórmulas migradas del Excel → corre el modelo de estimación de dotación para las obras sin dato → el dashboard se actualiza con la nueva serie → Carlos revisa, y si necesita enviarlo, hace click "Descargar HTML" y lo adjunta a un correo igual que hoy se envía el Gespro.

---

## Contexto

### Referencias de Código

- `panel-relaciones-laborales/src/lib/buk/api-client.ts` → patrón de referencia para el cliente Buk (fetch + header `auth_token`, paginado) — este proyecto construye su PROPIO cliente con INSERT-only (no upsert destructivo)
- `TECH-SPEC-flujo-caja-nomina.md` → stack completo, schema SQL, decisiones técnicas justificadas
- `BLUEPRINT-flujo-caja-nomina.md` → fuente de verdad del plan, fase por fase
- Dashboards de referencia (formato a replicar): `Plan de Obra\Plan de obra Gespro\03_08_26\20260803 Directorio_MinutaGESPRO_Comparativo_Ago2026_1.html` y `...Carta_Gantt_PlanObras_Ago2026.html`
- Skill `marca-maestra` → aplicar tokens de color/logo corporativos

### Arquitectura Propuesta (Feature-First)

```
src/features/
├── cash-flow/              ← Motor de cálculo + componentes del dashboard
├── ingestion/
│   ├── graph/              ← Cliente Microsoft Graph
│   ├── excel-parser/       ← Parsers de remuneraciones/reliquidaciones/Gespro
│   └── pdf-parser/         ← Post-MVP (anticipos)
├── headcount/
│   ├── buk-sync/           ← Snapshots históricos (INSERT-only)
│   └── forecast-model/     ← Motor de estimación de dotación
├── obras/                  ← Catálogo de obras
└── report-export/          ← Renderer del HTML autocontenido
```

### Modelo de Datos

Ver `TECH-SPEC-flujo-caja-nomina.md` §4.2 — 11 tablas completas (`profiles`, `obras`, `headcount_by_obra`, `headcount_forecast_runs`, `buk_cargo_catalog`, `buk_dotacion_snapshots`, `payroll_source_documents`, `payroll_line_items`, `cash_flow_monthly`, `uf_series`, `report_snapshots`, `audit_log`). RLS obligatorio, ninguna tabla mezcla identidad de persona con monto de remuneración.

---

## Blueprint (Fases de Construcción)

> Fases tomadas de `BLUEPRINT-flujo-caja-nomina.md`. Subtareas se mapean al ENTRAR a cada fase (just-in-time), ver `.claude/prompts/el-yunque.md`.

### Fase 1: Foundation & Auth Delegado

**Objetivo**: App corriendo local, login Microsoft (`@maestra.cl`) funcional, schema DB completo con RLS
**Validación**: Login exitoso llega a dashboard vacío; `get_advisors` sin críticos sobre las 11 tablas
**Tiempo estimado**: ~2-3 días

### Fase 2: Design System Maestra & Layout

**Objetivo**: Layout de navegación + tokens de marca aplicados
**Validación**: Comparación visual lado a lado con los dashboards de referencia
**Tiempo estimado**: ~1-2 días

### Fase 3: Ingesta Plan de Obras Gespro

**Objetivo**: Tabla `obras` poblada automáticamente desde el Excel más reciente
**Validación**: Sync repetido no duplica filas; archivo bloqueado no rompe el resto
**Tiempo estimado**: ~2 días

### Fase 4: Ingesta Pagos Mensuales + Motor de Cálculo

**Objetivo**: `cash_flow_monthly` con datos reales + proyección calculada, cero PII
**Validación**: Coverage >80% en `features/cash-flow`; query directa confirma ausencia de RUT/nombre
**Tiempo estimado**: ~4-5 días

### Fase 5: Histórico Buk (Snapshots)

**Objetivo**: Cron mensual corriendo, snapshots reales acumulándose (INSERT-only)
**Validación**: Ejecutar 2 veces el mismo día crea 2 filas distintas
**Tiempo estimado**: ~2-3 días

### Fase 6: Motor de Estimación de Dotación

**Objetivo**: Las 10 obras sin dato manual quedan con curva estimada y trazable
**Validación**: Backtest sobre una obra con dato real conocido; cada estimación referencia sus obras similares en `headcount_forecast_runs`
**Tiempo estimado**: ~3-4 días

### Fase 7: Dashboard del Reporte

**Objetivo**: `/reporte` funcional replicando el formato de los dashboards de referencia
**Validación**: Botón "Actualizar" corre el pipeline completo con feedback de progreso
**Tiempo estimado**: ~3-4 días

### Fase 8: Export HTML Autocontenido

**Objetivo**: Botón "Descargar HTML" produce archivo adjuntable por correo
**Validación**: El archivo se abre sin conexión a internet y se ve idéntico al dashboard vivo
**Tiempo estimado**: ~1-2 días

### Fase 9: Validación Final — Seguridad, Auditoría & Deploy

**Objetivo**: Sistema funcionando end-to-end en producción
**Validación**:

- [x] `npm run typecheck` → 0 errores
- [x] `npm run build` → exitoso
- [ ] Playwright screenshot confirma UI renderiza — no configurado (sin Playwright instalado, login bloqueado por consentimiento admin igual impediría el flujo E2E completo)
- [ ] Todos los criterios de éxito de "Qué" cumplidos — pendiente validación real de Carlos (login no probado end-to-end)
- [x] RLS verificado — MCP `get_advisors` no disponible esta sesión, sustituido por revisión manual + prueba en vivo (INSERT con anon key → 42501, confirmado)
- [ ] Deploy en Vercel — **pendiente, requiere cuenta Vercel del usuario** (ver sección "Pendientes en manos del usuario" abajo)

---

## 🔒 Auto-Blindaje

> Esta sección crece durante la implementación — se documenta cada error encontrado y su fix.

### 2026-08-04: Tailwind v4 vs v3 en el scaffold de Forge

- **Error**: `globals.css` traía `@import 'tailwindcss'` (sintaxis v4) pero el proyecto instala Tailwind v3.4 → build fallaba con "Module not found: Can't resolve 'v8'" (jiti intentando bundlearse en el cliente)
- **Fix**: usar las directivas v3 (`@tailwind base/components/utilities`)
- **Aplicar en**: cualquier proyecto Forge nuevo con este mismo scaffold — revisar versión de Tailwind ANTES de tocar globals.css

### 2026-08-04: Next.js 16 renombró "middleware" a "proxy"

- **Error**: `middleware.ts` genera warning de deprecación en Next 16
- **Fix**: renombrar a `src/proxy.ts` (mismo contenido, sin cambios de API)
- **Aplicar en**: todo proyecto Next.js 16+

### 2026-08-04: `shadcn add` sin `shadcn init` previo no inyecta el setup base

- **Error**: se instalaron 7 componentes shadcn (Fase 2) sin nunca correr `shadcn init` — faltaban las variables CSS (`--primary`, `--background`, `--border`, etc.) y el plugin `tailwindcss-animate`. Los componentes habrían renderizado sin estilos
- **Fix**: agregar manualmente el bloque de variables CSS "new-york" a `globals.css` + extender `tailwind.config.ts` + instalar `tailwindcss-animate`
- **Aplicar en**: cualquier proyecto donde se use `shadcn add` directo sin `init` — verificar SIEMPRE que existan las variables base antes de asumir que los componentes se ven bien

### 2026-08-04: `profiles` diseñado para Supabase Auth, pero la identidad real es NextAuth

- **Error**: migración inicial puso `profiles.id REFERENCES auth.users(id)` + trigger `on_auth_user_created` — pero como la app usa NextAuth (no Supabase Auth) para login, nada inserta en `auth.users`, así que `profiles` nunca se poblaría
- **Fix**: migración 002 quita el trigger y el FK; `profiles.id` pasa a ser el Microsoft OID, poblado desde el callback `signIn` de NextAuth
- **Aplicar en**: cualquier proyecto que use un proveedor de auth externo a Supabase junto con Supabase solo como DB

### 2026-08-04: Access token de Graph API expira y no se refrescaba

- **Error**: el JWT callback de NextAuth guardaba el access_token de Graph solo en el primer login — como el refresh del reporte es manual (puede pasar horas/días entre usos), el token quedaría stale y todo Graph API call fallaría con 401
- **Fix**: agregar lógica de refresh automático (POST al endpoint de token de Azure AD con el refresh_token) dentro del mismo jwt callback, chequeando expiración en cada request
- **Aplicar en**: cualquier integración OAuth donde el uso real es esporádico, no continuo

### 2026-08-04: matchObraByName — substring crudo confunde "Lira I" con "Lira II"

- **Error**: el primer test escrito para el matcher de nombres de obra reveló que `"lira ii".includes("lira i")` es `true` — un bug real que habría asignado mal el `obra_id` en producción para obras con numeración romana/secuencial (confirmado que existen: Lira I/II/III reales)
- **Fix**: exact-match primero, luego fallback con límites de palabra (`\b`) en vez de `.includes()` crudo
- **Aplicar en**: cualquier matching de texto libre contra nombres con sufijos numéricos/romanos

### 2026-08-04: 6 de 12 tablas sin RLS desde la migración inicial

- **Error**: al auditar (Fase 9), `headcount_forecast_runs`, `buk_cargo_catalog`, `buk_dotacion_snapshots`, `payroll_source_documents`, `uf_series` y `report_snapshots` nunca tuvieron `ENABLE ROW LEVEL SECURITY` — con la anon key pública, cualquiera podría haber leído/escrito esas tablas directo vía REST
- **Fix**: migración 004 habilita RLS sin políticas permisivas (deny-all, coherente con que la app solo usa service role). Verificado en vivo: INSERT con anon key → error 42501
- **Aplicar en**: SIEMPRE hacer un `grep "CREATE TABLE"` vs `grep "ENABLE ROW LEVEL SECURITY"` al cerrar cualquier fase con migraciones nuevas — no asumir que "puse RLS en la mayoría" es suficiente

### 2026-08-04: Server actions dependientes de Graph API no se pudieron probar end-to-end

- **Limitación conocida (no error, bloqueo externo)**: el login con Microsoft requiere consentimiento de administrador en Azure AD que no se resolvió durante esta sesión (columna "Se requiere el consentimiento" mostraba "No" para los 4 permisos pero el login real sí lo pidió). Todo el código de Fases 3, 4, 5, 7 y 8 que depende de `session.graphAccessToken` está escrito y compila, pero **no fue validado contra la API real de Graph ni de Buk** (falta también `BUK_API_KEY`)
- **Aplicar en**: antes de considerar el MVP "listo para producción", correr un refresh real con Carlos ya logueado y revisar `/fuentes` para confirmar que la ingesta real funciona

### 2026-08-05: `/me/drive/root/search` da 0 resultados — solo busca el OneDrive personal

- **Error real en producción**: con login ya funcionando, "Actualizar reporte" devolvió PARCIAL con 0 documentos ingeridos — TODAS las fuentes (Plan de Obras Gespro, Pagos Mensuales de los 25 meses) fallaron. `searchFiles` usaba `/me/drive/root/search`, que solo indexa el OneDrive personal por defecto del usuario logueado. Las carpetas reales ("Recursos Humanos General", "Plan de Obra") son bibliotecas de SharePoint de equipo, en `/sites/{siteId}/drive` — un drive completamente distinto.
- **Fix**: reescribir `searchFiles` (graph/client.ts) para usar la API de Microsoft Search (`POST /search/query`, `entityTypes: ["driveItem"]`) — cubre SharePoint + OneDrive + compartido con el usuario en una sola llamada. Es el mismo endpoint que usa el conector MCP de Microsoft 365.
- **Aplicar en**: cualquier búsqueda de archivos de usuario sobre Graph API — nunca usar los endpoints de `/me/drive` a secas cuando el contenido puede vivir en SharePoint de equipo.

### 2026-08-05: Motor de cálculo tenía Cotización y Finiquito con las fórmulas cruzadas, y SENCE inventaba un valor que no existe

- **Error real, encontrado al revisar el Excel real formula por fórmula** (`scripts/inspect-flujo-caja-formulas.ts`, confirmado estable en 7 meses distintos) contra la metodología que el usuario redefinió explícitamente:
  - Cotización usaba 24%×Remuneración sola; la fórmula real es 30%×(Anticipo+Remuneración+Reliquidación) — estaba literalmente cambiada por la de Finiquito.
  - Finiquito usaba 30%×(Remun+Reliq+Anticipo); el usuario pidió promedio de los últimos 6 meses reales (metodología nueva, no la del Excel).
  - Aporte SENCE se calculaba con 8%×Remuneración+$30M — un valor que el usuario confirmó que NUNCA existió como fórmula, siempre fue manual, y no había ningún punto de la UI para ingresarlo.
  - Anticipo siempre quedaba en $0 — nunca se había investigado la carpeta real "Pagos Mensuales/anticipos".
- **Fix**: `formulas.ts`/`engine.ts` reescritos con las reglas confirmadas una por una con el usuario (ver commit `feat(F10)`). Se investigó la carpeta de Anticipo completa vía MCP de Microsoft 365 y se encontró la fuente real correcta (`solicitud requerimientos anticipo <mes> <año>.xlsx`) — se conectó al parser genérico existente. Remuneración pasó a un modelo costo-por-cabeza × dotación (usa el modelo de curvas de obras similares que ya existía en Fase 6). Se agregó una celda editable para SENCE en la tabla de detalle — antes no había forma de cargarlo.
- **Aplicar en**: cuando el usuario pida "revisa el Excel real y redefine las reglas", no asumir que la metodología documentada en el código coincide con las celdas reales — inspeccionar las fórmulas del archivo con exceljs antes de tocar el motor.

### 2026-08-05: `bg-[var(--x)]/NN` no renderiza — Tailwind no puede aplicar opacidad sobre una variable CSS en hex

- **Error real, visto en pantalla**: el nav quedaba con fondo transparente (logo/texto blanco invisible) pese a tener `bg-[var(--navy)]/95` en el className. Tailwind v3 solo sabe aplicar el modificador de opacidad `/NN` sobre variables CSS definidas como canales RGB separados (`10 20 40`); las variables de marca en `globals.css` están en hex (`#0a1f3c`) — la clase se genera pero el navegador nunca pinta un color, sin ningún error de build.
- **Fix**: reemplazar por `style={{ backgroundColor: "var(--navy)" }}` (color sólido) o por un `rgba()` fijo precalculado cuando se necesita opacidad real (ver `alert-panel.tsx`). Se hizo un barrido de todo `src/` buscando el mismo patrón (`grep -[a-zA-Z-]+\[var\(--[a-zA-Z-]+\)\]/\d+`) — encontrada y corregida 1 instancia más.
- **Aplicar en**: nunca usar `/NN` sobre `[var(--x)]` en Tailwind mientras las variables de marca sigan en hex. Si se necesita opacidad, usar `rgba()` fijo o un inline style.

---

## Gotchas (Antes de Implementar)

- [ ] El registro de App en Azure AD con permisos delegados puede requerir consentimiento de un administrador de Microsoft 365 en Maestra — no asumir que es inmediato
- [ ] Naming de carpetas/archivos en SharePoint "Pagos Mensuales" es inconsistente (singular/plural, sufijos, subcarpetas "Nueva carpeta") — la búsqueda debe ser por patrón mes/año, nunca por ruta fija
- [ ] Archivos Excel pueden estar bloqueados (abiertos en Excel de escritorio) — implementar reintento con backoff desde el primer parser, no como parche después
- [ ] NUNCA persistir RUT o nombre de persona junto a un monto de remuneración — descartar esos campos inmediatamente después de validar cada fila
- [ ] El sync de Buk de este proyecto debe ser INSERT-only (a diferencia del upsert destructivo de `panel-relaciones-laborales`) para construir histórico real
- [ ] El export HTML debe tener CSS/JS/datos 100% inline — cero `<link>` o `<script src>` externos, o deja de ser "autocontenido"

## Anti-Patrones Forge

- ❌ NO crear nuevos patrones cuando los existentes funcionan
- ❌ NO ignorar errores de TypeScript — corregirlos siempre
- ❌ NO hardcodear valores — usar variables de entorno o constantes
- ❌ NO omitir validación Zod en cualquier input externo (Excel parseado, respuesta de Graph/Buk)
- ❌ NO crear tablas sin RLS si contienen datos agregados de nómina
- ❌ NO escribir código en el root de `src/app/` — respetar Feature-First
- ❌ NO usar el `service_role key` de Supabase en ningún código que corra en el cliente

---

## 🚧 Pendientes en manos del usuario (no se pueden resolver desde el agente)

10 fases con código completo, 65 tests unitarios pasando, `npx tsc --noEmit` y `npm run build` limpios. ~~Consentimiento de administrador en Azure AD~~ y ~~`BUK_API_KEY`~~ ya resueltos. Lo que sigue requiere acción de Carlos:

1. **Volver a correr "Actualizar reporte" con los fixes de esta sesión** (buscador de Graph corregido + Anticipo real conectado + modelo de dotación) — la última corrida real fue ANTES del fix del buscador (dio PARCIAL, 0 documentos). Revisar `/fuentes` y `/reporte` después de correrlo.
2. **Cargar el Aporte SENCE del período actual** — es el único dato manual del modelo; ahora hay una celda editable en la tabla de detalle (columna SENCE, click para ingresar) donde antes no existía ningún punto de entrada.
3. **Validar la metodología nueva contra un cierre real de nómina** — comparar el Total Nómina que arroja el reporte contra el Excel actual en un mes ya cerrado, antes de confiar en la proyección para meses futuros.
4. **Deploy a Vercel** — requiere la cuenta Vercel de Carlos (el agente no puede autenticarse ahí). Pasos: `vercel link` → configurar las variables de entorno de `.env.local` en el dashboard de Vercel → `vercel deploy --prod`.
5. **Actualizar el Redirect URI de Azure AD** con la URL real de producción una vez desplegado (hoy solo tiene `localhost:3000`).
6. **Piloto en paralelo** — usar la herramienta para el próximo ciclo de nómina junto al Excel actual, comparar resultados antes de descontinuar el proceso manual.

---

_La Pieza — 9 fases con código completo. Pendiente validación end-to-end del usuario (login real) y deploy._
