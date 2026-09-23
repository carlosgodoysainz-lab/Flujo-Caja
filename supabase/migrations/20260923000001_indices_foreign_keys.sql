-- Índices para FKs sin índice dedicado (auditoría /temple 23-sep-2026,
-- dimensión Datos & RLS). Sin impacto funcional, solo performance — evita
-- full table scans en joins/deletes por estas columnas.
--
-- payroll_line_items.source_document_id es la más relevante: tiene
-- ON DELETE CASCADE, así que cada borrado de payroll_source_documents
-- hoy escanea toda payroll_line_items para encontrar las filas hijas.

create index if not exists idx_headcount_forecast_runs_obra_id
  on headcount_forecast_runs (obra_id);

create index if not exists idx_headcount_forecast_runs_ejecutado_por
  on headcount_forecast_runs (ejecutado_por);

create index if not exists idx_headcount_by_obra_forecast_run_id
  on headcount_by_obra (forecast_run_id);

create index if not exists idx_headcount_by_obra_created_by
  on headcount_by_obra (created_by);

create index if not exists idx_buk_dotacion_snapshots_obra_id
  on buk_dotacion_snapshots (obra_id);

create index if not exists idx_buk_dotacion_snapshots_cargo_id
  on buk_dotacion_snapshots (cargo_id);

create index if not exists idx_payroll_source_documents_ingested_by
  on payroll_source_documents (ingested_by);

create index if not exists idx_payroll_line_items_source_document_id
  on payroll_line_items (source_document_id);

create index if not exists idx_payroll_line_items_obra_id
  on payroll_line_items (obra_id);

create index if not exists idx_cash_flow_monthly_overridden_by
  on cash_flow_monthly (overridden_by);

create index if not exists idx_report_snapshots_generated_by
  on report_snapshots (generated_by);

create index if not exists idx_audit_log_actor_id
  on audit_log (actor_id);
