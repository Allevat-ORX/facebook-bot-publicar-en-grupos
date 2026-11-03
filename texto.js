// ============================================================
// TEXTOS DE PUBLICACIÓN — OnRentX (grupos de construcción, MX)
// 5 variantes para ROTAR y no repetir texto idéntico (anti-spam/shadowban).
// Base: FACEBOOK-GROUPS-HANDOFF-MARKETER.md. Sin claims no verificados.
// ============================================================

const variantes = [
  // Variante 1 — dolor: obra parada
  `¿Tienes la obra parada porque no encuentras la maquinaria que necesitas?

En OnRentX te ayudamos a encontrar opciones de maquinaria para renta y a conectar con proveedores para tu obra.

¿Buscas excavadora, retroexcavadora, cargador, compactador o camión?

Escríbenos desde nuestra página: https://www.facebook.com/OnRentX/
Dinos qué equipo necesitas y en qué zona.`,

  // Variante 2 — directo / pregunta corta
  `¿Necesitas maquinaria para tu obra y no sabes con quién?

En OnRentX conectamos tu proyecto con proveedores de renta de maquinaria pesada y ligera.

Cuéntanos qué equipo buscas (excavadora, retro, cargador, compactador, camión...) y tu zona.

Mándanos mensaje: https://www.facebook.com/OnRentX/`,

  // Variante 3 — tiempo / eficiencia
  `Rentar maquinaria para tu obra no tiene que tomarte días de llamadas.

En OnRentX te ayudamos a encontrar opciones y conectar con proveedores para tu proyecto.

¿Qué necesitas? Excavadora, retroexcavadora, cargador, compactador, camión u otro equipo.

Escríbenos y dinos tu zona: https://www.facebook.com/OnRentX/`,

  // Variante 4 — proveedor local / red
  `¿Buscas maquinaria en renta para construcción en tu zona?

OnRentX te conecta con proveedores para que consigas el equipo que tu obra necesita.

Escríbenos qué maquinaria buscas y dónde está tu obra: https://www.facebook.com/OnRentX/`,

  // Variante 5 — breve / CTA fuerte
  `Maquinaria para tu obra, sin complicarte.

En OnRentX te ayudamos a encontrar y rentar el equipo que necesitas conectándote con proveedores.

Dinos qué equipo y en qué zona: https://www.facebook.com/OnRentX/`,
];

// Devuelve una variante rotando por índice (para que cada grupo reciba una distinta).
// Se mantiene por compatibilidad, pero para publicar se recomienda la versión ALEATORIA
// (ver obtenerTextoAleatorio): el autor del método advierte que Facebook suspende cuando
// detecta texto idéntico repetido, y la rotación secuencial es predecible.
function obtenerTexto(indice = 0) {
  return variantes[indice % variantes.length];
}

// Devuelve una variante ELEGIDA AL AZAR. Es la forma recomendada de publicar:
// romper la secuencia reduce el riesgo de shadowban por texto repetido/predecible.
// Devuelve también el índice (1-based) para poder registrarlo en el log.
function obtenerTextoAleatorio() {
  const indice = Math.floor(Math.random() * variantes.length);
  return { texto: variantes[indice], numero: indice + 1 };
}

module.exports = { variantes, obtenerTexto, obtenerTextoAleatorio };
// Compatibilidad: si algo importa el módulo como string, usa la primera variante.
module.exports.texto = variantes[0];
