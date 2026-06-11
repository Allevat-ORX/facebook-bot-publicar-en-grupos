const { chromium } = require('playwright'); // Importa el navegador Chromium de Playwright
const fs = require('fs'); // Importa el módulo de sistema de archivos de Node.js para escribir el log.txt

const grupos = require('./grupos'); // Importa la lista de grupos
const texto = require('./texto');   // Importa el texto de la publicación

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

// Lee el progreso desde progreso.json para saber desde qué grupo continuar
function leerProgreso() {
    const data = fs.readFileSync('progreso.json', 'utf8'); // Lee el archivo como texto
    return JSON.parse(data).ultimo; // Retorna el número del último grupo publicado
}

// Guarda el progreso actual en progreso.json
function guardarProgreso(ultimo) {
    fs.writeFileSync('progreso.json', JSON.stringify({ ultimo }, null, 2)); // Sobreescribe el archivo con el nuevo valor
}

// Función principal async, necesaria para poder usar await dentro
(async () => {

    log('Bot iniciado');

    // Declaradas fuera del try para poder usarlas también en el finally
    let context, page;

    try {

        // Lee desde qué grupo hay que continuar
        const desde = leerProgreso();

        // Si ya se publicó en todos los grupos, termina
        if (desde >= grupos.length) {
            log('Ya se publicó en todos los grupos, reinicia progreso.json si quieres volver a empezar');
            return;
        }

        // Toma los siguientes 10 grupos desde donde quedó
        const hasta = Math.min(desde + 10, grupos.length); // Math.min evita pasarse del total
        const gruposHoy = grupos.slice(desde, hasta); // Extrae la tanda de hoy

        log(`Publicando en grupos ${desde + 1} al ${hasta} de ${grupos.length}`);

        // Abre el navegador usando un perfil persistente
        // Esto guarda la sesión de Facebook en la carpeta ./facebook-session
        // para no tener que iniciar sesión cada vez
        context = await chromium.launchPersistentContext('./facebook-session', {
            headless: false, // false = muestra el navegador visualmente, true = corre en segundo plano
            args: ['--start-maximized'],
            viewport: null
        });
        log('Navegador abierto');

        // Crea una nueva pestaña dentro del navegador
        page = await context.newPage();
        log('Nueva página creada');

        // Recorre cada grupo de la tanda de hoy
        for (const grupo of gruposHoy) {

            try {

                log(`Publicando en: ${grupo}`);

                // Navega al grupo
                await page.goto(grupo);
                log('Grupo abierto');

                // Simula scroll humano con una distancia aleatoria entre 300 y 900 píxeles
                await page.mouse.wheel(0, esperaHumana(300, 900));



                // Hace click en el campo "Escribe algo" para abrir el modal de nueva publicación
                await page.getByText('Escribe algo').click();
                log('Modal de publicación abierto');

                // Espera entre 5 y 9 segundos para que el modal cargue completamente
                await page.waitForTimeout(esperaHumana(5000, 9000));

                // Busca la caja de texto editable dentro del modal
                // .last() porque Facebook tiene varios textbox en el DOM y el del modal es el último
                const editor = page.locator('[role="textbox"]').last();

                // Click en el editor para asegurarse de que tiene el foco antes de escribir
                await editor.click();

                // Copia el texto al portapapeles y lo pega de golpe
                // Más confiable que type() especialmente con emojis y textos largos
                await page.evaluate((t) => navigator.clipboard.writeText(t), texto);
                await page.keyboard.press('Control+V');
                log('Texto pegado');



                // Espera 3 segundos para que Facebook genere la previsualización del enlace
                await page.waitForTimeout(3000);
                log('Previsualización generada');

                // Espera entre 5 y 12 segundos para que Facebook procese y muestre el preview de la imagen
                await page.waitForTimeout(esperaHumana(5000, 12000));

                // Hace click en el botón Publicar para enviar la publicación
                await page.getByRole('button', { name: 'Publicar' }).click();
                log(`Publicación enviada en ${grupo} ✅`);

                // Espera entre grupos para no levantar sospechas en Facebook
                await page.waitForTimeout(esperaHumana(10000, 20000));

            } catch (error) {
                log(`Error en ${grupo}: ${error.message}`, 'ERROR');

                // Si el error es porque no encontró "Escribe algo", es un grupo de marketplace
                // lo elimina de grupos.js para no volver a intentarlo
                if (error.message.includes('Escribe algo')) {
                    log(`Grupo no compatible, eliminando de la lista: ${grupo}`, 'ERROR');

                    // Lee la lista actual
                    const listaActual = require('./grupos');

                    // Filtra eliminando el grupo problemático
                    const listaFiltrada = listaActual.filter(g => g !== grupo);

                    // Genera el nuevo contenido de grupos.js
                    const contenido = `// Lista de grupos generada automáticamente por recolector.js
                    // Total: ${listaFiltrada.length} grupos

                    const grupos = [
                    ${listaFiltrada.map(url => `    '${url}',`).join('\n')}
                    ];

                    module.exports = grupos;
                    `;
                    fs.writeFileSync('grupos.js', contenido);
                    log(`Grupo eliminado, quedan ${listaFiltrada.length} grupos`);
                } else {
                    log('Continuando con el siguiente grupo...', 'ERROR');
                }

                continue;
            }

        }

        // Guarda el progreso después de terminar la tanda completa
        guardarProgreso(hasta);
        log(`Progreso guardado: ${hasta} de ${grupos.length} grupos completados`);

    } catch (error) {
        // Captura errores generales fuera del loop (navegador, lectura de archivos, etc)
        log(`Error general: ${error.message}`, 'ERROR');
        log(`Stack: ${error.stack}`, 'ERROR');
    } finally {
        // El bloque finally se ejecuta SIEMPRE, haya error o no
        // Garantiza que el navegador se cierre limpiamente en cualquier caso
        if (context) {
            await context.close();
            log('Navegador cerrado');
        }
        log('Bot finalizado');
    }

})();