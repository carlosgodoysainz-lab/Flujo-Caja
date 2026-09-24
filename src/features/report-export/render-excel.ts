import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import type {
  CashFlowSeriePunto,
  ResumenKpis,
} from "@/features/cash-flow/services/queries";
import type {
  DotacionTotalPunto,
  DotacionPorConceptoPunto,
} from "@/features/headcount/services/dotacion-total";
import type { PlanObraDotacionFila } from "@/features/headcount/services/plan-obra-dotacion";
import type { AlertaObraCerrada } from "@/features/plan-dotacion/services/resolver-dotacion";
import { sumarMesesAPeriodo } from "@/features/headcount/services/periodo";
import { FILAS_DETALLE as FILAS } from "@/features/cash-flow/lib/filas-detalle";
import {
  CONCEPTOS_METODOLOGIA,
  MOTOR_CAMBIO_MENSUAL,
} from "@/features/cash-flow/lib/metodologia-contenido";

// Fuente única de marca en Word/Excel/PPTX (skill marca-maestra) — hoy
// ninguna celda la fijaba, quedaba en la fuente default de Excel.
const FUENTE_MARCA = "Arial";

// Logo horizontal color (fondo blanco), copiado al repo desde la skill
// marca-maestra — nunca referenciar la ruta absoluta de la skill (vive en
// el perfil del usuario, no existiría en otra máquina ni en producción).
// Proporción real del archivo: 2363×600 (~3.94:1). `import.meta.url` en
// vez de `__dirname` — el proyecto compila como ESM ("module": "esnext"
// en tsconfig), donde `__dirname` no está garantizado según el bundler.
const LOGO_MAESTRA_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "assets",
  "maestra-logo.jpg",
);

// Mismo amarillo que el Excel ORIGINAL usaba para marcar proyección — ver
// el hallazgo inicial ("lo que está en amarillo es lo que falta
// completar"). Aquí el significado es idéntico: celda calculada por
// fórmula, no dato real ingerido.
const FILL_PROYECTADO: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFFF00" },
};
const FILL_HEADER: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF003865" },
};
// Gris — distingue "el modelo de curva no tenía NINGUNA obra de
// referencia con dato real ese mes de avance" (placeholder, no
// estimación real) de una estimación amarilla normal. Ver Auto-Blindaje
// 13-ago-2026: 91% de las filas estimadas caían en este caso sin que se
// pudiera distinguir de un "0 confirmado".
const FILL_SIN_DATO: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD9D9D9" },
};

/**
 * Genera el respaldo en Excel que acompaña SIEMPRE al export HTML (ver
 * export-action.ts) — mismos datos, misma fuente (`cash_flow_monthly`),
 * generados en la MISMA llamada, para que ambos archivos "conversen" y
 * nunca queden desincronizados (pedido explícito del usuario).
 */
export async function renderReportExcel(params: {
  serie: CashFlowSeriePunto[];
  kpis: ResumenKpis;
  ufPorPeriodo: Map<string, number>;
  /** Dotación total (N°) por período — ver dotacion-total.ts. Fila "Dotación" solo aparece si hay dato. */
  dotacionPorPeriodo?: Map<string, DotacionTotalPunto>;
  /**
   * N° (dotación) por período, ESPECÍFICO de cada sub-fila RG/RP de
   * Anticipo/Remuneración — mismo formato del Excel real de Finanzas
   * (pedido explícito del usuario 17-ago-2026: "el flujo de caja que yo
   * realizaba en Excel colocaba la dotación en los subgrupos, mantén
   * ese formato"). Real desde `payroll_line_items` cuando existe,
   * estimado desde la dotación total cuando no — bug real corregido
   * 17-ago-2026: antes se reutilizaba la MISMA dotación para Anticipo y
   * Remuneración, mostrando el mismo N° pese a que mucha menos gente
   * pide Anticipo. Si no se provee, la hoja "Detalle" queda con 1
   * columna por período (comportamiento previo).
   */
  dotacionPorConceptoYPeriodo?: Map<string, DotacionPorConceptoPunto>;
  /** Plan de obra (Gespro) + dotación real (Buk) + flujo estimado por obra — ver plan-obra-dotacion.ts. Hoja "Plan de Obra" solo aparece si hay filas. */
  planObraDotacion?: PlanObraDotacionFila[];
  /** Obras vencidas con dotación y sin plan de cierre — mismas alertas que /dotacion. Van en la hoja "Resumen" solo si hay alguna. */
  alertasCierre?: AlertaObraCerrada[];
  /**
   * Aguinaldo (Fiestas Patrias + Navidad, RG+RP) YA incluido dentro del
   * Anticipo de cada período — ver `getAguinaldoAnticipoPorPeriodo` en
   * queries.ts. Solo para que la fórmula de Anticipo en "Detalle" refleje
   * que el aguinaldo se paga con el Anticipo (aclaración explícita del
   * usuario 24-sep-2026), no con la Remuneración. Si no se provee, la
   * fórmula de Anticipo asume aguinaldo $0 (comportamiento previo).
   */
  aguinaldoAnticipoPorPeriodo?: Map<string, number>;
  /**
   * Períodos ANTERIORES a este (YYYY-MM-DD) quedan agrupados/colapsados
   * en la hoja "Detalle" (outline de columnas de Excel) en vez de
   * mostrarse expandidos — pedido explícito del usuario 17-ago-2026: "el
   * histórico dejalo agrupado en el excel, no lo elimines" (el Excel
   * trae más meses hacia atrás que la app en vivo, pero sin abrumar por
   * default — mismo criterio de agrupación por columnas que ya usa el
   * Excel real de Finanzas, visible como los botones "1 2" en la
   * esquina superior izquierda). Sin este parámetro, ninguna columna se
   * agrupa (comportamiento previo).
   */
  columnasAgrupadasHastaPeriodo?: string;
  periodoDesde: string;
  periodoHasta: string;
  generadoEn: Date;
}): Promise<Buffer> {
  const {
    serie,
    kpis,
    ufPorPeriodo,
    dotacionPorPeriodo,
    dotacionPorConceptoYPeriodo,
    planObraDotacion,
    alertasCierre,
    aguinaldoAnticipoPorPeriodo,
    columnasAgrupadasHastaPeriodo,
    periodoDesde,
    periodoHasta,
    generadoEn,
  } = params;
  const conColumnaN = !!dotacionPorConceptoYPeriodo;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Flujo de Caja Nómina — Grupo Maestra";
  workbook.created = generadoEn;

  const periodos = [...new Set(serie.map((p) => p.periodo))].sort();
  const valorPorConceptoYPeriodo = new Map<string, CashFlowSeriePunto>();
  for (const punto of serie)
    valorPorConceptoYPeriodo.set(`${punto.concepto}::${punto.periodo}`, punto);

  // --- Hoja "Resumen" ---
  const resumen = workbook.addWorksheet("Resumen");

  // Logo Maestra — solo en esta hoja (portada del archivo), mismo criterio
  // de marca que "logo solo en portada/primera hoja" (ver skill
  // marca-maestra). 3 filas reservadas arriba para que no se pise con el
  // texto de abajo; ancho fijo, alto acorde a la proporción real del
  // archivo (2363×600) para no deformar el logo.
  // Cast necesario: el `Buffer` que espera `ExcelJS.Image.buffer` no
  // coincide estructuralmente con el `Buffer` que devuelve `readFileSync`
  // en esta versión de @types/node (colisión de tipos, no de runtime —
  // es el mismo objeto real). Se castea el objeto completo, vía `unknown`,
  // directo al tipo que exporta ExcelJS — evita el choque en la
  // propiedad `buffer` sin recurrir a `any`.
  const logoId = workbook.addImage({
    buffer: readFileSync(LOGO_MAESTRA_PATH),
    extension: "jpeg",
  } as unknown as ExcelJS.Image);
  resumen.addImage(logoId, {
    tl: { col: 0, row: 0 },
    ext: { width: 180, height: 46 },
  });
  resumen.addRow([]);
  resumen.addRow([]);

  resumen.addRow(["Flujo de Caja Nómina — Grupo Maestra"]).font = {
    name: FUENTE_MARCA,
    bold: true,
    size: 14,
  };
  resumen.addRow([
    `Generado: ${generadoEn.toLocaleString("es-CL")}`,
    `Período: ${periodoDesde} a ${periodoHasta}`,
  ]).font = { name: FUENTE_MARCA };
  resumen.addRow([]);
  resumen.addRow(["KPI", "Valor"]).font = {
    name: FUENTE_MARCA,
    bold: true,
  };

  /** Agrega una fila KPI con fuente Arial y formato de número en la columna "Valor". */
  function agregarFilaKpi(
    label: string,
    valor: number | string,
    numFmt?: string,
  ) {
    const row = resumen.addRow([label, valor]);
    row.font = { name: FUENTE_MARCA };
    if (numFmt && typeof valor === "number") row.getCell(2).numFmt = numFmt;
  }

  agregarFilaKpi("Este mes", kpis.totalMesActual, "#,##0");
  agregarFilaKpi("Próximos 3 meses", kpis.totalProximosTresMeses, "#,##0");
  agregarFilaKpi("Próximos 12 meses", kpis.totalProximosDoceMeses, "#,##0");
  agregarFilaKpi(
    "Variación vs. mes anterior (%)",
    kpis.variacionPct != null ? Number(kpis.variacionPct.toFixed(1)) : "—",
    "0.0",
  );
  agregarFilaKpi(
    "Dotación total (mes actual)",
    kpis.dotacionMesActual ?? "—",
    "#,##0",
  );
  agregarFilaKpi(
    "Obras vigentes sin Plan de Dotación cargado",
    kpis.obrasSinPlan,
    "#,##0",
  );
  agregarFilaKpi(
    "Meses proyectados en el rango",
    kpis.mesesProyectadosEnRango,
    "#,##0",
  );
  if (kpis.mesPico) {
    // El período va en la etiqueta y el monto queda en su propia celda
    // numérica con formato — antes era un solo string concatenado sin
    // formato ("2027-05 — 3168296668"), rompía el resto de la columna.
    agregarFilaKpi(
      `Mes de mayor requerimiento (${kpis.mesPico.periodo.slice(0, 7)})`,
      kpis.mesPico.monto,
      "#,##0",
    );
  }
  if (alertasCierre && alertasCierre.length > 0) {
    resumen.addRow([]);
    resumen.addRow([
      `Alerta: ${alertasCierre.length} obra(s) ya pasaron su fecha de término y siguen con dotación sin plan de cierre`,
    ]).font = { name: FUENTE_MARCA, bold: true, color: { argb: "FFC00000" } };
    resumen.addRow(["Obra", "Fin Obra", "Dotación real (Buk)"]).font = {
      name: FUENTE_MARCA,
      bold: true,
    };
    for (const a of alertasCierre) {
      resumen.addRow([a.obraNombre, a.finObra.slice(0, 10), a.dotacionActual])
        .font = { name: FUENTE_MARCA, color: { argb: "FFC00000" } };
    }
  }

  resumen.getColumn(1).width = 40;
  resumen.getColumn(2).width = 22;

  // --- Hoja "Detalle" — misma estructura que la tabla del HTML/dashboard,
  // y columnas de a pares ($, N°) por período cuando hay dotación RG/RP
  // disponible — mismo formato del Excel real de Finanzas (pedido
  // explícito del usuario 17-ago-2026: "el flujo de caja que yo
  // realizaba en Excel colocaba la dotación en los subgrupos, mantén
  // ese formato").
  const detalle = workbook.addWorksheet("Detalle");
  /** Columna 1-indexada de la celda de VALOR del período i (1=Concepto). La celda "N°" vecina es col+1 cuando `conColumnaN`. */
  const colValor = (i: number) => (conColumnaN ? 2 : 1) * i + 2;
  /** Número de columna (1-indexado) -> letra de columna Excel ("A", "Z", "AA", ...). */
  function columnaALetra(col: number): string {
    let letra = "";
    let n = col;
    while (n > 0) {
      const resto = (n - 1) % 26;
      letra = String.fromCharCode(65 + resto) + letra;
      n = Math.floor((n - 1) / 26);
    }
    return letra;
  }
  /** Referencia de celda Excel ("AB12") para (columna 1-indexada, fila 1-indexada). */
  function refCelda(col: number, fila: number): string {
    return `${columnaALetra(col)}${fila}`;
  }

  if (conColumnaN) {
    const fila1: (string | number)[] = ["Concepto"];
    const fila2: (string | number)[] = [""];
    periodos.forEach((p) => {
      fila1.push(p.slice(0, 7), "");
      fila2.push("$", "N°");
    });
    const headerRow1 = detalle.addRow(fila1);
    const headerRow2 = detalle.addRow(fila2);
    [headerRow1, headerRow2].forEach((row) =>
      row.eachCell((cell) => {
        cell.font = {
          name: FUENTE_MARCA,
          bold: true,
          color: { argb: "FFFFFFFF" },
        };
        cell.fill = FILL_HEADER;
      }),
    );
    detalle.mergeCells(1, 1, 2, 1); // "Concepto" ocupa las 2 filas de header
    periodos.forEach((_, i) => {
      const col = colValor(i);
      detalle.mergeCells(1, col, 1, col + 1); // nombre del período ocupa sus 2 columnas
    });
  } else {
    const headerRow = detalle.addRow([
      "Concepto",
      ...periodos.map((p) => p.slice(0, 7)),
    ]);
    headerRow.eachCell((cell) => {
      cell.font = {
        name: FUENTE_MARCA,
        bold: true,
        color: { argb: "FFFFFFFF" },
      };
      cell.fill = FILL_HEADER;
    });
  }

  // Dotación (N°) total — misma fila que el "N°" del Excel original,
  // antes de los conceptos monetarios. Ocupa igual las 2 columnas del
  // período (deja la 2da en blanco) para no desalinear el resto de la
  // tabla cuando hay columnas de a pares.
  let filaDotacionNumero: number | null = null;
  if (dotacionPorPeriodo && dotacionPorPeriodo.size > 0) {
    const filaDotacion: (string | number)[] = ["Dotación (N°)"];
    const celdasProyectadas: number[] = [];
    periodos.forEach((p, i) => {
      const punto = dotacionPorPeriodo.get(p);
      filaDotacion.push(punto ? punto.total : "");
      if (conColumnaN) filaDotacion.push("");
      if (punto && !punto.esReal) celdasProyectadas.push(colValor(i));
    });
    const row = detalle.addRow(filaDotacion);
    filaDotacionNumero = row.number;
    row.font = { name: FUENTE_MARCA, color: { argb: "FF475569" } };
    for (const colNum of celdasProyectadas)
      row.getCell(colNum).fill = FILL_PROYECTADO;
    row.eachCell((cell, colNumber) => {
      if (colNumber > 1) cell.numFmt = "#,##0";
    });
  }

  // Fila de cada concepto ANTES de escribir ninguna — así una fórmula
  // puede referenciar una fila que todavía no se escribió (ej. Anticipo
  // referencia a Remuneración, que va más abajo en FILAS_DETALLE).
  // Derivado de `detalle.rowCount` real (headers + Dotación ya
  // escritos), nunca re-calculado a mano — evita que se desincronice
  // con el orden real de escritura.
  const filaNumeroPorConcepto = new Map<string, number>();
  {
    let cursor = detalle.rowCount;
    for (const fila of FILAS) {
      cursor++;
      filaNumeroPorConcepto.set(fila.concepto, cursor);
      for (const sub of fila.sub ?? []) {
        cursor++;
        filaNumeroPorConcepto.set(sub.concepto, cursor);
      }
    }
  }

  /**
   * Fórmula real de Excel (con link a otras celdas) para un concepto
   * PROYECTADO — pedido explícito del usuario 17-ago-2026: "me gustaría
   * que existiera un link en la fórmula en el Excel, ya que al parecer
   * el cálculo de los flujos no está considerando la dotación". Se
   * escribe SIEMPRE con `result` = el monto ya calculado (mismo número
   * que antes) para que se vea correcto sin depender de que Excel
   * recalcule al abrir — pero ahora es una fórmula real, clickeable,
   * que sí referencia la celda de Dotación/Remuneración correspondiente.
   * `null` si no hay una fórmula segura de construir (ej. primer
   * período del rango, sin columna anterior de dónde tomar el link).
   */
  function formulaProyectada(
    concepto: string,
    monto: number,
    metodoCalculo: string | null,
    i: number,
  ): { formula: string; result: number } | null {
    const col = colValor(i);
    if (concepto === "anticipo") {
      const filaRemun = filaNumeroPorConcepto.get("remuneracion");
      if (!filaRemun) return null;
      // El % de Anticipo se AUTO-APRENDE (ver `pctSobreRemuneracionAprendidoPura`
      // en refresh.ts) — nunca es 0.24 fijo salvo que la compañía no tenga
      // historia real todavía. Bug real corregido 24-sep-2026: esta
      // fórmula quedaba hardcodeada en 0.24 aunque `monto` ya reflejaba el
      // % real aplicado — si alguien recalculaba el Excel (F9), el valor
      // cambiaba y dejaba de coincidir con lo que la app mostraba.
      //
      // El aguinaldo (Fiestas Patrias/Navidad) se paga CON el Anticipo, no
      // con la Remuneración (aclaración explícita del usuario, mismo día:
      // "los aguinaldos se pagan con los anticipos, así funciona en la
      // realidad") — `monto` ya lo trae sumado (ver engine.ts), así que se
      // descuenta ANTES de derivar el % real sobre Remuneración, y se
      // vuelve a sumar como un número aparte en la fórmula. Así, si se
      // edita la Dotación y Excel recalcula, el aguinaldo no escala
      // proporcionalmente con la Remuneración (no depende de ella).
      const remuneracionPunto = valorPorConceptoYPeriodo.get(
        `remuneracion::${periodos[i]}`,
      );
      if (!remuneracionPunto || remuneracionPunto.monto === 0) return null;
      const aguinaldo = Math.round(
        aguinaldoAnticipoPorPeriodo?.get(periodos[i]) ?? 0,
      );
      const pctReal = (monto - aguinaldo) / remuneracionPunto.monto;
      const sufijoAguinaldo =
        aguinaldo !== 0 ? `${aguinaldo >= 0 ? "+" : ""}${aguinaldo}` : "";
      return {
        formula: `=${refCelda(col, filaRemun)}*${pctReal}${sufijoAguinaldo}`,
        result: monto,
      };
    }
    if (concepto === "reliquidacion") {
      const filaRemun = filaNumeroPorConcepto.get("remuneracion");
      if (!filaRemun) return null;
      // Reliquidación es 1% fijo desde el 24-sep-2026 (ya no se
      // auto-aprende, ver refresh.ts) — 0.01 siempre coincide con el
      // monto real.
      return {
        formula: `=${refCelda(col, filaRemun)}*0.01`,
        result: monto,
      };
    }
    if (concepto === "cotizacion") {
      const filaAnt = filaNumeroPorConcepto.get("anticipo");
      const filaRemun = filaNumeroPorConcepto.get("remuneracion");
      const filaRelq = filaNumeroPorConcepto.get("reliquidacion");
      if (!filaAnt || !filaRemun || !filaRelq) return null;
      return {
        formula: `=(${refCelda(col, filaAnt)}+${refCelda(col, filaRemun)}+${refCelda(col, filaRelq)})*0.3`,
        result: monto,
      };
    }
    if (concepto === "total_nomina") {
      const filas = [
        "anticipo",
        "remuneracion",
        "finiquito",
        "reliquidacion",
        "cotizacion",
        "sence",
      ].map((c) => filaNumeroPorConcepto.get(c));
      if (filas.some((f) => !f)) return null;
      return {
        formula: `=${filas.map((f) => refCelda(col, f!)).join("+")}`,
        result: monto,
      };
    }
    if (
      concepto === "remuneracion" &&
      metodoCalculo === "costo_por_cabeza_x_dotacion"
    ) {
      // El costo base YA NO se encadena del mes anterior (fix real
      // 24-sep-2026 — ver `costoBasePorCabezaPura` en refresh.ts: es el
      // promedio de los últimos 3 meses REALES, fijo, sin beneficios). No
      // hay una celda de "mes anterior" a la que enlazar ese costo, así
      // que se deriva la tasa efectiva de ESTE período (monto ÷ dotación
      // de este mismo mes, que incluye los beneficios pagados con
      // Remuneración como un residual dentro de la tasa) y se linkea SOLO
      // a la Dotación actual — si se edita la Dotación, el monto se
      // recalcula proporcionalmente.
      if (!filaDotacionNumero) return null;
      const dotacionActualPunto = dotacionPorPeriodo?.get(periodos[i]);
      if (!dotacionActualPunto?.total) return null;
      const tasaEfectiva = monto / dotacionActualPunto.total;
      const refDotacionActual = refCelda(col, filaDotacionNumero);
      return {
        formula: `=${refDotacionActual}*${tasaEfectiva}`,
        result: monto,
      };
    }
    return null;
  }

  function agregarFilaConcepto(
    concepto: string,
    label: string,
    negrita: boolean,
    tieneColumnaN?: boolean,
  ) {
    const fila: (string | number | { formula: string; result: number })[] = [
      label,
    ];
    const celdasProyectadas: number[] = [];
    periodos.forEach((p, i) => {
      const punto = valorPorConceptoYPeriodo.get(`${concepto}::${p}`);
      if (!punto) {
        fila.push("");
      } else if (!punto.esReal) {
        celdasProyectadas.push(colValor(i));
        const conFormula = formulaProyectada(
          concepto,
          punto.monto,
          punto.metodoCalculo,
          i,
        );
        fila.push(conFormula ?? punto.monto);
      } else {
        fila.push(punto.monto);
      }
      if (conColumnaN) {
        const n = tieneColumnaN
          ? dotacionPorConceptoYPeriodo?.get(p)?.[
              concepto as keyof DotacionPorConceptoPunto
            ]
          : undefined;
        fila.push(n ?? "");
      }
    });
    const row = detalle.addRow(fila);
    row.font = negrita
      ? { name: FUENTE_MARCA, bold: true }
      : { name: FUENTE_MARCA };
    for (const colNum of celdasProyectadas) {
      row.getCell(colNum).fill = FILL_PROYECTADO;
    }
    row.eachCell((cell, colNumber) => {
      if (colNumber > 1) cell.numFmt = "#,##0";
    });
  }

  for (const fila of FILAS) {
    agregarFilaConcepto(
      fila.concepto,
      fila.label,
      fila.concepto === "total_nomina",
    );
    for (const sub of fila.sub ?? []) {
      agregarFilaConcepto(sub.concepto, sub.label, false, sub.tieneColumnaN);
    }
  }

  // Fila UF, igual que en el HTML/dashboard
  if (ufPorPeriodo.size > 0) {
    const filaUf: (string | number)[] = ["Total Nómina (UF)"];
    periodos.forEach((p) => {
      const totalNomina = valorPorConceptoYPeriodo.get(`total_nomina::${p}`);
      const valorUf = ufPorPeriodo.get(p);
      filaUf.push(totalNomina && valorUf ? totalNomina.monto / valorUf : "");
      if (conColumnaN) filaUf.push("");
    });
    const row = detalle.addRow(filaUf);
    row.font = {
      // Navy — mismo color que la fila "Total Nómina" ($).
      name: FUENTE_MARCA,
      italic: true,
      color: { argb: "FF003865" },
    };
    row.eachCell((cell, colNumber) => {
      if (colNumber > 1) cell.numFmt = "#,##0.0";
    });
  }

  detalle.getColumn(1).width = 22;
  detalle.columns.forEach((col, i) => {
    if (i === 0) return;
    // Columnas "N°" (impares desde la col 3 en adelante, 0-indexed) más
    // angostas que las de monto — mismo criterio visual que el Excel real.
    const esColumnaN = conColumnaN && (i - 1) % 2 === 1;
    col.width = esColumnaN ? 8 : 14;
  });

  // Agrupa/colapsa (outline de columnas de Excel) los períodos anteriores
  // a `columnasAgrupadasHastaPeriodo` — presentes en el archivo pero no
  // expandidos por default, mismo criterio visual que el Excel real de
  // Finanzas (botones "1 2" de agrupación en la esquina superior
  // izquierda). Sin este parámetro, no se agrupa ninguna columna.
  if (columnasAgrupadasHastaPeriodo) {
    periodos.forEach((p, i) => {
      if (p >= columnasAgrupadasHastaPeriodo) return;
      const col = colValor(i);
      detalle.getColumn(col).outlineLevel = 1;
      detalle.getColumn(col).hidden = true;
      if (conColumnaN) {
        detalle.getColumn(col + 1).outlineLevel = 1;
        detalle.getColumn(col + 1).hidden = true;
      }
    });
  }

  const legend = detalle.addRow([]);
  const textoLeyenda =
    "Amarillo = proyectado (fórmula, no dato real ingerido) — mismo criterio que el Excel original." +
    (conColumnaN
      ? " La columna “N°” muestra la dotación (cabezas) que explica el monto RG/RP de esa fila."
      : "");
  detalle.addRow([textoLeyenda]).font = {
    name: FUENTE_MARCA,
    italic: true,
    size: 9,
    color: { argb: "FF94A3B8" },
  };
  void legend;

  // --- Hoja "Metodología" — misma explicación que la sección "¿Cómo se
  // calcula este flujo?" de la app en vivo (metodologia-calculo.tsx),
  // pedido explícito del usuario 17-ago-2026: "faltan las explicaciones
  // de las modificaciones de valores en el excel". Contenido compartido
  // desde metodologia-contenido.ts — nunca duplicado a mano en 2 lugares.
  const metodologia = workbook.addWorksheet("Metodología");
  metodologia.addRow(["¿Cómo se calcula cada concepto?"]).font = {
    name: FUENTE_MARCA,
    bold: true,
    size: 14,
  };
  metodologia.addRow([]);
  const headerMetodologia = metodologia.addRow([
    "Concepto",
    "Fuente real",
    "Fórmula (si no hay dato real)",
  ]);
  headerMetodologia.eachCell((cell) => {
    cell.font = {
      name: FUENTE_MARCA,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    cell.fill = FILL_HEADER;
  });
  for (const c of CONCEPTOS_METODOLOGIA) {
    const row = metodologia.addRow([
      c.concepto,
      c.fuenteReal,
      c.formula ?? "—",
    ]);
    row.font = { name: FUENTE_MARCA };
    row.alignment = { vertical: "top", wrapText: true };
  }

  metodologia.addRow([]);
  metodologia.addRow([
    "¿Por qué sube o baja cada concepto de un mes al siguiente?",
  ]).font = { name: FUENTE_MARCA, bold: true, size: 12 };
  const headerMotor = metodologia.addRow([
    "Concepto",
    "Motor del cambio mensual",
  ]);
  headerMotor.eachCell((cell) => {
    cell.font = {
      name: FUENTE_MARCA,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    cell.fill = FILL_HEADER;
  });
  for (const m of MOTOR_CAMBIO_MENSUAL) {
    const row = metodologia.addRow([m.concepto, m.explicacion]);
    row.font = { name: FUENTE_MARCA };
    row.alignment = { vertical: "top", wrapText: true };
  }

  metodologia.getColumn(1).width = 24;
  metodologia.getColumn(2).width = 60;
  metodologia.getColumn(3).width = 60;

  // --- Hoja "Plan de Obra" — plan de obra (Gespro) + dotación real (Buk)
  // + Plan de Dotación del usuario (SharePoint, ver plan_dotacion — Fase 2,
  // 24-sep-2026). Formato "tidy" (1 fila por obra/mes) para poder
  // filtrar/pivotear directo en Excel.
  const ORIGEN_LABEL: Record<string, string> = {
    plan: "Plan (usuario)",
    sin_plan: "Sin plan",
  };
  if (planObraDotacion && planObraDotacion.length > 0) {
    const planObra = workbook.addWorksheet("Plan de Obra");
    const headerPlanObra = planObra.addRow([
      "Obra",
      "Comuna",
      "Tipo",
      "Cliente",
      "Unidades",
      "Inicio Obra",
      "Fin Obra",
      "Duración (meses)",
      "Período",
      "Dotación Real (Buk)",
      "Dotación Proyectada (acumulada)",
      "Variación Neta (Altas−Bajas)",
      "Origen Variación",
    ]);
    headerPlanObra.eachCell((cell) => {
      cell.font = {
        name: FUENTE_MARCA,
        bold: true,
        color: { argb: "FFFFFFFF" },
      };
      cell.fill = FILL_HEADER;
    });

    for (const fila of planObraDotacion) {
      const row = planObra.addRow([
        fila.obraNombre,
        fila.comuna ?? "",
        fila.tipo ?? "",
        fila.cliente ?? "",
        fila.unidades ?? "",
        fila.inicioObra ?? "",
        fila.finObra ?? "",
        fila.durObraMeses ?? "",
        fila.periodo.slice(0, 7),
        fila.dotacionReal ?? "",
        fila.dotacionProyectada ?? "",
        fila.variacionNeta ?? "",
        fila.origenVariacion ? ORIGEN_LABEL[fila.origenVariacion] : "Sin dato",
      ]);
      row.font = { name: FUENTE_MARCA };
      if (fila.origenVariacion === "sin_plan") {
        row.getCell(11).fill = FILL_SIN_DATO;
        row.getCell(12).fill = FILL_SIN_DATO;
      }
    }

    planObra.getColumn(1).width = 28;
    planObra.getColumn(2).width = 16;
    planObra.getColumn(3).width = 10;
    planObra.getColumn(4).width = 12;
    planObra.getColumn(9).width = 10;
    planObra.getColumn(11).width = 18;
    planObra.getColumn(13).width = 20;

    const notaPlanObra = planObra.addRow([]);
    planObra.addRow([
      "Gris = la obra no tiene ninguna variación cargada en el Plan de Dotación para ese mes — la dotación se mantiene plana (última real), no se inventa una curva.",
    ]).font = {
      name: FUENTE_MARCA,
      italic: true,
      size: 9,
      color: { argb: "FF94A3B8" },
    };
    void notaPlanObra;
  }

  // La hoja "Proyección Headcount" (carga manual re-subida) y su hoja
  // técnica `_fcn_baseline` se retiraron en la Fase 3 (24-sep-2026): la
  // dotación futura ahora viene del Plan de Dotación en SharePoint (ver
  // plan-dotacion/), que reemplaza por completo ese flujo de ida y vuelta.
  // La hoja "Plan de Obra" (arriba) sigue cubriendo el mismo detalle por
  // obra/mes, en formato tidy.

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
