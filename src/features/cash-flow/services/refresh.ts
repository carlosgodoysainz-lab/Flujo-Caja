"use server";

import { auth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { syncObrasFromGespro } from "@/features/obras/services/sync";
import { syncPagosMensuales } from "./sync-pagos-mensuales";
import { calcularMesCashFlow } from "./engine";

export interface RefreshReportResult {
  reportSnapshotId: string | null;
  estado: "ok" | "parcial" | "error";
  documentosIngeridos: number;
  mesesRecalculados: number;
  errores: { fuente: string; mensaje: string }[];
}

async function sumaLineItems(
  supabase: ReturnType<typeof createServiceClient>,
  periodo: Date,
  conceptos: string[],
): Promise<number | null> {
  const { data } = await supabase
    .from("payroll_line_items")
    .select("monto")
    .eq("periodo", periodo.toISOString().slice(0, 10))
    .in("concepto", conceptos);

  if (!data || data.length === 0) return null;
  return data.reduce((acc, row) => acc + Number(row.monto), 0);
}

async function promedioRemuneracionReal(
  supabase: ReturnType<typeof createServiceClient>,
  antesDe: Date,
  n = 3,
): Promise<number> {
  const { data } = await supabase
    .from("cash_flow_monthly")
    .select("monto")
    .eq("concepto", "remuneracion")
    .eq("es_real", true)
    .lt("periodo", antesDe.toISOString().slice(0, 10))
    .order("periodo", { ascending: false })
    .limit(n);

  if (!data || data.length === 0) return 0;
  return data.reduce((acc, row) => acc + Number(row.monto), 0) / data.length;
}

/**
 * El refresh completo del reporte — botón "Actualizar reporte" en /reporte
 * (ver TECH-SPEC §3.4). Orquesta: sync de obras (Fase 3) + sync de pagos
 * mensuales (Fase 4) + recálculo del motor de flujo de caja (engine.ts)
 * para cada mes del rango pedido.
 */
export async function refreshCashFlowReport(
  periodoDesde: Date,
  periodoHasta: Date,
): Promise<RefreshReportResult> {
  const session = await auth();
  const supabase = createServiceClient();
  const errores: RefreshReportResult["errores"] = [];
  let documentosIngeridos = 0;

  const obrasResult = await syncObrasFromGespro();
  if (obrasResult.estado === "error") {
    errores.push({
      fuente: "Plan de Obras Gespro",
      mensaje: obrasResult.errores.join("; "),
    });
  } else {
    documentosIngeridos += 1;
  }

  const meses: Date[] = [];
  const cursor = new Date(
    periodoDesde.getFullYear(),
    periodoDesde.getMonth(),
    1,
  );
  while (cursor <= periodoHasta) {
    meses.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  for (const mes of meses) {
    const pagosResult = await syncPagosMensuales(mes);
    documentosIngeridos += pagosResult.archivosProcesados.length;
    if (pagosResult.estado === "error") {
      errores.push({
        fuente: `Pagos Mensuales ${pagosResult.periodo}`,
        mensaje: pagosResult.errores.join("; "),
      });
    }
  }

  let mesesRecalculados = 0;
  for (const mes of meses) {
    const remuneracionReal = await sumaLineItems(supabase, mes, [
      "remuneracion_rg",
      "remuneracion_rp",
    ]);
    const reliquidacionReal = await sumaLineItems(supabase, mes, [
      "reliquidacion",
    ]);
    const finiquitoReal = await sumaLineItems(supabase, mes, ["finiquito"]);
    const remuneracionBaseParaProyeccion = await promedioRemuneracionReal(
      supabase,
      mes,
    );

    const calculado = calcularMesCashFlow({
      remuneracionReal,
      reliquidacionReal,
      finiquitoReal,
      anticipoReal: null,
      remuneracionBaseParaProyeccion,
    });

    const periodoStr = mes.toISOString().slice(0, 10);
    const conceptos = [
      { concepto: "anticipo", ...calculado.anticipo },
      { concepto: "remuneracion", ...calculado.remuneracion },
      { concepto: "reliquidacion", ...calculado.reliquidacion },
      { concepto: "finiquito", ...calculado.finiquito },
      { concepto: "cotizacion", ...calculado.cotizacion },
      { concepto: "sence", ...calculado.sence },
      {
        concepto: "total_nomina",
        monto: calculado.totalNomina,
        esReal: false,
        metodoCalculo: "suma_conceptos",
      },
    ];

    const { error } = await supabase.from("cash_flow_monthly").upsert(
      conceptos.map((c) => ({
        periodo: periodoStr,
        concepto: c.concepto,
        monto: c.monto,
        es_real: c.esReal,
        metodo_calculo: c.metodoCalculo,
      })),
      { onConflict: "periodo,concepto" },
    );

    if (error) {
      errores.push({ fuente: `Cálculo ${periodoStr}`, mensaje: error.message });
    } else {
      mesesRecalculados++;
    }
  }

  const { data: snapshot, error: snapshotError } = await supabase
    .from("report_snapshots")
    .insert({
      generated_by: session?.user?.id ?? null,
      periodo_desde: periodoDesde.toISOString().slice(0, 10),
      periodo_hasta: periodoHasta.toISOString().slice(0, 10),
      estado: errores.length > 0 ? "parcial" : "ok",
      detalle_errores: errores.length > 0 ? errores : null,
    })
    .select("id")
    .single();

  if (snapshotError)
    errores.push({
      fuente: "report_snapshots",
      mensaje: snapshotError.message,
    });

  return {
    reportSnapshotId: snapshot?.id ?? null,
    estado:
      errores.length === 0 ? "ok" : mesesRecalculados > 0 ? "parcial" : "error",
    documentosIngeridos,
    mesesRecalculados,
    errores,
  };
}
