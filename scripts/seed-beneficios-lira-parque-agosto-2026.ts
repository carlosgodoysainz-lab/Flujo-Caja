// Carga de los 2 pagos YA COMPROMETIDOS por la firma del Convenio Colectivo
// "Obra Lira Parque" (5-ago-2026, vigente 24 meses hasta 5-ago-2028): el
// Bono de Término de Negociación (Art. 21, $185.000/trabajador RG) y el
// Aporte Sindical único (Art. 25, $2.200.000 fijo). Ambos son pagos reales
// ya cerrados dentro del mes de la firma (agosto-2026) — se cargan directo
// a `beneficios_line_items` con es_real=true, igual criterio que el Excel
// histórico maestro (dato ya cerrado, no una fórmula ni un override
// genérico de Finanzas).
//
// El Aporte Sindical MENSUAL ($500.000, ago-2026 a ago-2028) NO se siembra
// acá — sale automático de la fórmula fecha-fija en beneficios.ts.
//
// Ejecutar con: npx tsx --env-file=.env.local scripts/seed-beneficios-lira-parque-agosto-2026.ts
import { createClient } from "@supabase/supabase-js";

const PERIODO = "2026-08-01";
const MONTO_POR_CABEZA_BONO_TERMINO = 185_000;
const MONTO_APORTE_SINDICAL_UNICO = 2_200_000;
// Piso documentado en la nómina anexa al convenio si todavía no hay
// dotación RG real cargada para agosto-2026 al momento de correr el
// script — la nómina anexa es un piso, no el total exacto de RG activos
// ese mes (ver plan A.6), por eso se prioriza siempre el dato real de
// `dotacion_mensual` cuando existe.
const DOTACION_RG_PISO_NOMINA_ANEXA = 56;

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );

  const { data: dotacionMensual } = await supabase
    .from("dotacion_mensual")
    .select("rg")
    .eq("periodo", PERIODO)
    .maybeSingle();

  const dotacionRg = dotacionMensual?.rg ?? DOTACION_RG_PISO_NOMINA_ANEXA;
  if (!dotacionMensual?.rg) {
    console.log(
      `Sin dotación RG real cargada para ${PERIODO} todavía — usando el piso de la nómina anexa (${DOTACION_RG_PISO_NOMINA_ANEXA}). Vuelve a correr este script después de un "Actualizar reporte" si quieres el número real.`,
    );
  }

  const montoBonoTermino = MONTO_POR_CABEZA_BONO_TERMINO * dotacionRg;

  const { error, data } = await supabase
    .from("beneficios_line_items")
    .upsert(
      [
        {
          periodo: PERIODO,
          poblacion: "rg",
          tipo_evento: "bono_termino_negociacion",
          monto: montoBonoTermino,
          es_real: true,
          metodo_calculo: "pago_comprometido_convenio",
        },
        {
          periodo: PERIODO,
          poblacion: "rg",
          tipo_evento: "aporte_sindical_unico",
          monto: MONTO_APORTE_SINDICAL_UNICO,
          es_real: true,
          metodo_calculo: "pago_comprometido_convenio",
        },
      ],
      { onConflict: "periodo,poblacion,tipo_evento" },
    )
    .select("tipo_evento, monto");

  if (error) {
    console.error("Error en upsert:", error);
    process.exit(1);
  }

  console.log(
    `Bono Término de Negociación: $${montoBonoTermino.toLocaleString("es-CL")} (${dotacionRg} trabajadores RG × $${MONTO_POR_CABEZA_BONO_TERMINO.toLocaleString("es-CL")})`,
  );
  console.log(
    `Aporte Sindical único: $${MONTO_APORTE_SINDICAL_UNICO.toLocaleString("es-CL")}`,
  );
  console.log(`Guardadas ${data?.length ?? 0} filas en beneficios_line_items.`);
  console.log(
    "Corre 'Actualizar reporte' en /reporte para que se refleje en cash_flow_monthly.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
