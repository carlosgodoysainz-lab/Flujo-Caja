import ExcelJS from "exceljs";

async function main() {
  const ruta = process.argv[2];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(ruta);
  console.log(
    "Hojas:",
    wb.worksheets.map((s) => s.name),
  );
  const detalle = wb.getWorksheet("Detalle") ?? wb.worksheets[0];
  console.log(
    "\nUsando hoja:",
    detalle.name,
    "| filas:",
    detalle.rowCount,
    "| columnas:",
    detalle.columnCount,
  );
  console.log("\nPrimeras 8 filas (primeras 20 columnas):");
  for (let r = 1; r <= Math.min(8, detalle.rowCount); r++) {
    const row = detalle.getRow(r);
    const vals: unknown[] = [];
    for (let c = 1; c <= Math.min(20, detalle.columnCount); c++) {
      vals.push(row.getCell(c).value);
    }
    console.log(r, vals);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
