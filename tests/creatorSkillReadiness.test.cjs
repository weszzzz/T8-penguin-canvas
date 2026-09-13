'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSkillReadiness, preferencesForSkill, assertSkillTurnInputLimits, assertSkillModelSelection } = require('../backend/src/services/creatorSkillReadiness');
const { bundledCreatorSkillOptions } = require('../backend/src/services/creatorSkillBundled');
const catalog = require('../backend/src/shared/creativeModelCatalog.json');
const entries = bundledCreatorSkillOptions().catalog.manifest.skills;
const loaded = kind => ({ skill: { adapterId: `${kind}-v1`, compatibility: `${kind}-adapter`, definition: entries.find(entry => entry.kind === kind) } });
const settings = { zhenzhenSd2ApiKey: 'fixture-only-do-not-return' };
const refs = [{ assetId: 'product-1', kind: 'image' }];

test('automatic skill selection bypasses the text-only image default without changing ordinary saved preferences', () => {
  const preferences = { providerId: 'auto', llm: null, image: null, video: null };
  const original = structuredClone(preferences);
  const readiness = buildSkillReadiness(loaded('image'), preferences, settings, refs);
  assert.equal(readiness.media.state, 'configured');
  assert.equal(readiness.media.choice.modelId, 'zhenzhen-image-gk-v2-edit');
  assert.equal(readiness.llm.choice.modelId, 'zhenzhen/gk-4.6');
  assert.equal(readiness.input.state, 'ready');
  assert.equal(readiness.credentialsVerified, false);
  assert.equal(readiness.providerCalls, 0);
  assert.equal(JSON.stringify(readiness).includes(settings.zhenzhenSd2ApiKey), false);
  const applied = preferencesForSkill(preferences, readiness);
  assert.equal(applied.image.modelId, readiness.media.choice.modelId);
  assert.deepEqual(preferences, original);
  assert.deepEqual(preferencesForSkill(preferences, null), original);
  assert.ok(catalog.image.find(entry => entry.model === readiness.media.choice.modelId).parameters.maxReferenceImages >= 1);
});

test('explicit incompatible models are explained rather than silently replaced', () => {
  for (const modelId of ['zhenzhen-image-gk-v2', 'zhenzhen-image-gk-v2-segment', 'unknown-model']) {
    const preferences = { providerId: 'auto', image: { providerId: 'seedance-nz', modelId } };
    const readiness = buildSkillReadiness(loaded('image'), preferences, settings, refs);
    assert.ok(['incompatible', 'unavailable'].includes(readiness.media.state));
    assert.equal(readiness.media.automatic, false);
    assert.deepEqual(preferencesForSkill(preferences, readiness), preferences);
  }
  const supported = buildSkillReadiness(loaded('image'), { image: { providerId: 'seedance-nz', modelId: 'zhenzhen-image-g-v2.5-flare' } }, settings, refs);
  assert.equal(supported.media.state, 'configured');
  assert.equal(supported.media.choice.modelId, 'zhenzhen-image-g-v2.5-flare');
});

test('credentials, visual chat compatibility and missing/ambiguous input are distinct readiness facts', () => {
  const absent = buildSkillReadiness(loaded('image'), {}, {}, refs);
  assert.equal(absent.llm.state, 'missing-credentials');
  assert.equal(absent.media.state, 'missing-credentials');
  const noVision = buildSkillReadiness(loaded('image'), { llm: { providerId: 'seedance-nz', modelId: 'qwen/qwen3.7-max' } }, settings, refs);
  assert.equal(noVision.llm.state, 'incompatible');
  assert.equal(buildSkillReadiness(loaded('video'), {}, settings, []).input.state, 'missing');
  assert.equal(buildSkillReadiness(loaded('video'), {}, settings, [...refs, { assetId: 'product-2', kind: 'image' }]).input.state, 'choose-reference');
  assert.equal(buildSkillReadiness(loaded('text'), {}, settings, []).media.state, 'not-required');
});

test('skill preflight and execution cannot drop excess references or swap the selected model', () => {
  assert.throws(() => assertSkillTurnInputLimits({ attachments: Array(13).fill(refs[0]) }, { selected: [] }), { code: 'CREATOR_SKILL_ASSET_SCOPE' });
  assert.throws(() => assertSkillTurnInputLimits({}, { selected: Array.from({ length: 13 }, (_, index) => ({ assetId: `ref-${index}` })) }), { code: 'CREATOR_SKILL_ASSET_SCOPE' });
  const readiness = buildSkillReadiness(loaded('image'), {}, settings, refs);
  assertSkillModelSelection(readiness, { modelSnapshot: readiness.media.choice });
  assert.throws(() => assertSkillModelSelection(readiness, { modelSnapshot: { ...readiness.media.choice, modelId: 'different' } }), { code: 'CREATOR_SKILL_MODEL_STALE' });
  assert.throws(() => assertSkillModelSelection(buildSkillReadiness(loaded('image'), {}, {}, refs), { modelSnapshot: readiness.media.choice }), { code: 'CREATOR_SKILL_MODEL_REQUIRED' });
});
