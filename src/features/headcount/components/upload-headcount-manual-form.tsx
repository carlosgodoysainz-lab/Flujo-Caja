"use client";

import { useActionState } from "react";
import {
  subirHeadcountManual,
  type HeadcountUploadResult,
} from "../services/upload-manual";
import { Button } from "@/shared/ui/button";

const ESTADO_LABEL: Record<
  HeadcountUploadResult["estado"],
  { text: string; className: string }
> = {
  ok: { text: "OK", className: "text-[var(--ok)]" },
  parcial: { text: "Parcial", className: "text-[var(--warn)]" },
  error: { text: "Error", className: "text-[var(--err)]" },
};

/**
 * Carga manual de dotación por obra — pedido explícito del usuario
 * 25-ago-2026, en vez de un formulario campo-por-campo: "sube el mismo
 * Excel que ya descargas, edita los números que necesites, vuelve a
 * subirlo". Primer file upload de la app (mismo patrón de
 * `sync-pagos-mensuales-form.tsx` — `useActionState` + `<form
 * action={formAction}>`, acá con `<input type="file">` en vez de un
 * selector de mes). El Server Action (`subirHeadcountManual`) ya recibe
 * el `FormData` completo con el archivo, sin ninguna transformación
 * previa necesaria — se pasa directo a `useActionState`.
 */
export function UploadHeadcountManualForm() {
  const [result, formAction, isPending] = useActionState<
    HeadcountUploadResult | null,
    FormData
  >(subirHeadcountManual, null);

  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-4">
      <p className="text-sm font-medium text-slate-900">
        Carga manual de dotación
      </p>
      <p className="text-xs text-slate-500">
        Descarga el Excel &quot;Proyección Headcount&quot; (botón de descarga en
        /reporte), edita los meses que necesites y vuelve a subir el mismo
        archivo — queda protegido para siempre, el modelo nunca lo pisa. No
        borres ni edites la columna oculta &quot;Obra ID&quot;.
      </p>
      <form action={formAction} className="flex items-end gap-2">
        <input
          type="file"
          name="archivo"
          accept=".xlsx"
          required
          className="text-sm"
        />
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Subiendo…" : "Subir Excel"}
        </Button>
      </form>

      {result && (
        <div className="space-y-1 text-sm">
          <p className={ESTADO_LABEL[result.estado].className}>
            <strong>{ESTADO_LABEL[result.estado].text}</strong> —{" "}
            {result.celdasGuardadas} celda(s) guardada(s) como dato manual.
          </p>
          {result.advertencias.length > 0 && (
            <ul className="list-disc pl-5 text-[var(--warn)]">
              {result.advertencias.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}
          {result.errores.length > 0 && (
            <ul className="list-disc pl-5 text-[var(--err)]">
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
