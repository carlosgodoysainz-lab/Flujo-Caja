import type { Config } from "tailwindcss";

// Tokens de Marca Maestra — confirmados en los dashboards de referencia
// (Minuta GESPRO Comparativo, Carta Gantt Plan de Obras). Ver
// BLUEPRINT-flujo-caja-nomina.md → "Sistema de Diseño (Marca Maestra)".
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        maestra: {
          navy: "var(--navy)",
          "navy-brand": "var(--navy-brand)",
          fucsia: "var(--fucsia)",
          gold: "var(--gold)",
          ok: "var(--ok)",
          warn: "var(--warn)",
          err: "var(--err)",
        },
      },
    },
  },
  plugins: [],
};

export default config;
