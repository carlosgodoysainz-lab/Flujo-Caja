// Inspección de las fórmulas REALES del Excel de Flujo de Caja más
// reciente (ahora desbloqueado) — para corregir el motor de cálculo
// según el modelo real, no una aproximación.
import ExcelJS from "exceljs";

const FILE =
  "C:/Users/cgodoys/OneDrive - Maestra Servicios/Documentos/Recursos Humanos General/Recursos Humanos/Flujo de Caja/Flujo_Caja_23_06_26.xlsx";

function cellInfo(cell: ExcelJS.Cell) {
  const v = cell.value;
  if (v && typeof v === "object" && "formula" in v) {
    return {
      formula: (v as { formula: string }).formula,
      result: (v as { result: unknown }).result,
    };
  }
  return { value: v };
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const detalle = wb.getWorksheet("Detalle")!;

  for (const col of [79, 83, 87, 95, 99, 103, 107]) {
    console.log(`\n=== Columna ${col} ===`);
    for (let r = 4; r <= 14; r++) {
      const label = detalle.getCell(r, 2).value;
      console.log(
        `  Fila ${r} (${label}): ${JSON.stringify(cellInfo(detalle.getCell(r, col)))}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
