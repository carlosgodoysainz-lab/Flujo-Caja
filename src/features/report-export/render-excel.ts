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
  DotacionRgRpPunto,
} from "@/features/headcount/services/dotacion-total";
import type { PlanObraDotacionFila } from "@/features/headcount/services/plan-obra-dotacion";
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
   * Dotación (N°) RG/RP por período — misma columna que el Excel real de
   * Finanzas trae al lado de cada sub-fila RG/RP de Anticipo/
   * Remuneración (pedido explícito del usuario 17-ago-2026: "el flujo de
   * caja que yo realizaba en Excel colocaba la dotación en los
   * subgrupos, mantén ese formato"). Si no se provee, la hoja "Detalle"
   * queda con 1 columna por período (comportamiento previo).
   */
  dotacionRgRpPorPeriodo?: Map<string, DotacionRgRpPunto>;
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
    dotacionRgRpPorPeriodo,
    planObraDotacion,
    columnasAgrupadasHastaPeriodo,
    periodoDesde,
    periodoHasta,
    generadoEn,
  } = params;
  const conColumnaN = !!dotacionRgRpPorPeriodo;

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
    row.font = { name: FUENTE_MARCA, color: { argb: "FF475569" } };
    for (const colNum of celdasProyectadas)
      row.getCell(colNum).fill = FILL_PROYECTADO;
    row.eachCell((cell, colNumber) => {
      if (colNumber > 1) cell.numFmt = "#,##0";
    });
  }

  function agregarFilaConcepto(
    concepto: string,
    label: string,
    negrita: boolean,
    dotacion?: "rg" | "rp",
  ) {
    const fila: (string | number)[] = [label];
    const celdasProyectadas: number[] = [];
    periodos.forEach((p, i) => {
      const punto = valorPorConceptoYPeriodo.get(`${concepto}::${p}`);
      fila.push(punto ? punto.monto : "");
      if (punto && !punto.esReal) celdasProyectadas.push(colValor(i));
      if (conColumnaN) {
        const n = dotacion
          ? dotacionRgRpPorPeriodo?.get(p)?.[dotacion]
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
      agregarFilaConcepto(sub.concepto, sub.label, false, sub.dotacion);
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
    cell.font = { name: FUENTE_MARCA, bold: true, color: { argb: "FFFFFFFF" } };
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
    cell.font = { name: FUENTE_MARCA, bold: true, color: { argb: "FFFFFFFF" } };
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
      name: FUENTE_MARCA,
      italic: true,
      size: 9,
      color: { argb: "FF94A3B8" },
    };
    void notaPlanObra;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
