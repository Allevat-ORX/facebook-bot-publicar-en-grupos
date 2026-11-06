const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ONRENTX_HMAC_SECRET = 'test-only-secret';
process.env.MOCK_WORKER = 'true';

const captacion = require('../servidor_captacion');

test('exports a server factory without listening on import', () => {
  assert.equal(typeof captacion.crearServidor, 'function');
  assert.equal(captacion.server, undefined);
});
