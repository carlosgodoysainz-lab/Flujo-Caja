import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
