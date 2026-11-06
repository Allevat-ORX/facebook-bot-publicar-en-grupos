const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BATCH_UUID = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_BATCH_UUID = '223e4567-e89b-42d3-a456-426614174001';
const FIRST_KEY = `sha256:${'0'.repeat(64)}`;
const SECOND_KEY = `sha256:${'1'.repeat(64)}`;

function freshQueue(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orx-cola-'));
  const queuePath = path.join(directory, 'cola.json');
  process.env.COLA_PATH = queuePath;
  delete require.cache[require.resolve('../cola')];
  const queue = require('../cola');

  t.after(() => {
    delete require.cache[require.resolve('../cola')];
    delete process.env.COLA_PATH;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  return { queue, queuePath, directory };
}

function request(overrides = {}) {
  return {
    batch: {
      batch_uuid: BATCH_UUID,
      lead_id: 2212,
      ...overrides.batch,
    },
    items: overrides.items || [{
      facebook_group_id: '912187995658737',
      grupo: 'https://www.facebook.com/groups/912187995658737/',
      idempotency_key: FIRST_KEY,
      campaign_revision: 1,
      copy: 'Se busca plataforma de tijera',
    }],
  };
}

function completeLegacyItem(estado) {
  return {
    id: `legacy-${estado}`,
    grupo: 'https://www.facebook.com/groups/912187995658737/',
    tipo: 'texto',
    copies: ['Texto histórico'],
    imagen: null,
    link_marketplace: null,
    estado,
    permalink: null,
    log: [],
  };
}

test('repeated identical batch returns existing items without duplicates or another write', (t) => {
  const { queue } = freshQueue(t);
  const originalRename = fs.renameSync;
  let renameCalls = 0;
  fs.renameSync = (...args) => {
    renameCalls += 1;
    return originalRename(...args);
  };

  try {
    const first = queue.encolarLote(request());
    const retry = queue.encolarLote(request());

    assert.equal(first.created.length, 1);
    assert.equal(first.existing.length, 0);
    assert.equal(retry.created.length, 0);
    assert.deepEqual(retry.existing, first.created);
    assert.equal(queue.leerCola().items.length, 1);
    assert.equal(renameCalls, 1);
  } finally {
    fs.renameSync = originalRename;
  }
});

test('rejects a reused batch UUID with changed content deterministically', (t) => {
  const { queue, queuePath } = freshQueue(t);
  queue.encolarLote(request());
  const before = fs.readFileSync(queuePath, 'utf8');

  assert.throws(
    () => queue.encolarLote(request({
      items: [{
        ...request().items[0],
        copy: 'Contenido distinto',
      }],
    })),
    (error) => {
      assert.equal(error.code, 'BATCH_UUID_CONFLICT');
      assert.equal(error.message, `encolarLote: batch_uuid "${BATCH_UUID}" ya existe con contenido diferente`);
      return true;
    },
  );
  assert.equal(fs.readFileSync(queuePath, 'utf8'), before);
});

test('rejects a reused idempotency key with conflicting data deterministically', (t) => {
  const { queue, queuePath } = freshQueue(t);
  queue.encolarLote(request());
  const before = fs.readFileSync(queuePath, 'utf8');

  assert.throws(
    () => queue.encolarLote(request({
      batch: { batch_uuid: OTHER_BATCH_UUID, lead_id: 2212 },
      items: [{
        ...request().items[0],
        copy: 'Conflicto para la misma clave',
      }],
    })),
    (error) => {
      assert.equal(error.code, 'IDEMPOTENCY_KEY_CONFLICT');
      assert.equal(error.message, `encolarLote: idempotency_key "${FIRST_KEY}" ya existe con contenido diferente`);
      return true;
    },
  );
  assert.equal(fs.readFileSync(queuePath, 'utf8'), before);
});

test('rejects identical idempotency key reuse by another batch without writing', (t) => {
  const { queue, queuePath } = freshQueue(t);
  queue.encolarLote(request());
  const before = fs.readFileSync(queuePath);
  const originalRename = fs.renameSync;
  let renameCalls = 0;
  fs.renameSync = (...args) => {
    renameCalls += 1;
    return originalRename(...args);
  };

  try {
    assert.throws(
      () => queue.encolarLote(request({
        batch: { batch_uuid: OTHER_BATCH_UUID, lead_id: 2212 },
      })),
      (error) => {
        assert.equal(error.code, 'IDEMPOTENCY_KEY_CONFLICT');
        assert.equal(error.message, `encolarLote: idempotency_key "${FIRST_KEY}" ya pertenece a otro batch_uuid`);
        return true;
      },
    );
  } finally {
    fs.renameSync = originalRename;
  }

  assert.equal(renameCalls, 0);
  assert.deepEqual(fs.readFileSync(queuePath), before);
  assert.equal(queue.leerCola().items.length, 1);
});

test('rejects mixed reused and new keys from another batch without writing', (t) => {
  const { queue, queuePath } = freshQueue(t);
  queue.encolarLote(request());
  const before = fs.readFileSync(queuePath);
  const originalRename = fs.renameSync;
  let renameCalls = 0;
  fs.renameSync = (...args) => {
    renameCalls += 1;
    return originalRename(...args);
  };
  const newItem = {
    facebook_group_id: '123456789',
    grupo: 'https://www.facebook.com/groups/123456789/',
    idempotency_key: SECOND_KEY,
    campaign_revision: 1,
    copy: 'Se busca excavadora',
  };

  try {
    assert.throws(
      () => queue.encolarLote(request({
        batch: { batch_uuid: OTHER_BATCH_UUID, lead_id: 2212 },
        items: [request().items[0], newItem],
      })),
      (error) => {
        assert.equal(error.code, 'IDEMPOTENCY_KEY_CONFLICT');
        assert.equal(error.message, `encolarLote: idempotency_key "${FIRST_KEY}" ya pertenece a otro batch_uuid`);
        return true;
      },
    );
  } finally {
    fs.renameSync = originalRename;
  }

  assert.equal(renameCalls, 0);
  assert.deepEqual(fs.readFileSync(queuePath), before);
  assert.equal(queue.leerCola().items.length, 1);
});

test('validates every batch item before creating or persisting the queue', (t) => {
  const { queue, queuePath } = freshQueue(t);
  const input = request({
    items: [
      request().items[0],
      {
        facebook_group_id: '123456789',
        grupo: 'https://www.facebook.com/groups/123456789/',
        idempotency_key: 'not-a-sha256-key',
        campaign_revision: 1,
        copy: 'Otro texto',
      },
    ],
  });

  assert.throws(() => queue.encolarLote(input), /items\[1\].*idempotency_key/);
  assert.equal(fs.existsSync(queuePath), false);
});

test('persists a valid multi-item batch with one atomic rename', (t) => {
  const { queue } = freshQueue(t);
  const originalRename = fs.renameSync;
  let renameCalls = 0;
  fs.renameSync = (...args) => {
    renameCalls += 1;
    return originalRename(...args);
  };

  try {
    const result = queue.encolarLote(request({
      items: [
        request().items[0],
        {
          facebook_group_id: '123456789',
          grupo: 'https://www.facebook.com/groups/123456789/',
          idempotency_key: SECOND_KEY,
          campaign_revision: 1,
          copy: 'Se busca excavadora',
        },
      ],
    }));

    assert.equal(result.created.length, 2);
    assert.equal(result.existing.length, 0);
    assert.equal(renameCalls, 1);
    assert.equal(queue.leerCola().version, 2);
  } finally {
    fs.renameSync = originalRename;
  }
});

test('reads every legacy queue state without rewriting v1 bytes', (t) => {
  const { queue, queuePath } = freshQueue(t);
  const legacyStates = ['pendiente', 'aprobado', 'rechazado', 'publicado', 'error'];
  const raw = JSON.stringify({ version: 1, items: legacyStates.map(completeLegacyItem) });
  fs.writeFileSync(queuePath, raw);

  const data = queue.leerCola();

  assert.deepEqual(data.items.map((item) => item.estado), legacyStates);
  assert.equal(fs.readFileSync(queuePath, 'utf8'), raw);
  for (const [index, item] of data.items.entries()) {
    assert.deepEqual(queue.validarItem(item, index), { ok: true, errores: [] });
  }
});

test('maps legacy publicado to published in summaries without mutating history', (t) => {
  const { queue } = freshQueue(t);
  const historical = {
    ...completeLegacyItem('publicado'),
    batch_uuid: BATCH_UUID,
    lead_id: 2212,
  };
  const data = { version: 1, items: [historical] };
  const before = JSON.stringify(data);

  assert.equal(queue.estadoActual(historical), 'published');
  assert.deepEqual(queue.buscarBatch(data, BATCH_UUID), [historical]);
  assert.deepEqual(queue.resumirBatch(data, BATCH_UUID), {
    batch_uuid: BATCH_UUID,
    lead_id: 2212,
    state: 'published',
    terminal: true,
    counts: {
      total: 1,
      queued: 0,
      publishing: 0,
      published: 1,
      error: 0,
      cancelled: 0,
    },
    items: [historical],
  });
  assert.equal(JSON.stringify(data), before);
  assert.equal(historical.estado, 'publicado');
});

test('summarizes active and terminal v2 batches', (t) => {
  const { queue } = freshQueue(t);
  const data = {
    version: 2,
    items: [
      { batch_uuid: BATCH_UUID, lead_id: 2212, estado: 'publishing' },
      { batch_uuid: BATCH_UUID, lead_id: 2212, estado: 'queued' },
      { batch_uuid: OTHER_BATCH_UUID, lead_id: 999, estado: 'error' },
    ],
  };

  const active = queue.resumirBatch(data, BATCH_UUID);
  const absent = queue.resumirBatch(data, '323e4567-e89b-42d3-a456-426614174002');

  assert.equal(active.state, 'publishing');
  assert.equal(active.terminal, false);
  assert.deepEqual(active.counts, {
    total: 2,
    queued: 1,
    publishing: 1,
    published: 0,
    error: 0,
    cancelled: 0,
  });
  assert.equal(absent.lead_id, null);
  assert.equal(absent.state, 'queued');
  assert.equal(absent.terminal, false);
  assert.equal(absent.counts.total, 0);
});

test('atomic save uses mode 0600 and leaves no temporary file', (t) => {
  const { queue, queuePath, directory } = freshQueue(t);

  queue.guardarColaAtomica({ version: 2, items: [] });

  assert.equal(fs.statSync(queuePath).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(directory), ['cola.json']);
});

test('atomic save preserves the old queue and cleans its temp file when rename fails', (t) => {
  const { queue, queuePath, directory } = freshQueue(t);
  const original = JSON.stringify({ version: 1, items: [] });
  fs.writeFileSync(queuePath, original);
  const originalRename = fs.renameSync;
  fs.renameSync = () => {
    throw new Error('simulated rename failure');
  };

  try {
    assert.throws(
      () => queue.guardarColaAtomica({ version: 2, items: [{ id: 'new' }] }),
      /simulated rename failure/,
    );
  } finally {
    fs.renameSync = originalRename;
  }

  assert.equal(fs.readFileSync(queuePath, 'utf8'), original);
  assert.deepEqual(fs.readdirSync(directory), ['cola.json']);
});

test('generates the next ID from the maximum existing daily sequence after gaps', (t) => {
  const { queue } = freshQueue(t);
  const date = new Date().toISOString().slice(0, 10);
  const data = {
    version: 2,
    items: [
      { id: `orx-${date}-0001` },
      { id: `orx-${date}-0003` },
    ],
  };

  assert.equal(queue.generarId(data), `orx-${date}-0004`);
});

test('updates a v2 item atomically while preserving legacy update exports', (t) => {
  const { queue } = freshQueue(t);
  const created = queue.encolarLote(request()).created[0];
  const data = queue.leerCola();

  const updated = queue.actualizarItem(data, created.id, 'published', {
    permalink: 'https://www.facebook.com/groups/912187995658737/posts/1',
  });

  assert.equal(updated.estado, 'published');
  assert.equal(updated.permalink, 'https://www.facebook.com/groups/912187995658737/posts/1');
  assert.equal(queue.leerCola().items[0].estado, 'published');
  assert.equal(typeof queue.guardarCola, 'function');
  assert.equal(typeof queue.marcarItem, 'function');
  assert.equal(typeof queue.encolarItem, 'function');
});
