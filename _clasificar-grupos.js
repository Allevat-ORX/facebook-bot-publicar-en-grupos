// Barrido: entra a cada grupo detectado y captura su NOMBRE, para clasificar SLP/QRO/otros.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const LISTA = JSON.parse(fs.readFileSync(path.join(__dirname, '_grupos-detectados.json'), 'utf8'));
const sleep = ms => new Promise(r=>setTimeout(r,ms));

function clasificar(nombre) {
  const n = (nombre||'').toLowerCase();
  const slp = /san luis|slp|potos|s\.l\.p|sanluis/.test(n);
  const qro = /quer[eé]taro|qro|quere/.test(n);
  // temática
  const maquinaria = /maquinaria|excavad|retro|construc|obra|renta de equipo|equipo pesado|cat|volteo|grua|montacarga/.test(n);
  const empleo = /empleo|trabajo|bolsa|vacante|rrhh|recursos humanos/.test(n);
  let ciudad = 'otro';
  if (slp && !qro) ciudad = 'SLP';
  else if (qro && !slp) ciudad = 'QRO';
  else if (slp && qro) ciudad = 'SLP+QRO';
  return { ciudad, maquinaria, empleo };
}

(async () => {
  const browser = await chromium.connectOverCDP('http://[::1]:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p=>p.url().includes('/groups')) || ctx.pages()[0];

  const resultados = [];
  let i = 0;
  for (const url of LISTA) {
    i++;
    try {
      await page.goto(url, { waitUntil:'domcontentloaded' });
      await sleep(2500);
      const nombre = await page.evaluate(() => {
        // el nombre del grupo suele estar en un h1 o en el título
        const h1 = document.querySelector('h1');
        if (h1 && h1.innerText.trim()) return h1.innerText.trim();
        // fallback: título de la pestaña sin "| Facebook"
        return document.title.replace(/\s*\|\s*Facebook.*/,'').replace(/^\(\d+\)\s*/,'').trim();
      });
      const cl = clasificar(nombre);
      resultados.push({ url, nombre, ...cl });
      console.log(`${i}/${LISTA.length} [${cl.ciudad}]${cl.maquinaria?' 🚜':''}${cl.empleo?' 💼':''}  ${nombre}`);
    } catch (e) {
      resultados.push({ url, nombre:'(error)', ciudad:'error', maquinaria:false, empleo:false });
      console.log(`${i}/${LISTA.length} [error] ${url} — ${e.message.split('\n')[0]}`);
    }
  }

  fs.writeFileSync(path.join(__dirname,'_grupos-clasificados.json'), JSON.stringify(resultados,null,2));
  // Resumen
  const por = c => resultados.filter(r=>r.ciudad===c).length;
  console.log('\n=== RESUMEN ===');
  console.log('SLP:', por('SLP'), '| QRO:', por('QRO'), '| SLP+QRO:', por('SLP+QRO'), '| otro:', por('otro'), '| error:', por('error'));
  console.log('con maquinaria:', resultados.filter(r=>r.maquinaria).length, '| de empleo:', resultados.filter(r=>r.empleo).length);
  console.log('Guardado en _grupos-clasificados.json');

  await browser.close();
})();
