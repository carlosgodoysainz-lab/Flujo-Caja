import { Fragment } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import type { CashFlowSeriePunto } from "../services/queries";
import type { DotacionTotalPunto } from "@/features/headcount/services/dotacion-total";
import { SenceEditableCell } from "./sence-editable-cell";
import { FILAS_DETALLE as FILAS } from "../lib/filas-detalle";

function formatCLP(monto: number): string {
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(
    monto,
  );
}

function formatUF(monto: number): string {
  return `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(monto)} UF`;
}

function formatN(n: number): string {
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(n);
}

export function DetailTable({
  serie,
  ufPorPeriodo,
  dotacionPorPeriodo,
}: {
  serie: CashFlowSeriePunto[];
  /** Valor UF por período (mismo formato YYYY-MM-DD que `periodo`) — ver uf-sync.ts. Fila "Total Nómina (UF)" solo aparece si hay dato. */
  ufPorPeriodo: Map<string, number>;
  /** Dotación total (N°) por período — ver dotacion-total.ts. Fila "Dotación" solo aparece si hay dato. */
  dotacionPorPeriodo?: Map<string, DotacionTotalPunto>;
}) {
  const periodos = [...new Set(serie.map((p) => p.periodo))].sort();
  const valorPorConceptoYPeriodo = new Map<string, CashFlowSeriePunto>();
  for (const punto of serie)
    valorPorConceptoYPeriodo.set(`${punto.concepto}::${punto.periodo}`, punto);

  function celda(concepto: string, p: string) {
    const punto = valorPorConceptoYPeriodo.get(`${concepto}::${p}`);
    if (concepto === "sence") {
      // Único concepto siempre manual — celda editable en vez de texto
      // plano (ver sence-editable-cell.tsx).
      return (
        <SenceEditableCell
          periodo={p}
          monto={punto?.monto ?? 0}
          esReal={punto?.esReal ?? false}
        />
      );
    }
    return punto ? formatCLP(punto.monto) : "—";
  }

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
          {dotacionPorPeriodo && dotacionPorPeriodo.size > 0 && (
            <TableRow className="border-b-2 border-slate-200">
              <TableCell className="font-medium text-slate-600">
                Dotación (N°)
              </TableCell>
              {periodos.map((p) => {
                const punto = dotacionPorPeriodo.get(p);
                return (
                  <TableCell
                    key={p}
                    className={`text-right ${punto && !punto.esReal ? "text-slate-400 italic" : ""}`}
                  >
                    {punto ? formatN(punto.total) : "—"}
                  </TableCell>
                );
              })}
            </TableRow>
          )}
          {FILAS.map((fila) => (
            <Fragment key={fila.concepto}>
              <TableRow
                className={
                  fila.concepto === "total_nomina" ? "font-semibold" : undefined
                }
              >
                <TableCell>{fila.label}</TableCell>
                {periodos.map((p) => {
                  const punto = valorPorConceptoYPeriodo.get(
                    `${fila.concepto}::${p}`,
                  );
                  return (
                    <TableCell
                      key={p}
                      className={`text-right ${punto && !punto.esReal ? "text-slate-400 italic" : ""}`}
                    >
                      {celda(fila.concepto, p)}
                    </TableCell>
                  );
                })}
              </TableRow>
              {fila.sub?.map((sub) => (
                <TableRow key={sub.concepto} className="text-slate-500">
                  <TableCell className="pl-6 text-xs">{sub.label}</TableCell>
                  {periodos.map((p) => {
                    const punto = valorPorConceptoYPeriodo.get(
                      `${sub.concepto}::${p}`,
                    );
                    return (
                      <TableCell
                        key={p}
                        className={`text-right text-xs ${punto && !punto.esReal ? "italic" : ""}`}
                      >
                        {punto ? formatCLP(punto.monto) : "—"}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </Fragment>
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
