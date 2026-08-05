import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import type { CashFlowSeriePunto } from "../services/queries";

const CONCEPTOS_ORDEN = [
  "anticipo",
  "remuneracion",
  "finiquito",
  "reliquidacion",
  "cotizacion",
  "sence",
  "total_nomina",
] as const;
const CONCEPTO_LABEL: Record<string, string> = {
  anticipo: "Anticipo",
  remuneracion: "Remuneración",
  finiquito: "Finiquito",
  reliquidacion: "Reliquidación",
  cotizacion: "Cotización",
  sence: "Aporte SENCE",
  total_nomina: "Total Nómina",
};

function formatCLP(monto: number): string {
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(
    monto,
  );
}

export function DetailTable({ serie }: { serie: CashFlowSeriePunto[] }) {
  const periodos = [...new Set(serie.map((p) => p.periodo))].sort();
  const valorPorConceptoYPeriodo = new Map<string, CashFlowSeriePunto>();
  for (const punto of serie)
    valorPorConceptoYPeriodo.set(`${punto.concepto}::${punto.periodo}`, punto);

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Concepto</TableHead>
            {periodos.map((p) => (
              <TableHead key={p} className="text-right">
                {p.slice(0, 7)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {CONCEPTOS_ORDEN.map((concepto) => (
            <TableRow
              key={concepto}
              className={
                concepto === "total_nomina" ? "font-semibold" : undefined
              }
            >
              <TableCell>{CONCEPTO_LABEL[concepto]}</TableCell>
              {periodos.map((p) => {
                const punto = valorPorConceptoYPeriodo.get(`${concepto}::${p}`);
                return (
                  <TableCell
                    key={p}
                    className={`text-right ${punto && !punto.esReal ? "text-slate-400 italic" : ""}`}
                  >
                    {punto ? formatCLP(punto.monto) : "—"}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
