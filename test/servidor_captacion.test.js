const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { listen } = require('./helpers');
const { crearCadenaCanonica, calcularFirma } = require('../auth');

const HMAC_SECRET = 'test-only-secret';
const NOW_SECONDS = 1793990000;

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
  const listener = await abrirServidor(t, { cola: colaFake });
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
    const listener = await abrirServidor(t);
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
