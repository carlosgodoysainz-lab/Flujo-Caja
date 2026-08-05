"use client";

import { useActionState } from "react";
import { runForecastModel, type RunForecastModelResult } from "../run";
import { Button } from "@/shared/ui/button";

export function RunForecastButton({ obraId }: { obraId: string }) {
  const [result, formAction, isPending] = useActionState<
    RunForecastModelResult | null,
    FormData
  >(async () => runForecastModel(obraId), null);

  return (
    <div className="space-y-1">
      <form action={formAction}>
        <Button type="submit" size="sm" variant="outline" disabled={isPending}>
          {isPending ? "Estimando…" : "Estimar dotación"}
        </Button>
      </form>
      {result && (
        <p
          className={`text-xs ${result.estado === "ok" ? "text-[var(--ok)]" : "text-[var(--err)]"}`}
        >
          {result.estado === "ok"
            ? `${result.mesesEstimados} meses estimados (${result.obrasReferenciaUsadas} obras de referencia)`
            : result.errores[0]}
        </p>
      )}
    </div>
  );
}
