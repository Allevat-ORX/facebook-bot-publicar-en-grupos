const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const cola = require('./cola');

const LIMITE_TANDA = 3;

function esperaHumana(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

(async () => {
  console.log("==================================================");
  console.log("🚀 LANZANDO TANDA COMERCIAL ARTURO SILVA (5 POSTS)");
  console.log("==================================================");

  const sessionPath = path.resolve(__dirname, 'sessions/session-aleix');
  const context = await chromium.launchPersistentContext(sessionPath, {
    headless: process.env.HEADLESS === 'false' ? false : true,
    viewport: { width: 1366, height: 768 },
    args: ['--disable-notifications', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  const page = await context.newPage();

  // 1. Asegurar switch formal a Arturo Silva
  console.log("[1/3] Asegurando contexto de Arturo Silva...");
  try {
    await page.goto("https://www.facebook.com/profile.php?id=61594919884581", { waitUntil: "domcontentloaded", timeout: 35000 });
    await page.waitForTimeout(4000);

    const switchBtn = page.locator('div[aria-label*="Canvia a Arturo"], div[aria-label*="Cambiar a Arturo"], div[aria-label*="Canvia"], div[aria-label*="Cambiar"]').first();
    if (await switchBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      console.log("Ejecutando switch a Arturo Silva...");
      await switchBtn.click();
      await page.waitForTimeout(6000);
    }
  } catch (navErr) {
    console.log("Aviso en verificación de perfil (continuando):", navErr.message);
  }

  // 2. Leer cola
  const data = cola.leerCola();
  const pendientes = cola.itemsAprobados(data);
  const tanda = pendientes.slice(0, LIMITE_TANDA);

  console.log(`[2/3] Procesando ${tanda.length} grupos de la cola...`);

  for (let i = 0; i < tanda.length; i++) {
    const item = tanda[i];
    const desktopUrl = item.grupo.replace('https://m.facebook.com', 'https://www.facebook.com');
    console.log(`\n--- [${i+1}/${tanda.length}] Publicando en: ${item._grupo_nombre} (${desktopUrl}) ---`);
    console.log(`Campaña: ${item._campaña} | Imagen: ${item.imagen}`);

    try {
      await page.goto(desktopUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(5000);

      // Buscar caja de escribir
      const writeBox = page.locator('div[role="button"]:has-text("Escriu alguna cosa"), div[role="button"]:has-text("Escribe algo"), span:has-text("Escribe algo..."), span:has-text("Escriu alguna cosa...")').first();
      const altWriteBtn = page.locator('div[role="button"]:has-text("Escriu"), div[role="button"]:has-text("Escribe")').first();

      let box = writeBox;
      if (!await writeBox.isVisible({ timeout: 4000 }).catch(() => false)) {
        if (await altWriteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          box = altWriteBtn;
        } else {
          throw new Error("No se encontró la caja de inicio de post (membresía no activa o requiere aprobación)");
        }
      }

      await box.click({ force: true });
      await page.waitForTimeout(4000);

      const dialog = page.getByRole('dialog').first();
      if (!await dialog.isVisible({ timeout: 5000 }).catch(() => false)) {
        throw new Error("No se abrió el cuadro de diálogo de publicación");
      }

      // Adjuntar imagen si existe
      if (item.imagen) {
        let rutaImg = item.imagen;
        if (item.imagen.startsWith('http://') || item.imagen.startsWith('https://')) {
          const tempPath = '/tmp/fb_upload_' + Date.now() + '.jpg';
          console.log('Descargando imagen remota desde Postiz a:', tempPath);
          const res = await fetch(item.imagen);
          const buf = await res.arrayBuffer();
          fs.writeFileSync(tempPath, Buffer.from(buf));
          rutaImg = tempPath;
        } else {
          rutaImg = path.resolve(__dirname, item.imagen);
        }
        const photoBtn = dialog.locator('div[aria-label="Afegeix una foto o un vídeo"], div[aria-label="Añadir foto o vídeo"], div[aria-label="Foto/vídeo"], div[aria-label="Foto/video"]').first();
        if (await photoBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await photoBtn.click({ force: true });
          await page.waitForTimeout(2000);
        }

        const attachBox = dialog.locator('div[aria-label*="Afegiu-hi fotos"], div[aria-label*="Añadir fotos"]').first();
        if (await attachBox.isVisible({ timeout: 3000 }).catch(() => false)) {
          const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 10000 }),
            attachBox.click()
          ]);
          await fileChooser.setFiles([rutaImg]);
        } else {
          const inputFile = dialog.locator('input[type="file"]').first();
          await inputFile.setInputFiles(rutaImg);
        }
        console.log("Imagen adjuntada, esperando renderizado de preview...");
        await page.waitForTimeout(8000);
      }

      // Escribir texto
      const editor = dialog.locator('[contenteditable="true"][role="textbox"]').first();
      if (!await editor.isVisible({ timeout: 5000 }).catch(() => false)) {
        throw new Error("No se encontró el editor de texto en el modal");
      }

      await editor.click();
      await page.keyboard.insertText(item.copies[0]);
      await page.waitForTimeout(2000);

      // Botón Publicar exacto
      const submitBtn = dialog.locator('div[aria-label="Publica"][role="button"], div[aria-label="Publicar"][role="button"]').last();
      if (!await submitBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
        throw new Error("No se encontró el botón de Publicar");
      }

      const isDisabled = await submitBtn.getAttribute('aria-disabled');
      if (isDisabled === "true") {
        throw new Error("El botón Publicar está deshabilitado");
      }

      await submitBtn.click({ force: true });
      console.log("✅ Clic en Publicar enviado. Esperando confirmación de red...");
      await page.waitForTimeout(10000);

      // Guardar captura de evidencia
      const ssPath = `evidencia_${item.id}.png`;
      await page.screenshot({ path: ssPath });
      console.log(`📸 Evidencia guardada: ${ssPath}`);

      cola.marcarItem(data, item.id, 'publicado', { permalink: null });
      console.log(`✅ [EXITO] Item ${item.id} publicado en ${item._grupo_nombre}`);

      if (i < tanda.length - 1) {
        const pausa = esperaHumana(45000, 65000);
        console.log(`Pausa anti-spam de seguridad: ${Math.round(pausa/1000)}s...`);
        await page.waitForTimeout(pausa);
      }
    } catch (err) {
      console.error(`❌ Error en ${item._grupo_nombre}:`, err.message);
      cola.marcarItem(data, item.id, 'error', { error: err.message });
    }
  }

  await context.close();
  console.log("\n[3/3] Tanda completada.");
})();
