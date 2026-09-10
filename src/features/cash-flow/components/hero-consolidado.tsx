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
 * Hero consolidado — fondo navy (Marca Maestra), headline
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
    // Full-bleed: fondo navy a lo ANCHO COMPLETO de la página. El
    // bloque de título/KPIs de abajo se ensancha a max-w-[1600px] (mismo
    // ancho que el gráfico) — antes quedaba a max-w-6xl (1152px), más
    // angosto que el gráfico, lo que se veía descuadrado al lado de él
    // (pedido explícito del usuario, 25-ago-2026). El resto de la página
    // (tabla de detalle) sigue en max-w-6xl — solo el hero se ensancha.
    <section className="relative w-full bg-[var(--navy)] text-white">
      {/* Posicionado respecto al hero completo (full-bleed), no al
          contenedor centrado de abajo — pedido explícito
          ("quede en la esquina superior derecha"): dentro del div
          centrado quedaba en la esquina de ESE bloque, no de la página. */}
      {onCerrarSesion && (
        <form action={onCerrarSesion} className="absolute top-4 right-6 z-10">
          <button
            type="submit"
            className="text-xs text-white/50 hover:text-white hover:underline"
          >
            Cerrar sesión
          </button>
        </form>
      )}
      <div className="mx-auto max-w-[1600px] px-6 py-6">
        {sesionEmail && (
          <p className="mb-4 text-xs text-white/50">Sesión: {sesionEmail}</p>
        )}

        <h1 className="text-2xl font-semibold">
          Flujo de Caja Nómina:{" "}
          <span className="text-[var(--gold)]">efectivo requerido</span> por mes
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-white/70">
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
                ? "text-white/50"
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
                ? "text-white/60"
                : undefined
            }
          />
        </div>

        {kpis.mesPico && (
          <p className="mt-3 text-xs text-white/60">
            📈 El mes de mayor requerimiento proyectado es{" "}
            <strong className="text-white">
              {formatMesLargo(kpis.mesPico.periodo)}
            </strong>{" "}
            con{" "}
            <strong className="text-white">
              {formatCLP(kpis.mesPico.monto)}
            </strong>{" "}
            — {kpis.mesesProyectadosEnRango} de los meses en el rango son
            proyección, no dato real todavía.
          </p>
        )}
      </div>

      {/* El gráfico comparte el mismo max-w-[1600px] que el bloque de
          arriba (ver comentario del section) — antes era su propio ancho
          distinto del resto del hero, ahora ambos están alineados. */}
      <div className="mx-auto max-w-[1600px] px-4 pb-6">
        <div className="rounded-md bg-white/5 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-white/50">
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
      <p className="text-[11px] text-white/60">{label}</p>
      <p
        className={`mt-0.5 text-lg font-semibold ${colorClass ?? "text-[var(--gold)]"}`}
      >
        {valor}
      </p>
    </div>
  );
}
