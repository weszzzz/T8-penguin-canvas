'use strict';

const { CreatorSkillError, canonicalJson } = require('./creatorSkillPackages');

const CONTRACT_SCHEMA = 't8-creator-skill-contract-v1';
function invalid() { throw new CreatorSkillError('CREATOR_SKILL_CONTRACT_INVALID', '技能适配约束不完整或不兼容', 409); }

// Optional host-signed adapter constraints, never taken from private SKILL.md.
// Old bindings without a contract retain their existing v1 interpretation.
function normalizeSkillContract(value) {
  if (value == null) return null;
  if (value.schema !== CONTRACT_SCHEMA || !['image', 'video', 'audio'].includes(value.referenceKind)
    || !Number.isSafeInteger(value.minReferences) || value.minReferences < 0
    || !Number.isSafeInteger(value.maxReferences) || value.maxReferences < value.minReferences || value.maxReferences > 12
    || !Number.isSafeInteger(value.maxOutputs) || value.maxOutputs < 1 || value.maxOutputs > 12
    || !Number.isSafeInteger(value.maxShots) || value.maxShots < 1 || value.maxShots > 12
    || !Array.isArray(value.checks) || value.checks.length < 1 || value.checks.length > 3
    || value.checks.some(check => typeof check !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/u.test(check))
    || new Set(value.checks).size !== value.checks.length) invalid();
  const result = { schema: CONTRACT_SCHEMA, referenceKind: value.referenceKind,
    minReferences: value.minReferences, maxReferences: value.maxReferences,
    maxOutputs: value.maxOutputs, maxShots: value.maxShots, checks: [...value.checks] };
  if (canonicalJson(result) !== canonicalJson(value)) invalid();
  return result;
}

function validateSkillContractAction(contract, assets, action) {
  const fixed = normalizeSkillContract(contract);
  if (!fixed || !action) return;
  const fail = () => { throw new CreatorSkillError('CREATOR_SKILL_ACTION_UNSUPPORTED', '动作素材、数量或镜头超出此技能的适配范围', 409); };
  const units = Array.isArray(action.shots) && action.shots.length ? action.shots : [action];
  if (units.length > fixed.maxShots) fail();
  const byId = new Map(assets.map(asset => [asset.assetId, asset]));
  let outputs = 0;
  for (const unit of units) {
    const refs = unit.inputAssetIds || [];
    if (!Array.isArray(refs) || new Set(refs).size !== refs.length
      || refs.length < fixed.minReferences || refs.length > fixed.maxReferences
      || refs.some(id => byId.get(id)?.kind !== fixed.referenceKind)) fail();
    const count = unit.parameters?.count ?? action.parameters?.count ?? 1;
    if (!Number.isSafeInteger(count) || count < 1) fail();
    outputs += count;
  }
  if (outputs > fixed.maxOutputs) fail();
}

module.exports = { CONTRACT_SCHEMA, normalizeSkillContract, validateSkillContractAction };
