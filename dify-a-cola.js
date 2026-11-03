// ============================================================
// CONEXIÓN DIFY → COLA — AIS-438 (parte de AIS-424)
// ------------------------------------------------------------
// Dos formas de que Dify (o AIS-424) meta publicaciones en la cola:
//
// 1) HTTP (recomendado con el visor corriendo):
//      POST http://localhost:4599/api/enqueue
//      Content-Type: application/json
//      { "grupo": "...", "tipo": "texto|imagen|link", "copies": ["..."],
//        "imagen": null, "link_marketplace": null,
//        "correlation_id": "dify-run-xxx", "owner": "onrentx-marketing" }
//
// 2) CLI / módulo (sin servidor): escribe directo en cola.json vía cola.encolarItem.
//      echo '{"grupo":"...","tipo":"texto","copies":["hola"]}' | node dify-a-cola.js
//      node dify-a-cola.js '{"grupo":"...","tipo":"link","link_marketplace":"https://...","copies":["ver aquí"]}'
//
// CONTRATO de entrada (lo que Dify debe mandar):
//   grupo            (req)  URL del grupo de Facebook
//   tipo             (req)  "texto" | "imagen" | "link"
//   copies           (req)  array de variantes de copy (o "copy" string único)
//   imagen           (opc)  ruta local del creativo (solo tipo "imagen"; AIS-400)
//   link_marketplace (opc)  URL Marketplace (solo tipo "link")
//   correlation_id   (opc)  traza del run de Dify (ownership AIS-424)
//   owner            (opc)  propietario (default "onrentx-marketing")
//   estado           (opc)  default "pendiente" (el humano aprueba en el visor)
//
// El bot (index.js, MODO COLA) SOLO publica items con estado "aprobado".
// ============================================================

const cola = require('./cola');

// Encola programáticamente (para requerir este módulo desde otro script Node).
function encolarDesdeDify(entrada) {
  return cola.encolarItem(entrada);
}

module.exports = { encolarDesdeDify };

// --- Modo CLI: se ejecuta solo si se llama directamente con `node dify-a-cola.js` ---
if (require.main === module) {
  const argJson = process.argv[2];

  const procesar = (texto) => {
    let entrada;
    try {
      entrada = JSON.parse(texto);
    } catch (e) {
      console.error('Entrada JSON inválida:', e.message);
      process.exit(1);
    }
    try {
      const item = encolarDesdeDify(entrada);
      console.log('Encolado OK:', item.id, '| estado:', item.estado, '| tipo:', item.tipo);
      console.log('Cola:', cola.RUTA_COLA);
    } catch (e) {
      console.error('No se pudo encolar:', e.message);
      process.exit(1);
    }
  };

  if (argJson) {
    procesar(argJson); // JSON pasado como argumento
  } else {
    // Lee JSON desde stdin (pipe)
    let data = '';
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => {
      if (!data.trim()) {
        console.error('Uso: node dify-a-cola.js \'{"grupo":"...","tipo":"texto","copies":["..."]}\'');
        console.error('   o: echo \'{...}\' | node dify-a-cola.js');
        process.exit(1);
      }
      procesar(data);
    });
  }
}
