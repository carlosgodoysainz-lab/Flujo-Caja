import { createServiceClient } from "@/lib/supabase/service";
import { RunForecastButton } from "@/features/headcount/forecast-model/components/run-forecast-button";
import { UploadHeadcountManualForm } from "@/features/headcount/components/upload-headcount-manual-form";
import { Badge } from "@/shared/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

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
    .select("id, nombre, tipo, comuna, unidades, activa")
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
