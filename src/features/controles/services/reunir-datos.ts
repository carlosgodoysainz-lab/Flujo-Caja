import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { getDotacionTotalPorPeriodo } from "@/features/headcount/services/dotacion-total";
import { getPlanObraConDotacion } from "@/features/headcount/services/plan-obra-dotacion";
import {
  periodoDeFecha,
  sumarMesesAPeriodo,
} from "@/features/headcount/services/periodo";
import type { DatosControles } from "../lib/controles";

const MESES_ATRAS_BENEFICIARIOS = 6;
const MESES_ATRAS_ANTICIPO = 14;
const MESES_ATRAS_DOCUMENTOS = 1; // mes actual + el anterior
const MESES_ADELANTE = 12;

function aFecha(periodo: string): Date {
  const [y, m] = periodo.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

/**
 * Lee de la base todo lo que necesitan los 6 controles. Solo LEE: nunca
 * escribe ni corrige nada (las correcciones viven en `preflight.ts`).
 */
export async function reunirDatosControles(
  hoy: Date = new Date(),
): Promise<DatosControles> {
  const supabase = createServiceClient();
  const periodoHoy = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-01`;
  const desdeBeneficiarios = sumarMesesAPeriodo(
    periodoHoy,
    -MESES_ATRAS_BENEFICIARIOS,
  );
  const desdeAnticipo = sumarMesesAPeriodo(periodoHoy, -MESES_ATRAS_ANTICIPO);
  const desdeDocumentos = sumarMesesAPeriodo(
    periodoHoy,
    -MESES_ATRAS_DOCUMENTOS,
  );
  const hastaProyeccion = sumarMesesAPeriodo(periodoHoy, MESES_ADELANTE);

  const [
    dotacion,
    filasObras,
    beneficiariosRes,
    documentosRes,
    cashFlowAnticipoRes,
    lineItemsAnticipoRes,
    remuneracionRes,
  ] = await Promise.all([
    getDotacionTotalPorPeriodo(
      aFecha(desdeBeneficiarios),
      aFecha(hastaProyeccion),
    ),
    getPlanObraConDotacion(
      aFecha(sumarMesesAPeriodo(periodoHoy, -1)),
      aFecha(hastaProyeccion),
    ),
    supabase
      .from("payroll_beneficiarios_reales")
      .select("periodo, concepto, cantidad")
      .in("concepto", ["anticipo_rg", "anticipo_rp"])
      .gte("periodo", desdeBeneficiarios),
    supabase
      .from("payroll_source_documents")
      .select("periodo, nombre_archivo, estado")
      .gte("periodo", desdeDocumentos),
    supabase
      .from("cash_flow_monthly")
      .select("periodo, monto, es_real")
      .eq("concepto", "anticipo")
      .gte("periodo", desdeAnticipo)
      .lte("periodo", periodoHoy),
    supabase
      .from("payroll_line_items")
      .select("periodo, concepto, monto")
      .in("concepto", ["anticipo_rg", "anticipo_rp"])
      .gte("periodo", desdeAnticipo),
    supabase
      .from("cash_flow_monthly")
      .select("periodo, metodo_calculo, es_real")
      .eq("concepto", "remuneracion")
      .gte("periodo", periodoHoy)
      .lte("periodo", hastaProyeccion),
  ]);

  const dotacionPorPeriodo: Record<string, number> = {};
  for (const [periodo, punto] of dotacion)
    dotacionPorPeriodo[periodo] = punto.total;

  const sumaObrasPorPeriodo: Record<string, number> = {};
  for (const f of filasObras) {
    if (f.dotacionProyectada == null) continue;
    sumaObrasPorPeriodo[f.periodo] =
      (sumaObrasPorPeriodo[f.periodo] ?? 0) + f.dotacionProyectada;
  }

  const benef = new Map<string, { anticipoRg: number; anticipoRp: number }>();
  for (const b of beneficiariosRes.data ?? []) {
    const fila = benef.get(b.periodo) ?? { anticipoRg: 0, anticipoRp: 0 };
    if (b.concepto === "anticipo_rg") fila.anticipoRg = b.cantidad;
    else fila.anticipoRp = b.cantidad;
    benef.set(b.periodo, fila);
  }

  // Anticipo $: lo real del modelo (Excel histórico + meses ya calculados),
  // pisado por lo recién ingerido de los archivos cuando existe — dentro de
  // "Actualizar reporte" el modelo todavía no recalculó el mes en curso, y
  // el control de aguinaldo tiene que ver el archivo, no el valor viejo.
  const anticipo = new Map<string, { monto: number; esReal: boolean }>();
  for (const a of cashFlowAnticipoRes.data ?? []) {
    anticipo.set(a.periodo, { monto: Number(a.monto), esReal: a.es_real });
  }
  const ingeridoPorPeriodo = new Map<string, number>();
  for (const l of lineItemsAnticipoRes.data ?? []) {
    ingeridoPorPeriodo.set(
      l.periodo,
      (ingeridoPorPeriodo.get(l.periodo) ?? 0) + Number(l.monto),
    );
  }
  for (const [periodo, monto] of ingeridoPorPeriodo) {
    if (periodo <= periodoHoy) anticipo.set(periodo, { monto, esReal: true });
  }

  // Últimas dos lecturas de Buk: primero las fechas, después la suma de
  // cada una (~260 filas por fecha, muy por debajo del tope de 1000).
  async function totalDeLectura(fecha: string) {
    const { data } = await supabase
      .from("buk_dotacion_snapshots")
      .select("activos")
      .eq("snapshot_date", fecha);
    return (data ?? []).reduce((s, r) => s + r.activos, 0);
  }
  const { data: ultimaRow } = await supabase
    .from("buk_dotacion_snapshots")
    .select("snapshot_date")
    .order("snapshot_date", { ascending: false })
    .limit(1);
  const fechaUltima = ultimaRow?.[0]?.snapshot_date ?? null;
  let anteriorLectura: { fecha: string; total: number } | null = null;
  let ultimaLectura: { fecha: string; total: number } | null = null;
  if (fechaUltima) {
    ultimaLectura = {
      fecha: fechaUltima,
      total: await totalDeLectura(fechaUltima),
    };
    const { data: prevRow } = await supabase
      .from("buk_dotacion_snapshots")
      .select("snapshot_date")
      .lt("snapshot_date", fechaUltima)
      .order("snapshot_date", { ascending: false })
      .limit(1);
    const fechaPrev = prevRow?.[0]?.snapshot_date ?? null;
    if (fechaPrev) {
      anteriorLectura = {
        fecha: fechaPrev,
        total: await totalDeLectura(fechaPrev),
      };
    }
  }

  return {
    beneficiarios: [...benef].map(([periodo, v]) => ({
      periodo: periodoDeFecha(periodo),
      ...v,
    })),
    dotacionPorPeriodo,
    sumaObrasPorPeriodo,
    documentos: (documentosRes.data ?? []).map((d) => ({
      periodo: d.periodo,
      nombreArchivo: d.nombre_archivo,
      estado: d.estado,
    })),
    anticipoMensual: [...anticipo].map(([periodo, v]) => ({ periodo, ...v })),
    buk: { anterior: anteriorLectura, ultima: ultimaLectura },
    remuneracionProyectada: (remuneracionRes.data ?? []).map((r) => ({
      periodo: r.periodo,
      metodo: r.metodo_calculo,
      esReal: r.es_real,
    })),
  };
}
