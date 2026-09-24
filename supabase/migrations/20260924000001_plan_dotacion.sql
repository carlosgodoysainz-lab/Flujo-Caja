-- ============================================
-- Plan de Dotacion en SharePoint (Fase 2 del plan de correccion
-- estructural, 24-sep-2026) -- reemplaza al modelo estadistico de
-- "obras similares" (headcount_by_obra.origen='modelo_estimado') como
-- fuente de la dotacion FUTURA: el usuario compara la app contra su
-- Excel tradicional y confirma que su propio plan obra por obra es la
-- unica fuente confiable -- el modelo estadistico llevaba 7 versiones
-- de parches sobre el mismo sintoma (ver Auto-Blindaje).
--
-- El usuario mantiene un archivo "Plan Dotacion Obras.xlsx" en
-- SharePoint (carpeta "Flujo de Caja/Plan Dotacion"), con 2 hojas:
--   - "Plan": obra x mes, variacion neta (altas-bajas)
--   - "Eventos": extraordinarios (bono termino de obra, montos puntuales)
--     que hoy estan digitados a mano dentro de formulas del Excel
--     tradicional, sin etiqueta.
-- ============================================

CREATE TABLE IF NOT EXISTS plan_dotacion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = fila de Oficina Central (no es una obra real, ver `unidad`).
  obra_id UUID REFERENCES obras(id) ON DELETE CASCADE,
  unidad TEXT NOT NULL CHECK (unidad IN ('obra', 'oficina_central')),
  periodo DATE NOT NULL,
  variacion_neta INT NOT NULL,
  fuente_archivo TEXT,
  fuente_modificado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  -- Una fila de obra siempre tiene obra_id; una de oficina_central nunca.
  CHECK (
    (unidad = 'obra' AND obra_id IS NOT NULL) OR
    (unidad = 'oficina_central' AND obra_id IS NULL)
  ),
  UNIQUE (unidad, obra_id, periodo)
);

-- Unicidad parcial para la fila de Oficina Central (obra_id NULL no
-- colisiona con el UNIQUE de arriba en Postgres -- NULL != NULL). Sin
-- esto, el refresh podria insertar mas de una fila 'oficina_central' por
-- periodo.
CREATE UNIQUE INDEX IF NOT EXISTS plan_dotacion_oficina_central_periodo_key
  ON plan_dotacion (periodo) WHERE unidad = 'oficina_central';

CREATE INDEX IF NOT EXISTS idx_plan_dotacion_obra_id ON plan_dotacion (obra_id);
CREATE INDEX IF NOT EXISTS idx_plan_dotacion_periodo ON plan_dotacion (periodo);

ALTER TABLE plan_dotacion ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE plan_dotacion IS 'Plan de dotacion del usuario (obra x mes, variacion neta), leido desde "Plan Dotacion Obras.xlsx" en SharePoint. Fuente UNICA de la dotacion FUTURA -- reemplaza al modelo estadistico de headcount_by_obra.origen=modelo_estimado (Fase 2, 24-sep-2026). Los meses ya reales (Buk/dotacion_mensual) siempre ganan por sobre el plan.';

-- ============================================
-- Extraordinarios (bono de termino de obra, montos puntuales) -- hoy
-- estan digitados a mano DENTRO de formulas del Excel tradicional, sin
-- etiqueta ni auditoria (ver Auto-Blindaje, disecciones del 23-sep-2026).
-- ============================================

CREATE TABLE IF NOT EXISTS plan_eventos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo DATE NOT NULL,
  concepto TEXT NOT NULL CHECK (concepto IN ('remuneracion', 'anticipo')),
  modo TEXT NOT NULL CHECK (modo IN ('monto_total', 'por_persona')),
  monto NUMERIC(14, 2) NOT NULL,
  -- Solo relevante si modo='por_persona': por que poblacion/obra se
  -- multiplica el monto. obra_id NULL = aplica a toda la compania.
  obra_id UUID REFERENCES obras(id) ON DELETE CASCADE,
  poblacion TEXT CHECK (poblacion IN ('rg', 'rp')),
  descripcion TEXT,
  fuente_archivo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plan_eventos_periodo ON plan_eventos (periodo);

ALTER TABLE plan_eventos ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE plan_eventos IS 'Extraordinarios del Plan de Dotacion (hoja "Eventos" del Excel del usuario) -- bono de termino de obra, montos puntuales. Se suman al concepto indicado (remuneracion/anticipo) del periodo, monto fijo o por persona x dotacion proyectada.';

-- ============================================
-- Bitacora de lecturas del Plan de Dotacion -- para que /dotacion pueda
-- mostrar "archivo leido y fecha" + errores de validacion sin volver a
-- parsear el archivo.
-- ============================================

CREATE TABLE IF NOT EXISTS plan_dotacion_lecturas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fuente_archivo TEXT NOT NULL,
  fuente_modificado_at TIMESTAMPTZ,
  leido_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  filas_plan INT NOT NULL DEFAULT 0,
  filas_eventos INT NOT NULL DEFAULT 0,
  errores JSONB,
  advertencias JSONB
);

ALTER TABLE plan_dotacion_lecturas ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE plan_dotacion_lecturas IS 'Log de cada lectura del Plan de Dotacion desde SharePoint -- para mostrar en /dotacion que archivo se leyo, cuando, y que errores/advertencias de validacion tuvo, sin volver a parsear el archivo.';

-- Las 3 tablas quedan con RLS habilitado y SIN policies (deny-all) --
-- mismo criterio que el resto del proyecto (ver `20260804000004_rls_gap_fix.sql`
-- y el comentario en `src/lib/supabase/service.ts`): el control de acceso
-- real pasa por la sesion de NextAuth verificada server-side antes de
-- invocar `createServiceClient()` (que usa la service_role key y
-- bypassa RLS), no por policies de Supabase Auth (que este proyecto no
-- usa -- ver `20260804000002_profiles_nextauth_fix.sql`).
