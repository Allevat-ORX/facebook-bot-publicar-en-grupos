// Recolector vía CDP: se CONECTA al navegador ya abierto (no lo lanza ni cierra).
// Reusa la sesión de OnRentX que Aleix ya inició. Extrae los grupos y actualiza grupos.js.
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  // Conecta al Chrome que ya está corriendo con --remote-debugging-port=9222 (IPv6).
  const browser = await chromium.connectOverCDP('http://[::1]:9222');
  const contexts = browser.contexts();
  const context = contexts[0];
  const pages = context.pages();

  // Busca la pestaña de grupos ya abierta; si no, usa la primera.
  let page = pages.find(p => p.url().includes('/groups')) || pages[0];
  console.log('Trabajando sobre pestaña:', page.url());

  // Ir a la lista de grupos a los que perteneces (ordenados por "yo me uní").
  await page.goto('https://www.facebook.com/groups/joins/?nav_source=tab&ordering=viewer_added', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  console.log('URL tras navegar:', page.url());

  const urls = new Set();
  let iguales = 0;

  while (true) {
    // Extrae hrefs de grupos con VARIOS selectores (multi-idioma / cambios de FB).
    const nuevas = await page.evaluate(() => {
      const set = new Set();
      // 1) enlaces directos a /groups/<id> dentro del listado
      document.querySelectorAll('a[href*="/groups/"]').forEach(a => {
        const m = a.href.match(/https:\/\/www\.facebook\.com\/groups\/[^/?#]+/);
        if (m) {
          // descarta rutas de sistema (joins, feed, discover, create, etc.)
          const slug = m[0].split('/groups/')[1];
          if (!/^(joins|feed|discover|create|category|search)$/.test(slug)) set.add(m[0] + '/');
        }
      });
      return Array.from(set);
    });

    const antes = urls.size;
    nuevas.forEach(u => urls.add(u));
    console.log(`Grupos encontrados: ${urls.size}`);

    if (urls.size === antes) {
      iguales++;
      if (iguales >= 4) break;
    } else {
      iguales = 0;
    }
    await page.evaluate(() => window.scrollBy(0, 1500));
    await page.waitForTimeout(2000);
  }

  const lista = Array.from(urls);
  console.log(`TOTAL grupos recolectados: ${lista.length}`);
  lista.forEach(u => console.log('  ', u));

  // Guarda una lista cruda para revisar (NO sobreescribe grupos.js todavía).
  fs.writeFileSync('_grupos-detectados.json', JSON.stringify(lista, null, 2));
  console.log('Guardado en _grupos-detectados.json');

  // Importante: NO cerramos el browser (es el de Aleix). Solo desconectamos.
  await browser.close(); // con connectOverCDP, close() solo desconecta, no mata el navegador
})();
