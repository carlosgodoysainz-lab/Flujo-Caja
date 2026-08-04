---
name: karpathy-principles
description: Principios de codificacion inspirados en Andrej Karpathy para reducir errores comunes de LLMs. Usar cuando necesites reforzar buenas practicas o como referencia antes de implementar features complejas.
---

# Principios de Codificacion (Karpathy)

Basados en las observaciones de Andrej Karpathy sobre errores comunes al codificar con LLMs.
Fuente: [andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills)

---

## Principio 1: Piensa Antes de Codificar

**Regla:** Surfacea suposiciones, presenta tradeoffs, pregunta si hay ambiguedad — NUNCA asumas en silencio.

**Anti-patron:** Recibir "agrega export de datos de usuario" y asumir CSV, todos los campos, descarga directa.

**Lo correcto:**
- Preguntar: ¿Que campos? ¿Formato (CSV/JSON/Excel)? ¿Datos sensibles? ¿Volumen esperado?
- Presentar interpretaciones multiples cuando existan
- Si hay 2+ caminos razonables, listarlos con tradeoffs antes de elegir

**En contexto Forge:**
- Antes de crear una tabla en Supabase, confirmar columnas y relaciones
- Antes de implementar un Server Action, confirmar inputs/outputs esperados
- Si el Blueprint dice algo ambiguo, preguntar — no inventar

---

## Principio 2: Simplicidad Primero

**Regla:** Codigo minimo que resuelve el problema de HOY. No abstraigas prematuramente.

**Anti-patron:** Para "guardar preferencias del usuario", agregar caching, validacion multi-capa, sistema de notificaciones, y merge logic.

**Lo correcto:**
- Una funcion que hace exactamente lo pedido
- Sin wrappers, sin factories, sin strategy patterns para un solo caso
- Refactorizar SOLO cuando la complejidad genuina lo demande

**En contexto Forge:**
- Un Server Action simple > un API route con middleware para operaciones internas
- `useState` local > Zustand store global si el estado no se comparte
- Query directa a Supabase > capa de abstraccion de repositorio para una sola tabla
- Zod schema inline > archivo separado de validacion para un solo endpoint

---

## Principio 3: Cambios Quirurgicos

**Regla:** Toca SOLO lo necesario. No refactorices codigo que no pidieron.

**Anti-patron:** Para "fix bug de email vacio en validador", tambien mejorar el regex, agregar validacion de username, reescribir comments, y agregar docstrings.

**Lo correcto:**
- Cambiar solo las lineas que corrigen el bug reportado
- Respetar el estilo de codigo existente (quotes, indentation, patterns)
- No agregar type annotations, comments, o imports a codigo que no modificaste

**En contexto Forge:**
- Si te piden fix en un componente, no refactorices el layout padre
- Si agregas un campo a una tabla, no reorganices las otras columnas
- Si corriges un Server Action, no cambies el naming de las demas
- Matchear el estilo existente del archivo, no imponer el "ideal"

---

## Principio 4: Ejecucion Orientada a Metas

**Regla:** Define criterios de exito verificables antes de implementar. Avanza incrementalmente.

**Anti-patron:** Para "agrega rate limiting a la API", implementar Redis + multi-strategy + per-endpoint config en un solo commit de 300 lineas sin verificar nada.

**Lo correcto:**
1. Definir el issue especifico (ej: "sesiones persisten despues de cambio de password")
2. Escribir test que reproduzca el problema
3. Implementar fix minimo
4. Verificar que el test pasa
5. Verificar que no hay regresiones

**En contexto Forge:**
- Antes de implementar una fase del Blueprint, definir que "completado" significa
- Verificar con Playwright MCP despues de cada fase critica
- Avanzar incrementalmente: schema → RLS → server action → UI → validacion
- No marcar una tarea como completa sin verificar que funciona

---

## Cuando Activar Este Skill

- Antes de implementar una feature compleja
- Cuando detectes que estas agregando mas de lo pedido
- Cuando el cambio toca multiples archivos no relacionados
- Como referencia durante code review (propio o ajeno)

→ Ver ejemplos detallados con codigo: `references/examples.md`
