# Flujo de Caja Nómina — Technical Specifications

> **Tech Spec v1.0**
> **Estado**: BORRADOR — pendiente aprobación para avanzar a User Stories
> **Fecha**: 2026-08-04
> **Contexto de referencia**: brief de descubrimiento (ver historial de sesión) — reemplaza PDR formal, ruta Herramienta Interna sin BMC/Viability/PDR formales

---

## 1. Resumen Ejecutivo

### Problema

El área de Compensaciones y Gestión de Grupo Maestra proyecta el flujo de caja necesario para pagar nómina (anticipos, remuneraciones, finiquitos, reliquidaciones, cotizaciones, SENCE) en un Excel mantenido a mano, con datos reales dispersos en carpetas de SharePoint/OneDrive con nomenclatura inconsistente, y con 10 de 25 obras sin dotación proyectada porque no existe un método sistemático para estimarla.

### Solución Técnica

Una herramienta interna (Next.js + Supabase) que: (1) ingiere los archivos reales de pagos desde SharePoint vía Microsoft Graph, (2) mantiene el motor de cálculo de flujo de caja como datos+fórmulas versionadas en base de datos (no en Excel), (3) construye un histórico propio de dotación de Buk para alimentar un modelo de estimación de headcount por obra, y (4) genera un reporte que replica **exactamente el formato y estructura funcional** de los dos dashboards de referencia (Minuta GESPRO Comparativo y Carta Gantt Plan de Obras) — no solo como página web viva, sino también como **archivo HTML autocontenido exportable**, listo para adjuntar y enviar por correo a una lista de distribución, igual al patrón real ya en uso en Maestra (ej. el envío semanal de Gespro de Gerencia Inmobiliaria a ~30 destinatarios).

### Complejidad Estimada

**Complejo** — no por volumen de datos, sino por número de integraciones heterogéneas (Graph API delegado, Buk API, parsing de Excel/PDF con naming inconsistente) y por la sensibilidad de los datos (remuneraciones, RUTs). Se recomienda ejecución por fases (ver Blueprint).

---

## 2. Stack Tecnológico

### 2.1 Tabla Resumen

| Capa             | Tecnología                                               | Versión         | Justificación                                                                                                                              |
| ---------------- | -------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Framework        | Next.js                                                  | 16 (App Router) | Ya provisionado por Forge; Server Actions simplifican el pipeline de ingesta sin exponer API pública                                       |
| UI Library       | React                                                    | 19              | Viene con el scaffold                                                                                                                      |
| Language         | TypeScript                                               | 5.7, strict     | Los datos financieros no toleran `any` — tipado estricto de extremo a extremo                                                              |
| Styling          | Tailwind CSS                                             | 3.4             | Ya provisionado; permite implementar el sistema visual Maestra (tokens de color ya identificados)                                          |
| Components       | shadcn/ui + Radix                                        | latest          | Tablas densas, filtros, modales de confirmación — patrón estándar de Forge para Internal Tool                                              |
| State Mgmt       | Zustand (solo cliente, filtros de UI)                    | latest          | Únicamente para estado de filtros/orden del dashboard (igual al Gantt de referencia) — NO para datos financieros, que viven en el servidor |
| Validation       | Zod                                                      | latest          | Todo input externo (Excel parseado, respuesta de Graph/Buk) se valida antes de tocar la DB                                                 |
| Backend          | Supabase (Postgres + Auth + RLS)                         | ya provisionado | Ya conectado (`hknwnimlafjwmchtefah`); Postgres da joins relacionales que este dominio necesita (obras↔headcount↔cargos)                   |
| Database         | PostgreSQL (Supabase)                                    | 15+             | —                                                                                                                                          |
| Auth             | NextAuth.js (Auth.js) v5, provider Azure AD              | latest          | Login delegado con cuenta Microsoft @maestra.cl — resuelve identidad Y acceso a Graph API en un solo flujo (ver §6)                        |
| Storage          | Supabase Storage                                         | ya provisionado | Solo para snapshots de reportes generados (HTML/PDF), no para los Excel fuente (esos se leen y descartan)                                  |
| Payments         | N/A                                                      | —               | Herramienta interna, sin cobros                                                                                                            |
| Email            | N/A (fase 1)                                             | —               | Se evalúa alerta por correo en Fase 2 si hay caja insuficiente proyectada                                                                  |
| Hosting          | Vercel                                                   | —               | Decisión del usuario; requiere el patrón de auth delegado de §6                                                                            |
| Excel parsing    | `exceljs`                                                | ^4.4            | Lee valores calculados de fórmulas, estilos de celda (útil para migración inicial de datos "amarillos") y es mantenido activamente         |
| PDF parsing      | `pdf-parse`                                              | ^1.1            | Mismo paquete que ya usa panel-relaciones-laborales; extracción de texto de los "Resumen Anticipos" legados                                |
| Graph API client | `@microsoft/microsoft-graph-client` + `@azure/msal-node` | latest          | SDK oficial, maneja refresh de tokens delegados                                                                                            |
| Testing          | Vitest + Playwright                                      | latest          | Vitest para el motor de cálculo (crítico, debe tener tests unitarios exhaustivos); Playwright para el flujo de login + refresh del reporte |
| Monitoring       | Sentry (opcional Fase 2)                                 | —               | No crítico para 1 usuario; reevaluar si se agregan más roles                                                                               |

### 2.2 Decisiones Técnicas Importantes

**Auth delegado (NextAuth + Azure AD) sobre App-only Graph API**

- Razón: el refresh es manual y el único usuario hoy es Carlos — no se necesita un proceso desatendido a medianoche. El login delegado usa los permisos que Carlos YA tiene (su OneDrive + carpetas compartidas con él, incluyendo "Pagos Mensuales" de mjdiaz), sin requerir permisos _application_ de todo el tenant.
- Trade-off: si el token delegado expira y Carlos no ha iniciado sesión en un tiempo, el refresh automático (si se agrega en Fase 2) fallaría hasta que vuelva a loguearse. Aceptable dado que hoy el refresh es manual.
- Reevaluar si: se necesita automatizar el refresh sin intervención humana (ej. alerta nocturna) — ahí sí se justifica la inversión en permisos _application_ con aprobación de IT.

**No persistir RUT + monto individual de remuneraciones en esta base de datos**

- Razón: el objetivo es proyectar CAJA AGREGADA, no administrar nómina (eso ya lo hace Buk). Guardar RUTs y montos individuales multiplica la superficie de riesgo (una tabla más con datos de remuneración personal) sin aportar al caso de uso.
- Se persiste: montos agregados por sociedad/obra/concepto/mes. Se descartan campos de identificación personal de las fuentes (RUT, nombre) durante el parsing — solo se usan transitoriamente en memoria para deduplicar/validar filas antes de agregar.
- Excepción: `buk_dotacion_snapshots` almacena conteos por cargo, NUNCA identidad de personas.
- Reevaluar si: en el futuro se necesita trazabilidad a nivel de persona (ej. auditoría de un caso puntual) — se agregaría una tabla separada con RLS más estricto, no se mezclaría con las tablas de proyección.

**Snapshots de Buk desacoplados del refresh del reporte**

- Razón: el modelo de estimación de dotación necesita una serie histórica con intervalos regulares (ideal: mensual). Si los snapshots solo ocurrieran cuando Carlos hace click en "Actualizar reporte", la serie tendría huecos irregulares.
- Se implementa como Vercel Cron independiente (ej. 1er día de cada mes), autenticado con `BUK_API_KEY` (API key propia, no depende del login delegado de Carlos).

**Excel/PDF parsing tolerante a naming inconsistente**

- Razón: confirmado en la investigación que las carpetas mezclan singular/plural, sufijos numéricos y subcarpetas "Nueva carpeta". Un path fijo se rompe con el próximo mes.
- Se implementa: búsqueda por patrón (mes+año en el nombre, dentro de la carpeta padre correspondiente) vía Graph Search API, no por ruta hardcodeada — igual al patrón ya validado en esta sesión con `sharepoint_search`.

**El reporte debe ser un archivo HTML exportable y adjuntable por correo, no solo una página web viva**

- Razón: confirmado con un ejemplo real de uso — Gerencia Inmobiliaria distribuye el Gespro semanal exactamente así (HTML autocontenido adjunto a un correo, a ~30 destinatarios). El flujo de caja de nómina debe poder distribuirse de la misma forma, ya que Carlos necesita enviarlo a otros (comité, gerencia) sin depender de que abran un link ni tengan sesión en la app.
- Se implementa: el mismo template visual de `/reporte` se serializa a un único `.html` con CSS/JS/datos inline (sin `<link>` ni `<script src>` externos), replicando el formato de los dos dashboards de referencia. Ver `features/report-export` (§3.3).
- Trade-off: un HTML autocontenido con datos inline es, en sí mismo, un documento con información financiera agregada fuera del control de acceso de la app una vez descargado — igual riesgo que hoy tiene el Excel/HTML que ya se comparte por correo. No es una regresión de seguridad, es el mismo modelo de distribución ya validado por el negocio.

### 2.3 Lo Que NO Se Incluye (y por qué)

| Tecnología                                                              | Razón de exclusión                                                                       | Agregar en                                                                                                         |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Redis/Upstash                                                           | Sin necesidad de rate limiting con 1 usuario                                             | Si se abre a más roles/tráfico                                                                                     |
| Automatización nocturna del refresh de SharePoint                       | Requiere permisos _application_ (admin) — usuario prefirió evitarlo ahora                | Fase 2, si se resuelve el registro de App con IT                                                                   |
| Extracción automática de montos desde PDFs de anticipos (Winper legado) | Formato no estructurado y variable — alto riesgo de error en un dato financiero sensible | Fase 2, empezar con carga manual/revisión asistida de esos montos, automatizar solo si el patrón resulta confiable |
| Multi-tenant / múltiples empresas clientes                              | Es una herramienta interna de un solo grupo empresarial                                  | No aplica                                                                                                          |
| Sentry / observabilidad avanzada                                        | 1 usuario, bajo tráfico                                                                  | Si se agregan más consumidores del reporte                                                                         |

---

## 3. Arquitectura

### 3.1 Diagrama de Alto Nivel

```
┌──────────────┐   Server Actions    ┌───────────────────┐
│   Browser    │◀────────────────────▶│   Next.js 16       │
│  (Carlos)    │   (React Server      │   App Router        │
└──────────────┘    Components)       │   (Vercel)           │
                                       └─────────┬────────────┘
                                                  │  (service role, server-only)
                          ┌───────────────────────┼───────────────────────┐
                          ▼                       ▼                       ▼
                 ┌─────────────────┐   ┌────────────────────┐   ┌──────────────────┐
                 │    Supabase      │   │  Microsoft Graph    │   │   Buk API         │
                 │  (Postgres+RLS)  │   │  (delegado, NextAuth │   │  (API key propia,  │
                 │  datos agregados │   │  Azure AD token)     │   │  cron mensual)      │
                 └─────────────────┘   └──────────┬──────────┘   └──────────┬────────┘
                                                   │                          │
                                        ┌──────────┴──────────┐               │
                                        ▼                     ▼               ▼
                              "Flujo de Caja"        "Pagos Mensuales"   Empleados/áreas
                              "Plan de Obra Gespro"   (OneDrive mjdiaz)   (headcount real)
                              (OneDrive Carlos)
```

### 3.2 Arquitectura de Carpetas

```
src/
├── app/
│   ├── (auth)/login/                  → Página de login (NextAuth Azure AD)
│   ├── (dashboard)/
│   │   ├── reporte/                   → El dashboard de flujo de caja (vivo, marca Maestra)
│   │   ├── fuentes/                   → Panel de estado de ingesta (última sync por fuente, errores)
│   │   └── dotacion/                  → Vista de headcount por obra + estimaciones del modelo
│   └── api/
│       ├── auth/[...nextauth]/        → NextAuth handler
│       ├── refresh/                   → Server Action/route: dispara ingesta + recálculo (botón manual)
│       ├── export/                    → Genera el HTML autocontenido descargable/adjuntable por correo
│       └── cron/buk-snapshot/         → Endpoint invocado por Vercel Cron
├── features/
│   ├── cash-flow/                     → Motor de cálculo (fórmulas migradas del Excel) + queries
│   ├── ingestion/
│   │   ├── graph/                     → Cliente Graph API + búsqueda de archivos por patrón
│   │   ├── excel-parser/              → Parsers específicos por tipo de archivo (remuneración, reliquidación)
│   │   └── pdf-parser/                → Parser de PDFs de anticipos (heurístico, Fase 1 manual-assisted)
│   ├── headcount/
│   │   ├── buk-sync/                  → Sync de snapshots (reutiliza patrón de panel-relaciones-laborales)
│   │   └── forecast-model/            → Motor de estimación de dotación faltante por obra
│   ├── obras/                         → Parser de Plan de Obras Gespro + catálogo de obras
│   └── report-export/                 → Renderer del HTML autocontenido (mismo template que /reporte, inline CSS/JS/datos)
├── shared/
│   ├── ui/                            → Componentes shadcn + tokens de marca Maestra
│   ├── types/                         → Tipos TS compartidos (Zod schemas inferidos)
│   └── supabase/                      → Cliente server-only (service role)
└── lib/
    └── audit/                         → Helper de logging de auditoría (quién cambió qué)
```

### 3.3 Componentes del Sistema

**Ingestion Layer (`features/ingestion`)**

- Propósito: traducir archivos heterogéneos de SharePoint (Excel estructurado, PDF legado) a filas normalizadas.
- Se comunica con: Microsoft Graph (lectura), `cash-flow` (escritura de line items agregados).
- Escala: no necesita escalar — volumen bajo (decenas de archivos/mes).

**Cash-Flow Engine (`features/cash-flow`)**

- Propósito: replicar en código las fórmulas hoy en Excel (Cotizaciones≈24%×Remuneraciones, SENCE≈8%×Remuneraciones+30M, Reliquidaciones≈1%, Finiquitos≈30%×(Remuneraciones+Reliquidaciones+Anticipo)), aplicadas sobre datos reales cuando existen y sobre proyección cuando no.
- Responsabilidades: calcular Total Nómina mensual, marcar cada celda como `actual` o `forecast`, exponer serie para el dashboard.
- Se comunica con: Supabase (lee `cash_flow_monthly`, `headcount_by_obra`), `headcount/forecast-model` (para completar los huecos de dotación).

**Headcount Forecast Model (`features/headcount/forecast-model`)**

- Propósito: para obras sin dotación proyectada, estimarla comparando contra obras históricas similares (tipo, unidades, comuna) usando los snapshots de Buk.
- Método (Fase 1, heurístico — no ML): (1) clasificar la obra objetivo por tipo/tamaño/comuna, (2) buscar obras pasadas con clasificación similar que ya tengan curva de dotación completa en Buk, (3) normalizar su curva de headcount por fase de obra (% de avance temporal, no fecha calendario), (4) escalar por unidades/tamaño de la obra objetivo, (5) registrar el resultado con su método y parámetros en `headcount_forecast_runs` para trazabilidad.
- Se comunica con: `buk-sync` (lee snapshots históricos), `obras` (lee catálogo con tipo/unidades/comuna).

**Report Export (`features/report-export`)**

- Propósito: producir un **archivo HTML único, autocontenido** (CSS y datos inline, sin dependencias externas, exactamente como los dos dashboards de referencia — Minuta GESPRO Comparativo y Carta Gantt Plan de Obras) que Carlos pueda descargar y adjuntar a un correo, replicando el flujo real ya en uso en Maestra (ej. el envío semanal de Gespro de Gerencia Inmobiliaria a su lista de distribución).
- Comparte el mismo template/diseño que `/reporte` (vista viva) — el export NO es un documento distinto, es un snapshot congelado del mismo componente, serializado a un solo archivo `.html`.
- Estructura a replicar del formato de referencia: KPIs hero, tarjetas/tabla de detalle, línea de tiempo mensual de caja (equivalente al Gantt), comparación vs. corte anterior (semáforo de variación igual a `crit`/`warn`/`ok`), logo SVG inline de Maestra, paleta de tokens ya identificada (`--navy`, `--fucsia`, `--gold`, etc.).
- Cada export queda registrado en `report_snapshots` (columna `export_storage_path`, ver §4.2) y almacenado en el bucket `report-exports` para poder reabrir/reenviar versiones anteriores.
- Se comunica con: `cash-flow` (lee la serie ya calculada), Supabase Storage (persiste el `.html` generado).

### 3.4 Flujo de Datos (refresh manual, end-to-end)

```
Carlos hace click "Actualizar reporte"
  → NextAuth valida sesión Microsoft (o pide re-login si expiró)
  → Ingestion Layer busca vía Graph los archivos del mes/periodo pedido
      (Flujo de Caja más reciente, Pagos Mensuales del mes, Plan de Obras Gespro más reciente)
  → Excel/PDF parsers normalizan a line items agregados (sin PII)
  → Cash-Flow Engine recalcula Detalle mensual, marca actual vs forecast
  → Headcount Forecast Model completa obras sin dato manual
  → Todo se persiste en Supabase con audit log (quién, cuándo, qué fuente)
  → Dashboard se re-renderiza con la nueva serie
  → Carlos hace click "Descargar / Exportar HTML" (opcional, cuando quiere enviarlo por correo)
      → Report Export congela el estado actual en un .html autocontenido, mismo formato que los dashboards de referencia
      → Se guarda en el bucket report-exports y se descarga al navegador para adjuntar al correo
```

---

## 4. Base de Datos

### 4.1 Modelo de Datos (Diagrama ER simplificado)

```
profiles (1) ──────< (many) audit_log
obras (1) ──────< (many) headcount_by_obra
obras (1) ──────< (many) headcount_forecast_runs
buk_cargo_catalog (1) ──────< (many) buk_dotacion_snapshots
payroll_source_documents (1) ──────< (many) payroll_line_items
payroll_line_items ──────> (aggregated into) cash_flow_monthly
uf_series (standalone, referenced by cash_flow_monthly)
report_snapshots (bitácora de refresh, standalone)
```

### 4.2 Schema Completo

```sql
-- ============================================
-- Tabla: profiles
-- Propósito: usuarios de la herramienta (hoy: solo Carlos), preparada para roles futuros
-- ============================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL CHECK (email LIKE '%@maestra.cl'),
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'finanzas', 'gerencia', 'viewer')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
COMMENT ON TABLE profiles IS 'Usuarios autorizados de la herramienta. Restringido a dominio @maestra.cl.';

-- ============================================
-- Tabla: obras
-- Propósito: catálogo de obras/proyectos, sincronizado desde Plan de Obras Gespro
-- ============================================
CREATE TABLE obras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_gespro TEXT,
  nombre TEXT NOT NULL,
  comuna TEXT,
  tipo TEXT CHECK (tipo IN ('Retail', 'DS19', 'DS49', 'Otro')),
  cliente TEXT CHECK (cliente IN ('Maestra', 'Terceros')),
  unidades INT,
  inicio_obra DATE,
  fin_obra DATE,
  dur_obra_meses INT,
  activa BOOLEAN DEFAULT TRUE,
  fuente_archivo TEXT,             -- nombre del archivo Gespro de origen (trazabilidad)
  fuente_actualizado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE UNIQUE INDEX idx_obras_codigo_gespro ON obras(codigo_gespro) WHERE codigo_gespro IS NOT NULL;
CREATE INDEX idx_obras_nombre ON obras(nombre);
ALTER TABLE obras ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuarios autenticados leen obras" ON obras FOR SELECT
  USING (auth.uid() IS NOT NULL);
COMMENT ON TABLE obras IS 'Catálogo de obras, sincronizado desde el Excel Plan de Obras Gespro más reciente.';

-- ============================================
-- Tabla: headcount_by_obra
-- Propósito: dotación mensual por obra — manual, real (Buk) o estimada por el modelo
-- ============================================
CREATE TABLE headcount_by_obra (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  periodo DATE NOT NULL,            -- primer día del mes
  variacion_neta INT NOT NULL DEFAULT 0,
  acumulado INT,
  origen TEXT NOT NULL CHECK (origen IN ('manual', 'buk_real', 'modelo_estimado')),
  forecast_run_id UUID REFERENCES headcount_forecast_runs(id),
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (obra_id, periodo)
);
CREATE INDEX idx_headcount_periodo ON headcount_by_obra(periodo);
ALTER TABLE headcount_by_obra ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuarios autenticados leen headcount" ON headcount_by_obra FOR SELECT
  USING (auth.uid() IS NOT NULL);
COMMENT ON TABLE headcount_by_obra IS 'Dotación mensual por obra. origen=modelo_estimado son los huecos completados automáticamente.';

-- ============================================
-- Tabla: headcount_forecast_runs
-- Propósito: trazabilidad de cada corrida del modelo de estimación (auditabilidad)
-- ============================================
CREATE TABLE headcount_forecast_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id UUID NOT NULL REFERENCES obras(id),
  metodo TEXT NOT NULL,              -- ej: 'similar_obras_v1'
  obras_referencia UUID[] NOT NULL,  -- qué obras históricas se usaron de base
  parametros JSONB,
  ejecutado_por UUID REFERENCES profiles(id),
  ejecutado_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
COMMENT ON TABLE headcount_forecast_runs IS 'Bitácora de cada estimación automática de dotación — qué método y qué obras de referencia se usaron.';

-- ============================================
-- Tabla: buk_cargo_catalog
-- Propósito: catálogo normalizado de cargos (hoy texto libre en Buk)
-- ============================================
CREATE TABLE buk_cargo_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_buk TEXT NOT NULL UNIQUE,   -- texto exacto como viene de Buk (role.name)
  familia_cargo TEXT,
  categoria TEXT,                    -- ej: 'obra', 'administrativo', 'gerencial'
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
COMMENT ON TABLE buk_cargo_catalog IS 'Normaliza los nombres de cargo de Buk (texto libre) a categorías reutilizables por el modelo.';

-- ============================================
-- Tabla: buk_dotacion_snapshots
-- Propósito: histórico de dotación por cargo/obra — NUNCA identidad de personas
-- ============================================
CREATE TABLE buk_dotacion_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  obra_id UUID REFERENCES obras(id),
  cargo_id UUID REFERENCES buk_cargo_catalog(id),
  activos INT NOT NULL DEFAULT 0,
  altas INT NOT NULL DEFAULT 0,
  bajas INT NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (snapshot_date, obra_id, cargo_id)
);
CREATE INDEX idx_buk_snapshot_date ON buk_dotacion_snapshots(snapshot_date);
COMMENT ON TABLE buk_dotacion_snapshots IS 'Snapshot mensual de conteos agregados desde Buk. Sin RUT ni nombre — solo conteos por cargo/obra.';

-- ============================================
-- Tabla: payroll_source_documents
-- Propósito: bitácora de cada archivo ingerido desde SharePoint (auditoría de origen)
-- ============================================
CREATE TABLE payroll_source_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT NOT NULL CHECK (tipo IN ('anticipo', 'remuneracion', 'reliquidacion', 'finiquito')),
  periodo DATE NOT NULL,
  nombre_archivo TEXT NOT NULL,
  graph_item_id TEXT,                -- id de Graph API, para volver a localizar el archivo
  web_url TEXT,
  filas_procesadas INT DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'ok' CHECK (estado IN ('ok', 'parcial', 'error')),
  notas TEXT,
  ingested_by UUID REFERENCES profiles(id),
  ingested_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX idx_payroll_docs_periodo ON payroll_source_documents(periodo, tipo);
COMMENT ON TABLE payroll_source_documents IS 'Un registro por archivo leído de SharePoint. Trazabilidad de dónde vino cada número.';

-- ============================================
-- Tabla: payroll_line_items
-- Propósito: datos agregados por sociedad/obra/concepto (SIN RUT ni nombre)
-- ============================================
CREATE TABLE payroll_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_document_id UUID NOT NULL REFERENCES payroll_source_documents(id) ON DELETE CASCADE,
  periodo DATE NOT NULL,
  concepto TEXT NOT NULL CHECK (concepto IN ('anticipo_rg', 'anticipo_rp', 'remuneracion_rg', 'remuneracion_rp', 'reliquidacion', 'finiquito')),
  sociedad TEXT,
  obra_id UUID REFERENCES obras(id),
  monto NUMERIC(14, 2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX idx_payroll_line_items_periodo ON payroll_line_items(periodo, concepto);
ALTER TABLE payroll_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuarios autenticados leen line items" ON payroll_line_items FOR SELECT
  USING (auth.uid() IS NOT NULL);
COMMENT ON TABLE payroll_line_items IS 'Montos agregados por sociedad/obra — deliberadamente SIN RUT ni nombre de persona.';

-- ============================================
-- Tabla: cash_flow_monthly
-- Propósito: equivalente a la hoja "Detalle" del Excel — real y proyectado
-- ============================================
CREATE TABLE cash_flow_monthly (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo DATE NOT NULL,
  concepto TEXT NOT NULL CHECK (concepto IN ('anticipo', 'remuneracion', 'finiquito', 'reliquidacion', 'cotizacion', 'sence', 'total_nomina')),
  monto NUMERIC(14, 2) NOT NULL,
  es_real BOOLEAN NOT NULL DEFAULT FALSE,
  metodo_calculo TEXT,               -- ej: 'ingesta_real', 'formula_24pct_remuneracion', 'manual_override'
  overridden_by UUID REFERENCES profiles(id),
  overridden_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (periodo, concepto)
);
CREATE INDEX idx_cash_flow_periodo ON cash_flow_monthly(periodo);
ALTER TABLE cash_flow_monthly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuarios autenticados leen cash flow" ON cash_flow_monthly FOR SELECT
  USING (auth.uid() IS NOT NULL);
COMMENT ON TABLE cash_flow_monthly IS 'Equivalente a la hoja Detalle del Excel. es_real=false son las celdas que hoy están en amarillo.';

-- ============================================
-- Tabla: uf_series
-- Propósito: histórico y proyección de UF (hoy placeholder +1% mensual en el Excel)
-- ============================================
CREATE TABLE uf_series (
  fecha DATE PRIMARY KEY,
  valor_uf NUMERIC(10, 2) NOT NULL,
  es_real BOOLEAN NOT NULL DEFAULT FALSE,
  fuente TEXT NOT NULL DEFAULT 'sii' CHECK (fuente IN ('sii', 'proyeccion_1pct')),
  fetched_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
COMMENT ON TABLE uf_series IS 'Valor UF real (SII) o proyectado. Reemplaza el placeholder manual del Excel.';

-- ============================================
-- Tabla: report_snapshots
-- Propósito: bitácora de cada refresh manual del reporte + cada export HTML generado
-- ============================================
CREATE TABLE report_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_by UUID NOT NULL REFERENCES profiles(id),
  generated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  periodo_desde DATE NOT NULL,
  periodo_hasta DATE NOT NULL,
  estado TEXT NOT NULL DEFAULT 'ok' CHECK (estado IN ('ok', 'parcial', 'error')),
  detalle_errores JSONB,
  export_storage_path TEXT,          -- ruta en el bucket report-exports si se generó un .html descargable
  exported_at TIMESTAMPTZ
);
COMMENT ON TABLE report_snapshots IS 'Un registro por cada refresh y por cada export HTML (descargable/adjuntable por correo) generado a partir de ese refresh.';

-- ============================================
-- Tabla: audit_log
-- Propósito: auditoría genérica de acciones sensibles (overrides manuales, ingestas)
-- ============================================
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES profiles(id),
  accion TEXT NOT NULL,
  entidad TEXT NOT NULL,
  entidad_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX idx_audit_log_entidad ON audit_log(entidad, entidad_id);
COMMENT ON TABLE audit_log IS 'Quién hizo qué. Crítico dado que este reporte alimenta decisiones financieras.';
```

### 4.3 Storage / Buckets

| Bucket           | Contenido                                                                                                                                              | Acceso                                | Límite       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | ------------ |
| `report-exports` | Copias HTML/PDF del reporte generado en cada refresh (para comparación histórica, igual al patrón "vs corte anterior" de los dashboards de referencia) | Privado, solo `profiles` autenticados | 10MB/archivo |

### 4.4 Migrations Strategy

Supabase CLI migrations (`supabase/migrations/*.sql`), secuenciales, cada una con su rollback documentado en comentario. Dado que el MCP de Supabase ya está configurado (`.mcp.json`), las migraciones pueden aplicarse vía las herramientas MCP directamente durante el desarrollo, con `supabase db push` como fallback manual.

---

## 5. API Specifications

### 5.1 Estilo de API

**Server Actions** para todas las mutaciones (refresh, override manual) — no se expone una API REST pública, ya que no hay consumidores externos. El único endpoint HTTP real es el cron de Buk (necesita ser invocable por Vercel Cron) y el callback de NextAuth.

### 5.2 Endpoints / Actions

```typescript
/**
 * Dispara la ingesta completa + recálculo (botón "Actualizar reporte")
 *
 * Server Action: refreshCashFlowReport()
 *
 * Auth: Requerida (sesión NextAuth activa con token Graph válido)
 * Rate Limit: N/A (uso manual, 1 usuario)
 */
interface RefreshReportRequest {
  periodoDesde: string; // ISO date, primer mes a refrescar
  periodoHasta: string; // ISO date
}

interface RefreshReportResponse {
  reportSnapshotId: string;
  estado: "ok" | "parcial" | "error";
  documentosIngeridos: number;
  obrasEstimadas: string[]; // obras donde se usó el modelo de estimación
  errores: { fuente: string; mensaje: string }[];
}

/**
 * Snapshot mensual de dotación desde Buk
 *
 * GET /api/cron/buk-snapshot
 * Invocado por Vercel Cron (1er día de cada mes)
 *
 * Auth: Header secreto (CRON_SECRET), no sesión de usuario
 */
interface BukSnapshotResponse {
  snapshotDate: string;
  cargosActualizados: number;
  obrasActualizadas: number;
}

// Error Response (todos los endpoints)
interface ErrorResponse {
  error: {
    code: string; // "GRAPH_AUTH_EXPIRED" | "FILE_LOCKED" | "PARSE_ERROR" | "VALIDATION_ERROR"
    message: string;
    fuente?: string; // qué integración falló
  };
}
```

### 5.3 Validación

Todo dato que entra desde una fuente externa (fila de Excel parseada, respuesta de Graph, respuesta de Buk) pasa por un schema Zod ANTES de tocar Supabase. Ejemplo: una fila de "Solicitud de Requerimiento remuneración" que no tenga `Monto` numérico o `Sociedad` no vacío se descarta y se registra en `payroll_source_documents.notas`, nunca se inserta a medias.

---

## 6. Autenticación y Seguridad

### 6.1 Flujo de Auth

```
1. Carlos abre la app → NextAuth redirige a login Microsoft (Azure AD, tenant Maestra365)
2. Carlos se autentica con su cuenta @maestra.cl (MFA según política del tenant)
3. Azure AD solicita consentimiento de permisos delegados:
   Files.Read.All, Sites.Read.All, offline_access, User.Read
   (delegados = actúa como Carlos, no como app-only)
4. NextAuth recibe access_token + refresh_token, los persiste cifrados
5. profiles.id = auth Microsoft oid; email debe matchear @maestra.cl (constraint DB)
6. Cada Server Action valida sesión activa antes de tocar Supabase (service role)
```

### 6.2 Roles y Permisos

| Rol                   | Puede hacer                                                         | No puede hacer                                  |
| --------------------- | ------------------------------------------------------------------- | ----------------------------------------------- |
| `admin` (Carlos, hoy) | Ver todo, disparar refresh, hacer overrides manuales, ver audit log | —                                               |
| `finanzas` (futuro)   | Ver reporte completo, disparar refresh                              | Overrides manuales, ver audit log detallado     |
| `gerencia` (futuro)   | Ver solo el dashboard resumen (KPIs agregados)                      | Ver detalle por sociedad/obra, disparar refresh |
| `viewer` (futuro)     | Ver dashboard resumen, solo lectura                                 | Todo lo demás                                   |

### 6.3 Protección de Rutas

| Ruta Pattern            | Acceso                          | Redirect si no auth     |
| ----------------------- | ------------------------------- | ----------------------- |
| `/reporte`              | Autenticado (cualquier rol)     | `/login`                |
| `/fuentes`, `/dotacion` | `admin`, `finanzas`             | `/reporte` (403 visual) |
| `/api/cron/*`           | Header `CRON_SECRET` únicamente | 401                     |
| `/api/auth/*`           | Público (NextAuth)              | —                       |

### 6.4 Security Checklist

- [ ] Dominio de email restringido a `@maestra.cl` a nivel de constraint DB Y a nivel de configuración NextAuth (tenant-restricted Azure AD app)
- [ ] Tokens de Graph API cifrados en reposo (NextAuth + `AUTH_SECRET` fuerte, o Supabase Vault)
- [ ] RLS habilitado en todas las tablas con datos agregados de nómina
- [ ] Ninguna tabla almacena RUT o nombre de persona junto a montos de remuneración (ver §2.2)
- [ ] Service role key de Supabase NUNCA expuesta al cliente — todo acceso a datos vía Server Actions
- [ ] `CRON_SECRET` fuerte y rotable para el endpoint de Buk snapshot
- [ ] Rate limiting no crítico hoy, pero el endpoint de cron valida el secreto en cada invocación
- [ ] Audit log inmutable (sin UPDATE/DELETE permitido vía RLS, solo INSERT) para las acciones sensibles
- [ ] HTTPS enforced (Vercel default)
- [ ] Secrets en variables de entorno de Vercel, nunca hardcoded ni en el repo

---

## 7. Integraciones Externas

### 7.1 Microsoft Graph API

- **Propósito**: leer Excel/PDF desde SharePoint/OneDrive (Flujo de Caja, Plan de Obras Gespro, Pagos Mensuales)
- **API Docs**: https://learn.microsoft.com/graph/api/overview
- **Auth method**: OAuth 2.0 delegado (Authorization Code flow vía NextAuth Azure AD provider)
- **Endpoints que usamos**: `/me/drive/root/search`, `/drives/{driveId}/items/{itemId}/content`, `/shares/{shareId}/driveItem` (para el link compartido de mjdiaz)
- **Costo estimado**: incluido en licencia M365 existente, sin costo adicional
- **Gotchas conocidos**: (1) búsqueda por nombre de carpeta no es 100% exacta — validar con fecha de modificación real, no confiar solo en el nombre; (2) archivos abiertos en Excel de escritorio pueden dar lock — implementar reintento con backoff; (3) el token delegado expira (~1h el access token, el refresh token dura más pero puede requerir re-consentimiento periódico según política del tenant)
- **Fallback si falla**: mostrar en `/fuentes` qué archivo no se pudo leer y por qué (ej. "bloqueado", "sesión expirada"), sin bloquear el resto del refresh

### 7.2 Buk API

- **Propósito**: snapshots de dotación por cargo/obra para el modelo de estimación de headcount
- **Auth method**: API key propia (`BUK_API_KEY`, header `auth_token`) — mismo patrón que panel-relaciones-laborales
- **Endpoints que usamos**: `GET /api/v1/employees` (paginado, con `current_job.role.name`, `area_id`), `GET /api/v1/areas/{id}`
- **Costo estimado**: sin costo adicional, incluido en la licencia Buk de Maestra
- **Gotchas conocidos**: el sync existente en panel-relaciones-laborales hace upsert destructivo — este proyecto debe usar su PROPIO sync que hace INSERT (nunca UPDATE) para preservar histórico
- **Fallback si falla**: el snapshot mensual reintenta al día siguiente; si falla 2 veces consecutivas, se registra en `audit_log` y se notifica (Fase 2: email)

---

## 8. Performance

### 8.1 Targets

| Métrica                              | Target | Máximo Aceptable                |
| ------------------------------------ | ------ | ------------------------------- |
| Carga inicial del dashboard          | 1.5s   | 3s                              |
| Refresh completo (todas las fuentes) | 30s    | 90s (incluye llamadas externas) |
| Query de serie mensual (54 meses)    | 100ms  | 300ms                           |

### 8.2 Estrategias de Optimización

- `cash_flow_monthly` es una tabla pequeña (pocas filas por mes × concepto) — no necesita caching agresivo.
- El refresh es asíncrono con feedback de progreso (no bloquea la UI mientras Graph API responde).

### 8.3 Escalabilidad

No es un requisito real dado el volumen (1 empresa, ~54 meses de historia, ~30 obras). El diseño relacional soporta crecer a más sociedades/obras sin cambios estructurales.

---

## 9. Error Handling

### 9.1 Error Codes

```typescript
enum AppErrorCode {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  UNAUTHORIZED = "UNAUTHORIZED",
  GRAPH_AUTH_EXPIRED = "GRAPH_AUTH_EXPIRED",
  FILE_LOCKED = "FILE_LOCKED",
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  PARSE_ERROR = "PARSE_ERROR",
  BUK_API_ERROR = "BUK_API_ERROR",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}
```

### 9.2 Logging Strategy

Logs estructurados en cada Server Action (fuente, duración, resultado). Los errores de ingesta se persisten en `payroll_source_documents.notas` / `report_snapshots.detalle_errores` — visibles en la UI, no solo en logs de servidor.

### 9.3 User-Facing Errors

Panel `/fuentes` muestra, por cada fuente, el último estado con mensaje claro en español ("Archivo de remuneraciones de julio 2026 no encontrado — verifica que exista en SharePoint" en vez de un stack trace).

---

## 10. Deployment

### 10.1 Environments

| Env         | URL                 | Propósito          | Deploy trigger |
| ----------- | ------------------- | ------------------ | -------------- |
| Development | localhost:3000      | Dev local          | Manual         |
| Production  | [a definir, Vercel] | Uso real de Carlos | Push a `main`  |

(No se justifica un ambiente de staging separado para 1 usuario — se prueba en local contra el mismo Supabase, usando datos de meses ya cerrados.)

### 10.2 Environment Variables

**Públicas (client-safe):**

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

**Secretas (server-only):**

```
SUPABASE_SERVICE_ROLE_KEY      — acceso server-only a Supabase
AUTH_SECRET                     — NextAuth
AZURE_AD_CLIENT_ID               — App registration
AZURE_AD_CLIENT_SECRET
AZURE_AD_TENANT_ID               — restringido al tenant Maestra365
BUK_API_KEY
BUK_API_URL
CRON_SECRET                      — valida invocaciones de Vercel Cron
```

### 10.3 CI/CD

Vercel auto-deploy en push a `main`, con `tsc --noEmit` + tests Vitest como gate previo (ya configurado vía el hook `pre-commit-validation.sh` de Forge).

### 10.4 Infrastructure

Vercel (hosting) + Supabase (DB, ya provisionado en `hknwnimlafjwmchtefah`) + Vercel Cron (1 job mensual).

---

## 11. Testing Strategy

### 11.1 Approach

| Tipo        | Herramienta             | Coverage Target                     | Qué se testea                                                      |
| ----------- | ----------------------- | ----------------------------------- | ------------------------------------------------------------------ |
| Unit        | Vitest                  | Alto (>80%) en `features/cash-flow` | Fórmulas de proyección — un error aquí es un error financiero real |
| Integration | Vitest + Supabase local | Media                               | Parsers de Excel/PDF contra fixtures reales (anonimizados)         |
| E2E         | Playwright              | Flujo crítico completo              | Login → Refresh → ver reporte actualizado                          |

### 11.2 Testing Commands

```bash
npm run test          # Vitest unit + integration
npm run test:e2e       # Playwright
```

### 11.3 E2E Flujos Críticos

1. Login con Microsoft → sesión activa → acceso a `/reporte`.
2. Click "Actualizar" con archivos de prueba disponibles → `report_snapshots` refleja `estado=ok`.
3. Simular archivo bloqueado (lock) → la UI muestra el error específico sin caerse el resto del refresh.

---

## 12. Consideraciones Futuras (Post-MVP)

| Feature/Mejora                                               | Impacto Técnico                                              | Fase Estimada                               |
| ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------- |
| Automatizar extracción de montos de PDFs de anticipos        | Requiere validación exhaustiva antes de confiar en el número | Fase 2                                      |
| Refresh automático nocturno                                  | Requiere permisos _application_ de Graph (aprobación IT)     | Fase 2                                      |
| Roles Finanzas/Gerencia con vistas diferenciadas             | RLS adicional + UI condicional                               | Fase 2, cuando se sume el segundo usuario   |
| Alertas por email si caja proyectada es insuficiente         | Integrar Resend + umbral configurable                        | Fase 2                                      |
| Modelo de estimación de dotación con ML real (no heurístico) | Requiere más historia acumulada de Buk primero               | Fase 3, tras 12+ meses de snapshots propios |

---

## 13. Gotchas y Auto-Blindaje

### Microsoft Graph / SharePoint

- Los archivos con `ReparsePoint` (OneDrive Files-on-Demand) SE PUEDEN leer normalmente vía Graph — no es necesario "descargarlos" primero como sí puede ser necesario en acceso a disco local.
- El link de "Pagos Mensuales" es un `sharingv2` link — para automatizar, mejor resolver el `driveId`+`itemId` reales una vez y guardarlos, en vez de re-resolver el link compartido en cada refresh.

### Excel parsing

- Las fórmulas de Excel tienen valor cacheado — `exceljs` puede leer el valor calculado sin re-evaluar la fórmula, pero si el archivo se abrió y no se recalculó, el valor cacheado puede estar desactualizado. Verificar `workbook.calcProperties.fullCalcOnLoad`.
- Los archivos pueden estar bloqueados (abiertos en Excel) — implementar reintento con backoff (ej. 3 intentos, 30s de separación) antes de fallar.

### Supabase RLS

- El uso de `service role key` en Server Actions BYPASSEA RLS por diseño — RLS aquí es defensa en profundidad para el caso de que algún código futuro use el cliente anon. No depender de RLS como único control de acceso.

---

## 14. Convenciones de Código

| Aspecto             | Convención                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Variables/Funciones | camelCase                                                                                  |
| Componentes         | PascalCase                                                                                 |
| Archivos/Carpetas   | kebab-case                                                                                 |
| Constantes          | UPPER_SNAKE_CASE                                                                           |
| Commits             | Conventional Commits                                                                       |
| Max file length     | 500 líneas (según hook de Forge)                                                           |
| TypeScript `any`    | NUNCA — usar `unknown` + Zod narrowing                                                     |
| Montos monetarios   | Siempre `NUMERIC(14,2)` en DB, nunca `float`/`number` sin redondeo en cálculos intermedios |

---

_Tech Spec generado con Claude — Ruta Herramienta Interna, La Herrería / Forge_
_Pendiente aprobación antes de avanzar a User Stories_
