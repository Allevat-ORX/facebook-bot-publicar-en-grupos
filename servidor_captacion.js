// ============================================================
// SERVIDOR DE CAPTACIÓN Y SONDEO OPERATIVO — ONRENTX (O2BF-1526)
// ------------------------------------------------------------
// Microservicio 24/7 para el servidor que recibe solicitudes de
// sondeo desde Odoo Pre-Bidding Wizard y las publica de forma
// autónoma en los Grupos de Facebook de Maquinaria seleccionados.
//
// Endpoints:
//   GET  /health              -> Estado del servicio y worker
//   GET  /                    -> UI de visor y aprobación visual
//   GET  /api/cola            -> Listado y resumen de la cola
//   POST /api/sondeo/dispatch -> Endpoint para Odoo Pre-Bidding
//   POST /api/worker/run      -> Disparo manual del worker
//   POST /api/item/:id        -> Aprobar/Rechazar items manualmente
//
// Uso:
//   node servidor_captacion.js
//   PORT=4599 HEADLESS=true MODO_ASISTIDO=false node servidor_captacion.js
// ============================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const cola = require('./cola');

const PORT = parseInt(process.env.PORT || '4599', 10);
const HEADLESS = String(process.env.HEADLESS ?? 'true').toLowerCase() !== 'false';
const MODO_ASISTIDO = String(process.env.MODO_ASISTIDO ?? 'false').toLowerCase() === 'true';
const MOCK_WORKER = String(process.env.MOCK_WORKER ?? 'false').toLowerCase() === 'true';
const LIMITE_TANDA = parseInt(process.env.LIMITE_TANDA || '5', 10);
const SESSION_PATH = process.env.FB_SESSION_DIR || path.join(__dirname, 'facebook-session');

let isWorkerBusy = false;
let workerStats = {
  lastRun: null,
  totalPublished: 0,
  totalErrors: 0,
  lastError: null,
};

function log(mensaje, tipo = 'INFO') {
  const linea = `[${new Date().toISOString()}] [${tipo}] [CaptacionServer] ${mensaje}`;
  console.log(linea);
  try {
    fs.appendFileSync(path.join(__dirname, 'log.txt'), linea + '\n');
  } catch (_) {}
}

function esperaHumana(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function enviarJSON(res, code, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function leerBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 2e6) req.destroy(); // Límite de 2MB
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// ------------------------------------------------------------
// SELECCIÓN INTELIGENTE DE GRUPOS POR REGIÓN
// ------------------------------------------------------------
function buscarGruposParaRegion(regionNombre = '', limite = LIMITE_TANDA) {
  const rutaClasificados = path.join(__dirname, '_grupos-clasificados.json');
  const rutaAmpliados = path.join(__dirname, 'grupos_ampliados_slp_qro.json');

  let catalogo = [];
  if (fs.existsSync(rutaClasificados)) {
    try {
      catalogo = JSON.parse(fs.readFileSync(rutaClasificados, 'utf8'));
    } catch (_) {}
  } else if (fs.existsSync(rutaAmpliados)) {
    try {
      catalogo = JSON.parse(fs.readFileSync(rutaAmpliados, 'utf8'));
    } catch (_) {}
  }

  const regNorm = (regionNombre || '').toLowerCase();
  let coincidentes = [];

  // Mapeos regionales a tags de grupos
  let tagBuscado = 'otro';
  if (regNorm.includes('san luis') || regNorm.includes('slp') || regNorm.includes('potos')) {
    tagBuscado = 'SLP';
  } else if (regNorm.includes('quer') || regNorm.includes('qro')) {
    tagBuscado = 'QRO';
  } else if (regNorm.includes('hidalgo') || regNorm.includes('pachuca')) {
    tagBuscado = 'hidalgo';
  } else if (regNorm.includes('guanajuato') || regNorm.includes('leon') || regNorm.includes('silao') || regNorm.includes('irapuato')) {
    tagBuscado = 'guanajuato';
  }

  // Filtrar grupos relevantes
  coincidentes = catalogo.filter((g) => {
    const nombre = (g.nombre || '').toLowerCase();
    const ciudad = (g.ciudad || '').toLowerCase();
    const esMaquinaria = g.maquinaria === true || nombre.includes('maquinaria') || nombre.includes('pesada') || nombre.includes('construc');
    const noEsEmpleo = g.empleo !== true;

    if (!esMaquinaria || !noEsEmpleo) return false;

    if (tagBuscado === 'SLP') {
      return ciudad === 'slp' || nombre.includes('potos') || nombre.includes('slp');
    }
    if (tagBuscado === 'QRO') {
      return ciudad === 'qro' || nombre.includes('quer') || nombre.includes('qro');
    }
    if (tagBuscado === 'hidalgo') {
      return nombre.includes('hidalgo') || nombre.includes('pachuca') || ciudad === 'otro';
    }
    return true;
  });

  // Fallback si hay pocos específicos: tomar grupos generales de maquinaria en México
  if (coincidentes.length < limite) {
    const generales = catalogo.filter((g) => {
      const nom = (g.nombre || '').toLowerCase();
      return nom.includes('maquinaria') && !coincidentes.some((c) => c.url === g.url);
    });
    coincidentes = coincidentes.concat(generales);
  }

  return coincidentes.slice(0, limite).map((g) => g.url).filter(Boolean);
}

// ------------------------------------------------------------
// PUBLICADOR PLAYWRIGHT
// ------------------------------------------------------------
async function publicarPostEnGrupo(page, grupoUrl, texto, opciones = {}) {
  log(`Iniciando publicación en: ${grupoUrl}`);
  await page.goto(grupoUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.mouse.wheel(0, esperaHumana(300, 700));
  await page.waitForTimeout(esperaHumana(2000, 4000));

  const textosCaja = [
    'Escriu alguna cosa', 'Escribe algo', 'Escribe algo...',
    '¿Qué estás pensando', 'Què estàs pensant', 'Write something', 'Crea una publicación',
  ];
  let modalAbierto = false;
  for (const t of textosCaja) {
    try {
      const el = page.getByText(t, { exact: false }).first();
      if (await el.isVisible({ timeout: 2500 }).catch(() => false)) {
        await el.click();
        log(`Modal abierto en ${grupoUrl} con selector: "${t}"`);
        modalAbierto = true;
        break;
      }
    } catch (_) {}
  }

  if (!modalAbierto) {
    throw new Error('No se localizó la caja de nueva publicación en el grupo');
  }

  await page.waitForTimeout(esperaHumana(4000, 7000));
  const dialog = page.getByRole('dialog').first();
  if (!await dialog.isVisible({ timeout: 6000 }).catch(() => false)) {
    throw new Error('No se abrió el cuadro de diálogo del post');
  }

  const editor = dialog.locator('[contenteditable="true"][role="textbox"], div[data-lexical-editor="true"], div[role="textbox"][contenteditable="true"], [contenteditable="true"]').first();
  if (!await editor.isVisible({ timeout: 5000 }).catch(() => false)) {
    throw new Error('No se encontró el editor de texto dentro del modal');
  }

  await editor.click();
  await page.waitForTimeout(600);
  await page.keyboard.insertText(texto);
  await page.waitForTimeout(1500);

  const textoOk = ((await editor.innerText()) || '').trim().length;
  if (textoOk < 10) {
    throw new Error('El texto no pudo ser insertado en el editor');
  }
  log(`Texto insertado correctamente (${textoOk} caracteres)`);

  await page.waitForTimeout(esperaHumana(3000, 5000));

  const botonesPublicar = ['Publicar', 'Publica', 'Post'];
  let publicado = false;
  for (const b of botonesPublicar) {
    try {
      const btn = dialog.getByRole('button', { name: b, exact: true }).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click();
        publicado = true;
        break;
      }
    } catch (_) {}
  }

  if (!publicado) {
    for (const b of botonesPublicar) {
      try {
        const btn = page.getByRole('button', { name: b, exact: true }).first();
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await btn.click();
          publicado = true;
          break;
        }
      } catch (_) {}
    }
  }

  if (!publicado) throw new Error('No se localizó el botón Publicar');
  log(`Publicación enviada exitosamente en ${grupoUrl} ✅`);

  // Intervalo de seguridad entre publicaciones (30 a 60 segundos)
  const pausa = esperaHumana(30000, 60000);
  log(`Pausa antispam de ${Math.round(pausa / 1000)}s antes de la siguiente acción`);
  await page.waitForTimeout(pausa);

  return { publicado: true, permalink: null };
}

// ------------------------------------------------------------
// WORKER DE EJECUCIÓN DE COLA
// ------------------------------------------------------------
async function ejecutarColaWorker() {
  if (isWorkerBusy) {
    log('Worker ya se encuentra en ejecución, omitiendo nuevo disparo concurrente');
    return { busy: true };
  }

  if (!cola.existeCola()) {
    log('No existe cola.json para procesar');
    return { procesados: 0 };
  }

  const dataCola = cola.leerCola();
  const pendientes = cola.itemsAprobados(dataCola);

  if (pendientes.length === 0) {
    log('No hay items con estado "aprobado" en la cola');
    return { procesados: 0 };
  }

  isWorkerBusy = true;
  workerStats.lastRun = new Date().toISOString();
  log(`Iniciando tanda de worker para ${pendientes.length} publicaciones aprobadas`);

  let context = null;
  let page = null;
  let exitosos = 0;
  let fallidos = 0;

  try {
    if (MOCK_WORKER) {
      log('⚙️ MODO MOCK ACTIVO: simulando publicaciones sin abrir navegador real');
      for (const item of pendientes) {
        log(`[MOCK] Publicando item ${item.id} en ${item.grupo}`);
        await new Promise((r) => setTimeout(r, 1000));
        cola.marcarItem(dataCola, item.id, 'publicado', { permalink: `https://facebook.com/groups/fake/${Date.now()}` });
        exitosos++;
      }
    } else {
      context = await chromium.launchPersistentContext(SESSION_PATH, {
        headless: HEADLESS,
        args: [
          '--disable-notifications',
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-setuid-sandbox',
        ],
        viewport: { width: 1280, height: 800 },
      });

      page = await context.newPage();

      for (const item of pendientes) {
        try {
          const { copy } = cola.elegirCopy(item);
          await publicarPostEnGrupo(page, item.grupo, copy, { imagen: item.imagen });
          cola.marcarItem(dataCola, item.id, 'publicado', {});
          exitosos++;
          workerStats.totalPublished++;
        } catch (err) {
          log(`Error al publicar item ${item.id} en ${item.grupo}: ${err.message}`, 'ERROR');
          cola.marcarItem(dataCola, item.id, 'error', { error: err.message });
          fallidos++;
          workerStats.totalErrors++;
          workerStats.lastError = err.message;

          try {
            if (page) {
              const capturaPath = path.join(__dirname, `error-${item.id}.png`);
              await page.screenshot({ path: capturaPath });
              log(`Captura de evidencia de error guardada en ${capturaPath}`);
            }
          } catch (_) {}
        }
      }
    }
  } catch (globalErr) {
    log(`Error fatal en ejecución del worker: ${globalErr.message}`, 'ERROR');
    workerStats.lastError = globalErr.message;
  } finally {
    if (context) {
      try {
        await context.close();
      } catch (_) {}
    }
    isWorkerBusy = false;
    log(`Worker finalizado. Resultados: ${exitosos} exitosos, ${fallidos} fallidos`);
  }

  return { procesados: exitosos + fallidos, exitosos, fallidos };
}

// ------------------------------------------------------------
// SERVIDOR HTTP NATIVO
// ------------------------------------------------------------
async function manejarPeticion(req, res, deps) {
  const { cola } = deps;

  // CORS para permitir llamadas desde portal Odoo o apps internas
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    // GET /health
    if (req.method === 'GET' && url.pathname === '/health') {
      enviarJSON(res, 200, {
        status: 'ok',
        service: 'onrentx-captacion-server',
        worker_busy: isWorkerBusy,
        uptime_seconds: Math.round(process.uptime()),
        stats: workerStats,
        headless: HEADLESS,
        mock_mode: MOCK_WORKER,
      });
      return;
    }

    // GET /api/cola
    if (req.method === 'GET' && url.pathname === '/api/cola') {
      if (!cola.existeCola()) {
        enviarJSON(res, 200, { version: 1, items: [], resumen: { total: 0 } });
        return;
      }
      const data = cola.leerCola();
      const resumen = {
        total: data.items.length,
        pendientes: data.items.filter((i) => i.estado === 'pendiente').length,
        aprobados: data.items.filter((i) => i.estado === 'aprobado').length,
        publicados: data.items.filter((i) => i.estado === 'publicado').length,
        errores: data.items.filter((i) => i.estado === 'error').length,
      };
      enviarJSON(res, 200, { ...data, resumen });
      return;
    }

    // POST /api/sondeo/dispatch (Llamado desde Odoo Pre-Bidding Wizard)
    if (req.method === 'POST' && url.pathname === '/api/sondeo/dispatch') {
      const raw = await leerBody(req);
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (_) {
        enviarJSON(res, 400, { error: 'Payload JSON inválido' });
        return;
      }

      const {
        lead_id,
        machine = 'Equipo de Construcción',
        region = 'Bajío',
        duration = 1,
        need_operator = false,
        copy = '',
        phone = '+524778023134',
        groups = [],
        auto_start = true,
      } = payload;

      if (!lead_id) {
        enviarJSON(res, 400, { error: 'El campo "lead_id" es obligatorio' });
        return;
      }

      // 1. Determinar grupos destino
      let gruposDestino = Array.isArray(groups) && groups.length > 0
        ? groups
        : buscarGruposParaRegion(region, LIMITE_TANDA);

      if (gruposDestino.length === 0) {
        // Fallback a grupos base
        const gruposBase = require('./grupos');
        gruposDestino = gruposBase.slice(0, LIMITE_TANDA);
      }

      // 2. Redactar copy si viene vacío
      const textoFinal = (copy || '').trim() || (
        `🚜 ONRENTX - BÚSQUEDA DE MAQUINARIA PESADA\n\n` +
        `Requerimiento activo en ${region}:\n` +
        `• Equipo: ${machine}\n` +
        `• Duración estimada: ${duration} días\n` +
        `• Operador: ${need_operator ? 'Con Operador requerido' : 'Máquina Seca'}\n` +
        `• Pago garantizado vía OnRentX.\n\n` +
        `📲 Si tienes equipo disponible en la zona, envía tu propuesta a WhatsApp: ${phone} o responde a este post.\n\n` +
        `👉 Únete a la red de propietarios en onrentx.com/demo`
      );

      // 3. Encolar los items en cola.json
      const itemsCreados = [];
      for (const grupoUrl of gruposDestino) {
        try {
          const item = cola.encolarItem({
            grupo: grupoUrl,
            tipo: 'texto',
            copies: [textoFinal],
            owner: 'odoo-prebidding',
            correlation_id: `lead-${lead_id}`,
            estado: 'aprobado',
          });
          itemsCreados.push(item);
        } catch (encErr) {
          log(`Aviso al encolar en ${grupoUrl}: ${encErr.message}`);
        }
      }

      log(`Sondeo para Lead #${lead_id} (${machine} en ${region}) encolado en ${itemsCreados.length} grupos`);

      // 4. Si auto_start está activo, ejecutar en background sin bloquear la respuesta
      if (auto_start && !isWorkerBusy) {
        setImmediate(() => {
          ejecutarColaWorker().catch((e) => log(`Error en background worker: ${e.message}`, 'ERROR'));
        });
      }

      enviarJSON(res, 202, {
        ok: true,
        message: 'Sondeo encolado exitosamente',
        lead_id,
        grupos_encolados: itemsCreados.length,
        items: itemsCreados.map((i) => ({ id: i.id, grupo: i.grupo })),
        worker_iniciado: auto_start && !isWorkerBusy,
      });
      return;
    }

    // POST /api/worker/run (Disparo manual)
    if (req.method === 'POST' && url.pathname === '/api/worker/run') {
      if (isWorkerBusy) {
        enviarJSON(res, 409, { error: 'Worker ya se encuentra en ejecución' });
        return;
      }
      setImmediate(() => {
        ejecutarColaWorker().catch((e) => log(`Error en worker disparado manualmente: ${e.message}`, 'ERROR'));
      });
      enviarJSON(res, 202, { ok: true, message: 'Worker iniciado en segundo plano' });
      return;
    }

    // GET / (Servir Visor HTML)
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/visor')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OnRentX — Captación & Sondeo en Servidor (O2BF-1526)</title>
<style>
  :root { --ok:#1a7f37; --no:#cf222e; --pend:#9a6700; --pub:#0969da; --bg:#0d1117; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin:0; background:#f6f8fa; color:#1f2328; }
  header { background:var(--bg); color:#fff; padding:16px 24px; display:flex; justify-content:space-between; align-items:center; }
  header h1 { font-size:18px; margin:0; display:flex; align-items:center; gap:8px; }
  .badge-server { background:#238636; font-size:12px; padding:2px 8px; border-radius:12px; }
  .wrap { max-width:1100px; margin:0 auto; padding:24px; }
  .stats-bar { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:12px; margin-bottom:24px; }
  .stat-card { background:#fff; border:1px solid #d0d7de; border-radius:8px; padding:16px; text-align:center; }
  .stat-num { font-size:26px; font-weight:700; margin-top:4px; color:#0969da; }
  .item { background:#fff; border:1px solid #d0d7de; border-radius:8px; padding:16px; margin-bottom:12px; }
  .item-header { display:flex; justify-content:space-between; margin-bottom:8px; }
  .badge { font-size:11px; padding:3px 8px; border-radius:12px; color:#fff; font-weight:600; text-transform:uppercase; }
  .badge.aprobado { background:var(--ok); }
  .badge.publicado { background:var(--pub); }
  .badge.pendiente { background:var(--pend); }
  .badge.error { background:var(--no); }
  .copy-box { background:#f6f8fa; border-left:4px solid #0969da; padding:10px 14px; font-size:13px; white-space:pre-wrap; border-radius:4px; margin-top:8px; }
  .btn-run { background:#1f883d; color:#fff; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-weight:600; }
  .btn-run:hover { background:#1a7f37; }
</style>
</head>
<body>
<header>
  <h1>🚜 OnRentX Captación Server <span class="badge-server">24/7 Autonómo</span></h1>
  <div>
    <button class="btn-run" onclick="runWorker()">⚡ Forzar Ejecución de Cola</button>
  </div>
</header>
<div class="wrap">
  <div class="stats-bar" id="stats">Cargando métricas...</div>
  <h3>Cola de Publicaciones de Sondeo</h3>
  <div id="items">Cargando cola...</div>
</div>
<script>
async function cargar() {
  try {
    const res = await fetch('/api/cola');
    const data = await res.json();
    const r = data.resumen || {};
    document.getElementById('stats').innerHTML = \`
      <div class="stat-card"><div>Total Items</div><div class="stat-num">\${r.total || 0}</div></div>
      <div class="stat-card"><div>Aprobados</div><div class="stat-num" style="color:var(--ok)">\${r.aprobados || 0}</div></div>
      <div class="stat-card"><div>Publicados</div><div class="stat-num" style="color:var(--pub)">\${r.publicados || 0}</div></div>
      <div class="stat-card"><div>Errores</div><div class="stat-num" style="color:var(--no)">\${r.errores || 0}</div></div>
    \`;
    const items = data.items || [];
    if (items.length === 0) {
      document.getElementById('items').innerHTML = '<p>No hay publicaciones en la cola.</p>';
      return;
    }
    document.getElementById('items').innerHTML = items.slice().reverse().map(it => \`
      <div class="item">
        <div class="item-header">
          <div><strong>\${it.id}</strong> — <span style="color:#57606a">\${it.grupo}</span></div>
          <span class="badge \${it.estado}">\${it.estado}</span>
        </div>
        <div style="font-size:12px; color:#57606a">Owner: \${it.owner} | Corr: \${it.correlation_id || 'N/A'}</div>
        <div class="copy-box">\${(it.copies && it.copies[0]) || ''}</div>
      </div>
    \`).join('');
  } catch(e) {
    console.error(e);
  }
}
async function runWorker() {
  if (!confirm('¿Deseas disparar el worker para publicar los items aprobados?')) return;
  const res = await fetch('/api/worker/run', { method: 'POST' });
  const data = await res.json();
  alert(data.message || 'Worker iniciado');
  cargar();
}
cargar();
setInterval(cargar, 10000);
</script>
</body>
</html>`);
      return;
    }

    enviarJSON(res, 404, { error: 'Ruta no encontrada' });
  } catch (err) {
    enviarJSON(res, 500, { error: err.message });
  }
}

function crearServidor(dependencies = {}) {
  const deps = {
    cola,
    now: () => Date.now(),
    ...dependencies,
  };

  return http.createServer(async (req, res) => {
    await manejarPeticion(req, res, deps);
  });
}

function iniciarServidor({ port = PORT, host = '0.0.0.0' } = {}) {
  const server = crearServidor();
  server.listen(port, host);
  return server;
}

if (require.main === module) {
  const server = iniciarServidor({ host: process.env.HOST });
  server.on('listening', () => {
    const address = server.address();
    log(`Servidor de captación escuchando en http://${address.address}:${address.port}`);
  });
}

module.exports = {
  crearServidor,
  iniciarServidor,
  buscarGruposParaRegion,
};
