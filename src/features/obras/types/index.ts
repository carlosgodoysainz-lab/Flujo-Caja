import { z } from "zod";

/**
 * Una fila cruda de la hoja "Plan de Obras" del Excel Gespro.
 * Ver TECH-SPEC-flujo-caja-nomina.md §7 y BLUEPRINT §Fase 3.
 */
export const ObraRawSchema = z.object({
  codigoGespro: z.string().trim().min(1).nullable(),
  nombre: z.string().trim().min(1),
  comuna: z.string().trim().nullable(),
  tipo: z.enum(["Retail", "DS19", "DS49", "Otro"]),
  cliente: z.enum(["Maestra", "Terceros"]),
  unidades: z.number().int().nonnegative().nullable(),
  inicioObra: z.date().nullable(),
  finObra: z.date().nullable(),
  durObraMeses: z.number().int().nonnegative().nullable(),
});

export type ObraRaw = z.infer<typeof ObraRawSchema>;

export interface GesproParseResult {
  obras: ObraRaw[];
  /** Filas descartadas por no pasar validación — nunca se insertan a medias (ver TECH-SPEC §5.3). */
  errores: { fila: number; motivo: string }[];
}
