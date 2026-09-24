"use server";

import { auth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import {
  downloadFileContent,
  ensureDriveId,
  searchFiles,
  type GraphSearchHit,
} from "@/features/ingestion/graph/client";
import { contarBeneficiariosTransferenciaBancaria } from "@/features/ingestion/text-parser/transferencia-bancaria-parser";

export interface SyncBeneficiariosAnticipoResult {
  estado: "ok" | "parcial" | "error";
  periodo: string;
  beneficiariosRg: number;
  beneficiariosRp: number;
  archivosProcesados: number;
  errores: string[];
}

const MESES_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

function rutaDe(hit: GraphSearchHit): string {
  if (hit.parentReference?.path) return hit.parentReference.path;
  try {
    return decodeURIComponent(hit.webUrl);
  } catch {
    return hit.webUrl;
  }
}

/**
 * Cuenta el N° REAL de beneficiarios de Anticipo (personas, no
 * divisiones) desde los archivos "<Sociedad>-Anticipo-<Mes> '<yy>
 * -Transferencia Bancaria.txt" de la carpeta "Pagos Mensuales/anticipos/
 * anticipo <mes> <año>/RG|RP/" — pedido explícito del usuario
 * 24-ago-2026: "la cantidad de personas son muchos más... revisa el
 * detalle en la carpeta donde está el banco y corriges por la cantidad
 * de beneficiarios".
 *
 * Bug real que esto corrige: `payroll_line_items` (de "Solicitud de
 * Requerimiento") es grano de (sociedad, división) — su conteo de filas
 * daba ~15-20 "personas" para toda la compañía, cuando el archivo de
 * transferencia bancaria de UNA sola sociedad (Maestra Construcción,
 * RG, agosto-2026) tiene 675 líneas — 675 beneficiarios reales, cada
 * uno 1 sola vez (ver Auto-Blindaje 24-ago-2026).
 *
 * El RG/RP de cada archivo se determina por la carpeta contenedora
 * ("/RG/"/"/RP/", o la variante "Rol General"/"Rol Privado"/"Rol
 * Particular" que usan algunos meses — ej. "anticipo abril 2026" —
 * confirmado real 24-ago-2026), NO por el nombre del archivo — más
 * confiable, ya que el nombre solo indica sociedad/mes.
 *
 * Deliberadamente NO persiste RUT ni nombre — solo un conteo de líneas
 * (ver `contarBeneficiariosTransferenciaBancaria`).
 */
export async function syncBeneficiariosAnticipo(
  periodo: Date,
): Promise<SyncBeneficiariosAnticipoResult> {
  const session = await auth();
  const periodoLabel = `${periodo.getFullYear()}-${String(periodo.getMonth() + 1).padStart(2, "0")}`;
  const periodoStr = periodo.toISOString().slice(0, 10);

  if (!session?.graphAccessToken) {
    return {
      estado: "error",
      periodo: periodoLabel,
      beneficiariosRg: 0,
      beneficiariosRp: 0,
      archivosProcesados: 0,
      errores: ["Sesión de Microsoft no disponible — vuelve a iniciar sesión."],
    };
  }

  const supabase = createServiceClient();
  const errores: string[] = [];

  try {
    const mesNombre = MESES_ES[periodo.getMonth()];
    const anio = String(periodo.getFullYear());
    const carpetaEsperada = `anticipo ${mesNombre} ${anio}`;

    // maxResultados alto — mismo motivo documentado en
    // sync-cotizacion-previred.ts: cada mes trae ~8-15 archivos de
    // transferencia bancaria (uno por sociedad, x2 por RG/RP) mezclados
    // con otros archivos de la misma carpeta ("Solicitud de
    // Requerimiento", rechazos, etc.).
    const hits = await searchFiles(
      session.graphAccessToken,
      `Transferencia Bancaria ${mesNombre}`,
      { maxResultados: 200 },
    );

    // BUG REAL corregido 24-sep-2026 (visto en vivo: Anticipo RG de
    // sep-2026 con 1.492 personas, más que la dotación total de 916): en
    // los meses con aguinaldo (Fiestas Patrias, Navidad) la carpeta trae
    // además "Rol General aguinaldo/" / "Rol Privado aguinaldo/" con un
    // archivo "<Sociedad>-Anticipo Aguinaldo-..." por sociedad — son las
    // MISMAS personas del anticipo regular cobrando un 2do pago, así que
    // sumarlas duplicaba el N°. El aguinaldo se excluye SOLO del conteo de
    // personas; el $ del Anticipo viene de otra fuente y lo sigue
    // incluyendo (se paga con el anticipo).
    const candidatosSinResolver = hits.filter((hit) => {
      const nombreLower = hit.name.toLowerCase();
      const rutaLower = rutaDe(hit).toLowerCase();
      return (
        nombreLower.endsWith(".txt") &&
        nombreLower.includes("transferencia bancaria") &&
        rutaLower.includes(carpetaEsperada.toLowerCase()) &&
        !nombreLower.includes("aguinaldo") &&
        !rutaLower.includes("aguinaldo")
      );
    });

    if (candidatosSinResolver.length === 0) {
      return {
        estado: "error",
        periodo: periodoLabel,
        beneficiariosRg: 0,
        beneficiariosRp: 0,
        archivosProcesados: 0,
        errores: [
          `No se encontró ningún archivo "Transferencia Bancaria" para ${periodoLabel} en la carpeta "${carpetaEsperada}".`,
        ],
      };
    }

    const candidatos = (
      await Promise.all(
        candidatosSinResolver.map((h) =>
          ensureDriveId(session.graphAccessToken!, h),
        ),
      )
    ).filter((h) => h.parentReference?.driveId);

    let beneficiariosRg = 0;
    let beneficiariosRp = 0;
    let archivosProcesados = 0;
    const archivosVistos = new Set<string>();

    for (const archivo of candidatos) {
      // Mismo archivo puede aparecer 2 veces en resultados de búsqueda
      // (ej. copia en subcarpeta) — no contarlo 2 veces.
      const clave = `${rutaDe(archivo)}::${archivo.name}`;
      if (archivosVistos.has(clave)) continue;
      archivosVistos.add(clave);

      const rutaLower = rutaDe(archivo).toLowerCase();
      // Naming inconsistente confirmado en SharePoint (ej. "anticipo abril
      // 2026" usa "Rol General"/"Rol Privado" en vez de "RG"/"RP" — mismo
      // patrón de inconsistencia ya documentado para otras carpetas de
      // "Pagos Mensuales"). Se aceptan ambas variantes.
      const esRg = /\/rg\//.test(rutaLower) || /\/rol general/.test(rutaLower);
      const esRp =
        /\/rp\//.test(rutaLower) ||
        /\/rol privado/.test(rutaLower) ||
        /\/rol particular/.test(rutaLower);
      if (!esRp && !esRg) {
        errores.push(
          `${archivo.name}: no se pudo determinar si es RG o RP por la ruta de carpeta — se ignora.`,
        );
        continue;
      }

      const buffer = await downloadFileContent(
        session.graphAccessToken!,
        archivo.parentReference!.driveId!,
        archivo.id,
      );
      const texto = buffer.toString("latin1"); // archivos de banco: encoding Latin-1/Windows-1252, no UTF-8
      const cantidad = contarBeneficiariosTransferenciaBancaria(texto);

      if (esRg) beneficiariosRg += cantidad;
      else beneficiariosRp += cantidad;
      archivosProcesados++;
    }

    if (archivosProcesados === 0) {
      return {
        estado: "error",
        periodo: periodoLabel,
        beneficiariosRg: 0,
        beneficiariosRp: 0,
        archivosProcesados: 0,
        errores:
          errores.length > 0
            ? errores
            : [
                `Ningún archivo válido de transferencia bancaria para ${periodoLabel}.`,
              ],
      };
    }

    for (const [concepto, cantidad] of [
      ["anticipo_rg", beneficiariosRg],
      ["anticipo_rp", beneficiariosRp],
    ] as const) {
      const { error: upsertError } = await supabase
        .from("payroll_beneficiarios_reales")
        .upsert(
          {
            periodo: periodoStr,
            concepto,
            cantidad,
            archivos_contados: archivosProcesados,
          },
          { onConflict: "periodo,concepto" },
        );
      if (upsertError) {
        errores.push(
          `No se pudo guardar beneficiarios de ${concepto}: ${upsertError.message}`,
        );
      }
    }

    await supabase.from("audit_log").insert({
      actor_id: session.user?.id ?? null,
      accion: "sync_beneficiarios_anticipo",
      entidad: "payroll_beneficiarios_reales",
      metadata: {
        periodo: periodoLabel,
        beneficiariosRg,
        beneficiariosRp,
        archivosProcesados,
        errores: errores.length,
        primerosErrores: errores.slice(0, 5),
      },
    });

    return {
      estado: errores.length > 0 ? "parcial" : "ok",
      periodo: periodoLabel,
      beneficiariosRg,
      beneficiariosRp,
      archivosProcesados,
      errores,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      estado: "error",
      periodo: periodoLabel,
      beneficiariosRg: 0,
      beneficiariosRp: 0,
      archivosProcesados: 0,
      errores: [...errores, message],
    };
  }
}
