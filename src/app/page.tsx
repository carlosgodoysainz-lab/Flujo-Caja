import { redirect } from "next/navigation";

// Reemplaza el placeholder "Forge App" de la plantilla (auditoría 24-sep-2026):
// la raíz lleva al reporte; el proxy ya manda a /login si no hay sesión.
export default function Home() {
  redirect("/reporte");
}
