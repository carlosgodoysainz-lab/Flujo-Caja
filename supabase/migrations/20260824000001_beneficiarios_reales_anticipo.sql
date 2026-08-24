-- Beneficiarios REALES de Anticipo (personas, no divisiones) — pedido
-- explícito del usuario 24-ago-2026: "la cantidad de personas son
-- muchos más... revisa el detalle en la carpeta donde está el banco y
-- corriges por la cantidad de beneficiarios".
--
-- payroll_line_items es grano de (sociedad, división/obra) — NO de
-- persona (ver Auto-Blindaje 21-ago-2026) — así que su conteo de filas
-- nunca dio el N° real de gente que cobró Anticipo. El archivo
-- "<Sociedad>-Anticipo-<Mes> '<yy>-Transferencia Bancaria.txt" (carpeta
-- "Pagos Mensuales/anticipos/anticipo <mes> <año>/RG|RP/") SÍ es grano
-- de persona (1 línea = 1 beneficiario, formato de ancho fijo de banco)
-- — se cuenta el N° de líneas válidas, SIN extraer ni persistir RUT ni
-- nombre (ver sync-beneficiarios-anticipo.ts).
CREATE TABLE payroll_beneficiarios_reales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo DATE NOT NULL,
  concepto TEXT NOT NULL CHECK (concepto IN ('anticipo_rg', 'anticipo_rp')),
  cantidad INTEGER NOT NULL CHECK (cantidad >= 0),
  archivos_contados INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (periodo, concepto)
);
CREATE INDEX idx_payroll_beneficiarios_periodo ON payroll_beneficiarios_reales(periodo, concepto);
ALTER TABLE payroll_beneficiarios_reales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuarios autenticados leen beneficiarios reales" ON payroll_beneficiarios_reales FOR SELECT
  USING (auth.uid() IS NOT NULL);
COMMENT ON TABLE payroll_beneficiarios_reales IS 'N° real de personas (contado, nunca RUT/nombre) por concepto/período, desde archivos de transferencia bancaria — distinto de payroll_line_items, que es grano de sociedad/división.';
