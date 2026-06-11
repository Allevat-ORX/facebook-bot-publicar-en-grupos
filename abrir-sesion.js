// abrir-sesion.js
// Abre el navegador con la sesión guardada para hacer cambios manuales.
// Úsalo para: cambiar identidad, revisar la sesión, solucionar problemas, etc.
// El navegador queda abierto hasta que lo cierres manualmente.

const { chromium } = require('playwright');

(async () => {
    console.log('Abriendo navegador con sesión guardada...');
    console.log('Cierra el navegador manualmente cuando termines.');

    const context = await chromium.launchPersistentContext('./facebook-session', {
        headless: false,
        args: ['--start-maximized'],
        viewport: null
    });

    // Abre una pestaña en Facebook directamente
    const page = await context.newPage();
    await page.goto('https://www.facebook.com');

    console.log('Navegador listo. Haz los cambios necesarios y ciérralo.');

    // Espera indefinidamente hasta que el navegador se cierre manualmente
    await new Promise(() => {});

})();