import { z } from "zod";

/**
 * Conceptos que un humano puede sobreescribir a mano — el mismo CHECK
 * constraint de `cash_flow_monthly.concepto` en la DB permite además
 * `'total_nomina'`, pero ESE nunca debe ser overrideable: es siempre la
 * suma calculada de los otros 6 (ver `CONCEPTOS_CALCULADOS` en
 * refresh.ts) — si se le pisara con `manual_override`,
 * `METODOS_PRESERVADOS` haría que refresh.ts lo deje congelado para
 * siempre en vez de recalcularlo. Hallazgo real de la auditoría /temple
 * 18-ago-2026: el schema anterior (inexistente) no restringía esto.
 *
 * Separado de `override.ts` (que es "use server") porque un archivo
 * "use server" solo puede exportar funciones async — un `const` schema
 * no puede vivir ahí y seguir siendo testeable con Vitest.
 */
export const CONCEPTOS_OVERRIDEABLES = [
  "anticipo",
  "remuneracion",
  "finiquito",
  "reliquidacion",
  "cotizacion",
  "sence",
] as const;

export const overrideSchema = z.object({
  periodo: z.date(),
  concepto: z.enum(CONCEPTOS_OVERRIDEABLES),
  // finite() rechaza NaN/Infinity — antes no había NINGUNA validación de
  // servidor sobre `monto` (el chequeo de NaN vivía solo en el cliente,
  // evitable llamando la Server Action directamente).
  monto: z.number().finite(),
});
