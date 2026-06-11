const { chromium } = require('playwright'); // Importa Chromium de Playwright
const fs = require('fs'); // Para escribir el archivo grupos.js al final

(async () => {

    // Abre el navegador con la sesión guardada de Facebook
    const context = await chromium.launchPersistentContext('./facebook-session', {
        headless: false
    });

    const page = await context.newPage();

    // Navega a la página de tus grupos
    await page.goto('https://www.facebook.com/groups/joins/?nav_source=tab&ordering=viewer_added');
    console.log('Página de grupos abierta');

    // Espera que cargue
    await page.waitForTimeout(5000);

    const urlsEncontradas = new Set(); // Set en vez de array para evitar duplicados automáticamente

    let scrollsIguales = 0; // Contador para detectar cuando ya no hay más grupos

    // Loop de scroll hasta recolectar todos los grupos
    while (true) {

        // Extrae todas las URLs de grupos visibles en este momento
        const urlsNuevas = await page.evaluate(() => {
            const links = document.querySelectorAll('a[aria-label="Ver grupo"]');
            return Array.from(links).map(a => a.href);
        });

        // Agrega las URLs nuevas al Set
        const totalAntes = urlsEncontradas.size;
        urlsNuevas.forEach(url => urlsEncontradas.add(url));
        const totalDespues = urlsEncontradas.size;

        console.log(`Grupos encontrados hasta ahora: ${totalDespues}`);

        // Si no se agregaron URLs nuevas después del scroll, probablemente llegamos al final
        if (totalDespues === totalAntes) {
            scrollsIguales++;
            console.log(`Sin grupos nuevos, intento ${scrollsIguales}/3`);
            if (scrollsIguales >= 3) {
                console.log('No hay más grupos, terminando scroll');
                break;
            }
        } else {
            scrollsIguales = 0; // Resetea el contador si encontró grupos nuevos
        }

        // Scroll hacia abajo
        await page.evaluate(() => window.scrollBy(0, 1500));
        await page.waitForTimeout(2000); // Espera que carguen los nuevos grupos

    }

    // Convierte el Set a array para poder recorrerlo
    const todasLasUrls = Array.from(urlsEncontradas);
    console.log(`Total grupos recolectados antes de filtrar: ${todasLasUrls.length}`);

    // Filtra los grupos verificando que tengan "Escribe algo"
    const gruposCompatibles = [];

    for (const url of todasLasUrls) {

        try {

            console.log(`Verificando: ${url}`);

            // Entra al grupo
            await page.goto(url);

            // Espera que cargue
            await page.waitForTimeout(3000);

            // Verifica si existe el texto "Escribe algo"
            const tieneEscribeAlgo = await page.getByText('Escribe algo').isVisible()
                .catch(() => false); // Si falla, retorna false en vez de lanzar error

            if (tieneEscribeAlgo) {
                console.log(`✅ Compatible: ${url}`);
                gruposCompatibles.push(url);
            } else {
                console.log(`❌ No compatible, omitiendo: ${url}`);
            }

        } catch (error) {
            // Si hay cualquier error al verificar, omite el grupo
            console.log(`❌ Error verificando ${url}, omitiendo: ${error.message}`);
        }

    }

    console.log(`Total grupos compatibles: ${gruposCompatibles.length} de ${todasLasUrls.length}`);

    // Genera el contenido del archivo grupos.js
    const contenido = `// Lista de grupos generada automáticamente por recolector.js
// Total: ${gruposCompatibles.length} grupos

const grupos = [
${gruposCompatibles.map(url => `    '${url}',`).join('\n')}
];

module.exports = grupos;
`;

    // Sobreescribe grupos.js con la nueva lista filtrada
    fs.writeFileSync('grupos.js', contenido);
    console.log('✅ grupos.js generado correctamente');

    await context.close();

})();