import type { Metadata } from "next";
import { Unbounded, Manrope, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Tipografía Marca Personal CGS (skill marca-carlos-godoy) — next/font en
// vez del <link> de la receta del skill: evita el flash de fuente sin
// estilo y no depende de una petición a Google Fonts en cada carga (Next
// la sirve self-hosted desde el build). Expuestas como variables CSS,
// consumidas vía las utilidades font-display/font-body/font-mono-cgs
// (ver tailwind.config.ts + globals.css).
const unbounded = Unbounded({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});
const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono-cgs",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Flujo de Caja Nómina",
  description: "Proyección de flujo de caja de nómina — Grupo Maestra",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="es"
      className={`${unbounded.variable} ${manrope.variable} ${jetbrainsMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
