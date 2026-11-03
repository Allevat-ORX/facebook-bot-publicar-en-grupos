const { chromium } = require('playwright'); // Importa el navegador Chromium de Playwright
const fs = require('fs'); // Importa el módulo de sistema de archivos de Node.js para escribir el log.txt
const path = require('path');

const grupos = require('./grupos'); // Lista de grupos (fallback: "modo lista")
const { obtenerTextoAleatorio, variantes } = require('./texto'); // Variantes de copy (selección ALEATORIA anti-repetición)
const cola = require('./cola'); // Contrato de cola Dify↔bot↔router (AIS-424 / AIS-436)

// MODO ASISTIDO: si está activo, el bot PREPARA el post (pega el texto) pero
// NO pulsa "Publicar" — deja el clic final al humano (reduce riesgo de baneo).
// Activado por defecto; poner MODO_ASISTIDO=false para full-automático.
const MODO_ASISTIDO = String(process.env.MODO_ASISTIDO ?? 'true').toLowerCase() !== 'false';

// Límite de grupos/items por ejecución (tanda). Por defecto 5 para el arranque seguro.
const LIMITE_TANDA = parseInt(process.env.LIMITE_TANDA || '5', 10);

// Genera un número aleatorio entre min y max para simular comportamiento humano
function esperaHumana(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Registra mensajes en consola y en el archivo log.txt con fecha/hora y tipo (INFO o ERROR)
function log(mensaje, tipo = 'INFO') {
    const linea = `[${new Date().toISOString()}] [${tipo}] ${mensaje}`; // Formato: [fecha] [tipo] mensaje
    console.log(linea);                         // Muestra en consola
    fs.appendFileSync('log.txt', linea + '\n'); // Agrega la línea al archivo log.txt sin borrar lo anterior
}

// Lee el progreso desde progreso.json para saber desde qué grupo continuar (modo lista)
function leerProgreso() {
    const data = fs.readFileSync('progreso.json', 'utf8'); // Lee el archivo como texto
    return JSON.parse(data).ultimo; // Retorna el número del último grupo publicado
}

// Guarda el progreso actual en progreso.json (modo lista)
function guardarProgreso(ultimo) {
    fs.writeFileSync('progreso.json', JSON.stringify({ ultimo }, null, 2)); // Sobreescribe el archivo con el nuevo valor
}

// Espera confirmación humana por consola (ENTER) — usada en MODO_ASISTIDO.
async function esperarHumanoEnter() {
    await new Promise((resolve) => {
        process.stdin.resume();
        process.stdin.once('data', () => { process.stdin.pause(); resolve(); });
    });
}

// ------------------------------------------------------------
// PUBLICAR UN POST en un grupo. Reutilizable por ambos modos.
// - page: página de Playwright
// - grupo: URL del grupo
// - texto: copy a pegar
// - opciones: { imagen: rutaLocal|null, linkMarketplace: URL|null }
// Devuelve { publicado: bool, permalink: string|null } (permalink queda null:
// la captura del permalink real se aborda en una iteración posterior).
// ------------------------------------------------------------
async function publicarPost(page, grupo, texto, opciones = {}) {
    const { imagen = null } = opciones;

    // Navega al grupo
    await page.goto(grupo);
    log('Grupo abierto');

    // Simula scroll humano con una distancia aleatoria entre 300 y 900 píxeles
    await page.mouse.wheel(0, esperaHumana(300, 900));
    await page.waitForTimeout(esperaHumana(1500, 3000));

    // Abre el modal de nueva publicación. Multi-idioma: la cuenta puede estar en
    // catalán, español o inglés, así que probamos varios textos de la caja.
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
                log(`Modal de publicación abierto (caja: "${t}")`);
                modalAbierto = true;
                break;
            }
        } catch (_) {}
    }
    if (!modalAbierto) {
        throw new Error('No se encontró la caja de publicar (revisa idioma o si la cuenta puede publicar en el grupo)');
    }

    // Espera a que el modal cargue del todo
    await page.waitForTimeout(esperaHumana(5000, 9000));

    // ORDEN CORRECTO: primero IMAGEN (si hay), luego TEXTO en el dialog.
    const dialog = page.getByRole('dialog').first();
    if (!await dialog.isVisible({ timeout: 5000 }).catch(() => false)) {
        throw new Error('No se abrió el cuadro de diálogo de publicación');
    }

    if (imagen) {
        const rutaImg = path.isAbsolute(imagen) ? imagen : path.join(__dirname, imagen);
        try {
            const inputFile = dialog.locator('input[type="file"]').last();
            await inputFile.setInputFiles(rutaImg);
            log(`Imagen adjuntada: ${imagen}`);
            await page.waitForTimeout(esperaHumana(7000, 12000)); // subida + preview
        } catch (e) {
            log(`No se pudo adjuntar la imagen "${imagen}": ${e.message}`, 'ERROR');
        }
    }

    // Pegar el texto en el EDITOR DEL DIALOG (garantizado que no es el comentario del feed)
    const editor = dialog.locator('[contenteditable="true"][role="textbox"], div[data-lexical-editor="true"], div[role="textbox"][contenteditable="true"], [contenteditable="true"]').first();
    if (!await editor.isVisible({ timeout: 5000 }).catch(() => false)) {
        throw new Error('No se encontró el editor de texto dentro del modal');
    }

    await editor.click();
    await page.waitForTimeout(500);
    await page.keyboard.insertText(texto);
    await page.waitForTimeout(1500);

    // Verifica que el copy entró en el editor del post
    const textoOk = ((await editor.innerText()) || '').trim().length;
    if (textoOk > 20) {
        log(`Texto pegado (${textoOk} caracteres en el editor del post)`);
    } else {
        log('⚠️ El editor del post parece vacío tras pegar; revisa antes de publicar', 'ERROR');
    }

    // Espera final para que FB termine de generar la previsualización
    await page.waitForTimeout(esperaHumana(3000, 6000));

    if (MODO_ASISTIDO) {
        // MODO ASISTIDO: NO se pulsa "Publicar". El post (imagen + texto en UNA sola
        // publicación) queda preparado y el HUMANO da el clic final.
        log(`⏸️  POST PREPARADO en ${grupo} (imagen + texto en un solo post) — REVISA y pulsa "Publicar" tú mismo.`);
        log('   Cuando publiques (o decidas saltar), vuelve a la terminal y pulsa ENTER para continuar.');
        await esperarHumanoEnter();
        log(`Continuando tras revisión humana de ${grupo}`);
        return { publicado: true, permalink: null };
    }

    // Captura de pantalla de verificación justo antes de pulsar Publicar
    try {
        await page.screenshot({ path: 'captura-pre-publicacion.png' });
    } catch (_) {}

    // MODO AUTOMATICO: pulsa "Publicar"/"Publica" (multi-idioma) dentro del dialog.
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
    if (!publicado) throw new Error('No se encontró el botón Publicar/Publica');
    log(`Publicación enviada en ${grupo} ✅`);
    // Pausa humana extendida entre grupos para seguridad antispam (45 a 75 segundos)
    const esperaEntreGrupos = esperaHumana(45000, 75000);
    log(`Esperando ${Math.round(esperaEntreGrupos / 1000)}s antes del siguiente grupo...`);
    await page.waitForTimeout(esperaEntreGrupos);
    return { publicado: true, permalink: null };
}

// Elimina un grupo incompatible (marketplace) de grupos.js — solo aplica al modo lista.
function eliminarGrupoIncompatible(grupo) {
    const listaActual = require('./grupos');
    const listaFiltrada = listaActual.filter((g) => g !== grupo);
    const contenido = `// Lista de grupos generada automáticamente por recolector.js
// Total: ${listaFiltrada.length} grupos

const grupos = [
${listaFiltrada.map((url) => `    '${url}',`).join('\n')}
];

module.exports = grupos;
`;
    fs.writeFileSync('grupos.js', contenido);
    log(`Grupo eliminado, quedan ${listaFiltrada.length} grupos`);
}

// ------------------------------------------------------------
// MODO COLA: publica items con estado "aprobado" de cola.json.
// Marca cada item como "publicado" (+permalink) o "error" y persiste.
// ------------------------------------------------------------
async function ejecutarModoCola(page) {
    const data = cola.leerCola();

    // Valida el contrato antes de tocar el navegador.
    const val = cola.validarCola(data);
    if (!val.ok) {
        log('cola.json tiene errores de validación:', 'ERROR');
        val.errores.forEach((e) => log(`  - ${e}`, 'ERROR'));
        throw new Error('cola.json inválida: corrige los items antes de publicar');
    }

    const aprobados = cola.itemsAprobados(data);
    if (aprobados.length === 0) {
        log('No hay items en estado "aprobado" para publicar. Nada que hacer.');
        return;
    }

    const tanda = aprobados.slice(0, LIMITE_TANDA);
    log(`MODO COLA | ${tanda.length} item(s) aprobados a publicar (de ${aprobados.length}) | MODO: ${MODO_ASISTIDO ? 'ASISTIDO (clic humano)' : 'AUTOMATICO'}`);

    for (const item of tanda) {
        try {
            const { copy, numero, total } = cola.elegirCopy(item);
            log(`Publicando item ${item.id} en ${item.grupo} | tipo=${item.tipo} | copy #${numero}/${total} (al azar)`);

            await publicarPost(page, item.grupo, copy, {
                imagen: item.tipo === 'imagen' ? item.imagen : null,
                linkMarketplace: item.tipo === 'link' ? item.link_marketplace : null,
            });

            // Marca publicado (permalink pendiente de captura en iteración futura).
            cola.marcarItem(data, item.id, 'publicado', { copyUsada: numero, permalink: null });
            log(`Item ${item.id} marcado como publicado`);
        } catch (error) {
            log(`Error publicando item ${item.id}: ${error.message}`, 'ERROR');
            try {
                cola.marcarItem(data, item.id, 'error', { error: error.message });
            } catch (e) {
                log(`No se pudo marcar el item ${item.id} como error: ${e.message}`, 'ERROR');
            }
            continue;
        }
    }
}

// ------------------------------------------------------------
// MODO LISTA (fallback): comportamiento original basado en grupos.js.
// ------------------------------------------------------------
async function ejecutarModoLista(page) {
    const desde = leerProgreso();
    if (desde >= grupos.length) {
        log('Ya se publicó en todos los grupos, reinicia progreso.json si quieres volver a empezar');
        return;
    }

    const hasta = Math.min(desde + LIMITE_TANDA, grupos.length);
    const gruposHoy = grupos.slice(desde, hasta);
    log(`MODO LISTA | Publicando en grupos ${desde + 1} al ${hasta} de ${grupos.length} | MODO: ${MODO_ASISTIDO ? 'ASISTIDO (clic humano)' : 'AUTOMATICO'}`);

    for (const grupo of gruposHoy) {
        try {
            // Elige una variante de copy AL AZAR (anti-repetición, AIS-434).
            const { texto, numero } = obtenerTextoAleatorio();
            log(`Publicando en: ${grupo}  (variante de copy #${numero} de ${variantes.length}, al azar)`);

            await publicarPost(page, grupo, texto, {});
        } catch (error) {
            log(`Error en ${grupo}: ${error.message}`, 'ERROR');
            if (error.message.includes('Escribe algo')) {
                log(`Grupo no compatible, eliminando de la lista: ${grupo}`, 'ERROR');
                eliminarGrupoIncompatible(grupo);
            } else {
                log('Continuando con el siguiente grupo...', 'ERROR');
            }
            continue;
        }
    }

    guardarProgreso(hasta);
    log(`Progreso guardado: ${hasta} de ${grupos.length} grupos completados`);
}

// ------------------------------------------------------------
// Función principal
// ------------------------------------------------------------
(async () => {
    log('Bot iniciado');
    let context, page, browserCDP;
    const CDP_URL = process.env.CDP_URL; // ej. http://[::1]:9222 para reusar un navegador ya abierto/logueado

    try {
        if (CDP_URL) {
            // MODO CDP: se conecta a un navegador YA abierto (con la sesión de OnRentX).
            // No lanza ni cierra el navegador; solo lo controla.
            log(`Conectando por CDP a ${CDP_URL} (reusa sesión abierta)`);
            browserCDP = await chromium.connectOverCDP(CDP_URL);
            context = browserCDP.contexts()[0];
            const paginas = context.pages();
            page = paginas.find((p) => p.url().includes('facebook')) || paginas[0] || await context.newPage();
            log('Conectado al navegador existente');
        } else {
            // Resolver carpeta de sesión (soporta --perfil=rrhh o --perfil=comercial o variable FB_SESSION_DIR)
            let sessionPath = process.env.FB_SESSION_DIR || './facebook-session';
            if (process.argv.includes('--perfil=rrhh') || process.env.FB_PERFIL === 'rrhh') {
                sessionPath = path.join(__dirname, 'sessions', 'session-rrhh');
            } else if (process.argv.includes('--perfil=comercial') || process.env.FB_PERFIL === 'comercial') {
                sessionPath = path.join(__dirname, 'facebook-session');
            }
            log(`Usando perfil de sesión: ${sessionPath}`);

            // Abre el navegador con perfil persistente
            context = await chromium.launchPersistentContext(sessionPath, {
                headless: true, // Forzado a modo sin ventana para servidor
                args: ['--start-maximized', '--disable-notifications', '--no-sandbox'],
                viewport: null
            });
            log('Navegador abierto');
            page = await context.newPage();
            log('Nueva página creada');
        }

        // Si existe cola.json → MODO COLA (Dify/router). Si no → MODO LISTA (grupos.js).
        if (cola.existeCola()) {
            log(`cola.json detectada en ${cola.RUTA_COLA} → ejecutando MODO COLA`);
            await ejecutarModoCola(page);
        } else {
            log('No hay cola.json → ejecutando MODO LISTA (grupos.js)');
            await ejecutarModoLista(page);
        }
    } catch (error) {
        log(`Error general: ${error.message}`, 'ERROR');
        log(`Stack: ${error.stack}`, 'ERROR');
    } finally {
        if (browserCDP) {
            // En modo CDP solo desconectamos; NO cerramos el navegador de Aleix.
            await browserCDP.close();
            log('Desconectado del navegador (CDP) — la ventana sigue abierta');
        } else if (context) {
            await context.close();
            log('Navegador cerrado');
        }
        log('Bot finalizado');
    }
})();
