-- ============================================
-- FIX consolidado e IDEMPOTENTE — reemplaza en la práctica a
-- 20260806000001 y 20260806000002. Se creó porque, tras 2 intentos de
-- migración manual, la tabla `dotacion_mensual` seguía sin existir Y el
-- constraint de `concepto` seguía sin aceptar 'anticipo_rg' — lo más
-- probable es que el SQL Editor de Supabase corrió todo en una sola
-- transacción implícita y, al fallar un statement, deshizo los
-- anteriores también. Cada paso de este script es seguro de re-ejecutar
-- cuantas veces sea necesario (usa IF EXISTS / IF NOT EXISTS en todo),
-- así que no importa en qué estado haya quedado la base — correr esto
-- una vez la deja en el estado correcto.
-- ============================================

ALTER TABLE cash_flow_monthly DROP CONSTRAINT IF EXISTS cash_flow_monthly_concepto_check;
ALTER TABLE cash_flow_monthly ADD CONSTRAINT cash_flow_monthly_concepto_check
  CHECK (concepto IN (
    'anticipo', 'anticipo_rg', 'anticipo_rp',
    'remuneracion', 'remuneracion_rg', 'remuneracion_rp',
    'finiquito', 'reliquidacion', 'cotizacion', 'sence', 'total_nomina'
  ));

CREATE TABLE IF NOT EXISTS dotacion_mensual (
  periodo DATE PRIMARY KEY,
  rg INT,
  rp INT,
  total INT NOT NULL,
  origen TEXT NOT NULL CHECK (origen IN ('excel_historico', 'buk_real')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE dotacion_mensual ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuarios autenticados leen dotacion mensual" ON dotacion_mensual;
CREATE POLICY "Usuarios autenticados leen dotacion mensual" ON dotacion_mensual FOR SELECT
  USING (auth.uid() IS NOT NULL);

COMMENT ON TABLE dotacion_mensual IS 'Dotacion TOTAL de la compania por mes (RG/RP separado) - real, desde la columna N de dotacion del Excel historico de Flujo de Caja (fuente mas completa, cubre Nov-2022 en adelante) o desde buk_dotacion_snapshots para meses que el Excel todavia no cierra. Alimenta el modelo costo-por-cabeza de Remuneracion y la fila Dotacion de la tabla de detalle.';

-- Verificación rápida (opcional, no falla nada): debería devolver 2 filas.
-- SELECT 'cash_flow_monthly_concepto_check aplicado' AS check_1
-- UNION ALL
-- SELECT 'dotacion_mensual existe'
-- WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dotacion_mensual');
