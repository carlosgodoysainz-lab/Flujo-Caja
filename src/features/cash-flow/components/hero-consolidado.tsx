import type { ResumenKpis } from "../services/queries";
import { CashFlowAreaChart } from "./cash-flow-area-chart";
import type { CashFlowSeriePunto } from "../services/queries";

function formatCLP(monto: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(monto);
}

function formatMesLargo(periodo: string): string {
  const [anio, mes] = periodo.split("-");
  return new Date(Number(anio), Number(mes) - 1, 1).toLocaleDateString(
    "es-CL",
    { month: "long", year: "numeric" },
  );
}

/**
 * Hero consolidado — fondo Carbón (Marca Personal CGS, reemplaza el navy
 * de Marca Maestra, decisión explícita del usuario 21-ago-2026), headline
 * + subtítulo, fila de KPIs, gráfico de escala debajo. KPIs elegidos por
 * relevancia real de flujo de caja de nómina, no solo "lo que teníamos
 * calculado": la pregunta que un flujo de caja de nómina debe responder
 * es "¿cuánta caja necesito reservar los próximos N meses?", no solo
 * "¿cuánto fue el mes pasado?".
 */
export function HeroConsolidado({
  kpis,
  serie,
  sesionEmail,
  onCerrarSesion,
}: {
  kpis: ResumenKpis;
  serie: CashFlowSeriePunto[];
  sesionEmail?: string | null;
  onCerrarSesion?: () => Promise<void>;
}) {
  const variacionTexto =
    kpis.variacionPct === null
      ? "—"
      : `${kpis.variacionPct >= 0 ? "▲" : "▼"} ${Math.abs(kpis.variacionPct).toFixed(1)}%`;

  return (
    // Full-bleed: fondo Carbón a lo ANCHO COMPLETO de la página; el
    // contenido interno sí se acota a max-w-6xl y se centra, para alinear
    // con el resto de la página de abajo.
    <section className="relative w-full bg-cgs-carbon text-cgs-text">
      {/* Posicionado respecto al hero completo (full-bleed), no al
          contenedor centrado max-w-6xl de abajo — pedido explícito
          ("quede en la esquina superior derecha"): dentro del div
          centrado quedaba en la esquina de ESE bloque, no de la página. */}
      {onCerrarSesion && (
        <form action={onCerrarSesion} className="absolute top-4 right-6 z-10">
          <button
            type="submit"
            className="text-xs text-cgs-text-muted hover:text-cgs-text hover:underline"
          >
            Cerrar sesión
          </button>
        </form>
      )}
      <div className="mx-auto max-w-6xl px-6 py-6">
        {sesionEmail && (
          <p className="mb-4 text-xs text-cgs-text-muted">
            Sesión: {sesionEmail}
          </p>
        )}

        <h1 className="font-display text-2xl font-bold">
          Flujo de Caja Nómina:{" "}
          <span className="text-[var(--cgs-signal)]">efectivo requerido</span>{" "}
          por mes
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-cgs-text-muted">
          Proyección de anticipos, remuneraciones, finiquitos, reliquidaciones,
          cotizaciones y SENCE — real hasta el mes actual, proyectado desde ahí.
          Actualiza abajo para traer los datos más recientes.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <KpiTile label="Este mes" valor={formatCLP(kpis.totalMesActual)} />
          <KpiTile
            label="Próximos 3 meses"
            valor={formatCLP(kpis.totalProximosTresMeses)}
            destacado
          />
          <KpiTile
            label="Próximos 12 meses"
            valor={formatCLP(kpis.totalProximosDoceMeses)}
          />
          <KpiTile
            label="Variación vs. mes anterior"
            valor={variacionTexto}
            colorClass={
              kpis.variacionPct === null
                ? "text-cgs-text-muted"
                : kpis.variacionPct >= 0
                  ? "text-[var(--err)]"
                  : "text-[var(--ok)]"
            }
          />
          <KpiTile
            label="Dotación total (mes actual)"
            valor={
              kpis.dotacionMesActual != null
                ? new Intl.NumberFormat("es-CL").format(kpis.dotacionMesActual)
                : "—"
            }
            colorClass={
              kpis.dotacionMesActual != null && !kpis.dotacionMesActualEsReal
                ? "text-cgs-text-muted"
                : undefined
            }
          />
        </div>

        {kpis.mesPico && (
          <p className="mt-3 text-xs text-cgs-text-muted">
            📈 El mes de mayor requerimiento proyectado es{" "}
            <strong className="text-cgs-text">
              {formatMesLargo(kpis.mesPico.periodo)}
            </strong>{" "}
            con{" "}
            <strong className="text-cgs-text">
              {formatCLP(kpis.mesPico.monto)}
            </strong>{" "}
            — {kpis.mesesProyectadosEnRango} de los meses en el rango son
            proyección, no dato real todavía.
          </p>
        )}
      </div>

      {/* El gráfico va en SU PROPIO contenedor, más ancho que el resto del
          hero (max-w-6xl arriba) — pedido explícito del usuario ("más
          amplia hacia los lados"), y coherente con "Escala de Obras" de
          referencia, que también ocupa mucho más ancho que el resto de su
          dashboard. */}
      <div className="mx-auto max-w-[1600px] px-4 pb-6">
        <div className="rounded-md bg-white/5 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-cgs-text-muted">
            Total Nómina mensual — real y proyectado
          </p>
          <CashFlowAreaChart serie={serie} />
        </div>
      </div>
    </section>
  );
}

function KpiTile({
  label,
  valor,
  destacado,
  colorClass,
}: {
  label: string;
  valor: string;
  destacado?: boolean;
  colorClass?: string;
}) {
  return (
    <div className={`rounded-md p-3 ${destacado ? "bg-white/10" : ""}`}>
      <p className="font-body text-[11px] font-bold tracking-wide uppercase text-cgs-text-muted">
        {label}
      </p>
      <p
        className={`font-mono-cgs mt-0.5 text-lg font-medium ${colorClass ?? "text-[var(--cgs-signal)]"}`}
      >
        {valor}
      </p>
    </div>
  );
}
