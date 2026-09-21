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

// Contrato compartido con `render-excel.ts` (`escribirHojaBaseline`) — los
// 3 valores deben coincidir EXACTO. `VERSION_BASELINE_SOPORTADA`: si el
// formato de la hoja cambia alguna vez y el export sube su versión, un
// archivo con una versión distinta se trata como "sin baseline" (modo
// compatibilidad) en vez de leerse mal en silencio.
const NOMBRE_HOJA_BASELINE = "_fcn_baseline";
const MARCA_BASELINE = "FCN_BASELINE";
const VERSION_BASELINE_SOPORTADA = 1;

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

/** Una celda que el archivo trae VACÍA pero cuyo baseline tenía un número — ver `clasificarCeldas`. Borrar nunca se interpreta como "poner 0". */
export interface CeldaBorradaHeadcountManual {
  obra: string;
  obraId: string;
  periodo: string;
  valorAnterior: number;
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
  /**
   * `true` si el archivo trae la hoja técnica `_fcn_baseline` con una
   * versión que este parser reconoce — es lo que permite distinguir con
   * certeza "el usuario editó esta celda" de "esto lo escribió el
   * export". `false` = "modo compatibilidad" (archivo descargado antes
   * de este fix, o hoja perdida/corrupta): la clasificación de qué es
   * edición se resuelve DESPUÉS, comparando contra la base de datos (ver
   * `upload-manual.ts`) — este parser no tiene esa información.
   */
  baselinePresente: boolean;
  /** `generadoEn` (ISO) grabado en la hoja baseline, si está presente — para mostrarlo en el preview ("este archivo se descargó el..."). */
  generadoEnArchivo: string | null;
  /** Cuántas celdas con valor coinciden EXACTO con su baseline — no son ediciones, no aparecen en `celdas`. Solo tiene sentido con `baselinePresente=true`. */
  celdasSinCambios: number;
  /** Celdas que el usuario dejó en blanco pero cuyo baseline tenía un número — advertencia, nunca se interpreta como 0. */
  celdasBorradas: CeldaBorradaHeadcountManual[];
  /** Total de celdas con algún valor numérico en el archivo (editadas + sin cambios) — denominador para el tope de seguridad del modo compatibilidad. */
  totalCeldasConValor: number;
}

/** Celda de mes tal cual viene en la hoja visible, antes de clasificar. `valor: null` = celda vacía. */
interface CeldaLeida {
  obraId: string;
  periodo: string;
  valor: number | null;
}

/**
 * Distingue "el usuario editó esta celda" de "esto lo escribió el export"
 * — el criterio que faltaba y que causaba el bug: antes, CUALQUIER celda
 * con dato (incluidas las del modelo o de Buk, que el export llena para
 * casi toda la grilla) se trataba como editada al re-subir, marcando
 * `origen='manual'` sobre toda la hoja y congelándola para siempre (ver
 * Auto-Blindaje 21-sep-2026).
 *
 * Pura — no toca ExcelJS ni la BD, para poder testearla directo.
 */
export function clasificarCeldas(
  celdasLeidas: CeldaLeida[],
  baseline: Map<string, number> | null,
): {
  edicionesDetectadas: CeldaHeadcountManual[];
  sinCambios: number;
  borradas: { obraId: string; periodo: string; valorAnterior: number }[];
} {
  const edicionesDetectadas: CeldaHeadcountManual[] = [];
  const borradas: { obraId: string; periodo: string; valorAnterior: number }[] =
    [];
  let sinCambios = 0;

  for (const { obraId, periodo, valor } of celdasLeidas) {
    const key = `${obraId}::${periodo}`;
    const valorBaseline = baseline?.get(key);

    if (valor === null) {
      // Sin baseline (modo compatibilidad) no hay forma de saber si una
      // celda vacía "borró" un dato del export o simplemente nunca tuvo
      // uno — se ignora, igual que antes del fix.
      if (valorBaseline != null) {
        borradas.push({ obraId, periodo, valorAnterior: valorBaseline });
      }
      continue;
    }

    if (baseline === null) {
      // Modo compatibilidad: toda celda con valor es candidata; el
      // diff real contra la BD lo hace `upload-manual.ts`, que sí tiene
      // acceso a los datos guardados.
      edicionesDetectadas.push({ obraId, periodo, variacionNeta: valor });
      continue;
    }

    if (valorBaseline === valor) {
      sinCambios++;
    } else {
      edicionesDetectadas.push({ obraId, periodo, variacionNeta: valor });
    }
  }

  return { edicionesDetectadas, sinCambios, borradas };
}

/**
 * Filtra las candidatas de modo compatibilidad (`baseline === null`, ver
 * `clasificarCeldas`) contra lo que YA está guardado en la base de datos
 * — solo lo que difiere se trata como edición real. Vive acá (no en
 * `upload-manual.ts`, que tiene `"use server"` y exige que TODO export
 * sea una Server Action async) para poder testearla pura, sin Supabase.
 */
export function diffContraBaseDeDatos(
  candidatas: CeldaHeadcountManual[],
  variacionExistentePorClave: Map<string, number>,
): CeldaHeadcountManual[] {
  return candidatas.filter((c) => {
    const existente = variacionExistentePorClave.get(
      `${c.obraId}::${c.periodo}`,
    );
    return existente === undefined || existente !== c.variacionNeta;
  });
}

/**
 * Lee la hoja técnica `_fcn_baseline` (ver `render-excel.ts`,
 * `escribirHojaBaseline`). `null` si la hoja no existe, o si su marca/
 * versión no coinciden con lo que este parser reconoce — un archivo así
 * se trata como "sin baseline" (modo compatibilidad), nunca se intenta
 * leer a medias.
 */
function leerBaseline(
  workbook: ExcelJS.Workbook,
): { baseline: Map<string, number>; generadoEn: string | null } | null {
  const hoja = workbook.getWorksheet(NOMBRE_HOJA_BASELINE);
  if (!hoja) return null;

  const filaMarca = hoja.getRow(1);
  const marca = String(filaMarca.getCell(1).value ?? "");
  const version = Number(filaMarca.getCell(2).value);
  if (marca !== MARCA_BASELINE || version !== VERSION_BASELINE_SOPORTADA) {
    return null;
  }
  const generadoEn = String(filaMarca.getCell(3).value ?? "") || null;

  const baseline = new Map<string, number>();
  for (let rowNumber = 3; rowNumber <= hoja.rowCount; rowNumber++) {
    const row = hoja.getRow(rowNumber);
    const obraId = String(row.getCell(1).value ?? "").trim();
    const periodo = String(row.getCell(2).value ?? "").trim();
    const valor = Number(row.getCell(3).value);
    if (!obraId || !periodo || Number.isNaN(valor)) continue;
    baseline.set(`${obraId}::${periodo}`, valor);
  }
  return { baseline, generadoEn };
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

  const celdasLeidas: CeldaLeida[] = [];
  const errores: ErrorCeldaHeadcountManual[] = [];
  const advertenciasNombre: AdvertenciaNombreHeadcountManual[] = [];
  const nombrePorObraId = new Map<string, string>();

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
    nombrePorObraId.set(obraId, nombreReal);
    if (nombreReal !== obraNombreEnArchivo) {
      advertenciasNombre.push({
        obraId,
        nombreEnArchivo: obraNombreEnArchivo,
        nombreReal,
      });
    }

    for (const { col, periodo } of columnasMes) {
      const raw = row.getCell(col).value;
      if (raw === null || raw === undefined || raw === "") {
        // Celda vacía: se pasa igual a `clasificarCeldas` con `valor: null`
        // — es lo que le permite detectar una celda BORRADA (el export le
        // había puesto un número y el usuario lo dejó en blanco), que
        // nunca se interpreta como "poner 0".
        celdasLeidas.push({ obraId, periodo, valor: null });
        continue;
      }

      const parsed = z.number().int().safeParse(raw);
      if (!parsed.success) {
        errores.push({
          obra: obraNombreEnArchivo,
          periodo,
          motivo: `Valor "${String(raw)}" no es un número entero válido.`,
        });
        continue;
      }
      celdasLeidas.push({ obraId, periodo, valor: parsed.data });
    }
  }

  const baselineLeido = leerBaseline(workbook);
  const { edicionesDetectadas, sinCambios, borradas } = clasificarCeldas(
    celdasLeidas,
    baselineLeido?.baseline ?? null,
  );

  return {
    celdas: edicionesDetectadas,
    errores,
    advertenciasNombre,
    baselinePresente: baselineLeido !== null,
    generadoEnArchivo: baselineLeido?.generadoEn ?? null,
    celdasSinCambios: sinCambios,
    celdasBorradas: borradas.map((b) => ({
      obra: nombrePorObraId.get(b.obraId) ?? b.obraId,
      obraId: b.obraId,
      periodo: b.periodo,
      valorAnterior: b.valorAnterior,
    })),
    totalCeldasConValor: celdasLeidas.filter((c) => c.valor !== null).length,
  };
}
