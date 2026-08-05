"use client";

import { useActionState } from "react";
import { syncObrasFromGespro, type SyncObrasResult } from "../services/sync";
import { Button } from "@/shared/ui/button";

const ESTADO_LABEL: Record<
  SyncObrasResult["estado"],
  { text: string; className: string }
> = {
  ok: { text: "OK", className: "text-[var(--ok)]" },
  parcial: { text: "Parcial", className: "text-[var(--warn)]" },
  error: { text: "Error", className: "text-[var(--err)]" },
};

export function SyncObrasButton() {
  const [result, formAction, isPending] = useActionState<
    SyncObrasResult | null,
    FormData
  >(async () => syncObrasFromGespro(), null);

  return (
    <div className="space-y-3">
      <form action={formAction}>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Sincronizando…" : "Sincronizar ahora"}
        </Button>
      </form>

      {result && (
        <div className="rounded-md border border-slate-200 p-3 text-sm">
          <p className={ESTADO_LABEL[result.estado].className}>
            <strong>{ESTADO_LABEL[result.estado].text}</strong>
            {result.archivoUsado && <> — archivo: {result.archivoUsado}</>}
          </p>
          <p className="text-slate-600">
            {result.obrasSincronizadas} obras sincronizadas
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
