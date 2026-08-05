-- ============================================
-- Bucket: report-exports (Fase 8 — export HTML autocontenido)
-- Ver TECH-SPEC §4.3
-- ============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('report-exports', 'report-exports', false)
ON CONFLICT (id) DO NOTHING;

-- Solo el service role (usado por Server Actions) sube/lee — sin policies
-- públicas. RLS de Storage ya viene habilitado por defecto en Supabase.
