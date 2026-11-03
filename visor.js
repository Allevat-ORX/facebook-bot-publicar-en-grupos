// ============================================================
// VISOR DE APROBACIÓN LOCAL — AIS-437
// ------------------------------------------------------------
// Servidor local mínimo (solo módulos nativos de Node, SIN dependencias nuevas)
// que sirve una página para revisar la cola de publicación y aprobar/rechazar
// items antes de que el bot los publique.
//
// Uso:
//   node visor.js            -> http://localhost:4599
//   PORT=5000 node visor.js  -> otro puerto
//
// Es LOCAL (localhost, sin infra externa). A futuro se integra al panel del
// router (AIS-424). El bot (index.js, MODO COLA) publica solo items "aprobado".
//
// Endpoints:
//   GET  /                 -> HTML del visor
//   GET  /api/cola         -> devuelve cola.json (o {version,items:[]} si no existe)
//   POST /api/item/:id     -> body {estado} -> marca el item y persiste
//   GET  /creativos/<img>  -> sirve imágenes locales (solo desde ./creativos)
// ============================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const cola = require('./cola');

const PORT = parseInt(process.env.PORT || '4599', 10);
const DIR_CREATIVOS = path.join(__dirname, 'creativos');

// Estados que el visor puede aplicar (solo decisiones humanas de aprobación).
const ESTADOS_VISOR = ['aprobado', 'rechazado', 'pendiente'];

function enviarJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

// Sirve una imagen de ./creativos con protección contra path traversal.
function servirCreativo(res, nombre) {
  const rel = decodeURIComponent(nombre);
  const destino = path.normalize(path.join(DIR_CREATIVOS, rel));
  // Seguridad: el destino debe quedar DENTRO de ./creativos.
  if (!destino.startsWith(DIR_CREATIVOS + path.sep) && destino !== DIR_CREATIVOS) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  if (!fs.existsSync(destino) || !fs.statSync(destino).isFile()) {
    res.writeHead(404); res.end('not found'); return;
  }
  const ext = path.extname(destino).toLowerCase();
  const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(destino).pipe(res);
}

function leerBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    // ---- GET / : la página del visor ----
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HTML);
      return;
    }

    // ---- GET /api/cola : estado actual de la cola ----
    if (req.method === 'GET' && url.pathname === '/api/cola') {
      if (!cola.existeCola()) { enviarJSON(res, 200, { version: 1, items: [] }); return; }
      const data = cola.leerCola();
      const val = cola.validarCola(data);
      enviarJSON(res, 200, { ...data, _validacion: val });
      return;
    }

    // ---- POST /api/enqueue : Dify -> cola (AIS-438) ----
    // Body JSON: { grupo, tipo, copies[]|copy, imagen?, link_marketplace?, correlation_id?, owner?, estado? }
    // Crea un item (estado inicial "pendiente" salvo que se indique) y persiste.
    if (req.method === 'POST' && url.pathname === '/api/enqueue') {
      const body = await leerBody(req);
      let entrada;
      try { entrada = JSON.parse(body); } catch { enviarJSON(res, 400, { error: 'body JSON inválido' }); return; }
      try {
        const item = cola.encolarItem(entrada);
        enviarJSON(res, 201, { ok: true, item });
      } catch (e) {
        enviarJSON(res, 400, { error: e.message });
      }
      return;
    }

    // ---- POST /api/item/:id : cambiar estado (aprobar/rechazar/pendiente) ----
    if (req.method === 'POST' && url.pathname.startsWith('/api/item/')) {
      if (!cola.existeCola()) { enviarJSON(res, 404, { error: 'no existe cola.json' }); return; }
      const id = decodeURIComponent(url.pathname.replace('/api/item/', ''));
      const body = await leerBody(req);
      let estado;
      try { estado = JSON.parse(body).estado; } catch { enviarJSON(res, 400, { error: 'body inválido' }); return; }
      if (!ESTADOS_VISOR.includes(estado)) { enviarJSON(res, 400, { error: `estado debe ser ${ESTADOS_VISOR.join('|')}` }); return; }
      const data = cola.leerCola();
      try {
        const item = cola.marcarItem(data, id, estado, {});
        enviarJSON(res, 200, { ok: true, item });
      } catch (e) {
        enviarJSON(res, 404, { error: e.message });
      }
      return;
    }

    // ---- GET /creativos/<img> ----
    if (req.method === 'GET' && url.pathname.startsWith('/creativos/')) {
      servirCreativo(res, url.pathname.replace('/creativos/', ''));
      return;
    }

    res.writeHead(404); res.end('not found');
  } catch (e) {
    enviarJSON(res, 500, { error: e.message });
  }
});

// HTML del visor (embebido para que sea un solo archivo, sin build).
const HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Visor de aprobación — OnRentX (AIS-437)</title>
<style>
  :root { --ok:#1a7f37; --no:#cf222e; --pend:#9a6700; --pub:#0969da; --err:#82071e; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin:0; background:#f6f8fa; color:#1f2328; }
  header { background:#0d1117; color:#fff; padding:16px 24px; display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
  header h1 { font-size:18px; margin:0; }
  header .meta { font-size:13px; opacity:.8; }
  .wrap { max-width:1100px; margin:0 auto; padding:24px; }
  .filtros { display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap; }
  .filtros button { border:1px solid #d0d7de; background:#fff; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:13px; }
  .filtros button.activo { background:#0969da; color:#fff; border-color:#0969da; }
  .item { background:#fff; border:1px solid #d0d7de; border-radius:10px; padding:16px; margin-bottom:14px; }
  .item .top { display:flex; justify-content:space-between; gap:12px; align-items:center; flex-wrap:wrap; }
  .badge { font-size:12px; padding:2px 8px; border-radius:999px; color:#fff; text-transform:uppercase; letter-spacing:.03em; }
  .badge.pendiente{background:var(--pend)} .badge.aprobado{background:var(--ok)} .badge.rechazado{background:var(--no)}
  .badge.publicado{background:var(--pub)} .badge.error{background:var(--err)}
  .tipo { font-size:12px; color:#57606a; border:1px solid #d0d7de; border-radius:6px; padding:2px 8px; }
  .grupo { font-size:12px; color:#57606a; word-break:break-all; }
  .copies { margin:12px 0; }
  .copy { background:#f6f8fa; border-left:3px solid #0969da; padding:8px 12px; border-radius:4px; white-space:pre-wrap; font-size:14px; margin-bottom:6px; }
  .media img { max-width:280px; max-height:200px; border-radius:8px; border:1px solid #d0d7de; }
  .media a { color:#0969da; word-break:break-all; }
  .acciones { display:flex; gap:8px; margin-top:12px; }
  .acciones button { border:0; padding:8px 16px; border-radius:6px; cursor:pointer; font-size:14px; color:#fff; }
  .btn-ok{background:var(--ok)} .btn-no{background:var(--no)} .btn-pend{background:#57606a}
  .acciones button:disabled { opacity:.4; cursor:default; }
  .vacio { text-align:center; color:#57606a; padding:60px 0; }
  .aviso { background:#fff8c5; border:1px solid #d4a72c; border-radius:8px; padding:10px 14px; margin-bottom:16px; font-size:13px; }
  .log { font-size:11px; color:#8b949e; margin-top:8px; }
</style>
</head>
<body>
<header>
  <h1>🗂️ Visor de aprobación — OnRentX</h1>
  <span class="meta" id="meta">cargando…</span>
</header>
<div class="wrap">
  <div id="aviso"></div>
  <div class="filtros" id="filtros"></div>
  <div id="lista"></div>
</div>
<script>
let cola = { items: [] };
let filtro = 'todos';
const ESTADOS = ['pendiente','aprobado','rechazado','publicado','error'];

async function cargar() {
  const r = await fetch('/api/cola');
  cola = await r.json();
  render();
}

function contar(estado) { return cola.items.filter(i => i.estado === estado).length; }

function render() {
  document.getElementById('meta').textContent =
    cola.items.length + ' items · ' + contar('aprobado') + ' aprobados · ' + contar('pendiente') + ' pendientes';

  // Aviso de validación
  const av = document.getElementById('aviso');
  if (cola._validacion && !cola._validacion.ok) {
    av.innerHTML = '<div class="aviso">⚠️ La cola tiene errores de validación:<br>' +
      cola._validacion.errores.map(e => '• ' + e).join('<br>') + '</div>';
  } else { av.innerHTML = ''; }

  // Filtros
  const fdiv = document.getElementById('filtros');
  const opciones = ['todos', ...ESTADOS];
  fdiv.innerHTML = opciones.map(o =>
    '<button class="' + (filtro===o?'activo':'') + '" onclick="setFiltro(\\'' + o + '\\')">' +
    o + (o==='todos' ? ' ('+cola.items.length+')' : ' ('+contar(o)+')') + '</button>'
  ).join('');

  // Lista
  const items = filtro==='todos' ? cola.items : cola.items.filter(i => i.estado===filtro);
  const lista = document.getElementById('lista');
  if (items.length === 0) { lista.innerHTML = '<div class="vacio">No hay items en este filtro.</div>'; return; }

  lista.innerHTML = items.map(it => {
    const media = it.tipo==='imagen' && it.imagen
      ? '<div class="media"><img src="/'+it.imagen+'" alt="creativo" onerror="this.replaceWith(document.createTextNode(\\'[imagen no encontrada: '+it.imagen+']\\'))"></div>'
      : it.tipo==='link' && it.link_marketplace
      ? '<div class="media">🔗 <a href="'+it.link_marketplace+'" target="_blank" rel="noopener">'+it.link_marketplace+'</a><br><small>FB generará el mosaico de fotos automático.</small></div>'
      : '';
    const copies = (it.copies||[]).map((c,i) => '<div class="copy"><b>#'+(i+1)+'</b> '+escapar(c)+'</div>').join('');
    const yaDecidido = it.estado==='publicado' || it.estado==='error';
    const logHtml = (it.log&&it.log.length) ? '<div class="log">'+it.log.map(escapar).join('<br>')+'</div>' : '';
    return '<div class="item">' +
      '<div class="top"><div><span class="badge '+it.estado+'">'+it.estado+'</span> ' +
      '<span class="tipo">'+it.tipo+'</span></div><code>'+escapar(it.id)+'</code></div>' +
      '<div class="grupo">'+escapar(it.grupo||'')+'</div>' +
      '<div class="copies">'+copies+'</div>' + media +
      '<div class="acciones">' +
      '<button class="btn-ok" '+(yaDecidido?'disabled':'')+' onclick="decidir(\\''+it.id+'\\',\\'aprobado\\')">✓ Aprobar</button>' +
      '<button class="btn-no" '+(yaDecidido?'disabled':'')+' onclick="decidir(\\''+it.id+'\\',\\'rechazado\\')">✗ Rechazar</button>' +
      '<button class="btn-pend" '+(yaDecidido?'disabled':'')+' onclick="decidir(\\''+it.id+'\\',\\'pendiente\\')">↺ Pendiente</button>' +
      '</div>' + logHtml + '</div>';
  }).join('');
}

function escapar(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function setFiltro(f){ filtro=f; render(); }

async function decidir(id, estado){
  const r = await fetch('/api/item/'+encodeURIComponent(id), {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({estado})
  });
  if (!r.ok){ const e = await r.json().catch(()=>({})); alert('Error: '+(e.error||r.status)); return; }
  await cargar();
}

cargar();
setInterval(cargar, 15000); // refresco suave por si el bot cambia estados
</script>
</body>
</html>`;

server.listen(PORT, () => {
  console.log(`Visor de aprobación en http://localhost:${PORT}`);
  console.log(`Cola: ${cola.RUTA_COLA}`);
  if (!cola.existeCola()) console.log('(aún no existe cola.json — crea uno a partir de cola.ejemplo.json)');
});
