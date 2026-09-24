import { createServiceClient } from "@/lib/supabase/service";
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

/**
 * Estado del Plan de Dotación (Fase 2/3, 24-sep-2026) — reemplaza la
 * página anterior, construida alrededor del modelo estadístico de "obras
 * similares" (retirado) y la carga manual por re-subida de Excel
 * (reemplazada por el Plan de Dotación en SharePoint, ver plan-dotacion/).
 */
export default async function DotacionPage() {
  const supabase = createServiceClient();
  const { data: obras } = await supabase
    .from("obras")
    .select("id, nombre, tipo, comuna, unidades, fin_obra")
    .order("nombre");

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
  const obraIdsConPlan = new Set(
    variaciones.filter((v) => v.obraId != null).map((v) => v.obraId),
  );

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
  const obraIdsCerradosSinPlan = new Set(alertasCierre.map((a) => a.obraId));

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold text-slate-900">
        Plan de Dotación
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        La dotación futura del flujo de caja viene del Plan de Dotación que
        mantenés en SharePoint — obra por obra, mes a mes. Los meses ya
        ocurridos siempre usan el dato real de Buk.
      </p>

      <section className="mt-6 space-y-3 rounded-md border border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-slate-900">
              Estado del archivo
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Se lee desde SharePoint (carpeta &quot;Flujo de Caja/Plan
              Dotación&quot;) en cada &quot;Actualizar reporte&quot;.
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
      </section>

      <Table className="mt-6">
        <TableHeader>
          <TableRow>
            <TableHead>Obra</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Comuna</TableHead>
            <TableHead>Unidades</TableHead>
            <TableHead>Dotación real (Buk)</TableHead>
            <TableHead>Plan cargado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(obras ?? []).map((obra) => {
            const tienePlan = obraIdsConPlan.has(obra.id);
            const cerradaSinPlan = obraIdsCerradosSinPlan.has(obra.id);
            return (
              <TableRow key={obra.id}>
                <TableCell className="font-medium">{obra.nombre}</TableCell>
                <TableCell>{obra.tipo}</TableCell>
                <TableCell>{obra.comuna}</TableCell>
                <TableCell>{obra.unidades}</TableCell>
                <TableCell>{dotacionRealPorObra.get(obra.id) ?? "—"}</TableCell>
                <TableCell>
                  {cerradaSinPlan ? (
                    <Badge variant="destructive">Vencida sin plan</Badge>
                  ) : tienePlan ? (
                    <Badge variant="default">Con plan</Badge>
                  ) : (
                    <Badge variant="outline">Sin plan</Badge>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {obrasSinPlan.length > 0 && (
        <p className="mt-3 text-xs text-slate-500">
          {obrasSinPlan.length} obra(s) vigentes sin plan cargado — su dotación
          se mantiene plana (última real) hasta que completes su plan.
        </p>
      )}
    </div>
  );
}
