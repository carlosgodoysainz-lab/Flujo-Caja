"use client";

import { useState } from "react";
import { descargarPlantillaPlanDotacion } from "../services/descargar-plantilla-action";
import { Button } from "@/shared/ui/button";

function base64ToBlob(base64: string, contentType: string): Blob {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
}

function descargar(blob: Blob, nombreArchivo: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Descarga la plantilla "Plan Dotación Obras.xlsx" — precargada con las
 * obras vigentes, la dotación real de hoy (informativa) y el plan/eventos
 * ya cargados, si los hay. El usuario la completa y la sube a SharePoint
 * (carpeta "Flujo de Caja/Plan Dotación"), ver `sync-plan-dotacion.ts`.
 */
export function DescargarPlantillaButton() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setIsPending(true);
    setError(null);
    try {
      const result = await descargarPlantillaPlanDotacion();
      if (result.estado === "error" || !result.archivoBase64) {
        setError(
          result.errores[0] ?? "Error desconocido al generar la plantilla.",
        );
        return;
      }
      descargar(
        base64ToBlob(
          result.archivoBase64,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ),
        result.nombreArchivo ?? "Plan Dotacion Obras.xlsx",
      );
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
        onClick={handleClick}
        disabled={isPending}
      >
        {isPending ? "Generando…" : "Descargar plantilla del Plan de Dotación"}
      </Button>
      {error && <p className="text-xs text-[var(--err)]">{error}</p>}
    </div>
  );
}
