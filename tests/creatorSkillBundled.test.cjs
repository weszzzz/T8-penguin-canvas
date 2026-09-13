'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { bundledCreatorSkillOptions } = require('../backend/src/services/creatorSkillBundled');
const { CreatorSkillStore, verifyCatalog } = require('../backend/src/services/creatorSkillStore');
const { normalizeSkillContract } = require('../backend/src/services/creatorSkillContracts');
const { createSkillBinding, normalizeSkillBinding, validateSkillAction, skillHostPrompt } = require('../backend/src/services/creatorSkillRuntime');
const { readSources, check } = require('../scripts/creator-skill-bundle.cjs');
const { canonicalJson, hash } = require('../backend/src/services/creatorSkillPackages');

const scope = { projectId: 'bundled-project', canvasId: 'bundled-canvas', actorId: 'local-owner' };
const asset = { assetId: 'product-ref', kind: 'image', contentHash: 'a'.repeat(64), contentRevision: 1 };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't8-bundled-skills-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new CreatorSkillStore({ root, ...bundledCreatorSkillOptions() });
}
const rejected = code => error => error.code === code;

test('bundled directory is offline, signed and exactly reproduces three complete standard packages', () => {
  const facts = check();
  assert.equal(facts.skills, 3);
  assert.ok(facts.packageBytes < 64 * 1024, 'small first-run directory must stay bounded');
  const options = bundledCreatorSkillOptions();
  const manifest = verifyCatalog(options.catalog, options.trustedKeys);
  assert.deepEqual(manifest.skills.map(item => item.kind).sort(), ['image', 'text', 'video']);
  for (const entry of manifest.skills) {
    const pack = options.packageProvider(entry.id, entry.packageDigest);
    assert.deepEqual(pack.diagnostics, []);
    assert.equal(pack.metadata.license, 'MIT');
    assert.equal(pack.metadata.declaredVersion, entry.version);
    assert.equal(pack.metadata.name, entry.id);
    assert.equal(entry.quality.status, 'unverified');
    assert.equal(entry.maintenance.lastValidatedAt, null);
    assert.ok(entry.presentation.inputEn && entry.presentation.outputZh);
  }
  assert.throws(() => verifyCatalog(options.catalog, {}), rejected('CREATOR_SKILL_CATALOG_UNTRUSTED'));
  assert.throws(() => options.packageProvider('__proto__', 'a'.repeat(64)), rejected('CREATOR_SKILL_NOT_FOUND'));
});

test('built-in media skills install with exact host contracts; private copies remain text-only', t => {
  const store = fixture(t);
  assert.deepEqual(store.list(scope), []);
  const options = bundledCreatorSkillOptions();
  for (const entry of store.getCatalog(scope).items) {
    const item = store.installOfficial(scope, entry.id, entry.packageDigest);
    const loaded = store.load(scope, item.id, item.packageDigest);
    assert.equal(loaded.skill.origin, 'official');
    assert.equal(loaded.context.body, loaded.pack.body);
    const binding = createSkillBinding(loaded, { id: item.id, packageDigest: item.packageDigest, taskId: `task-${entry.id}` }, scope, [asset]);
    assert.deepEqual(normalizeSkillBinding(binding), binding);
    const action = { type: entry.kind, inputAssetIds: [asset.assetId], parameters: { count: 1 } };
    if (entry.kind !== 'text') {
      validateSkillAction(binding, action);
      assert.deepEqual(binding.contract, entry.contract);
      assert.equal(binding.definitionDigest, hash(canonicalJson(loaded.skill.definition)));
      assert.match(skillHostPrompt(binding), /checks/);
      for (const invalid of [
        { ...action, inputAssetIds: [] },
        { ...action, inputAssetIds: [asset.assetId, asset.assetId] },
        { ...action, parameters: { count: 2 } },
        { ...action, shots: [{ ...action }, { ...action }] },
      ]) assert.throws(() => validateSkillAction(binding, invalid), rejected('CREATOR_SKILL_ACTION_UNSUPPORTED'));
      const changedType = { ...binding, assets: [{ ...asset, kind: 'audio' }] };
      const { bindingDigest: _, ...content } = changedType;
      changedType.bindingDigest = hash(canonicalJson(content));
      assert.throws(() => validateSkillAction(changedType, action), rejected('CREATOR_SKILL_ACTION_UNSUPPORTED'));
    } else {
      assert.equal(binding.contract, undefined);
      assert.throws(() => validateSkillAction(binding, { ...action, type: 'image' }), rejected('CREATOR_SKILL_ACTION_UNSUPPORTED'));
    }
    const imported = store.installPrivate(scope, options.packageProvider(entry.id, entry.packageDigest));
    assert.equal(imported.adapterId, 'text-v1');
    assert.equal(imported.definition, null);
  }
});

test('signed contract fields are strict and immutable, not a free-form permission manifest', () => {
  const contract = readSources().manifest.skills[0].contract;
  assert.deepEqual(normalizeSkillContract(contract), contract);
  for (const changed of [{ ...contract, maxOutputs: 0 }, { ...contract, command: 'execute' }, { ...contract, maxReferences: 0 }, { ...contract, checks: Array(4).fill('identity') }]) {
    assert.throws(() => normalizeSkillContract(changed), rejected('CREATOR_SKILL_CONTRACT_INVALID'));
  }
});
