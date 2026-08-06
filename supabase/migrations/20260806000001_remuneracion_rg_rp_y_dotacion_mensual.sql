-- ============================================
-- Aperturar Remuneración en RG/RP (como en el Excel real) + tabla de
-- dotación mensual de la compañía (real histórica desde el Excel maestro
-- de Flujo de Caja, o desde snapshots de Buk cuando el Excel todavía no
-- cubre el mes) — pedido explícito del usuario tras revisar el Excel.
-- ============================================

-- `cash_flow_monthly.concepto` solo permitía 'remuneracion' (combinado).
-- Se agregan 'remuneracion_rg'/'remuneracion_rp' para poder mostrar el
-- desglose real (el Excel histórico y las Solicitudes de Requerimiento
-- de SharePoint SÍ separan RG/RP) — 'remuneracion' se mantiene como el
-- total (RG+RP), sigue siendo lo que usa el modelo costo-por-cabeza.
ALTER TABLE cash_flow_monthly DROP CONSTRAINT IF EXISTS cash_flow_monthly_concepto_check;
ALTER TABLE cash_flow_monthly ADD CONSTRAINT cash_flow_monthly_concepto_check
  CHECK (concepto IN (
    'anticipo', 'remuneracion', 'remuneracion_rg', 'remuneracion_rp',
    'finiquito', 'reliquidacion', 'cotizacion', 'sence', 'total_nomina'
  ));

-- ============================================
-- Tabla: dotacion_mensual
-- ============================================
CREATE TABLE dotacion_mensual (
  periodo DATE PRIMARY KEY,
  rg INT,
  rp INT,
  total INT NOT NULL,
  origen TEXT NOT NULL CHECK (origen IN ('excel_historico', 'buk_real')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
ALTER TABLE dotacion_mensual ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuarios autenticados leen dotacion mensual" ON dotacion_mensual FOR SELECT
  USING (auth.uid() IS NOT NULL);
COMMENT ON TABLE dotacion_mensual IS 'Dotación TOTAL de la compañía por mes (RG/RP separado) — real, desde la columna "N°" del Excel histórico de Flujo de Caja (fuente más completa, cubre Nov-2022 en adelante) o desde buk_dotacion_snapshots para meses que el Excel todavía no cierra. Alimenta el modelo costo-por-cabeza de Remuneración (ver dotacion-total.ts) y la fila "Dotación" de la tabla de detalle. Distinta de `headcount_by_obra` (por obra, no total compañía) y de `buk_dotacion_snapshots` (snapshot crudo por cargo/obra).';
