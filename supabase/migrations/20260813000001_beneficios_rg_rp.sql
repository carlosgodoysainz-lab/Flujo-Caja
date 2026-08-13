-- ============================================
-- Beneficios/Bonos RG (Convenio Colectivo Lira Parque, sindicalizado Rol
-- General) y RP (Anexo Oficina Central, no sindicalizado) en el flujo de
-- caja. Consolidado e idempotente (todo IF EXISTS / IF NOT EXISTS) —
-- mismo criterio que 20260806000003_consolidado_idempotente.sql, porque
-- el SQL Editor de Supabase ya demostro deshacer migraciones parciales a
-- mitad de camino si un statement falla.
-- ============================================

ALTER TABLE cash_flow_monthly DROP CONSTRAINT IF EXISTS cash_flow_monthly_concepto_check;
ALTER TABLE cash_flow_monthly ADD CONSTRAINT cash_flow_monthly_concepto_check
  CHECK (concepto IN (
    'anticipo', 'anticipo_rg', 'anticipo_rp',
    'remuneracion', 'remuneracion_rg', 'remuneracion_rp',
    'finiquito', 'reliquidacion', 'cotizacion', 'sence',
    'beneficios', 'beneficios_rg', 'beneficios_rp',
    'total_nomina'
  ));

-- Detalle por evento/poblacion — permite auditar y (si hace falta)
-- corregir el Bono Termino de Negociacion o el Aporte Sindical por
-- separado sin pisarse con los demas eventos del mismo mes. Montos
-- SIEMPRE agregados por poblacion (rg/rp), NUNCA por persona/RUT.
CREATE TABLE IF NOT EXISTS beneficios_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo DATE NOT NULL,
  poblacion TEXT NOT NULL CHECK (poblacion IN ('rg', 'rp')),
  tipo_evento TEXT NOT NULL CHECK (tipo_evento IN (
    'aguinaldo_fiestas_patrias', 'aguinaldo_navidad',
    'bono_termino_negociacion', 'aporte_sindical_unico', 'aporte_sindical_mensual',
    'asignacion_escolar',
    'bono_vacaciones', 'bono_natalidad', 'bono_matrimonio', 'bono_fallecimiento', 'bono_tijerales',
    'gift_card_higiene_seguridad'
  )),
  monto NUMERIC(14, 2) NOT NULL,
  es_real BOOLEAN NOT NULL DEFAULT FALSE,
  metodo_calculo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (periodo, poblacion, tipo_evento)
);

ALTER TABLE beneficios_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuarios autenticados leen beneficios" ON beneficios_line_items;
CREATE POLICY "Usuarios autenticados leen beneficios" ON beneficios_line_items FOR SELECT
  USING (auth.uid() IS NOT NULL);

COMMENT ON TABLE beneficios_line_items IS 'Detalle por evento y poblacion (rg/rp) de bonos y beneficios del Convenio Colectivo Lira Parque (RG) y el Anexo Beneficio Oficina Central (RP). Alimenta cash_flow_monthly.beneficios / beneficios_rg / beneficios_rp. Montos agregados por poblacion, nunca por persona/RUT.';

-- Verificacion rapida (opcional, no falla nada):
-- SELECT 'beneficios_line_items existe' WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'beneficios_line_items');
