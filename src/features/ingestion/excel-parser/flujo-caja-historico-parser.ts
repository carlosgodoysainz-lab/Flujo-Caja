import ExcelJS from "exceljs";

/**
 * Parser de la hoja "Detalle" del Excel MAESTRO de Flujo de Caja (carpeta
 * "Flujo de Caja" en SharePoint) — la fuente histórica autoritativa que
 * Finanzas mantiene cerrada mes a mes. Confirmado contra el archivo real
 * más reciente (`Flujo_Caja_23_06_26.xlsx`, ver
 * `scripts/inspect-flujo-caja-historico.ts`):
 *
 * - Columnas AGRUPADAS de a 2 por mes: valor ($) y "N°" (cantidad), desde
 *   noviembre 2022 (columna C) en adelante, cíclicas cada 12 meses.
 * - Filas fijas: 5=Anticipo RG, 6=Anticipo RP, 8=Remuneraciones RG (N°=
 *   dotación RG real), 9=Remuneraciones RP (N°=dotación RP real),
 *   10=Finiquitos, 11=Reliquidaciones, 12=Cotizaciones, 13=Aporte SENCE.
 *   Filas 4/7/14 (Anticipo/Remuneraciones/Total Nómina) son sumas de las
 *   anteriores — no se importan directo, se derivan en el sync.
 * - Real vs. proyectado: NO por fórmula (hay meses "reales" con fórmulas
 *   simples de arrastre) sino por COLOR DE RELLENO — amarillo
 *   (`FFFFFF00`) = proyección, confirmado el mismo criterio documentado
 *   desde el hallazgo original del Excel. Solo se importan celdas NO
 *   amarillas — nunca se inventa un valor "real" de una celda proyectada.
 */

export type FlujoCajaHistoricoConcepto =
  | "anticipo_rg"
  | "anticipo_rp"
  | "remuneracion_rg"
  | "remuneracion_rp"
  | "finiquito"
  | "reliquidacion"
  | "cotizacion"
  | "sence";

export interface FlujoCajaHistoricoLinea {
  periodo: Date;
  concepto: FlujoCajaHistoricoConcepto;
  monto: number;
}

export interface DotacionHistoricaPunto {
  periodo: Date;
  rg: number | null;
  rp: number | null;
}

export interface FlujoCajaHistoricoParseResult {
  lineas: FlujoCajaHistoricoLinea[];
  dotacion: DotacionHistoricaPunto[];
  errores: string[];
}

/** Nov-2022 = k0 — constante derivada y verificada contra el archivo real (ver script de inspección). */
const BASE_TOTAL_MES = 2022 * 12 + 11;
const AMARILLO_PROYECCION = "FFFFFF00";

/** k (0 = nov-2022) → número de columna 1-indexado (A=1) de la celda de VALOR de ese mes. La celda "N°" vecina es col+1. */
function columnaValor(k: number): number {
  return 3 + 2 * k;
}

function kAPeriodo(k: number): Date {
  const totalMes = BASE_TOTAL_MES + k;
  const year = Math.floor((totalMes - 1) / 12);
  const month = totalMes - year * 12; // 1-12
  return new Date(year, month - 1, 1);
}

interface FilaSpec {
  concepto: FlujoCajaHistoricoConcepto;
  /** Si esta fila también trae dotación real en su columna "N°" vecina. */
  dotacion?: "rg" | "rp";
}

const FILAS: Record<number, FilaSpec> = {
  5: { concepto: "anticipo_rg" },
  6: { concepto: "anticipo_rp" },
  8: { concepto: "remuneracion_rg", dotacion: "rg" },
  9: { concepto: "remuneracion_rp", dotacion: "rp" },
  10: { concepto: "finiquito" },
  11: { concepto: "reliquidacion" },
  12: { concepto: "cotizacion" },
  13: { concepto: "sence" },
};

function esCeldaProyectada(cell: ExcelJS.Cell): boolean {
  const fill = cell.fill as ExcelJS.FillPattern | undefined;
  const argb =
    fill?.type === "pattern"
      ? (fill.fgColor as { argb?: string } | undefined)?.argb
      : undefined;
  return argb === AMARILLO_PROYECCION;
}

function valorNumerico(cell: ExcelJS.Cell): number | null {
  const raw = cell.value;
  if (raw && typeof raw === "object" && "result" in raw) {
    const resultado = (raw as { result: unknown }).result;
    return typeof resultado === "number" ? resultado : null;
  }
  return typeof raw === "number" ? raw : null;
}

export async function parseFlujoCajaHistorico(
  buffer: Buffer | ArrayBuffer,
): Promise<FlujoCajaHistoricoParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as ExcelJS.Buffer);
  const detalle = workbook.getWorksheet("Detalle");

  const errores: string[] = [];
  const lineas: FlujoCajaHistoricoLinea[] = [];
  const dotacionPorPeriodo = new Map<string, DotacionHistoricaPunto>();

  if (!detalle) {
    errores.push('No se encontró la hoja "Detalle" en el archivo.');
    return { lineas, dotacion: [], errores };
  }

  const FILA_HEADER_MESES = 3;
  // Tope defensivo — nunca debería haber más de ~360 meses (30 años) de columnas.
  for (let k = 0, guard = 0; guard < 360; k++, guard++) {
    const col = columnaValor(k);
    const headerCell = detalle.getCell(FILA_HEADER_MESES, col);
    if (!headerCell.value) break; // fin de las columnas con datos

    const periodo = kAPeriodo(k);

    for (const [filaStr, spec] of Object.entries(FILAS)) {
      const fila = Number(filaStr);
      const cell = detalle.getCell(fila, col);

      // El color de relleno se chequea POR CELDA, no una vez para el par
      // valor/N° — en la práctica van sincronizados, pero no hay que
      // depender de eso (defensivo, ver test "no importa si la celda de
      // dotación quedó amarilla aunque el valor no lo estuviera").
      if (!esCeldaProyectada(cell)) {
        const monto = valorNumerico(cell);
        if (monto != null) {
          lineas.push({ periodo, concepto: spec.concepto, monto });
        }
      }

      if (spec.dotacion) {
        const celdaHeadcount = detalle.getCell(fila, col + 1);
        if (esCeldaProyectada(celdaHeadcount)) continue;
        const headcount = valorNumerico(celdaHeadcount);
        if (headcount != null) {
          const key = periodo.toISOString().slice(0, 10);
          const existente = dotacionPorPeriodo.get(key) ?? {
            periodo,
            rg: null,
            rp: null,
          };
          if (spec.dotacion === "rg") existente.rg = headcount;
          else existente.rp = headcount;
          dotacionPorPeriodo.set(key, existente);
        }
      }
    }
  }

  return { lineas, dotacion: [...dotacionPorPeriodo.values()], errores };
}
