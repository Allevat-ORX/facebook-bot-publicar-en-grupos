const { normalizarGrupoFacebook } = require('./catalogo');

const SESSION_TEXTS = [
  'Inicia sesión',
  'Iniciar sesión',
  'Log in',
  'Log In',
  'Your session has expired',
  'Tu sesión ha caducado',
  'Checkpoint',
  'checkpoint',
  'Confirm your identity',
  'Confirma tu identidad',
  'Security Check',
  'Comprobación de seguridad',
];
const MEMBER_TEXTS = [
  'You are a member',
  'You’re a member',
  'Member',
  'Miembro',
  'Eres miembro',
  'Membre',
];
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

async function textoVisible(page, text) {
  try {
    return await page.getByText(text, { exact: false }).first().isVisible();
  } catch (_) {
    return false;
  }
}

async function algunoVisible(page, texts) {
  for (const text of texts) {
    if (await textoVisible(page, text)) return text;
  }
  return null;
}

async function detectarSesionExpirada(page) {
  return Boolean(await algunoVisible(page, SESSION_TEXTS));
}

async function detectarMembresia(page) {
  if (await algunoVisible(page, NOT_MEMBER_TEXTS)) return 'not_member';
  if (await algunoVisible(page, MEMBER_TEXTS)) return 'member';
  return 'unknown';
}

async function detectarTipoCompositor(page) {
  if (await algunoVisible(page, BUY_SELL_TEXTS)) return 'buy_sell';
  if (await algunoVisible(page, QUESTIONNAIRE_TEXTS)) return 'questionnaire';
  if (await algunoVisible(page, STANDARD_TEXTS)) return 'standard';
  return 'unknown';
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
  await page.goto(canonicalGroup.url, { waitUntil: 'domcontentloaded', timeout: 45000 });

  const sessionSignal = await algunoVisible(page, SESSION_TEXTS);
  if (sessionSignal) {
    const warning = sessionSignal.toLowerCase().includes('checkpoint')
      ? 'checkpoint_detected'
      : 'session_expired';
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
