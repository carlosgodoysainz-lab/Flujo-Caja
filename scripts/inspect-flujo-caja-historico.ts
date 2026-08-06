// Investigación de la estructura EXACTA de la hoja "Detalle" del Excel
// maestro de Flujo de Caja — mapeo columna↔mes, corte real/proyección
// (por color de relleno, no por fórmula — ver hallazgo de que a veces hay
// valores manuales tipeados incluso en columnas "proyección"), y
// semántica de las columnas "N°" junto a Remuneraciones RG/RP (dotación
// real histórica). Script de investigación puntual, no parte de la app.
import ExcelJS from "exceljs";

const FILE =
  "C:/Users/cgodoys/OneDrive - Maestra Servicios/Documentos/Recursos Humanos General/Recursos Humanos/Flujo de Caja/Flujo_Caja_23_06_26.xlsx";

function cellInfo(cell: ExcelJS.Cell) {
  const v = cell.value;
  const fill = cell.fill as ExcelJS.FillPattern | undefined;
  const argb =
    fill?.type === "pattern"
      ? (fill.fgColor as { argb?: string })?.argb
      : undefined;
  if (v && typeof v === "object" && "formula" in v) {
    return {
      formula: (v as { formula: string }).formula,
      result: (v as { result: unknown }).result,
      argb,
    };
  }
  return { value: v, argb };
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const detalle = wb.getWorksheet("Detalle")!;

  console.log("Dimensiones:", detalle.dimensions);
  console.log("\nMerges:", JSON.stringify(detalle.model.merges, null, 0));

  console.log("\n--- Fila 1 (anotación Proyección) ---");
  for (let c = 1; c <= 20; c++) {
    const cell = detalle.getCell(1, c);
    if (cell.value)
      console.log(
        `  col ${c} (${cell.address}): ${JSON.stringify(cell.value)}`,
      );
  }

  console.log(
    "\n--- Fila 2 (Flujo Real / años) — todas las celdas con texto ---",
  );
  for (let c = 1; c <= 109; c++) {
    const cell = detalle.getCell(2, c);
    if (cell.value)
      console.log(
        `  col ${c} (${cell.address}): ${JSON.stringify(cell.value)}`,
      );
  }

  console.log("\n--- Fila 3 (Concepto + meses), col 1-20 ---");
  for (let c = 1; c <= 20; c++) {
    const cell = detalle.getCell(3, c);
    console.log(`  col ${c} (${cell.address}): ${JSON.stringify(cell.value)}`);
  }

  console.log(
    "\n--- Colores de relleno alrededor del corte real/proyección (fila 5 = Anticipo RG), columnas 85-95 ---",
  );
  for (let c = 85; c <= 95; c++) {
    const cell = detalle.getCell(5, c);
    console.log(
      `  col ${c} (${cell.address}):`,
      JSON.stringify(cellInfo(cell)),
    );
  }

  console.log(
    "\n--- Fila 8 (Remuneraciones RG) + su columna N° vecina, columnas 3-12 ---",
  );
  for (let c = 3; c <= 12; c++) {
    const cell = detalle.getCell(8, c);
    console.log(
      `  col ${c} (${cell.address}):`,
      JSON.stringify(cellInfo(cell)),
    );
  }

  console.log("\n--- Fila 13 (Aporte SENCE), columnas 3-20 ---");
  for (let c = 3; c <= 20; c++) {
    const cell = detalle.getCell(13, c);
    if (cell.value != null)
      console.log(
        `  col ${c} (${cell.address}):`,
        JSON.stringify(cellInfo(cell)),
      );
  }

  console.log("\n--- Última columna con datos en fila 5 (Anticipo RG) ---");
  for (let c = 109; c >= 95; c--) {
    const cell = detalle.getCell(5, c);
    if (cell.value != null) {
      console.log(
        `  col ${c} (${cell.address}):`,
        JSON.stringify(cellInfo(cell)),
      );
      break;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
