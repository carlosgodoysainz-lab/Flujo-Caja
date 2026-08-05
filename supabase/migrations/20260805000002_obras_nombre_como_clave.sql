-- ============================================
-- FIX: usar `nombre` como clave natural de `obras`, no `codigo_gespro`.
--
-- Confirmado contra el archivo real (20260803 Plan de Obras Nuevo
-- Gespro.xlsx): de 33 obras, los "Cod" (codigo_gespro) tienen 5 obras
-- distintas compartiendo "P097", 3 compartiendo "P111", 2 compartiendo
-- "P127", y 7 obras sin código — es un problema de calidad de datos en
-- el propio Gespro, no algo que podamos arreglar desde este lado. Los
-- NOMBRES, en cambio, son 100% únicos (33 de 33).
--
-- Esto causaba un error real al hacer upsert: "ON CONFLICT DO UPDATE
-- command cannot affect row a second time" (Postgres 21000) cuando el
-- mismo batch intentaba actualizar la misma fila (mismo codigo_gespro)
-- más de una vez.
-- ============================================

ALTER TABLE obras DROP CONSTRAINT IF EXISTS obras_codigo_gespro_key;
ALTER TABLE obras ADD CONSTRAINT obras_nombre_key UNIQUE (nombre);

COMMENT ON COLUMN obras.codigo_gespro IS 'Código informativo de Gespro — NO es único (confirmado: se repite en el archivo real). La clave real de esta tabla es `nombre`.';
