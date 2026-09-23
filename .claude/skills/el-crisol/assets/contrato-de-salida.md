---
name: contrato-de-salida
description: >
  Contrato anti-invención que aplican los 7 comandos de estrategia
  (brujula, estrella, rivales, precio, roi, metas, lanzamiento) antes de
  escribir su documento. Tres reglas: sin dato no hay número, toda
  recomendación cita su documento fuente, y sin research no hay landscape.
---

# Contrato de Salida

> Un documento de estrategia con cifras inventadas es peor que no tener documento:
> se ve igual de serio y nadie sabe cuál dato aguanta peso.

Aplica **siempre**, antes de escribir el documento de salida.

## Regla 1 — Sin dato, sin número

Si no tienes fuente para una cifra, **no la escribas**. Escribe en su lugar:

`⚠️ Requiere validación — [cómo conseguirlo en una línea]`

Ejemplos de "cómo conseguirlo": *pregúntaselo a 10 usuarios actuales* ·
*sácalo del dashboard de Stripe* · *mídelo 30 días antes de fijar precio* ·
*pídele el dato al cliente*.

Nunca una cifra plausible. Nunca un benchmark "de la industria" sin la fuente al lado.
Un default ofrecido por el comando (por ejemplo un churn sugerido) es una cifra
inventada: márcala igual y di de dónde salió.

## Regla 2 — Toda recomendación cita su documento fuente

Cada recomendación, score o decisión lleva entre paréntesis el documento y la
sección de donde sale:

`Recomendamos entrar por el segmento B2B (STRATEGY-CANVAS § Target Customer;
COMPETITIVE-ANALYSIS § Gaps).`

Si la recomendación sale de tu criterio y no de un documento, dilo:
`(criterio del agente, sin documento de respaldo)`.

## Regla 3 — Sin research, sin landscape

Si no tienes Perplexity ni WebSearch disponibles, **decláralo arriba del documento**,
en la primera línea después del título:

`> ⚠️ Generado sin research externo. Las secciones marcadas [NO VERIFICADO]
> salen de la información que diste tú, no de fuentes públicas.`

Y marca `[NO VERIFICADO]` cada sección afectada: landscape competitivo, pricing de
competidores, benchmarks de mercado, TAM/SAM.

Nunca sustituyas research por conocimiento general del modelo sin marcarlo.

## Cómo se ve cuando se aplica bien

| Sin contrato | Con contrato |
|---|---|
| `CAC estimado: $45` | `CAC estimado: ⚠️ Requiere validación — divide tu gasto de ads del último mes entre los signups de ese mes` |
| `El competidor X cobra $29/mes` | `El competidor X cobra $29/mes [NO VERIFICADO] — confírmalo en su página de pricing` |
| `Recomendamos freemium` | `Recomendamos freemium (STRATEGY-CANVAS § Revenue Model; PRICING-STRATEGY § Modelos evaluados)` |

## Por qué existe este contrato

El Crisol calcula el Build Confidence Score leyendo estos 7 documentos. Si los insumos
traen cifras plausibles sin fuente, el veredicto go/no-go hereda la invención **con
apariencia de rigor** — y el usuario decide invertir semanas de trabajo con eso.
