# Flujo de Caja Nómina — Master Blueprint

> **Versión:** 1.0
> **Fecha:** 2026-08-04
> **Timeline Total estimado:** ~22-30 días de trabajo efectivo (sesiones con Claude Code, no full-time)
> **Equipo:** Carlos Godoy (product owner + QA funcional) + Claude Code (implementación)
> **Estado:** BORRADOR — pendiente aprobación
>
> **Documentos Fuente:**
>
> - Tech Spec: `TECH-SPEC-flujo-caja-nomina.md`
> - Ruta de pipeline: 🔧 Herramienta Interna (La Herrería), con Viability/PDR/User Stories/UX Design/UI Workflow/UI/Security Audit formales omitidos por decisión explícita del usuario — su contenido esencial (problema, stack, seguridad) está integrado directamente en este documento para mantenerlo autosuficiente.

---

## Visión del Producto

El área de Compensaciones y Gestión de Grupo Maestra hoy proyecta el flujo de caja necesario para pagar nómina en un Excel mantenido a mano ("Flujo de Caja"), con datos reales dispersos en carpetas de SharePoint con nomenclatura inconsistente, y con dotación proyectada incompleta para 10 de 25 obras porque no existe un método sistemático de estimación.

**Flujo de Caja Nómina** es la herramienta interna que reemplaza ese proceso manual: ingiere los archivos reales de pagos y de plan de obras directamente desde SharePoint (Microsoft Graph, login delegado de Carlos), mantiene el motor de cálculo como datos versionados en base de datos, construye un histórico propio de dotación de Buk para estimar automáticamente los huecos de headcount por obra, y produce un reporte — tanto vivo en la app como archivo HTML autocontenido — con el mismo formato y estructura funcional que los dashboards de referencia de Maestra (Minuta GESPRO Comparativo, Carta Gantt Plan de Obras), listo para enviar por correo igual que hoy se distribuye el Gespro semanal.

**Usuario objetivo:** Carlos Godoy (Subgerente de Compensaciones y Gestión), único usuario en el MVP. Diseñado desde el día 1 para escalar a roles de Finanzas/Gerencia sin rediseño estructural.

**Es un reporte financiero sensible** — cada decisión de este Blueprint prioriza trazabilidad y minimización de datos personales sobre velocidad de desarrollo.

---

## Stack Técnico (Referencia Rápida)

| Capa          | Tecnología                                               | Versión                                  | Para qué                                                           |
| ------------- | -------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| Framework     | Next.js                                                  | 16 (App Router)                          | Full-stack, Server Actions para ingesta sin API pública            |
| Lenguaje      | TypeScript                                               | 5.7 strict                               | Datos financieros — cero tolerancia a `any`                        |
| Estilos       | Tailwind CSS                                             | 3.4                                      | Sistema visual Maestra                                             |
| Componentes   | shadcn/ui + Radix                                        | latest                                   | Tablas densas, filtros, modales                                    |
| Validación    | Zod                                                      | latest                                   | Todo dato externo se valida antes de tocar la DB                   |
| Backend/DB    | Supabase (Postgres + Auth + RLS)                         | ya provisionado (`hknwnimlafjwmchtefah`) | Datos agregados de flujo de caja y dotación                        |
| Auth          | NextAuth.js v5, provider Azure AD                        | latest                                   | Login delegado Microsoft — resuelve identidad + acceso a Graph API |
| Excel parsing | `exceljs`                                                | ^4.4                                     | Lectura de Flujo de Caja, Plan de Obras Gespro, Pagos Mensuales    |
| PDF parsing   | `pdf-parse`                                              | ^1.1                                     | Anticipos (Fase 2/post-MVP)                                        |
| Graph API     | `@microsoft/microsoft-graph-client` + `@azure/msal-node` | latest                                   | Acceso a SharePoint/OneDrive                                       |
| Testing       | Vitest + Playwright                                      | latest                                   | Unit del motor de cálculo + E2E del flujo crítico                  |
| Hosting       | Vercel                                                   | —                                        | Cron mensual de snapshots Buk incluido                             |

### Servicios Externos y Credenciales Requeridas

| Servicio                    | Variable de entorno                                                                      | Costo Estimado                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Supabase                    | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Ya provisionado (plan Free/actual)                                |
| Azure AD (App Registration) | `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`, `AZURE_AD_TENANT_ID`                     | Sin costo — incluido en licencia M365                             |
| NextAuth                    | `AUTH_SECRET`                                                                            | —                                                                 |
| Buk API                     | `BUK_API_KEY`, `BUK_API_URL`                                                             | Sin costo adicional — mismo tenant que panel-relaciones-laborales |
| Vercel Cron                 | `CRON_SECRET`                                                                            | Incluido en plan Vercel                                           |

### Estructura de Carpetas Base

```
flujo-caja-nomina/
├── src/
│   ├── app/
│   │   ├── (auth)/login/
│   │   ├── (dashboard)/{reporte,fuentes,dotacion}/
│   │   └── api/{auth/[...nextauth],refresh,export,cron/buk-snapshot}/
│   ├── features/
│   │   ├── cash-flow/
│   │   ├── ingestion/{graph,excel-parser,pdf-parser}/
│   │   ├── headcount/{buk-sync,forecast-model}/
│   │   ├── obras/
│   │   └── report-export/
│   ├── shared/{ui,types,supabase}/
│   └── lib/audit/
├── supabase/migrations/
└── docs/
```

---

## Database Schema

Schema SQL completo — ver `TECH-SPEC-flujo-caja-nomina.md` §4.2 para el detalle con comentarios extendidos. Tablas (11): `profiles`, `obras`, `headcount_by_obra`, `headcount_forecast_runs`, `buk_cargo_catalog`, `buk_dotacion_snapshots`, `payroll_source_documents`, `payroll_line_items`, `cash_flow_monthly`, `uf_series`, `report_snapshots`, `audit_log`. Todas con RLS habilitado donde corresponde; ninguna almacena RUT o nombre de persona junto a montos (ver decisión técnica §2.2 del Tech Spec).

---

## Sistema de Diseño (Marca Maestra)

Tokens de color confirmados en los 2 dashboards de referencia — usar el skill `marca-maestra` para aplicarlos consistentemente:

```css
--navy: #0a1f3c;
--navy-brand: #003865;
--fucsia: #db0a5b;
--gold: #b89a5a;
--ok: #2e7d32; /* semáforo: dentro de lo esperado / adelantado */
--warn: #b8860b; /* semáforo: atención, variación moderada */
--err: #c62828; /* semáforo: crítico, caja insuficiente o atraso >30 días */
```

- Tipografía: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial`.
- Logo SVG de Maestra inline en el `<nav>` (no `<img>` externo — requisito para que el export HTML sea autocontenido).
- Patrón de layout a replicar: KPIs hero (4 tarjetas numéricas) + vista temporal (línea de tiempo mensual, análoga al Gantt) + tabla de detalle + panel de alertas/riesgo con tags de severidad + comparación vs. corte anterior (barra "fantasma" + delta en días/monto).
- Barra de navegación y footer fijos translúcidos con blur, badge "Uso interno — Grupo Maestra".

---

## Resumen de Fases

| #   | Fase                                       | Duración | Entregable                                                             |
| --- | ------------------------------------------ | -------- | ---------------------------------------------------------------------- |
| 1   | Foundation & Auth Delegado                 | 2-3 días | App corriendo local, login Microsoft funcional, schema DB completo     |
| 2   | Design System Maestra & Layout             | 1-2 días | Layout base + tokens de marca + navegación                             |
| 3   | Ingesta Plan de Obras Gespro               | 2 días   | Catálogo de obras poblado desde el Excel más reciente                  |
| 4   | Ingesta Pagos Mensuales + Motor de Cálculo | 4-5 días | Cash-flow real ingerido + fórmulas de proyección funcionando           |
| 5   | Histórico Buk (Snapshots)                  | 2-3 días | Cron mensual corriendo, primeros snapshots guardados                   |
| 6   | Motor de Estimación de Dotación            | 3-4 días | Las 10 obras sin dato manual quedan con estimación automática trazable |
| 7   | Dashboard del Reporte                      | 3-4 días | `/reporte` funcional con el formato de los dashboards de referencia    |
| 8   | Export HTML Autocontenido                  | 1-2 días | Botón "Descargar HTML" produce archivo adjuntable por correo           |
| 9   | Seguridad, Auditoría & Deploy              | 2-3 días | RLS validado, audit log funcionando, deploy en Vercel                  |

**Post-MVP (Fase 10):** Ingesta automatizada de Anticipos vía PDF — deferida explícitamente (ver Tech Spec §2.3).

---

## FASE 1: Foundation & Auth Delegado

> **Duración:** 2-3 días
> **Depende de:** Nada (ya hay scaffold Forge + Supabase provisionado)
> **Entregable:** App corriendo en local, Carlos puede loguearse con su cuenta Microsoft, todas las tablas creadas en Supabase con RLS

### Qué construye y por qué

Sin auth delegado funcionando, ninguna otra fase puede leer SharePoint. Es el prerequisito técnico de todo el proyecto — y la pieza que resuelve la tensión "nube sin admin-consent pesado" identificada en el Tech Spec.

### 1.1 Registro de App en Azure AD

- [ ] **[T-1.1.1]** Registrar App en Azure AD (portal.azure.com → Entra ID → App registrations → New registration), single-tenant, redirect URI `http://localhost:3000/api/auth/callback/azure-ad` (+ URL de producción luego)
  - Notas: si el registro pide permisos de administrador para `Files.Read.All`/`Sites.Read.All` delegados, solicitar el consentimiento puntual a IT — es un permiso delegado (actúa como Carlos), no de aplicación
- [ ] **[T-1.1.2]** Configurar permisos delegados: `Files.Read.All`, `Sites.Read.All`, `offline_access`, `User.Read`, `openid`, `email`, `profile`
- [ ] **[T-1.1.3]** Generar client secret, guardar `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`, `AZURE_AD_TENANT_ID` en `.env.local`

### 1.2 NextAuth Setup

- [ ] **[T-1.2.1]** Instalar `next-auth@beta` (v5) + configurar `src/app/api/auth/[...nextauth]/route.ts` con provider Azure AD y los scopes de 1.1.2
- [ ] **[T-1.2.2]** Implementar callback `jwt`/`session` que persiste `access_token`/`refresh_token` de Graph (cifrados) para reutilizar en Server Actions
- [ ] **[T-1.2.3]** Restringir login a dominio `@maestra.cl` (validar `profile.email` en el callback `signIn`)
- [ ] **[T-1.2.4]** Crear página `(auth)/login/page.tsx` con botón "Conectar con Microsoft"

### 1.3 Database Schema

- [ ] **[T-1.3.1]** Crear migración `supabase/migrations/001_initial_schema.sql` con las 11 tablas del Tech Spec §4.2 (copiar SQL completo)
- [ ] **[T-1.3.2]** Aplicar migración vía MCP de Supabase (`.mcp.json` ya configurado) o `supabase db push`
- [ ] **[T-1.3.3]** Insertar el perfil de Carlos en `profiles` (trigger post-signup o inserción manual inicial con `role='admin'`)
- [ ] **[T-1.3.4]** Verificar RLS con `get_advisors` (MCP Supabase) — cero warnings críticos antes de continuar

### Checklist de Aceptación — Fase 1

- [ ] Carlos puede loguearse con su cuenta Microsoft y llega a un dashboard vacío
- [ ] Intentar loguearse con un email no-`@maestra.cl` es rechazado
- [ ] Las 11 tablas existen en Supabase con RLS habilitado
- [ ] El token de Graph API queda disponible para Server Actions (verificar con una llamada de prueba a `/me`)

### Notas Técnicas — Fase 1

- El botón "Conectar con Microsoft" debe re-disparar el consentimiento si el refresh token expiró — diseñar el error `GRAPH_AUTH_EXPIRED` desde esta fase, no como parche después.
- Si Azure AD exige admin consent y no se resuelve rápido, hay un plan B documentado en Apéndice F (Riesgos).

---

## FASE 2: Design System Maestra & Layout

> **Duración:** 1-2 días
> **Depende de:** Fase 1 (necesita auth para tener páginas protegidas que envolver)
> **Entregable:** Layout de navegación + tokens de marca aplicados, visible en una página placeholder

### Qué construye y por qué

Antes de construir pantallas de datos reales, fijar el sistema visual evita rehacer estilos después. Se usa el skill `marca-maestra` para garantizar consistencia con los dashboards de referencia.

### 2.1 Tokens y Componentes Base

- [ ] **[T-2.1.1]** Configurar `tailwind.config.ts` con los tokens de color de Marca Maestra (ver sección Sistema de Diseño arriba)
- [ ] **[T-2.1.2]** Instalar componentes shadcn necesarios: `table`, `card`, `badge`, `tabs`, `dialog`, `tooltip`
- [ ] **[T-2.1.3]** Crear el logo SVG de Maestra como componente React inline (`src/shared/ui/maestra-logo.tsx`) — NO como `<img>`, para que sea reutilizable también en el export HTML autocontenido

### 2.2 Layout de Navegación

- [ ] **[T-2.2.1]** Crear `(dashboard)/layout.tsx` con nav superior fija (translúcida, blur) + footer con badge "Uso interno — Grupo Maestra"
- [ ] **[T-2.2.2]** Crear navegación entre `/reporte`, `/fuentes`, `/dotacion`
- [ ] **[T-2.2.3]** Middleware de protección de rutas: sin sesión → redirect a `/login`

### Checklist de Aceptación — Fase 2

- [ ] Las 3 rutas del dashboard son accesibles solo autenticado
- [ ] La paleta de color coincide visualmente con los dashboards de referencia (comparación lado a lado)
- [ ] El logo se renderiza sin depender de un archivo externo

---

## FASE 3: Ingesta Plan de Obras Gespro

> **Duración:** 2 días
> **Depende de:** Fase 1 (Graph API + DB)
> **Entregable:** Tabla `obras` poblada automáticamente desde el Excel Gespro más reciente

### Qué construye y por qué

Es el catálogo base que referencian tanto el cash-flow engine (obra ↔ headcount) como el modelo de estimación (clasificación por tipo/tamaño/comuna). Se construye primero porque las fases 4 y 6 dependen de que `obras` ya exista poblada.

### 3.1 Cliente Graph API + Búsqueda de Archivo Más Reciente

- [ ] **[T-3.1.1]** Crear `features/ingestion/graph/client.ts` — wrapper de `@microsoft/microsoft-graph-client` autenticado con el token de sesión NextAuth
- [ ] **[T-3.1.2]** Implementar `findLatestFile(folderPattern, filePattern)` — usa `/search` de Graph, ordena por `lastModifiedDateTime` real (no por nombre), replicando la lógica ya validada manualmente en esta sesión con `sharepoint_search`
- [ ] **[T-3.1.3]** Implementar reintento con backoff (3 intentos, 30s) para el caso de archivo bloqueado (abierto en Excel)

### 3.2 Parser de Plan de Obras Gespro

- [ ] **[T-3.2.1]** Crear `features/obras/gespro-parser.ts` con `exceljs` — lee hoja "Plan de Obras": `Cod, Proyecto, Comuna, Tipo, Cliente, un, Inicio Obra, Fin Obra, Dur. Obra`
- [ ] **[T-3.2.2]** Validar cada fila con Zod schema (`ObraRawSchema`) antes de upsert
- [ ] **[T-3.2.3]** Server Action `syncObrasFromGespro()` — upsert en `obras` por `codigo_gespro`, registrar `fuente_archivo` y `fuente_actualizado_at`

### 3.3 Panel de Estado (`/fuentes`)

- [ ] **[T-3.3.1]** Crear vista `/fuentes` con card "Plan de Obras Gespro": último archivo leído, fecha, cantidad de obras, botón "Sincronizar ahora"

### Checklist de Aceptación — Fase 3

- [ ] Ejecutar sync puebla `obras` con ~30+ registros reales
- [ ] Volver a ejecutar sync con el mismo archivo no duplica filas (upsert correcto)
- [ ] Si el archivo está bloqueado, el panel muestra el error específico sin caerse

### Notas Técnicas — Fase 3

- Confirmado en la investigación: el Gespro NO tiene ninguna columna de dotación — no intentar mapear headcount aquí, eso es Fase 6.

---

## FASE 4: Ingesta Pagos Mensuales + Motor de Cálculo

> **Duración:** 4-5 días — la fase más grande, es el corazón financiero del proyecto
> **Depende de:** Fase 1, Fase 3 (obras debe existir para asociar `obra_id` en los line items)
> **Entregable:** `cash_flow_monthly` con datos reales ingeridos + proyección calculada con las fórmulas del Excel actual

### Qué construye y por qué

Reemplaza el Excel "Flujo de Caja" como fuente de verdad. Es la fase que un error en ella tiene el mayor costo (es un dato financiero real) — por eso lleva testing unitario exhaustivo.

### 4.1 Parser de Remuneraciones/Reliquidaciones (fuente estructurada)

- [ ] **[T-4.1.1]** Crear `features/ingestion/excel-parser/remuneraciones.ts` — busca en Graph dentro de `Pagos Mensuales/sueldos y reliquidaciones/` el archivo `Solicitud de Requerimiento remuneracion <mes> <año> RG.xlsx` (y variante RP) por patrón mes/año, tolerante a naming inconsistente (singular/plural, sufijos)
- [ ] **[T-4.1.2]** Parsear columnas `Sociedad, RUT, Division, Monto, Concepto de pago` — **descartar el campo RUT inmediatamente tras validar la fila** (no persistir), agregar por sociedad
- [ ] **[T-4.1.3]** Repetir para `reliquidaciones <mes> <año>/Solicitud de Requerimiento reliquidacion... RG.xlsx`
- [ ] **[T-4.1.4]** Insertar en `payroll_source_documents` (bitácora) + `payroll_line_items` (montos agregados, sin PII)

### 4.2 Cash-Flow Engine

- [ ] **[T-4.2.1]** Crear `features/cash-flow/formulas.ts` con las fórmulas migradas: `cotizaciones = 0.24 * remuneraciones`, `sence = 0.08 * remuneraciones + 30_000_000`, `reliquidaciones_proyectadas = 0.01 * remuneraciones`, `finiquitos = 0.30 * (remuneraciones + reliquidaciones + anticipo)`
- [ ] **[T-4.2.2]** Crear `features/cash-flow/engine.ts` — función `calcularMesCashFlow(periodo)`: si hay `payroll_line_items` reales para ese mes, usarlos (`es_real=true`); si no, aplicar fórmulas sobre el headcount proyectado (`es_real=false`)
- [ ] **[T-4.2.3]** Migrar el histórico real actual del Excel (Nov 2022 – Abr 2026) a `cash_flow_monthly` como carga inicial (`es_real=true`, `metodo_calculo='migracion_inicial'`) — usar `exceljs` sobre el Excel de Flujo de Caja más reciente NO bloqueado
- [ ] **[T-4.2.4]** Implementar `overrideCashFlowValue(periodo, concepto, monto)` — Server Action para ajuste manual, registra `overridden_by`/`overridden_at` + entrada en `audit_log`

### 4.3 Tests Unitarios (críticos)

- [ ] **[T-4.3.1]** Vitest: cada fórmula de 4.2.1 contra los valores reales conocidos del Excel (usar los meses reales como fixtures — ej. verificar que `cotizaciones` calculada para un mes real coincide con el valor real del Excel dentro de tolerancia razonable)
- [ ] **[T-4.3.2]** Vitest: `calcularMesCashFlow` prioriza datos reales sobre fórmula cuando ambos existen

### Checklist de Aceptación — Fase 4

- [ ] Un mes con archivo real disponible en SharePoint se ingiere sin intervención manual
- [ ] Un mes sin archivo real (futuro) se calcula con fórmula y queda marcado `es_real=false`
- [ ] Ningún RUT ni nombre de persona existe en `payroll_line_items` (verificar con query directa)
- [ ] Coverage de `features/cash-flow` > 80%

### Notas Técnicas — Fase 4

- El nombre de archivo real observado mezcla RG/RP como archivos separados — el parser debe combinarlos en el mismo `periodo` antes de escribir a `cash_flow_monthly`.
- Reliquidaciones tiene DOS fuentes posibles en SharePoint (el pivot "Reliquidación Diferencia" y el "Solicitud de Requerimiento") — usar el segundo por tener el mismo formato estructurado que remuneraciones; el primero queda como fuente de validación cruzada manual.

---

## FASE 5: Histórico Buk (Snapshots)

> **Duración:** 2-3 días
> **Depende de:** Fase 1 (DB), Fase 3 (obras, para asociar snapshots por obra donde aplique)
> **Entregable:** Cron mensual corriendo en Vercel, snapshots reales guardados en `buk_dotacion_snapshots`

### Qué construye y por qué

Sin serie histórica regular, el modelo de estimación de la Fase 6 no tiene con qué comparar. Se construye desacoplada del refresh manual (decisión técnica del Tech Spec §2.2).

### 5.1 Cliente Buk (propio, INSERT-only)

- [ ] **[T-5.1.1]** Crear `features/headcount/buk-sync/client.ts` — mismo patrón que `panel-relaciones-laborales/src/lib/buk/api-client.ts` (fetch + header `auth_token`, paginado)
- [ ] **[T-5.1.2]** A diferencia del proyecto hermano: este sync hace **INSERT, nunca UPDATE** — cada corrida crea una fila nueva en `buk_dotacion_snapshots` con `snapshot_date = hoy`
- [ ] **[T-5.1.3]** Poblar `buk_cargo_catalog` automáticamente (upsert por `nombre_buk`) a medida que aparecen cargos nuevos en la respuesta de Buk

### 5.2 Cron Endpoint

- [ ] **[T-5.2.1]** Crear `app/api/cron/buk-snapshot/route.ts` — valida header `CRON_SECRET`, ejecuta el sync, agrega conteos por `cargo_id`+`obra_id` (si el `area_id` de Buk mapea a una obra)
- [ ] **[T-5.2.2]** Configurar `vercel.json` con el cron (1er día de cada mes, 03:00)
- [ ] **[T-5.2.3]** Registrar resultado en `audit_log` (éxito/fallo, cantidad de snapshots)

### Checklist de Aceptación — Fase 5

- [ ] Ejecutar el endpoint manualmente 2 veces en el mismo día crea 2 filas distintas (confirmando que NO es upsert destructivo)
- [ ] El cron está configurado y visible en el dashboard de Vercel
- [ ] Si `BUK_API_KEY` falla, el endpoint responde error claro sin crashear

### Notas Técnicas — Fase 5

- El mapeo `area_id` (Buk) → `obra_id` (nuestra tabla) probablemente no es 1:1 automático — puede requerir una tabla de mapeo manual inicial si los nombres no calzan exactamente. Documentar los que no se logran mapear en `audit_log`.

---

## FASE 6: Motor de Estimación de Dotación

> **Duración:** 3-4 días
> **Depende de:** Fase 3 (obras), Fase 5 (al menos 1-2 meses de snapshots — puede necesitar backfill manual inicial si no hay histórico suficiente todavía)
> **Entregable:** Las 10 obras identificadas sin headcount manual (La Compañía, Agua Santa, Lira III, Distrito Centro, Altos del Elqui, Esmeralda, Serrano B, Vista Llacolén C, General Mackenna 2, Pintor Cicarelli III) quedan con una curva estimada, trazable

### Qué construye y por qué

Es la pieza más ambiciosa del proyecto — la decisión explícita del usuario de resolver esto con un modelo, no con alertas manuales.

### 6.1 Clasificador de Obras Similares

- [ ] **[T-6.1.1]** Crear `features/headcount/forecast-model/similarity.ts` — función `obrasSimilares(obraObjetivo, obrasHistoricas)`: filtra por `tipo` igual, `unidades` dentro de ±30%, prioriza misma `comuna`/región
- [ ] **[T-6.1.2]** Función `curvaHeadcountNormalizada(obraId)` — para una obra con histórico Buk completo, normaliza su curva de dotación por **% de avance de obra** (mes/duración total), no por fecha calendario, para poder comparar obras de distinta duración

### 6.2 Motor de Estimación

- [ ] **[T-6.2.1]** Crear `features/headcount/forecast-model/estimate.ts` — `estimarDotacion(obraObjetivo)`: promedia las curvas normalizadas de las obras similares (6.1.1), escala por `unidades` de la obra objetivo, produce una curva mensual de variación neta
- [ ] **[T-6.2.2]** Server Action `runForecastModel(obraId)` — ejecuta la estimación, escribe en `headcount_by_obra` (`origen='modelo_estimado'`) y registra la corrida completa en `headcount_forecast_runs` (método, obras de referencia, parámetros)
- [ ] **[T-6.2.3]** Vista `/dotacion` — tabla de obras con columna "Origen" (manual/buk_real/modelo_estimado), permite override manual en cualquier momento

### 6.3 Validación del Modelo

- [ ] **[T-6.3.1]** Backtest: correr el modelo sobre una obra que YA tiene dato manual completo (ocultando temporalmente ese dato) y comparar la estimación contra el real — documentar el error observado en `docs/`
- [ ] **[T-6.3.2]** Vitest: `obrasSimilares` retorna resultados deterministas y razonables sobre fixtures conocidas

### Checklist de Aceptación — Fase 6

- [ ] Las 10 obras sin dato quedan con una curva estimada visible en `/dotacion`
- [ ] Cada estimación es trazable a `headcount_forecast_runs` (qué obras de referencia se usaron)
- [ ] Carlos puede sobrescribir manualmente cualquier estimación sin perder el registro de que existió una estimación previa

### Notas Técnicas — Fase 6

- Si al llegar a esta fase el histórico de Buk (Fase 5) todavía tiene pocos meses, el modelo tendrá pocas obras de referencia con curva completa — es esperado y aceptable para el MVP; el modelo mejora con el tiempo a medida que se acumulan snapshots (ver Tech Spec §12, Fase 3 futura con ML real).
- Es explícitamente un modelo **heurístico**, no Machine Learning — mantenerlo simple y explicable es preferible dado que alimenta una decisión financiera.

---

## FASE 7: Dashboard del Reporte

> **Duración:** 3-4 días
> **Depende de:** Fase 2 (Design System), Fase 4 (datos de cash flow), Fase 6 (datos de dotación completos)
> **Entregable:** `/reporte` funcional replicando el formato de los dashboards de referencia

### Qué construye y por qué

Es la cara visible del proyecto — debe verse y comportarse como los dashboards que Maestra ya usa y confía visualmente.

### Wireframe de Referencia — `/reporte` (Desktop, adaptado de los dashboards Gespro)

```
┌──────────────────────────────────────────────────────────────────┐
│ [Logo Maestra]         Flujo de Caja Nómina        [Actualizar]  │
├──────────────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ Total mes │ │ Var. vs   │ │ Obras con │ │ Meses con │            │
│  │  $XXX.XXX │ │ mes ant.  │ │ headcount │ │  alerta   │            │
│  │           │ │  ▲/▼ X%   │ │ estimado  │ │  caja     │            │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘            │
├──────────────────────────────────────────────────────────────────┤
│  Línea de tiempo mensual (Nov-2022 → Abr-2027)                   │
│  [barras por concepto, color por es_real/forecast, scroll horiz.] │
│  ─────────────────────────────┼─── hoy ──────────────────────────  │
├──────────────────────────────────────────────────────────────────┤
│  Tabla de Detalle (filtrable por concepto, por sociedad/obra)     │
│  Mes | Anticipo | Remun. | Finiquito | Reliq. | Cotiz. | SENCE   │
├──────────────────────────────────────────────────────────────────┤
│  ⚠ Alertas: obras con headcount estimado (no manual) este mes    │
└──────────────────────────────────────────────────────────────────┘
```

### 7.1 Componentes del Dashboard

- [ ] **[T-7.1.1]** Crear `features/cash-flow/components/kpi-hero.tsx` — 4 tarjetas (igual patrón que "Minuta GESPRO")
- [ ] **[T-7.1.2]** Crear `features/cash-flow/components/timeline-chart.tsx` — línea de tiempo mensual con scroll horizontal, línea vertical "hoy" (igual patrón que "Carta Gantt")
- [ ] **[T-7.1.3]** Crear `features/cash-flow/components/detail-table.tsx` — tabla con filtro por concepto/sociedad, usando shadcn `DataTable`
- [ ] **[T-7.1.4]** Crear `features/cash-flow/components/alert-panel.tsx` — lista de obras con `origen='modelo_estimado'` este mes, con tag de severidad

### 7.2 Server Actions de Lectura

- [ ] **[T-7.2.1]** `getCashFlowSeries(periodoDesde, periodoHasta)` — query a `cash_flow_monthly`
- [ ] **[T-7.2.2]** `getObrasConEstimacion(periodo)` — query a `headcount_by_obra` filtrando `origen='modelo_estimado'`
- [ ] **[T-7.2.3]** Botón "Actualizar reporte" → dispara `refreshCashFlowReport()` (Server Action que orquesta Fases 3+4+6 en secuencia) con feedback de progreso

### Checklist de Aceptación — Fase 7

- [ ] El dashboard es visualmente comparable a los 2 dashboards de referencia (misma paleta, misma jerarquía de KPIs)
- [ ] El botón "Actualizar" corre el pipeline completo y refleja el resultado sin recargar la página
- [ ] Los meses reales vs proyectados son visualmente distinguibles

---

## FASE 8: Export HTML Autocontenido

> **Duración:** 1-2 días
> **Depende de:** Fase 7 (necesita el dashboard ya construido para congelarlo)
> **Entregable:** Botón "Descargar HTML" produce un archivo adjuntable por correo, igual patrón que el envío semanal de Gespro

### Qué construye y por qué

Requisito explícito del usuario: el reporte debe poder distribuirse exactamente como hoy se distribuye el Gespro — HTML autocontenido adjunto a un correo.

### 8.1 Renderer de Export

- [ ] **[T-8.1.1]** Crear `features/report-export/render.ts` — usa `renderToStaticMarkup` (o equivalente) sobre los mismos componentes de Fase 7, con CSS inline (no `<link>`) y datos embebidos como `<script type="application/json">` (mismo patrón detectado en "Carta Gantt")
- [ ] **[T-8.1.2]** Server Action `exportReportAsHtml(periodoDesde, periodoHasta)` — genera el HTML, sube a bucket `report-exports`, registra `export_storage_path` en `report_snapshots`
- [ ] **[T-8.1.3]** Botón "Descargar / Exportar HTML" en `/reporte` — dispara la Server Action y fuerza la descarga del archivo al navegador

### Checklist de Aceptación — Fase 8

- [ ] El archivo `.html` descargado se abre correctamente en un navegador sin conexión a internet (verifica que es 100% autocontenido)
- [ ] Se ve idéntico al dashboard vivo en el momento de la exportación
- [ ] Adjuntar el archivo a un correo de prueba y enviarlo funciona igual que con los archivos Gespro de referencia

---

## FASE 9: Seguridad, Auditoría & Deploy

> **Duración:** 2-3 días
> **Depende de:** Todas las fases anteriores
> **Entregable:** RLS validado sin warnings críticos, audit log cubriendo las acciones sensibles, app desplegada en Vercel

> Nota: esta fase reemplaza la Auditoría de Seguridad formal (Skill #9, 60 min) que se omitió por decisión del usuario — condensa sus puntos esenciales dado que el proyecto maneja datos de nómina.

### 9.1 Revisión de Seguridad Condensada

- [ ] **[T-9.1.1]** Ejecutar `get_advisors` (MCP Supabase) sobre el proyecto completo — cero vulnerabilidades críticas o de severidad alta sin resolver
- [ ] **[T-9.1.2]** Auditar manualmente: ¿alguna tabla tiene RUT o nombre de persona junto a un monto de remuneración? (debe ser NO en todas)
- [ ] **[T-9.1.3]** Verificar que el `service_role key` de Supabase no aparece en ningún código que corra en el cliente (`grep -r SERVICE_ROLE src/app/**/page.tsx src/**/*.client.tsx`)
- [ ] **[T-9.1.4]** Verificar que `CRON_SECRET` y todos los secrets están solo en variables de entorno de Vercel, nunca en el repo (`git log -p | grep -i secret` limpio)

### 9.2 Auditoría de Acciones

- [ ] **[T-9.2.1]** Confirmar que `overrideCashFlowValue`, `runForecastModel`, y cada refresh manual escriben en `audit_log`
- [ ] **[T-9.2.2]** Vista simple de audit log (puede vivir dentro de `/fuentes` o una ruta `/admin/audit`) — quién hizo qué y cuándo

### 9.3 Deploy

- [ ] **[T-9.3.1]** Configurar proyecto en Vercel, variables de entorno de producción
- [ ] **[T-9.3.2]** Actualizar redirect URI de Azure AD con la URL de producción
- [ ] **[T-9.3.3]** Ejecutar Playwright E2E contra el ambiente de producción (login → refresh → ver reporte)
- [ ] **[T-9.3.4]** Piloto: Carlos usa la herramienta para el ciclo de nómina del mes siguiente en paralelo al Excel actual, compara resultados antes de descontinuar el Excel

### Checklist de Aceptación — Fase 9

- [ ] `get_advisors` sin críticos
- [ ] Cero PII de remuneración individual en la base de datos
- [ ] App accesible en producción, login funcional
- [ ] Un ciclo de nómina completo corrido en paralelo (Excel vs herramienta) con resultados consistentes

---

## FASE 10 (Post-MVP): Ingesta Automatizada de Anticipos

> **Duración estimada:** 3-4 días
> **Depende de:** Fase 4
> **Diferida explícitamente** — ver Tech Spec §2.3. Los PDFs/RTF de "Resumen Anticipos" (formato legado Winper) no tienen estructura confiable para parsing automático sin riesgo de error en un dato financiero. Empezar esta fase solo si, tras usar la herramienta unos meses, el patrón de esos archivos resulta lo bastante consistente para automatizar con confianza — o evaluar si Maestra puede solicitar que ese reporte se genere en un formato estructurado (Excel) en el sistema de origen.

---

## Apéndice A: Dependencias Entre Fases

```
Fase 1 (Foundation) ──┬──→ Fase 2 (Design System)
                       ├──→ Fase 3 (Obras Gespro) ──┬──→ Fase 4 (Pagos + Cash-Flow) ──┐
                       │                             │                                 │
                       └──→ Fase 5 (Buk Snapshots) ──┴──→ Fase 6 (Forecast Model) ──────┼──→ Fase 7 (Dashboard) ──→ Fase 8 (Export) ──→ Fase 9 (Seguridad & Deploy)
                                                                                          │
                                                                              Fase 10 (Post-MVP, paralela/posterior)
```

Fases 3 y 5 pueden ejecutarse en paralelo (ambas solo dependen de Fase 1). Fase 2 puede avanzar en paralelo a 3/4/5/6 (es independiente de datos).

---

## Apéndice B: Estimaciones y Timeline

| Fase          | Días Estimados  | Notas                                                                      |
| ------------- | --------------- | -------------------------------------------------------------------------- |
| 1             | 2-3             | Incluye trámite de Azure AD, puede extenderse si requiere aprobación de IT |
| 2             | 1-2             | Puede correr en paralelo a Fase 3-6                                        |
| 3             | 2               |                                                                            |
| 4             | 4-5             | La fase de mayor riesgo/complejidad                                        |
| 5             | 2-3             |                                                                            |
| 6             | 3-4             |                                                                            |
| 7             | 3-4             |                                                                            |
| 8             | 1-2             |                                                                            |
| 9             | 2-3             |                                                                            |
| **TOTAL MVP** | **~20-28 días** | Trabajo en sesiones con Claude Code, no full-time                          |
| 10 (post-MVP) | 3-4             | Diferida                                                                   |

---

## Apéndice C: Riesgos y Plan de Contingencia

| Riesgo                                                                                                   | Probabilidad       | Impacto               | Mitigación                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------- | ------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Azure AD requiere admin consent que tarda en aprobarse                                                   | Media              | Alto (bloquea Fase 1) | Plan B: mientras se resuelve, desarrollar y probar todo con datos de fixtures/exports manuales; conectar Graph API al final                                              |
| El histórico de Buk (Fase 5) no acumula suficientes meses antes de necesitar la Fase 6                   | Alta al inicio     | Medio                 | El modelo funciona con menos obras de referencia (menor confianza) — se declara explícitamente en la UI (`headcount_forecast_runs`), mejora con el tiempo                |
| Naming inconsistente en SharePoint rompe la búsqueda por patrón en un mes futuro                         | Media              | Medio                 | Panel `/fuentes` muestra claramente cuando un archivo esperado no se encontró, permite fallback manual (subir el archivo directamente) sin bloquear el resto del reporte |
| Un error en las fórmulas de proyección genera una cifra financiera incorrecta que se comparte por correo | Baja (con testing) | Alto                  | Coverage >80% en `features/cash-flow`, backtesting contra meses reales conocidos antes de confiar en cualquier proyección nueva                                          |
| Archivo de Flujo de Caja bloqueado (abierto en Excel) justo cuando Carlos necesita refrescar             | Media              | Bajo                  | Reintento con backoff + mensaje de error claro, no bloquea el resto del refresh                                                                                          |

---

## Changelog

| Fecha      | Versión | Cambios                                                                                                                                                                                       |
| ---------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-04 | 1.0     | Blueprint inicial generado — pipeline Herramienta Interna con Viability/PDR/User Stories/UX/UI/Security Audit formales omitidos por decisión del usuario, contenido esencial integrado inline |
