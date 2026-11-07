# Task 7 Report — Batch-Aware Worker and Normalized Errors

## Estado

PASS local. Implementación realizada en `/home/aleix/Proyectos-Claude/worktrees/fb-o2bf-1541-group-selection`, partiendo de `c00d84af4647d95cc3e245d3a7bf1d0a5efa222d`.

No se hizo push, deploy, merge, ni dispatch de subagentes o reviewers.

## Cambios

- `cola.js`
  - Añade `itemsProcesables(data, { batchUuid })` para seleccionar únicamente items v2 con `batch_uuid` coincidente y estado `queued`.
  - Rechaza selección global cuando falta `batchUuid`.
  - Deja los items `publishing` intactos para reconciliación manual después de un reinicio.
  - Conserva `itemsAprobados()` y el resto del contrato v1 para el worker legacy.
- `servidor_captacion.js`
  - Separa el worker anterior como `ejecutarColaLegacy()`.
  - Añade `ejecutarColaWorker({ batchUuid, cola, crearContexto, publicar })` con inyección de cola, contexto y publicador para pruebas aisladas.
  - Persiste `publishing` antes de invocar la navegación/publicación y persiste `published` o `error` después del resultado.
  - Procesa solo el batch solicitado, conserva éxitos parciales y detiene el batch en `session_expired` sin modificar otros batches.
  - No recupera automáticamente items que ya estaban en `publishing`.
  - Añade `normalizarErrorFacebook()` con códigos estables para sesión, checkpoint, membresía, compositores buy/sell, cuestionario, compositor ausente, timeout de navegación y errores desconocidos.
  - Mantiene las rutas existentes del servidor usando explícitamente `ejecutarColaLegacy()` como comportamiento legacy; Task 5 sigue sin iniciar workers v2 automáticamente.
- `test/cola.test.js`
  - Verifica aislamiento por batch, ausencia de selección global y ausencia de recuperación automática de `publishing`.
- `test/servidor_captacion.test.js`
  - Verifica transiciones `publishing → published/error`, aislamiento de otro batch, éxito parcial, parada por sesión expirada, normalización de errores y cierre de contexto.
  - Todos los tests del worker inyectan cola, contexto y publicador; no lanzan Playwright ni usan archivos productivos.

## Evidencia TDD

### RED

Comando:

```text
$ node --test test/cola.test.js test/servidor_captacion.test.js
```

Resultado inicial: 48/54 PASS y 6 fallos esperados porque no existían `itemsProcesables`, `ejecutarColaWorker` ni `normalizarErrorFacebook`. Tras corregir el fixture para proporcionar el campo v2 `grupo`, los fallos quedaron limitados a esas interfaces ausentes.

### GREEN enfocado

```text
$ node --test test/cola.test.js test/servidor_captacion.test.js
# tests 54
# pass 54
# fail 0
```

### Verificación final

```text
$ npm test
# tests 81
# pass 81
# fail 0
# cancelled 0

$ npm run lint
# PASS

$ node --check servidor_captacion.js && node --check cola.js
# PASS

$ git diff --check
# PASS
```

## Self-review

- Se revisaron los callers del worker: la API legacy conserva `worker` inyectable y por defecto usa `ejecutarColaLegacy`; el endpoint v2 mantiene `worker_started: false`.
- La selección v2 no puede caer a items aprobados globales ni convertir `publishing` a `queued`.
- La persistencia de cada transición usa `actualizarItem()` y, por tanto, la escritura atómica existente.
- No se añadieron `console.log`, `debugger`, `TODO`, `HACK`, `any`, `@ts-ignore` ni stubs vacíos.
- El diff se limita a `cola.js`, `servidor_captacion.js`, `test/cola.test.js`, `test/servidor_captacion.test.js` y este informe.
- No hay evidencia de CI remoto, Agent Canvas ni reviewers porque el encargo prohíbe push, subagentes y reviewers; se ejecutó verificación local completa.

## Commit

Se crea un único commit con el subject:

```text
feat(O2BF-1541): process Facebook batches safely
```

El SHA se informa en la respuesta de cierre de la tarea.

## Fix Round 1 — O2BF-1541 Captation Server Task 7

### Finding corregido

`normalizarErrorFacebook()` ahora mapea las señales exactas `Iniciar sesión` y `Log in` a `session_expired` mediante comparación case-insensitive, preservando los mapeos existentes. El worker conserva la parada del batch actual cuando el código normalizado es `session_expired`; no se modificó la brecha de scheduling de Task 5 ni se conectó el dispatch v2.

### Evidencia TDD

RED:

```text
$ node --test test/cola.test.js test/servidor_captacion.test.js
# tests 56
# pass 54
# fail 2
# Fallaron los dos casos nuevos con actual 'unknown' y esperado 'session_expired'
```

GREEN:

```text
$ node --test test/cola.test.js test/servidor_captacion.test.js
# tests 56
# pass 56
# fail 0
```

Verificación completa:

```text
$ npm test
# tests 83
# pass 83
# fail 0

$ npm run lint
# PASS

$ git diff --check
# PASS
```

### Archivos modificados

- `servidor_captacion.js`: añade los patrones `iniciar sesión` y `log in` al mapeo existente de sesión expirada.
- `test/servidor_captacion.test.js`: añade una regresión case-insensitive para cada señal.

### Commit

El único commit de Fix Round 1 está creado; el SHA se informa en la respuesta de cierre de la tarea.
