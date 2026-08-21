// Wordmark CGS — Marca Personal Carlos Sebastián Godoy Sainz (skill
// marca-carlos-godoy). Reemplaza MaestraLogo (decisión explícita del
// usuario 21-ago-2026). Wordmark tipográfico puro (sin isotipo/ícono, por
// diseño de la marca) — Unbounded 800, tracking levemente negativo, con
// un subrayado de Combustión que corta antes del final (nunca completo,
// nunca centrado — ver references/wordmark.md).
export function CgsWordmark({
  className,
  variant = "sobre-oscuro",
}: {
  className?: string;
  /** "sobre-oscuro" = tipo Texto claro + subrayado Combustión (fondo Carbón). "sobre-claro" = tipo Carbón + subrayado Voltio Azul (fondo blanco cálido). */
  variant?: "sobre-oscuro" | "sobre-claro";
}) {
  const colorTipo = variant === "sobre-oscuro" ? "#F5F3EF" : "#0B0B0D";
  const colorSubrayado = variant === "sobre-oscuro" ? "#FF5A1F" : "#1554F3";
  return (
    <span
      className={`font-display inline-flex flex-col ${className ?? ""}`}
      style={{ color: colorTipo, letterSpacing: "-0.02em" }}
    >
      <span className="text-lg leading-none font-extrabold">CGS</span>
      <span
        aria-hidden="true"
        className="mt-0.5 block h-[2px] w-[90%]"
        style={{ backgroundColor: colorSubrayado }}
      />
    </span>
  );
}
