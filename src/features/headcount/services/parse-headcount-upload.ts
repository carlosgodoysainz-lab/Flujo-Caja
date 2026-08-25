import ExcelJS from "exceljs";
import { z } from "zod";

/**
 * Parser del Excel "Proyección Headcount" RE-SUBIDO por el usuario — carga
 * manual de dotación por obra (pedido explícito del usuario 25-ago-2026,
 * en vez de un formulario campo-por-campo: "sube el mismo Excel que ya
 * descargas, edita los números que necesites, vuelve a subirlo"). Mismo
 * patrón que `obras/services/gespro-parser.ts` (ExcelJS + Zod + array de
 * errores, sin inserción parcial de una CELDA inválida) — a diferencia de
 * Gespro (fila = 1 obra con múltiples campos obligatorios), acá cada
 * CELDA de mes es independiente: una celda inválida se reporta y se omite
 * sin bloquear las demás celdas válidas de la misma obra.
 */

const SHEET_NAME = "Proyección Headcount";
const COL_OBRA_ID = "Obra ID";
const COL_OBRA = "Obra";
// Filas especiales de la hoja que NO son obras — ver render-excel.ts.
const FILAS_EXCLUIDAS = new Set(["Oficina Central", "Total"]);

// Mismo formato que `etiquetaPeriodoCorta` en render-excel.ts (ej.
// "may-26") — duplicado deliberadamente en vez de importar entre
// features (report-export ↔ headcount), Feature-First: cada feature es
// autocontenida. Si ese formato cambia, actualizar ambos lados.
const MESES_CORTOS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

/** "may-26" → "2026-05-01". `null` si no matchea el formato esperado. */
function periodoDesdeEtiquetaCorta(etiqueta: string): string | null {
  const match = /^([a-z]{3})-(\d{2})$/.exec(etiqueta.trim().toLowerCase());
  if (!match) return null;
  const [, mesTxt, anioTxt] = match;
  const mesIndex = MESES_CORTOS.indexOf(
    mesTxt as (typeof MESES_CORTOS)[number],
  );
  if (mesIndex === -1) return null;
  const anio = 2000 + Number(anioTxt);
  return `${anio}-${String(mesIndex + 1).padStart(2, "0")}-01`;
}

export interface CeldaHeadcountManual {
  obraId: string;
  periodo: string;
  variacionNeta: number;
}

export interface ErrorCeldaHeadcountManual {
  obra: string;
  periodo: string | null;
  motivo: string;
}

export interface AdvertenciaNombreHeadcountManual {
  obraId: string;
  nombreEnArchivo: string;
  nombreReal: string;
}

export interface HeadcountUploadParseResult {
  celdas: CeldaHeadcountManual[];
  errores: ErrorCeldaHeadcountManual[];
  /**
   * "Obra ID" (columna oculta, fuente de verdad) no coincide con el
   * nombre visible en "Obra" — señal de que el usuario pudo haber
   * editado/truncado el nombre por error. Se procesa igual (el ID manda),
   * solo se reporta como advertencia, nunca bloquea.
   */
  advertenciasNombre: AdvertenciaNombreHeadcountManual[];
}

/**
 * `obrasConocidas`: mapa `obraId → nombre real actual` (desde la tabla
 * `obras`) — usado para validar que el "Obra ID" de cada fila existe de
 * verdad y para detectar nombres desincronizados (ver
 * `advertenciasNombre`).
 */
export async function parseHeadcountUpload(
  buffer: Buffer | ArrayBuffer,
  obrasConocidas: Map<string, string>,
): Promise<HeadcountUploadParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as ExcelJS.Buffer);

  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) {
    throw new Error(`Hoja "${SHEET_NAME}" no encontrada en el archivo`);
  }

  // Busca la fila de encabezado por contenido, no por número fijo — mismo
  // patrón que gespro-parser.ts (tolera pequeños offsets si alguien
  // agrega una fila arriba por error).
  let headerRowNumber: number | null = null;
  let columnByHeader: Map<string, number> | null = null;
  for (let rowNumber = 1; rowNumber <= 5 && !headerRowNumber; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const map = new Map<string, number>();
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = typeof cell.value === "string" ? cell.value.trim() : null;
      if (text) map.set(text, colNumber);
    });
    if (map.has(COL_OBRA_ID) && map.has(COL_OBRA)) {
      headerRowNumber = rowNumber;
      columnByHeader = map;
    }
  }
  if (!headerRowNumber || !columnByHeader) {
    throw new Error(
      `No se encontró una fila de encabezado con las columnas "${COL_OBRA_ID}"/"${COL_OBRA}" en las primeras 5 filas — ¿es el archivo "Proyección Headcount" descargado desde esta app?`,
    );
  }

  const colObraId = columnByHeader.get(COL_OBRA_ID)!;
  const colObra = columnByHeader.get(COL_OBRA)!;

  // Columnas de mes: cualquier encabezado que parsee como período — no
  // depende de una posición fija, tolera agregar/quitar columnas fijas
  // en el futuro sin romper este parser.
  const columnasMes: { col: number; periodo: string }[] = [];
  for (const [header, col] of columnByHeader.entries()) {
    const periodo = periodoDesdeEtiquetaCorta(header);
    if (periodo) columnasMes.push({ col, periodo });
  }

  const celdas: CeldaHeadcountManual[] = [];
  const errores: ErrorCeldaHeadcountManual[] = [];
  const advertenciasNombre: AdvertenciaNombreHeadcountManual[] = [];

  for (
    let rowNumber = headerRowNumber + 1;
    rowNumber <= sheet.rowCount;
    rowNumber++
  ) {
    const row = sheet.getRow(rowNumber);
    const obraNombreEnArchivo = String(row.getCell(colObra).value ?? "").trim();
    if (!obraNombreEnArchivo) continue; // fin de la tabla, o fila de nota al pie.
    if (FILAS_EXCLUIDAS.has(obraNombreEnArchivo)) continue;

    const obraId = String(row.getCell(colObraId).value ?? "").trim();
    if (!obraId) {
      errores.push({
        obra: obraNombreEnArchivo,
        periodo: null,
        motivo:
          "Falta 'Obra ID' (columna oculta) — no se puede identificar la obra de forma inequívoca.",
      });
      continue;
    }

    const nombreReal = obrasConocidas.get(obraId);
    if (!nombreReal) {
      errores.push({
        obra: obraNombreEnArchivo,
        periodo: null,
        motivo: `'Obra ID' (${obraId}) no corresponde a ninguna obra existente.`,
      });
      continue;
    }
    if (nombreReal !== obraNombreEnArchivo) {
      advertenciasNombre.push({
        obraId,
        nombreEnArchivo: obraNombreEnArchivo,
        nombreReal,
      });
    }

    for (const { col, periodo } of columnasMes) {
      const raw = row.getCell(col).value;
      if (raw === null || raw === undefined || raw === "") continue; // celda no editada, se omite.

      const parsed = z.number().int().safeParse(raw);
      if (!parsed.success) {
        errores.push({
          obra: obraNombreEnArchivo,
          periodo,
          motivo: `Valor "${String(raw)}" no es un número entero válido.`,
        });
        continue;
      }
      celdas.push({ obraId, periodo, variacionNeta: parsed.data });
    }
  }

  return { celdas, errores, advertenciasNombre };
}

/**
 * Encadena `acumulado` (dotación absoluta) desde un saldo inicial, mes a
 * mes, para las celdas de UNA obra ya ordenadas por período ascendente —
 * `headcount_by_obra.acumulado` nunca debe quedar `null` (lo lee
 * `plan-obra-dotacion.ts` como dotación proyectada; dejarlo vacío rompe
 * esa columna en silencio).
 */
export function calcularAcumuladosDesdeSaldoInicial(
  saldoInicial: number,
  celdasOrdenadas: { periodo: string; variacionNeta: number }[],
): Map<string, number> {
  const resultado = new Map<string, number>();
  let acumulado = saldoInicial;
  for (const c of celdasOrdenadas) {
    acumulado += c.variacionNeta;
    resultado.set(c.periodo, acumulado);
  }
  return resultado;
}
