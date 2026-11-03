// ============================================================
// TEST AUTOMATIZADO: SERVIDOR DE CAPTACIÓN & SONDEO
// ============================================================

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

process.env.PORT = '4598'; // Puerto alterno de test
process.env.MOCK_WORKER = 'true';
process.env.HEADLESS = 'true';

const { server, buscarGruposParaRegion } = require('./servidor_captacion');

function request(method, pathUrl, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: 4598,
      path: pathUrl,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let resBody = '';
      res.on('data', (c) => resBody += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(resBody) });
        } catch (_) {
          resolve({ status: res.statusCode, raw: resBody });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  console.log('🧪 Iniciando suite de pruebas de servidor_captacion.js...');

  try {
    // 1. Test selector de grupos por región
    console.log('1. Probando búsqueda de grupos por región...');
    const gruposSLP = buscarGruposParaRegion('San Luis Potosí', 3);
    assert(Array.isArray(gruposSLP) && gruposSLP.length > 0, 'Debe devolver grupos para SLP');
    console.log(`   ✓ Grupos SLP detectados: ${gruposSLP.length}`);

    const gruposHgo = buscarGruposParaRegion('Hidalgo (Pachuca)', 3);
    assert(Array.isArray(gruposHgo) && gruposHgo.length > 0, 'Debe devolver grupos para Hidalgo/fallback');
    console.log(`   ✓ Grupos Hidalgo detectados: ${gruposHgo.length}`);

    // 2. Test GET /health
    console.log('2. Probando GET /health...');
    const health = await request('GET', '/health');
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.data.status, 'ok');
    assert.strictEqual(health.data.service, 'onrentx-captacion-server');
    console.log('   ✓ Health check OK');

    // 3. Test POST /api/sondeo/dispatch
    console.log('3. Probando POST /api/sondeo/dispatch...');
    const payload = {
      lead_id: 9999,
      machine: 'Excavadora Cat 320',
      region: 'San Luis Potosí',
      duration: 20,
      need_operator: true,
      copy: '🚜 ONRENTX TEST - SE BUSCA EXCAVADORA 320 EN SLP',
      phone: '+524778023134',
      auto_start: true,
    };

    const dispatch = await request('POST', '/api/sondeo/dispatch', payload);
    assert.strictEqual(dispatch.status, 202);
    assert.strictEqual(dispatch.data.ok, true);
    assert.strictEqual(dispatch.data.lead_id, 9999);
    assert(dispatch.data.grupos_encolados > 0, 'Debe haber encolado al menos 1 grupo');
    console.log(`   ✓ Despacho encoló ${dispatch.data.grupos_encolados} grupos para Lead #9999`);

    // Esperar a que el mock worker procese
    console.log('4. Esperando ejecución de mock worker...');
    await new Promise((r) => setTimeout(r, 2500));

    // 5. Test GET /api/cola
    console.log('5. Verificando estado en GET /api/cola...');
    const colaRes = await request('GET', '/api/cola');
    assert.strictEqual(colaRes.status, 200);
    assert(colaRes.data.items.length > 0, 'La cola debe contener items');
    const itemLead = colaRes.data.items.find((i) => i.correlation_id === 'lead-9999');
    assert(itemLead, 'Debe existir el item para lead-9999');
    console.log(`   ✓ Item verificado en cola con estado: ${itemLead.estado}`);

    console.log('\n🎉 ¡TODAS LAS PRUEBAS DE SERVIDOR_CAPTACION PASARON SATISFACTORIAMENTE!\n');
  } catch (err) {
    console.error('❌ Error en pruebas:', err);
    process.exit(1);
  } finally {
    server.close();
    process.exit(0);
  }
})();
