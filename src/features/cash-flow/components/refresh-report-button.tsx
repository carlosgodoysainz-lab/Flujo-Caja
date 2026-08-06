"use client";

import { useActionState } from "react";
import {
  refreshCashFlowReport,
  type RefreshReportResult,
} from "../services/refresh";
import { Button } from "@/shared/ui/button";

export function RefreshReportButton({
  periodoDesde,
  periodoHasta,
}: {
  periodoDesde: string;
  periodoHasta: string;
}) {
  const [result, formAction, isPending] = useActionState<
    RefreshReportResult | null,
    FormData
  >(
    async () =>
      refreshCashFlowReport(new Date(periodoDesde), new Date(periodoHasta)),
    null,
  );

  return (
    <div className="space-y-2">
      <form action={formAction}>
        <Button type="submit" disabled={isPending}>
          {isPending
            ? "Actualizando… (puede tomar 1-2 min)"
            : "Actualizar reporte"}
        </Button>
      </form>
      {result && (
        <div className="rounded-md border border-slate-200 p-3 text-sm">
          <p
            className={
              result.estado === "ok"
                ? "text-[var(--ok)]"
                : result.estado === "parcial"
                  ? "text-[var(--warn)]"
                  : "text-[var(--err)]"
            }
          >
            <strong>{result.estado.toUpperCase()}</strong> —{" "}
            {result.mesesRecalculados} meses recalculados,{" "}
            {result.documentosIngeridos} documentos ingeridos,{" "}
            {result.obrasEstimadas} obras con dotación estimada nueva
          </p>
          {result.errores.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-[var(--err)]">
              {result.errores.map((e, i) => (
                <li key={i}>
                  <strong>{e.fuente}:</strong> {e.mensaje}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
