import path from "node:path";
import { defineConfig } from "vitest/config";

// Sin este config, Vitest no resuelve el alias "@/" -> "src/" que usa
// todo el proyecto (viene de tsconfig.json, pero tsc/Next.js lo
// resuelven por su cuenta — Vitest necesita su propio `resolve.alias`).
// Hallazgo real (17-ago-2026): esto nunca se notó porque ningún test
// anterior importaba, en tiempo de EJECUCIÓN, un módulo que a su vez
// importara algo con "@/" de forma no-type-only — los `import type`
// se borran en la transformación y nunca llegan a necesitar resolverse.
// render-excel.test.ts (nuevo) fue el primero en necesitarlo de verdad
// (FILAS_DETALLE, CONCEPTOS_METODOLOGIA — imports reales, no de tipo).
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
