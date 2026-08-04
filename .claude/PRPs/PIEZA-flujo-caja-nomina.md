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

- [ ] `npm run typecheck` → 0 errores
- [ ] `npm run build` → exitoso
- [ ] Playwright screenshot confirma UI renderiza
- [ ] Todos los criterios de éxito de "Qué" cumplidos
- [ ] RLS verificado con `get_advisors(type: "security")`
- [ ] Deploy en Vercel con redirect URI de Azure AD actualizado

---

## 🔒 Auto-Blindaje

> Esta sección crece durante la implementación — se documenta cada error encontrado y su fix.

_(vacío — se llena durante la ejecución de El Yunque)_

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

_La Pieza pendiente aprobación. Ninguna línea de código ha sido modificada._
