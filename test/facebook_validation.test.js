const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectarSesionExpirada,
  detectarMembresia,
  detectarTipoCompositor,
  validarGrupoFacebook,
} = require('../facebook_validation');

function pageWithTexts(texts) {
  return {
    getByText(text, options = {}) {
      return {
        first() {
          return {
            isVisible: async () => texts.some((value) => (
              options.exact ? value === text : value.includes(text)
            )),
            click: async () => {},
          };
        },
      };
    },
    locator: () => ({
      first: () => ({
        isVisible: async () => texts.some((value) => (
          ['Escribe algo', 'Escriu alguna cosa', 'Write something', 'Crea una publicación']
            .some((trigger) => value.includes(trigger))
        )),
      }),
    }),
    keyboard: { press: async () => {} },
    goto: async () => {},
  };
}

test('classifies Sell Something as buy_sell', async () => {
  assert.equal(await detectarTipoCompositor(pageWithTexts(['Sell Something'])), 'buy_sell');
});

test('classifies Escribe algo as standard', async () => {
  assert.equal(await detectarTipoCompositor(pageWithTexts(['Escribe algo...'])), 'standard');
});

test('classifies a question composer without opening or publishing it', async () => {
  assert.equal(await detectarTipoCompositor(pageWithTexts(['Ask a question'])), 'questionnaire');
});

test('detects expired sessions and checkpoints', async () => {
  assert.equal(await detectarSesionExpirada(pageWithTexts(['Your session has expired'])), true);
  assert.equal(await detectarSesionExpirada(pageWithTexts(['Checkpoint'])), true);
});

test('detects membership states independently from composer type', async () => {
  assert.equal(await detectarMembresia(pageWithTexts(['You are a member'])), 'member');
  assert.equal(await detectarMembresia(pageWithTexts(['Join Group'])), 'not_member');
  assert.equal(await detectarMembresia(pageWithTexts(['Group overview'])), 'unknown');
});

test('does not classify plural navigation labels as membership', async () => {
  assert.equal(await detectarMembresia(pageWithTexts(['Members'])), 'unknown');
  assert.equal(await detectarMembresia(pageWithTexts(['Miembros'])), 'unknown');
});

test('classifies a singular member action as membership', async () => {
  assert.equal(await detectarMembresia(pageWithTexts(['Member'])), 'member');
});

test('returns unknown for an unrecognized composer', async () => {
  assert.equal(await detectarTipoCompositor(pageWithTexts(['Group overview'])), 'unknown');
});

test('detects an explicit login signal as an expired session', async () => {
  assert.equal(await detectarSesionExpirada(pageWithTexts(['Inicia sesión'])), true);
});

function pageWithGroupName({ heading = '', title = '', texts = [] } = {}) {
  const base = pageWithTexts(texts);
  return {
    ...base,
    locator(selector) {
      if (selector === 'h1') {
        return {
          first: () => ({
            isVisible: async () => Boolean(heading),
            innerText: async () => heading,
          }),
        };
      }
      return base.locator(selector);
    },
    title: async () => title,
  };
}

test('returns the visible h1 as the detected group name', async () => {
  const result = await validarGrupoFacebook(pageWithGroupName({
    heading: 'Contratistas de Querétaro',
    title: 'Fallback title',
    texts: ['You are a member', 'Write something'],
  }), {
    facebook_group_id: '123',
    url: 'https://www.facebook.com/groups/123/',
  });

  assert.equal(result.name, 'Contratistas de Querétaro');
});

test('falls back to the document title when no visible h1 exists', async () => {
  const result = await validarGrupoFacebook(pageWithGroupName({
    title: 'Maquinaria SLP | Grupo de Facebook',
    texts: ['You are a member', 'Write something'],
  }), {
    facebook_group_id: '123',
    url: 'https://www.facebook.com/groups/123/',
  });

  assert.equal(result.name, 'Maquinaria SLP | Grupo de Facebook');
});

test('validates a standard member group without inserting text or publishing', async () => {
  const actions = [];
  const page = {
    ...pageWithTexts(['You are a member', 'Write something']),
    goto: async (url) => actions.push(['goto', url]),
    keyboard: { insertText: async () => actions.push(['insertText']) },
  };

  const result = await validarGrupoFacebook(page, {
    facebook_group_id: '123',
    url: 'https://www.facebook.com/groups/123/',
  });

  assert.equal(result.membership_state, 'member');
  assert.equal(result.group_type, 'standard');
  assert.equal(result.validation_state, 'valid');
  assert.equal(result.warning, null);
  assert.equal(actions.some(([name]) => name === 'insertText'), false);
  assert.equal(actions.some(([name]) => name === 'clickPublish'), false);
});


test('requires a visible contenteditable editor for a standard composer and closes it with Escape', async () => {
  const actions = [];
  const page = {
    getByText: (text) => ({
      first: () => ({
        isVisible: async () => text === 'Write something',
        click: async () => actions.push('open'),
      }),
    }),
    locator: () => ({
      first: () => ({ isVisible: async () => true }),
    }),
    keyboard: { press: async (key) => actions.push(key) },
  };

  assert.equal(await detectarTipoCompositor(page), 'standard');
  assert.deepEqual(actions, ['open', 'Escape']);
});

test('returns unknown when the standard composer has no visible editor', async () => {
  const page = {
    getByText: (text) => ({
      first: () => ({
        isVisible: async () => text === 'Write something',
        click: async () => {},
      }),
    }),
    locator: () => ({
      first: () => ({ isVisible: async () => false }),
    }),
    keyboard: { press: async () => { throw new Error('must not close absent editor'); } },
  };

  assert.equal(await detectarTipoCompositor(page), 'unknown');
});
