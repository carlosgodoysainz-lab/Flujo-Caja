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
   * Aporte SENCE — dato SIEMPRE manual (nunca fórmula), específico del
   * período. Viene de un override manual ya guardado en `cash_flow_monthly`
   * (ver `override.ts`) o `null` si nadie lo ha ingresado todavía para ese
   * mes.
   */
  senceManual: number | null;
  /**
   * Proyección de respaldo cuando NO hay `senceManual` todavía — pedido
   * explícito del usuario: SENCE se paga una vez al año, normalmente en
   * junio ($20.000.000 en 2026, la excepción de este año fue agosto). El
   * caller (`refresh.ts`) decide el monto según el mes/año — 0 en meses
   * sin pago esperado. Sigue quedando `esReal=false` siempre: es una
   * proyección, no reemplaza cargar el monto real cuando se sepa.
   */
  senceFallbackProyectado: number;
  /**
   * Costo promedio por cabeza del MES ANTERIOR (Remuneración$ ÷ dotación),
   * para proyectar Remuneración como precio×cantidad. `null` si no hay
   * dotación real/estimada disponible para el mes anterior — ver
   * `dotacion-total.ts`.
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
   * Promedio de los ÚLTIMOS 6 MESES con Finiquito REAL ingerido — la
   * metodología que el usuario pidió explícitamente para proyectar este
   * concepto (reemplaza la fórmula del Excel real, que era 7%×Remuneración).
   * 0 si todavía no hay 6 meses reales de historial.
   */
  finiquitoFallbackPromedio6m: number;
  /**
   * Beneficios/Bonos ya resueltos por población — RG (Convenio Colectivo
   * Lira Parque) y RP (Anexo Beneficio Oficina Central). A diferencia de
   * los demás inputs, estos llegan YA resueltos por `beneficios.ts` (real
   * ingresado > fórmula fecha-fija > promedio 6 meses > 0) porque agregan
   * múltiples tipos de evento con su propia regla cada uno — el mismo
   * nivel de detalle que resuelve `sence` no alcanza para un solo booleano.
   */
  beneficiosRg: CashFlowConceptoCalculado;
  beneficiosRp: CashFlowConceptoCalculado;
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
  beneficiosRg: CashFlowConceptoCalculado;
  beneficiosRp: CashFlowConceptoCalculado;
  beneficiosTotal: CashFlowConceptoCalculado;
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
  const remuneracion: CashFlowConceptoCalculado =
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

  const anticipo: CashFlowConceptoCalculado =
    inputs.anticipoReal !== null
      ? {
          monto: inputs.anticipoReal,
          esReal: true,
          metodoCalculo: "ingesta_real",
        }
      : {
          monto: calcularAnticipoProyectado(remuneracion.monto),
          esReal: false,
          metodoCalculo: "formula_24pct_remuneracion",
        };

  const reliquidacion: CashFlowConceptoCalculado =
    inputs.reliquidacionReal !== null
      ? {
          monto: inputs.reliquidacionReal,
          esReal: true,
          metodoCalculo: "ingesta_real",
        }
      : {
          monto: calcularReliquidacionProyectada(remuneracion.monto),
          esReal: false,
          metodoCalculo: "formula_1pct_remuneracion",
        };

  const finiquito: CashFlowConceptoCalculado =
    inputs.finiquitoReal !== null
      ? {
          monto: inputs.finiquitoReal,
          esReal: true,
          metodoCalculo: "ingesta_real",
        }
      : {
          monto: inputs.finiquitoFallbackPromedio6m,
          esReal: false,
          metodoCalculo: "promedio_ultimos_6_meses_reales",
        };

  // Beneficios/Bonos ya llegan resueltos por población (ver beneficios.ts)
  // — acá solo se agregan en un total combinado, mismo criterio "real si
  // al menos un componente es real" que ya usa `total_nomina` en refresh.ts.
  const beneficiosTotal: CashFlowConceptoCalculado = {
    monto: inputs.beneficiosRg.monto + inputs.beneficiosRp.monto,
    esReal: inputs.beneficiosRg.esReal || inputs.beneficiosRp.esReal,
    metodoCalculo: "agregado_rg_mas_rp",
  };

  // Cotizaciones siempre son fórmula — no existe fuente real automatizada
  // para este concepto (% legal estable sobre la suma de los otros 4,
  // incluye Beneficios desde el 13-ago-2026, decisión de negocio explícita
  // del usuario — ver formulas.ts).
  const cotizacion: CashFlowConceptoCalculado = {
    monto: calcularCotizacion(
      anticipo.monto,
      remuneracion.monto,
      reliquidacion.monto,
      beneficiosTotal.monto,
    ),
    esReal: false,
    metodoCalculo: "formula_30pct_anticipo_mas_remun_mas_reliq_mas_beneficios",
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
      : inputs.senceFallbackProyectado > 0
        ? {
            monto: inputs.senceFallbackProyectado,
            esReal: false,
            metodoCalculo: "proyeccion_pago_anual",
          }
        : {
            monto: 0,
            esReal: false,
            metodoCalculo: "pendiente_ingreso_manual",
          };

  const totalNomina =
    anticipo.monto +
    remuneracion.monto +
    finiquito.monto +
    reliquidacion.monto +
    cotizacion.monto +
    sence.monto +
    beneficiosTotal.monto;

  return {
    anticipo,
    remuneracion,
    reliquidacion,
    finiquito,
    cotizacion,
    sence,
    beneficiosRg: inputs.beneficiosRg,
    beneficiosRp: inputs.beneficiosRp,
    beneficiosTotal,
    totalNomina,
  };
}
