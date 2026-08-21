"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [result, formAction, isPending] = useActionState<
    RefreshReportResult | null,
    FormData
  >(async () => {
    const resultado = await refreshCashFlowReport(
      new Date(periodoDesde),
      new Date(periodoHasta),
    );
    // BUG REAL reportado: la base quedaba actualizada (confirmado
    // directo en la BD) pero la página seguía mostrando los datos
    // VIEJOS — este botón es un Server Action llamado desde un Client
    // Component; actualiza la base, pero el resto de la página (KPIs,
    // gráfico, tabla de detalle) es un Server Component que ya se
    // renderizó UNA vez al cargar — sin esto, nunca se vuelve a pedir al
    // servidor. `router.refresh()` re-ejecuta los Server Components de
    // la página con los datos frescos, sin perder el estado de este
    // botón (el resultado sigue mostrándose abajo).
    router.refresh();
    return resultado;
  }, null);

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
        <div
          className="font-body rounded-md border p-3 text-sm text-cgs-text"
          style={{
            borderColor: "var(--cgs-line)",
            backgroundColor: "var(--cgs-surface)",
          }}
        >
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
