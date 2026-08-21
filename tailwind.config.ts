import type { Config } from "tailwindcss";

// Tokens de Marca Personal CGS (Carlos Sebastián Godoy Sainz, skill
// marca-carlos-godoy) — reemplaza Marca Maestra, decisión explícita del
// usuario 21-ago-2026. Ver Auto-Blindaje en el PRP para el detalle de
// verificación WCAG de cada color.
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
      fontFamily: {
        display: ["var(--font-display)", "Segoe UI Semibold", "sans-serif"],
        body: ["var(--font-body)", "Segoe UI", "sans-serif"],
        "mono-cgs": ["var(--font-mono-cgs)", "Consolas", "monospace"],
      },
      colors: {
        cgs: {
          carbon: "var(--cgs-carbon)",
          signal: "var(--cgs-signal)",
          structure: "var(--cgs-structure)",
          disrupt: "var(--cgs-disrupt)",
          surface: "var(--cgs-surface)",
          "surface-2": "var(--cgs-surface-2)",
          line: "var(--cgs-line)",
          text: "var(--cgs-text)",
          "text-muted": "var(--cgs-text-muted)",
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
