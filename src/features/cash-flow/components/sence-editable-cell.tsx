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
 *
 * `metodoCalculo` distingue 3 estados que antes se veían idénticos (todo
 * "— pendiente" con `esReal=false`, ver Auto-Blindaje 17-ago-2026):
 * - `no_corresponde_pago_anual`: el modelo YA sabe que este mes no paga
 *   SENCE (solo se paga una vez al año) — es un "$0" CONFIRMADO, no una
 *   incertidumbre. Nunca debe mostrar "pendiente".
 * - `proyeccion_pago_anual`: es un mes futuro de pago (500 UF) sin dato
 *   real todavía — se muestra el monto proyectado, no se oculta.
 * - `pendiente_ingreso_manual` (o sin metodoCalculo): SÍ es el mes de pago
 *   y falta el dato real — este es el único caso que amerita "pendiente".
 */
export function SenceEditableCell({
  periodo,
  monto,
  esReal,
  metodoCalculo,
}: {
  periodo: string;
  monto: number;
  esReal: boolean;
  metodoCalculo: string | null;
}) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(String(Math.round(monto)));
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (!editando) {
    const noCorresponde = metodoCalculo === "no_corresponde_pago_anual";
    const proyeccion = metodoCalculo === "proyeccion_pago_anual";
    // "$0 confirmado" o "proyección futura" muestran su monto tal cual
    // (en el mismo estilo gris/itálico de cualquier celda proyectada) —
    // solo el mes de pago real sin dato ingerido todavía usa "— pendiente".
    const texto =
      esReal || noCorresponde || proyeccion ? formatCLP(monto) : "— pendiente";
    return (
      <button
        type="button"
        onClick={() => {
          setValor(String(Math.round(monto)));
          setEditando(true);
        }}
        className={`w-full text-right ${esReal ? "text-cgs-text" : "text-cgs-text-muted italic"} hover:underline`}
        title="Click para ingresar el Aporte SENCE de este mes (dato manual)"
      >
        {texto}
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
        className="font-mono-cgs w-24 rounded border px-1 py-0.5 text-right text-sm text-cgs-text"
        style={{
          borderColor: "var(--cgs-line)",
          backgroundColor: "var(--cgs-surface-2)",
        }}
      />
      <button
        type="submit"
        disabled={isPending}
        className="text-xs font-semibold text-cgs-signal"
      >
        ✓
      </button>
    </form>
  );
}
