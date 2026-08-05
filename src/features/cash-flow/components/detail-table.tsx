import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import type { CashFlowSeriePunto } from "../services/queries";
import { SenceEditableCell } from "./sence-editable-cell";

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

function formatUF(monto: number): string {
  return `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(monto)} UF`;
}

export function DetailTable({
  serie,
  ufPorPeriodo,
}: {
  serie: CashFlowSeriePunto[];
  /** Valor UF por período (mismo formato YYYY-MM-DD que `periodo`) — ver uf-sync.ts. Fila "Total Nómina (UF)" solo aparece si hay dato. */
  ufPorPeriodo: Map<string, number>;
}) {
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
                if (concepto === "sence") {
                  // Único concepto siempre manual — celda editable en vez
                  // de texto plano (ver sence-editable-cell.tsx).
                  return (
                    <TableCell key={p} className="text-right">
                      <SenceEditableCell
                        periodo={p}
                        monto={punto?.monto ?? 0}
                        esReal={punto?.esReal ?? false}
                      />
                    </TableCell>
                  );
                }
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
          {ufPorPeriodo.size > 0 && (
            <TableRow className="border-t-2 border-[var(--navy-brand)] text-[var(--navy-brand)]">
              <TableCell className="font-medium">Total Nómina (UF)</TableCell>
              {periodos.map((p) => {
                const totalNomina = valorPorConceptoYPeriodo.get(
                  `total_nomina::${p}`,
                );
                const valorUf = ufPorPeriodo.get(p);
                const enUf =
                  totalNomina && valorUf ? totalNomina.monto / valorUf : null;
                return (
                  <TableCell key={p} className="text-right">
                    {enUf !== null ? formatUF(enUf) : "—"}
                  </TableCell>
                );
              })}
            </TableRow>
          )}
        </TableBody>
      </Table>
      {ufPorPeriodo.size === 0 && (
        <p className="mt-2 text-xs text-slate-400">
          Serie UF no sincronizada todavía — se actualiza junto con "Actualizar
          reporte".
        </p>
      )}
    </div>
  );
}
