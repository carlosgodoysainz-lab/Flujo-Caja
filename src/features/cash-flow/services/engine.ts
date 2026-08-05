import {
  calcularCotizacion,
  calcularFiniquitoProyectado,
  calcularReliquidacionProyectada,
  calcularSence,
} from "./formulas";

export interface CashFlowInputs {
  /** Suma de remuneracion_rg + remuneracion_rp ingeridas para el mes, o null si no hay dato real todavía. */
  remuneracionReal: number | null;
  reliquidacionReal: number | null;
  finiquitoReal: number | null;
  /** Anticipos reales — sin fuente automatizada en el MVP (Fase 10, post-MVP), normalmente null. */
  anticipoReal: number | null;
  /**
   * Base para proyectar Remuneraciones cuando no hay dato real (mes futuro).
   * Simplificación del MVP: normalmente el promedio de los últimos meses
   * reales, provisto por el caller. El modelo de proyección basado en
   * headcount (como en el Excel original) se incorpora cuando la Fase 6
   * (motor de estimación de dotación) esté disponible — ver Auto-Blindaje.
   */
  remuneracionBaseParaProyeccion: number;
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
 * ingeridos sobre proyección por fórmula — ver TECH-SPEC §3.3 (Cash-Flow
 * Engine) y §7 (fórmulas confirmadas contra el Excel original).
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
      : {
          monto: inputs.remuneracionBaseParaProyeccion,
          esReal: false,
          metodoCalculo: "proyeccion_base_promedio_historico",
        };

  const anticipo: CashFlowConceptoCalculado =
    inputs.anticipoReal !== null
      ? {
          monto: inputs.anticipoReal,
          esReal: true,
          metodoCalculo: "ingesta_real",
        }
      : {
          monto: 0,
          esReal: false,
          metodoCalculo: "sin_fuente_automatizada_fase10",
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
          monto: calcularFiniquitoProyectado(
            remuneracion.monto,
            reliquidacion.monto,
            anticipo.monto,
          ),
          esReal: false,
          metodoCalculo: "formula_30pct_remun_mas_reliq_mas_anticipo",
        };

  // Cotizaciones y SENCE siempre son fórmula — no existe fuente real
  // automatizada para estos 2 conceptos (ver TECH-SPEC §2.3).
  const cotizacion: CashFlowConceptoCalculado = {
    monto: calcularCotizacion(remuneracion.monto),
    esReal: false,
    metodoCalculo: "formula_24pct_remuneracion",
  };
  const sence: CashFlowConceptoCalculado = {
    monto: calcularSence(remuneracion.monto),
    esReal: false,
    metodoCalculo: "formula_8pct_remuneracion_mas_30M",
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
