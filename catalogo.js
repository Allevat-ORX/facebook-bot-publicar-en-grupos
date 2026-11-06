const fs = require('node:fs');

const HOSTS = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com']);
const CAMPOS_VALIDACION = [
  'membership_state',
  'group_type',
  'validation_state',
  'validated_at',
  'warning',
];

function normalizarGrupoFacebook(value) {
  if (typeof value !== 'string') throw new Error('invalid_facebook_group_url');

  let parsed;
  try {
    parsed = new URL(value);
  } catch (_) {
    throw new Error('invalid_facebook_group_url');
  }

  const authority = value.match(/^[A-Za-z][A-Za-z\d+.-]*:\/\/([^/?#]*)/)?.[1] || '';
  const hostWithOptionalPort = authority.slice(authority.lastIndexOf('@') + 1);
  if (
    parsed.protocol !== 'https:'
    || !authority
    || authority.includes('@')
    || parsed.username
    || parsed.password
    || hostWithOptionalPort.includes(':')
    || !HOSTS.has(parsed.hostname)
  ) {
    throw new Error('invalid_facebook_group_url');
  }

  const match = parsed.pathname.match(/^\/groups\/([A-Za-z0-9._-]+)\/?$/);
  if (!match) throw new Error('invalid_facebook_group_path');

  const facebookGroupId = match[1];
  return {
    facebook_group_id: facebookGroupId,
    url: `https://www.facebook.com/groups/${facebookGroupId}/`,
  };
}

function crearCatalogo({ path }) {
  function leer() {
    if (!fs.existsSync(path)) return { version: 1, groups: [] };
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  }

  function buscar(facebookGroupId) {
    return leer().groups.find((group) => group.facebook_group_id === facebookGroupId) || null;
  }

  function guardarValidacion(resultado) {
    const data = leer();
    const group = data.groups.find(
      (candidate) => candidate.facebook_group_id === resultado?.facebook_group_id,
    );
    if (!group) throw new Error('facebook_group_not_found');

    for (const field of CAMPOS_VALIDACION) {
      if (Object.prototype.hasOwnProperty.call(resultado, field)) group[field] = resultado[field];
    }

    const temporaryPath = `${path}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(data, null, 2)}\n`);
    fs.renameSync(temporaryPath, path);
    return group;
  }

  function esDestinoOperativo(group) {
    return Boolean(
      group
      && group.membership_state === 'member'
      && group.group_type === 'standard'
      && ['valid', 'warning'].includes(group.validation_state),
    );
  }

  return { leer, buscar, guardarValidacion, esDestinoOperativo };
}

module.exports = { normalizarGrupoFacebook, crearCatalogo };
