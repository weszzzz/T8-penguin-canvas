'use strict';

const catalog = require('../shared/creativeModelCatalog.json');
const { modelSnapshot, providerFromSettings, DEFAULT_MODELS, CreatorLlmRuntimeError } = require('./creatorLlmRuntimeV2');
const { CreatorSkillError } = require('./creatorSkillPackages');

function modelPublic(entry, state) {
  return { state, choice: entry ? { providerId: entry.provider, modelId: entry.model,
    label: entry.label || entry.model, catalogDigest: catalog.sourceDigest } : null };
}

function supportsReferences(entry, kind, minimum) {
  if (!minimum) return true;
  const p = entry.parameters || {};
  const field = { image: 'Images', video: 'Videos', audio: 'Audios' }[kind];
  if (!field) return false;
  const supported = kind === 'image' ? p.supportsImages === true || p.supportsReference === true : p[`supports${field}`] === true;
  return supported && Number.isFinite(Number(p[`maxReference${field}`])) && Number(p[`maxReference${field}`]) >= minimum;
}

function buildSkillReadiness(loaded, preferences, settings, attachments = [], config = {}) {
  const requiresVision = attachments.some(asset => ['image', 'video'].includes(asset.kind));
  let llm;
  try {
    const snapshot = modelSnapshot('llm', preferences, { settings, config, requiresVision });
    const entry = catalog.llm.find(item => item.provider === snapshot.providerId && item.model === snapshot.modelId);
    llm = modelPublic(entry, providerFromSettings(snapshot.providerId, snapshot.modelId, settings, config) ? 'configured' : 'missing-credentials');
  } catch (error) {
    if (!(error instanceof CreatorLlmRuntimeError)) throw error;
    llm = modelPublic(null, error.code === 'CREATOR_LLM_VISION_REQUIRED' ? 'incompatible' : 'unavailable');
  }
  const kind = loaded.skill.adapterId?.split('-')[0];
  const contract = loaded.skill.definition?.contract;
  const referenceOnly = loaded.skill.compatibility === 'reference-only';
  let media = modelPublic(null, 'not-required');
  if (!referenceOnly && ['image', 'video'].includes(kind)) {
    const minimum = contract?.minReferences || 0;
    const referenceKind = contract?.referenceKind || 'image';
    const executable = entry => entry.provider === 'seedance-nz' && entry.available !== false
      // A layer/segmentation/export tool isn't a generic image composition.
      && (kind !== 'image' || (entry.parameters?.capabilities || []).some(value => ['t2i', 'i2i'].includes(value)))
      && supportsReferences(entry, referenceKind, minimum);
    const providerAllowed = entry => !preferences.providerId || preferences.providerId === 'auto' || preferences.providerId === entry.provider;
    const explicit = preferences[kind];
    let selected;
    if (explicit) {
      selected = catalog[kind].find(entry => entry.provider === explicit.providerId && entry.model === explicit.modelId && entry.available !== false);
      media = modelPublic(selected, !selected ? 'unavailable' : !providerAllowed(selected) || !executable(selected) ? 'incompatible' : 'configured');
    } else {
      const eligible = catalog[kind].filter(entry => executable(entry) && providerAllowed(entry));
      selected = eligible.find(entry => entry.model === DEFAULT_MODELS[kind])
        || eligible.find(entry => entry.model === `${DEFAULT_MODELS[kind]}-edit`) || eligible[0];
      media = modelPublic(selected, selected ? 'configured' : 'unavailable');
    }
    if (media.state === 'configured' && !providerFromSettings(selected.provider, selected.model, settings, config)) media.state = 'missing-credentials';
    media.kind = kind;
    media.automatic = !explicit;
  }
  const matching = contract ? attachments.filter(asset => asset.kind === contract.referenceKind) : [];
  const input = !contract ? { state: 'ready' } : {
    state: matching.length < contract.minReferences ? 'missing' : matching.length > contract.maxReferences ? 'choose-reference' : 'ready',
    referenceKind: contract.referenceKind, minimum: contract.minReferences, maximum: contract.maxReferences,
  };
  return { schema: 't8-creator-skill-readiness-v1', llm, media, input,
    // "configured" is a local presence/capability check, never remote auth or quality evidence.
    credentialsVerified: false, providerCalls: 0, referenceOnly };
}

function preferencesForSkill(preferences, readiness) {
  if (!readiness || readiness.media.state !== 'configured' || !readiness.media.choice) return preferences;
  const { providerId, modelId } = readiness.media.choice;
  return { ...preferences, [readiness.media.kind]: { providerId, modelId } };
}

function assertSkillTurnInputLimits(input, context) {
  const refs = input.attachments ?? [];
  const nodes = input.selectedNodeIds ?? [];
  if (!Array.isArray(refs) || refs.length > 12 || !Array.isArray(nodes) || nodes.length > 24
    || new Set([...refs.map(item => item?.assetId), ...context.selected.map(item => item.assetId)].filter(Boolean)).size > 12) {
    throw new CreatorSkillError('CREATOR_SKILL_ASSET_SCOPE', '技能引用数量超过本轮支持范围，未静默截断', 409);
  }
}

function assertSkillModelSelection(readiness, action) {
  if (!readiness || !action) return;
  if (readiness.media.state !== 'configured') throw new CreatorSkillError('CREATOR_SKILL_MODEL_REQUIRED', '此技能需要先配置兼容的生成模型，未开始生成', 409);
  const expected = readiness.media.choice;
  if (action.modelSnapshot?.providerId !== expected.providerId || action.modelSnapshot?.modelId !== expected.modelId
    || action.modelSnapshot?.catalogDigest !== expected.catalogDigest) {
    throw new CreatorSkillError('CREATOR_SKILL_MODEL_STALE', '技能动作没有使用当前已选择的兼容模型，请重新整理', 409);
  }
}

module.exports = { buildSkillReadiness, preferencesForSkill, assertSkillTurnInputLimits, assertSkillModelSelection };
