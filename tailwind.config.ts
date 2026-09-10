import type { Config } from "tailwindcss";

// Tokens de Marca Maestra — confirmados en los dashboards de referencia
// (Minuta GESPRO Comparativo, Carta Gantt Plan de Obras). Ver
// BLUEPRINT-flujo-caja-nomina.md → "Sistema de Diseño (Marca Maestra)".
//
// El bloque `colors` base (border/input/ring/background/primary/etc.) es
// el setup estándar de shadcn/ui (style "new-york", ver components.json) —
// necesario porque nunca corrimos `shadcn init` (solo `shadcn add`), así
// que había que agregarlo a mano (bug real detectado al revisar por qué
// los componentes instalados en Fase 2 podían renderizar sin estilos).
const config: Config = {
  darkMode: ["class"],
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
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
