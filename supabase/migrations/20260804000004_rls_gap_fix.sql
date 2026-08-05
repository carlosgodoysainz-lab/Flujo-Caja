-- ============================================
-- FIX DE SEGURIDAD (Fase 9 — auditoría): 6 tablas quedaron sin RLS
-- habilitado en la migración 001 (headcount_forecast_runs,
-- buk_cargo_catalog, buk_dotacion_snapshots, payroll_source_documents,
-- uf_series, report_snapshots).
--
-- Impacto real: NEXT_PUBLIC_SUPABASE_ANON_KEY es pública (va al bundle
-- del navegador). Sin RLS, cualquiera con esa key podría leer/escribir
-- estas tablas directo vía la API REST de Supabase, sin pasar por la app.
--
-- Fix: habilitar RLS SIN políticas permisivas — deny-all por defecto
-- para cualquier rol que no sea `service_role` (que es el único que
-- usa esta app, ver TECH-SPEC §6.4/§13). Coherente con el resto del
-- schema: la app nunca usa el cliente anon para leer/escribir datos.
-- ============================================

ALTER TABLE headcount_forecast_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE buk_cargo_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE buk_dotacion_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_source_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE uf_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_snapshots ENABLE ROW LEVEL SECURITY;
