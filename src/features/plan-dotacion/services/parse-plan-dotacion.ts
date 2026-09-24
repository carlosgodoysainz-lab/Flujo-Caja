import ExcelJS from "exceljs";
import { z } from "zod";

/**
 * Parser del "Plan Dotación Obras.xlsx" — el archivo que el usuario
 * mantiene en SharePoint (carpeta "Flujo de Caja/Plan Dotación", ver
 * `sync-plan-dotacion.ts`) con su plan de dotación obra por obra.
 * Reemplaza la carga manual anterior (Excel "Proyección Headcount"
 * descargado/re-subido desde la app) — mismo patrón de parseo por texto
 * de encabezado que `obras/services/gespro-parser.ts` y
 * `headcount/services/parse-headcount-upload.ts`, pero SIN baseline
 * (este archivo no lo escribe la app, lo escribe el usuario a mano).
 *
 * Hoja "Plan": columnas "Obra ID" (oculta, fuente de verdad — con
 * respaldo por nombre) + "Obra" + columnas de mes "mmm-aa" con la
 * variación neta (altas−bajas). Fila especial "Oficina Central"
 * (`obraId` vacío) para la dotación fuera de obra.
 *
 * Hoja "Eventos": extraordinarios (bono de término de obra, montos
 * puntuales) — ver `plan_eventos`.
 */

const SHEET_PLAN = "Plan";
const SHEET_EVENTOS = "Eventos";
const COL_OBRA_ID = "Obra ID";
const COL_OBRA = "Obra";
const FILA_OFICINA_CENTRAL = "Oficina Central";

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

/** "oct-26" → "2026-10-01". `null` si no matchea el formato esperado. */
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

export interface PlanDotacionFilaParseada {
  /** `null` = Oficina Central. */
  obraId: string | null;
  periodo: string;
  variacionNeta: number;
}

export interface PlanEventoParseado {
  periodo: string;
  concepto: "remuneracion" | "anticipo";
  modo: "monto_total" | "por_persona";
  monto: number;
  /** "uf" = `monto` en UF, se convierte con la UF del mes de pago (ver refresh.ts). */
  moneda: "clp" | "uf";
  /** Solo si `modo === "por_persona"` y aplica a una obra específica (no a toda la compañía). */
  obraId: string | null;
  poblacion: "rg" | "rp" | null;
  descripcion: string | null;
}

export interface ErrorPlanDotacion {
  hoja: "Plan" | "Eventos";
  fila: number;
  motivo: string;
}

export interface PlanDotacionParseResult {
  filas: PlanDotacionFilaParseada[];
  eventos: PlanEventoParseado[];
  errores: ErrorPlanDotacion[];
  advertencias: string[];
}

function buscarFilaEncabezado(
  sheet: ExcelJS.Worksheet,
  columnasRequeridas: string[],
  maxFilas = 5,
): { headerRowNumber: number; columnByHeader: Map<string, number> } | null {
  for (let rowNumber = 1; rowNumber <= maxFilas; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const map = new Map<string, number>();
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = typeof cell.value === "string" ? cell.value.trim() : null;
      if (text) map.set(text, colNumber);
    });
    if (columnasRequeridas.every((c) => map.has(c))) {
      return { headerRowNumber: rowNumber, columnByHeader: map };
    }
  }
  return null;
}

function parsearHojaPlan(
  sheet: ExcelJS.Worksheet,
  obrasConocidas: Map<string, string>,
): { filas: PlanDotacionFilaParseada[]; errores: ErrorPlanDotacion[] } {
  const filas: PlanDotacionFilaParseada[] = [];
  const errores: ErrorPlanDotacion[] = [];

  const encabezado = buscarFilaEncabezado(sheet, [COL_OBRA]);
  if (!encabezado) {
    errores.push({
      hoja: "Plan",
      fila: 0,
      motivo: `No se encontró una fila de encabezado con la columna "${COL_OBRA}" en las primeras 5 filas.`,
    });
    return { filas, errores };
  }
  const { headerRowNumber, columnByHeader } = encabezado;
  const colObra = columnByHeader.get(COL_OBRA)!;
  const colObraId = columnByHeader.get(COL_OBRA_ID) ?? null;

  const columnasMes: { col: number; periodo: string }[] = [];
  for (const [header, col] of columnByHeader.entries()) {
    const periodo = periodoDesdeEtiquetaCorta(header);
    if (periodo) columnasMes.push({ col, periodo });
  }

  // Índice por nombre — respaldo cuando la columna "Obra ID" no existe o
  // viene vacía en una fila (el usuario puede escribir el archivo a mano
  // sin conocer los UUID internos).
  const obraIdPorNombre = new Map<string, string>();
  for (const [id, nombre] of obrasConocidas) {
    obraIdPorNombre.set(nombre.trim().toLowerCase(), id);
  }

  for (
    let rowNumber = headerRowNumber + 1;
    rowNumber <= sheet.rowCount;
    rowNumber++
  ) {
    const row = sheet.getRow(rowNumber);
    const nombreObra = String(row.getCell(colObra).value ?? "").trim();
    if (!nombreObra) continue; // fin de la tabla

    const esOficinaCentral =
      nombreObra.toLowerCase() === FILA_OFICINA_CENTRAL.toLowerCase();

    let obraId: string | null = null;
    if (!esOficinaCentral) {
      const idEnArchivo = colObraId
        ? String(row.getCell(colObraId).value ?? "").trim()
        : "";
      if (idEnArchivo && obrasConocidas.has(idEnArchivo)) {
        obraId = idEnArchivo;
      } else {
        obraId = obraIdPorNombre.get(nombreObra.toLowerCase()) ?? null;
      }
      if (!obraId) {
        errores.push({
          hoja: "Plan",
          fila: rowNumber,
          motivo: `Obra "${nombreObra}" no coincide con ninguna obra conocida (ni por Obra ID ni por nombre).`,
        });
        continue;
      }
    }

    for (const { col, periodo } of columnasMes) {
      const raw = row.getCell(col).value;
      if (raw === null || raw === undefined || raw === "") continue; // celda vacía = sin plan ese mes, no es 0

      const parsed = z.number().int().safeParse(raw);
      if (!parsed.success) {
        errores.push({
          hoja: "Plan",
          fila: rowNumber,
          motivo: `"${nombreObra}" / ${periodo.slice(0, 7)}: valor "${String(raw)}" no es un número entero válido.`,
        });
        continue;
      }
      filas.push({ obraId, periodo, variacionNeta: parsed.data });
    }
  }

  return { filas, errores };
}

const COL_MES = "Mes";
const COL_CONCEPTO = "Concepto";
const COL_MODO = "Modo";
const COL_MONTO = "Monto";
const COL_MONEDA = "Moneda";
const COL_EVENTO_OBRA = "Obra";
const COL_POBLACION = "Población";
const COL_DESCRIPCION = "Descripción";

function parsearHojaEventos(
  sheet: ExcelJS.Worksheet | undefined,
  obraIdPorNombre: Map<string, string>,
): { eventos: PlanEventoParseado[]; errores: ErrorPlanDotacion[] } {
  const eventos: PlanEventoParseado[] = [];
  const errores: ErrorPlanDotacion[] = [];
  if (!sheet) return { eventos, errores }; // hoja opcional

  const encabezado = buscarFilaEncabezado(sheet, [
    COL_MES,
    COL_CONCEPTO,
    COL_MONTO,
  ]);
  if (!encabezado) {
    errores.push({
      hoja: "Eventos",
      fila: 0,
      motivo: `No se encontró una fila de encabezado con las columnas "${COL_MES}", "${COL_CONCEPTO}", "${COL_MONTO}" en las primeras 5 filas.`,
    });
    return { eventos, errores };
  }
  const { headerRowNumber, columnByHeader } = encabezado;
  const col = (nombre: string) => columnByHeader.get(nombre) ?? null;

  for (
    let rowNumber = headerRowNumber + 1;
    rowNumber <= sheet.rowCount;
    rowNumber++
  ) {
    const row = sheet.getRow(rowNumber);
    const mesRaw = String(row.getCell(col(COL_MES)!).value ?? "").trim();
    if (!mesRaw) continue; // fin de la tabla

    const periodo = periodoDesdeEtiquetaCorta(mesRaw);
    if (!periodo) {
      errores.push({
        hoja: "Eventos",
        fila: rowNumber,
        motivo: `Mes "${mesRaw}" no tiene el formato esperado ("mmm-aa", ej. "abr-27").`,
      });
      continue;
    }

    const conceptoRaw = String(row.getCell(col(COL_CONCEPTO)!).value ?? "")
      .trim()
      .toLowerCase();
    const concepto = z
      .enum(["remuneracion", "anticipo"])
      .safeParse(conceptoRaw);
    if (!concepto.success) {
      errores.push({
        hoja: "Eventos",
        fila: rowNumber,
        motivo: `Concepto "${conceptoRaw}" debe ser "remuneracion" o "anticipo".`,
      });
      continue;
    }

    const montoRaw = row.getCell(col(COL_MONTO)!).value;
    const monto = z.number().finite().safeParse(montoRaw);
    if (!monto.success) {
      errores.push({
        hoja: "Eventos",
        fila: rowNumber,
        motivo: `Monto "${String(montoRaw)}" no es un número válido.`,
      });
      continue;
    }

    // Columna opcional — vacía o ausente = pesos (archivos anteriores a la
    // columna siguen funcionando igual).
    const monedaRaw = col(COL_MONEDA)
      ? String(row.getCell(col(COL_MONEDA)!).value ?? "")
          .trim()
          .toLowerCase()
      : "";
    if (monedaRaw && monedaRaw !== "uf" && monedaRaw !== "clp") {
      errores.push({
        hoja: "Eventos",
        fila: rowNumber,
        motivo: `Moneda "${monedaRaw}" debe ser "CLP" o "UF" (vacío = CLP).`,
      });
      continue;
    }
    const moneda: "clp" | "uf" = monedaRaw === "uf" ? "uf" : "clp";

    const modoRaw = col(COL_MODO)
      ? String(row.getCell(col(COL_MODO)!).value ?? "")
          .trim()
          .toLowerCase()
      : "";
    const modo: "monto_total" | "por_persona" =
      modoRaw === "por_persona" || modoRaw === "por persona"
        ? "por_persona"
        : "monto_total";

    let obraId: string | null = null;
    if (col(COL_EVENTO_OBRA)) {
      const nombreObra = String(
        row.getCell(col(COL_EVENTO_OBRA)!).value ?? "",
      ).trim();
      if (nombreObra) {
        obraId = obraIdPorNombre.get(nombreObra.toLowerCase()) ?? null;
        if (!obraId) {
          errores.push({
            hoja: "Eventos",
            fila: rowNumber,
            motivo: `Obra "${nombreObra}" no coincide con ninguna obra conocida.`,
          });
          continue;
        }
      }
    }

    let poblacion: "rg" | "rp" | null = null;
    if (col(COL_POBLACION)) {
      const poblacionRaw = String(row.getCell(col(COL_POBLACION)!).value ?? "")
        .trim()
        .toLowerCase();
      if (poblacionRaw === "rg" || poblacionRaw === "rp") {
        poblacion = poblacionRaw;
      }
    }

    const descripcion = col(COL_DESCRIPCION)
      ? String(row.getCell(col(COL_DESCRIPCION)!).value ?? "").trim() || null
      : null;

    eventos.push({
      periodo,
      concepto: concepto.data,
      modo,
      monto: monto.data,
      moneda,
      obraId,
      poblacion,
      descripcion,
    });
  }

  return { eventos, errores };
}

/**
 * `obrasConocidas`: mapa `obraId → nombre real actual` (desde la tabla
 * `obras`) — para validar cada fila de "Plan"/"Eventos" contra el
 * catálogo real.
 */
export async function parsePlanDotacion(
  buffer: Buffer | ArrayBuffer,
  obrasConocidas: Map<string, string>,
): Promise<PlanDotacionParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as ExcelJS.Buffer);

  const sheetPlan = workbook.getWorksheet(SHEET_PLAN);
  if (!sheetPlan) {
    throw new Error(
      `Hoja "${SHEET_PLAN}" no encontrada — ¿es el archivo "Plan Dotación Obras.xlsx"?`,
    );
  }

  const { filas, errores: erroresPlan } = parsearHojaPlan(
    sheetPlan,
    obrasConocidas,
  );

  const obraIdPorNombre = new Map<string, string>();
  for (const [id, nombre] of obrasConocidas) {
    obraIdPorNombre.set(nombre.trim().toLowerCase(), id);
  }
  const { eventos, errores: erroresEventos } = parsearHojaEventos(
    workbook.getWorksheet(SHEET_EVENTOS),
    obraIdPorNombre,
  );

  const advertencias: string[] = [];
  if (filas.length === 0) {
    advertencias.push(
      'La hoja "Plan" no tiene ninguna variación válida — revisa que las columnas de mes tengan el formato "mmm-aa" (ej. "oct-26").',
    );
  }

  return {
    filas,
    eventos,
    errores: [...erroresPlan, ...erroresEventos],
    advertencias,
  };
}
