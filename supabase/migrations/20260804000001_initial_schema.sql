-- ============================================
-- Flujo de Caja Nómina — Schema inicial
-- Fuente: TECH-SPEC-flujo-caja-nomina.md §4.2
-- Nota: orden de creación corregido respecto al Tech Spec para resolver
-- dependencias hacia adelante (headcount_forecast_runs debe existir antes
-- que headcount_by_obra, que la referencia).
-- ============================================

-- ============================================
-- Tabla: profiles
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
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuarios ven su propio perfil" ON profiles FOR SELECT
  USING (auth.uid() = id);

-- ============================================
-- Tabla: obras
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
  fuente_archivo TEXT,
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
-- Tabla: headcount_forecast_runs
-- (creada ANTES de headcount_by_obra porque esta la referencia)
-- ============================================
CREATE TABLE headcount_forecast_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id UUID NOT NULL REFERENCES obras(id),
  metodo TEXT NOT NULL,
  obras_referencia UUID[] NOT NULL,
  parametros JSONB,
  ejecutado_por UUID REFERENCES profiles(id),
  ejecutado_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
COMMENT ON TABLE headcount_forecast_runs IS 'Bitácora de cada estimación automática de dotación — qué método y qué obras de referencia se usaron.';

-- ============================================
-- Tabla: headcount_by_obra
-- ============================================
CREATE TABLE headcount_by_obra (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  periodo DATE NOT NULL,
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
-- Tabla: buk_cargo_catalog
-- ============================================
CREATE TABLE buk_cargo_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_buk TEXT NOT NULL UNIQUE,
  familia_cargo TEXT,
  categoria TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
COMMENT ON TABLE buk_cargo_catalog IS 'Normaliza los nombres de cargo de Buk (texto libre) a categorías reutilizables por el modelo.';

-- ============================================
-- Tabla: buk_dotacion_snapshots
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
-- ============================================
CREATE TABLE payroll_source_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT NOT NULL CHECK (tipo IN ('anticipo', 'remuneracion', 'reliquidacion', 'finiquito')),
  periodo DATE NOT NULL,
  nombre_archivo TEXT NOT NULL,
  graph_item_id TEXT,
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
-- ============================================
CREATE TABLE cash_flow_monthly (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo DATE NOT NULL,
  concepto TEXT NOT NULL CHECK (concepto IN ('anticipo', 'remuneracion', 'finiquito', 'reliquidacion', 'cotizacion', 'sence', 'total_nomina')),
  monto NUMERIC(14, 2) NOT NULL,
  es_real BOOLEAN NOT NULL DEFAULT FALSE,
  metodo_calculo TEXT,
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
-- ============================================
CREATE TABLE report_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_by UUID NOT NULL REFERENCES profiles(id),
  generated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  periodo_desde DATE NOT NULL,
  periodo_hasta DATE NOT NULL,
  estado TEXT NOT NULL DEFAULT 'ok' CHECK (estado IN ('ok', 'parcial', 'error')),
  detalle_errores JSONB,
  export_storage_path TEXT,
  exported_at TIMESTAMPTZ
);
COMMENT ON TABLE report_snapshots IS 'Un registro por cada refresh y por cada export HTML (descargable/adjuntable por correo) generado a partir de ese refresh.';

-- ============================================
-- Tabla: audit_log
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

-- audit_log es solo INSERT — nadie puede editar/borrar el rastro de auditoría
CREATE POLICY "Insertar audit log" ON audit_log FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- ============================================
-- Trigger: crear profile automáticamente al primer login (NextAuth + Supabase)
-- ============================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), 'admin')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
