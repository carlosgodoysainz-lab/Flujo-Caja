import ExcelJS from "exceljs";
import {
  PayrollLineItemRawSchema,
  type SolicitudRequerimientoParseResult,
} from "./types";

const HEADER_MARKERS = ["Sociedad", "Concepto de pago"] as const;
// Columna del monto: "Monto" en remuneración/reliquidación/finiquito,
// "Anticipo" en los archivos "solicitud requerimientos anticipo <mes>
// <año>.xlsx" — mismo layout, encabezado distinto (confirmado contra
// archivo real).
const AMOUNT_HEADERS = ["Monto", "Anticipo"] as const;

const MESES_ES: Record<string, number> = {
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  septiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11,
};

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

/**
 * Extrae "<mes> <año>" de un texto tipo "Remuneraciones Julio 2026" o
 * "Reliquidaciones Marzo 2026" → primer día de ese mes. Confirmado contra
 * archivos reales que el período real del pago está en este texto, NO en
 * "Fecha Pago" (que es el mes SIGUIENTE en el que se paga la reliquidación).
 */
function extractPeriodoFromConcepto(concepto: string): Date | null {
  const match = concepto
    .toLowerCase()
    .match(
      /(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+(\d{4})/,
    );
  if (!match) return null;
  const mesIndex = MESES_ES[match[1]];
  const anio = Number(match[2]);
  return new Date(anio, mesIndex, 1);
}

/**
 * "Finiquito RP cuota 4/5" no trae mes/año en el texto — para esos casos
 * se usa el mes de "Fecha Pago" (columna G) como período.
 */
function periodoFromFechaPago(value: unknown): Date | null {
  if (!(value instanceof Date)) return null;
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

/**
 * Clasifica el concepto de una fila a nuestro enum interno. "Retención
 * Judicial" se pliega en el bucket de remuneración del mismo archivo —
 * es un descuento/withholding del mismo ciclo de pago, no una categoría
 * de flujo de caja separada en el modelo original del Excel Detalle
 * (decisión documentada, revisar con el usuario si se necesita separarla).
 */
function clasificarConcepto(
  conceptoTexto: string,
  rgRpDelArchivo: "RG" | "RP" | null,
):
  | "anticipo_rg"
  | "anticipo_rp"
  | "remuneracion_rg"
  | "remuneracion_rp"
  | "reliquidacion"
  | "finiquito"
  | null {
  const t = conceptoTexto.toLowerCase();
  if (t.includes("finiquito")) return "finiquito";
  if (t.includes("reliquidacion") || t.includes("reliquidación"))
    return "reliquidacion";
  if (t.includes("anticipo")) {
    return rgRpDelArchivo === "RP" ? "anticipo_rp" : "anticipo_rg";
  }
  if (
    t.includes("remuneracion") ||
    t.includes("remuneración") ||
    t.includes("retencion judicial") ||
    t.includes("retención judicial")
  ) {
    // Sin señal de archivo, se asume RG (mayoría de los casos reales) —
    // limitación documentada, no crítica: el total combinado no cambia,
    // solo el desglose RG/RP interno.
    return rgRpDelArchivo === "RP" ? "remuneracion_rp" : "remuneracion_rg";
  }
  return null;
}

/** "anticipo RG" / "anticipo RP" / "Remuneraciones RG" → "RG"/"RP", null si el nombre de hoja no lo indica. */
function rgRpFromSheetName(nombreHoja: string): "RG" | "RP" | null {
  const lower = nombreHoja.toLowerCase();
  const hasRg = /\brg\b/.test(lower);
  const hasRp = /\brp\b/.test(lower);
  if (hasRg && !hasRp) return "RG";
  if (hasRp && !hasRg) return "RP";
  return null;
}

/**
 * Parsea un archivo "Solicitud de Requerimiento [remuneracion|reliquidacion]
 * <mes> <año> [RG|RP].xlsx" o "solicitud requerimientos anticipo <mes>
 * <año>.xlsx" (este último trae RG y RP como 2 hojas del MISMO libro, no 2
 * archivos separados — de ahí la detección de RG/RP por nombre de HOJA
 * además de por nombre de archivo). Genérico por CONTENIDO de encabezado
 * (no por nombre de hoja fijo) — confirmado que el nombre de hoja varía
 * ("RP", "RG - RP", "retencion judicial", "finiquito RP cuota", "anticipo
 * RG", etc.) pero la estructura de columnas es siempre la misma (columna
 * de monto llamada "Monto" o, en Anticipo, "Anticipo").
 *
 * @param rgRpDelArchivo "RG"/"RP" si el nombre de archivo lo indica claramente, null si es ambiguo (ej. "RG - RP", o el archivo de Anticipo que trae ambos)
 */
export async function parseSolicitudRequerimiento(
  buffer: Buffer | ArrayBuffer,
  rgRpDelArchivo: "RG" | "RP" | null,
): Promise<SolicitudRequerimientoParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as ExcelJS.Buffer);

  const lineItems: SolicitudRequerimientoParseResult["lineItems"] = [];
  const errores: SolicitudRequerimientoParseResult["errores"] = [];

  for (const sheet of workbook.worksheets) {
    let headerRowNumber: number | null = null;
    let columnByHeader: Map<string, number> | null = null;

    for (let rowNumber = 1; rowNumber <= 10 && !headerRowNumber; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const map = new Map<string, number>();
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const text = toTrimmedString(cell.value);
        if (text) map.set(text, colNumber);
      });
      const tieneMonto = AMOUNT_HEADERS.some((h) => map.has(h));
      if (HEADER_MARKERS.every((h) => map.has(h)) && tieneMonto) {
        headerRowNumber = rowNumber;
        columnByHeader = map;
      }
    }

    // Hoja sin la estructura esperada — se ignora silenciosamente (podría
    // ser una hoja auxiliar/gráfico, no necesariamente un error).
    if (!headerRowNumber || !columnByHeader) continue;

    const col = (name: string) => columnByHeader!.get(name)!;
    const colSociedad = col("Sociedad");
    const colDivision =
      columnByHeader.get("Division") ?? columnByHeader.get("División");
    const colConcepto = col("Concepto de pago");
    const colMonto =
      columnByHeader.get("Monto") ?? columnByHeader.get("Anticipo")!;
    const colFechaPago = columnByHeader.get("Fecha Pago");
    // El nombre de hoja manda por sobre el nombre de archivo cuando ambos
    // están presentes (el archivo de Anticipo trae RG y RP en 2 hojas del
    // mismo libro — el nombre de archivo por sí solo es ambiguo ahí).
    const rgRpDeEstaHoja = rgRpFromSheetName(sheet.name) ?? rgRpDelArchivo;

    for (
      let rowNumber = headerRowNumber + 1;
      rowNumber <= sheet.rowCount;
      rowNumber++
    ) {
      const row = sheet.getRow(rowNumber);
      const sociedad = toTrimmedString(row.getCell(colSociedad).value);
      const conceptoTexto = toTrimmedString(row.getCell(colConcepto).value);

      // Fin de la tabla o fila de "Total".
      if (
        !sociedad ||
        !conceptoTexto ||
        conceptoTexto.toLowerCase() === "total"
      )
        continue;

      const montoRaw = resolveCellValue(row.getCell(colMonto));
      const monto = typeof montoRaw === "number" ? montoRaw : null;

      const concepto = clasificarConcepto(conceptoTexto, rgRpDeEstaHoja);
      const periodo =
        extractPeriodoFromConcepto(conceptoTexto) ??
        periodoFromFechaPago(
          colFechaPago ? resolveCellValue(row.getCell(colFechaPago)) : null,
        );

      const raw = {
        periodo,
        concepto,
        sociedad,
        division: colDivision
          ? toTrimmedString(row.getCell(colDivision).value)
          : null,
        monto,
      };

      const result = PayrollLineItemRawSchema.safeParse(raw);
      if (result.success) {
        lineItems.push(result.data);
      } else {
        errores.push({
          hoja: sheet.name,
          fila: rowNumber,
          motivo: result.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        });
      }
    }
  }

  return { lineItems, errores };
}
