// Seed manual de `obras` desde el archivo Gespro LOCAL (acceso directo a
// disco, sin depender del login de Graph API que sigue bloqueado por el
// consentimiento de administrador pendiente). Usa el MISMO parser que la
// app real (gespro-parser.ts) — solo cambia cómo se obtiene el buffer
// (fs.readFile en vez de Graph API) y cómo se escribe a Supabase (cliente
// directo en vez de createServiceClient(), que tiene el guard server-only).
//
// Ejecutar con: npx tsx --env-file=.env.local scripts/seed-obras-from-local-gespro.ts
import fs from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { parseGesproWorkbook } from "../src/features/obras/services/gespro-parser";

const FILE =
  "C:/Users/cgodoys/OneDrive - Maestra Servicios/Documentos/Recursos Humanos General/Recursos Humanos/Plan de Obra/Plan de obra Gespro/03_08_26/20260803 Plan de Obras Nuevo Gespro.xlsx";

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );

  const buffer = await fs.readFile(FILE);
  const { obras, errores } = await parseGesproWorkbook(buffer);

  console.log(`Obras parseadas: ${obras.length}, errores: ${errores.length}`);
  if (errores.length) console.log(errores);

  const { error, data } = await supabase
    .from("obras")
    .upsert(
      obras.map((o) => ({
        codigo_gespro: o.codigoGespro,
        nombre: o.nombre,
        comuna: o.comuna,
        tipo: o.tipo,
        cliente: o.cliente,
        unidades: o.unidades,
        inicio_obra: o.inicioObra?.toISOString().slice(0, 10) ?? null,
        fin_obra: o.finObra?.toISOString().slice(0, 10) ?? null,
        dur_obra_meses: o.durObraMeses,
        fuente_archivo:
          "20260803 Plan de Obras Nuevo Gespro.xlsx (seed manual, sin Graph API)",
        fuente_actualizado_at: new Date().toISOString(),
      })),
      { onConflict: "nombre" },
    )
    .select("id, nombre");

  if (error) {
    console.error("Error en upsert:", error);
    process.exit(1);
  }

  console.log(`Guardadas ${data?.length ?? 0} obras en Supabase.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
