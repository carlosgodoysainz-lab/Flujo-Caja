/**
 * Comparación de SOLO LECTURA (Fase 3, checkpoint final) — cruza el Excel
 * que exporta la app contra el Excel tradicional del usuario, concepto por
 * concepto y mes a mes, para explicar cualquier diferencia residual.
 *
 * NUNCA escribe en ninguno de los 2 archivos.
 *
 * Uso:
 *   npx tsx scripts/comparar-excel-tradicional.ts <maestro.xlsx> <export-app.xlsx>
 */
import ExcelJS from "exceljs";

const MESES_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;

function valorCelda(v: ExcelJS.CellValue): unknown {
  if (v && typeof v === "object" && "result" in v) return v.result;
  return v;
}

interface FilaConceptos {
  anticipo: number;
  remuneracion: number;
  finiquito: number;
  reliquidacion: number;
  cotizacion: number;
  sence: number;
  totalNomina: number;
}

const FILA_ANTICIPO = 4;
const FILA_REMUNERACION = 7;
const FILA_FINIQUITO = 10;
const FILA_RELIQUIDACION = 11;
const FILA_COTIZACION = 12;
const FILA_SENCE = 13;
const FILA_TOTAL = 14;

function leerConcepto(ws: ExcelJS.Worksheet, fila: number, col: number): number {
  const v = valorCelda(ws.getRow(fila).getCell(col).value);
  return typeof v === "number" ? v : 0;
}

/**
 * Excel tradicional del usuario — hoja "Detalle": una columna "$" + "N°"
 * por mes, empezando en la columna 3, sin año explícito en cada columna
 * (el año solo aparece en la fila 2, y no en todas las columnas — Excel
 * lo deja vacío cuando la celda de arriba está fusionada). Se ancla
 * detectando la columna donde la fila 2 dice "2026" Y la fila 3 dice
 * "Enero" — desde ahí el resto se deriva por aritmética (2 columnas por
 * mes, mismo patrón en todo el archivo).
 */
function leerMaestro(ws: ExcelJS.Worksheet): Map<string, FilaConceptos> {
  let anchorCol = -1;
  const row2 = ws.getRow(2);
  const row3 = ws.getRow(3);
  for (let c = 1; c <= ws.columnCount; c++) {
    const anio = valorCelda(row2.getCell(c).value);
    const mes = String(valorCelda(row3.getCell(c).value) ?? "").trim().toLowerCase();
    if (Number(anio) === 2026 && mes === "enero") {
      anchorCol = c;
      break;
    }
  }
  if (anchorCol === -1) {
    throw new Error('No se encontró la columna ancla ("2026" + "Enero") en el Excel maestro.');
  }

  const resultado = new Map<string, FilaConceptos>();
  for (let col = 3; col <= ws.columnCount; col += 2) {
    const mesTexto = String(valorCelda(row3.getCell(col).value) ?? "").trim().toLowerCase();
    if (!MESES_ES.includes(mesTexto as (typeof MESES_ES)[number])) continue;

    const mesesDesdeAncla = (col - anchorCol) / 2;
    const fecha = new Date(2026, mesesDesdeAncla, 1);
    const periodo = fecha.toISOString().slice(0, 10);

    resultado.set(periodo, {
      anticipo: leerConcepto(ws, FILA_ANTICIPO, col),
      remuneracion: leerConcepto(ws, FILA_REMUNERACION, col),
      finiquito: leerConcepto(ws, FILA_FINIQUITO, col),
      reliquidacion: leerConcepto(ws, FILA_RELIQUIDACION, col),
      cotizacion: leerConcepto(ws, FILA_COTIZACION, col),
      sence: leerConcepto(ws, FILA_SENCE, col),
      totalNomina: leerConcepto(ws, FILA_TOTAL, col),
    });
  }
  return resultado;
}

/**
 * Excel exportado por la app — hoja "Detalle": la fila 1 ya trae el
 * período explícito "YYYY-MM" en cada columna "$" (par $/N°, columnas
 * pares empezando en la 2).
 */
function leerAppExport(ws: ExcelJS.Worksheet): Map<string, FilaConceptos> {
  const row1 = ws.getRow(1);
  const resultado = new Map<string, FilaConceptos>();
  for (let col = 2; col <= ws.columnCount; col += 2) {
    const etiqueta = String(valorCelda(row1.getCell(col).value) ?? "").trim();
    if (!/^\d{4}-\d{2}$/.test(etiqueta)) continue;
    const periodo = `${etiqueta}-01`;

    resultado.set(periodo, {
      anticipo: leerConcepto(ws, FILA_ANTICIPO, col),
      remuneracion: leerConcepto(ws, FILA_REMUNERACION, col),
      finiquito: leerConcepto(ws, FILA_FINIQUITO, col),
      reliquidacion: leerConcepto(ws, FILA_RELIQUIDACION, col),
      cotizacion: leerConcepto(ws, FILA_COTIZACION, col),
      sence: leerConcepto(ws, FILA_SENCE, col),
      totalNomina: leerConcepto(ws, FILA_TOTAL, col),
    });
  }
  return resultado;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("es-CL");
}

function pct(diff: number, base: number): string {
  if (base === 0) return diff === 0 ? "0,0%" : "—";
  return `${((diff / base) * 100).toFixed(1)}%`;
}

async function main() {
  const [rutaMaestro, rutaApp] = process.argv.slice(2);
  if (!rutaMaestro || !rutaApp) {
    throw new Error("Uso: comparar-excel-tradicional.ts <maestro.xlsx> <export-app.xlsx>");
  }

  const wbMaestro = new ExcelJS.Workbook();
  await wbMaestro.xlsx.readFile(rutaMaestro);
  const wbApp = new ExcelJS.Workbook();
  await wbApp.xlsx.readFile(rutaApp);

  const maestro = leerMaestro(wbMaestro.getWorksheet("Detalle")!);
  const app = leerAppExport(wbApp.getWorksheet("Detalle")!);

  const periodosComunes = [...app.keys()]
    .filter((p) => maestro.has(p))
    .sort();

  if (periodosComunes.length === 0) {
    console.log("Sin períodos en común entre ambos archivos.");
    return;
  }

  console.log(`Períodos en común: ${periodosComunes[0].slice(0, 7)} a ${periodosComunes.at(-1)!.slice(0, 7)} (${periodosComunes.length} meses)\n`);

  const CONCEPTOS: { key: keyof FilaConceptos; label: string }[] = [
    { key: "anticipo", label: "Anticipo" },
    { key: "remuneracion", label: "Remuneración" },
    { key: "finiquito", label: "Finiquito" },
    { key: "reliquidacion", label: "Reliquidación" },
    { key: "cotizacion", label: "Cotización" },
    { key: "sence", label: "SENCE" },
    { key: "totalNomina", label: "TOTAL NÓMINA" },
  ];

  const totalesMaestro: Record<string, number> = {};
  const totalesApp: Record<string, number> = {};
  for (const { key } of CONCEPTOS) {
    totalesMaestro[key] = 0;
    totalesApp[key] = 0;
  }

  for (const periodo of periodosComunes) {
    const m = maestro.get(periodo)!;
    const a = app.get(periodo)!;
    console.log(`\n=== ${periodo.slice(0, 7)} ===`);
    for (const { key, label } of CONCEPTOS) {
      const vm = m[key];
      const va = a[key];
      const diff = va - vm;
      totalesMaestro[key] += vm;
      totalesApp[key] += va;
      const marca = Math.abs(diff) > Math.max(Math.abs(vm), 1) * 0.02 ? " ⚠️" : "";
      console.log(
        `  ${label.padEnd(14)} maestro ${fmt(vm).padStart(14)} | app ${fmt(va).padStart(14)} | dif ${fmt(diff).padStart(13)} (${pct(diff, vm)})${marca}`,
      );
    }
  }

  console.log(`\n\n=== TOTALES DEL RANGO (${periodosComunes[0].slice(0, 7)} a ${periodosComunes.at(-1)!.slice(0, 7)}) ===`);
  for (const { key, label } of CONCEPTOS) {
    const vm = totalesMaestro[key];
    const va = totalesApp[key];
    console.log(
      `  ${label.padEnd(14)} maestro ${fmt(vm).padStart(15)} | app ${fmt(va).padStart(15)} | dif ${fmt(va - vm).padStart(14)} (${pct(va - vm, vm)})`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
