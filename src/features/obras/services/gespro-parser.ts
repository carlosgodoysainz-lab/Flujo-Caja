import ExcelJS from "exceljs";
import { ObraRawSchema, type GesproParseResult } from "../types";

const SHEET_NAME = "Plan de Obras";

/**
 * Columnas esperadas en la fila de encabezado (nombres tal como aparecen
 * en el Excel real — confirmado contra
 * ".../Plan de obra Gespro/03_08_26/20260803 Plan de Obras Nuevo Gespro.xlsx").
 */
const REQUIRED_HEADERS = [
  "Cod",
  "Proyecto",
  "Comuna",
  "Tipo",
  "Cliente",
  "un",
  "Inicio Obra",
  "Dur. Obra",
  "Fin Obra",
] as const;

/**
 * Resuelve el valor de una celda de ExcelJS. Las columnas Inicio/Fin Obra
 * y Dur. Obra son fórmulas (referencian la hoja "Gespro") — ExcelJS las
 * expone como `{ formula, result }` en vez del valor plano.
 */
function resolveCellValue(cell: ExcelJS.Cell): unknown {
  const raw = cell.value;
  if (raw && typeof raw === "object" && "result" in raw) {
    return (raw as { result: unknown }).result;
  }
  return raw;
}

function toTrimmedString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  return null;
}

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value))
    return Math.round(value);
  return null;
}

/** Normaliza el texto libre de "Tipo" a los valores del enum del schema. */
function normalizeTipo(
  raw: string | null,
): "Retail" | "DS19" | "DS49" | "Otro" {
  if (raw === "Retail" || raw === "DS19" || raw === "DS49") return raw;
  return "Otro";
}

/** Normaliza "Cliente" a los valores del enum del schema. */
function normalizeCliente(raw: string | null): "Maestra" | "Terceros" {
  return raw === "Maestra" ? "Maestra" : "Terceros";
}

/**
 * Parsea el workbook de Plan de Obras Gespro y devuelve las obras
 * validadas + los errores de fila (filas descartadas nunca se insertan
 * a medias — ver TECH-SPEC §5.3).
 */
export async function parseGesproWorkbook(
  buffer: Buffer | ArrayBuffer,
): Promise<GesproParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as ExcelJS.Buffer);

  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) {
    throw new Error(`Hoja "${SHEET_NAME}" no encontrada en el archivo Gespro`);
  }

  // Buscar la fila de encabezado por contenido (no por número fijo de
  // fila) — el Excel real tiene la fila 1 vacía y encabezados en fila 2,
  // pero eso puede variar entre versiones del archivo.
  let headerRowNumber: number | null = null;
  let columnByHeader: Map<string, number> | null = null;

  for (let rowNumber = 1; rowNumber <= 10 && !headerRowNumber; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const map = new Map<string, number>();
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = toTrimmedString(cell.value);
      if (text) map.set(text, colNumber);
    });
    if (REQUIRED_HEADERS.every((h) => map.has(h))) {
      headerRowNumber = rowNumber;
      columnByHeader = map;
    }
  }

  if (!headerRowNumber || !columnByHeader) {
    throw new Error(
      `No se encontró una fila de encabezado con las columnas esperadas (${REQUIRED_HEADERS.join(", ")}) en las primeras 10 filas`,
    );
  }

  const col = (name: (typeof REQUIRED_HEADERS)[number]) =>
    columnByHeader!.get(name)!;

  const obras: GesproParseResult["obras"] = [];
  const errores: GesproParseResult["errores"] = [];

  for (
    let rowNumber = headerRowNumber + 1;
    rowNumber <= sheet.rowCount;
    rowNumber++
  ) {
    const row = sheet.getRow(rowNumber);
    const nombre = toTrimmedString(row.getCell(col("Proyecto")).value);

    // Fin de la tabla: sin nombre de proyecto, no hay más datos.
    if (!nombre) continue;

    const raw = {
      codigoGespro: toTrimmedString(row.getCell(col("Cod")).value),
      nombre,
      comuna: toTrimmedString(row.getCell(col("Comuna")).value),
      tipo: normalizeTipo(toTrimmedString(row.getCell(col("Tipo")).value)),
      cliente: normalizeCliente(
        toTrimmedString(row.getCell(col("Cliente")).value),
      ),
      unidades: toInt(resolveCellValue(row.getCell(col("un")))),
      inicioObra: toDate(resolveCellValue(row.getCell(col("Inicio Obra")))),
      finObra: toDate(resolveCellValue(row.getCell(col("Fin Obra")))),
      durObraMeses: toInt(resolveCellValue(row.getCell(col("Dur. Obra")))),
    };

    const result = ObraRawSchema.safeParse(raw);
    if (result.success) {
      obras.push(result.data);
    } else {
      errores.push({
        fila: rowNumber,
        motivo: result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
    }
  }

  return { obras, errores };
}
