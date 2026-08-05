"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { overrideCashFlowValue } from "../services/override";

function formatCLP(monto: number): string {
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(
    monto,
  );
}

/**
 * Celda editable para el Aporte SENCE — el ÚNICO concepto que es siempre
 * manual, nunca fórmula (pedido explícito del usuario: "es específico para
 * el periodo"). Sin esta celda no habría forma de cargar el dato — el
 * motor (engine.ts) lo deja en 0/"pendiente_ingreso_manual" hasta que
 * alguien lo ingresa acá, vía `overrideCashFlowValue` (mismo mecanismo de
 * auditoría que cualquier otro ajuste manual, ver override.ts).
 */
export function SenceEditableCell({
  periodo,
  monto,
  esReal,
}: {
  periodo: string;
  monto: number;
  esReal: boolean;
}) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(String(Math.round(monto)));
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (!editando) {
    return (
      <button
        type="button"
        onClick={() => {
          setValor(String(Math.round(monto)));
          setEditando(true);
        }}
        className={`w-full text-right ${esReal ? "" : "text-slate-400 italic"} hover:underline`}
        title="Click para ingresar el Aporte SENCE de este mes (dato manual)"
      >
        {esReal ? formatCLP(monto) : "— pendiente"}
      </button>
    );
  }

  return (
    <form
      className="flex items-center justify-end gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        const numero = Number(valor.replace(/\./g, "").replace(/,/g, "."));
        if (Number.isNaN(numero)) return;
        startTransition(async () => {
          await overrideCashFlowValue(new Date(periodo), "sence", numero);
          setEditando(false);
          router.refresh();
        });
      }}
    >
      <input
        autoFocus
        type="text"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditando(false);
        }}
        disabled={isPending}
        className="w-24 rounded border border-slate-300 px-1 py-0.5 text-right text-sm"
      />
      <button
        type="submit"
        disabled={isPending}
        className="text-xs text-[var(--navy-brand)]"
      >
        ✓
      </button>
    </form>
  );
}
