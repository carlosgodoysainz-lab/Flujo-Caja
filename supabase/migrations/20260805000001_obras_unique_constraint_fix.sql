-- ============================================
-- FIX: obras.codigo_gespro necesita un UNIQUE constraint real, no un
-- índice único PARCIAL, para que funcione con `upsert(..., {onConflict})`
-- de Supabase/PostgREST.
--
-- Error real detectado al correr el seed contra la DB real:
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" (42P10) — PostgREST genera `ON CONFLICT (codigo_gespro)`
-- sin la cláusula WHERE, así que el índice parcial de la migración 001
-- no cuenta como arbiter válido.
--
-- Un UNIQUE constraint normal en Postgres SÍ permite múltiples NULL
-- (cada NULL se considera distinto), así que no se pierde la tolerancia
-- a codigo_gespro ausente que buscaba el índice parcial original.
-- ============================================

DROP INDEX IF EXISTS idx_obras_codigo_gespro;
ALTER TABLE obras ADD CONSTRAINT obras_codigo_gespro_key UNIQUE (codigo_gespro);
