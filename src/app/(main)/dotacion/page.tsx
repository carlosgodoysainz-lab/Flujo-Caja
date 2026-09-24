import { createServiceClient } from "@/lib/supabase/service";
import { RunForecastButton } from "@/features/headcount/forecast-model/components/run-forecast-button";
import { UploadHeadcountManualForm } from "@/features/headcount/components/upload-headcount-manual-form";
import { DescargarPlantillaButton } from "@/features/plan-dotacion/components/descargar-plantilla-button";
import { Badge } from "@/shared/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import {
  detectarObrasCerradasSinPlan,
  detectarObrasSinPlan,
  type PlanDotacionVariacion,
} from "@/features/plan-dotacion/services/resolver-dotacion";
import { getSaldoInicialPorObra } from "@/features/headcount/services/plan-obra-dotacion";

export const dynamic = "force-dynamic";

const ORIGEN_LABEL: Record<
  string,
  { text: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  manual: { text: "Manual", variant: "secondary" },
  buk_real: { text: "Buk (real)", variant: "default" },
  modelo_estimado: { text: "Estimado", variant: "outline" },
  // Estimado, pero SIN ninguna obra de referencia con dato real ese mes
  // de avance — el modelo dejó un placeholder (0), no una proyección
  // real (ver Auto-Blindaje 13-ago-2026: 91% de las filas caían acá).
  sin_dato_referencia: {
    text: "Sin obra de referencia",
    variant: "destructive",
  },
};

/** Origen que NO debe pisarse por uno de menor confianza al elegir cuál mostrar por obra — ver `origenPorObra` abajo. */
const ORIGENES_BAJA_CONFIANZA = new Set([
  "modelo_estimado",
  "sin_dato_referencia",
]);

export default async function DotacionPage() {
  const supabase = createServiceClient();
  const { data: obras } = await supabase
    .from("obras")
    .select("id, nombre, tipo, comuna, unidades, activa, fin_obra")
    .order("nombre");

  // Para cada obra, ¿tiene AL MENOS un registro de headcount con origen manual/buk_real?
  // Si no tiene ninguno, es una de las obras "sin dato" que el modelo debe completar.
  const { data: headcountRows } = await supabase
    .from("headcount_by_obra")
    .select("obra_id, origen");

  const origenPorObra = new Map<string, string>();
  for (const row of headcountRows ?? []) {
    if (
      !origenPorObra.has(row.obra_id) ||
      !ORIGENES_BAJA_CONFIANZA.has(row.origen)
    ) {
      origenPorObra.set(row.obra_id, row.origen);
    }
  }

  // --- Estado del Plan de Dotación (Fase 2, 24-sep-2026) ---
  const { data: ultimaLectura } = await supabase
    .from("plan_dotacion_lecturas")
    .select(
      "fuente_archivo, leido_at, filas_plan, filas_eventos, errores, advertencias",
    )
    .order("leido_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: planRows } = await supabase
    .from("plan_dotacion")
    .select("obra_id, periodo, variacion_neta");
  const variaciones: PlanDotacionVariacion[] = (planRows ?? []).map((r) => ({
    obraId: r.obra_id,
    periodo: r.periodo,
    variacionNeta: r.variacion_neta,
  }));

  const hoyStr = new Date().toISOString().slice(0, 10);
  const obrasParaAlerta = (obras ?? []).map((o) => ({
    id: o.id as string,
    nombre: o.nombre as string,
    finObra: o.fin_obra as string | null,
  }));
  const dotacionRealPorObra = await getSaldoInicialPorObra();
  const alertasCierre = detectarObrasCerradasSinPlan({
    obras: obrasParaAlerta,
    variaciones,
    dotacionRealPorObra,
    hoyStr,
  });
  const obrasSinPlan = detectarObrasSinPlan({
    obras: obrasParaAlerta,
    variaciones,
    hoyStr,
  });

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold text-slate-900">
        Dotación por obra
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Obras sin headcount manual o real de Buk pueden estimarse con el modelo
        (Fase 6) — compara contra obras similares (mismo tipo, unidades ±30%)
        con histórico real.
      </p>

      <section className="mt-6 space-y-3 rounded-md border border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-slate-900">
              Plan de Dotación
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Fuente única de la dotación futura — se lee desde SharePoint
              (carpeta &quot;Flujo de Caja/Plan Dotación&quot;) en cada
              &quot;Actualizar reporte&quot;.
            </p>
          </div>
          <DescargarPlantillaButton />
        </div>

        {ultimaLectura ? (
          <p className="text-xs text-slate-600">
            Último archivo leído:{" "}
            <strong>{ultimaLectura.fuente_archivo}</strong> —{" "}
            {new Date(ultimaLectura.leido_at).toLocaleString("es-CL")} —{" "}
            {ultimaLectura.filas_plan} fila(s) de plan,{" "}
            {ultimaLectura.filas_eventos} evento(s).
          </p>
        ) : (
          <p className="text-xs text-[var(--warn)]">
            Todavía no se ha leído ningún archivo — descarga la plantilla,
            complétala y súbela a SharePoint. El próximo &quot;Actualizar
            reporte&quot; la va a leer.
          </p>
        )}

        {ultimaLectura?.errores != null &&
          Array.isArray(ultimaLectura.errores) &&
          ultimaLectura.errores.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-[var(--err)]">
              {(ultimaLectura.errores as string[]).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}

        {alertasCierre.length > 0 && (
          <div className="rounded border border-[var(--err)] bg-red-50 p-2 text-xs text-[var(--err)]">
            <p className="font-medium">
              {alertasCierre.length} obra(s) ya pasaron su fecha de término y
              siguen con dotación sin plan de cierre:
            </p>
            <ul className="mt-1 list-disc pl-5">
              {alertasCierre.map((a) => (
                <li key={a.obraId}>
                  {a.obraNombre} — terminó el {a.finObra.slice(0, 10)}, sigue
                  con {a.dotacionActual} persona(s)
                </li>
              ))}
            </ul>
          </div>
        )}

        {obrasSinPlan.length > 0 && (
          <p className="text-xs text-slate-500">
            {obrasSinPlan.length} obra(s) vigentes sin plan cargado (dotación se
            mantiene plana): {obrasSinPlan.map((o) => o.nombre).join(", ")}
          </p>
        )}
      </section>

      <div className="mt-6">
        <UploadHeadcountManualForm />
      </div>

      <Table className="mt-6">
        <TableHeader>
          <TableRow>
            <TableHead>Obra</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Comuna</TableHead>
            <TableHead>Unidades</TableHead>
            <TableHead>Origen dotación</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(obras ?? []).map((obra) => {
            const origen = origenPorObra.get(obra.id);
            const label = origen
              ? ORIGEN_LABEL[origen]
              : { text: "Sin dato", variant: "destructive" as const };
            return (
              <TableRow key={obra.id}>
                <TableCell className="font-medium">{obra.nombre}</TableCell>
                <TableCell>{obra.tipo}</TableCell>
                <TableCell>{obra.comuna}</TableCell>
                <TableCell>{obra.unidades}</TableCell>
                <TableCell>
                  <Badge variant={label.variant}>{label.text}</Badge>
                </TableCell>
                <TableCell>
                  {/* Reestimable mientras no haya dato manual/real de Buk
                      cargado — antes el botón solo aparecía con CERO
                      filas, así que una obra ya estimada con el modelo
                      viejo (v2) quedaba sin forma de volver a correr el
                      modelo nuevo (v3 "ciclo de vida", 24-ago-2026) sin
                      borrar sus filas a mano. El upsert de
                      `runForecastModel` ya protege manual/buk_real, así
                      que reestimar acá nunca pisa un dato real. */}
                  {(!origen || ORIGENES_BAJA_CONFIANZA.has(origen)) && (
                    <RunForecastButton obraId={obra.id} />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
