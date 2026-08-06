// Auditoría solicitada por el usuario: comparar, mes por mes y concepto
// por concepto, lo que dice el Excel REAL (recién leído del disco) contra
// lo que hay guardado en cash_flow_monthly/dotacion_mensual — para
// confirmar que no hay discrepancias silenciosas. No es parte de la app.
import { readFileSync, statSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { parseFlujoCajaHistorico } from "../src/features/ingestion/excel-parser/flujo-caja-historico-parser";

const FILE =
  "C:/Users/cgodoys/OneDrive - Maestra Servicios/Documentos/Recursos Humanos General/Recursos Humanos/Flujo de Caja/Flujo_Caja_23_06_26.xlsx";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function fmt(n: number): string {
  return new Intl.NumberFormat("es-CL").format(Math.round(n));
}

async function main() {
  const stats = statSync(FILE);
  console.log(`Archivo: ${FILE}`);
  console.log(`Última modificación real: ${stats.mtime.toISOString()}\n`);

  const buffer = readFileSync(FILE);
  const { lineas, dotacion, errores } = await parseFlujoCajaHistorico(buffer);
  if (errores.length > 0) console.log("Errores del parser:", errores);

  const excelPorClave = new Map<string, number>();
  for (const l of lineas) {
    excelPorClave.set(
      `${l.periodo.toISOString().slice(0, 10)}::${l.concepto}`,
      l.monto,
    );
  }

  const periodosExcel = [
    ...new Set(lineas.map((l) => l.periodo.toISOString().slice(0, 10))),
  ].sort();
  console.log(
    `Excel: ${periodosExcel.length} meses reales, ${lineas.length} líneas de dato.`,
  );
  console.log(`Rango: ${periodosExcel[0]} → ${periodosExcel.at(-1)}\n`);

  // --- Comparar cash_flow_monthly ---
  const { data: dbRows } = await supabase
    .from("cash_flow_monthly")
    .select("periodo, concepto, monto, es_real, metodo_calculo")
    .in("concepto", [
      "anticipo_rg",
      "anticipo_rp",
      "remuneracion_rg",
      "remuneracion_rp",
      "finiquito",
      "reliquidacion",
      "cotizacion",
      "sence",
    ]);

  const dbPorClave = new Map<
    string,
    { monto: number; metodo: string | null }
  >();
  for (const r of dbRows ?? []) {
    dbPorClave.set(`${r.periodo}::${r.concepto}`, {
      monto: Number(r.monto),
      metodo: r.metodo_calculo,
    });
  }

  let coincidencias = 0;
  let discrepanciasMonto = 0;
  let discrepanciasMetodo = 0; // Excel tiene dato real pero la BD usa otra fuente/método
  let faltantesEnDb = 0;
  const detalleDiscrepancias: string[] = [];

  for (const [clave, montoExcel] of excelPorClave) {
    const enDb = dbPorClave.get(clave);
    if (!enDb) {
      faltantesEnDb++;
      detalleDiscrepancias.push(
        `FALTA EN BD: ${clave} — Excel dice $${fmt(montoExcel)}`,
      );
      continue;
    }
    const diferencia = Math.abs(enDb.monto - montoExcel);
    if (diferencia > 1) {
      discrepanciasMonto++;
      detalleDiscrepancias.push(
        `MONTO DISTINTO: ${clave} — Excel=$${fmt(montoExcel)} BD=$${fmt(enDb.monto)} (metodo BD=${enDb.metodo})`,
      );
    } else if (enDb.metodo !== "ingesta_excel_historico") {
      discrepanciasMetodo++;
      detalleDiscrepancias.push(
        `MONTO OK pero metodo distinto: ${clave} — BD metodo=${enDb.metodo} (esperado ingesta_excel_historico)`,
      );
    } else {
      coincidencias++;
    }
  }

  console.log(
    "=== cash_flow_monthly (RG/RP/finiquito/reliquidacion/cotizacion/sence) ===",
  );
  console.log(`  Coincidencias exactas: ${coincidencias}`);
  console.log(`  Discrepancias de monto: ${discrepanciasMonto}`);
  console.log(`  Monto OK pero método distinto: ${discrepanciasMetodo}`);
  console.log(`  Faltantes en BD: ${faltantesEnDb}`);
  if (detalleDiscrepancias.length > 0) {
    console.log("\n  Detalle (primeras 30):");
    for (const d of detalleDiscrepancias.slice(0, 30)) console.log(`    ${d}`);
  }

  // --- Comparar dotacion_mensual ---
  console.log("\n=== dotacion_mensual ===");
  const { data: dotacionDb } = await supabase
    .from("dotacion_mensual")
    .select("periodo, rg, rp, total, origen");
  const dotacionDbPorPeriodo = new Map(
    (dotacionDb ?? []).map((d) => [d.periodo, d]),
  );

  let dotacionOk = 0;
  let dotacionMal = 0;
  for (const d of dotacion) {
    const periodo = d.periodo.toISOString().slice(0, 10);
    const enDb = dotacionDbPorPeriodo.get(periodo);
    const totalExcel = (d.rg ?? 0) + (d.rp ?? 0);
    if (!enDb) {
      dotacionMal++;
      console.log(`  FALTA: ${periodo} — Excel RG=${d.rg} RP=${d.rp}`);
    } else if (
      enDb.total !== totalExcel ||
      enDb.rg !== d.rg ||
      enDb.rp !== d.rp
    ) {
      dotacionMal++;
      console.log(
        `  DISTINTO: ${periodo} — Excel RG=${d.rg}/RP=${d.rp} vs BD RG=${enDb.rg}/RP=${enDb.rp}`,
      );
    } else {
      dotacionOk++;
    }
  }
  console.log(`  Coincidencias: ${dotacionOk} / ${dotacion.length}`);
  console.log(`  Problemas: ${dotacionMal}`);

  // --- ¿Qué fuente manda hoy para 'remuneracion'/'anticipo' combinados? ---
  console.log(
    "\n=== Fuente activa hoy para 'remuneracion'/'anticipo' combinados (todo el rango) ===",
  );
  const { data: combinados } = await supabase
    .from("cash_flow_monthly")
    .select("periodo, concepto, metodo_calculo")
    .in("concepto", ["remuneracion", "anticipo"])
    .order("periodo");
  const conteoMetodo = new Map<string, number>();
  for (const r of combinados ?? []) {
    const key = `${r.concepto}::${r.metodo_calculo}`;
    conteoMetodo.set(key, (conteoMetodo.get(key) ?? 0) + 1);
  }
  for (const [k, c] of conteoMetodo) console.log(`  ${k}: ${c} meses`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
