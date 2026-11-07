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
    getByText(text) {
      return {
        first() {
          return { isVisible: async () => texts.some((value) => value.includes(text)) };
        },
      };
    },
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
