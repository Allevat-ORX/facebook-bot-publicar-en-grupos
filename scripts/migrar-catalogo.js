#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { normalizarGrupoFacebook } = require('../catalogo');

const SOURCE_FILES = [
  '_grupos-clasificados.json',
  '_listas-campana.json',
  'grupos_ampliados_slp_qro.json',
  '_grupos-detectados.json',
];

function compararTexto(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function valoresUnicos(values) {
  return [...new Set(values.filter(Boolean))].sort(compararTexto);
}

function regionesDesdeTexto(value) {
  const text = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const regions = [];
  if (/san luis|\bslp\b|potos|soledad/.test(text)) regions.push('SLP');
  if (/queretaro|\bqro\b/.test(text)) regions.push('QRO');
  if (/guanajuato|silao|irapuato|celaya/.test(text) || (/(^|[\s,])leon($|[\s,])/.test(text) && !/nuevo leon/.test(text))) regions.push('GTO');
  if (/hidalgo|pachuca/.test(text)) regions.push('HGO');
  if (/jalisco|guadalajara/.test(text)) regions.push('JAL');
  if (/nuevo leon|monterrey/.test(text)) regions.push('NL');
  if (/quintana roo|cancun|tulum/.test(text)) regions.push('QROO');
  if (/oaxaca/.test(text)) regions.push('OAX');
  if (/tabasco/.test(text)) regions.push('TAB');
  if (/yucatan/.test(text)) regions.push('YUC');
  return valoresUnicos(regions);
}

function scopeParaRegiones(regions) {
  if (regions.length === 0) return 'national';
  if (regions.length === 1) return 'local';
  return 'bajio';
}

function convertirRegistro(entry, context = {}) {
  const raw = typeof entry === 'string' ? { url: entry } : entry;
  if (!raw || typeof raw !== 'object') return null;

  const regions = valoresUnicos([
    ...regionesDesdeTexto(raw.ciudad),
    ...regionesDesdeTexto(raw.region),
    ...regionesDesdeTexto(raw.estado),
    ...regionesDesdeTexto(raw.nombre),
    ...(context.regions || []),
  ]);
  const categories = raw.maquinaria === true ? ['maquinaria'] : [];
  const tags = valoresUnicos([
    ...(context.tags || []),
    typeof raw.tipo === 'string' ? raw.tipo : null,
    raw.empleo === true ? 'empleo' : null,
  ]);

  return {
    url: raw.url,
    name: typeof raw.nombre === 'string' && raw.nombre.trim() ? raw.nombre.trim() : null,
    scope: context.scope || scopeParaRegiones(regions),
    regions,
    categories,
    tags,
  };
}

function leerRegistros(filename, data) {
  if (filename === '_listas-campana.json') {
    if (!data || Array.isArray(data) || typeof data !== 'object') {
      throw new Error(`invalid_historical_source:${filename}`);
    }
    return Object.entries(data).flatMap(([listName, entries]) => {
      if (!Array.isArray(entries)) throw new Error(`invalid_historical_source:${filename}`);
      const regions = regionesDesdeTexto(listName);
      const tags = [];
      if (/clientes/i.test(listName)) tags.push('clientes');
      if (/prov/i.test(listName)) tags.push('proveedores');
      return entries.map((entry) => convertirRegistro(entry, {
        scope: scopeParaRegiones(regions),
        regions,
        tags,
      }));
    });
  }

  if (!Array.isArray(data)) throw new Error(`invalid_historical_source:${filename}`);
  return data.map((entry) => convertirRegistro(entry));
}

function leerFuentes(sourceRoot, logger) {
  const records = [];
  let sourcesFound = 0;

  for (const filename of SOURCE_FILES) {
    const sourcePath = path.join(sourceRoot, filename);
    if (!fs.existsSync(sourcePath)) {
      logger(`Fuente ausente: ${filename}`);
      continue;
    }

    sourcesFound += 1;
    const data = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    const sourceRecords = leerRegistros(filename, data);
    sourceRecords.forEach((record, index) => records.push({ record, filename, index }));
    logger(`Fuente encontrada: ${filename} (${sourceRecords.length} registros)`);
  }

  if (sourcesFound === 0) throw new Error('no_historical_sources');
  return { records, sourcesFound };
}

function consolidar(records, logger) {
  const groupsById = new Map();
  let duplicates = 0;
  let conflictingNames = 0;
  let invalid = 0;

  for (const { record, filename, index } of records) {
    let canonical;
    try {
      canonical = normalizarGrupoFacebook(record?.url);
    } catch (_) {
      invalid += 1;
      logger(`URL inválida omitida: ${filename}[${index}]`);
      continue;
    }

    const existing = groupsById.get(canonical.facebook_group_id);
    if (!existing) {
      groupsById.set(canonical.facebook_group_id, {
        ...canonical,
        name: record.name || canonical.facebook_group_id,
        scope: record.scope,
        regions: record.regions,
        categories: record.categories,
        tags: record.tags,
        nameWasExplicit: Boolean(record.name),
      });
      continue;
    }

    duplicates += 1;
    logger(`ID duplicado: ${canonical.facebook_group_id} (${filename}[${index}])`);
    if (record.name && existing.nameWasExplicit && record.name !== existing.name) {
      conflictingNames += 1;
      logger(`Nombres en conflicto: ${canonical.facebook_group_id}`);
    } else if (record.name && !existing.nameWasExplicit) {
      existing.name = record.name;
      existing.nameWasExplicit = true;
    }
    existing.regions = valoresUnicos([...existing.regions, ...record.regions]);
    existing.categories = valoresUnicos([...existing.categories, ...record.categories]);
    existing.tags = valoresUnicos([...existing.tags, ...record.tags]);
  }

  const groups = [...groupsById.values()]
    .sort((a, b) => compararTexto(a.facebook_group_id, b.facebook_group_id))
    .map(({ nameWasExplicit, ...group }) => ({
      ...group,
      scope: scopeParaRegiones(group.regions),
    }));
  return { groups, duplicates, conflictingNames, invalid };
}

function crearSalidas(groups) {
  const commercialGroups = groups.map((group) => ({
    facebook_group_id: group.facebook_group_id,
    url: group.url,
    name: group.name,
    scope: group.scope,
    regions: group.regions,
    categories: group.categories,
    tags: group.tags,
  }));
  const operationalGroups = groups.map((group) => ({
    facebook_group_id: group.facebook_group_id,
    url: group.url,
    membership_state: 'unknown',
    group_type: 'unknown',
    validation_state: 'pending',
    validated_at: null,
    warning: null,
  }));

  return {
    operational: { version: 1, groups: operationalGroups },
    odoo: { version: 1, groups: commercialGroups },
  };
}

function escribirSalidas({ output, odooOutput, force, operational, odoo }) {
  if (!output || !odooOutput) throw new Error('output_and_odoo_output_are_required');
  if (path.resolve(output) === path.resolve(odooOutput)) throw new Error('outputs_must_be_different');
  for (const target of [output, odooOutput]) {
    if (!force && fs.existsSync(target)) throw new Error(`refusing_to_overwrite:${target}`);
  }

  const outputTemporary = `${output}.${process.pid}.tmp`;
  const odooTemporary = `${odooOutput}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(outputTemporary, `${JSON.stringify(operational, null, 2)}\n`);
    fs.writeFileSync(odooTemporary, `${JSON.stringify(odoo, null, 2)}\n`);
    fs.renameSync(outputTemporary, output);
    fs.renameSync(odooTemporary, odooOutput);
  } finally {
    for (const temporary of [outputTemporary, odooTemporary]) {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
}

function ejecutarMigracion({
  sourceRoot = path.resolve(__dirname, '..'),
  output,
  odooOutput,
  force = false,
  logger = console.log,
}) {
  const { records, sourcesFound } = leerFuentes(sourceRoot, logger);
  const { groups, duplicates, conflictingNames, invalid } = consolidar(records, logger);
  const { operational, odoo } = crearSalidas(groups);
  escribirSalidas({ output, odooOutput, force, operational, odoo });

  logger(`Fuentes encontradas: ${sourcesFound}/${SOURCE_FILES.length}`);
  logger(`Grupos canónicos: ${groups.length}`);
  logger(`IDs duplicados: ${duplicates}`);
  logger(`Conflictos de nombre: ${conflictingNames}`);
  logger(`URLs inválidas omitidas: ${invalid}`);
  logger(`Salida operativa: ${output}`);
  logger(`Seed Odoo: ${odooOutput}`);
  return { sourcesFound, groups: groups.length, duplicates, conflictingNames, invalid };
}

function parseArguments(argv) {
  const options = { force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--force') {
      options.force = true;
      continue;
    }
    if (argument === '--output' || argument === '--odoo-output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`missing_value:${argument}`);
      options[argument === '--output' ? 'output' : 'odooOutput'] = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown_argument:${argument}`);
  }
  if (!options.output || !options.odooOutput) throw new Error('output_and_odoo_output_are_required');
  return options;
}

if (require.main === module) {
  try {
    ejecutarMigracion(parseArguments(process.argv.slice(2)));
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { ejecutarMigracion, parseArguments };
