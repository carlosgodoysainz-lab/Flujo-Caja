"use client";

import { useActionState, useRef } from "react";
import {
  subirHeadcountManual,
  type HeadcountUploadResult,
} from "../services/upload-manual";
import { Button } from "@/shared/ui/button";

const ESTADO_LABEL: Record<
  HeadcountUploadResult["estado"],
  { text: string; className: string }
> = {
  preview: { text: "Revisa antes de guardar", className: "text-[var(--warn)]" },
  ok: { text: "OK", className: "text-[var(--ok)]" },
  parcial: { text: "Parcial", className: "text-[var(--warn)]" },
  error: { text: "Error", className: "text-[var(--err)]" },
};

function formatoPeriodo(periodo: string): string {
  return periodo.slice(0, 7);
}

/**
 * Carga manual de dotación por obra — pedido explícito del usuario
 * 25-ago-2026, en vez de un formulario campo-por-campo: "sube el mismo
 * Excel que ya descargas, edita los números que necesites, vuelve a
 * subirlo". Primer file upload de la app (mismo patrón de
 * `sync-pagos-mensuales-form.tsx` — `useActionState` + `<form
 * action={formAction}>`, acá con `<input type="file">` en vez de un
 * selector de mes).
 *
 * Dos pasos, el primero NUNCA escribe (ver Auto-Blindaje 21-sep-2026: el
 * bug real era que re-subir el archivo sin editar nada fosilizaba toda la
 * grilla como manual): "Revisar cambios" corre el análisis y muestra
 * exactamente qué celdas se detectaron como editadas; "Confirmar y
 * guardar" reenvía el mismo archivo con `confirmar=1`.
 */
export function UploadHeadcountManualForm() {
  const [result, formAction, isPending] = useActionState<
    HeadcountUploadResult | null,
    FormData
  >(subirHeadcountManual, null);
  const formRef = useRef<HTMLFormElement>(null);

  const esPreview = result?.estado === "preview";

  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-4">
      <p className="text-sm font-medium text-slate-900">
        Carga manual de dotación
      </p>
      <p className="text-xs text-slate-500">
        Descarga el Excel &quot;Proyección Headcount&quot; (botón de descarga en
        /reporte), edita los meses que necesites y vuelve a subir el mismo
        archivo. <strong>Solo los meses que cambies quedan fijos</strong> — el
        resto lo sigue calculando el sistema (Buk real o el modelo). No borres
        ni edites la columna oculta &quot;Obra ID&quot;.
      </p>
      <form ref={formRef} action={formAction} className="flex items-end gap-2">
        <input
          type="file"
          name="archivo"
          accept=".xlsx"
          required={!esPreview}
          className="text-sm"
        />
        {esPreview && <input type="hidden" name="confirmar" value="1" />}
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending
            ? "Analizando…"
            : esPreview
              ? "Confirmar y guardar"
              : "Revisar cambios"}
        </Button>
        {esPreview && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => formRef.current?.reset()}
          >
            Cancelar
          </Button>
        )}
      </form>

      {result && (
        <div className="space-y-2 text-sm">
          <p className={ESTADO_LABEL[result.estado].className}>
            <strong>{ESTADO_LABEL[result.estado].text}</strong>
            {result.estado === "preview" &&
              ` — se detectaron ${result.celdasEditadas ?? 0} celda(s) editada(s) en ${result.obrasAfectadas ?? 0} obra(s).`}
            {(result.estado === "ok" || result.estado === "parcial") &&
              ` — ${result.celdasGuardadas} celda(s) guardada(s) como dato manual.`}
          </p>

          {esPreview && (
            <>
              {result.modoCompatibilidad && (
                <p className="rounded border border-[var(--warn)] bg-amber-50 p-2 text-[var(--warn)]">
                  Este archivo se descargó antes de la última actualización: no
                  trae la marca que permite saber con certeza qué editaste, así
                  que se comparó contra los datos actuales. Si el modelo se
                  actualizó después de que lo descargaste, algunas diferencias
                  pueden no ser tuyas — revisa la lista antes de confirmar.
                </p>
              )}
              <p className="text-slate-500">
                Las otras {result.celdasSinCambios ?? 0} celda(s) del archivo
                quedan como están: las sigue calculando el modelo o Buk. Solo lo
                que editaste queda fijo.
              </p>
              {result.detallePreview && result.detallePreview.length > 0 && (
                <div className="space-y-1 rounded border border-slate-200 p-2">
                  {result.detallePreview.map((obra) => (
                    <div key={obra.obra}>
                      <p className="font-medium text-slate-700">{obra.obra}</p>
                      <ul className="pl-4 text-slate-600">
                        {obra.cambios.map((c) => (
                          <li key={c.periodo}>
                            {formatoPeriodo(c.periodo)}: {c.anterior ?? "—"} →{" "}
                            {c.nuevo}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {!esPreview &&
            (result.estado === "ok" || result.estado === "parcial") && (
              <p className="text-slate-500">
                Se actualizó además el acumulado de los meses posteriores de
                esas obras (siguen siendo estimados/reales, no quedan fijos).
              </p>
            )}

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
