import type { CashFlowConceptoCalculado } from "./engine";

/**
 * Beneficios/Bonos por población — RG (Rol General, sindicalizado bajo el
 * Convenio Colectivo "Obra Lira Parque", firmado 5-ago-2026, vigente 24
 * meses hasta 5-ago-2028, extendido por su Art. 2.2 a TODOS los
 * trabajadores RG actuales y futuros de Maestra Construcción S.A.) y RP
 * (Rol Particular, gobernado por el Anexo "Beneficio Oficina Central
 * Indefinidos No Sindicalizados"). El usuario confirmó que la
 * segmentación es exactamente esta dimensión RG/RP que YA existe en el
 * modelo para Anticipo/Remuneración — no una dimensión nueva de
 * "sindicalizado" (ver dotacionRgRpDelMes en refresh.ts).
 *
 * Mismo espíritu que `senceMesEsperado`/`senceFallbackProyectado` en
 * refresh.ts: un catálogo de reglas por tipo de evento, resuelto con la
 * misma prioridad que el resto del motor — real ingresado > fórmula
 * fecha-fija (si aplica ese mes) > promedio de los últimos 6 meses reales
 * (solo para eventos sin fecha fija, decisión explícita del usuario) > 0.
 *
 * `pagaCon` (24-sep-2026, aclaración explícita del usuario: "los
 * aguinaldos se pagan con los anticipos, así funciona en la realidad"):
 * cada evento sale con la Remuneración de fin de mes o con el Anticipo de
 * quincena — los 2 aguinaldos (Fiestas Patrias y Navidad) van con el
 * Anticipo; el resto (aporte sindical, gift cards, bonos puntuales) sigue
 * yendo con la Remuneración, como antes.
 */

export type Poblacion = "rg" | "rp";

export type TipoEventoBeneficio =
  | "aguinaldo_fiestas_patrias"
  | "aguinaldo_navidad"
  | "bono_termino_negociacion"
  | "aporte_sindical_unico"
  | "aporte_sindical_mensual"
  | "asignacion_escolar"
  | "bono_vacaciones"
  | "bono_natalidad"
  | "bono_matrimonio"
  | "bono_fallecimiento"
  | "bono_tijerales"
  | "gift_card_higiene_seguridad";

type Modo = "fecha_fija" | "siempre_manual" | "promedio_6_meses" | "una_vez";

/**
 * Con qué pago sale el beneficio. Los aguinaldos se pagan JUNTO CON EL
 * ANTICIPO (quincena), no con la remuneración de fin de mes — aclaración
 * explícita del usuario 24-sep-2026: "los aguinaldos se pagan con los
 * anticipos, así funciona en la realidad". Por eso suman al Anticipo del
 * mes y no a Remuneración (ver engine.ts).
 */
export type PagaCon = "anticipo" | "remuneracion";

interface ConfigEvento {
  tipoEvento: TipoEventoBeneficio;
  poblacion: Poblacion;
  modo: Modo;
  /** Por defecto "remuneracion". */
  pagaCon?: PagaCon;
  /** Solo para modo="fecha_fija" — monto de la fórmula para ESE mes (0 si no aplica). */
  montoFormula?: (mes: Date, dotacionRg: number, dotacionRp: number) => number;
}

/** [2026-08-01, 2028-08-01) — vigencia de 24 meses del Convenio Lira Parque. */
const VIGENCIA_CONVENIO_DESDE = "2026-08-01";
const VIGENCIA_CONVENIO_HASTA = "2028-08-01";
function dentroDeVigenciaConvenio(mes: Date): boolean {
  const periodo = mes.toISOString().slice(0, 10);
  return (
    periodo >= VIGENCIA_CONVENIO_DESDE && periodo < VIGENCIA_CONVENIO_HASTA
  );
}

/** Art. 11 del convenio: 2 gift cards/mes si dotación RG 1-50, 3 si 50-100, 5 si >100. */
function tramoGiftCard(dotacionRg: number): number {
  if (dotacionRg > 100) return 5;
  if (dotacionRg > 50) return 3;
  return 2;
}

const CATALOGO: ConfigEvento[] = [
  {
    tipoEvento: "aguinaldo_fiestas_patrias",
    poblacion: "rg",
    modo: "fecha_fija",
    pagaCon: "anticipo",
    // Art. 8 convenio: $50.000/trabajador RG, siempre 15-sep, solo dentro
    // de la vigencia del convenio.
    montoFormula: (mes, dotacionRg) =>
      mes.getMonth() === 8 && dentroDeVigenciaConvenio(mes)
        ? 50_000 * dotacionRg
        : 0,
  },
  {
    tipoEvento: "aguinaldo_fiestas_patrias",
    poblacion: "rp",
    modo: "fecha_fija",
    pagaCon: "anticipo",
    // Anexo Oficina Central: $150.000/trabajador RP, siempre 15-sep, sin
    // fecha de término (el anexo es indefinido, no vence como el convenio).
    montoFormula: (mes, _dotacionRg, dotacionRp) =>
      mes.getMonth() === 8 ? 150_000 * dotacionRp : 0,
  },
  {
    tipoEvento: "aguinaldo_navidad",
    poblacion: "rg",
    modo: "fecha_fija",
    pagaCon: "anticipo",
    // Art. 9 convenio: $50.000/trabajador RG, siempre 15-dic.
    montoFormula: (mes, dotacionRg) =>
      mes.getMonth() === 11 && dentroDeVigenciaConvenio(mes)
        ? 50_000 * dotacionRg
        : 0,
  },
  {
    tipoEvento: "aguinaldo_navidad",
    poblacion: "rp",
    modo: "fecha_fija",
    pagaCon: "anticipo",
    montoFormula: (mes, _dotacionRg, dotacionRp) =>
      mes.getMonth() === 11 ? 150_000 * dotacionRp : 0,
  },
  {
    tipoEvento: "aporte_sindical_mensual",
    poblacion: "rg",
    modo: "fecha_fija",
    // Art. 25 convenio: $500.000 fijo cada mes durante los 24 meses de
    // vigencia — no depende de dotación.
    montoFormula: (mes) => (dentroDeVigenciaConvenio(mes) ? 500_000 : 0),
  },
  {
    tipoEvento: "gift_card_higiene_seguridad",
    poblacion: "rg",
    modo: "fecha_fija",
    // Art. 11 convenio — aproximación compañía-total (no por obra),
    // documentada como tal en el plan.
    montoFormula: (mes, dotacionRg) =>
      dentroDeVigenciaConvenio(mes) ? tramoGiftCard(dotacionRg) * 20_000 : 0,
  },
  // Pagos únicos ya comprometidos — sin fórmula, se cargan reales por
  // script (ver scripts/seed-beneficios-lira-parque-agosto-2026.ts) y
  // quedan en 0 en cualquier otro mes, para siempre.
  { tipoEvento: "bono_termino_negociacion", poblacion: "rg", modo: "una_vez" },
  { tipoEvento: "aporte_sindical_unico", poblacion: "rg", modo: "una_vez" },
  // Asignación Escolar (Art. 7 convenio): depende del N° de hijos
  // estudiando — imposible de proyectar sin datos de persona (prohibido
  // por la política de privacidad del proyecto). Siempre manual, igual
  // criterio que Aporte SENCE.
  { tipoEvento: "asignacion_escolar", poblacion: "rg", modo: "siempre_manual" },
  // Eventos sin fecha fija — decisión explícita del usuario: $0 hasta
  // acumular 6 meses de dato real, luego promedio de esos 6 meses (mismo
  // patrón que Finiquito).
  { tipoEvento: "bono_vacaciones", poblacion: "rp", modo: "promedio_6_meses" },
  { tipoEvento: "bono_natalidad", poblacion: "rg", modo: "promedio_6_meses" },
  { tipoEvento: "bono_natalidad", poblacion: "rp", modo: "promedio_6_meses" },
  { tipoEvento: "bono_matrimonio", poblacion: "rg", modo: "promedio_6_meses" },
  { tipoEvento: "bono_matrimonio", poblacion: "rp", modo: "promedio_6_meses" },
  {
    tipoEvento: "bono_fallecimiento",
    poblacion: "rg",
    modo: "promedio_6_meses",
  },
  {
    tipoEvento: "bono_fallecimiento",
    poblacion: "rp",
    modo: "promedio_6_meses",
  },
  { tipoEvento: "bono_tijerales", poblacion: "rg", modo: "promedio_6_meses" },
];

/** Los (tipoEvento, población) que usan promedio de 6 meses — para que refresh.ts sepa para cuáles calcularlo, sin duplicar la lista del catálogo. */
export function eventosPromedio6Meses(): {
  tipoEvento: TipoEventoBeneficio;
  poblacion: Poblacion;
}[] {
  return CATALOGO.filter((c) => c.modo === "promedio_6_meses").map((c) => ({
    tipoEvento: c.tipoEvento,
    poblacion: c.poblacion,
  }));
}

export interface BeneficioLineItemCalculado {
  tipoEvento: TipoEventoBeneficio;
  poblacion: Poblacion;
  monto: number;
  esReal: boolean;
  metodoCalculo: string;
  pagaCon: PagaCon;
}

function claveEvento(tipoEvento: string, poblacion: string): string {
  return `${tipoEvento}::${poblacion}`;
}

/**
 * Con qué pago sale un `tipoEvento`, para clasificar filas ya guardadas en
 * `beneficios_line_items` (que no persiste `pagaCon` — se deriva del
 * catálogo, la misma fuente de verdad que usa `calcularBeneficiosDelMes`).
 * Usado por `refresh.ts` al leer el histórico real.
 */
export function pagaConDeEvento(
  tipoEvento: TipoEventoBeneficio,
  poblacion: Poblacion,
): PagaCon {
  const cfg = CATALOGO.find(
    (c) => c.tipoEvento === tipoEvento && c.poblacion === poblacion,
  );
  return cfg?.pagaCon ?? "remuneracion";
}

/**
 * Resuelve cada evento del catálogo para un mes dado y los agrega por
 * población (rg/rp). `realPorEvento` y `promedio6mPorEvento` los calcula
 * el caller (refresh.ts) consultando `beneficios_line_items` — esta
 * función es pura, sin acceso a base de datos, para poder testear cada
 * regla de negocio sin mockear Supabase.
 */
export function calcularBeneficiosDelMes(params: {
  mes: Date;
  dotacionRg: number;
  dotacionRp: number;
  /** Valor real ya cargado en `beneficios_line_items` para (tipoEvento, población) — ausente si no hay fila real ese mes. */
  realPorEvento: Map<string, number>;
  /** Promedio de los últimos 6 meses reales para (tipoEvento, población) — solo relevante para eventos modo="promedio_6_meses". */
  promedio6mPorEvento: Map<string, number>;
}): {
  lineItems: BeneficioLineItemCalculado[];
  /** Beneficios pagados CON LA REMUNERACIÓN (aporte sindical, gift cards, bonos de promedio) — se suman dentro de `remuneracion`/`remuneracion_rg`/`remuneracion_rp` (ver engine.ts). */
  rg: CashFlowConceptoCalculado;
  rp: CashFlowConceptoCalculado;
  /** Aguinaldos, pagados CON EL ANTICIPO (ver `pagaCon` arriba) — se suman dentro de `anticipo`/`anticipo_rg`/`anticipo_rp`. */
  anticipoRg: CashFlowConceptoCalculado;
  anticipoRp: CashFlowConceptoCalculado;
} {
  const { mes, dotacionRg, dotacionRp, realPorEvento, promedio6mPorEvento } =
    params;

  const lineItems: BeneficioLineItemCalculado[] = CATALOGO.map((cfg) => {
    const pagaCon = cfg.pagaCon ?? "remuneracion";
    const clave = claveEvento(cfg.tipoEvento, cfg.poblacion);
    const real = realPorEvento.get(clave);
    if (real != null) {
      return {
        tipoEvento: cfg.tipoEvento,
        poblacion: cfg.poblacion,
        monto: real,
        esReal: true,
        metodoCalculo: "ingesta_real",
        pagaCon,
      };
    }

    if (cfg.modo === "fecha_fija" && cfg.montoFormula) {
      const monto = cfg.montoFormula(mes, dotacionRg, dotacionRp);
      return {
        tipoEvento: cfg.tipoEvento,
        poblacion: cfg.poblacion,
        monto,
        esReal: false,
        metodoCalculo:
          monto > 0 ? "formula_fecha_fija" : "fuera_de_fecha_o_vigencia",
        pagaCon,
      };
    }

    if (cfg.modo === "promedio_6_meses") {
      const promedio = promedio6mPorEvento.get(clave) ?? 0;
      return {
        tipoEvento: cfg.tipoEvento,
        poblacion: cfg.poblacion,
        monto: promedio,
        esReal: false,
        metodoCalculo:
          promedio > 0
            ? "promedio_ultimos_6_meses_reales"
            : "pendiente_datos_historicos",
        pagaCon,
      };
    }

    // "siempre_manual" y "una_vez": sin real cargado, quedan en 0 —
    // nunca se inventa un monto (mismo criterio que Aporte SENCE).
    return {
      tipoEvento: cfg.tipoEvento,
      poblacion: cfg.poblacion,
      monto: 0,
      esReal: false,
      metodoCalculo: "pendiente_ingreso_manual",
      pagaCon,
    };
  });

  function agregar(
    poblacion: Poblacion,
    pagaCon: PagaCon,
  ): CashFlowConceptoCalculado {
    const items = lineItems.filter(
      (li) => li.poblacion === poblacion && li.pagaCon === pagaCon,
    );
    return {
      monto: items.reduce((acc, li) => acc + li.monto, 0),
      // Mismo criterio ya usado en refresh.ts para `total_nomina`: "real"
      // a nivel agregado significa que HAY al menos un componente real
      // confirmado ese mes, no que todos los tipos de evento lo sean —
      // el detalle exacto vive en `beneficios_line_items`.
      esReal: items.some((li) => li.esReal),
      metodoCalculo: "agregado_line_items",
    };
  }

  return {
    lineItems,
    rg: agregar("rg", "remuneracion"),
    rp: agregar("rp", "remuneracion"),
    anticipoRg: agregar("rg", "anticipo"),
    anticipoRp: agregar("rp", "anticipo"),
  };
}
