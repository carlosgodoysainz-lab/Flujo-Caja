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
import { FILAS_DETALLE as FILAS } from "@/features/cash-flow/lib/filas-detalle";
import {
  CONCEPTOS_METODOLOGIA,
  MOTOR_CAMBIO_MENSUAL,
} from "@/features/cash-flow/lib/metodologia-contenido";

// Fuentes Office-safe de Marca Personal CGS (skill marca-carlos-godoy,
// reemplaza Marca Maestra — decisión explícita del usuario 21-ago-2026):
// Segoe UI Semibold para títulos/cabeceras (filas con `bold: true`),
// Segoe UI para el resto — Unbounded/Manrope (las fuentes web de la
// marca) no están garantizadas en el Excel del destinatario.
const FUENTE_TITULO = "Segoe UI Semibold";
const FUENTE_CUERPO = "Segoe UI";

// Mismo amarillo que el Excel ORIGINAL usaba para marcar proyección — ver
// el hallazgo inicial ("lo que está en amarillo es lo que falta
// completar"). Aquí el significado es idéntico: celda calculada por
// fórmula, no dato real ingerido.
const FILL_PROYECTADO: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFFF00" },
};
// Voltio Azul (Marca Personal CGS) — reemplaza el navy de Marca Maestra
// como fill de cabecera de tabla (decisión explícita del usuario
// 21-ago-2026). Texto blanco encima pasa WCAG AA (5.27:1).
const FILL_HEADER: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1554F3" },
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

  // Wordmark CGS — solo en esta hoja (portada del archivo), mismo criterio
  // de marca que "logo solo en portada/primera hoja". Marca Personal CGS
  // es un wordmark tipográfico puro (sin isotipo/imagen, por diseño de la
  // marca — ver references/wordmark.md), así que va como texto, no como
  // imagen embebida (reemplaza el logo .jpg de Marca Maestra, decisión
  // explícita del usuario 21-ago-2026).
  resumen.getCell("A1").value = "CGS";
  resumen.getCell("A1").font = {
    name: FUENTE_TITULO,
    bold: true,
    size: 20,
    color: { argb: "FFFF5A1F" },
  };
  resumen.addRow([]);
  resumen.addRow([]);

  resumen.addRow(["Flujo de Caja Nómina — Grupo Maestra"]).font = {
    name: FUENTE_TITULO,
    bold: true,
    size: 14,
  };
  resumen.addRow([
    `Generado: ${generadoEn.toLocaleString("es-CL")}`,
    `Período: ${periodoDesde} a ${periodoHasta}`,
  ]).font = { name: FUENTE_CUERPO };
  resumen.addRow([]);
  resumen.addRow(["KPI", "Valor"]).font = {
    name: FUENTE_TITULO,
    bold: true,
  };

  /** Agrega una fila KPI con fuente Arial y formato de número en la columna "Valor". */
  function agregarFilaKpi(
    label: string,
    valor: number | string,
    numFmt?: string,
  ) {
    const row = resumen.addRow([label, valor]);
    row.font = { name: FUENTE_CUERPO };
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
    "Obras con dotación estimada por el modelo",
    kpis.obrasConEstimacion,
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
          name: FUENTE_TITULO,
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
        name: FUENTE_TITULO,
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
    row.font = { name: FUENTE_CUERPO, color: { argb: "FF475569" } };
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
      return {
        formula: `=${refCelda(col, filaRemun)}*0.24`,
        result: monto,
      };
    }
    if (concepto === "reliquidacion") {
      const filaRemun = filaNumeroPorConcepto.get("remuneracion");
      if (!filaRemun) return null;
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
      // Único caso con dependencia de OTRO período: costo promedio por
      // cabeza del mes anterior × dotación actual. Sin columna anterior
      // en este mismo sheet (primer período del rango) no hay celda a
      // la que enlazar — se deja como valor plano en ese caso.
      if (i === 0 || !filaDotacionNumero) return null;
      const colAnterior = colValor(i - 1);
      const remunAnteriorPunto = valorPorConceptoYPeriodo.get(
        `remuneracion::${periodos[i - 1]}`,
      );
      const dotacionAnteriorPunto = dotacionPorPeriodo?.get(periodos[i - 1]);
      const dotacionActualPunto = dotacionPorPeriodo?.get(periodos[i]);
      if (
        !remunAnteriorPunto ||
        !dotacionAnteriorPunto?.total ||
        !dotacionActualPunto?.total
      )
        return null;
      // Residual = Beneficios/Bonos del mes (se suman de forma implícita
      // dentro de Remuneración, ver engine.ts) — no tiene su propia celda
      // linkeable, así que queda como número fijo sumado a la fórmula:
      // la parte costo-por-cabeza × dotación SÍ queda viva (cambia si se
      // edita la Dotación), el residual de Beneficios es una foto fija.
      const baseFormula =
        (remunAnteriorPunto.monto / dotacionAnteriorPunto.total) *
        dotacionActualPunto.total;
      const residual = Math.round(monto - baseFormula);
      const refRemunAnterior = refCelda(
        colAnterior,
        filaNumeroPorConcepto.get("remuneracion")!,
      );
      const refDotacionAnterior = refCelda(colAnterior, filaDotacionNumero);
      const refDotacionActual = refCelda(col, filaDotacionNumero);
      const sufijoResidual =
        residual !== 0 ? `${residual >= 0 ? "+" : ""}${residual}` : "";
      return {
        formula: `=${refRemunAnterior}/${refDotacionAnterior}*${refDotacionActual}${sufijoResidual}`,
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
      ? { name: FUENTE_TITULO, bold: true }
      : { name: FUENTE_CUERPO };
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
      // Combustión — mismo color que la fila "Total Nómina" ($), Marca
      // Personal CGS (reemplaza el navy de Marca Maestra).
      name: FUENTE_CUERPO,
      italic: true,
      color: { argb: "FFFF5A1F" },
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
    name: FUENTE_CUERPO,
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
    name: FUENTE_TITULO,
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
      name: FUENTE_TITULO,
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
    row.font = { name: FUENTE_CUERPO };
    row.alignment = { vertical: "top", wrapText: true };
  }

  metodologia.addRow([]);
  metodologia.addRow([
    "¿Por qué sube o baja cada concepto de un mes al siguiente?",
  ]).font = { name: FUENTE_TITULO, bold: true, size: 12 };
  const headerMotor = metodologia.addRow([
    "Concepto",
    "Motor del cambio mensual",
  ]);
  headerMotor.eachCell((cell) => {
    cell.font = {
      name: FUENTE_TITULO,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    cell.fill = FILL_HEADER;
  });
  for (const m of MOTOR_CAMBIO_MENSUAL) {
    const row = metodologia.addRow([m.concepto, m.explicacion]);
    row.font = { name: FUENTE_CUERPO };
    row.alignment = { vertical: "top", wrapText: true };
  }

  metodologia.getColumn(1).width = 24;
  metodologia.getColumn(2).width = 60;
  metodologia.getColumn(3).width = 60;

  // --- Hoja "Plan de Obra" — plan de obra (Gespro) + dotación real (Buk)
  // + flujo de dotación estimada (altas−bajas del modelo de curva por
  // obra similar) — pedido explícito del usuario. Formato "tidy" (1 fila
  // por obra/mes) para poder filtrar/pivotear directo en Excel.
  const ORIGEN_LABEL: Record<string, string> = {
    manual: "Manual",
    buk_real: "Buk (real)",
    modelo_estimado: "Estimado (modelo)",
    sin_dato_referencia: "Sin obra de referencia",
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
        name: FUENTE_TITULO,
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
      row.font = { name: FUENTE_CUERPO };
      if (fila.origenVariacion === "modelo_estimado") {
        row.getCell(11).fill = FILL_PROYECTADO;
        row.getCell(12).fill = FILL_PROYECTADO;
      } else if (fila.origenVariacion === "sin_dato_referencia") {
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
      "Amarillo = dotación estimada por el modelo (curva de obras similares). Gris = el modelo no tenía ninguna obra de referencia con dato real ese mes — el valor es un placeholder (0 acumulado), no una estimación real.",
    ]).font = {
      name: FUENTE_CUERPO,
      italic: true,
      size: 9,
      color: { argb: "FF94A3B8" },
    };
    void notaPlanObra;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
