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

### 2026-08-06: búsqueda de Graph seguía sin encontrar archivos reales que existen (2 causas más)

- **Error real, confirmado en vivo con 2 screenshots sucesivos**: después del primer fix del endpoint de búsqueda, Plan de Obras Gespro seguía fallando y varios meses de Pagos Mensuales daban 409 al descargar. Causas: (1) `parentReference` puede venir vacío en `/search/query` incluso pidiéndolo en `fields` — no es un campo confiable de esa API; (2) 409 "resourceModified" en `/content` es transitorio (SharePoint todavía procesando el eTag de un archivo recién indexado).
- **Fix**: `resolveDriveItemFromWebUrl()`/`ensureDriveId()` en `graph/client.ts` — resuelve driveId/path desde el `webUrl` (que la API SÍ devuelve siempre) vía `GET /shares/{shareId}/driveItem`, el método documentado por Microsoft para esto. `graphFetch` reintenta hasta 2 veces con backoff corto ante un 409.
- **Aplicar en**: nunca asumir que un campo "opcional pero pedido" de una API de búsqueda de Microsoft viene poblado — verificar con datos reales. Reintentar 409/429 en descargas de SharePoint recién indexadas antes de fallar.

### 2026-08-06: `headcount_by_obra` con 0 filas pese a tener 524 snapshots reales de Buk para comparar

- **Error real, encontrado con una consulta directa a la base**: el KPI "Obras con dotación estimada" mostraba 0 en pantalla. El modelo de estimación (Fase 6, curva por obra similar) existía y funcionaba, pero requería un click manual POR OBRA en `/dotacion` — con 33 obras, nadie lo corrió nunca.
- **Fix**: `refresh.ts` ahora corre el modelo automáticamente para toda obra sin ningún dato, como parte de "Actualizar reporte" (best-effort — una obra sin similares con histórico real aún no es un error).
- **Aplicar en**: un modelo "que ya existe" no sirve si el único punto de entrada es manual y hay decenas de instancias — evaluar si conviene automatizarlo como parte del flujo principal.

### 2026-08-06: El Excel histórico real del Excel maestro nunca se ingería — la tabla de detalle salía incompleta

- **Error real reportado por el usuario** (captura de la tabla de detalle con ago/sep/nov-2025 en $0): la ingesta granular de "Pagos Mensuales" (1 archivo por concepto/mes en SharePoint) venía incompleta para varios meses de 2025, aunque los archivos sí existían (confirmado). El Excel MAESTRO de Flujo de Caja (carpeta "Flujo de Caja", que Finanzas mantiene cerrado mes a mes) sí tenía esos meses completos — pero nunca se había construido un importador para su hoja "Detalle", solo se habían inspeccionado sus fórmulas.
- **Fix**: nuevo parser (`flujo-caja-historico-parser.ts`) + sync (`sync-flujo-caja-historico.ts`) que lee las columnas agrupadas ($ + N° por mes, real vs. proyectado por COLOR DE RELLENO amarillo, no por fórmula) y las importa con prioridad sobre la ingesta suelta de SharePoint (protegidas igual que un override manual). De paso resolvió 2 pedidos más del usuario: desglose RG/RP de Remuneración/Anticipo (el Excel ya los separa) y la fila de dotación real histórica (columna "N°" de Remuneraciones RG/RP).
- **Aplicar en**: cuando existe un registro maestro/autoritativo mantenido por otra área (Finanzas, en este caso) y una ingesta granular propia, el maestro debería tener prioridad para el histórico ya cerrado — la ingesta granular es para rellenar lo que el maestro todavía no cubre, no al revés.

### 2026-08-06: migración SQL nueva no se pudo aplicar — sin acceso a la base desde este entorno

- **Limitación real, no error de código**: la migración `20260806000001_remuneracion_rg_rp_y_dotacion_mensual.sql` quedó escrita y committeada, pero no se pudo ejecutar contra la base real. El proyecto está linkeado (`supabase/.temp/project-ref` existe) pero el CLI de Supabase no tiene un access token disponible en este entorno no-interactivo (`supabase login` requiere navegador), y no hay `DATABASE_URL`/password de Postgres en `.env.local` para conectar directo. El cliente de Supabase JS (`service.ts`) usa `service_role key` vía PostgREST — no puede ejecutar DDL (`ALTER TABLE`/`CREATE TABLE`).
- **Cómo se aplicaron las migraciones anteriores entonces**: probablemente por una sesión previa con `supabase login` ya hecho, o manualmente por el usuario — no quedó un mecanismo repetible documentado.
- **Aplicar en**: si se necesita aplicar una migración nueva y no hay `SUPABASE_ACCESS_TOKEN`/`DATABASE_URL` a mano, no asumir que se puede — avisar explícitamente al usuario y darle el SQL exacto para pegar en el SQL Editor del dashboard. Considerar agregar `SUPABASE_ACCESS_TOKEN` a `.env.local` (o documentar dónde vive) para que las próximas migraciones sí se puedan aplicar solas.

### 2026-08-13: Beneficios/Bonos — de "concepto/fila aparte" a "implícito dentro de Remuneración" (corrección del usuario, no bug)

- **Primer diseño (revertido)**: la primera implementación agregó Beneficios como un concepto/fila SEPARADA (`beneficios`, `beneficios_rg`, `beneficios_rp`) visible en la tabla de detalle, y sumó explícitamente ese monto como 4to término en la fórmula de Cotización. El usuario vio la fila nueva en `/reporte` (todo en "—" porque la migración aún no estaba aplicada) y corrigió: "no quiero que agregues estos como adicionales... se deben considerar de manera implícita en las remuneraciones, corrige todo".
- **Diseño final**: `engine.ts` suma `beneficiosRg.monto + beneficiosRp.monto` DENTRO del monto final de `remuneracion` (antes de que Anticipo/Reliquidación/Cotización lo usen) — no existe fila ni concepto `beneficios*` en `cash_flow_monthly`. `calcularCotizacion` volvió a su firma original de 3 argumentos: como Remuneración ya viene con Beneficios adentro, Cotización los incluye sin necesidad de un 4to sumando. El desglose informativo RG/RP de Remuneración (`refresh.ts`) también reparte cada Beneficio a su población exacta (no proporcional — el Bono de Término de Negociación es 100% RG) para que RG+RP sigan sumando exacto el total. `beneficios_line_items` (detalle por evento) SÍ se mantiene — es bitácora/auditoría interna, nunca una fila visible.
- **Aplicar en**: cuando el usuario pida incorporar un monto nuevo al flujo de caja, preguntar explícitamente si debe verse como concepto propio (visible, auditable por separado) o absorbido dentro de un concepto existente — son decisiones de UI/negocio genuinamente distintas y esta sesión asumió la primera sin preguntar.

### 2026-08-13: Segmentación RG/RP para Beneficios — reutilizar, no reinventar una dimensión de "sindicalizado"

- **Hallazgo (evitó trabajo duplicado)**: el pedido inicial parecía requerir una nueva dimensión "sindicalizado vs. no-sindicalizado" en el modelo, con su propio dato de dotación. El usuario aclaró que esa segmentación **es exactamente RG (Rol General) vs. RP (Rol Particular)** — la misma dimensión que YA existe hace semanas para Anticipo/Remuneración, con dotación real ya disponible en `dotacion_mensual.rg/rp` (columnas del Excel histórico).
- **Fix**: `beneficios.ts`/`refresh.ts` reutilizan `dotacion_mensual` + la misma razón proporcional RG/(RG+RP) (`proporcionRgHistorica`, ya existente) que Remuneración/Anticipo proyectados usan para meses sin Excel histórico — cero tablas ni columnas nuevas de dotación.
- **Aplicar en**: antes de modelar una "nueva" dimensión de segmentación de personas, revisar si el modelo ya tiene una equivalente por otro nombre (acá RG/RP ya era, en la práctica, sindicalizado/no-sindicalizado).

### 2026-08-13: `familia_cargo` de Buk se leía pero se descartaba en memoria (columna ya existía, siempre NULL)

- **Hallazgo (auditoría experta de nómina pedida por el usuario)**: `agruparDotacion()` (`buk-sync/aggregate.ts`) ya lee `current_job.role.role_family.name` de la API de Buk y lo guarda como `familiaCargo` por grupo — pero `sync.ts` nunca lo escribía a `buk_cargo_catalog.familia_cargo` (columna que existe desde la migración inicial). Se calculaba y se tiraba.
- **Fix**: `sync.ts` ahora persiste `familia_cargo` al crear cargos nuevos en el catálogo, y hace backfill de los cargos ya existentes que quedaron en NULL. Sin migración nueva — la columna ya estaba.
- **Por qué importa**: útil como analítica de nivel/carrera (cuántos "Operativos" vs "Jefaturas" vs "Profesionales", etc.). **CORRECCIÓN a esta misma nota** (verificado con la API real horas después, ver entrada "Construcción vs Oficina Central" más abajo): `familia_cargo` **NO es "Rol General"/"Rol Particular"** — los valores reales que devuelve Buk son una taxonomía de nivel/carrera (Operativos, Jefaturas Táctico/Movilizador, Profesionales, Administrativos y Técnicos, Ejecutivo, Comercial), completamente distinta a la clasificación contractual RG/RP que usa el Excel histórico de Finanzas. La segmentación RG/RP real desde Buk es **si el `area_id` del trabajador matchea a una obra o no** (`obra_id IS NOT NULL` en `buk_dotacion_snapshots`, exactamente como ya se usa para el mapa de Construcción vs. Oficina Central) — no `familia_cargo`.
- **Aplicar en**: siempre revisar si un campo que un cliente de API ya trae y tipa (aunque sea "para uso interno/agregación") se está persistiendo o se descarta silenciosamente en memoria — es la oportunidad más barata de enriquecer un modelo sin tocar la fuente de datos.

### 2026-08-13: Auditoría de dotación — el usuario pidió foco en CANTIDAD (dotación), no en precio/tarifa

- **Contexto**: tras el análisis de Cotización/Reforma Previsional/AFC, el usuario redirigió explícitamente: "lo que más me interesa es que el flujo de dotación sea el correcto, estás centrando todo el análisis en el precio". Correcto — Remuneración = costo_por_cabeza × **dotación**, y ningún ajuste de precio importa si la cantidad está mal.
- **Hallazgos reales, confirmados con `scripts/inspect-dotacion-coverage.ts` y `scripts/analizar-correlacion-dotacion.ts` (API real de Buk + Supabase, no hipótesis)**:
  1. El cron mensual de Buk solo ha corrido **1 vez** (2026-08-05) — cero histórico mes a mes todavía, imposible calcular correlaciones reales.
  2. Solo **4 de 32** obras elegibles para el modelo de curva tienen algún snapshot real de Buk como referencia.
  3. De **254 filas** en `headcount_by_obra` (100% origen='modelo_estimado' — nunca se ha poblado 'buk_real' ni 'manual'), **91% tenían `variacion_neta = 0`** — casi todas por falta de obra de referencia con dato ese mes de avance (`promediarCurvas` cae a 0 cuando NINGUNA referencia tiene señal), **no** porque el modelo haya confirmado "sin cambios". Antes esto era indistinguible de un 0 real.
  4. La columna `headcount_by_obra.acumulado` existe en el schema desde el inicio y **nunca se poblaba** — por eso la hoja "Plan de Obra" del Excel solo mostraba el delta mensual, nunca la dotación absoluta proyectada por obra (el usuario pidió explícitamente el mecanismo "Dotación Neta = Altas−Bajas → da el saldo inicial del período siguiente").
  5. Snapshot en vivo de hoy (849 activos): 550 en Construcción (área matchea una obra) / 299 en Oficina Central (sin match). El snapshot YA guardado del 5-ago (527/386, total 913) **no coincide** con este pull en vivo — ni el total ni la proporción. Puede ser rotación real en 8 días, pero es más probable que sea inestabilidad del matching heurístico `matchObraByName` entre corridas — **sin resolver, queda como flag abierto**, no se investigó más a fondo esta sesión.
  6. Con 1 solo punto de histórico, la correlación Construcción↔Oficina Central pedida por el usuario **no se puede calcular todavía** (se necesitan ≥3 meses) — el script queda listo para correrse de nuevo cuando haya más snapshots.
- **Fix implementado esta sesión**:
  - `curve.ts`: `promediarCurvas`/`aVariacionNeta` ahora devuelven `{ valor, sinDatoReferencia }` en vez de un número plano — un mes sin ninguna curva de referencia queda marcado explícitamente, no como un 0 silencioso.
  - `run.ts`: nuevo origen `'sin_dato_referencia'` (migración `20260813000002_headcount_sin_dato_referencia.sql`, agrega el valor al CHECK) + ahora sí se escribe `headcount_by_obra.acumulado` (dotación absoluta de la curva, no solo el delta).
  - `plan-obra-dotacion.ts` / `render-excel.ts` / `dotacion/page.tsx`: exponen `dotacionProyectada` (columna nueva "Dotación Proyectada (acumulada)" en el Excel) y distinguen visualmente "estimado con dato real" (amarillo) de "sin obra de referencia" (gris) — antes ambos se veían iguales.
- **Aplicar en**: cuando un modelo de fallback (curva, promedio, etc.) puede quedarse sin ninguna señal real para calcular, SIEMPRE devolver/marcar eso explícito (no un 0 numérico indistinguible) — un 0 silencioso por falta de dato es el bug más peligroso porque no se ve como error, se ve como una proyección válida.
- **Pendiente/preguntas abiertas para el usuario**: (a) ¿existe un export histórico de dotación desde el reporteador de Buk (no la API en vivo) que permita traer varios meses/años de una vez, en vez de esperar que el cron mensual acumule un punto por mes durante 1-2 años?; (b) ¿existe una curva de dotación tipo/presupuestada por fase de obra que use Operaciones internamente, que pueda sembrar el modelo ahora en vez de depender solo de las 4 obras con histórico real?; (c) investigar la discrepancia del punto 5 antes de confiar en la clasificación Construcción/Oficina Central para decisiones.

### 2026-08-13: Export HTML tenía la fila "Total Nómina (UF)" calculada pero nunca insertada en la tabla

- **Error real encontrado al comparar `render.ts` contra `/reporte`**: la variable `filaUf` se calculaba pero el `<tbody>` solo insertaba `${filaDotacion}${filasTabla}` — la fila UF quedaba silenciosamente descartada en el HTML descargable (sí aparecía en la app en vivo y en el Excel). Bug preexistente, no introducido en esta sesión.
- **Fix**: `<tbody>${filaDotacion}${filasTabla}${filaUf}</tbody>`.
- **Aplicar en**: al tocar una plantilla de exportación con variables intermedias, verificar que TODAS se usen en el markup final — una variable calculada y nunca interpolada no da error de TypeScript si el resto del archivo la referencia en otro lugar, pero acá ni siquiera eso ocurría (era candidata a `noUnusedLocals`, que este proyecto no tiene activado).

### 2026-08-13: Gráfico de Total Nómina — degradé + glow + marca de agua (pedido explícito del usuario)

- **Pedido**: "utilices /imagen-nano-banana para mejorar el diseño del gráfico que sea moderno... indica con una marca de agua pequeña quien lo hizo Carlos Godoy Sainz o créame un sello".
- **Fix**: relleno de área pasó de opacidad plana a un `linearGradient` (dorado, más opaco arriba); la línea ganó un `feDropShadow` sutil (glow) para dar profundidad — aplicado igual en `cash-flow-area-chart.tsx` (vivo) y `render.ts` (export HTML), mismo criterio de siempre de mantener ambos visualmente idénticos.
- **Sello**: generado con Nano Banana (`gemini-3-pro-image`, texto "CARLOS GODOY SAINZ" arqueado, paleta navy/dorado de Marca Maestra), recortado/reducido a 200×200 con `System.Drawing` (PowerShell) y embebido como base64 en `src/features/cash-flow/lib/watermark.ts` (`SELLO_AUTOR_BASE64`) — un solo módulo compartido para que ambos consumidores lo usen igual. Se coloca como `<image>` de baja opacidad (0.22) en la esquina inferior derecha del gráfico, `pointer-events:none` para no interceptar el mouse en la versión interactiva.
- **Aplicar en**: cualquier asset de imagen que deba vivir en un HTML 100% autocontenido (export) Y en un componente React (vivo) — generar UNA vez, convertir a base64, y exportarlo desde un módulo compartido en vez de duplicar el string en los 2 archivos.

### 2026-08-13: REGLA DE NEGOCIO — Aporte SENCE es 500 UF el 30 de junio, NO $20.000.000 fijos

- **Corrección del usuario**: "El SENCE se carga cada 30 junio 500 UF... el resto de los meses no está pendiente, es $0... por el año 2026 se retrasó y tendrá que ser en agosto". El monto anterior (`SENCE_MONTO_ANUAL = 20_000_000`, un CLP fijo hardcodeado) era una aproximación que se iba a desactualizar con el tiempo — el monto real está denominado en UF.
- **Fix**: `refresh.ts` ahora convierte **500 UF** al valor de UF real de ese mes (`getUfPorPeriodo`, mismo dato que ya usa la fila "Total Nómina (UF)") en vez de un CLP fijo. Si la UF de ese mes todavía no está sincronizada, el monto queda en 0 con `metodo_calculo='pendiente_ingreso_manual'` (genuinamente pendiente); en cualquier OTRO mes (fuera de la fecha de pago), el 0 es el valor correcto y final, con `metodo_calculo='no_corresponde_pago_anual'` — antes ambos casos se veían idénticos ("pendiente"), lo cual era engañoso para el mes-a-mes que no requiere ninguna acción.
- **Fecha de pago**: 30 de junio todos los años; **excepción 2026: se retrasó a agosto** (ya estaba bien codificado en `senceMesEsperado`, sin cambios ahí).
- **Aplicar en**: cualquier proyección futura de SENCE debe seguir usando 500 UF × valor UF del mes, nunca un monto en pesos fijo — la UF se revaloriza, un CLP fijo se desactualiza silenciosamente mes a mes.

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

11 fases con código completo, 75 tests unitarios pasando, `npx tsc --noEmit` y `npm run build` limpios. ~~Consentimiento de administrador en Azure AD~~ y ~~`BUK_API_KEY`~~ ya resueltos. Lo que sigue requiere acción de Carlos:

1. **🔴 BLOQUEANTE — aplicar la migración `20260806000001_remuneracion_rg_rp_y_dotacion_mensual.sql` manualmente.** El agente no tiene acceso a la base para correr DDL en este entorno (sin `SUPABASE_ACCESS_TOKEN`/`DATABASE_URL`, ver Auto-Blindaje). Sin esto, el desglose RG/RP y la fila de dotación quedan sin efecto (el código no falla, pero `remuneracion_rg`/`remuneracion_rp`/`dotacion_mensual` no existen todavía). Pasos: Supabase Dashboard → SQL Editor → pegar el contenido completo de ese archivo → Run.
2. **Volver a correr "Actualizar reporte"** después de (1) — esta corrida importa además el Excel maestro histórico (llena los meses de 2025 que quedaban incompletos) y corre el modelo de dotación para las obras que todavía no tengan dato.
3. **Cargar el Aporte SENCE del período actual** — es el único dato manual del modelo; hay una celda editable en la tabla de detalle (columna SENCE, click para ingresar).
4. **Validar la metodología nueva contra un cierre real de nómina** — comparar el Total Nómina que arroja el reporte contra el Excel actual en un mes ya cerrado, antes de confiar en la proyección para meses futuros.
5. **Deploy a Vercel** — requiere la cuenta Vercel de Carlos (el agente no puede autenticarse ahí). Pasos: `vercel link` → configurar las variables de entorno de `.env.local` en el dashboard de Vercel → `vercel deploy --prod`.
6. **Actualizar el Redirect URI de Azure AD** con la URL real de producción una vez desplegado (hoy solo tiene `localhost:3000`).
7. **🔴 BLOQUEANTE — aplicar la migración `20260813000001_beneficios_rg_rp.sql` manualmente** (mismo motivo que el punto 1: sin acceso a DDL desde este entorno). Solo crea la tabla interna `beneficios_line_items` (no toca el CHECK de `concepto` — Beneficios se suma de forma implícita dentro de Remuneración, no es una fila propia). Sin esto, "Actualizar reporte" no puede guardar el detalle por evento y Remuneración se queda sin el aporte de Beneficios ese mes.
8. **Correr `npx tsx --env-file=.env.local scripts/seed-beneficios-lira-parque-agosto-2026.ts`** después de (7) — carga el Bono de Término de Negociación y el Aporte Sindical único de agosto-2026 (Convenio Colectivo "Lira Parque") como dato real, que quedará sumado dentro de Remuneración RG de ese mes.
9. **Cargar la dotación no-sindicalizada Rol Particular (Oficina Central)** cuando exista un mes sin cobertura del Excel histórico ni de Buk — hoy el modelo no suma Beneficios RP para esos meses (nunca inventa un número).
10. **Piloto en paralelo** — usar la herramienta para el próximo ciclo de nómina junto al Excel actual, comparar resultados antes de descontinuar el proceso manual.
11. **🔴 BLOQUEANTE — aplicar la migración `20260813000002_headcount_sin_dato_referencia.sql`** (mismo motivo: sin acceso a DDL). Sin esto, `runForecastModel` va a fallar el INSERT en filas con `origen='sin_dato_referencia'` (violación del CHECK viejo).
12. **Esperar a que el cron mensual de Buk acumule ≥3 snapshots** (corre el día 1 de cada mes) antes de que la correlación Construcción↔Oficina Central sea calculable — correr de nuevo `npx tsx --env-file=.env.local scripts/analizar-correlacion-dotacion.ts` en ese momento.
13. **Responder si existe un export histórico de dotación de Buk (reporteador, no API) o una curva de dotación presupuestada por fase de obra de Operaciones** — cualquiera de los dos aceleraría muchísimo la calidad del modelo de curva (hoy solo 4 de 32 obras tienen algún dato real de referencia).
14. **Investigar la discrepancia entre el snapshot guardado del 5-ago (527 Construcción / 386 Oficina Central) y el pull en vivo de hoy (550/299)** antes de confiar en la clasificación Construcción/Oficina Central para decisiones de negocio — ver Auto-Blindaje "Auditoría de dotación".

---

_La Pieza — 9 fases con código completo. Pendiente validación end-to-end del usuario (login real) y deploy._
