import {
  calcularAnticipoProyectado,
  calcularCotizacion,
  calcularReliquidacionProyectada,
  calcularRemuneracionProyectada,
} from "./formulas";

export interface CashFlowInputs {
  /** Suma de remuneracion_rg + remuneracion_rp ingeridas para el mes, o null si no hay dato real todavía. */
  remuneracionReal: number | null;
  reliquidacionReal: number | null;
  finiquitoReal: number | null;
  /** Real cuando existe archivo en "Pagos Mensuales/Anticipo" para el mes (ver sync-pagos-mensuales.ts). */
  anticipoReal: number | null;
  /**
   * Real cuando existe el comprobante oficial de pago de Previred para
   * el mes (suma de todos los comprobantes de la compañía — ver
   * sync-cotizacion-previred.ts). `null` si no hay ningún comprobante
   * ingerido todavía para ese mes.
   */
  cotizacionReal: number | null;
  /**
   * Aporte SENCE — dato SIEMPRE manual (nunca fórmula), específico del
   * período. Viene de un override manual ya guardado en `cash_flow_monthly`
   * (ver `override.ts`) o `null` si nadie lo ha ingresado todavía para ese
   * mes.
   */
  senceManual: number | null;
  /**
   * Proyección de respaldo cuando NO hay `senceManual` todavía — pedido
   * explícito del usuario: SENCE se paga una vez al año, el 30 de junio,
   * 500 UF (2026 es la excepción: se retrasó a agosto). El caller
   * (`refresh.ts`) ya resuelve el monto (500 UF × valor UF real de ese
   * mes) y el motivo exacto (fuera de fecha / pendiente / proyectado) —
   * sigue quedando `esReal=false` siempre: es una proyección, no
   * reemplaza cargar el monto real cuando se sepa.
   */
  senceFallback: { monto: number; metodoCalculo: string };
  /**
   * Costo promedio por cabeza — la "P" (precio) del modelo Remuneración =
   * precio × cantidad. Pese al nombre del campo (histórico, se mantiene
   * para no romper la firma), YA NO es el costo del mes anterior: desde el
   * 24-sep-2026 es el promedio de los últimos 3 meses REALES de
   * (Remuneración SIN beneficios/aguinaldos) ÷ dotación real, fijo hacia
   * adelante — ver `costoBasePorCabezaPura` en `refresh.ts`. `null` si no
   * hay suficiente historia real todavía.
   */
  costoPromedioPorCabezaMesAnterior: number | null;
  /** Dotación total estimada/real del mes ACTUAL — la "cantidad" del modelo. */
  dotacionActual: number | null;
  /**
   * Fallback si no hay dato de dotación (obra nueva sin histórico, Buk
   * histórico insuficiente): promedio de los últimos meses reales,
   * provisto por el caller.
   */
  remuneracionFallbackPromedioHistorico: number;
  /**
   * Fallback de Finiquito cuando no hay dato real — ya resuelto por el
   * caller (`refresh.ts`): siempre el promedio de los últimos 6 meses
   * reales. Se evaluó un modelo correlacionado con bajas netas de
   * dotación (13-ago-2026) y se simplificó de vuelta a esto (21-ago-2026,
   * pedido explícito del usuario). Siempre `esReal=false` — es una
   * proyección.
   */
  finiquitoFallback: { monto: number; metodoCalculo: string };
  /**
   * Beneficios/Bonos ya resueltos por población — RG (Convenio Colectivo
   * Lira Parque) y RP (Anexo Beneficio Oficina Central), ver
   * `beneficios.ts` (real ingresado > fórmula fecha-fija > promedio 6
   * meses > 0). NO son un concepto aparte — el usuario pidió
   * explícitamente que se sumen de forma IMPLÍCITA dentro de
   * `remuneracion` ("no quiero que agregues estos como adicionales... se
   * deben considerar de manera implícita en las remuneraciones",
   * 13-ago-2026): no generan fila propia ni concepto propio en
   * `cash_flow_monthly`, solo inflan el monto final de Remuneración.
   */
  beneficiosRg: CashFlowConceptoCalculado;
  beneficiosRp: CashFlowConceptoCalculado;
  /**
   * Aguinaldos (Fiestas Patrias, Navidad) por población — mismo catálogo
   * que `beneficiosRg`/`beneficiosRp` (ver `beneficios.ts`), pero estos
   * SÍ son un sumando aparte: se pagan CON EL ANTICIPO, no con la
   * Remuneración de fin de mes (aclaración explícita del usuario,
   * 24-sep-2026: "los aguinaldos se pagan con los anticipos, así funciona
   * en la realidad"). Se suman al Anticipo PROYECTADO únicamente — cuando
   * el Anticipo es real, el aguinaldo ya viene incluido en ese monto.
   */
  beneficiosAnticipoRg: CashFlowConceptoCalculado;
  beneficiosAnticipoRp: CashFlowConceptoCalculado;
  /**
   * Eventos del Plan de Dotación, ya en pesos (bono rol general de ene/jul
   * reajustado en UF, bono de término de obra, etc. — ver plan_eventos).
   * Solo se suman cuando el concepto es PROYECTADO: un mes real ya trae el
   * pago adentro. Los de Remuneración NO entran a la base del Anticipo
   * (mismo criterio del Excel tradicional del usuario: `Remun×24% −
   * bono×24%`), pero SÍ a Reliquidación y Cotización, que se calculan
   * sobre la Remuneración con el bono incluido. Por defecto 0.
   */
  eventosRemuneracion?: number;
  eventosAnticipo?: number;
  /**
   * % real de Anticipo/Remuneración, promedio de los últimos meses reales
   * (ver `pctSobreRemuneracionAprendido` en `refresh.ts`) — auto-
   * aprendizaje pedido explícito del usuario 24-ago-2026: "los % fijos
   * pasan a recalcularse solos con los últimos meses reales". `null` si
   * todavía no hay ningún mes real disponible — ahí `calcularAnticipoProyectado`
   * cae de vuelta al 24% fijo (`ANTICIPO_PCT`, ver formulas.ts).
   */
  anticipoPctAprendido: number | null;
  /** Mismo mecanismo que `anticipoPctAprendido`, para Reliquidación (fallback: `RELIQUIDACION_PCT`, 1%). */
  reliquidacionPctAprendido: number | null;
  /** Mismo mecanismo que `anticipoPctAprendido`, para Cotización sobre (Anticipo+Remuneración+Reliquidación) (fallback: `COTIZACION_PCT`, 30%). */
  cotizacionPctAprendido: number | null;
}

export interface CashFlowConceptoCalculado {
  monto: number;
  esReal: boolean;
  metodoCalculo: string;
}

export interface CashFlowMesCalculado {
  anticipo: CashFlowConceptoCalculado;
  remuneracion: CashFlowConceptoCalculado;
  reliquidacion: CashFlowConceptoCalculado;
  finiquito: CashFlowConceptoCalculado;
  cotizacion: CashFlowConceptoCalculado;
  sence: CashFlowConceptoCalculado;
  totalNomina: number;
}

/**
 * Calcula el Total Nómina de un mes, priorizando siempre datos reales
 * ingeridos (o overrides manuales) sobre proyección por fórmula — ver
 * TECH-SPEC §3.3 (Cash-Flow Engine) y §7 (metodología redefinida,
 * confirmada punto por punto con el usuario tras revisar el Excel real).
 */
export function calcularMesCashFlow(
  inputs: CashFlowInputs,
): CashFlowMesCalculado {
  const remuneracionBase: CashFlowConceptoCalculado =
    inputs.remuneracionReal !== null
      ? {
          monto: inputs.remuneracionReal,
          esReal: true,
          metodoCalculo: "ingesta_real",
        }
      : (() => {
          const { monto, metodoCalculo } = calcularRemuneracionProyectada({
            costoPromedioPorCabezaMesAnterior:
              inputs.costoPromedioPorCabezaMesAnterior,
            dotacionActual: inputs.dotacionActual,
            fallbackPromedioHistorico:
              inputs.remuneracionFallbackPromedioHistorico,
          });
          return { monto, esReal: false, metodoCalculo };
        })();

  // Beneficios/Bonos se suman de forma IMPLÍCITA acá — Remuneración pasa
  // a ser "sueldo base + beneficios/bonos del período", un solo número,
  // sin fila ni concepto aparte (ver CashFlowInputs.beneficiosRg/Rp). El
  // resto del motor (Anticipo, Reliquidación, Cotización, Total Nómina)
  // usa este monto ya inflado, así que Beneficios queda incluido en todo
  // sin tocar ninguna otra fórmula.
  const eventosRemuneracion = remuneracionBase.esReal
    ? 0
    : (inputs.eventosRemuneracion ?? 0);
  const remuneracion: CashFlowConceptoCalculado = {
    monto:
      remuneracionBase.monto +
      inputs.beneficiosRg.monto +
      inputs.beneficiosRp.monto +
      eventosRemuneracion,
    esReal: remuneracionBase.esReal,
    metodoCalculo:
      eventosRemuneracion !== 0
        ? `${remuneracionBase.metodoCalculo}_mas_eventos`
        : remuneracionBase.metodoCalculo,
  };
  const eventosAnticipo = inputs.eventosAnticipo ?? 0;

  // Aguinaldos (Fiestas Patrias/Navidad) — se pagan CON el Anticipo, no
  // con la Remuneración (ver CashFlowInputs.beneficiosAnticipoRg/Rp). Solo
  // se suman al Anticipo PROYECTADO: cuando el Anticipo es real, ya trae
  // el aguinaldo pagado adentro — sumarlo otra vez lo duplicaría.
  const beneficiosAnticipoTotal =
    inputs.beneficiosAnticipoRg.monto + inputs.beneficiosAnticipoRp.monto;

  const anticipo: CashFlowConceptoCalculado =
    inputs.anticipoReal !== null
      ? {
          monto: inputs.anticipoReal,
          esReal: true,
          metodoCalculo: "ingesta_real",
        }
      : {
          monto:
            calcularAnticipoProyectado(
              remuneracion.monto - eventosRemuneracion,
              inputs.anticipoPctAprendido ?? undefined,
            ) +
            beneficiosAnticipoTotal +
            eventosAnticipo,
          esReal: false,
          metodoCalculo: `${
            inputs.anticipoPctAprendido != null
              ? "formula_pct_aprendido_anticipo_remuneracion"
              : "formula_24pct_remuneracion"
          }${eventosAnticipo !== 0 ? "_mas_eventos" : ""}`,
        };

  const reliquidacion: CashFlowConceptoCalculado =
    inputs.reliquidacionReal !== null
      ? {
          monto: inputs.reliquidacionReal,
          esReal: true,
          metodoCalculo: "ingesta_real",
        }
      : {
          monto: calcularReliquidacionProyectada(
            remuneracion.monto,
            inputs.reliquidacionPctAprendido ?? undefined,
          ),
          esReal: false,
          metodoCalculo:
            inputs.reliquidacionPctAprendido != null
              ? "formula_pct_aprendido_reliquidacion_remuneracion"
              : "formula_1pct_remuneracion",
        };

  const finiquito: CashFlowConceptoCalculado =
    inputs.finiquitoReal !== null
      ? {
          monto: inputs.finiquitoReal,
          esReal: true,
          metodoCalculo: "ingesta_real",
        }
      : {
          monto: inputs.finiquitoFallback.monto,
          esReal: false,
          metodoCalculo: inputs.finiquitoFallback.metodoCalculo,
        };

  // Cotización real desde el comprobante oficial de pago de Previred
  // (ver sync-cotizacion-previred.ts) — antes SIEMPRE era fórmula ("no
  // existe fuente real automatizada"), corregido 17-ago-2026 tras
  // confirmar que la carpeta real sí existe. Mismo patrón real-gana-
  // sobre-fórmula que todos los demás conceptos. Beneficios ya queda
  // incluido de forma implícita vía `remuneracion.monto` (ver arriba),
  // sin necesidad de un 4to sumando en la fórmula de respaldo.
  const cotizacion: CashFlowConceptoCalculado =
    inputs.cotizacionReal !== null
      ? {
          monto: inputs.cotizacionReal,
          esReal: true,
          metodoCalculo: "ingesta_previred",
        }
      : {
          monto: calcularCotizacion(
            anticipo.monto,
            remuneracion.monto,
            reliquidacion.monto,
            inputs.cotizacionPctAprendido ?? undefined,
          ),
          esReal: false,
          metodoCalculo:
            inputs.cotizacionPctAprendido != null
              ? "formula_pct_aprendido_cotizacion_base"
              : "formula_30pct_anticipo_mas_remun_mas_reliq",
        };

  // Aporte SENCE: SIEMPRE manual, nunca fórmula — pero si nadie lo ha
  // cargado todavía, se puede proyectar un estimado (pago anual, ver
  // `senceFallbackProyectado`) en vez de inventar un valor arbitrario.
  // Sigue sin ser "real" hasta que alguien cargue el monto exacto de ese
  // período.
  const sence: CashFlowConceptoCalculado =
    inputs.senceManual !== null
      ? {
          monto: inputs.senceManual,
          esReal: true,
          metodoCalculo: "manual_override",
        }
      : {
          monto: inputs.senceFallback.monto,
          esReal: false,
          metodoCalculo: inputs.senceFallback.metodoCalculo,
        };

  const totalNomina =
    anticipo.monto +
    remuneracion.monto +
    finiquito.monto +
    reliquidacion.monto +
    cotizacion.monto +
    sence.monto;

  return {
    anticipo,
    remuneracion,
    reliquidacion,
    finiquito,
    cotizacion,
    sence,
    totalNomina,
  };
}
