import { describe, expect, it } from "vitest";
import {
  anclarCurvaANivelReal,
  aplicarArranqueDeObra,
  aplicarCicloDeVida,
  aplicarCierreDeObra,
  aVariacionNeta,
  combinarRealConModelo,
  curvaPorAvance,
  curvaPorAvanceConFases,
  escalarCurva,
  fechaLocalDesdeString,
  interpolarHuecos,
  mesDeCierre,
  promediarCurvas,
  suavizarDesdeIndice,
  suavizarSaltos,
  type PuntoCurva,
} from "./curve";

describe("fechaLocalDesdeString", () => {
  it("una fecha día 01 no corre de mes (regresión: new Date(str) directo sí corría en timezones detrás de UTC)", () => {
    const fecha = fechaLocalDesdeString("2026-04-01");
    expect(fecha.getFullYear()).toBe(2026);
    expect(fecha.getMonth()).toBe(3); // abril, 0-indexado
    expect(fecha.getDate()).toBe(1);
  });

  it("funciona igual con cualquier día del mes", () => {
    const fecha = fechaLocalDesdeString("2026-12-22");
    expect(fecha.getFullYear()).toBe(2026);
    expect(fecha.getMonth()).toBe(11); // diciembre
    expect(fecha.getDate()).toBe(22);
  });

  it("ignora la parte de hora si el string la trae", () => {
    const fecha = fechaLocalDesdeString("2026-04-01T00:00:00.000Z");
    expect(fecha.getFullYear()).toBe(2026);
    expect(fecha.getMonth()).toBe(3);
    expect(fecha.getDate()).toBe(1);
  });
});

describe("curvaPorAvance", () => {
  it("indexa por mes de avance desde el inicio de obra, no por fecha calendario", () => {
    const inicioObra = new Date(2024, 0, 1); // enero 2024
    const snapshots = [
      { fecha: new Date(2024, 0, 15), activos: 10 }, // mes 0
      { fecha: new Date(2024, 2, 1), activos: 30 }, // mes 2
    ];
    const curva = curvaPorAvance(snapshots, inicioObra, 6);
    expect(curva).toEqual([10, null, 30, null, null, null]);
  });

  it("ignora snapshots fuera del rango de duración de la obra", () => {
    const inicioObra = new Date(2024, 0, 1);
    const snapshots = [
      { fecha: new Date(2023, 5, 1), activos: 5 }, // antes del inicio -> ignorado
      { fecha: new Date(2026, 0, 1), activos: 5 }, // muy después de la duración -> ignorado
    ];
    const curva = curvaPorAvance(snapshots, inicioObra, 6);
    expect(curva.every((v) => v === null)).toBe(true);
  });

  it("con 2+ snapshots en el mismo mes de avance, se queda con el de fecha MÁS RECIENTE (bug real corregido 25-ago-2026, caso 'Lira Parque': quedaba con 104 en vez del 113 más reciente, sin importar el orden de entrada del array)", () => {
    const inicioObra = new Date(2024, 0, 1);
    const snapshots = [
      { fecha: new Date(2024, 1, 20), activos: 113 }, // más reciente, viene PRIMERO en el array
      { fecha: new Date(2024, 1, 5), activos: 104 }, // más viejo, viene DESPUÉS
    ];
    const curva = curvaPorAvance(snapshots, inicioObra, 3);
    expect(curva).toEqual([null, 113, null]);
  });
});

describe("curvaPorAvanceConFases", () => {
  // Snapshots sintéticos: 22 meses de obra de referencia, valor = mes*10
  // (mes 0 -> 0, mes 1 -> 10, ..., mes 21 -> 210) para poder verificar
  // exactamente a qué mes del objetivo cae cada mes de referencia.
  const inicioObraRef = new Date(2024, 0, 1);
  const snapshots22Meses = Array.from({ length: 22 }, (_, mes) => ({
    fecha: new Date(2024, mes, 1),
    activos: mes * 10,
  }));

  it("con misma duración ref y objetivo, es idéntico a curvaPorAvance (identidad)", () => {
    const conFases = curvaPorAvanceConFases(
      snapshots22Meses,
      inicioObraRef,
      22,
      22,
    );
    const sinFases = curvaPorAvance(snapshots22Meses, inicioObraRef, 22);
    expect(conFases).toEqual(sinFases);
  });

  it("alinea el INICIO de la fase terminaciones de la referencia con el inicio de la fase terminaciones del objetivo, aunque las duraciones difieran", () => {
    // Objetivo de 12 meses: mitad = mes 6 (ceil(12/2)) es el primer mes de
    // terminaciones. En la referencia (22 meses), el primer mes de
    // terminaciones es el mes 11 (ceil(22/2)), con valor 110.
    const curva = curvaPorAvanceConFases(
      snapshots22Meses,
      inicioObraRef,
      22,
      12,
    );
    expect(curva[0]).toBe(0); // primer mes de obra gruesa de ambas, sin reescalar
    expect(curva[6]).toBe(110); // primer mes de terminaciones -> primer mes de terminaciones
    // Los últimos 2 meses de la referencia (20 y 21, valores 200 y 210)
    // también colapsan en el último mes del objetivo por la compresión de
    // fase — se promedian, igual que el caso del mes 5 (ver test siguiente).
    expect(curva[11]).toBe(205);
  });

  it("si la compresión de fases hace caer 2 meses de referencia en el mismo mes objetivo, los promedia en vez de pisar el primero", () => {
    const curva = curvaPorAvanceConFases(
      snapshots22Meses,
      inicioObraRef,
      22,
      12,
    );
    // mes 9 (valor 90) y mes 10 (valor 100) de la referencia caen ambos en
    // el índice 5 del objetivo tras la compresión de la fase terminaciones.
    expect(curva[5]).toBe(95);
  });

  it("sin duración de referencia (0), no divide por cero — todo cae en el mes 0", () => {
    const curva = curvaPorAvanceConFases([], inicioObraRef, 0, 12);
    expect(curva.length).toBe(12);
    expect(curva.every((v) => v === null)).toBe(true);
  });
});

describe("escalarCurva", () => {
  it("escala proporcionalmente por la razón de unidades", () => {
    const curva = [10, 20, 30];
    // obra de referencia tenía 100 unidades, la objetivo tiene 200 -> el doble
    expect(escalarCurva(curva, 100, 200)).toEqual([20, 40, 60]);
  });

  it("preserva los null al escalar", () => {
    expect(escalarCurva([10, null, 30], 100, 50)).toEqual([5, null, 15]);
  });

  it("sin unidades de referencia, retorna la curva sin cambios (evita división por cero)", () => {
    expect(escalarCurva([10, 20], 0, 100)).toEqual([10, 20]);
  });
});

describe("promediarCurvas", () => {
  it("promedia mes a mes ignorando nulls, marca sinDatoReferencia=false cuando hay señal", () => {
    const curvas = [
      [10, 20, null],
      [30, null, 50],
    ];
    const resultado = promediarCurvas(curvas, 3);
    expect(resultado).toEqual([
      { valor: 20, sinDatoReferencia: false },
      { valor: 20, sinDatoReferencia: false },
      { valor: 50, sinDatoReferencia: false },
    ]);
  });

  it("mes sin ninguna señal da valor=0 Y sinDatoReferencia=true (no confundir con 0 confirmado)", () => {
    const curvas = [
      [null, 10],
      [null, 20],
    ];
    const resultado = promediarCurvas(curvas, 2);
    expect(resultado[0]).toEqual({ valor: 0, sinDatoReferencia: true });
    expect(resultado[1]).toEqual({ valor: 15, sinDatoReferencia: false });
  });

  it("sin curvas de referencia, todo el resultado es sin dato", () => {
    expect(promediarCurvas([], 3)).toEqual([
      { valor: 0, sinDatoReferencia: true },
      { valor: 0, sinDatoReferencia: true },
      { valor: 0, sinDatoReferencia: true },
    ]);
  });

  it("bug real corregido 18-ago-2026: mantiene el último valor conocido en los huecos sin dato, no vuelve a 0 — evita el salto artificial +X seguido de -X que veía el usuario en Plan de Obra", () => {
    // Antes: un dato real (214) rodeado de meses sin ninguna obra de
    // referencia caía a 0 antes Y después — la variación resultante era
    // [0, 0, +214, -214], un salto fantasma sin sentido de negocio (nadie
    // contrata 214 personas y las despide al mes siguiente).
    const curvas = [[null, null, 214, null]];
    const resultado = promediarCurvas(curvas, 4);
    expect(resultado).toEqual([
      { valor: 0, sinDatoReferencia: true },
      { valor: 0, sinDatoReferencia: true },
      { valor: 214, sinDatoReferencia: false },
      { valor: 214, sinDatoReferencia: true },
    ]);
    const variaciones = aVariacionNeta(resultado).map((r) => r.variacion);
    expect(variaciones).toEqual([0, 0, 214, 0]);
  });
});

describe("aVariacionNeta", () => {
  const conDato = (valor: number) => ({ valor, sinDatoReferencia: false });
  const sinDato = (valor = 0) => ({ valor, sinDatoReferencia: true });

  it("el primer mes es su propio valor absoluto", () => {
    expect(
      aVariacionNeta([conDato(5), conDato(8), conDato(12)])[0].variacion,
    ).toBe(5);
  });

  it("los meses siguientes son la diferencia con el mes anterior", () => {
    const resultado = aVariacionNeta([conDato(5), conDato(8), conDato(12)]);
    expect(resultado.map((r) => r.variacion)).toEqual([5, 3, 4]);
    expect(resultado.every((r) => !r.sinDatoReferencia)).toBe(true);
  });

  it("una curva plana da variación 0 después del primer mes", () => {
    expect(
      aVariacionNeta([conDato(10), conDato(10), conDato(10)]).map(
        (r) => r.variacion,
      ),
    ).toEqual([10, 0, 0]);
  });

  it("una curva decreciente da variaciones negativas", () => {
    expect(
      aVariacionNeta([conDato(20), conDato(15), conDato(10)]).map(
        (r) => r.variacion,
      ),
    ).toEqual([20, -5, -5]);
  });

  it("un delta hereda sinDatoReferencia=true si CUALQUIERA de sus 2 puntos no tenía dato real", () => {
    const resultado = aVariacionNeta([conDato(10), sinDato(0), conDato(15)]);
    expect(resultado[0].sinDatoReferencia).toBe(false);
    expect(resultado[1].sinDatoReferencia).toBe(true); // depende de mes 0 (con dato) y mes 1 (sin dato)
    expect(resultado[2].sinDatoReferencia).toBe(true); // depende de mes 1 (sin dato) y mes 2 (con dato)
  });
});

// --- Fix "ciclo de vida" (24-ago-2026): fin_obra real, suavizado de
// saltos, arranque sin bajas, cierre progresivo. Ver Auto-Blindaje.

describe("mesDeCierre", () => {
  const inicio = new Date(2025, 0, 1); // 2025-01-01

  it("con finObra real, es la diferencia en meses entre inicio y fin (Jorge Edwards: 2025-01 -> 2026-12, dur 24)", () => {
    expect(mesDeCierre(inicio, new Date(2026, 11, 22), 24)).toBe(23);
  });

  it("sin finObra, cae al comportamiento anterior (durObraMeses - 1)", () => {
    expect(mesDeCierre(inicio, null, 24)).toBe(23);
  });

  it("finObra más temprano que dur - 1 adelanta el cierre dentro del horizonte", () => {
    expect(mesDeCierre(inicio, new Date(2026, 5, 30), 24)).toBe(17);
  });

  it("finObra más allá del horizonte NUNCA lo extiende (clamp a dur - 1)", () => {
    expect(mesDeCierre(inicio, new Date(2028, 0, 1), 24)).toBe(23);
  });

  it("finObra anterior a inicioObra da 0, nunca negativo", () => {
    expect(mesDeCierre(inicio, new Date(2024, 0, 1), 24)).toBe(0);
  });
});

describe("curvaPorAvanceConFases con opciones de cierre", () => {
  const inicioObraRef = new Date(2024, 0, 1);
  const snapshots22Meses = Array.from({ length: 22 }, (_, mes) => ({
    fecha: new Date(2024, mes, 1),
    activos: mes * 10,
  }));

  it("sin opciones, es idéntica a la llamada con mesCierre = dur - 1 explícito (identidad)", () => {
    const sinOpciones = curvaPorAvanceConFases(
      snapshots22Meses,
      inicioObraRef,
      22,
      12,
    );
    const conOpcionesDefault = curvaPorAvanceConFases(
      snapshots22Meses,
      inicioObraRef,
      22,
      12,
      { mesCierreRef: 21, mesCierreObjetivo: 11 },
    );
    expect(conOpcionesDefault).toEqual(sinOpciones);
  });

  it("un cierre adelantado en la referencia mueve el inicio de terminaciones antes", () => {
    // mesCierreRef=15 (en vez de 21) -> mitadRef = ceil(16/2) = 8.
    // mesCierreObjetivo=11 (default) -> mitadObjetivo = ceil(12/2) = 6.
    const curva = curvaPorAvanceConFases(
      snapshots22Meses,
      inicioObraRef,
      22,
      12,
      { mesCierreRef: 15, mesCierreObjetivo: 11 },
    );
    expect(curva[6]).toBe(80); // antes (sin fin_obra) el índice 6 daba 110
    // Los meses de la referencia posteriores a su propio cierre (16-21)
    // se descartan porque el objetivo (default) no tiene zona post-cierre.
    expect(curva.length).toBe(12);
  });

  it("mesCierre = 0 no divide por cero y da largo correcto", () => {
    const curva = curvaPorAvanceConFases(
      snapshots22Meses,
      inicioObraRef,
      22,
      12,
      {
        mesCierreRef: 0,
        mesCierreObjetivo: 0,
      },
    );
    expect(curva.length).toBe(12);
  });
});

describe("interpolarHuecos", () => {
  it("interpola linealmente un hueco interno (dato real a ambos lados)", () => {
    expect(interpolarHuecos([10, null, null, 40])).toEqual([10, 20, 30, 40]);
  });

  it("no extrapola huecos de cabeza ni de cola", () => {
    expect(interpolarHuecos([null, null, 20, null])).toEqual([
      null,
      null,
      20,
      null,
    ]);
  });

  it("curva sin huecos o vacía queda sin cambios", () => {
    expect(interpolarHuecos([10, 20, 30])).toEqual([10, 20, 30]);
    expect(interpolarHuecos([])).toEqual([]);
    expect(interpolarHuecos([null, null])).toEqual([null, null]);
  });

  it("redondea el valor interpolado", () => {
    expect(interpolarHuecos([10, null, 15])).toEqual([10, 13, 15]);
  });

  it("un hueco más largo que maxHuecoMeses queda sin interpolar", () => {
    const curva = [10, ...Array(8).fill(null), 90];
    expect(interpolarHuecos(curva, 6)).toEqual(curva);
  });
});

describe("suavizarSaltos", () => {
  const conDato = (valor: number): PuntoCurva => ({
    valor,
    sinDatoReferencia: false,
  });

  it("caso real 'Vista Llacolén B': acota el salto -99/+90 a deltas de máximo ±30", () => {
    const curva = [conDato(100), conDato(1), conDato(91)];
    const resultado = suavizarSaltos(curva, 30);
    expect(resultado.map((p) => p.valor)).toEqual([100, 70, 91]);
    expect(aVariacionNeta(resultado).map((r) => r.variacion)).toEqual([
      100, -30, 21,
    ]);
  });

  it("reconverge al valor objetivo en vez de quedar clipeado para siempre", () => {
    const curva = [0, 100, 100, 100, 100].map(conDato);
    const resultado = suavizarSaltos(curva, 30);
    expect(resultado.map((p) => p.valor)).toEqual([0, 30, 60, 90, 100]);
  });

  it("cap 0 o negativo deja la curva intacta", () => {
    const curva = [conDato(100), conDato(1)];
    expect(suavizarSaltos(curva, 0)).toBe(curva);
    expect(suavizarSaltos(curva, -5)).toBe(curva);
  });

  it("preserva sinDatoReferencia de cada mes sin tocarlo", () => {
    const curva: PuntoCurva[] = [
      conDato(10),
      { valor: 200, sinDatoReferencia: true },
    ];
    const resultado = suavizarSaltos(curva, 5);
    expect(resultado[1].sinDatoReferencia).toBe(true);
  });

  it("el mes 0 nunca se modifica", () => {
    const curva = [conDato(999), conDato(0)];
    expect(suavizarSaltos(curva, 1)[0].valor).toBe(999);
  });
});

describe("suavizarDesdeIndice", () => {
  const conDato = (valor: number): PuntoCurva => ({
    valor,
    sinDatoReferencia: false,
  });

  it("toma curva[indice] como punto de partida FIJO (no le aplica el cap a él mismo) y acota los saltos posteriores", () => {
    const curva = [conDato(10), conDato(167), conDato(56), conDato(50)];
    const resultado = suavizarDesdeIndice(curva, 1, 32);
    // El índice del ancla (1) queda intacto.
    expect(resultado[1].valor).toBe(167);
    // Antes del índice, tampoco se toca.
    expect(resultado[0].valor).toBe(10);
    // Después, cada paso queda acotado por el cap, encadenado desde 167.
    expect(resultado[2].valor).toBe(135); // 167 - 32
    expect(resultado[3].valor).toBe(103); // 135 - 32 (objetivo 50 sigue muy por debajo)
  });

  it("índice fuera de rango o cap <= 0 deja la curva intacta", () => {
    const curva = [conDato(10), conDato(20)];
    expect(suavizarDesdeIndice(curva, 5, 10)).toBe(curva);
    expect(suavizarDesdeIndice(curva, 0, 0)).toBe(curva);
  });

  it("último índice no cambia nada (no hay meses posteriores que suavizar)", () => {
    const curva = [conDato(10), conDato(20)];
    expect(suavizarDesdeIndice(curva, 1, 5).map((p) => p.valor)).toEqual([
      10, 20,
    ]);
  });
});

describe("aplicarCicloDeVida — re-suavizado tras el ancla (v7)", () => {
  const conDato = (valor: number): PuntoCurva => ({
    valor,
    sinDatoReferencia: false,
  });

  it("caso real 'Vista Llacolén B'/'Lira Parque' (21-sep-2026): sin el re-suavizado, el mes siguiente al ancla real quedaba con un salto que excedía por mucho maxDeltaPorMes — ahora queda acotado", () => {
    const curva = [
      conDato(100),
      conDato(115),
      conDato(56),
      conDato(50),
      conDato(48),
    ];
    const maxDeltaPorMes = 32;
    const resultado = aplicarCicloDeVida(curva, {
      mesCierre: 4,
      finFaseObraGruesa: 1,
      maxDeltaPorMes,
      anclaReal: { indice: 1, nivel: 167 }, // nivel real muy por encima de lo modelado hasta ahí
    });
    // El ancla en sí sigue siendo exacta.
    expect(resultado[1].valor).toBe(167);
    // Ningún paso posterior al ancla excede el cap — antes de este fix,
    // el índice 2 hubiese quedado en 56 (salto de -111 contra el ancla).
    for (let i = 2; i < resultado.length; i++) {
      expect(
        Math.abs(resultado[i].valor - resultado[i - 1].valor),
      ).toBeLessThanOrEqual(maxDeltaPorMes);
    }
  });

  it("sin anclaReal, el comportamiento es idéntico a antes (no re-suaviza nada)", () => {
    const curva = [conDato(10), conDato(20), conDato(90)];
    const conAncla = aplicarCicloDeVida(curva, {
      mesCierre: 2,
      finFaseObraGruesa: 0,
      maxDeltaPorMes: 30,
    });
    const sinLlamarAncla = aplicarCierreDeObra(
      suavizarSaltos(aplicarArranqueDeObra(curva, 0), 30),
      2,
    );
    expect(conAncla).toEqual(sinLlamarAncla);
  });
});

describe("aplicarArranqueDeObra", () => {
  const conDato = (valor: number): PuntoCurva => ({
    valor,
    sinDatoReferencia: false,
  });
  const sinDato = (valor = 0): PuntoCurva => ({
    valor,
    sinDatoReferencia: true,
  });

  it("caso real 'General Mackenna': ninguna variación negativa antes del pico de obra gruesa", () => {
    const curva = [40, 30, 55, 80, 70, 60].map(conDato);
    const resultado = aplicarArranqueDeObra(curva, 3);
    expect(resultado.map((p) => p.valor)).toEqual([40, 40, 55, 80, 70, 60]);
    const variaciones = aVariacionNeta(resultado).map((r) => r.variacion);
    expect(variaciones.slice(0, 3).every((v) => v >= 0)).toBe(true);
  });

  it("rellena los meses de arranque sin dato con una rampa hacia el primer valor real", () => {
    const curva = [sinDato(), sinDato(), conDato(60), conDato(80)];
    const resultado = aplicarArranqueDeObra(curva, 2);
    expect(resultado.map((p) => p.valor)).toEqual([20, 40, 60, 80]);
    expect(resultado[0].sinDatoReferencia).toBe(false);
    expect(resultado[1].sinDatoReferencia).toBe(false);
  });

  it("sin ningún dato real, devuelve la curva intacta (respeta sin_dato_referencia)", () => {
    const curva = [sinDato(), sinDato(), sinDato()];
    expect(aplicarArranqueDeObra(curva, 2)).toEqual(curva);
  });

  it("si el pico ya pasó dentro de la ventana de obra gruesa, igual protege contra caer por debajo del pico mientras siga en esa fase (fix 25-ago-2026: antes esto quedaba sin protección y causaba el 'diente de sierra' de Serrano A)", () => {
    const curva = [80, 60, 50].map(conDato);
    // finFaseObraGruesa=2 -> el índice 1 sigue dentro de la fase de obra
    // gruesa (se pisa a 80, el pico); el índice 2 ya queda FUERA de la
    // ventana protegida y conserva su valor real (50).
    expect(aplicarArranqueDeObra(curva, 2).map((p) => p.valor)).toEqual([
      80, 80, 50,
    ]);
  });

  it("una vez que la fase de obra gruesa termina, los meses posteriores quedan intactos (la protección del pico no se extiende a terminaciones)", () => {
    const curva = [40, 90, 70, 30, 10].map(conDato);
    // finFaseObraGruesa=3 -> pico en índice 1 (90). Índice 2 sigue en la
    // fase (se pisa a 90); índices 3 y 4 ya están en terminaciones, se
    // dejan caer libremente.
    expect(aplicarArranqueDeObra(curva, 3).map((p) => p.valor)).toEqual([
      40, 90, 90, 30, 10,
    ]);
  });
});

describe("aplicarCierreDeObra", () => {
  const conDato = (valor: number): PuntoCurva => ({
    valor,
    sinDatoReferencia: false,
  });
  const sinDato = (valor = 0): PuntoCurva => ({
    valor,
    sinDatoReferencia: true,
  });

  it("caso real 'Jorge Edwards': bajas progresivas hacia el cierre, no ceros sostenidos", () => {
    const curva = [
      conDato(30),
      conDato(60),
      conDato(90),
      conDato(90),
      sinDato(90),
      sinDato(90),
      sinDato(90),
      sinDato(90),
    ];
    const resultado = aplicarCierreDeObra(curva, 7);
    expect(resultado.map((p) => p.valor)).toEqual([
      30, 60, 90, 90, 72, 54, 36, 18,
    ]);
    expect(aVariacionNeta(resultado).map((r) => r.variacion)).toEqual([
      30, 30, 30, 0, -18, -18, -18, -18,
    ]);
  });

  it("cierre antes del final del horizonte: los meses posteriores quedan en 0 duro", () => {
    const curva = [
      conDato(20),
      conDato(40),
      sinDato(40),
      sinDato(40),
      sinDato(40),
      sinDato(40),
    ];
    const resultado = aplicarCierreDeObra(curva, 3);
    expect(resultado.map((p) => p.valor)).toEqual([20, 40, 27, 13, 0, 0]);
  });

  it("nunca pisa un mes que ya tiene su propio dato real", () => {
    const curva = [conDato(10), conDato(20), conDato(15)];
    expect(aplicarCierreDeObra(curva, 1)).toEqual(curva);
  });

  it("sin ningún dato real, devuelve la curva intacta", () => {
    const curva = [sinDato(), sinDato(), sinDato()];
    expect(aplicarCierreDeObra(curva, 2)).toEqual(curva);
  });
});

describe("aplicarCicloDeVida", () => {
  it("integra arranque + suavizado + cierre: sin bajas antes del pico, saltos acotados, cola decreciente hacia 0", () => {
    const conDato = (valor: number): PuntoCurva => ({
      valor,
      sinDatoReferencia: false,
    });
    const sinDato = (valor = 0): PuntoCurva => ({
      valor,
      sinDatoReferencia: true,
    });
    // Hueco de cabeza + salto abrupto en el medio + cola sin dato.
    const curva = [
      sinDato(),
      conDato(120),
      conDato(1),
      conDato(115),
      sinDato(115),
      sinDato(115),
    ];
    const resultado = aplicarCicloDeVida(curva, {
      mesCierre: 5,
      finFaseObraGruesa: 2,
      maxDeltaPorMes: 30,
    });
    const variaciones = aVariacionNeta(resultado).map((r) => r.variacion);
    // (a) sin bajas antes del pico de obra gruesa (índices 0..1)
    expect(variaciones.slice(0, 2).every((v) => v >= 0)).toBe(true);
    // (b) el salto abrupto del medio queda acotado por el suavizado
    expect(Math.abs(variaciones[2])).toBeLessThanOrEqual(30);
    // (c) la rampa de cierre (estrictamente DESPUÉS del último mes con
    // dato real, índice 3 en este caso) decrece hacia 0, nunca sube.
    expect(variaciones.slice(4).every((v) => v <= 0)).toBe(true);
    expect(resultado.at(-1)!.valor).toBeLessThan(resultado[3].valor);
  });

  it("caso real 'Jorge Edwards' (4ta vuelta, 25-ago-2026): con `anclaReal`, la rampa de cierre parte del nivel REAL de la obra objetivo, no del nivel de la curva de referencia", () => {
    const conDato = (valor: number): PuntoCurva => ({
      valor,
      sinDatoReferencia: false,
    });
    const sinDato = (valor = 0): PuntoCurva => ({
      valor,
      sinDatoReferencia: true,
    });
    // Curva de SIMILITUD (obra de referencia incipiente, "Lira Parque"):
    // solo 2 meses reales (59, 114) y el resto sostenido ("held") en 114
    // — sin ancla, `aplicarCierreDeObra` rampearía desde 114, muy por
    // debajo del nivel real de la obra objetivo (142).
    const curvaSimilitud = [
      conDato(59),
      conDato(114),
      sinDato(114),
      sinDato(114),
      sinDato(114),
      sinDato(114),
    ];
    const resultado = aplicarCicloDeVida(curvaSimilitud, {
      mesCierre: 5,
      finFaseObraGruesa: 2,
      anclaReal: { indice: 1, nivel: 142 }, // nivel real de la obra objetivo en el mes 1
    });
    // La rampa parte de 142 (el ancla real), no de 114.
    expect(resultado[1].valor).toBe(142);
    const variaciones = aVariacionNeta(resultado).map((r) => r.variacion);
    // Ninguna variación puede implicar restar más gente de la que había
    // el mes anterior (nunca "despide" más de lo que existe).
    for (let i = 1; i < resultado.length; i++) {
      expect(variaciones[i]).toBeGreaterThanOrEqual(-resultado[i - 1].valor);
    }
    // El último mes queda muy por debajo del ancla real (142), acercándose
    // a la fecha de cierre — no llega a exactamente 0 porque `mesCierre`
    // es el último índice de la curva (aplicarCierreDeObra solo fuerza 0
    // duro en índices ESTRICTAMENTE posteriores a `mesCierre`), pero la
    // magnitud es consistente con el nivel real (142), no con el de la
    // curva de referencia (114) — nunca queda plano en un valor ajeno.
    expect(resultado.at(-1)!.valor).toBeLessThan(50);
    expect(resultado.at(-1)!.valor).toBeGreaterThanOrEqual(0);
  });
});

describe("anclarCurvaANivelReal", () => {
  const punto = (valor: number, sinDatoReferencia = false): PuntoCurva => ({
    valor,
    sinDatoReferencia,
  });

  it("fija el punto en `indice` al nivel real dado, marcado como dato real", () => {
    const curva = [punto(10), punto(20, true), punto(30, true)];
    const resultado = anclarCurvaANivelReal(curva, 1, 142);
    expect(resultado).toEqual([punto(10), punto(142, false), punto(30, true)]);
  });

  it("índice fuera de rango devuelve la curva intacta", () => {
    const curva = [punto(10), punto(20)];
    expect(anclarCurvaANivelReal(curva, 5, 999)).toEqual(curva);
    expect(anclarCurvaANivelReal(curva, -1, 999)).toEqual(curva);
  });

  it("no muta la curva original", () => {
    const curva = [punto(10), punto(20)];
    anclarCurvaANivelReal(curva, 0, 999);
    expect(curva[0].valor).toBe(10);
  });
});

describe("combinarRealConModelo", () => {
  const punto = (valor: number, sinDatoReferencia = false): PuntoCurva => ({
    valor,
    sinDatoReferencia,
  });

  it("usa el dato real donde existe, el del modelo donde no", () => {
    const curvaModelo = [punto(100), punto(80, true), punto(60)];
    const curvaPropia = [null, 142, null];
    const resultado = combinarRealConModelo(curvaModelo, curvaPropia);
    expect(resultado).toEqual([punto(100), punto(142, false), punto(60)]);
  });

  it("nunca deja un valor negativo, aunque el modelo lo produzca (piso físico)", () => {
    const curvaModelo = [punto(-30), punto(10)];
    const resultado = combinarRealConModelo(curvaModelo, null);
    expect(resultado[0].valor).toBe(0);
  });

  it("con curvaPropia null (obra sin ningún dato real), usa el modelo tal cual (solo aplica el piso físico)", () => {
    const curvaModelo = [punto(10), punto(20, true)];
    expect(combinarRealConModelo(curvaModelo, null)).toEqual(curvaModelo);
  });
});
