/**
 * Script de validación manual — NO es parte de la app, no se importa
 * desde ningún otro archivo. Corre el mismo parser real
 * (`parseHeadcountUpload`) que usa `/dotacion` contra un archivo .xlsx en
 * disco, para confirmar el fix del baseline sin pasar por el navegador.
 *
 * Uso: npx tsx --env-file=.env.local scripts/validar-baseline-excel.ts <ruta-al-xlsx>
 */
import { createClient } from "@supabase/supabase-js";
import { parseHeadcountUpload } from "../src/features/headcount/services/parse-headcount-upload";
import { readFileSync } from "node:fs";

async function main() {
  const ruta = process.argv[2];
  if (!ruta) {
    console.error(
      "Uso: npx tsx --env-file=.env.local scripts/validar-baseline-excel.ts <ruta-al-xlsx>",
    );
    process.exit(1);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: obras, error } = await supabase
    .from("obras")
    .select("id, nombre");
  if (error) {
    console.error("Error consultando obras:", error.message);
    process.exit(1);
  }
  const obrasConocidas = new Map(
    (obras ?? []).map((o) => [o.id, o.nombre as string]),
  );
  console.log(`Obras conocidas en la BD: ${obrasConocidas.size}`);

  const buffer = readFileSync(ruta);
  const resultado = await parseHeadcountUpload(buffer, obrasConocidas);

  console.log("\n=== Resultado del parser real de la app ===");
  console.log("baselinePresente:", resultado.baselinePresente);
  console.log("generadoEnArchivo:", resultado.generadoEnArchivo);
  console.log("totalCeldasConValor:", resultado.totalCeldasConValor);
  console.log("celdasSinCambios:", resultado.celdasSinCambios);
  console.log("celdas detectadas como EDITADAS:", resultado.celdas.length);
  console.log("celdasBorradas:", resultado.celdasBorradas.length);
  console.log("errores:", resultado.errores.length);
  console.log("advertenciasNombre:", resultado.advertenciasNombre.length);

  if (resultado.celdas.length > 0) {
    console.log("\nDetalle de celdas detectadas como editadas (primeras 20):");
    console.log(resultado.celdas.slice(0, 20));
  }
  if (resultado.errores.length > 0) {
    console.log("\nErrores:");
    console.log(resultado.errores.slice(0, 10));
  }

  console.log("\n=== Veredicto ===");
  if (resultado.baselinePresente && resultado.celdas.length === 0) {
    console.log(
      "✅ FIX CONFIRMADO: archivo sin editar -> 0 celdas detectadas como manuales.",
    );
  } else if (!resultado.baselinePresente) {
    console.log(
      "⚠️ El archivo NO trae la hoja de baseline (modo compatibilidad) — revisar por qué.",
    );
  } else {
    console.log(
      `❌ Se detectaron ${resultado.celdas.length} celdas como editadas en un archivo que no se tocó.`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
