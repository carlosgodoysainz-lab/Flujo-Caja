import { z } from "zod";

/**
 * Concepto financiero de una línea de "Solicitud de Requerimiento"
 * (remuneración/reliquidación/finiquito). Deliberadamente SIN RUT ni
 * nombre de persona — confirmado contra archivos reales que esta fuente
 * es agregada por sociedad/división, nunca a nivel de persona (ver
 * TECH-SPEC §2.2).
 *
 * "retencion_judicial" se descubrió en los archivos reales (no estaba en
 * el modelo original del Excel Detalle) — por ahora se pliega dentro del
 * bucket de remuneración del mismo archivo (ver clasificarConcepto), no
 * se modela como categoría propia en cash_flow_monthly todavía. Revisar
 * con el usuario si алguna vez se necesita reportarla separada.
 */
export const PayrollConceptoSchema = z.enum([
  "remuneracion_rg",
  "remuneracion_rp",
  "reliquidacion",
  "finiquito",
]);
export type PayrollConcepto = z.infer<typeof PayrollConceptoSchema>;

export const PayrollLineItemRawSchema = z.object({
  periodo: z.date(),
  concepto: PayrollConceptoSchema,
  sociedad: z.string().trim().min(1),
  /** Texto libre de la columna "Division" — puede contener el nombre de una obra ("Obra Lira I"). */
  division: z.string().trim().nullable(),
  monto: z.number(),
});
export type PayrollLineItemRaw = z.infer<typeof PayrollLineItemRawSchema>;

export interface SolicitudRequerimientoParseResult {
  lineItems: PayrollLineItemRaw[];
  errores: { hoja: string; fila: number; motivo: string }[];
}
