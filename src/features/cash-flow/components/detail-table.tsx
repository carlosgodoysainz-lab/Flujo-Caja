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
import type {
  DotacionTotalPunto,
  DotacionPorConceptoPunto,
} from "@/features/headcount/services/dotacion-total";
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
  dotacionPorConceptoYPeriodo,
}: {
  serie: CashFlowSeriePunto[];
  /** Valor UF por período (mismo formato YYYY-MM-DD que `periodo`) — ver uf-sync.ts. Fila "Total Nómina (UF)" solo aparece si hay dato. */
  ufPorPeriodo: Map<string, number>;
  /** Dotación total (N°) por período — ver dotacion-total.ts. Fila "Dotación" solo aparece si hay dato. */
  dotacionPorPeriodo?: Map<string, DotacionTotalPunto>;
  /**
   * N° (dotación) por período, ESPECÍFICO de cada sub-fila RG/RP de
   * Anticipo/Remuneración — mismo formato del Excel real de Finanzas
   * (pedido explícito del usuario 17-ago-2026). Real desde
   * `payroll_line_items` (grano de persona) cuando existe; si no,
   * estimado desde la dotación total. Si no se provee, la tabla queda
   * con una sola columna por período (comportamiento previo).
   */
  dotacionPorConceptoYPeriodo?: Map<string, DotacionPorConceptoPunto>;
}) {
  const periodos = [...new Set(serie.map((p) => p.periodo))].sort();
  const valorPorConceptoYPeriodo = new Map<string, CashFlowSeriePunto>();
  for (const punto of serie)
    valorPorConceptoYPeriodo.set(`${punto.concepto}::${punto.periodo}`, punto);

  const conColumnaN = !!dotacionPorConceptoYPeriodo;

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
          metodoCalculo={punto?.metodoCalculo ?? null}
        />
      );
    }
    return punto ? formatCLP(punto.monto) : "—";
  }

  /** Celda "N°" — vacía salvo en las sub-filas marcadas con `tieneColumnaN` (ver filas-detalle.ts). */
  function celdaN(
    sub: { concepto: string; tieneColumnaN?: boolean },
    p: string,
  ) {
    if (!sub.tieneColumnaN) return null;
    const punto = dotacionPorConceptoYPeriodo?.get(p);
    const valor = punto?.[sub.concepto as keyof DotacionPorConceptoPunto];
    return valor != null ? formatN(valor) : "—";
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead rowSpan={conColumnaN ? 2 : 1}>Concepto</TableHead>
            {periodos.map((p) =>
              conColumnaN ? (
                <TableHead key={p} colSpan={2} className="text-center">
                  {p.slice(0, 7)}
                </TableHead>
              ) : (
                <TableHead key={p} className="text-right">
                  {p.slice(0, 7)}
                </TableHead>
              ),
            )}
          </TableRow>
          {conColumnaN && (
            <TableRow>
              {periodos.map((p) => (
                <Fragment key={p}>
                  <TableHead className="text-right text-[10px] font-normal text-slate-500">
                    $
                  </TableHead>
                  <TableHead className="text-right text-[10px] font-normal text-slate-500">
                    N°
                  </TableHead>
                </Fragment>
              ))}
            </TableRow>
          )}
        </TableHeader>
        <TableBody>
          {dotacionPorPeriodo && dotacionPorPeriodo.size > 0 && (
            <TableRow className="border-b-2 border-slate-200">
              <TableCell className="font-medium text-slate-600">
                Dotación (N°)
              </TableCell>
              {periodos.map((p) => {
                const punto = dotacionPorPeriodo.get(p);
                const clase = `text-right ${punto && !punto.esReal ? "text-slate-500 italic" : ""}`;
                return conColumnaN ? (
                  <Fragment key={p}>
                    <TableCell className={clase}>
                      {punto ? formatN(punto.total) : "—"}
                    </TableCell>
                    <TableCell />
                  </Fragment>
                ) : (
                  <TableCell key={p} className={clase}>
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
                  const clase = `text-right ${punto && !punto.esReal ? "text-slate-500 italic" : ""}`;
                  return conColumnaN ? (
                    <Fragment key={p}>
                      <TableCell className={clase}>
                        {celda(fila.concepto, p)}
                      </TableCell>
                      <TableCell />
                    </Fragment>
                  ) : (
                    <TableCell key={p} className={clase}>
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
                    const clase = `text-right text-xs ${punto && !punto.esReal ? "italic" : ""}`;
                    return conColumnaN ? (
                      <Fragment key={p}>
                        <TableCell className={clase}>
                          {punto ? formatCLP(punto.monto) : "—"}
                        </TableCell>
                        <TableCell
                          className={`text-right text-xs text-slate-500`}
                        >
                          {celdaN(sub, p)}
                        </TableCell>
                      </Fragment>
                    ) : (
                      <TableCell key={p} className={clase}>
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
                return conColumnaN ? (
                  <Fragment key={p}>
                    <TableCell className="text-right">
                      {enUf !== null ? formatUF(enUf) : "—"}
                    </TableCell>
                    <TableCell />
                  </Fragment>
                ) : (
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
        <p className="mt-2 text-xs text-slate-500">
          Serie UF no sincronizada todavía — se actualiza junto con "Actualizar
          reporte".
        </p>
      )}
    </div>
  );
}
