# Task 5 Report — Explicit Dispatch and Batch Status API

## Estado

Implementación completada en el worktree dedicado `fb-o2bf-1541-group-selection`, partiendo de `6d5e037e802431b9474a4d00330f8da4347cc565`.

## Cambios

- `servidor_captacion.js`
  - Añade validación estricta del contrato v2: UUID, lead positivo, copy no vacío limitado a 63.206 caracteres, entre 1 y 30 grupos únicos, claves idempotentes SHA-256 minúsculas, URL canónica con ID exacto y destino operativo del catálogo.
  - Encola la selección explícita mediante `encolarLote()` sin aplicar `LIMITE_TANDA`.
  - Devuelve resultados creados o existentes con `worker_started: false`; Task 5 no inicia el worker batch-aware todavía.
  - Convierte conflictos de batch o idempotencia en respuestas HTTP 409 deterministas.
  - Añade `GET /api/batches/{batch_uuid}` protegido por HMAC y 404 para batches ausentes.
  - Mantiene el contrato legacy solo con `ENABLE_LEGACY_GROUP_SELECTION=true` y registra `contract=legacy` sin incluir el body.
  - Añade inyección de catálogo, logger y worker para pruebas sin tocar estado productivo.
- `test/servidor_captacion.test.js`
  - Firma exactamente los bytes JSON serializados una sola vez y firma body vacío en GET.
  - Usa cola y catálogo temporales e inyecta un worker mock.
  - Cubre límites v2, lote de dos grupos, retry idempotente, conflicto por cambio, batch status, 404/UUID inválido, legacy bajo flag y 30 grupos explícitos.

## Evidencia TDD

### RED

`node --test test/servidor_captacion.test.js`

- 15 tests pasaron y 5 fallaron por los motivos contractuales esperados: legacy habilitado por defecto, ausencia de validación v2, ausencia de `batch_uuid`, ausencia de conflicto y objetos de grupo tratados como URLs.

### GREEN

- `node --test test/servidor_captacion.test.js`: 20/20 PASS.
- `node --test test/servidor_captacion.test.js test/auth.test.js test/catalogo.test.js test/cola.test.js`: 51/51 PASS.
- `npm test`: 51/51 PASS.
- `npm run lint`: PASS.
- `git diff --check`: PASS.

## Self-review

- Callers de `crearServidor()` e `iniciarServidor()` revisados; la inyección nueva conserva defaults productivos.
- Sin `debugger`, `TODO`, `HACK`, `@ts-ignore` ni `any` añadidos.
- Imports comprobados mediante ejecución y `node --check`.
- Cambios tracked limitados a `servidor_captacion.js` y `test/servidor_captacion.test.js`.
- No se implementó procesamiento batch-aware, push, deploy ni revisión por agentes, según alcance.

## Consideraciones

- El brief exige un copy acotado sin fijar cifra. Se aplicó el máximo de publicación de Facebook de 63.206 caracteres mediante `MAX_COPY_LENGTH`.
- No hay evidencia de CI remoto ni reviewers porque el alcance prohíbe push y reviewers; la evidencia disponible es local.

## Fix Round 1 — O2BF-1541 Task 5

### Alcance y causa raíz

- `servidor_captacion.js` tenía `MAX_COPY_LENGTH = 63206` fijo y medía `copy` con `String.length`, que cuenta unidades UTF-16 y no puntos de código Unicode.
- La cola ya aplicaba el conflicto correcto para una `idempotency_key` idéntica perteneciente a otro `batch_uuid`, pero faltaba una regresión HTTP que verificara el 409 y la ausencia de mutación.

### RED exacto

Comando:

```text
$ node --test test/servidor_captacion.test.js
```

Salida relevante exacta antes del cambio:

```text
# Subtest: counts Unicode code points instead of UTF-16 code units for copy limits
not ok 22 - counts Unicode code points instead of UTF-16 code units for copy limits
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:

    400 !== 202

# Subtest: uses MAX_COPY_CODE_POINTS from the environment
not ok 23 - uses MAX_COPY_CODE_POINTS from the environment
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:

    202 !== 400

# Subtest: fails closed when MAX_COPY_CODE_POINTS is invalid
not ok 24 - fails closed when MAX_COPY_CODE_POINTS is invalid
  failureType: 'testCodeFailure'
  error: 'Missing expected exception: 0'

1..25
# tests 25
# pass 22
# fail 3
# cancelled 0
# skipped 0
# todo 0
```

La prueba de conflicto HTTP cross-batch pasó ya en RED porque la capa de cola existente tenía esa protección; se conserva como regresión del contrato HTTP.

### Cambios

- `servidor_captacion.js`
  - Añade el límite por defecto `63206` como `DEFAULT_MAX_COPY_CODE_POINTS`.
  - Lee `MAX_COPY_CODE_POINTS` durante `crearServidor()` y lo valida como entero seguro positivo mediante `validarEnteroConfiguracion`; valores inválidos hacen fallar la creación antes de atender tráfico.
  - Pasa el límite configurado al validador v2 y mide con `Array.from(copy).length`.
- `test/servidor_captacion.test.js`
  - Añade frontera exacta `N=63206` aceptada y `N+1` rechazada.
  - Añade frontera Unicode con emoji para distinguir puntos de código de unidades UTF-16.
  - Añade override `MAX_COPY_CODE_POINTS=3` y valores inválidos, incluidos valores no positivos, fraccionarios, no seguros y no numéricos.
  - Añade prueba HTTP de reutilización de la misma clave y contenido desde otro batch: HTTP 409 exacto `{ error: 'idempotency_key_conflict' }` y cola byte-a-byte sin mutación.

### GREEN y verificación exactas

Prueba enfocada:

```text
$ node --test test/servidor_captacion.test.js
1..25
# tests 25
# pass 25
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Suite completa:

```text
$ npm test
1..56
# tests 56
# pass 56
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Lint:

```text
$ npm run lint

> facebook-bot-parcelas@1.0.0 lint
> node --check servidor_captacion.js && node --check cola.js
```

También pasó `git diff --check`.

### Commit

- `fix(O2BF-1541): enforce Unicode copy limit and idempotency conflict`
- Único commit de Fix Round 1; sin push ni deploy.

### Concerns

- No se comprobaron CI remoto, Agent Canvas ni reviewers porque esta ronda está limitada al worktree local y prohíbe push y reviewers.
- El comportamiento de producción requiere definir `MAX_COPY_CODE_POINTS` como entero seguro positivo si se sobrescribe; el valor por defecto sigue siendo exactamente 63206 puntos de código Unicode.
