const crypto = require('node:crypto');

function sha256Body(rawBody) {
  return crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex');
}

function crearCadenaCanonica({ timestamp, nonce, method, pathname, rawBody }) {
  return [timestamp, nonce, method.toUpperCase(), pathname, sha256Body(rawBody)].join('\n');
}

function calcularFirma(secret, canonical) {
  return crypto.createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
}

function crearVerificador({ secret, maxSkewSeconds = 300, nowSeconds = () => Math.floor(Date.now() / 1000) }) {
  const nonces = new Map();

  function verificar({ timestamp, nonce, method, pathname, rawBody, signature }) {
    if (!timestamp || !nonce || !signature) return { ok: false, status: 401, errorCode: 'missing_signature' };
    if (!/^\d{10}$/.test(timestamp)) return { ok: false, status: 401, errorCode: 'invalid_timestamp' };
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) return { ok: false, status: 401, errorCode: 'invalid_nonce' };
    if (!/^[a-f0-9]{64}$/.test(signature)) return { ok: false, status: 401, errorCode: 'invalid_signature' };

    const now = nowSeconds();
    const sentAt = Number(timestamp);
    for (const [value, expiresAt] of nonces.entries()) {
      if (expiresAt < now) nonces.delete(value);
    }
    if (Math.abs(now - sentAt) > maxSkewSeconds) return { ok: false, status: 401, errorCode: 'timestamp_expired' };
    if (nonces.has(nonce)) return { ok: false, status: 409, errorCode: 'replay_detected' };

    const expected = Buffer.from(calcularFirma(secret, crearCadenaCanonica({ timestamp, nonce, method, pathname, rawBody })), 'hex');
    const actual = Buffer.from(signature, 'hex');
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      return { ok: false, status: 401, errorCode: 'invalid_signature' };
    }
    nonces.set(nonce, now + maxSkewSeconds);
    return { ok: true, status: 200, errorCode: null };
  }

  return { verificar };
}

module.exports = { sha256Body, crearCadenaCanonica, calcularFirma, crearVerificador };
