-- ============================================
-- Distingue "0 confirmado" de "0 porque no habia ninguna obra de
-- referencia con dato ese mes de avance" en headcount_by_obra.origen.
--
-- Hallazgo real (auditoria de dotacion, 13-ago-2026): de las 254 filas
-- estimadas por el modelo de curva, 91% tenian variacion_neta=0 -- casi
-- todas por falta de obras de referencia con historico real de Buk (el
-- cron de snapshots recien corrio 1 vez), no porque el modelo haya
-- confirmado "sin cambios". Sin esta distincion, un 0 por falta de dato
-- se ve identico a un 0 real en la tabla de detalle y en el Excel --
-- silenciosamente subestima el flujo de dotacion.
-- ============================================

ALTER TABLE headcount_by_obra DROP CONSTRAINT IF EXISTS headcount_by_obra_origen_check;
ALTER TABLE headcount_by_obra ADD CONSTRAINT headcount_by_obra_origen_check
  CHECK (origen IN ('manual', 'buk_real', 'modelo_estimado', 'sin_dato_referencia'));
