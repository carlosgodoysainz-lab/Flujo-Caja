# Attribution

Este corpus de 129 design systems en formato `DESIGN.md` proviene de
[`nexu-io/open-design`](https://github.com/nexu-io/open-design), un proyecto
open-source bajo licencia Apache-2.0.

## Origen

- **Repositorio:** https://github.com/nexu-io/open-design
- **Carpeta upstream:** [`design-systems/`](https://github.com/nexu-io/open-design/tree/main/design-systems)
- **Commit importado:** `8438270f747c813cd1a1dddf6fac1f0d894c7d0c`
- **Fecha de import:** 2026-05-01
- **Licencia:** Apache License 2.0 — ver [`LICENSE`](./LICENSE)

## Cadena de atribución

`open-design` a su vez agrega contenido de proyectos previos (todos compatibles
con Apache-2.0 o MIT), explícitamente acreditados en su README:

- [`VoltAgent/awesome-design-md`](https://github.com/VoltAgent/awesome-design-md) — los 70 product-system `DESIGN.md` (Linear, Stripe, Vercel, Apple, Notion, etc.)
- [`bergside/awesome-design-skills`](https://github.com/bergside/awesome-design-skills) — los 57 design skills agregados como `DESIGN.md` adicionales
- 2 starters hand-authored por el equipo de `nexu-io`: `default/` (Neutral Modern) y `warm-editorial/` (Warm Editorial)

## Términos de uso en Forge

Forge mantiene el aviso de copyright original (`LICENSE` en esta carpeta) y el
crédito a los autores originales. Los archivos `DESIGN.md` no se modifican
durante la importación — se preservan tal cual el commit upstream.

Si modificas algún `DESIGN.md` para adaptarlo a un proyecto Forge específico,
**copialo primero al root del proyecto como `DESIGN.md`** y edítalo ahí. No
modifiques los archivos de `library/` directamente — son la base canónica.

## Cómo refrescar el corpus

Cuando upstream publique nuevos sistemas o correcciones:

```bash
# Desde el root del repo Forge
cd /tmp && rm -rf od && git clone --depth 1 https://github.com/nexu-io/open-design.git od
rsync -a --exclude='README.md' /tmp/od/design-systems/ \
  forge/.claude/design-systems/library/
cp /tmp/od/LICENSE forge/.claude/design-systems/library/LICENSE
# Regenerar INDEX.md (script en commit history)
# Actualizar el commit SHA en este archivo
```

## Disclaimer importante

Los nombres "Linear", "Stripe", "Vercel", "Apple", "Tesla", etc. son marcas
registradas de sus respectivos dueños. Los `DESIGN.md` de esta carpeta son
**estudios visuales inspirados en el lenguaje de cada marca** ("Inspired by"),
escritos como referencia educativa por la comunidad open-source. No son
oficiales, no representan a esas compañías, y no deben usarse para impersonar
sus productos.

Cuando un agente Forge use un sistema de `library/`, su rol es **inspirar**,
no **replicar** — el objetivo es ayudar al usuario a articular qué le gusta del
referente, no producir un clon que confunda al usuario con la marca original.
