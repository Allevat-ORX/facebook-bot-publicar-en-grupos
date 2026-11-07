const { normalizarGrupoFacebook } = require('./catalogo');

const SESSION_TEXTS = [
  'Inicia sesión',
  'Iniciar sesión',
  'Log in',
  'Log In',
  'Your session has expired',
  'Tu sesión ha caducado',
];
const CHECKPOINT_TEXTS = [
  'Checkpoint',
  'checkpoint',
  'Confirm your identity',
  'Confirma tu identidad',
  'Security Check',
  'Comprobación de seguridad',
];
const MEMBER_PHRASES = [
  'You are a member',
  'You’re a member',
  'Eres miembro',
];
const MEMBER_ACTION_TEXTS = ['Member', 'Miembro', 'Membre'];
const NOT_MEMBER_TEXTS = [
  'Join Group',
  'Join group',
  'Unirse al grupo',
  'Solicitar unirse',
  'Request to join',
];
const STANDARD_TEXTS = [
  'Escribe algo',
  'Escriu alguna cosa',
  'Write something',
  'Crea una publicación',
];
const BUY_SELL_TEXTS = ['Sell Something', 'Vender algo'];
const QUESTIONNAIRE_TEXTS = [
  'Ask a question',
  'Haz una pregunta',
  'Pregunta algo',
];

async function textoVisible(page, text, options = {}) {
  try {
    return await page.getByText(text, { exact: false, ...options }).first().isVisible();
  } catch (_) {
    return false;
  }
}

async function algunoVisible(page, texts, options = {}) {
  for (const text of texts) {
    if (await textoVisible(page, text, options)) return text;
  }
  return null;
}

async function detectarSesionExpirada(page) {
  return Boolean(
    (await algunoVisible(page, SESSION_TEXTS))
    || (await algunoVisible(page, CHECKPOINT_TEXTS)),
  );
}

async function detectarMembresia(page) {
  if (await algunoVisible(page, NOT_MEMBER_TEXTS)) return 'not_member';
  if (await algunoVisible(page, MEMBER_PHRASES)) return 'member';
  if (await algunoVisible(page, MEMBER_ACTION_TEXTS, { exact: true })) return 'member';
  return 'unknown';
}

async function detectarTipoCompositor(page) {
  if (await algunoVisible(page, BUY_SELL_TEXTS)) return 'buy_sell';
  if (await algunoVisible(page, QUESTIONNAIRE_TEXTS)) return 'questionnaire';

  const standardTrigger = await algunoVisible(page, STANDARD_TEXTS);
  if (!standardTrigger) return 'unknown';

  const trigger = page.getByText(standardTrigger, { exact: false }).first();
  if (typeof trigger.click !== 'function') return 'unknown';
  try {
    await trigger.click();
  } catch (_) {
    return 'unknown';
  }

  const selectors = [
    '[contenteditable="true"][role="textbox"]',
    'div[data-lexical-editor="true"]',
    'div[role="textbox"][contenteditable="true"]',
    '[contenteditable="true"]',
  ];
  let editorVisible = false;
  if (typeof page.locator === 'function') {
    for (const selector of selectors) {
      try {
        if (await page.locator(selector).first().isVisible()) {
          editorVisible = true;
          break;
        }
      } catch (_) {}
    }
  }
  if (!editorVisible) return 'unknown';

  try {
    if (page.keyboard && typeof page.keyboard.press === 'function') {
      await page.keyboard.press('Escape');
    }
  } catch (_) {
    return 'unknown';
  }
  return 'standard';
}

function resultadoBase(group, membershipState, groupType, validationState, warning) {
  return {
    facebook_group_id: group.facebook_group_id,
    url: group.url,
    membership_state: membershipState,
    group_type: groupType,
    validation_state: validationState,
    validated_at: new Date().toISOString(),
    warning,
  };
}

async function validarGrupoFacebook(page, group) {
  const normalized = normalizarGrupoFacebook(group?.url);
  if (normalized.facebook_group_id !== group?.facebook_group_id) {
    throw new Error('facebook_group_mismatch');
  }

  const canonicalGroup = {
    facebook_group_id: normalized.facebook_group_id,
    url: normalized.url,
  };
  try {
    await page.goto(canonicalGroup.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (_) {
    return resultadoBase(canonicalGroup, 'unknown', 'unknown', 'invalid', 'navigation_error');
  }

  const checkpointSignal = await algunoVisible(page, CHECKPOINT_TEXTS);
  const sessionSignal = checkpointSignal || await algunoVisible(page, SESSION_TEXTS);
  if (sessionSignal) {
    const warning = checkpointSignal ? 'checkpoint_detected' : 'session_expired';
    return resultadoBase(canonicalGroup, 'unknown', 'unknown', 'warning', warning);
  }

  const membershipState = await detectarMembresia(page);
  if (membershipState !== 'member') {
    return resultadoBase(canonicalGroup, membershipState, 'unknown', 'warning', 'membership_not_confirmed');
  }

  const groupType = await detectarTipoCompositor(page);
  if (groupType !== 'standard') {
    return resultadoBase(canonicalGroup, membershipState, groupType, 'warning', 'unsupported_composer');
  }

  return resultadoBase(canonicalGroup, membershipState, groupType, 'valid', null);
}

module.exports = {
  detectarSesionExpirada,
  detectarMembresia,
  detectarTipoCompositor,
  validarGrupoFacebook,
};
