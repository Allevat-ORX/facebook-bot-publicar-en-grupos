const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sha256Body,
  crearCadenaCanonica,
  calcularFirma,
  crearVerificador,
} = require('../auth');

const secret = 'test-only-secret';
const rawBody = '{"lead_id":2212}';
const input = {
  timestamp: '1793990000',
  nonce: '123e4567-e89b-12d3-a456-426614174000',
  method: 'POST',
  pathname: '/api/sondeo/dispatch',
  rawBody,
};

test('builds the exact canonical string and HMAC signature', () => {
  assert.equal(
    sha256Body(rawBody),
    'c8d7493c3ae176921185c1a3a1f1d81b7c6eeee20ba04d2989cf841517228e93',
  );
  assert.equal(
    crearCadenaCanonica(input),
    '1793990000\n123e4567-e89b-12d3-a456-426614174000\nPOST\n/api/sondeo/dispatch\nc8d7493c3ae176921185c1a3a1f1d81b7c6eeee20ba04d2989cf841517228e93',
  );
  assert.equal(
    calcularFirma(secret, crearCadenaCanonica(input)),
    '19f6e19141350dae1a99be166b76942d8f6f890c35f86626a95df158d0026c07',
  );
});

test('accepts one valid signed request and rejects replay', () => {
  const canonical = crearCadenaCanonica(input);
  const signature = calcularFirma(secret, canonical);
  const verifier = crearVerificador({ secret, nowSeconds: () => 1793990000 });

  assert.deepEqual(verifier.verificar({ ...input, signature }), { ok: true, status: 200, errorCode: null });
  assert.deepEqual(verifier.verificar({ ...input, signature }), { ok: false, status: 409, errorCode: 'replay_detected' });
});

test('rejects a timestamp outside the five minute window', () => {
  const signature = calcularFirma(secret, crearCadenaCanonica(input));
  const verifier = crearVerificador({ secret, nowSeconds: () => 1793990401 });

  assert.deepEqual(
    verifier.verificar({ ...input, signature }),
    { ok: false, status: 401, errorCode: 'timestamp_expired' },
  );
});

test('accepts a timestamp exactly 300 seconds old', () => {
  const boundaryInput = { ...input, nonce: 'boundary-nonce-1234' };
  const signature = calcularFirma(secret, crearCadenaCanonica(boundaryInput));
  const verifier = crearVerificador({ secret, nowSeconds: () => 1793990300 });

  assert.deepEqual(
    verifier.verificar({ ...boundaryInput, signature }),
    { ok: true, status: 200, errorCode: null },
  );
});

test('rejects malformed authentication fields without comparing signatures', () => {
  const verifier = crearVerificador({ secret, nowSeconds: () => 1793990000 });

  assert.equal(verifier.verificar({ ...input, timestamp: 'not-a-time', signature: 'a'.repeat(64) }).errorCode, 'invalid_timestamp');
  assert.equal(verifier.verificar({ ...input, nonce: 'short', signature: 'a'.repeat(64) }).errorCode, 'invalid_nonce');
  assert.equal(verifier.verificar({ ...input, signature: 'not-hex' }).errorCode, 'invalid_signature');
});
