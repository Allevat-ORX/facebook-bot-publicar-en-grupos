const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listen } = require('./helpers');
const { crearCadenaCanonica, calcularFirma } = require('../auth');
const { crearCatalogo } = require('../catalogo');

const HMAC_SECRET = 'test-only-secret';
const NOW_SECONDS = 1793990000;
const BATCH_UUID = '123e4567-e89b-42d3-a456-426614174000';
const FIRST_GROUP_ID = '912187995658737';
const SECOND_GROUP_ID = '123456789';
const FIRST_KEY = `sha256:${'0'.repeat(64)}`;
const SECOND_KEY = `sha256:${'1'.repeat(64)}`;

process.env.ONRENTX_HMAC_SECRET = HMAC_SECRET;
process.env.MOCK_WORKER = 'true';

const captacion = require('../servidor_captacion');

test('exports a server factory without listening on import', () => {
  assert.equal(typeof captacion.crearServidor, 'function');
  assert.equal(captacion.server, undefined);
});

test('production defaults to all interfaces while tests use ephemeral loopback', async (t) => {
  assert.equal(typeof captacion.iniciarServidor, 'function');

  const productionServer = captacion.iniciarServidor({ port: 0 });
  t.after(() => new Promise((resolve, reject) => {
    productionServer.close((error) => error ? reject(error) : resolve());
  }));
  await once(productionServer, 'listening');

  const productionAddress = productionServer.address();
  assert.equal(productionAddress.address, '0.0.0.0');
  assert.ok(productionAddress.port > 0);

  const testServer = captacion.crearServidor();
  const testListener = await listen(testServer);
  t.after(testListener.close);

  const testAddress = testServer.address();
  assert.equal(testAddress.address, '127.0.0.1');
  assert.ok(testAddress.port > 0);
  assert.equal(testListener.baseUrl, `http://127.0.0.1:${testAddress.port}`);
});

function crearColaFake() {
  const items = [];
  let enqueueCalls = 0;

  return {
    existeCola: () => items.length > 0,
    leerCola: () => ({ version: 1, items }),
    encolarItem: (entrada) => {
      enqueueCalls += 1;
      const item = {
        ...entrada,
        id: `test-item-${enqueueCalls}`,
        estado: entrada.estado || 'pendiente',
      };
      items.push(item);
      return item;
    },
    get enqueueCalls() {
      return enqueueCalls;
    },
  };
}

function crearHeadersFirmados({ method, pathname, rawBody = '', nonce }) {
  const timestamp = String(NOW_SECONDS);
  const canonical = crearCadenaCanonica({ timestamp, nonce, method, pathname, rawBody });

  return {
    'content-type': 'application/json',
    'x-onrentx-timestamp': timestamp,
    'x-onrentx-nonce': nonce,
    'x-onrentx-signature': calcularFirma(HMAC_SECRET, canonical),
  };
}

async function solicitar(baseUrl, pathname, { method = 'GET', rawBody, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: rawBody,
  });
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch (_) {}

  return { status: response.status, headers: response.headers, body };
}

async function abrirServidor(t, dependencies = {}) {
  const server = captacion.crearServidor({
    hmacSecret: HMAC_SECRET,
    now: () => NOW_SECONDS * 1000,
    cola: crearColaFake(),
    ...dependencies,
  });
  const listener = await listen(server);
  t.after(listener.close);
  return listener;
}

function crearDependenciasV2(t, groupIds = [FIRST_GROUP_ID, SECOND_GROUP_ID]) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orx-captacion-api-'));
  const queuePath = path.join(directory, 'cola.json');
  const catalogPath = path.join(directory, 'catalogo.json');
  const previousQueuePath = process.env.COLA_PATH;

  process.env.COLA_PATH = queuePath;
  delete require.cache[require.resolve('../cola')];
  const queue = require('../cola');
  delete require.cache[require.resolve('../cola')];
  restaurarVariableEntorno('COLA_PATH', previousQueuePath);

  fs.writeFileSync(catalogPath, JSON.stringify({
    version: 1,
    groups: groupIds.map((facebookGroupId) => ({
      facebook_group_id: facebookGroupId,
      url: `https://www.facebook.com/groups/${facebookGroupId}/`,
      membership_state: 'member',
      group_type: 'standard',
      validation_state: 'valid',
      validated_at: '2026-11-06T20:00:00Z',
      warning: null,
    })),
  }));

  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return {
    cola: queue,
    catalogo: crearCatalogo({ path: catalogPath }),
    queuePath,
    catalogPath,
  };
}

function crearGrupoV2(facebookGroupId, idempotencyKey) {
  return {
    facebook_group_id: facebookGroupId,
    url: `https://www.facebook.com/groups/${facebookGroupId}/`,
    idempotency_key: idempotencyKey,
  };
}

function crearPayloadV2(overrides = {}) {
  return {
    batch_uuid: BATCH_UUID,
    lead_id: 2212,
    machine: 'Plataforma de tijera diésel 7-8 m',
    region: 'Querétaro',
    duration: 14,
    need_operator: false,
    copy: 'Se busca plataforma de tijera diésel.',
    groups: [crearGrupoV2(FIRST_GROUP_ID, FIRST_KEY)],
    auto_start: false,
    ...overrides,
  };
}

let signedRequestSequence = 0;

async function solicitarJsonFirmado(baseUrl, pathname, payload, { nonce } = {}) {
  const rawBody = JSON.stringify(payload);
  signedRequestSequence += 1;
  const headers = crearHeadersFirmados({
    method: 'POST',
    pathname,
    rawBody,
    nonce: nonce || `signed-json-${String(signedRequestSequence).padStart(4, '0')}`,
  });
  return solicitar(baseUrl, pathname, { method: 'POST', rawBody, headers });
}

async function solicitarGetFirmado(baseUrl, pathname, { nonce } = {}) {
  signedRequestSequence += 1;
  const headers = crearHeadersFirmados({
    method: 'GET',
    pathname,
    rawBody: '',
    nonce: nonce || `signed-get-request-${String(signedRequestSequence).padStart(4, '0')}`,
  });
  return solicitar(baseUrl, pathname, { headers });
}

function crearPayloadConBytes(totalBytes) {
  const prefix = '{"lead_id":2212,"groups":["https://facebook.example/group"],"auto_start":false,"padding":"';
  const suffix = '"}';
  const paddingBytes = totalBytes - Buffer.byteLength(prefix) - Buffer.byteLength(suffix);
  assert.ok(paddingBytes >= 0);
  return `${prefix}${'x'.repeat(paddingBytes)}${suffix}`;
}

function restaurarVariableEntorno(name, previousValue) {
  if (previousValue === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = previousValue;
}

test('keeps health public while queue and future operational GET routes require HMAC', async (t) => {
  const listener = await abrirServidor(t);

  const health = await solicitar(listener.baseUrl, '/health');
  const queue = await solicitar(listener.baseUrl, '/api/cola');
  const futureRoute = await solicitar(listener.baseUrl, '/api/future-operation');

  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');
  assert.deepEqual(queue.body, { error: 'missing_signature' });
  assert.equal(queue.status, 401);
  assert.equal(futureRoute.status, 401);
});

test('accepts a signed write once and rejects the repeated nonce before another mutation', async (t) => {
  const colaFake = crearColaFake();
  const listener = await abrirServidor(t, {
    cola: colaFake,
    enableLegacyGroupSelection: true,
  });
  const pathname = '/api/sondeo/dispatch';
  const rawBody = JSON.stringify({
    lead_id: 2212,
    groups: ['https://facebook.example/group'],
    auto_start: false,
  });
  const headers = crearHeadersFirmados({
    method: 'POST',
    pathname,
    rawBody,
    nonce: 'dispatch-nonce-0001',
  });

  const first = await solicitar(listener.baseUrl, pathname, { method: 'POST', rawBody, headers });
  const replay = await solicitar(listener.baseUrl, pathname, { method: 'POST', rawBody, headers });

  assert.equal(first.status, 202);
  assert.equal(first.body.ok, true);
  assert.equal(replay.status, 409);
  assert.deepEqual(replay.body, { error: 'replay_detected' });
  assert.equal(colaFake.enqueueCalls, 1);
});

test('rejects an unsigned write without mutating the queue', async (t) => {
  const colaFake = crearColaFake();
  const listener = await abrirServidor(t, { cola: colaFake });
  const rawBody = JSON.stringify({
    lead_id: 2212,
    groups: ['https://facebook.example/group'],
    auto_start: false,
  });

  const response = await solicitar(listener.baseUrl, '/api/sondeo/dispatch', {
    method: 'POST',
    rawBody,
    headers: { 'content-type': 'application/json' },
  });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { error: 'missing_signature' });
  assert.equal(colaFake.enqueueCalls, 0);
});

test('returns a controlled 413 and never parses or mutates an oversized body', async (t) => {
  const colaFake = crearColaFake();
  const listener = await abrirServidor(t, { cola: colaFake, maxBodyBytes: 16 });

  const response = await solicitar(listener.baseUrl, '/api/sondeo/dispatch', {
    method: 'POST',
    rawBody: '{"lead_id":2212,"groups":["https://facebook.example/group"],"auto_start":false,"padding":"too-large"}',
    headers: { 'content-type': 'application/json' },
  });

  assert.equal(response.status, 413);
  assert.deepEqual(response.body, { error: 'payload_too_large' });
  assert.equal(colaFake.enqueueCalls, 0);
});

test('uses exactly 2097152 bytes as the default request body limit', async (t) => {
  const previousApprovedLimit = process.env.REQUEST_BODY_LIMIT_BYTES;
  const previousObsoleteLimit = process.env.MAX_REQUEST_BODY_BYTES;
  delete process.env.REQUEST_BODY_LIMIT_BYTES;
  delete process.env.MAX_REQUEST_BODY_BYTES;

  try {
    const listener = await abrirServidor(t, { enableLegacyGroupSelection: true });
    const pathname = '/api/sondeo/dispatch';
    const bodyAtLimit = crearPayloadConBytes(2097152);
    const bodyOverLimit = crearPayloadConBytes(2097153);

    const accepted = await solicitar(listener.baseUrl, pathname, {
      method: 'POST',
      rawBody: bodyAtLimit,
      headers: crearHeadersFirmados({
        method: 'POST',
        pathname,
        rawBody: bodyAtLimit,
        nonce: 'default-limit-exact-0001',
      }),
    });
    const rejected = await solicitar(listener.baseUrl, pathname, {
      method: 'POST',
      rawBody: bodyOverLimit,
      headers: crearHeadersFirmados({
        method: 'POST',
        pathname,
        rawBody: bodyOverLimit,
        nonce: 'default-limit-over-0002',
      }),
    });

    assert.equal(accepted.status, 202);
    assert.equal(rejected.status, 413);
    assert.deepEqual(rejected.body, { error: 'payload_too_large' });
  } finally {
    restaurarVariableEntorno('REQUEST_BODY_LIMIT_BYTES', previousApprovedLimit);
    restaurarVariableEntorno('MAX_REQUEST_BODY_BYTES', previousObsoleteLimit);
  }
});

test('uses REQUEST_BODY_LIMIT_BYTES from the environment', async (t) => {
  const previousApprovedLimit = process.env.REQUEST_BODY_LIMIT_BYTES;
  const previousObsoleteLimit = process.env.MAX_REQUEST_BODY_BYTES;
  process.env.REQUEST_BODY_LIMIT_BYTES = '16';
  delete process.env.MAX_REQUEST_BODY_BYTES;

  try {
    const listener = await abrirServidor(t);
    const response = await solicitar(listener.baseUrl, '/api/sondeo/dispatch', {
      method: 'POST',
      rawBody: 'x'.repeat(17),
      headers: { 'content-type': 'application/json' },
    });

    assert.equal(response.status, 413);
    assert.deepEqual(response.body, { error: 'payload_too_large' });
  } finally {
    restaurarVariableEntorno('REQUEST_BODY_LIMIT_BYTES', previousApprovedLimit);
    restaurarVariableEntorno('MAX_REQUEST_BODY_BYTES', previousObsoleteLimit);
  }
});

test('rejects the obsolete MAX_REQUEST_BODY_BYTES configuration name', () => {
  const previousApprovedLimit = process.env.REQUEST_BODY_LIMIT_BYTES;
  const previousObsoleteLimit = process.env.MAX_REQUEST_BODY_BYTES;
  delete process.env.REQUEST_BODY_LIMIT_BYTES;
  process.env.MAX_REQUEST_BODY_BYTES = '16';

  try {
    assert.throws(
      () => captacion.crearServidor({ hmacSecret: HMAC_SECRET }),
      /MAX_REQUEST_BODY_BYTES is obsolete; use REQUEST_BODY_LIMIT_BYTES/,
    );
  } finally {
    restaurarVariableEntorno('REQUEST_BODY_LIMIT_BYTES', previousApprovedLimit);
    restaurarVariableEntorno('MAX_REQUEST_BODY_BYTES', previousObsoleteLimit);
  }
});

test('allows unsigned preflight only for configured origins', async (t) => {
  const allowedOrigin = 'https://portal.onrentx.com';
  const listener = await abrirServidor(t, { allowedOrigins: [allowedOrigin] });

  const allowed = await solicitar(listener.baseUrl, '/api/sondeo/dispatch', {
    method: 'OPTIONS',
    headers: { origin: allowedOrigin },
  });
  const denied = await solicitar(listener.baseUrl, '/api/sondeo/dispatch', {
    method: 'OPTIONS',
    headers: { origin: 'https://untrusted.example' },
  });

  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), allowedOrigin);
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

test('serves the legacy visor only on loopback without exposing unsigned queue data', async (t) => {
  const listener = await abrirServidor(t);

  const visor = await solicitar(listener.baseUrl, '/visor');
  const queue = await solicitar(listener.baseUrl, '/api/cola');

  assert.equal(visor.status, 200);
  assert.match(visor.body, /OnRentX Captación Server/);
  assert.equal(queue.status, 401);
  assert.deepEqual(queue.body, { error: 'missing_signature' });
});

test('direct startup fails before listening when the HMAC secret is missing', async () => {
  const previousSecret = process.env.ONRENTX_HMAC_SECRET;
  delete process.env.ONRENTX_HMAC_SECRET;
  let server;
  let startupError;

  try {
    try {
      server = captacion.iniciarServidor({ port: 0, host: '127.0.0.1' });
    } catch (error) {
      startupError = error;
    }

    if (server) {
      await once(server, 'listening');
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }

    assert.match(startupError?.message || '', /ONRENTX_HMAC_SECRET/);
  } finally {
    process.env.ONRENTX_HMAC_SECRET = previousSecret;
  }
});

test('rejects non-numeric HMAC_MAX_SKEW_SECONDS during server creation', () => {
  const previousSkew = process.env.HMAC_MAX_SKEW_SECONDS;
  process.env.HMAC_MAX_SKEW_SECONDS = 'abc';

  try {
    assert.throws(
      () => captacion.crearServidor({ hmacSecret: HMAC_SECRET }),
      /HMAC_MAX_SKEW_SECONDS must be a non-negative integer/,
    );
  } finally {
    restaurarVariableEntorno('HMAC_MAX_SKEW_SECONDS', previousSkew);
  }
});

test('rejects negative HMAC_MAX_SKEW_SECONDS during server creation', () => {
  const previousSkew = process.env.HMAC_MAX_SKEW_SECONDS;
  process.env.HMAC_MAX_SKEW_SECONDS = '-1';

  try {
    assert.throws(
      () => captacion.crearServidor({ hmacSecret: HMAC_SECRET }),
      /HMAC_MAX_SKEW_SECONDS must be a non-negative integer/,
    );
  } finally {
    restaurarVariableEntorno('HMAC_MAX_SKEW_SECONDS', previousSkew);
  }
});

test('keeps the server factory controllable with an injected verifier and no environment secret', () => {
  const previousSecret = process.env.ONRENTX_HMAC_SECRET;
  delete process.env.ONRENTX_HMAC_SECRET;

  try {
    const server = captacion.crearServidor({
      cola: crearColaFake(),
      verificador: {
        verificar: () => ({ ok: false, status: 401, errorCode: 'test_verifier' }),
      },
    });
    assert.equal(typeof server.listen, 'function');
  } finally {
    process.env.ONRENTX_HMAC_SECRET = previousSecret;
  }
});

test('keeps the legacy string-array contract disabled unless explicitly enabled', async (t) => {
  const pathname = '/api/sondeo/dispatch';
  const payload = {
    lead_id: 2212,
    copy: 'Legacy body must not be logged',
    groups: ['https://www.facebook.com/groups/912187995658737/'],
    auto_start: false,
  };

  const disabledQueue = crearColaFake();
  const disabled = await abrirServidor(t, { cola: disabledQueue });
  const rejected = await solicitarJsonFirmado(disabled.baseUrl, pathname, payload);

  assert.equal(rejected.status, 400);
  assert.deepEqual(rejected.body, { error: 'legacy_contract_disabled' });
  assert.equal(disabledQueue.enqueueCalls, 0);

  const messages = [];
  const enabledQueue = crearColaFake();
  const enabled = await abrirServidor(t, {
    cola: enabledQueue,
    enableLegacyGroupSelection: true,
    logger: (message) => messages.push(message),
  });
  const accepted = await solicitarJsonFirmado(enabled.baseUrl, pathname, payload);

  assert.equal(accepted.status, 202);
  assert.equal(enabledQueue.enqueueCalls, 1);
  assert.ok(messages.includes('contract=legacy'));
  assert.equal(messages.some((message) => message.includes(payload.copy)), false);
});

test('rejects every invalid strict-v2 boundary before mutating the queue', async (t) => {
  const dependencies = crearDependenciasV2(t);
  const listener = await abrirServidor(t, dependencies);
  const pathname = '/api/sondeo/dispatch';
  const secondGroup = crearGrupoV2(SECOND_GROUP_ID, SECOND_KEY);
  const invalidCases = [
    ['malformed batch UUID', { batch_uuid: 'not-a-uuid' }],
    ['non-positive lead', { lead_id: 0 }],
    ['blank copy', { copy: '   ' }],
    ['copy beyond the Facebook limit', { copy: 'x'.repeat(63207) }],
    ['missing groups', { groups: [] }],
    ['more than 30 groups', {
      groups: Array.from({ length: 31 }, (_, index) => crearGrupoV2(
        String(800000000000000 + index),
        `sha256:${index.toString(16).padStart(64, '0')}`,
      )),
    }],
    ['duplicate group IDs', {
      groups: [
        crearGrupoV2(FIRST_GROUP_ID, FIRST_KEY),
        crearGrupoV2(FIRST_GROUP_ID, SECOND_KEY),
      ],
    }],
    ['duplicate idempotency keys', {
      groups: [crearGrupoV2(FIRST_GROUP_ID, FIRST_KEY), { ...secondGroup, idempotency_key: FIRST_KEY }],
    }],
    ['non-lowercase sha256 key', {
      groups: [{ ...crearGrupoV2(FIRST_GROUP_ID, FIRST_KEY), idempotency_key: `sha256:${'A'.repeat(64)}` }],
    }],
    ['URL and ID mismatch', {
      groups: [{ ...crearGrupoV2(FIRST_GROUP_ID, FIRST_KEY), url: secondGroup.url }],
    }],
    ['non-canonical URL', {
      groups: [{
        ...crearGrupoV2(FIRST_GROUP_ID, FIRST_KEY),
        url: `https://m.facebook.com/groups/${FIRST_GROUP_ID}/?ref=share`,
      }],
    }],
    ['group absent from the operational catalog', {
      groups: [crearGrupoV2('999999999', FIRST_KEY)],
    }],
  ];

  for (const [label, overrides] of invalidCases) {
    const response = await solicitarJsonFirmado(
      listener.baseUrl,
      pathname,
      crearPayloadV2(overrides),
    );
    assert.equal(response.status, 400, label);
    assert.equal(response.body.error, 'invalid_payload', label);
  }

  assert.equal(fs.existsSync(dependencies.queuePath), false);
});

test('dispatches a two-group v2 batch idempotently and reports its signed status', async (t) => {
  const dependencies = crearDependenciasV2(t);
  let workerCalls = 0;
  const listener = await abrirServidor(t, {
    ...dependencies,
    worker: async () => {
      workerCalls += 1;
    },
  });
  const pathname = '/api/sondeo/dispatch';
  const payload = crearPayloadV2({
    groups: [
      crearGrupoV2(FIRST_GROUP_ID, FIRST_KEY),
      crearGrupoV2(SECOND_GROUP_ID, SECOND_KEY),
    ],
    auto_start: true,
  });

  const first = await solicitarJsonFirmado(listener.baseUrl, pathname, payload);
  const retry = await solicitarJsonFirmado(listener.baseUrl, pathname, payload);

  assert.equal(first.status, 202);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.batch_uuid, BATCH_UUID);
  assert.equal(first.body.lead_id, 2212);
  assert.equal(first.body.state, 'queued');
  assert.equal(first.body.worker_started, false);
  assert.equal(first.body.items.length, 2);
  assert.deepEqual(first.body.items.map((item) => item.facebook_group_id), [
    FIRST_GROUP_ID,
    SECOND_GROUP_ID,
  ]);
  assert.deepEqual(first.body.items.map((item) => item.state), ['queued', 'queued']);
  assert.deepEqual(first.body.items.map((item) => item.existing), [false, false]);

  assert.equal(retry.status, 202);
  assert.deepEqual(
    retry.body.items.map((item) => item.remote_item_id),
    first.body.items.map((item) => item.remote_item_id),
  );
  assert.deepEqual(retry.body.items.map((item) => item.existing), [true, true]);
  assert.equal(dependencies.cola.leerCola().items.length, 2);
  assert.equal(workerCalls, 0);

  const statusPath = `/api/batches/${BATCH_UUID}`;
  const status = await solicitarGetFirmado(listener.baseUrl, statusPath);
  assert.equal(status.status, 200);
  assert.equal(status.body.batch_uuid, BATCH_UUID);
  assert.equal(status.body.lead_id, 2212);
  assert.equal(status.body.state, 'queued');
  assert.equal(status.body.terminal, false);
  assert.deepEqual(status.body.counts, {
    total: 2,
    queued: 2,
    publishing: 0,
    published: 0,
    error: 0,
    cancelled: 0,
  });
  assert.equal(status.body.items.length, 2);

  const missingUuid = '223e4567-e89b-42d3-a456-426614174001';
  const missing = await solicitarGetFirmado(listener.baseUrl, `/api/batches/${missingUuid}`);
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { error: 'batch_not_found' });

  const invalid = await solicitarGetFirmado(listener.baseUrl, '/api/batches/not-a-uuid');
  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.body, { error: 'invalid_batch_uuid' });
});

test('returns a deterministic conflict when an existing batch body changes', async (t) => {
  const dependencies = crearDependenciasV2(t);
  const listener = await abrirServidor(t, dependencies);
  const pathname = '/api/sondeo/dispatch';

  const first = await solicitarJsonFirmado(listener.baseUrl, pathname, crearPayloadV2());
  const changed = await solicitarJsonFirmado(
    listener.baseUrl,
    pathname,
    crearPayloadV2({ copy: 'Contenido distinto para el mismo batch.' }),
  );

  assert.equal(first.status, 202);
  assert.equal(changed.status, 409);
  assert.deepEqual(changed.body, { error: 'batch_uuid_conflict' });
  assert.equal(dependencies.cola.leerCola().items.length, 1);
});

test('accepts 30 explicit v2 groups without applying LIMITE_TANDA', async (t) => {
  const groupIds = Array.from({ length: 30 }, (_, index) => String(700000000000000 + index));
  const dependencies = crearDependenciasV2(t, groupIds);
  const listener = await abrirServidor(t, dependencies);
  const payload = crearPayloadV2({
    groups: groupIds.map((facebookGroupId, index) => crearGrupoV2(
      facebookGroupId,
      `sha256:${index.toString(16).padStart(64, '0')}`,
    )),
  });

  const response = await solicitarJsonFirmado(
    listener.baseUrl,
    '/api/sondeo/dispatch',
    payload,
  );

  assert.equal(response.status, 202);
  assert.equal(response.body.items.length, 30);
  assert.equal(dependencies.cola.leerCola().items.length, 30);
});

test('accepts exactly 63206 copy code points and rejects the next one', async (t) => {
  const dependencies = crearDependenciasV2(t);
  const listener = await abrirServidor(t, dependencies);

  const accepted = await solicitarJsonFirmado(
    listener.baseUrl,
    '/api/sondeo/dispatch',
    crearPayloadV2({ copy: 'x'.repeat(63206) }),
  );
  const rejected = await solicitarJsonFirmado(
    listener.baseUrl,
    '/api/sondeo/dispatch',
    crearPayloadV2({
      batch_uuid: '223e4567-e89b-42d3-a456-426614174001',
      copy: 'x'.repeat(63207),
    }),
  );

  assert.equal(accepted.status, 202);
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, 'invalid_payload');
  assert.equal(dependencies.cola.leerCola().items.length, 1);
});

test('counts Unicode code points instead of UTF-16 code units for copy limits', async (t) => {
  const dependencies = crearDependenciasV2(t);
  const listener = await abrirServidor(t, dependencies);
  const emoji = '😀';

  const accepted = await solicitarJsonFirmado(
    listener.baseUrl,
    '/api/sondeo/dispatch',
    crearPayloadV2({ copy: emoji.repeat(63206) }),
  );
  const rejected = await solicitarJsonFirmado(
    listener.baseUrl,
    '/api/sondeo/dispatch',
    crearPayloadV2({
      batch_uuid: '223e4567-e89b-42d3-a456-426614174001',
      copy: emoji.repeat(63207),
    }),
  );

  assert.equal(accepted.status, 202);
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, 'invalid_payload');
  assert.equal(dependencies.cola.leerCola().items.length, 1);
});

test('uses MAX_COPY_CODE_POINTS from the environment', async (t) => {
  const previousLimit = process.env.MAX_COPY_CODE_POINTS;
  process.env.MAX_COPY_CODE_POINTS = '3';

  try {
    const dependencies = crearDependenciasV2(t);
    const listener = await abrirServidor(t, dependencies);
    const accepted = await solicitarJsonFirmado(
      listener.baseUrl,
      '/api/sondeo/dispatch',
      crearPayloadV2({ copy: 'abc' }),
    );
    const rejected = await solicitarJsonFirmado(
      listener.baseUrl,
      '/api/sondeo/dispatch',
      crearPayloadV2({
        batch_uuid: '223e4567-e89b-42d3-a456-426614174001',
        copy: 'abcd',
        groups: [crearGrupoV2(FIRST_GROUP_ID, SECOND_KEY)],
      }),
    );

    assert.equal(accepted.status, 202);
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, 'invalid_payload');
    assert.equal(dependencies.cola.leerCola().items.length, 1);
  } finally {
    restaurarVariableEntorno('MAX_COPY_CODE_POINTS', previousLimit);
  }
});

test('fails closed when MAX_COPY_CODE_POINTS is invalid', () => {
  const previousLimit = process.env.MAX_COPY_CODE_POINTS;
  const invalidValues = ['0', '-1', '1.5', '9007199254740992', 'not-a-number'];

  try {
    for (const invalidValue of invalidValues) {
      process.env.MAX_COPY_CODE_POINTS = invalidValue;
      assert.throws(
        () => captacion.crearServidor({ hmacSecret: HMAC_SECRET }),
        /MAX_COPY_CODE_POINTS must be a positive integer/,
        invalidValue,
      );
    }
  } finally {
    restaurarVariableEntorno('MAX_COPY_CODE_POINTS', previousLimit);
  }
});

test('rejects an idempotency key reused by another batch without mutating the queue', async (t) => {
  const dependencies = crearDependenciasV2(t);
  const listener = await abrirServidor(t, dependencies);
  const pathname = '/api/sondeo/dispatch';
  const firstPayload = crearPayloadV2({
    batch_uuid: '323e4567-e89b-42d3-a456-426614174002',
  });
  const secondPayload = crearPayloadV2({
    batch_uuid: '423e4567-e89b-42d3-a456-426614174003',
  });

  const first = await solicitarJsonFirmado(listener.baseUrl, pathname, firstPayload);
  const queueAfterFirst = JSON.stringify(dependencies.cola.leerCola());
  const conflict = await solicitarJsonFirmado(listener.baseUrl, pathname, secondPayload);

  assert.equal(first.status, 202);
  assert.equal(conflict.status, 409);
  assert.deepEqual(conflict.body, { error: 'idempotency_key_conflict' });
  assert.equal(JSON.stringify(dependencies.cola.leerCola()), queueAfterFirst);
});

function crearPaginaValidacion(texts, actions) {
  return {
    getByText(text) {
      return {
        first() {
          return {
            isVisible: async () => texts.some((value) => value.includes(text)),
          };
        },
      };
    },
    goto: async (url) => actions.push(['goto', url]),
    keyboard: {
      insertText: async () => actions.push(['insertText']),
      press: async (key) => actions.push(['press', key]),
    },
  };
}

test('validates a group through the authenticated non-publishing route', async (t) => {
  const dependencies = crearDependenciasV2(t, [FIRST_GROUP_ID]);
  const actions = [];
  let closeCalls = 0;
  let launchCalls = 0;
  const page = crearPaginaValidacion(['You are a member', 'Write something'], actions);
  const listener = await abrirServidor(t, {
    ...dependencies,
    launchPersistentContext: async () => {
      launchCalls += 1;
      return {
        newPage: async () => page,
        close: async () => { closeCalls += 1; },
      };
    },
  });

  const response = await solicitarJsonFirmado(listener.baseUrl, '/api/groups/validate', {
    facebook_group_id: FIRST_GROUP_ID,
    url: `https://m.facebook.com/groups/${FIRST_GROUP_ID}/?ref=share`,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.facebook_group_id, FIRST_GROUP_ID);
  assert.equal(response.body.url, `https://www.facebook.com/groups/${FIRST_GROUP_ID}/`);
  assert.equal(response.body.membership_state, 'member');
  assert.equal(response.body.group_type, 'standard');
  assert.equal(response.body.validation_state, 'valid');
  assert.equal(launchCalls, 1);
  assert.equal(closeCalls, 1);
  assert.deepEqual(actions, [['goto', response.body.url]]);
  assert.equal(dependencies.catalogo.buscar(FIRST_GROUP_ID).name, undefined);
  assert.equal(dependencies.catalogo.buscar(FIRST_GROUP_ID).validation_state, 'valid');
});

test('returns profile_busy while a worker owns the persistent profile', async (t) => {
  const dependencies = crearDependenciasV2(t, [FIRST_GROUP_ID]);
  let launchCalls = 0;
  let signalLaunch;
  let releaseLaunch;
  const launchEntered = new Promise((resolve) => { signalLaunch = resolve; });
  const launchReleased = new Promise((resolve) => { releaseLaunch = resolve; });
  const page = crearPaginaValidacion(['You are a member', 'Write something'], []);
  const listener = await abrirServidor(t, {
    ...dependencies,
    launchPersistentContext: async () => {
      launchCalls += 1;
      signalLaunch();
      await launchReleased;
      return {
        newPage: async () => page,
        close: async () => {},
      };
    },
  });

  const firstResponsePromise = solicitarJsonFirmado(listener.baseUrl, '/api/groups/validate', {
    facebook_group_id: FIRST_GROUP_ID,
    url: `https://www.facebook.com/groups/${FIRST_GROUP_ID}/`,
  });
  await launchEntered;

  const busyResponse = await solicitarJsonFirmado(listener.baseUrl, '/api/groups/validate', {
    facebook_group_id: FIRST_GROUP_ID,
    url: `https://www.facebook.com/groups/${FIRST_GROUP_ID}/`,
  });

  assert.equal(busyResponse.status, 409);
  assert.deepEqual(busyResponse.body, { error: 'profile_busy' });
  assert.equal(launchCalls, 1);

  releaseLaunch();
  const firstResponse = await firstResponsePromise;
  assert.equal(firstResponse.status, 200);
});

test('rejects a mismatched ID and URL before opening the profile', async (t) => {
  const dependencies = crearDependenciasV2(t, [FIRST_GROUP_ID]);
  let launchCalls = 0;
  const listener = await abrirServidor(t, {
    ...dependencies,
    launchPersistentContext: async () => {
      launchCalls += 1;
      throw new Error('must not launch');
    },
  });

  const response = await solicitarJsonFirmado(listener.baseUrl, '/api/groups/validate', {
    facebook_group_id: FIRST_GROUP_ID,
    url: `https://www.facebook.com/groups/${SECOND_GROUP_ID}/`,
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'facebook_group_mismatch' });
  assert.equal(launchCalls, 0);
});

test('records unsupported buy and sell composers as a warning without publishing', async (t) => {
  const dependencies = crearDependenciasV2(t, [FIRST_GROUP_ID]);
  const actions = [];
  const page = crearPaginaValidacion(['You are a member', 'Sell Something'], actions);
  const listener = await abrirServidor(t, {
    ...dependencies,
    launchPersistentContext: async () => ({
      newPage: async () => page,
      close: async () => {},
    }),
  });

  const response = await solicitarJsonFirmado(listener.baseUrl, '/api/groups/validate', {
    facebook_group_id: FIRST_GROUP_ID,
    url: `https://www.facebook.com/groups/${FIRST_GROUP_ID}/`,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.group_type, 'buy_sell');
  assert.equal(response.body.validation_state, 'warning');
  assert.equal(dependencies.catalogo.buscar(FIRST_GROUP_ID).group_type, 'buy_sell');
  assert.equal(actions.some(([name]) => name === 'insertText'), false);
  assert.equal(actions.some(([name]) => name === 'clickPublish'), false);
});

test('requires HMAC before validating a group or opening the profile', async (t) => {
  const dependencies = crearDependenciasV2(t, [FIRST_GROUP_ID]);
  let launchCalls = 0;
  const listener = await abrirServidor(t, {
    ...dependencies,
    launchPersistentContext: async () => {
      launchCalls += 1;
      throw new Error('must not launch');
    },
  });

  const response = await solicitar(listener.baseUrl, '/api/groups/validate', {
    method: 'POST',
    rawBody: JSON.stringify({
      facebook_group_id: FIRST_GROUP_ID,
      url: `https://www.facebook.com/groups/${FIRST_GROUP_ID}/`,
    }),
    headers: { 'content-type': 'application/json' },
  });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { error: 'missing_signature' });
  assert.equal(launchCalls, 0);
});

test('persists an expired-session warning and closes the profile context', async (t) => {
  const dependencies = crearDependenciasV2(t, [FIRST_GROUP_ID]);
  const actions = [];
  let closeCalls = 0;
  const page = crearPaginaValidacion(['Your session has expired'], actions);
  const listener = await abrirServidor(t, {
    ...dependencies,
    launchPersistentContext: async () => ({
      newPage: async () => page,
      close: async () => { closeCalls += 1; },
    }),
  });

  const response = await solicitarJsonFirmado(listener.baseUrl, '/api/groups/validate', {
    facebook_group_id: FIRST_GROUP_ID,
    url: `https://www.facebook.com/groups/${FIRST_GROUP_ID}/`,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.membership_state, 'unknown');
  assert.equal(response.body.group_type, 'unknown');
  assert.equal(response.body.validation_state, 'warning');
  assert.equal(response.body.warning, 'session_expired');
  assert.equal(closeCalls, 1);
  assert.deepEqual(actions, [['goto', response.body.url]]);
});

test('persists checkpoint_detected for security checkpoint signals', async (t) => {
  const dependencies = crearDependenciasV2(t, [FIRST_GROUP_ID]);
  const page = crearPaginaValidacion(['Security Check'], []);
  const listener = await abrirServidor(t, {
    ...dependencies,
    launchPersistentContext: async () => ({
      newPage: async () => page,
      close: async () => {},
    }),
  });

  const response = await solicitarJsonFirmado(listener.baseUrl, '/api/groups/validate', {
    facebook_group_id: FIRST_GROUP_ID,
    url: `https://www.facebook.com/groups/${FIRST_GROUP_ID}/`,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.warning, 'checkpoint_detected');
  assert.equal(dependencies.catalogo.buscar(FIRST_GROUP_ID).warning, 'checkpoint_detected');
  assert.equal(dependencies.catalogo.buscar(FIRST_GROUP_ID).validation_state, 'warning');
});

test('persists session_expired for an explicit login signal', async (t) => {
  const dependencies = crearDependenciasV2(t, [FIRST_GROUP_ID]);
  const page = crearPaginaValidacion(['Inicia sesión'], []);
  const listener = await abrirServidor(t, {
    ...dependencies,
    launchPersistentContext: async () => ({
      newPage: async () => page,
      close: async () => {},
    }),
  });

  const response = await solicitarJsonFirmado(listener.baseUrl, '/api/groups/validate', {
    facebook_group_id: FIRST_GROUP_ID,
    url: `https://www.facebook.com/groups/${FIRST_GROUP_ID}/`,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.warning, 'session_expired');
  assert.equal(dependencies.catalogo.buscar(FIRST_GROUP_ID).warning, 'session_expired');
  assert.equal(dependencies.catalogo.buscar(FIRST_GROUP_ID).validation_state, 'warning');
});

test('persists an unknown composer classification as an unsupported warning', async (t) => {
  const dependencies = crearDependenciasV2(t, [FIRST_GROUP_ID]);
  const page = crearPaginaValidacion(['You are a member', 'Unrecognized composer'], []);
  const listener = await abrirServidor(t, {
    ...dependencies,
    launchPersistentContext: async () => ({
      newPage: async () => page,
      close: async () => {},
    }),
  });

  const response = await solicitarJsonFirmado(listener.baseUrl, '/api/groups/validate', {
    facebook_group_id: FIRST_GROUP_ID,
    url: `https://www.facebook.com/groups/${FIRST_GROUP_ID}/`,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.membership_state, 'member');
  assert.equal(response.body.group_type, 'unknown');
  assert.equal(response.body.validation_state, 'warning');
  assert.equal(response.body.warning, 'unsupported_composer');
  assert.equal(dependencies.catalogo.buscar(FIRST_GROUP_ID).group_type, 'unknown');
  assert.equal(dependencies.catalogo.buscar(FIRST_GROUP_ID).validation_state, 'warning');
});
