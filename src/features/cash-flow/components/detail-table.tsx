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
    <div className="overflow-x-auto rounded-md bg-cgs-surface p-2">
      <Table className="font-mono-cgs">
        <TableHeader>
          <TableRow className="border-cgs-line hover:bg-transparent">
            <TableHead
              rowSpan={conColumnaN ? 2 : 1}
              className="font-body font-bold uppercase tracking-wide text-cgs-text-muted"
            >
              Concepto
            </TableHead>
            {periodos.map((p) =>
              conColumnaN ? (
                <TableHead
                  key={p}
                  colSpan={2}
                  className="font-body text-center font-bold uppercase tracking-wide text-cgs-text-muted"
                >
                  {p.slice(0, 7)}
                </TableHead>
              ) : (
                <TableHead
                  key={p}
                  className="font-body text-right font-bold uppercase tracking-wide text-cgs-text-muted"
                >
                  {p.slice(0, 7)}
                </TableHead>
              ),
            )}
          </TableRow>
          {conColumnaN && (
            <TableRow className="border-cgs-line hover:bg-transparent">
              {periodos.map((p) => (
                <Fragment key={p}>
                  <TableHead className="text-right text-[10px] font-normal text-cgs-text-muted">
                    $
                  </TableHead>
                  <TableHead className="text-right text-[10px] font-normal text-cgs-text-muted">
                    N°
                  </TableHead>
                </Fragment>
              ))}
            </TableRow>
          )}
        </TableHeader>
        <TableBody>
          {dotacionPorPeriodo && dotacionPorPeriodo.size > 0 && (
            <TableRow className="border-cgs-line border-b-2 hover:bg-white/5">
              <TableCell className="font-body font-medium text-cgs-text-muted">
                Dotación (N°)
              </TableCell>
              {periodos.map((p) => {
                const punto = dotacionPorPeriodo.get(p);
                const clase = `text-right ${punto && !punto.esReal ? "text-cgs-text-muted italic" : "text-cgs-text"}`;
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
                className={`border-cgs-line hover:bg-white/5 ${
                  fila.concepto === "total_nomina"
                    ? "font-semibold text-cgs-signal"
                    : "text-cgs-text"
                }`}
              >
                <TableCell className="font-body">{fila.label}</TableCell>
                {periodos.map((p) => {
                  const punto = valorPorConceptoYPeriodo.get(
                    `${fila.concepto}::${p}`,
                  );
                  const clase = `text-right ${punto && !punto.esReal ? "text-cgs-text-muted italic" : ""}`;
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
                <TableRow
                  key={sub.concepto}
                  className="border-cgs-line text-cgs-text-muted hover:bg-white/5"
                >
                  <TableCell className="font-body pl-6 text-xs">
                    {sub.label}
                  </TableCell>
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
                          className={`text-right text-xs text-cgs-text-muted`}
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
            // Voltio Azul SOLO como borde (pasa el umbral 3:1 de UI/no-texto)
            // — como color de TEXTO sobre Carbón/Surface falla WCAG AA
            // (3.37:1 < 4.5:1 requerido), por eso el texto va en Combustión.
            <TableRow className="border-cgs-structure border-t-2 text-cgs-signal hover:bg-white/5">
              <TableCell className="font-body font-medium">
                Total Nómina (UF)
              </TableCell>
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
        <p className="font-body mt-2 text-xs text-cgs-text-muted">
          Serie UF no sincronizada todavía — se actualiza junto con "Actualizar
          reporte".
        </p>
      )}
    </div>
  );
}
