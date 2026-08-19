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

### 2026-08-13: Finiquito correlacionado con bajas netas de dotación (no solo promedio ciego)

- **Pedido**: parte de la auditoría de dotación — "lo que más me interesa es que el flujo de dotación sea el correcto". El promedio de 6 meses de Finiquito quedaba ciego a la curva de cierre de obra (dotación ya proyecta cuándo una obra empieza a bajar dotación hacia el cierre), llegando "tarde" a un pico real de indemnizaciones.
- **Fix**: `refresh.ts` calcula `costoPromedioFiniquitoPorBajaNeta` — calibrado sobre meses REALES donde Finiquito real y dotación total (mes actual y anterior) existen ambos: ratio = Finiquito real ÷ |baja neta de dotación|, promediado. Cuando la dotación total proyecta una baja neta este mes, `finiquitoFallback = costoPorBajaNeta × |bajaNeta|` con `metodo_calculo='correlacionado_bajas_netas_dotacion'`; si no hay baja neta ese mes o no hay histórico calibrable, cae al promedio de 6 meses de siempre (`promedio_ultimos_6_meses_reales`) — sin cambio de comportamiento para el caso base.
- **`engine.ts`**: `CashFlowInputs.finiquitoFallbackPromedio6m: number` pasó a `finiquitoFallback: {monto, metodoCalculo}` — mismo patrón ya usado para `senceFallback`/`beneficiosRg/Rp`, para que el motor exponga el método real usado, no un string hardcodeado que no reflejaba cuál fórmula se aplicó.
- **Aplicar en**: cuando ya existe una proyección de "cantidad" confiable (acá, dotación) para un mes, preferir correlacionar conceptos derivados (Finiquito) con ella en vez de un promedio histórico ciego — mismo principio que motivó toda la auditoría de dotación de esta sesión.

### 2026-08-13: Bug real de matching — "Obra Serrano Torre A" no conectaba con "Serrano A" (98 trabajadores de obra cayendo a "Oficina Central")

- **Error real, encontrado auditando el pull en vivo de Buk**: de las 5 áreas con prefijo "Obra..." en Buk, 4 matcheaban bien contra el catálogo `obras`, pero **"Obra Serrano Torre A" (98 activos) no matcheaba con "Serrano A"** — ninguna de las 2 reglas de `matchObraByName` (exacto, o parcial por límite de palabra `\b`) las conecta, porque no comparten NINGUNA palabra completa en común ("torre" las separa: "serrano torre a" vs. "serrano a"). Esos 98 trabajadores de obra quedaban cayendo silenciosamente al balde "Oficina Central" — esto por sí solo cambia el split Construcción/Oficina Central reportado antes (550/299 en vivo) a algo más cercano a 648/201, bastante distinto.
- **Fix**: `match-obra.ts` gana un tercer nivel de fallback, `ALIAS_MANUAL` (mapa explícito nombre-de-área-normalizado → nombre-de-obra), que se consulta SOLO si el match exacto y el match por palabra fallan — no se tocó la lógica de esos 2 (evita romper el caso "Lira I" vs "Lira II" ya probado). Agregado por ahora: `"serrano torre a" -> "serrano a"`.
- **Aplicar en**: cuando Buk y Gespro nombran la misma obra de forma distinta (edificio/torre vs. nombre comercial del proyecto), un alias manual explícito es más seguro que aflojar la regex genérica — aflojarla arriesga falsos positivos entre obras reales con nombres parecidos (ej. "Lira Parque" vs. "Lira Plaza"). Si aparecen más casos así, agregarlos a `ALIAS_MANUAL` uno por uno, nunca relajar el matching por palabra.
- **Pendiente**: correr `runBukSnapshot`/el cron real para que este fix se refleje en `buk_dotacion_snapshots` (el snapshot del 5-ago-2026 ya guardado NO se corrige retroactivamente solo, hay que resincronizar).

### 2026-08-14: Backfill histórico completo (2018-2026) — hallazgos de patrones reales y una limitación importante

- **Backfill completado**: `scripts/backfill-dotacion-historica.ts` corrió de punta a punta — 103/103 meses reales desde `GET /employees/active?date=`. En el camino se cortó una vez por una caída de red nocturna (dejó 43 meses con hueco, un bug en la lógica de "resume" que asumía sin huecos en el medio — corregido, ver commit `feat(backfill): capacidad de retomar`), y una segunda corrida con la lógica de huecos corregida rellenó exactamente lo que faltaba sin duplicar ni perder la cadena de altas/bajas.
- **Patrón real #1 — contracción y recuperación fuerte de dotación total**: la compañía pasó de ~2.200-2.400 activos (2018-2019) a un mínimo de **336 en junio-2024** (~85% de caída) y luego se recuperó a ~850 hacia jul-2026. La caída es mucho más larga y profunda que lo explicable solo por COVID (2020) — sigue bajando hasta 2024. Vale la pena que el usuario confirme si esto coincide con algo conocido (venta de unidad de negocio, reestructuración, etc.) — el dato es real, la interpretación de causa no la tiene el modelo.
- **Patrón real #2 — correlación Construcción vs. Oficina Central**: Pearson de las variaciones mensuales = **-0,06 en toda la serie (2018-2026)**, **-0,29 en la ventana confiable (2024-01 a 2026-07, 31 meses)**. En ambos casos, prácticamente independientes — si acaso, levemente inversos. Esto **confirma la hipótesis del usuario**: "el plan de obra ajusta y modifica la dotación de la constructora pero incide en menor medida en Oficina Central". No hay evidencia de que Oficina Central escale junto con Construcción mes a mes.
- **LIMITACIÓN IMPORTANTE, a tener en cuenta en cualquier análisis futuro con estos datos**: la clasificación Construcción/Oficina Central se resuelve consultando el nombre ACTUAL de cada `area_id` en Buk (`/areas/{id}`), no el nombre que tenía en la fecha histórica consultada. Como el catálogo `obras` solo tiene proyectos desde mayo-2024 en adelante, cualquier `area_id` que HOY se llama "Obra X" pero en 2018-2023 pudo haber sido un equipo/área distinta (renombrada con el tiempo) queda igual clasificada como "Construcción" retroactivamente — por eso el split de 2018-2023 (13 a 164 personas en "Construcción") NO es una medición confiable de dotación real de obra en esos años, solo un artefacto de qué `area_id` terminó convirtiéndose en obra. **La ventana confiable para el split Construcción/Oficina Central es desde ~2024-03 en adelante** (cuando empiezan a existir obras reales en el catálogo); el TOTAL de dotación (sin el split) sí es confiable en toda la serie.
- **Aplicar en**: cualquier análisis futuro que use `buk_dotacion_snapshots` con `obra_id` para períodos anteriores a mayo-2024 debe tratar el split como no confiable — usar solo el total, o filtrar a `snapshot_date >= '2024-03-01'` para cualquier comparación por obra/Oficina Central.
- **Pendiente**: correr "Actualizar reporte" en la app (requiere sesión real, no se puede scriptear sin `next-auth`) para que `runForecastModel` recalcule la curva de obras similares usando el histórico real recién sembrado — antes solo 4 de 32 obras tenían algún dato de referencia, ahora hay 103 meses reales para las obras activas desde 2024.

### 2026-08-14: Validación de la contracción de dotación + confirmación del modelo por obra (pedido explícito del usuario)

- **Validación cruzada de la contracción 2019→2024 con 2 fuentes 100% independientes de Buk**:
  1. `dotacion_mensual` (Excel histórico de Finanzas, pipeline totalmente distinto): mismo patrón — 1.018 (nov-2022) → 314 (jun-2024, **el mismo mes de piso que Buk**) → 947 (ene-2026). Diferencias Excel-vs-Buk de solo 0-10% mes a mes (nivel esperado entre 2 sistemas independientes, no un patrón de glitch).
  2. `cash_flow_monthly` remuneración REAL pagada (plata real que salió del banco, no conteo de gente): cae de ~$900M/mes (nov-2022) a ~$430-500M/mes (2024), se recupera a ~$850-900M+ (2025-2026) — mismo timing exacto.
  - **Conclusión**: la caída es real, no un artefacto técnico del backfill. Coincide con la explicación del usuario: retiros de fondos de pensiones (2020-2021) → inflación/alza de tasas → crisis de poder de compra inmobiliario en Chile (2022-2024), que golpea con fuerza a una constructora/inmobiliaria.
- **Confirmación de arquitectura pedida por el usuario**: "el modelo debe considerar... dotación por obra... evaluar la curva de ese proyecto y después la replicas para el plan de obra" — es EXACTAMENTE lo que `forecast-model/{run,curve,similarity}.ts` ya hace (curva de obras similares indexada por mes de avance, no por fecha calendario). Se validó con datos reales post-backfill:
  - Las curvas reales por obra (`buk_dotacion_snapshots.obra_id`) muestran formas de ciclo de proyecto plausibles (rampa de subida → peak → rampa de bajada) — ej. "Jorge Edwards": ~1 activo por años, rampa limpia desde 27 (feb-2025) hasta 180 (mar-2026); "Vista Llacolén B": rampa limpia 13→151 en 12 meses.
  - `curvaPorAvance` (ya existente, sin cambios) filtra correctamente por rango `[0, dur_obra_meses)` desde `inicio_obra` — esto YA descarta automáticamente el histórico pre-2024 "ruidoso" de una obra usada como referencia (ej. "Pintor Cicarelli I" tiene dato de Buk desde 2018 porque su `area_id` existía antes con otro propósito, pero como su `inicio_obra` real es 2024-09, todo lo anterior cae en índice de mes negativo y se ignora solo). No fue necesario ningún fix adicional para esto.
  - Simulación en vivo (sin escribir a la base, solo para validar) de `runForecastModel` para 3 obras sin histórico propio (Serrano A, Vista Llacolén A, Vistamar) usando obras similares como referencia: las 3 producen curvas completas y con forma de ciclo de proyecto razonable. 2 obras (Lira 1, Lira 2 — tipo "DS49") no tienen ninguna obra de referencia con dato real todavía — limitación honesta, no se inventa nada.
- **Aplicar en**: no se necesitó ningún cambio de código a partir de esta validación — la arquitectura y el fix de `sinDatoReferencia` del 13-ago ya eran correctos. Queda solo correr "Actualizar reporte" (pendiente del punto anterior) para que esto se calcule y persista de verdad (con su `headcount_forecast_runs` de auditoría), en vez de la simulación de validación de hoy que no escribió nada.

### 2026-08-14: Confirmado — existe una transición real "obra gruesa → terminaciones", detectable por mix de cargo

- **Pedido del usuario**: "¿consideras el flujo de dotación en base a la etapa de la obra... obra gruesa, terminaciones?... se debe ir testeando mes a mes". Gespro NO tiene ningún hito de fase constructiva (revisé la hoja real "Gespro" completa: solo hitos legales/comerciales/técnicos PRE-construcción — ventas, permisos, DIA, subdivisión, etc. — nada de obra gruesa/terminaciones).
- **Backfill nuevo**: `scripts/backfill-dotacion-por-cargo.ts` — igual que el backfill anterior pero preservando el CARGO real de cada persona (antes se descartaba al agregar a "rollup"). Mismo costo de API (el cargo ya se traía, solo no se guardaba). **102/103 meses completos** — falta solo 2022-04-01 (falló por un error de red transitorio), dejado sin completar a propósito: cae dentro de la ventana pre-2024 ya documentada como no confiable (ninguna obra real existía todavía), así que no aporta al análisis de fases — no vale el costo de ~2h adicionales de backfill solo por ese mes.
- **Clasificación de cargos por fase** (por nombre real observado): Enfierrador/Carpintero/Moldajero/Andamiero/Albañil/Rigger/Trazador/Soldador → obra gruesa; Pintor/Yesero/Empapelador/"en Terminaciones" → terminaciones; el resto (Jornal, Gásfiter, Eléctrico, supervisores, jefaturas, profesionales) → transversal (aparecen en ambas fases, no distinguen).
- **Confirmado con datos reales**: "Alto Buzeta" muestra una transición limpia y detectable — % de terminaciones sobre (gruesa+terminaciones) se mantiene en 7-18% durante los meses 0-10, salta a 32% en el mes 11, y a 42-100% de ahí en adelante. **Transición detectada en el mes 11 de 22 — exactamente 50% de la duración total de la obra.** Las demás obras con histórico (Jorge Edwards, Pintor Cicarelli I) todavía no acumulan suficientes meses para mostrar su propia transición (siguen en fase temprana/gruesa en la ventana de datos disponible).
- **Aplicar en / próximo paso propuesto (no construido todavía, a la espera de decisión del usuario)**: el modelo de curva (`forecast-model/curve.ts`) hoy proyecta UNA sola curva de dotación total por obra. Con este hallazgo, se podría dividir en 2 curvas por fase (gruesa y terminaciones) en vez de 1 blended — más preciso para: (a) comparar obras similares en la MISMA fase, no solo al mismo "% de avance calendario"; (b) proyectar el costo-por-cabeza de Remuneración correctamente (Maestro Enfierrador y Maestro Pintor no cobran lo mismo). Requiere más obras con histórico completo para calibrar un umbral de transición confiable (hoy solo 1 obra tiene el ciclo completo observado).

### 2026-08-14: Bug real de Supabase/PostgREST — `.limit()` del cliente NO garantiza traer todas las filas

- **Error real, encontrado 2 veces seguidas en vivo**: la consulta de "resume" de `backfill-dotacion-por-cargo.ts` (¿qué fechas ya tienen detalle por cargo?) traía solo ~10 de 103 fechas como "ya hechas" — una corrida de "reparación" de 1 solo mes faltante terminó re-procesando 93 meses que ya estaban completos. Primer intento de fix (agregar `.limit(30_000)` al cliente) **no funcionó** — PostgREST tiene un tope server-side (`max-rows`, típicamente 1000) que **ignora** el `.limit()` que pide el cliente si es mayor a ese tope; la consulta seguía viniendo truncada a ~1000 filas totales (de ~20.000+ esperadas), y sin `.order()` el subconjunto devuelto es esencialmente arbitrario.
- **Fix real**: reemplazar la consulta masiva por 103 consultas livianas, una por fecha, usando `{ count: "exact", head: true }` (pide solo el conteo, no trae filas) — así cada chequeo es rápido y nunca choca con el tope de filas, sin importar cuántas filas reales existan por fecha.
- **Aplicar en**: cualquier consulta a Supabase/PostgREST que pueda superar ~1000 filas — NUNCA asumir que `.limit(N)` con N alto garantiza traer todo; verificar el conteo real (`{count:"exact"}`) o paginar explícitamente con `.range()`. Ya se corrigió preventivamente el mismo patrón en `backfill-dotacion-historica.ts` (bajo riesgo ahí por volumen bajo, pero mismo fix de todas formas).

### 2026-08-14: Modelo de curva de dotación pasa a v2 — re-indexado por FASE (obra gruesa / terminaciones), generalizado a todas las obras

- **Pedido del usuario**: tras confirmar la transición real de "Alto Buzeta" (ver hallazgo anterior del mismo día), el usuario autorizó explícitamente generalizar ese único punto de datos a todo el modelo: "el resto de las obras tienen el mismo modelo de Buzeta" → "aplica el modelo que propones, commiteado todo localmente".
- **Cambio**: nueva función `curvaPorAvanceConFases` en `forecast-model/curve.ts` — en vez de indexar la curva de la obra de referencia por mes calendario crudo desde su inicio, la trata como 2 fases (obra gruesa = 1ra mitad de su duración, terminaciones = 2da mitad) y reescala cada fase por separado (regla de 3 sobre su propia mitad) al eje de meses de la obra objetivo. Así "30% avanzada la fase terminaciones" de la referencia cae en "30% avanzada la fase terminaciones" del objetivo, sin importar que las duraciones totales difieran — antes, comparar 2 obras de duración distinta por mes calendario podía mezclar el remate de obra gruesa de una con el inicio de terminaciones de otra en el mismo índice.
- `run.ts` ahora llama a `curvaPorAvanceConFases` (antes `curvaPorAvance` directo) pasando la duración PROPIA de cada obra de referencia (`obraRef.dur_obra_meses`, con fallback a la del objetivo si no está cargada) — requirió agregar `dur_obra_meses` al `select` de `todasLasObras`, que antes no lo traía. El `metodo` registrado en `headcount_forecast_runs` pasa de `"similar_obras_v1"` a `"similar_obras_v2_fases"` para que quede trazable en la auditoría qué corridas usaron cada versión del modelo.
- **Límite conocido, documentado a propósito**: la regla de "transición exactamente a la mitad de la duración" está calibrada con **una sola obra** con ciclo completo observado (Alto Buzeta). Es una generalización explícitamente autorizada por el usuario, no un hallazgo estadístico con múltiples obras — cuando más obras acumulen su ciclo completo en `buk_dotacion_snapshots`, vale la pena recalibrar el punto de corte (hoy fijo en 50%) en vez de asumirlo indefinidamente.
- **Verificado**: 4 tests unitarios nuevos en `curve.test.ts` (identidad cuando ref y objetivo tienen igual duración, alineación del inicio de fase terminaciones entre duraciones distintas, promedio cuando 2 meses de referencia colapsan en el mismo mes objetivo por compresión de fase, caso borde duración-referencia=0). `npx tsc --noEmit`, `npx vitest run` (101/101) y `npm run build` limpios tras el cambio.
- **Aplicar en**: correr "Actualizar reporte" en la app (sesión real) para que `runForecastModel` recalcule con el modelo v2 y quede persistido con su `headcount_forecast_runs` de auditoría — la validación de hoy fue solo unitaria sobre la función pura, no una corrida real end-to-end (ya está en la lista de pendientes del usuario).

### 2026-08-17: Bug real de Supabase/PostgREST (3ra vez) — la fila "Dotación" del reporte se veía "estimada" pese a tener dato real en Buk

- **Síntoma reportado por el usuario**: en `/reporte`, junio y julio de 2026 se veían gris/itálica ("estimado") en la fila Dotación, con una captura del Excel maestro mostrando esos mismos meses en amarillo — el usuario pidió completar esa dotación desde la API de Buk en vez de confiar en el color de la celda del Excel.
- **Diagnóstico real (no se adivinó)**: un script de verificación puntual (sin re-descargar nada de Buk, solo 4 `count` a Supabase) confirmó que `buk_dotacion_snapshots` **ya tenía** el detalle real por cargo de junio (247 filas) y julio (259 filas) desde el backfill del 14-ago — estable en 2 corridas separadas, no era un hueco de datos.
- **Causa raíz real**: `getDotacionTotalPorPeriodo` (`dotacion-total.ts`) consultaba `buk_dotacion_snapshots` con `.order("snapshot_date")` **sin `.range()` ni `.limit()`** — con ~250 filas/mes × 103 meses (~25.000+ filas), el tope server-side de PostgREST (`max-rows`, ~1000) trunca la respuesta a los primeros ~1000 registros en orden ascendente, es decir, solo los primeros ~4 meses de 2018 — **todo 2026 quedaba silenciosamente afuera** de la suma. Mayo se veía "real" porque venía de `dotacion_mensual` (el Excel, que sí tenía mayo cerrado/no-amarillo); junio/julio no tenían ni el Excel (amarillo) ni Buk (truncado por este bug) como fuente real.
- **Es la 3ra vez que aparece este exacto patrón** en esta sesión (ver los 2 hallazgos del 14-ago en los scripts de backfill) — esta vez en un camino de LECTURA que nunca se había auditado para esto, no en una escritura.
- **Fix real**: paginar con `.range()` en lotes de 1000 hasta agotar la tabla, acumulando todas las filas antes de sumar por período. Se agregó además `.limit(1000)` defensivo a las otras 2 consultas sin protección del mismo archivo (`dotacion_mensual`, `headcount_by_obra` variaciones) — bajo riesgo real hoy por volumen, mismo criterio preventivo.
- **Además**: se detectó que re-correr `scripts/backfill-dotacion-por-cargo.ts` completo para "confirmar" el dato es muy costoso e innecesario — el script re-descarga de Buk los 103 meses COMPLETOS aunque ya estén guardados (el "ya hecho" solo salta el paso de escritura, no la descarga), y en la corrida real de hoy quedó colgado >35 min sin imprimir nada (probablemente una de las 103 consultas de verificación sin timeout se quedó esperando) — se mató el proceso sin daño (los datos ya estaban ahí, confirmado antes y después). **Aplicar en**: para verificar si datos históricos de Buk ya existen, usar un chequeo puntual (`count` por fecha) en vez de re-correr el backfill completo; y considerar agregar un timeout explícito a las consultas de verificación de esos scripts si se vuelven a usar.
- **Wireado además**: `runBukSnapshot()` (pull en vivo de Buk, ya existía en `buk-sync/sync.ts`) ahora se llama dentro de `refresh.ts` en cada "Actualizar reporte" — antes solo lo llenaba el cron mensual de Vercel (nunca corrido, el deploy sigue pendiente) o backfills manuales, así que el mes en curso se quedaba stale indefinidamente. Se corrió una vez a mano (vía el endpoint `/api/cron/buk-snapshot` contra el dev server local, con `CRON_SECRET`) para dejar un snapshot real de agosto-2026 sin esperar al próximo refresh.
- **Aplicar en**: cualquier consulta nueva a una tabla que pueda crecer sin cota conocida — jamás confiar en que "total de filas esperado < 1000" seguirá siendo cierto; paginar con `.range()` desde el día uno si la tabla es de series de tiempo/histórico.

### 2026-08-17: 2do bug real el mismo día — sumar 2 snapshots del mismo mes duplicaba gente

- **Síntoma**: apenas se corrigió el bug anterior y se probó en vivo, agosto-2026 salió **1.763** en la fila Dotación — más del doble que julio (841), imposible según el usuario ("es imposible que sea más del doble del mes anterior").
- **Causa real, confirmada con datos**: `buk_dotacion_snapshots` tenía 2 snapshots distintos dentro de agosto — el del cron mensual original (`2026-08-05`, suma=913) y el pull en vivo recién agregado (`2026-08-17`, suma=862, ver hallazgo anterior). `getDotacionTotalPorPeriodo` agregaba por período SUMANDO todas las filas de un mes sin importar de qué `snapshot_date` venían — sumaba 2 FOTOS distintas del mismo mes (913+862≈1775, cerca del 1.763 mostrado) en vez de quedarse con la más reciente. Es consecuencia directa de haber wireado `runBukSnapshot()` a cada "Actualizar reporte" (hallazgo anterior, mismo día): ahora cada click agrega una fecha de snapshot nueva dentro del mes en curso.
- **Fix real**: la agregación ahora suma `activos` por `snapshot_date` EXACTA primero, y después cada período se queda con la suma de la fecha más reciente que caiga en ese mes — nunca con la suma de todas las fechas del mes. Verificado contra la base real: mayo=784, junio=774, julio=841, agosto=862 (antes del fix: agosto salía ~1.763-1.775).
- **Aplicar en**: cualquier tabla de snapshots puntuales (una fila = una foto en el tiempo, no un acumulado) donde pueda existir MÁS DE 1 fila por período de agregación — agregar siempre por la clave de snapshot exacta primero, nunca sumar directo por el período derivado (mes/semana/etc.) sin des-duplicar por fecha real antes.

### 2026-08-17: Columna N° (dotación RG/RP) por sub-fila, igual al Excel real de Finanzas + explicación de mecánica mensual

- **Pedido del usuario**, con captura del Excel real de Finanzas como referencia: "el flujo de caja que yo realizaba en Excel colocaba la dotación en los subgrupos, mantén ese formato para ver cómo va cambiando el input principal que corresponde a dotación" — el Excel original trae columnas de a PARES por mes (valor + "N°") en TODAS las filas, con el N° poblado solo en las sub-filas RG/RP de Anticipo y Remuneración (el resto queda en blanco).
- **Refactor previo**: `proporcionRgHistorica` y `dotacionRgRpDelMes` vivían como funciones privadas en `refresh.ts` (el motor de escritura) — se movieron a `dotacion-total.ts` (exportadas) para que la página del reporte y los exports (que solo LEEN, no escriben) puedan reutilizar exactamente la misma lógica sin duplicarla. Nueva función `getDotacionRgRpPorPeriodo(desde, hasta)` — versión batched para todo un rango, construida sobre `dotacionRgRpDelMes`.
- **`FilaDetalle.sub[].dotacion?: "rg" | "rp"`** (nuevo campo en `filas-detalle.ts`) — marca explícitamente qué sub-filas llevan columna N° (`anticipo_rg/rp`, `remuneracion_rg/rp`), en vez de inferirlo por sufijo de string.
- **3 formatos actualizados** (tabla en vivo `detail-table.tsx`, HTML `render.ts`, Excel `render-excel.ts`): header de 2 filas cuando hay `dotacionRgRpPorPeriodo` (nombre del período con `colspan=2`/`rowspan` en "Concepto", fila 2 con "$"/"N°"); cada fila del cuerpo pasa a 2 celdas por período — la 2da vacía salvo en las sub-filas marcadas con `dotacion`. Sin el nuevo parámetro (opcional en los 3), el comportamiento queda IDÉNTICO al de antes (1 columna por período) — no rompe ningún caller existente.
- **Además**: nueva sub-sección "¿Por qué sube o baja cada concepto de un mes al siguiente?" en `metodologia-calculo.tsx` — explica la mecánica CAUSAL (no solo la fórmula): Dotación es el motor de casi todo (Remuneración la sigue directo, Anticipo/Reliquidación siguen a Remuneración, Cotización sigue a la suma de esos 3), Finiquito es la excepción (sigue a las BAJAS de dotación, no a Remuneración), y SENCE es un escalón (no una dinámica gradual) — pedido explícito del usuario ("incorpora una explicación... para que sea explicativo").
- **Verificado**: 4 tests nuevos en `render.test.ts` (sin el parámetro no agrega columnas N°; con el parámetro sí usa `colspan="2"`; muestra el valor real en la sub-fila RG; deja la celda N° vacía en filas sin desglose como Total Nómina). `npx tsc --noEmit`, `npx vitest run` (105/105) y `npm run build` limpios.

### 2026-08-17: Excel con más histórico (agrupado/colapsado) + hoja Metodología + gap real de Cotización + fix de infra de tests

- **Pedido del usuario**: "el histórico dejalo agrupado en el excel no lo elimines" (tras acotar el rango en vivo a 3 meses atrás) + "faltan las explicaciones de las modificaciones de valores en el excel" + "porque estas considerando en amarillo las cotizaciones si estan pagadas... no esta saliendo de la carpeta?".
- **Excel con rango propio, más amplio**: `export-action.ts` ahora hace una 2da pasada de fetch con `desdeExcel` (9 meses antes de `periodoDesde`, total 12 meses atrás) SOLO para `renderReportExcel` — la app en vivo y el HTML descargable siguen con la ventana de 3 meses (foco en la proyección). Nuevo parámetro `columnasAgrupadasHastaPeriodo` en `renderReportExcel` — todo período anterior a ese queda con `outlineLevel=1` + `hidden=true` en sus columnas (Excel las muestra colapsadas con un "+" para expandir, mismo criterio visual que el Excel real de Finanzas — los botones "1 2" de agrupación que ya tenía el archivo original).
- **Hoja "Metodología" nueva en el Excel**: mismo contenido que la sección "¿Cómo se calcula este flujo?" de la app en vivo — se extrajo a `metodologia-contenido.ts` (compartido) para que `metodologia-calculo.tsx` (React) y `render-excel.ts` (Excel) nunca queden con 2 copias del mismo texto.
- **Investigación real de Cotización** (no se adivinó, se confirmó en código y en SharePoint): hoy Cotización SOLO tiene 1 fuente real — el Excel maestro de Flujo de Caja (`engine.ts` línea ~171: "Cotizaciones siempre son fórmula — no existe fuente real automatizada" para el cálculo nuevo; pero `sync-flujo-caja-historico.ts` SÍ importa cotización real cuando esa celda no está amarilla en el Excel maestro, con prioridad sobre la fórmula). El usuario confirmó que SÍ existe una carpeta real con el pago real de Cotización — `Pagos Mensuales/imposiciones/imposiciones <mes> <año>/` (confirmado vía SharePoint: son archivos .txt formato Previred, `;`-delimitados, ~70 columnas por fila de trabajador, separados por empresa × Caja de Compensación/AFP, en subcarpetas Rol General/Rol Privado). **No se conectó todavía** — parsear correctamente el layout Previred para sacar un monto total confiable es un desarrollo propio (no un ajuste rápido), pendiente de decisión explícita del usuario antes de construirlo (dato financiero real, no se puede adivinar la columna correcta del layout).
- **Bug de infraestructura de tests encontrado**: no existía `vitest.config.mts` — Vitest nunca resolvía el alias `@/` → `src/` (que sí resuelven `tsc` y Next.js vía `tsconfig.json`). Nunca se notó porque ningún test anterior importaba, en tiempo de EJECUCIÓN (no `import type`, que se borra en la transformación), un módulo que a su vez importara algo con `@/` de forma real. `render-excel.test.ts` (nuevo, primer test de ese archivo) fue el primero en necesitarlo. Fix: `vitest.config.mts` con `resolve.alias`.
- **Verificado**: 2 tests nuevos en `render-excel.test.ts` (genera un `.xlsx` válido con las 3 hojas; con `dotacionRgRpPorPeriodo` agrega columnas N° pareadas y colapsa los períodos anteriores a `columnasAgrupadasHastaPeriodo`, leyendo el workbook real con ExcelJS, no solo el string HTML). `npx tsc --noEmit`, `npx vitest run` (107/107) y `npm run build` limpios.
- **Aplicar en**: si se decide construir la ingesta real de "imposiciones" (Previred), investigar el layout de columnas oficial de Previred antes de escribir el parser — el orden y significado exacto de cada campo numérico (AFP, salud, seguro de cesantía, mutual, etc.) es específico de ese formato y un error de columna produciría un monto financiero incorrecto sin ningún error visible.

### 2026-08-17: Cotización real conectada — vía el comprobante PDF de Previred, NO el .txt crudo

- **Pedido del usuario**: "si avanza" — construir la ingesta real de Cotización que quedó pendiente el mismo día.
- **Investigación previa (agente dedicado) confirmó que evitar el .txt crudo fue la decisión correcta**: el archivo real de la empresa tiene 72 campos; el layout OFICIAL vigente de Previred (2 versiones recientes verificadas contra el sitio oficial) tiene 105 campos. Solo los primeros 39 campos calzan con certeza (verificado numéricamente: el campo SIS de la muestra es exactamente 1,62% de la renta imponible, tasa real de AFP Habitat). Los campos de salud/mutual/seguro de cesantía que se necesitarían para "cotización total" caen en posiciones 70-102 del layout oficial — fuera de las 72 columnas del archivo real, y una muestra mostró una inconsistencia no resuelta en esa zona. Ningún repositorio (Previred, Buk, Nubox, Talana, Softland) documenta una versión oficial de 72 campos. Conclusión: parsear ese .txt habría sido adivinar.
- **Fuente real usada en su lugar**: el "Comprobante de Pago Único de Aportes Previsionales" — un PDF por empresa × RG/RP × mes en la misma carpeta ("comprobante previred `<Empresa>` `<RG|RP>`.pdf"), con el **TOTAL GENERAL ya calculado y confirmado por Previred** (aparece 2 veces en el mismo documento — "TOTAL GENERAL" y "TOTAL A PAGAR" — usado como cross-check mutuo: si no coinciden, el comprobante se descarta en vez de arriesgar el monto).
- **Nuevo**: `unpdf` (extracción de texto de PDF, elegido por ser ESM-nativo y liviano — sin dependencia nativa problemática en serverless) + `comprobante-previred-parser.ts` (parser puro, regex sobre "PERIODO DE PAGO" y "TOTAL GENERAL"/"TOTAL A PAGAR") + `sync-cotizacion-previred.ts` (busca "comprobante previred `<mes>` `<año>`" en Graph, filtra por carpeta + nombre + extensión, descarga, extrae texto, parsea, suma TODOS los comprobantes del mes, escribe en `payroll_line_items` con el mismo patrón delete-then-insert que `sync-pagos-mensuales.ts` para nunca duplicar en refreshes repetidos).
- **`engine.ts` cambia de comportamiento real**: Cotización pasa de "SIEMPRE fórmula" a real-gana-sobre-fórmula (mismo patrón que todos los demás conceptos) — nuevo campo `cotizacionReal` en `CashFlowInputs`, `metodoCalculo: "ingesta_previred"` cuando hay comprobante real ese mes.
- **Migración nueva**: `20260817000001_cotizacion_previred.sql` agrega `'cotizacion'` a los CHECK de `payroll_line_items.concepto` y `payroll_source_documents.tipo` (antes no lo permitían, solo anticipo/remuneración/reliquidación/finiquito).
- **Verificado**: 6 tests nuevos en `comprobante-previred-parser.test.ts` (extrae bien; error sin "PERIODO DE PAGO"; error sin "TOTAL GENERAL"; error si "TOTAL GENERAL"≠"TOTAL A PAGAR"; error con monto inválido; sigue funcionando sin el nombre de empresa) — fixture SINTÉTICO/anonimizado, nunca el RUT o nombre real de una empresa del grupo. 2 tests nuevos/actualizados en `engine.test.ts` (cotización real gana sobre la fórmula; renombrado el test de "siempre fórmula" a "sin dato real"). `npx tsc --noEmit`, `npx vitest run` (114/114) y `npm run build` limpios.
- **NO verificado end-to-end**: no hay forma de simular una sesión real de Microsoft/Graph desde este entorno — `sync-cotizacion-previred.ts` nunca se ejecutó contra la API real de Graph ni descargó/parseó un PDF real de verdad (solo el parser puro, con texto ya extraído, está probado). **Aplicar en**: la primera vez que el usuario corra "Actualizar reporte" después de aplicar la migración, revisar el resultado con atención — si Graph Search no encuentra los comprobantes (ranking por relevancia, mismo bug ya documentado 2 veces en este archivo) o si `unpdf` no extrae el texto como se espera en el runtime real de Next.js, va a aparecer como error en el panel de alertas, no en silencio.
- **Aplicar en**: cualquier futura fuente de dato financiero real desde un documento no estructurado (PDF, .txt de layout ajeno) — preferir SIEMPRE un total/resumen ya confirmado por la fuente autoritativa (aquí, el propio comprobante de Previred) sobre reconstruir el cálculo desde datos crudos cuyo layout exacto no se puede verificar con una fuente oficial — el costo de estar equivocado en un monto financiero es alto y silencioso.

### 2026-08-18: N° de Anticipo ≠ N° de Remuneración (bug real) + fórmulas reales de Excel con link a Dotación

- **Pedido del usuario**, viendo el Excel real: "estás dejando la misma cantidad de personas en anticipos y en sueldos y las personas que reciben anticipos son muchos menos... además me gustaría que existiera un link en la fórmula en el Excel ya que al parecer el cálculo de los flujos no está considerando la dotación, ya que en caso contrario hubiera saltado".
- **Bug real confirmado**: `getDotacionRgRpPorPeriodo` (el N° por sub-fila del 17-ago) reutilizaba la MISMA dotación total RG/RP para las 4 sub-filas (`anticipo_rg`, `anticipo_rp`, `remuneracion_rg`, `remuneracion_rp`) — mostrando el mismo N° en Anticipo que en Remuneración, pese a que mucha menos gente pide Anticipo que la que recibe sueldo completo.
- **Hallazgo clave que habilitó el fix real**: `payroll_line_items` (la tabla de ingesta real de SharePoint) es GRANO DE PERSONA — 1 fila = 1 pago real a 1 persona (sin RUT/nombre, ver `types.ts`), aunque el comentario de la tabla diga "agregado por sociedad/obra" (es agregado en el SENTIDO de que no tiene RUT, no en el sentido de que sume varias personas en 1 fila). Contar sus filas por `(concepto, período)` da el N° REAL de gente que recibió ESE concepto específico ese mes — antes nunca se usaba para esto, solo para sumar montos (`sumaLineItems`).
- **Fix real**: nueva `getDotacionPorConceptoYPeriodo` (dotacion-total.ts) — cuenta filas reales de `payroll_line_items` por concepto específico cuando existen; cae al estimado de dotación total (mismo de antes) solo para meses sin ese dato real todavía. `FilaDetalle.sub[].dotacion: "rg"|"rp"` se simplificó a `tieneColumnaN?: boolean` — el lookup ahora usa el `concepto` exacto de la sub-fila como clave, no una dimensión compartida.
- **Segundo pedido, mismo mensaje — fórmulas reales de Excel**: antes CADA celda del Excel (real o proyectada) era un número estático (`cell.value = N`), nunca una fórmula — imposible para el usuario verificar en Excel mismo si el cálculo realmente usaba la dotación. Se agregaron fórmulas reales (`cell.value = {formula, result}`) para las celdas PROYECTADAS de: Anticipo (`=Remuneración*0.24`), Reliquidación (`=Remuneración*0.01`), Cotización (`=(Anticipo+Remuneración+Reliquidación)*0.3`), Total Nómina (siempre, real o proyectado, suma de los 6 conceptos) y Remuneración cuando `metodoCalculo="costo_por_cabeza_x_dotacion"` (`=RemuneraciónMesAnterior/DotaciónMesAnterior*DotaciónMesActual+residual`, donde `residual` es el monto de Beneficios/Bonos implícito de ese mes, congelado como número fijo porque no tiene su propia celda linkeable — la parte costo-por-cabeza SÍ recalcula en vivo si se edita la celda de Dotación en Excel).
- **Diseño técnico**: los números de fila de cada concepto se precalculan ANTES de escribir ninguna fila (`filaNumeroPorConcepto`, derivado de `detalle.rowCount` real, nunca re-derivado a mano) — necesario porque Anticipo (fila más arriba) necesita referenciar la fila de Remuneración (más abajo), y Excel no tiene problema con referencias "hacia adelante" siempre que la celda EXISTA al final. `columnaALetra`/`refCelda` son helpers nuevos (conversión base-26 columna→letra).
- **Verificado**: nuevo test en `render-excel.test.ts` confirma N° distinto entre Anticipo RG y Remuneración RG (340 vs 650 en el fixture). 2 tests nuevos verifican las fórmulas reales — uno lee el workbook con ExcelJS y compara el string de fórmula EXACTO generado (`=B5*0.24`, etc.), otro verifica el caso con residual de Beneficios haciendo el cálculo a mano y comparando contra la fórmula generada. `npx tsc --noEmit`, `npx vitest run` (116/116) y `npm run build` limpios.
- **Aplicar en**: cualquier fila nueva que se agregue a `FILAS_DETALLE` en el futuro y tenga una relación de fórmula simple con otro concepto visible en la misma hoja — considerar agregarle una entrada en `formulaProyectada` (render-excel.ts) en vez de dejarla como número estático, seguido del mismo criterio (fórmula real cuando el link es seguro de construir, número plano cuando no hay celda a la que enlazar).

### 2026-08-18: Anticipo proyectado pasa a costo-por-cabeza × dotación PROPIA (dejó de compartir la de Remuneración)

- **Pedido del usuario**: "para efectos de la proyección de anticipos ¿consideras la dotación?... recuerda que la dotación se debe ir proyectando por concepto".
- **Confirmado antes de tocar código**: `calcularAnticipoProyectado`/el branch de Anticipo en `engine.ts` NO consideraban dotación — era 24% × Remuneración, una decisión ya documentada explícitamente en el header de `formulas.ts` ("Anticipo | 24% × Remun. (igual, confirmado)"), tomada ANTES de que existiera el dato real de dotación por concepto (ver entrada anterior, 18-ago-2026). No era un bug de implementación, era una metodología que quedó obsoleta al aparecer mejor dato.
- **Confirmado con el usuario vía AskUserQuestion** antes de implementar: (1) cambiar Anticipo al modelo costo-por-cabeza propio → "Sí, costo-por-cabeza propio (Recomendado)"; (2) aplicar lo mismo a Reliquidación → "No, solo Anticipo" (Reliquidación queda intacta, sigue en 1% × Remuneración).
- **Fix real**: nuevas `dotacionAnticipoDelMes`/`proporcionAnticipoHistorica` (dotacion-total.ts) — misma estructura que `dotacionRgRpDelMes`/`proporcionRgHistorica`, pero contando SOLO gente con Anticipo real en `payroll_line_items` (nunca la dotación total ni la de Remuneración); nueva `calcularAnticipoPorCabeza` (formulas.ts) — mismo patrón que `calcularRemuneracionProyectada` (costo promedio del mes anterior × dotación actual), cae a `calcularAnticipoProyectado` (24%) solo si no hay dotación de Anticipo disponible. `CashFlowInputs` gana `costoPromedioAnticipoPorCabezaMesAnterior`/`dotacionAnticipoActual`; `refresh.ts` los calcula en el loop mensual igual que ya hacía para Remuneración, reutilizando `montoCashFlow(supabase, anterior, "anticipo")` para el monto del mes anterior.
- **Excel**: `formulaProyectada` (render-excel.ts) gana un caso para `metodoCalculo === "costo_por_cabeza_x_dotacion_anticipo"` — como no existe una celda "Anticipo N° total" (solo N° por sub-fila RG/RP), la "cantidad" del link queda como SUMA de las 2 celdas N° vecinas (`=AnticipoMesAnterior/(N°RGant+N°RPant)*(N°RGact+N°RPact)+residual`); cae al link simple `=Remuneración*0.24` cuando falta columna N° o período anterior.
- **Verificado**: 4 tests nuevos (`formulas.test.ts` ×3, `engine.test.ts` ×1) confirman el nuevo modelo y sus 2 fallbacks. `npx tsc --noEmit`, `npx vitest run` (120/120) y `npm run build` limpios.
- **Aplicar en**: cualquier otro concepto que en el futuro se descubra con headcount propio distinto al de Remuneración — mismo patrón (`dotacionXDelMes`/`proporcionXHistorica` contando filas reales de `payroll_line_items` por ese concepto específico, nunca reutilizar la dotación de otro concepto "porque es parecido").

### 2026-08-18: 2 bugs reales más el mismo día — N° de Anticipo proyectado seguía copiando el de Remuneración (fallback, no el real) + salto artificial +X/-X en el modelo de Plan de Obra

- **Pedido/hallazgo del usuario**, viendo el Excel: "la dotación de anticipos está mala, no corresponde a la realidad... además el modelo de dotación no funciona en el excel que generas, no aparece un flujo mensual".
- **Bug 1 — confirmado con captura**: el N° de Anticipo RG saltaba de 12 (real, agosto) a 657 (proyectado, septiembre) — IDÉNTICO al N° de Remuneración RG del mismo mes. Causa: la entrada de Auto-Blindaje del 17-ago-2026 solo arregló el camino REAL (contar filas de `payroll_line_items` por concepto específico); el FALLBACK de `getDotacionPorConceptoYPeriodo` (meses proyectados, sin dato real todavía) seguía cayendo a `rgRp.rg`/`rgRp.rp` — la MISMA dotación total RG/RP que usa Remuneración — para las 4 sub-filas. El bug original (16/17-ago) nunca se corrigió del todo, solo en el 50% de sus casos.
- **Fix real**: el fallback de Anticipo ahora usa `dotacionAnticipoDelMes` (la función nueva del mismo día, pensada para el motor de cálculo — ver entrada anterior) partida en RG/RP con la nueva `proporcionAnticipoRgHistorica` (razón Anticipo RG ÷ Anticipo total, propia, nunca la de Remuneración).
- **Bug 2 — confirmado con captura del Plan de Obra**: "Lira Parque (ex Lira 4)" mostraba `0` en casi todos los meses y un salto `+214` en 2027-07 seguido de `-214` en 2027-08 — un patrón sin sentido de negocio (nadie contrata 214 personas y las despide al mes siguiente). Causa real en `promediarCurvas` (curve.ts): cuando NINGUNA obra de referencia tenía dato ese mes de avance, el valor ABSOLUTO caía a `0` (con `sinDatoReferencia: true`) — y como `aVariacionNeta` calcula la variación como delta entre valores absolutos CONSECUTIVOS, un mes real rodeado de huecos generaba el salto fantasma: `0→214` (+214) y luego `214→0` (-214).
- **Fix real**: `promediarCurvas` ahora MANTIENE el último valor absoluto conocido en los huecos sin dato (en vez de volver a 0) — `sinDatoReferencia` sigue marcando el hueco como no confiable, pero la variación calculada sobre él da 0 (correcto: sin información no se asume cambio), y el salto real solo aparece UNA vez, en el mes donde efectivamente hay dato.
- **Verificado**: nuevo test en `curve.test.ts` reproduce exactamente el escenario `[null,null,214,null]` y confirma que la variación ya no incluye el `-214` fantasma. `npx tsc --noEmit`, `npx vitest run` (121/121) y `npm run build` limpios.
- **Pendiente**: el usuario pidió además comparar el Excel MAESTRO original de Finanzas (dotación y montos) contra el que genera esta app, mes a mes, para encontrar más diferencias — investigación en curso, no once-y-para-siempre resuelta con estos 2 fixes.

### 2026-08-18: Comparación contra el Excel maestro real de Finanzas + reversión del modelo costo-por-cabeza de Anticipo

- **Investigación pedida por el usuario**: "quiero que compares el excel del modelo original en relación a la proyección de dotación y montos con el que tú propones para entender donde se generan las diferencias". Se leyó el archivo real más reciente (`Flujo_Caja_23_06_26.xlsx`, modificado 06-ago-2026, vía SharePoint/Graph) incluyendo sus fórmulas reales (no solo valores), y se comparó celda a celda contra la serie que genera esta app para mayo-diciembre 2026.
- **Hallazgo 1 — confirmado, no requirió cambio de código**: mayo y junio calzan EXACTO entre ambos (mismo dato real). Julio difería (180.372.322 en el maestro vs 164.626.000 en la app) porque al 06-ago Finanzas TODAVÍA no había tipeado el real de julio en su Excel (la celda seguía siendo fórmula `=Remuneración_RG*24%`) — la app ya tenía el dato real de julio ingerido desde SharePoint. La app va adelantada al proceso manual de Finanzas, no atrasada — no es un bug.
- **Hallazgo 2 — pregunta de negocio resuelta con el usuario**: la columna "N°" que Finanzas escribe junto a Anticipo RG en su propio Excel real NO es un número chico — en 45 meses históricos reales varía entre 60%-99% del N° de Remuneración RG (ej. mayo-2026: 565 vs 752, razón 75%), muy distinto a los ~15-20 que da contar filas reales de `payroll_line_items` (concepto=anticipo). Se confirmó explícitamente con el usuario vía AskUserQuestion: mantener el N° actual (personas que efectivamente cobraron Anticipo, el fix del 17/18-ago sigue correcto) — lo que Finanzas muestra en su columna N° mide otra cosa (posiblemente dotación elegible, no transacciones), pero eso NO es lo que el usuario quiere ver acá.
- **Hallazgo 3 — REVERSIÓN del modelo costo-por-cabeza de Anticipo (mismo día, un par de mensajes después)**: el usuario aclaró "proyectar quien va a cobrar anticipo siempre es un % del sueldo" — el Anticipo es por naturaleza un adelanto de un % del sueldo de CADA persona, no un costo fijo por cabeza como Remuneración o un Beneficio. Esto confirma además por qué el Excel real de Finanzas usa `=Remuneración_RG*24%` en sus propias celdas proyectadas (visto en el Hallazgo 1). Se revirtió COMPLETO el modelo "costo-por-cabeza propio de Anticipo" implementado un par de mensajes antes (commit `75ef32c`): `calcularAnticipoPorCabeza` eliminada de `formulas.ts`, `CashFlowInputs.costoPromedioAnticipoPorCabezaMesAnterior`/`dotacionAnticipoActual` eliminados de `engine.ts`, el wiring correspondiente eliminado de `refresh.ts`, el caso costo-por-cabeza de `formulaProyectada` eliminado de `render-excel.ts` (Anticipo vuelve a linkear siempre `=Remuneración*0.24`). Anticipo vuelve a ser SIEMPRE 24% × Remuneración cuando no hay dato real — igual que antes del 18-ago, y confirmado por el Excel real de Finanzas.
- **Lo que NO se revirtió** (sigue vigente, es ortogonal al modelo de monto): `dotacionAnticipoDelMes`/`proporcionAnticipoHistorica` (dotacion-total.ts) siguen existiendo y en uso — ahora SOLO para estimar el valor MOSTRADO en la columna N° de meses proyectados sin dato real (un dato informativo, no lo que determina el monto de Anticipo). El fix del N°-por-concepto (bug real del 17/18-ago, N° de Anticipo copiando el de Remuneración) tampoco se tocó — sigue corregido.
- **Verificado**: `npx tsc --noEmit`, `npx vitest run` (117/117, bajó de 121 al eliminar los 4 tests del modelo revertido) y `npm run build` limpios.
- **Aplicar en**: antes de introducir un modelo "costo-por-cabeza × dotación" para un concepto nuevo, confirmar primero si ese concepto es conceptualmente un COSTO FIJO por persona (Remuneración, Beneficios) o un PORCENTAJE de otro concepto ya existente (Anticipo, Reliquidación, Cotización) — el segundo caso NUNCA necesita su propia dotación, por diseño de negocio, no por falta de dato.

### 2026-08-18: /temple — auditoría full-project (Audit Score 79/100) + fix de los 2 hallazgos top

- **Corrida completa**: `/temple` (4 dimensiones vía 2 subagentes en paralelo — qa-auditor para Calidad Web, db-architect para Datos/RLS — + Seguridad/Cache inline). Sin MCP de Supabase conectado (advisors no verificados, no penalizado) y sin `codex` instalado (capa `--deep` omitida, no bloqueante). Reporte completo: `AUDIT-2026-08-18.md`, snapshot: `.context/audits/2026-08-18.json`.
- **Falso positivo detectado y corregido ANTES de reportar**: el subagente de Datos/RLS reportó "CRITICAL — no existe `middleware.ts`, ninguna ruta exige sesión". Verificado leyendo `src/proxy.ts` directamente: SÍ existe la protección completa (Next.js 16 renombró `middleware.ts` → `proxy.ts`, ya documentado en este mismo archivo el 2026-08-04) — el subagente buscó el nombre de archivo viejo y no lo encontró. Se retiró del score antes de presentarlo al usuario — precedente de por qué "medir antes de juzgar" (regla del skill) importa incluso con hallazgos de subagentes, no solo propios.
- **Fix #1 implementado — Contraste WCAG 1.4.3** (hallazgo High de qa-auditor, sub-score Calidad Web 46/100): `text-slate-400` (≈2.56:1, falla el mínimo 4.5:1) usado en TODA la app para marcar celdas "proyectado" → `text-slate-500` (≈4.76:1, pasa AA) en 6 archivos (`detail-table.tsx`, `sence-editable-cell.tsx`, `metodologia-calculo.tsx`, `fuentes/page.tsx`, `cash-flow-area-chart.tsx`). `--warn` (#b8860b, ≈3.25:1) → `#7a5209` (≈6.91:1) en `globals.css`. Efecto colateral encontrado y corregido en el mismo cambio: `alert-panel.tsx` tenía el mismo color de `--warn` HARDCODEADO como `rgba(184, 134, 11, ...)` (documentado ahí mismo como workaround de un bug real de Tailwind con modificadores de opacidad sobre variables CSS en hex) — si solo se cambiaba la variable CSS, el texto habría quedado oscuro pero el fondo/borde seguía con el color viejo. Se actualizó el rgba() a `rgba(122, 82, 9, ...)` en el mismo commit.
- **Fix #2 implementado — Validación Zod en `overrideCashFlowValue`** (hallazgo High de Seguridad, OWASP-A04-001): la única Server Action de escritura manual sobre un dato financiero (`src/features/cash-flow/services/override.ts`) no validaba nada — `monto` sin chequeo de NaN/Infinity a nivel de servidor (el chequeo vivía solo en el cliente, evitable llamando la acción directo), y `concepto` sin restringir al subconjunto realmente overrideable (podía apuntar a `concepto="total_nomina"`, que SIEMPRE debe ser la suma calculada de los otros 6 — si se overridea, `METODOS_PRESERVADOS` en `refresh.ts` lo dejaría congelado para siempre, corrompiendo el total). Fix: nuevo `override-schema.ts` (separado de `override.ts` porque un archivo `"use server"` solo puede exportar funciones async — un `const` de schema no puede vivir ahí y seguir siendo testeable) con `CONCEPTOS_OVERRIDEABLES` (los 6 reales, sin `total_nomina`) y `overrideSchema` (Zod, `monto: z.number().finite()`). `overrideCashFlowValue` ahora hace `safeParse` antes de tocar la DB.
- **Verificado**: 8 tests nuevos en `override-schema.test.ts` (acepta los 6 conceptos válidos, rechaza `total_nomina`/concepto inventado/NaN/Infinity/periodo no-Date, acepta monto negativo a propósito — una reversión/corrección es un caso de negocio válido, no se restringió el signo). `npx tsc --noEmit`, `npx vitest run` (125/125) y `npm run build` limpios.
- **Aplicar en**: cualquier Server Action nueva que reciba un `concepto`/enum de un dominio con un valor "especial" (agregado/calculado, como `total_nomina` acá) — el enum de validación debe excluir explícitamente esos valores especiales, no solo replicar el CHECK constraint de la DB (que por diseño es más permisivo, ya que a nivel DB `total_nomina` SÍ es un valor válido de `concepto`, solo que nunca debería llegar ahí vía un override manual).

### 2026-08-18: Proyección de UF a +0,5% mensual cuando mindicador.cl no tiene el dato (antes quedaba "—")

- **Pedido del usuario**: "la proyección de la UF debe considerar un 0,5% de incremento cuando no encuentre la UF para efectos de la proyección".
- **Antes**: `getUfPorPeriodo` (queries.ts) solo devolvía UF real de `uf_series` (sincronizada desde mindicador.cl, que no publica meses futuros) — cualquier período sin dato real quedaba fuera del Map, y la fila "Total Nómina (UF)" mostraba "—" para todo el horizonte proyectado (visible en captura del usuario: UF real hasta el 3er mes, "—" en el resto).
- **Fix**: `getUfPorPeriodo` ahora, para los períodos sin dato real, toma el ÚLTIMO UF real conocido (`es_real=true`, el más reciente, sin importar si está o no en la lista de períodos pedida) y compone `UF_CRECIMIENTO_MENSUAL_PROYECTADO` (0,5%) mes a mes (`ultimoValorReal * (1.005)^mesesDeDistancia`) — reemplaza el placeholder de +1% mensual que tenía el Excel original (marcado ahí mismo como "no real, falta dato SII", ver TECH-SPEC §7). Nunca proyecta hacia ATRÁS de la última UF real.
- **Sin cambios en UI**: `detail-table.tsx`/`render.ts`/`render-excel.ts` ya consumían el Map de `getUfPorPeriodo` tal cual — al llenarse las celdas faltantes, el "—" desaparece solo, sin tocar esos 3 archivos.
- **Verificado**: `npx tsc --noEmit`, `npx vitest run` (117/117) y `npm run build` limpios. Sin test unitario dedicado (mismo criterio que `dotacion-total.ts`: funciones que solo hacen queries a Supabase, no hay archivo de test en este repo para ese tipo de servicio).

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
12. ~~Esperar a que el cron mensual de Buk acumule ≥3 snapshots~~ — **resuelto 14-ago-2026**: `scripts/backfill-dotacion-historica.ts` sembró 103 meses reales (2018-2026) de una sola vez vía `GET /employees/active?date=`, no fue necesario esperar el cron.
13. ~~Responder si existe un export histórico de dotación de Buk~~ — **resuelto 14-ago-2026**: sí estaba en la API (el usuario lo señaló: "si está en la API, estás buscando mal"), ver punto 12.
14. ~~Investigar la discrepancia entre el snapshot del 5-ago y el pull en vivo~~ — **resuelto 13-ago-2026**: era el bug real de matching "Obra Serrano Torre A" vs. "Serrano A" (ver Auto-Blindaje), ya arreglado con alias manual.
15. **Correr "Actualizar reporte" en la app (sesión real)** para que `runForecastModel` recalcule la curva de obras similares con los 103 meses de histórico real recién sembrado — no se puede scriptear sin `next-auth` (`auth()` requiere contexto de request).
16. **Confirmar con el usuario la causa de la contracción de dotación 2019→2024** (de ~2.200 a 336 activos, ~85% de caída) — dato real confirmado, causa de negocio no determinable desde el modelo. Ver Auto-Blindaje "Backfill histórico completo".
17. **Cualquier análisis futuro por obra/Oficina Central debe filtrar `snapshot_date >= '2024-03-01'`** — antes de esa fecha el split no es confiable (ver limitación documentada en Auto-Blindaje), solo el total de dotación lo es en toda la serie 2018-2026.
18. **Correr "Actualizar reporte" para que el modelo v2 de curva por fases (`curvaPorAvanceConFases`) se ejecute de verdad** — ver Auto-Blindaje 14-ago-2026 "Modelo de curva de dotación pasa a v2". Hoy solo está validado con tests unitarios de la función pura, no con una corrida real de `runForecastModel` en la app.

---

_La Pieza — 9 fases con código completo. Pendiente validación end-to-end del usuario (login real) y deploy._
