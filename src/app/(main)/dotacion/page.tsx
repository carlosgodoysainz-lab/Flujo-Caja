import { createServiceClient } from "@/lib/supabase/service";
import { RunForecastButton } from "@/features/headcount/forecast-model/components/run-forecast-button";
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
};

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
    if (!origenPorObra.has(row.obra_id) || row.origen !== "modelo_estimado") {
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
                  {!origen && <RunForecastButton obraId={obra.id} />}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
