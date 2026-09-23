// ============================================================
// COLA DE PUBLICACIÓN — contrato Dify ↔ bot ↔ router (AIS-424 / AIS-436)
// ------------------------------------------------------------
// La cola es el punto de encuentro entre quien PREPARA las publicaciones
// (Dify / AIS-253 / imágenes AIS-400) y quien PUBLICA (este bot, en la
// máquina de Aleix). El bot NUNCA inventa contenido: solo consume la cola.
//
// El bot únicamente publica items con estado === "aprobado".
// Tras publicar, marca el item como "publicado" y guarda el permalink.
//
// ESQUEMA de cola.json:
// {
//   "version": 1,
//   "items": [
//     {
//       "id":               string  (único; ej. "orx-2026-09-23-0001"),
//       "correlation_id":   string  (traza del run de Dify; ownership AIS-424),
//       "owner":            string  (equipo/propietario; ownership AIS-424),
//       "grupo":            string  (URL del grupo de Facebook),
//       "tipo":             "texto" | "imagen" | "link",
//       "copies":           string[] (1..N variantes; se elige una al AZAR),
//       "imagen":           string|null (ruta local, solo tipo "imagen"; AIS-400),
//       "link_marketplace": string|null (URL Marketplace, solo tipo "link"),
//       "estado":           "pendiente" | "aprobado" | "rechazado" | "publicado" | "error",
//       "permalink":        string|null (URL del post publicado),
//       "log":              string[] (histórico de eventos del item)
//     }
//   ]
// }
// ============================================================

const fs = require('fs');
const path = require('path');

const RUTA_COLA = process.env.COLA_PATH || path.join(__dirname, 'cola.json');

const TIPOS_VALIDOS = ['texto', 'imagen', 'link'];
const ESTADOS_VALIDOS = ['pendiente', 'aprobado', 'rechazado', 'publicado', 'error'];

// ¿Existe un archivo de cola? (define si el bot corre en "modo cola" o "modo lista").
function existeCola() {
  return fs.existsSync(RUTA_COLA);
}

// Lee y parsea la cola. Lanza si el JSON es inválido o la forma no cuadra.
function leerCola() {
  const raw = fs.readFileSync(RUTA_COLA, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`cola.json no es JSON válido: ${e.message}`);
  }
  if (!data || !Array.isArray(data.items)) {
    throw new Error('cola.json debe tener la forma { version, items: [...] }');
  }
  return data;
}

// Valida un item y devuelve { ok, errores[] }. No lanza: acumula problemas.
function validarItem(item, indice) {
  const errores = [];
  const pref = `item[${indice}]${item && item.id ? ` (${item.id})` : ''}`;

  if (!item || typeof item !== 'object') {
    return { ok: false, errores: [`${pref}: no es un objeto`] };
  }
  if (!item.id || typeof item.id !== 'string') errores.push(`${pref}: falta "id" (string)`);
  if (!item.grupo || typeof item.grupo !== 'string') errores.push(`${pref}: falta "grupo" (URL)`);
  if (!TIPOS_VALIDOS.includes(item.tipo)) errores.push(`${pref}: "tipo" debe ser ${TIPOS_VALIDOS.join('|')}`);
  if (!Array.isArray(item.copies) || item.copies.length === 0) {
    errores.push(`${pref}: "copies" debe ser un array con al menos 1 variante`);
  }
  if (!ESTADOS_VALIDOS.includes(item.estado)) {
    errores.push(`${pref}: "estado" debe ser ${ESTADOS_VALIDOS.join('|')}`);
  }
  // Coherencia por tipo
  if (item.tipo === 'imagen' && !item.imagen) errores.push(`${pref}: tipo "imagen" requiere "imagen" (ruta local)`);
  if (item.tipo === 'link' && !item.link_marketplace) errores.push(`${pref}: tipo "link" requiere "link_marketplace" (URL)`);
  // Si es tipo imagen, la ruta debe existir en disco
  if (item.tipo === 'imagen' && item.imagen) {
    const rutaImg = path.isAbsolute(item.imagen) ? item.imagen : path.join(__dirname, item.imagen);
    if (!fs.existsSync(rutaImg)) errores.push(`${pref}: la imagen "${item.imagen}" no existe en disco`);
  }

  return { ok: errores.length === 0, errores };
}

// Valida la cola entera. Devuelve { ok, errores[] }.
function validarCola(data) {
  const errores = [];
  data.items.forEach((item, i) => {
    const r = validarItem(item, i);
    if (!r.ok) errores.push(...r.errores);
  });
  return { ok: errores.length === 0, errores };
}

// Devuelve los items publicables (estado "aprobado"), respetando el orden de la cola.
function itemsAprobados(data) {
  return data.items.filter((it) => it.estado === 'aprobado');
}

// Elige una variante de copy AL AZAR de un item (anti-repetición, ver AIS-434).
function elegirCopy(item) {
  const i = Math.floor(Math.random() * item.copies.length);
  return { copy: item.copies[i], numero: i + 1, total: item.copies.length };
}

// Persiste la cola completa en disco (pretty-print).
function guardarCola(data) {
  fs.writeFileSync(RUTA_COLA, JSON.stringify(data, null, 2));
}

// Marca un item (por id) con nuevo estado y datos, añade una línea al log y persiste.
// Extra puede incluir { permalink, error, copyUsada }.
function marcarItem(data, id, estado, extra = {}) {
  const item = data.items.find((it) => it.id === id);
  if (!item) throw new Error(`marcarItem: no existe item con id "${id}"`);
  if (!ESTADOS_VALIDOS.includes(estado)) throw new Error(`marcarItem: estado inválido "${estado}"`);

  item.estado = estado;
  if (Object.prototype.hasOwnProperty.call(extra, 'permalink')) item.permalink = extra.permalink;

  const detalle = [];
  if (extra.copyUsada) detalle.push(`copy#${extra.copyUsada}`);
  if (extra.permalink) detalle.push(`permalink=${extra.permalink}`);
  if (extra.error) detalle.push(`error=${extra.error}`);
  item.log = Array.isArray(item.log) ? item.log : [];
  item.log.push(`[${new Date().toISOString()}] estado=${estado}${detalle.length ? ' | ' + detalle.join(' | ') : ''}`);

  guardarCola(data);
  return item;
}

module.exports = {
  RUTA_COLA,
  TIPOS_VALIDOS,
  ESTADOS_VALIDOS,
  existeCola,
  leerCola,
  validarItem,
  validarCola,
  itemsAprobados,
  elegirCopy,
  guardarCola,
  marcarItem,
};
