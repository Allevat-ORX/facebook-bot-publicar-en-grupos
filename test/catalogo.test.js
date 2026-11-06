const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizarGrupoFacebook, crearCatalogo } = require('../catalogo');
const { ejecutarMigracion } = require('../scripts/migrar-catalogo');

test('canonicalizes mobile URLs and strips query strings', () => {
  assert.deepEqual(
    normalizarGrupoFacebook('https://m.facebook.com/groups/912187995658737/?ref=share'),
    {
      facebook_group_id: '912187995658737',
      url: 'https://www.facebook.com/groups/912187995658737/',
    },
  );
});

test('rejects credentials, ports and deceptive hosts', () => {
  for (const url of [
    'http://facebook.com/groups/1/',
    'https://user@facebook.com/groups/1/',
    'https://@facebook.com/groups/1/',
    'https://:@facebook.com/groups/1/',
    'https:facebook.com/groups/1/',
    ' https://facebook.com:443/groups/1/',
    'https://facebook.com:8443/groups/1/',
    'https://facebook.com:443/groups/1/',
    'https://facebook.com.attacker.example/groups/1/',
  ]) {
    assert.throws(() => normalizarGrupoFacebook(url));
  }
});

test('accepts only an exact Facebook group path and strips query and fragment', () => {
  assert.deepEqual(
    normalizarGrupoFacebook('https://facebook.com/groups/constructores.potosinos?ref=share#post'),
    {
      facebook_group_id: 'constructores.potosinos',
      url: 'https://www.facebook.com/groups/constructores.potosinos/',
    },
  );

  for (const url of [
    'https://www.facebook.com/groups/',
    'https://www.facebook.com/groups/1/posts/2',
    'https://www.facebook.com/profile.php?id=1',
    'https://mbasic.facebook.com/groups/1/',
  ]) {
    assert.throws(() => normalizarGrupoFacebook(url));
  }
});

function crearCatalogoTemporal(groups = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orx-catalogo-'));
  const catalogPath = path.join(directory, 'catalogo.json');
  if (groups.length > 0) {
    fs.writeFileSync(catalogPath, `${JSON.stringify({ version: 1, groups }, null, 2)}\n`);
  }
  return { catalogPath, catalogo: crearCatalogo({ path: catalogPath }) };
}

test('reads an absent catalog as empty and finds groups by canonical ID', () => {
  const empty = crearCatalogoTemporal();
  assert.deepEqual(empty.catalogo.leer(), { version: 1, groups: [] });

  const stored = crearCatalogoTemporal([{
    facebook_group_id: '912187995658737',
    url: 'https://www.facebook.com/groups/912187995658737/',
  }]);
  assert.equal(stored.catalogo.buscar('912187995658737').facebook_group_id, '912187995658737');
  assert.equal(stored.catalogo.buscar('missing'), null);
});

test('persists only runtime validation fields and ignores name', () => {
  const { catalogPath, catalogo } = crearCatalogoTemporal([{
    facebook_group_id: '912187995658737',
    url: 'https://www.facebook.com/groups/912187995658737/',
    membership_state: 'unknown',
    group_type: 'unknown',
    validation_state: 'pending',
    validated_at: null,
    warning: null,
  }]);

  const updated = catalogo.guardarValidacion({
    facebook_group_id: '912187995658737',
    name: 'Nombre validado que pertenece a Odoo',
    membership_state: 'member',
    group_type: 'standard',
    validation_state: 'valid',
    validated_at: '2026-11-06T20:00:00Z',
    warning: null,
    cookie: 'must-not-be-written',
    contacts: ['must-not-be-written'],
  });

  assert.deepEqual(Object.keys(updated), [
    'facebook_group_id',
    'url',
    'membership_state',
    'group_type',
    'validation_state',
    'validated_at',
    'warning',
  ]);
  assert.equal(updated.membership_state, 'member');
  assert.equal(updated.name, undefined);
  assert.equal(updated.cookie, undefined);
  assert.equal(updated.contacts, undefined);
  assert.deepEqual(JSON.parse(fs.readFileSync(catalogPath, 'utf8')).groups, [updated]);
});

test('accepts only validated standard member groups as operational destinations', () => {
  const { catalogo } = crearCatalogoTemporal();
  const valid = {
    membership_state: 'member',
    group_type: 'standard',
    validation_state: 'valid',
  };

  assert.equal(catalogo.esDestinoOperativo(valid), true);
  assert.equal(catalogo.esDestinoOperativo({ ...valid, validation_state: 'warning' }), true);
  assert.equal(catalogo.esDestinoOperativo({ ...valid, membership_state: 'unknown' }), false);
  assert.equal(catalogo.esDestinoOperativo({ ...valid, group_type: 'buy_sell' }), false);
  assert.equal(catalogo.esDestinoOperativo({ ...valid, validation_state: 'pending' }), false);
});

function crearRaizMigracion() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'orx-migracion-'));
}

function escribirJson(root, filename, value) {
  fs.writeFileSync(path.join(root, filename), `${JSON.stringify(value, null, 2)}\n`);
}

test('migrates an available historical source into sanitized operational and Odoo outputs', () => {
  const sourceRoot = crearRaizMigracion();
  const output = path.join(sourceRoot, 'operational.json');
  const odooOutput = path.join(sourceRoot, 'odoo.json');
  const messages = [];
  escribirJson(sourceRoot, '_grupos-clasificados.json', [{
    url: 'https://m.facebook.com/groups/912187995658737/?ref=share',
    nombre: 'Contratistas SLP',
    ciudad: 'SLP',
    maquinaria: true,
    empleo: false,
    cookie: 'forbidden',
    contacts: ['forbidden'],
    queue_logs: ['forbidden'],
  }]);

  const summary = ejecutarMigracion({
    sourceRoot,
    output,
    odooOutput,
    logger: (message) => messages.push(message),
  });
  const operational = JSON.parse(fs.readFileSync(output, 'utf8'));
  const odoo = JSON.parse(fs.readFileSync(odooOutput, 'utf8'));

  assert.equal(summary.sourcesFound, 1);
  assert.equal(summary.groups, 1);
  assert.equal(messages.filter((message) => message.startsWith('Fuente ausente:')).length, 3);
  assert.deepEqual(operational, {
    version: 1,
    groups: [{
      facebook_group_id: '912187995658737',
      url: 'https://www.facebook.com/groups/912187995658737/',
      membership_state: 'unknown',
      group_type: 'unknown',
      validation_state: 'pending',
      validated_at: null,
      warning: null,
    }],
  });
  assert.deepEqual(Object.keys(operational.groups[0]), [
    'facebook_group_id',
    'url',
    'membership_state',
    'group_type',
    'validation_state',
    'validated_at',
    'warning',
  ]);
  assert.deepEqual(Object.keys(odoo.groups[0]), [
    'facebook_group_id',
    'url',
    'name',
    'scope',
    'regions',
    'categories',
    'tags',
  ]);
  assert.equal(JSON.stringify(operational).includes('forbidden'), false);
  assert.equal(JSON.stringify(odoo).includes('forbidden'), false);
});

test('recalculates scope from the final merged region set', () => {
  const sourceRoot = crearRaizMigracion();
  const output = path.join(sourceRoot, 'operational.json');
  const odooOutput = path.join(sourceRoot, 'odoo.json');
  escribirJson(sourceRoot, '_grupos-clasificados.json', [{
    url: 'https://www.facebook.com/groups/123/',
    nombre: 'Constructores QRO',
    ciudad: 'QRO',
  }]);
  escribirJson(sourceRoot, 'grupos_ampliados_slp_qro.json', [{
    url: 'https://www.facebook.com/groups/123/',
    nombre: 'Constructores SLP',
    ciudad: 'SLP',
  }]);

  ejecutarMigracion({ sourceRoot, output, odooOutput, logger: () => {} });

  const [group] = JSON.parse(fs.readFileSync(odooOutput, 'utf8')).groups;
  assert.deepEqual(group.regions, ['QRO', 'SLP']);
  assert.equal(group.scope, 'bajio');
});

test('reports duplicate IDs and conflicting names while producing deterministic output', () => {
  const sourceRoot = crearRaizMigracion();
  const messages = [];
  escribirJson(sourceRoot, '_grupos-clasificados.json', [{
    url: 'https://www.facebook.com/groups/123/',
    nombre: 'Nombre principal',
    ciudad: 'QRO',
    maquinaria: true,
    empleo: false,
  }]);
  escribirJson(sourceRoot, '_grupos-detectados.json', [
    'https://www.facebook.com/groups/123/?ref=bookmarks',
  ]);
  escribirJson(sourceRoot, 'grupos_ampliados_slp_qro.json', [{
    url: 'https://facebook.com/groups/123',
    nombre: 'Nombre alternativo',
  }]);

  const firstOutput = path.join(sourceRoot, 'first-operational.json');
  const firstOdooOutput = path.join(sourceRoot, 'first-odoo.json');
  const secondOutput = path.join(sourceRoot, 'second-operational.json');
  const secondOdooOutput = path.join(sourceRoot, 'second-odoo.json');
  const first = ejecutarMigracion({
    sourceRoot,
    output: firstOutput,
    odooOutput: firstOdooOutput,
    logger: (message) => messages.push(message),
  });
  ejecutarMigracion({
    sourceRoot,
    output: secondOutput,
    odooOutput: secondOdooOutput,
    logger: () => {},
  });

  assert.equal(first.duplicates, 2);
  assert.equal(first.conflictingNames, 1);
  assert.ok(messages.some((message) => message.includes('ID duplicado: 123')));
  assert.ok(messages.some((message) => message.includes('Nombres en conflicto: 123')));
  assert.equal(fs.readFileSync(firstOutput, 'utf8'), fs.readFileSync(secondOutput, 'utf8'));
  assert.equal(fs.readFileSync(firstOdooOutput, 'utf8'), fs.readFileSync(secondOdooOutput, 'utf8'));
});

test('refuses to overwrite either output without force', () => {
  const sourceRoot = crearRaizMigracion();
  const output = path.join(sourceRoot, 'existing.json');
  const odooOutput = path.join(sourceRoot, 'odoo.json');
  escribirJson(sourceRoot, '_grupos-detectados.json', ['https://facebook.com/groups/123/']);
  fs.writeFileSync(output, 'do-not-change');

  assert.throws(
    () => ejecutarMigracion({ sourceRoot, output, odooOutput, logger: () => {} }),
    /refusing_to_overwrite/,
  );
  assert.equal(fs.readFileSync(output, 'utf8'), 'do-not-change');
  assert.equal(fs.existsSync(odooOutput), false);

  ejecutarMigracion({ sourceRoot, output, odooOutput, force: true, logger: () => {} });
  assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).groups.length, 1);
});

test('fails without creating outputs when every historical source is absent', () => {
  const sourceRoot = crearRaizMigracion();
  const output = path.join(sourceRoot, 'operational.json');
  const odooOutput = path.join(sourceRoot, 'odoo.json');
  const messages = [];

  assert.throws(
    () => ejecutarMigracion({
      sourceRoot,
      output,
      odooOutput,
      logger: (message) => messages.push(message),
    }),
    /no_historical_sources/,
  );
  assert.equal(messages.filter((message) => message.startsWith('Fuente ausente:')).length, 4);
  assert.equal(fs.existsSync(output), false);
  assert.equal(fs.existsSync(odooOutput), false);
});

test('ships only an empty example and ignores the operational catalog', () => {
  const example = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'catalogo_grupos.ejemplo.json'), 'utf8'));
  const gitignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8').split(/\r?\n/);

  assert.deepEqual(example, { version: 1, groups: [] });
  assert.ok(gitignore.includes('catalogo_grupos.json'));
});
