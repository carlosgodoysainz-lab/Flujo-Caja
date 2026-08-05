// Script de verificación manual (no forma parte del build ni de la suite
// de tests) — corre el parser real contra el archivo Gespro real del
// usuario para validar la lógica antes de escribir el test unitario con
// fixture sintético. Ejecutar con: npx tsx scripts/verify-gespro-parser.ts
import fs from "node:fs/promises";
import { parseGesproWorkbook } from "../src/features/obras/services/gespro-parser";

const FILE =
  "C:/Users/cgodoys/OneDrive - Maestra Servicios/Documentos/Recursos Humanos General/Recursos Humanos/Plan de Obra/Plan de obra Gespro/03_08_26/20260803 Plan de Obras Nuevo Gespro.xlsx";

async function main() {
  const buffer = await fs.readFile(FILE);
  const result = await parseGesproWorkbook(buffer);
  console.log(`Obras parseadas: ${result.obras.length}`);
  console.log(`Errores: ${result.errores.length}`);
  if (result.errores.length)
    console.log(JSON.stringify(result.errores.slice(0, 5), null, 2));
  console.log("--- primeras 3 obras ---");
  console.log(JSON.stringify(result.obras.slice(0, 3), null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
