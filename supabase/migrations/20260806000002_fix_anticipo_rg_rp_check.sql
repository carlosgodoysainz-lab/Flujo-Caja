-- ============================================
-- FIX: la migración anterior (20260806000001) agregó 'remuneracion_rg'/
-- 'remuneracion_rp' al constraint de `cash_flow_monthly.concepto' pero
-- se olvidó de 'anticipo_rg'/'anticipo_rp' — el código YA los escribe
-- (refresh.ts y sync-flujo-caja-historico.ts) desde esa misma sesión.
--
-- Error real confirmado en producción: CADA upsert de "Actualizar
-- reporte" fallaba con
--   new row for relation "cash_flow_monthly" violates check constraint
--   "cash_flow_monthly_concepto_check"
-- porque el desglose de Anticipo en RG/RP nunca estuvo permitido.
-- ============================================

ALTER TABLE cash_flow_monthly DROP CONSTRAINT IF EXISTS cash_flow_monthly_concepto_check;
ALTER TABLE cash_flow_monthly ADD CONSTRAINT cash_flow_monthly_concepto_check
  CHECK (concepto IN (
    'anticipo', 'anticipo_rg', 'anticipo_rp',
    'remuneracion', 'remuneracion_rg', 'remuneracion_rp',
    'finiquito', 'reliquidacion', 'cotizacion', 'sence', 'total_nomina'
  ));
