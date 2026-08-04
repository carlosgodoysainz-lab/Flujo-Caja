---
description: "Ver y reactivar skills que fueron desactivados por /forge-init. Muestra menu interactivo con descripcion de cada skill disponible."
---

# /forge-activate — Activar Skills

> *"Nuevas herramientas para nuevos desafios."*

Muestra los skills desactivados y permite reactivarlos cuando los necesites.

---

## Instrucciones

### Paso 1: Verificar Skills Inactivos

Listar el contenido de `.claude/_inactive/`:

```bash
ls .claude/_inactive/ 2>/dev/null
```

Si el directorio no existe o esta vacio, mostrar:

```
Todos los skills estan activos. No hay nada que reactivar.

Skills disponibles:
[listar los skills en .claude/skills/]
```

Y terminar.

---

### Paso 2: Mostrar Menu

Para cada skill en `_inactive/`, leer la primera linea de `description` del SKILL.md y presentar:

```
Skills disponibles para activar:

  1. website-3d      — Landing pages cinematicas con scroll-driven video animation
  2. video-visuals   — Visuales estilo sketchnote para videos y presentaciones
  3. image-generation — Generar imagenes con OpenRouter + Gemini
  4. el-crisol       — Validacion estrategica post-Blueprint (7 analisis + go/no-go)
  [... segun lo que haya en _inactive/]

  A. Activar TODOS los skills

¿Cual quieres activar? (numero, varios separados por coma, o A para todos)
```

Esperar respuesta del usuario.

---

### Paso 3: Activar Skills Seleccionados

Para cada skill seleccionado:

```bash
mv .claude/_inactive/[skill-name] .claude/skills/
```

### Paso 4: Confirmar

```
Skills activados:

  [skill-name] — Movido a .claude/skills/
  [skill-name] — Movido a .claude/skills/

Ya puedes usar estos skills. Por ejemplo:
  /[comando-asociado] — [descripcion breve]

Skills restantes en _inactive/: [lista o "ninguno"]
```

---

## Notas

- Este comando es seguro: solo mueve carpetas de `_inactive/` a `skills/`.
- Si un skill ya esta en `skills/`, no lo mueve de nuevo.
- El Decision Router en CLAUDE.md NO se actualiza automaticamente. Los skills activados funcionan cuando se invocan directamente, aunque no aparezcan en el router.
