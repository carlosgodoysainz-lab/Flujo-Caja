"use client";

import { useActionState } from "react";
import {
  syncPagosMensuales,
  type SyncPagosMensualesResult,
} from "../services/sync-pagos-mensuales";
import { Button } from "@/shared/ui/button";

const ESTADO_LABEL: Record<
  SyncPagosMensualesResult["estado"],
  { text: string; className: string }
> = {
  ok: { text: "OK", className: "text-[var(--ok)]" },
  parcial: { text: "Parcial", className: "text-[var(--warn)]" },
  error: { text: "Error", className: "text-[var(--err)]" },
};

function defaultMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function SyncPagosMensualesForm() {
  const [result, formAction, isPending] = useActionState<
    SyncPagosMensualesResult | null,
    FormData
  >(async (_prev, formData) => {
    const mesValor = formData.get("mes") as string; // "YYYY-MM"
    const [anio, mes] = mesValor.split("-").map(Number);
    return syncPagosMensuales(new Date(anio, mes - 1, 1));
  }, null);

  return (
    <div className="space-y-3">
      <form action={formAction} className="flex items-end gap-2">
        <div>
          <label htmlFor="mes" className="block text-xs text-slate-500">
            Mes a sincronizar
          </label>
          <input
            id="mes"
            name="mes"
            type="month"
            defaultValue={defaultMonthValue()}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Sincronizando…" : "Sincronizar mes"}
        </Button>
      </form>

      {result && (
        <div className="rounded-md border border-slate-200 p-3 text-sm">
          <p className={ESTADO_LABEL[result.estado].className}>
            <strong>{ESTADO_LABEL[result.estado].text}</strong> — período{" "}
            {result.periodo}
          </p>
          <p className="text-slate-600">
            {result.lineItemsIngeridos} filas ingeridas de{" "}
            {result.archivosProcesados.length} archivo(s)
            {result.archivosProcesados.length > 0 && (
              <>
                :{" "}
                <code className="text-xs">
                  {result.archivosProcesados.join(", ")}
                </code>
              </>
            )}
          </p>
          {result.errores.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-[var(--err)]">
              {result.errores.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
