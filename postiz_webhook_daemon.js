const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8099;
const COLA_PATH = path.resolve(__dirname, 'cola.json');
const RUNNER_PATH = path.resolve(__dirname, 'ejecutar_tanda_servidor.sh');
const CATALOGO_PATH = path.resolve(__dirname, '_grupos-clasificados.json');

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/publish-task') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const { postId, message, media, selected_groups } = payload;

        console.log(`[DAEMON] 📥 Recibida tarea de Postiz: PostId=${postId}, Grupos=${(selected_groups || []).length}`);

        if (!selected_groups || selected_groups.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'No se seleccionaron grupos' }));
        }

        let colaData = { items: [] };
        if (fs.existsSync(COLA_PATH)) {
          colaData = JSON.parse(fs.readFileSync(COLA_PATH, 'utf8'));
        }

        const now = Date.now();
        const nuevosItems = [];

        for (let i = 0; i < selected_groups.length; i++) {
          const url = selected_groups[i];
          const itemId = `arturo-postiz-${now}-${i + 1}`;
          let catalogo = [];
          try {
            if (fs.existsSync(CATALOGO_PATH)) catalogo = JSON.parse(fs.readFileSync(CATALOGO_PATH, 'utf8'));
          } catch(e) {}
          const gidMatch = url.match(/groups\/([0-9a-zA-Z._-]+)/);
          const gid = gidMatch ? gidMatch[1] : '';
          const info = catalogo.find(g => (g.url && g.url.includes(gid)) || (g.id && g.id === gid));

          const nuevoItem = {
            id: itemId,
            grupo: url,
            estado: 'aprobado',
            copies: [message || ''],
            imagen: (media && media.length > 0) ? media[0] : null,
            _grupo_nombre: info ? info.nombre : 'Grupo FB',
            _ciudad: info ? info.ciudad : 'SLP',
            _campaña: 'postiz_hub',
            _fecha_creacion: new Date().toISOString(),
            _postiz_post_id: postId
          };
          nuevosItems.push(nuevoItem);
        }

        // Agregar los nuevos items al principio de la cola de aprobados
        colaData.items = [...nuevosItems, ...colaData.items];
        fs.writeFileSync(COLA_PATH, JSON.stringify(colaData, null, 2), 'utf8');

        console.log(`[DAEMON] ✅ ${nuevosItems.length} grupos agregados a la cola como 'aprobado'.`);

        // Disparar runner en background
        const child = spawn('bash', [RUNNER_PATH], {
          detached: true,
          stdio: 'ignore'
        });
        child.unref();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, enqueued: nuevosItems.length }));
      } catch (err) {
        console.error('[DAEMON] ❌ Error procesando payload:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'daemon-running' }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[DAEMON] 🚀 Worker Daemon escuchando en http://127.0.0.1:${PORT}`);
});
