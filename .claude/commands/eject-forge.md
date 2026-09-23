---
description: "Quita Forge de este proyecto con `forge eject` (determinista, con respaldo, conserva lo tuyo) o genera una copia limpia para entregar con `forge export`."
---

# Eject Forge

Saca Forge de un proyecto **sin tocar el codigo del usuario**. Desde V5.4 esto lo
hace el CLI de Node de forma **determinista**: se basa en `.forge/manifest.json`
y borra solo lo que Forge instalo y sigue intacto. Tu trabajo es invocar el CLI,
explicar el plan y pedir confirmacion. **Tu no borras ni editas archivos a mano.**

## Proceso

### 1. Verifica que el CLI este disponible

```bash
forge --version
```

Si dice `forge: command not found`, pidele al usuario que lo enlace una sola vez
(ajusta `~/.forge` a donde clono Forge):

```bash
cd ~/.forge/tools/forge-cli && git pull && npm install && npm run build && npm link
```

Si tiene un `alias forge` viejo que tapa el binario, `command forge doctor --fix`
lo elimina (con backup).

### 2. Pregunta UNA cosa

Usa AskUserQuestion:

> ¿Quieres **quitar Forge de este repo**, o **generar una copia limpia en otra
> carpeta** (recomendado para entregar a clientes o miembros; este repo no se toca)?

Si elige copia limpia, pregunta tambien la carpeta destino (fuera del repo, p. ej.
`../mi-app-entrega`) y si tiene una carpeta **overlay** con los archivos propios del
entregable (su propio `CLAUDE.md`, comandos de instalacion, README para miembros).

### 3. Vista previa (dry-run)

Quitar de este repo:

```bash
forge eject --dry-run --json
```

Copia limpia:

```bash
forge export ../mi-app-entrega --tracked-only --dry-run --json
# con overlay:
forge export ../mi-app-entrega --tracked-only --overlay entrega/ --dry-run --json
```

Resume la salida al usuario en lenguaje claro:

- `removed`: cuantos archivos de Forge se van (intactos, segun el manifiesto).
- `keptModified`: archivos de Forge que **el usuario edito** — se conservan
  (`--include-modified` los borra).
- `keptAdopted`: archivos que el usuario ya tenia antes de instalar Forge — **nunca**
  se borran.
- `notForge`: archivos propios dentro de `.claude/` (sus comandos, skills,
  settings) — se conservan.
- `context`: que pasa con el archivo de contexto (CLAUDE.md / AGENTS.md / GEMINI.md /
  .cursorrules segun la plataforma): se quita la zona Forge y queda solo la zona del
  usuario (debajo de `FORGE:PRESERVE:START`), sin la marca. Sin marca → se deja igual.
- `forgeDirRemoved`, `blocks` (bloque de Forge en `.gitignore`), `settings` (hooks de
  Forge en `.claude/settings.json`).

### 4. Advierte y pide confirmacion explicita

Para **eject in situ**: el working tree debe estar limpio (si no, que commitee o haga
stash; `--force` solo si esta consciente). Se crea un respaldo en
`.forge-eject-backup/<fecha>/` (o `--backup <dir>` fuera del repo). No sigas sin un
"si" explicito del usuario.

### 5. Ejecuta

```bash
forge eject --yes --check-leaks
# o
forge export ../mi-app-entrega --tracked-only --overlay entrega/ --check-leaks
```

`--yes` es correcto aqui porque el humano ya confirmo en el paso 4.

### 6. Reporta

- Archivos conservados (`keptModified`, `keptAdopted`, `notForge`) y por que.
- Ruta del respaldo y como restaurar: `cp -R .forge-eject-backup/<fecha>/. .`
  Recuerda borrar esa carpeta antes de entregar.
- **Fugas** (`--check-leaks`, exit 2): lista `archivo:linea` donde aun aparece
  "Forge". **No las corrijas por tu cuenta**: proponlas como un cambio aparte y
  espera aprobacion.

## Que NO haces

- 🔒 **Nunca** edites `src/`, `README.md`, `package.json` ni textos de la app para
  "quitar la marca" — eso es el código del usuario, y un eject que lo toca deja de ser
  reversible. Si quiere cambiar textos (p. ej. "Forge App"), propónlo como cambio aparte.
- 🔒 Nunca borres `.claude/` completo ni el archivo de contexto
  completo — ahí viven los comandos propios del usuario y su zona
  `FORGE:PRESERVE`; el CLI ya distingue lo de Forge de lo suyo, borrar en bloque no.
- 🔒 Nunca uses `--include-modified` sin que el usuario lo pida explicitamente — esa bandera borra justo los archivos de Forge que él editó, que son los que más trabajo le costaron.

## Notas

- **Multi-plataforma:** `forge eject` quita todos los targets del manifiesto; acota
  con `--target codex` (los artefactos compartidos como `HOOKS.md`, `.husky/` y
  `AGENTS.md` se quedan si otro target los usa).
- **Sin manifiesto** (proyectos del alias V4): el CLI se rehusa. Corre `forge update`
  primero para escribir el manifiesto.
- **Greenfield:** `--scaffold` tambien quita los docs del scaffold intactos
  (`src/features/.template/`, READMEs de arquitectura, el README y las imagenes de Forge).
- **CI del entregable:** `forge check --leaks` falla (exit 2) si reaparece un rastro.
