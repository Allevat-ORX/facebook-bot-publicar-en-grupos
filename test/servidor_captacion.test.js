const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { listen } = require('./helpers');

process.env.ONRENTX_HMAC_SECRET = 'test-only-secret';
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
