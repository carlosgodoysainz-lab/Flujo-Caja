import { describe, expect, it } from "vitest";
import { calcularBeneficiosDelMes, eventosPromedio6Meses } from "./beneficios";

const SIN_REALES = new Map<string, number>();
const SIN_PROMEDIOS = new Map<string, number>();

describe("calcularBeneficiosDelMes", () => {
  it("aguinaldo Fiestas Patrias: $50.000×RG + $150.000×RP, solo en septiembre", () => {
    const septiembre = new Date(2026, 8, 1);
    const result = calcularBeneficiosDelMes({
      mes: septiembre,
      dotacionRg: 60,
      dotacionRp: 40,
      realPorEvento: SIN_REALES,
      promedio6mPorEvento: SIN_PROMEDIOS,
    });

    const rgItem = result.lineItems.find(
      (li) =>
        li.tipoEvento === "aguinaldo_fiestas_patrias" && li.poblacion === "rg",
    );
    const rpItem = result.lineItems.find(
      (li) =>
        li.tipoEvento === "aguinaldo_fiestas_patrias" && li.poblacion === "rp",
    );
    expect(rgItem?.monto).toBe(50_000 * 60);
    expect(rpItem?.monto).toBe(150_000 * 40);
    expect(rgItem?.esReal).toBe(false);
    expect(rgItem?.metodoCalculo).toBe("formula_fecha_fija");
  });

  it("aguinaldo Fiestas Patrias: $0 fuera de septiembre", () => {
    const mayo = new Date(2026, 4, 1);
    const result = calcularBeneficiosDelMes({
      mes: mayo,
      dotacionRg: 60,
      dotacionRp: 40,
      realPorEvento: SIN_REALES,
      promedio6mPorEvento: SIN_PROMEDIOS,
    });

    const rgItem = result.lineItems.find(
      (li) =>
        li.tipoEvento === "aguinaldo_fiestas_patrias" && li.poblacion === "rg",
    );
    expect(rgItem?.monto).toBe(0);
    expect(rgItem?.metodoCalculo).toBe("fuera_de_fecha_o_vigencia");
  });

  it("aguinaldo RG deja de aplicar fuera de la vigencia del convenio (después de ago-2028), pero RP sigue", () => {
    const septiembre2029 = new Date(2029, 8, 1);
    const result = calcularBeneficiosDelMes({
      mes: septiembre2029,
      dotacionRg: 60,
      dotacionRp: 40,
      realPorEvento: SIN_REALES,
      promedio6mPorEvento: SIN_PROMEDIOS,
    });

    const rgItem = result.lineItems.find(
      (li) =>
        li.tipoEvento === "aguinaldo_fiestas_patrias" && li.poblacion === "rg",
    );
    const rpItem = result.lineItems.find(
      (li) =>
        li.tipoEvento === "aguinaldo_fiestas_patrias" && li.poblacion === "rp",
    );
    expect(rgItem?.monto).toBe(0);
    expect(rpItem?.monto).toBe(150_000 * 40);
  });

  it("aporte sindical mensual: $500.000 fijo dentro de la vigencia, $0 fuera", () => {
    const dentro = calcularBeneficiosDelMes({
      mes: new Date(2027, 0, 1),
      dotacionRg: 60,
      dotacionRp: 40,
      realPorEvento: SIN_REALES,
      promedio6mPorEvento: SIN_PROMEDIOS,
    });
    const fuera = calcularBeneficiosDelMes({
      mes: new Date(2029, 0, 1),
      dotacionRg: 60,
      dotacionRp: 40,
      realPorEvento: SIN_REALES,
      promedio6mPorEvento: SIN_PROMEDIOS,
    });

    const itemDentro = dentro.lineItems.find(
      (li) => li.tipoEvento === "aporte_sindical_mensual",
    );
    const itemFuera = fuera.lineItems.find(
      (li) => li.tipoEvento === "aporte_sindical_mensual",
    );
    expect(itemDentro?.monto).toBe(500_000);
    expect(itemFuera?.monto).toBe(0);
  });

  it("gift card higiene/seguridad: tramo por dotación RG (2/3/5 × $20.000)", () => {
    const tramoBajo = calcularBeneficiosDelMes({
      mes: new Date(2026, 9, 1),
      dotacionRg: 30,
      dotacionRp: 0,
      realPorEvento: SIN_REALES,
      promedio6mPorEvento: SIN_PROMEDIOS,
    }).lineItems.find((li) => li.tipoEvento === "gift_card_higiene_seguridad");
    const tramoMedio = calcularBeneficiosDelMes({
      mes: new Date(2026, 9, 1),
      dotacionRg: 75,
      dotacionRp: 0,
      realPorEvento: SIN_REALES,
      promedio6mPorEvento: SIN_PROMEDIOS,
    }).lineItems.find((li) => li.tipoEvento === "gift_card_higiene_seguridad");
    const tramoAlto = calcularBeneficiosDelMes({
      mes: new Date(2026, 9, 1),
      dotacionRg: 150,
      dotacionRp: 0,
      realPorEvento: SIN_REALES,
      promedio6mPorEvento: SIN_PROMEDIOS,
    }).lineItems.find((li) => li.tipoEvento === "gift_card_higiene_seguridad");

    expect(tramoBajo?.monto).toBe(2 * 20_000);
    expect(tramoMedio?.monto).toBe(3 * 20_000);
    expect(tramoAlto?.monto).toBe(5 * 20_000);
  });

  it("bono término de negociación y aporte sindical único quedan en 0 sin dato real (nunca se inventan)", () => {
    const result = calcularBeneficiosDelMes({
      mes: new Date(2026, 7, 1),
      dotacionRg: 56,
      dotacionRp: 0,
      realPorEvento: SIN_REALES,
      promedio6mPorEvento: SIN_PROMEDIOS,
    });
    const bonoTermino = result.lineItems.find(
      (li) => li.tipoEvento === "bono_termino_negociacion",
    );
    const aporteUnico = result.lineItems.find(
      (li) => li.tipoEvento === "aporte_sindical_unico",
    );
    expect(bonoTermino?.monto).toBe(0);
    expect(bonoTermino?.metodoCalculo).toBe("pendiente_ingreso_manual");
    expect(aporteUnico?.monto).toBe(0);
  });

  it("real ingresado tiene prioridad sobre la fórmula fecha-fija", () => {
    const realPorEvento = new Map([
      ["bono_termino_negociacion::rg", 10_360_000],
    ]);
    const result = calcularBeneficiosDelMes({
      mes: new Date(2026, 7, 1),
      dotacionRg: 56,
      dotacionRp: 0,
      realPorEvento,
      promedio6mPorEvento: SIN_PROMEDIOS,
    });
    const item = result.lineItems.find(
      (li) => li.tipoEvento === "bono_termino_negociacion",
    );
    expect(item?.monto).toBe(10_360_000);
    expect(item?.esReal).toBe(true);
    expect(item?.metodoCalculo).toBe("ingesta_real");
  });

  it("eventos sin fecha fija (ej. bono natalidad) quedan en $0 sin 6 meses de historial", () => {
    const result = calcularBeneficiosDelMes({
      mes: new Date(2026, 7, 1),
      dotacionRg: 56,
      dotacionRp: 40,
      realPorEvento: SIN_REALES,
      promedio6mPorEvento: SIN_PROMEDIOS,
    });
    const item = result.lineItems.find(
      (li) => li.tipoEvento === "bono_natalidad" && li.poblacion === "rg",
    );
    expect(item?.monto).toBe(0);
    expect(item?.metodoCalculo).toBe("pendiente_datos_historicos");
  });

  it("eventos sin fecha fija usan el promedio de los últimos 6 meses reales una vez que existen", () => {
    const promedio6mPorEvento = new Map([["bono_natalidad::rg", 100_000]]);
    const result = calcularBeneficiosDelMes({
      mes: new Date(2026, 7, 1),
      dotacionRg: 56,
      dotacionRp: 40,
      realPorEvento: SIN_REALES,
      promedio6mPorEvento,
    });
    const item = result.lineItems.find(
      (li) => li.tipoEvento === "bono_natalidad" && li.poblacion === "rg",
    );
    expect(item?.monto).toBe(100_000);
    expect(item?.metodoCalculo).toBe("promedio_ultimos_6_meses_reales");
  });

  it("asignación escolar siempre es manual — 0 sin dato real, sin importar el mes", () => {
    const result = calcularBeneficiosDelMes({
      mes: new Date(2026, 2, 1), // marzo
      dotacionRg: 56,
      dotacionRp: 0,
      realPorEvento: SIN_REALES,
      promedio6mPorEvento: SIN_PROMEDIOS,
    });
    const item = result.lineItems.find(
      (li) => li.tipoEvento === "asignacion_escolar",
    );
    expect(item?.monto).toBe(0);
    expect(item?.metodoCalculo).toBe("pendiente_ingreso_manual");
  });

  it("agrega correctamente por población: rg y rp (pagados con remuneración) suman independiente del aguinaldo (pagado con anticipo)", () => {
    const septiembre = new Date(2026, 8, 1);
    const result = calcularBeneficiosDelMes({
      mes: septiembre,
      dotacionRg: 60,
      dotacionRp: 40,
      realPorEvento: SIN_REALES,
      promedio6mPorEvento: SIN_PROMEDIOS,
    });

    // RG pagado con REMUNERACIÓN en septiembre: aporte sindical mensual
    // (500.000) + gift card (dotacionRg=60 está en tramo medio → 3×20.000)
    // — el aguinaldo (50.000×60) se paga con el Anticipo, no acá.
    const esperadoRg = 500_000 + 3 * 20_000;
    expect(result.rg.monto).toBe(esperadoRg);
    expect(result.rp.monto).toBe(0);
    // El aguinaldo va en anticipoRg/anticipoRp.
    expect(result.anticipoRg.monto).toBe(50_000 * 60);
    expect(result.anticipoRp.monto).toBe(150_000 * 40);
  });

  it("pagaConDeEvento clasifica los aguinaldos como anticipo y el resto como remuneración", async () => {
    const { pagaConDeEvento } = await import("./beneficios");
    expect(pagaConDeEvento("aguinaldo_fiestas_patrias", "rg")).toBe("anticipo");
    expect(pagaConDeEvento("aguinaldo_navidad", "rp")).toBe("anticipo");
    expect(pagaConDeEvento("aporte_sindical_mensual", "rg")).toBe(
      "remuneracion",
    );
    expect(pagaConDeEvento("bono_natalidad", "rp")).toBe("remuneracion");
  });

  it("el agregado por población es 'real' si al menos un componente es real", () => {
    const realPorEvento = new Map([
      ["bono_termino_negociacion::rg", 10_360_000],
    ]);
    const result = calcularBeneficiosDelMes({
      mes: new Date(2026, 4, 1), // mayo, sin aguinaldo/aporte formula
      dotacionRg: 56,
      dotacionRp: 0,
      realPorEvento,
      promedio6mPorEvento: SIN_PROMEDIOS,
    });
    expect(result.rg.esReal).toBe(true);
    expect(result.rp.esReal).toBe(false);
  });

  it("eventosPromedio6Meses expone la lista completa usada por refresh.ts", () => {
    const eventos = eventosPromedio6Meses();
    expect(eventos.length).toBeGreaterThan(0);
    expect(
      eventos.some(
        (e) => e.tipoEvento === "bono_natalidad" && e.poblacion === "rg",
      ),
    ).toBe(true);
  });
});
