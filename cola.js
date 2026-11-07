// ============================================================
// COLA DE PUBLICACIÓN — contrato Dify ↔ bot ↔ router (AIS-424 / AIS-436)
// ------------------------------------------------------------
// La cola es el punto de encuentro entre quien PREPARA las publicaciones
// (Dify / AIS-253 / imágenes AIS-400) y quien PUBLICA (este bot, en la
// máquina de Aleix). El bot NUNCA inventa contenido: solo consume la cola.
//
// El bot legacy únicamente publica items con estado === "aprobado".
// Queue v2 añade lotes idempotentes sin reescribir los items históricos v1.
// ============================================================

const fs = require('fs');
const path = require('path');

const RUTA_COLA = process.env.COLA_PATH || path.join(__dirname, 'cola.json');

const TIPOS_VALIDOS = ['texto', 'imagen', 'link'];
const ESTADOS_VALIDOS = [
  'pendiente',
  'aprobado',
  'rechazado',
  'publicado',
  'error',
  'queued',
  'publishing',
  'published',
  'cancelled',
];
const ESTADOS_RESUMEN = ['queued', 'publishing', 'published', 'error', 'cancelled'];
const ESTADOS_TERMINALES = ['published', 'error', 'cancelled'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^sha256:[0-9a-f]{64}$/i;

// ¿Existe un archivo de cola? (define si el bot corre en "modo cola" o "modo lista").
function existeCola() {
  return fs.existsSync(RUTA_COLA);
}

// Lee y parsea la cola sin migrarla ni persistir cambios implícitos.
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
  if (item.tipo === 'imagen' && !item.imagen) errores.push(`${pref}: tipo "imagen" requiere "imagen" (ruta local)`);
  if (item.tipo === 'link' && !item.link_marketplace) errores.push(`${pref}: tipo "link" requiere "link_marketplace" (URL)`);
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
    const resultado = validarItem(item, i);
    if (!resultado.ok) errores.push(...resultado.errores);
  });
  return { ok: errores.length === 0, errores };
}

// Devuelve los items publicables legacy, respetando el orden de la cola.
function itemsAprobados(data) {
  return data.items.filter((item) => item.estado === 'aprobado');
}

// Devuelve únicamente items v2 encolados de un batch explícito. No recupera
// items publishing después de un reinicio y nunca hace selección global.
function itemsProcesables(data, { batchUuid } = {}) {
  if (typeof batchUuid !== 'string' || batchUuid.length === 0) return [];
  return data.items.filter((item) => item.batch_uuid === batchUuid && item.estado === 'queued');
}

// Elige una variante de copy AL AZAR de un item (anti-repetición, ver AIS-434).
function elegirCopy(item) {
  const i = Math.floor(Math.random() * item.copies.length);
  return { copy: item.copies[i], numero: i + 1, total: item.copies.length };
}

// Persiste con temp + fsync + rename en el mismo directorio. El despliegue
// mantiene un único proceso escritor; esta función no implementa locking.
function guardarColaAtomica(data) {
  const directory = path.dirname(RUTA_COLA);
  const temporary = path.join(
    directory,
    `.${path.basename(RUTA_COLA)}.${process.pid}.${Date.now()}.tmp`,
  );
  let fd = null;

  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(data, null, 2));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temporary, RUTA_COLA);
  } catch (error) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (_) {}
    }
    try {
      fs.unlinkSync(temporary);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') throw cleanupError;
    }
    throw error;
  }
}

// Export legacy conservado: ahora usa la persistencia atómica.
function guardarCola(data) {
  guardarColaAtomica(data);
}

function detalleLog(extra) {
  const detalle = [];
  if (extra.copyUsada) detalle.push(`copy#${extra.copyUsada}`);
  if (extra.permalink) detalle.push(`permalink=${extra.permalink}`);
  if (extra.error) detalle.push(`error=${extra.error}`);
  return detalle;
}

// Actualiza un item, añade el evento al histórico y persiste atómicamente.
function actualizarItem(data, id, state, extra = {}) {
  const item = data.items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`actualizarItem: no existe item con id "${id}"`);
  if (!ESTADOS_VALIDOS.includes(state)) throw new Error(`actualizarItem: estado inválido "${state}"`);

  item.estado = state;
  for (const [key, value] of Object.entries(extra)) {
    if (!['id', 'estado', 'log', 'copyUsada'].includes(key)) item[key] = value;
  }

  const detalle = detalleLog(extra);
  item.log = Array.isArray(item.log) ? item.log : [];
  item.log.push(`[${new Date().toISOString()}] estado=${state}${detalle.length ? ' | ' + detalle.join(' | ') : ''}`);

  guardarColaAtomica(data);
  return item;
}

// Export legacy conservado con sus mensajes de error históricos.
function marcarItem(data, id, estado, extra = {}) {
  const item = data.items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`marcarItem: no existe item con id "${id}"`);
  if (!ESTADOS_VALIDOS.includes(estado)) throw new Error(`marcarItem: estado inválido "${estado}"`);
  return actualizarItem(data, id, estado, extra);
}

// Genera orx-YYYY-MM-DD-XXXX desde la secuencia máxima, tolerando huecos.
function generarId(data) {
  const fecha = new Date().toISOString().slice(0, 10);
  const prefijo = `orx-${fecha}-`;
  let maximo = 0;

  for (const item of data.items) {
    if (typeof item.id !== 'string' || !item.id.startsWith(prefijo)) continue;
    const sequence = item.id.slice(prefijo.length);
    if (!/^\d+$/.test(sequence)) continue;
    maximo = Math.max(maximo, Number(sequence));
  }

  return `${prefijo}${String(maximo + 1).padStart(4, '0')}`;
}

// Encola un nuevo item legacy. Conserva el contrato de Dify, visor y bot.
function encolarItem(entrada = {}) {
  const data = existeCola() ? leerCola() : { version: 1, items: [] };

  const item = {
    id: entrada.id || generarId(data),
    correlation_id: entrada.correlation_id || null,
    owner: entrada.owner || 'onrentx-marketing',
    grupo: entrada.grupo,
    tipo: entrada.tipo,
    copies: Array.isArray(entrada.copies) ? entrada.copies : (entrada.copy ? [entrada.copy] : []),
    imagen: entrada.imagen || null,
    link_marketplace: entrada.link_marketplace || null,
    estado: entrada.estado || 'pendiente',
    permalink: null,
    log: [`[${new Date().toISOString()}] encolado (owner=${entrada.owner || 'onrentx-marketing'}${entrada.correlation_id ? `, corr=${entrada.correlation_id}` : ''})`],
  };

  if (data.items.some((candidate) => candidate.id === item.id)) {
    throw new Error(`encolarItem: ya existe un item con id "${item.id}"`);
  }

  const validation = validarItem(item, data.items.length);
  if (!validation.ok) {
    throw new Error('encolarItem: item inválido: ' + validation.errores.join('; '));
  }

  data.items.push(item);
  guardarColaAtomica(data);
  return item;
}

function crearErrorConflicto(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validarEntradaLote({ batch, items } = {}) {
  const errores = [];
  if (!batch || typeof batch !== 'object' || Array.isArray(batch)) {
    errores.push('batch debe ser un objeto');
  } else {
    if (typeof batch.batch_uuid !== 'string' || !UUID_PATTERN.test(batch.batch_uuid)) {
      errores.push('batch.batch_uuid debe ser un UUID válido');
    }
    if (!Number.isSafeInteger(batch.lead_id) || batch.lead_id <= 0) {
      errores.push('batch.lead_id debe ser un entero positivo');
    }
  }

  if (!Array.isArray(items) || items.length === 0) {
    errores.push('items debe ser un array con al menos un elemento');
  } else {
    const keys = new Set();
    items.forEach((item, index) => {
      const prefix = `items[${index}]`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        errores.push(`${prefix} debe ser un objeto`);
        return;
      }
      if (typeof item.facebook_group_id !== 'string' || !/^\d+$/.test(item.facebook_group_id)) {
        errores.push(`${prefix}.facebook_group_id debe contener solo dígitos`);
      }
      if (typeof item.grupo !== 'string' || item.grupo.trim().length === 0) {
        errores.push(`${prefix}.grupo debe ser una URL no vacía`);
      }
      if (typeof item.idempotency_key !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(item.idempotency_key)) {
        errores.push(`${prefix}.idempotency_key debe tener formato sha256:<64 hex>`);
      } else if (keys.has(item.idempotency_key)) {
        errores.push(`${prefix}.idempotency_key está duplicada en el lote`);
      } else {
        keys.add(item.idempotency_key);
      }
      if (!Number.isSafeInteger(item.campaign_revision) || item.campaign_revision <= 0) {
        errores.push(`${prefix}.campaign_revision debe ser un entero positivo`);
      }
      if (typeof item.copy !== 'string' || item.copy.trim().length === 0) {
        errores.push(`${prefix}.copy debe ser un string no vacío`);
      }
    });
  }

  if (errores.length > 0) {
    const error = new Error(`encolarLote: entrada inválida: ${errores.join('; ')}`);
    error.code = 'INVALID_BATCH';
    throw error;
  }
}

function contenidoItem(item) {
  return {
    lead_id: item.lead_id,
    facebook_group_id: item.facebook_group_id,
    grupo: item.grupo,
    idempotency_key: item.idempotency_key,
    campaign_revision: item.campaign_revision,
    copy: item.copy !== undefined ? item.copy : (Array.isArray(item.copies) ? item.copies[0] : undefined),
  };
}

function contenidoEntrada(batch, item) {
  return {
    lead_id: batch.lead_id,
    facebook_group_id: item.facebook_group_id,
    grupo: item.grupo,
    idempotency_key: item.idempotency_key,
    campaign_revision: item.campaign_revision,
    copy: item.copy,
  };
}

function mismoContenido(item, batch, entrada) {
  return JSON.stringify(contenidoItem(item)) === JSON.stringify(contenidoEntrada(batch, entrada));
}

function buscarBatch(data, batchUuid) {
  return data.items.filter((item) => item.batch_uuid === batchUuid);
}

function estadoActual(item) {
  const state = item.estado !== undefined ? item.estado : item.state;
  return state === 'publicado' ? 'published' : state;
}

function resumirBatch(data, batchUuid) {
  const items = buscarBatch(data, batchUuid);
  const counts = Object.fromEntries(ESTADOS_RESUMEN.map((state) => [state, 0]));
  for (const item of items) {
    const state = estadoActual(item);
    if (Object.prototype.hasOwnProperty.call(counts, state)) counts[state] += 1;
  }
  const terminal = items.length > 0 && items.every((item) => ESTADOS_TERMINALES.includes(estadoActual(item)));
  return {
    batch_uuid: batchUuid,
    lead_id: items[0] ? items[0].lead_id : null,
    state: terminal && counts.error > 0
      ? 'error'
      : terminal
        ? 'published'
        : counts.publishing > 0
          ? 'publishing'
          : 'queued',
    terminal,
    counts: { total: items.length, ...counts },
    items,
  };
}

// Inserta un lote como una sola operación. Las validaciones y conflictos se
// resuelven antes de mutar data o tocar el archivo de cola.
function encolarLote(solicitud = {}) {
  validarEntradaLote(solicitud);
  const { batch, items } = solicitud;
  const data = existeCola() ? leerCola() : { version: 2, items: [] };
  const batchItems = buscarBatch(data, batch.batch_uuid);

  if (batchItems.length > 0) {
    const byKey = new Map(batchItems.map((item) => [item.idempotency_key, item]));
    const identical = batchItems.length === items.length && items.every((entrada) => {
      const existing = byKey.get(entrada.idempotency_key);
      return existing && mismoContenido(existing, batch, entrada);
    });
    if (!identical) {
      throw crearErrorConflicto(
        'BATCH_UUID_CONFLICT',
        `encolarLote: batch_uuid "${batch.batch_uuid}" ya existe con contenido diferente`,
      );
    }
    return { created: [], existing: items.map((item) => byKey.get(item.idempotency_key)) };
  }

  const existingByKey = new Map();
  for (const item of data.items) {
    if (typeof item.idempotency_key === 'string') existingByKey.set(item.idempotency_key, item);
  }

  const existing = [];
  const pending = [];
  for (const entrada of items) {
    const previous = existingByKey.get(entrada.idempotency_key);
    if (!previous) {
      pending.push(entrada);
      continue;
    }
    if (!mismoContenido(previous, batch, entrada)) {
      throw crearErrorConflicto(
        'IDEMPOTENCY_KEY_CONFLICT',
        `encolarLote: idempotency_key "${entrada.idempotency_key}" ya existe con contenido diferente`,
      );
    }
    if (previous.batch_uuid !== batch.batch_uuid) {
      throw crearErrorConflicto(
        'IDEMPOTENCY_KEY_CONFLICT',
        `encolarLote: idempotency_key "${entrada.idempotency_key}" ya pertenece a otro batch_uuid`,
      );
    }
    existing.push(previous);
  }

  if (pending.length === 0) return { created: [], existing };

  const nextData = { ...data, version: 2, items: [...data.items] };
  const created = pending.map((entrada) => {
    const item = {
      id: generarId(nextData),
      batch_uuid: batch.batch_uuid,
      lead_id: batch.lead_id,
      facebook_group_id: entrada.facebook_group_id,
      idempotency_key: entrada.idempotency_key,
      campaign_revision: entrada.campaign_revision,
      copy: entrada.copy,
      correlation_id: `lead-${batch.lead_id}`,
      owner: 'odoo-prebidding',
      grupo: entrada.grupo,
      tipo: 'texto',
      copies: [entrada.copy],
      imagen: null,
      link_marketplace: null,
      estado: 'queued',
      permalink: null,
      log: [`[${new Date().toISOString()}] encolado batch=${batch.batch_uuid}`],
    };
    nextData.items.push(item);
    return item;
  });

  guardarColaAtomica(nextData);
  return { created, existing };
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
  itemsProcesables,
  elegirCopy,
  guardarCola,
  guardarColaAtomica,
  marcarItem,
  actualizarItem,
  generarId,
  encolarItem,
  encolarLote,
  buscarBatch,
  estadoActual,
  resumirBatch,
};
