-- ============================================
-- Cotizacion real desde el comprobante oficial de pago de Previred
-- (carpeta SharePoint "Pagos Mensuales/imposiciones/imposiciones <mes>
-- <año>/", archivos "comprobante previred <Empresa> <RG|RP>.pdf") —
-- pedido explicito del usuario 17-ago-2026, tras confirmar que SI
-- existe una fuente real para este concepto (antes: "Cotizaciones
-- siempre son formula, no existe fuente real automatizada").
--
-- El comprobante trae el TOTAL GENERAL ya calculado y confirmado por
-- Previred (no se parsea el layout crudo de ~70 columnas por
-- trabajador, que requeriria adivinar que campo exacto suma "cotizacion"
-- -- riesgo real para un dato financiero). Se agrega 'cotizacion' al
-- CHECK de payroll_line_items, que hoy solo permitia
-- anticipo_rg/rp, remuneracion_rg/rp, reliquidacion, finiquito.
-- ============================================

ALTER TABLE payroll_line_items DROP CONSTRAINT IF EXISTS payroll_line_items_concepto_check;
ALTER TABLE payroll_line_items ADD CONSTRAINT payroll_line_items_concepto_check
  CHECK (concepto IN (
    'anticipo_rg', 'anticipo_rp', 'remuneracion_rg', 'remuneracion_rp',
    'reliquidacion', 'finiquito', 'cotizacion'
  ));

ALTER TABLE payroll_source_documents DROP CONSTRAINT IF EXISTS payroll_source_documents_tipo_check;
ALTER TABLE payroll_source_documents ADD CONSTRAINT payroll_source_documents_tipo_check
  CHECK (tipo IN ('anticipo', 'remuneracion', 'reliquidacion', 'finiquito', 'cotizacion'));
