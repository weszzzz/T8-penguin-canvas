'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildSkillPackage, canonicalJson, CreatorSkillError } = require('../backend/src/services/creatorSkillPackages');
const { CreatorSkillStore, CATALOG_SCHEMA, verifyCatalog } = require('../backend/src/services/creatorSkillStore');

const scope = { projectId: 'project-a', actorId: 'creator-a' };
const source = '---\nname: product-ad\ndescription: Compose a product image prompt.\n---\nRespect the input product facts.\n';
const pack = (suffix = '') => buildSkillPackage([{ path: 'SKILL.md', bytes: Buffer.from(source + suffix) }]);
const matches = code => error => error instanceof CreatorSkillError && error.code === code;

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't8-skill-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, store: new CreatorSkillStore({ root, ...options }) };
}

function signedCatalog(pkg, revision = 1, keys = crypto.generateKeyPairSync('ed25519')) {
  const manifest = { schema: CATALOG_SCHEMA, revision, skills: [{
    id: 'product-ad', packageDigest: pkg.packageDigest, title: '商品广告创意图', version: String(revision),
    kind: 'image', adapterId: 'image-v1', quality: { status: 'unverified' },
  }] };
  return { keys, trustedKeys: { 'test-root': keys.publicKey.export({ type: 'spki', format: 'pem' }) },
    envelope: { manifest, keyId: 'test-root', signature: crypto.sign(null, Buffer.from(canonicalJson(manifest)), keys.privateKey).toString('base64') } };
}

test('empty library discovery creates no files; private install is pinned and survives restart', t => {
  const f = fixture(t);
  assert.deepEqual(f.store.list(scope), []);
  assert.deepEqual(fs.readdirSync(f.root), []);
  const pkg = pack();
  const installed = f.store.installPrivate(scope, pkg);
  assert.equal(installed.origin, 'private');
  assert.equal(installed.compatibility, 'text-only');
  assert.equal(installed.quality.status, 'unverified');
  const restarted = new CreatorSkillStore({ root: f.root });
  assert.equal(restarted.list(scope).length, 1);
  assert.equal(restarted.load(scope, installed.id, pkg.packageDigest).context.body, pkg.body);
  restarted.installPrivate(scope, pkg);
  assert.equal(restarted.list(scope).length, 1);
});

test('project and actor scopes remain separate even for identical package hashes', t => {
  const f = fixture(t);
  const pkg = pack();
  const installed = f.store.installPrivate(scope, pkg);
  for (const other of [{ ...scope, projectId: 'project-b' }, { ...scope, actorId: 'creator-b' }]) {
    assert.deepEqual(f.store.list(other), []);
    assert.throws(() => f.store.load(other, installed.id, pkg.packageDigest), matches('CREATOR_SKILL_NOT_FOUND'));
  }
  assert.throws(() => f.store.list({ projectId: '../../outside' }), matches('CREATOR_SKILL_SCOPE_INVALID'));
});

test('same displayed name never silently replaces an existing private package', t => {
  const f = fixture(t);
  const first = f.store.installPrivate(scope, pack());
  const second = f.store.installPrivate(scope, pack('A different method.'));
  assert.notEqual(first.id, second.id);
  assert.equal(f.store.list(scope).length, 2);
});

test('disable and uninstall forbid new execution while retaining read-only bytes', t => {
  const f = fixture(t);
  const pkg = pack();
  const item = f.store.installPrivate(scope, pkg);
  f.store.setStatus(scope, item.id, pkg.packageDigest, 'disabled');
  assert.throws(() => f.store.load(scope, item.id, pkg.packageDigest), matches('CREATOR_SKILL_DISABLED'));
  f.store.setStatus(scope, item.id, pkg.packageDigest, 'active');
  assert.equal(f.store.load(scope, item.id, pkg.packageDigest).executionAllowed, true);
  const removed = f.store.setStatus(scope, item.id, pkg.packageDigest, 'retained');
  assert.equal(removed.retainedForExistingWork, true);
  assert.deepEqual(f.store.list(scope), []);
  const historical = f.store.load(scope, item.id, pkg.packageDigest, { readOnlyRecovery: true });
  assert.equal(historical.pack.packageDigest, pkg.packageDigest);
  assert.equal(historical.context, null);
  assert.equal(historical.executionAllowed, false);
});

test('every status change binds the exact current package version', t => {
  const f = fixture(t);
  const item = f.store.installPrivate(scope, pack());
  assert.throws(() => f.store.setStatus(scope, item.id, 'a'.repeat(64), 'retained'), matches('CREATOR_SKILL_VERSION_STALE'));
  assert.equal(f.store.list(scope)[0].status, 'active');
});

test('catalog signatures rely on host trust roots, not a package self-signed key', () => {
  const signed = signedCatalog(pack());
  assert.equal(verifyCatalog(signed.envelope, signed.trustedKeys).skills[0].kind, 'image');
  assert.throws(() => verifyCatalog({ ...signed.envelope, publicKey: signed.trustedKeys['test-root'] }, {}), matches('CREATOR_SKILL_CATALOG_UNTRUSTED'));
  const changed = JSON.parse(JSON.stringify(signed.envelope));
  changed.manifest.skills[0].adapterId = 'video-v1';
  assert.throws(() => verifyCatalog(changed, signed.trustedKeys), matches('CREATOR_SKILL_CATALOG_UNTRUSTED'));
  assert.throws(() => verifyCatalog(signed.envelope, signed.trustedKeys, 2), matches('CREATOR_SKILL_CATALOG_UNTRUSTED'));
});

test('official adapter authority requires signed descriptor AND matching original package', t => {
  const pkg = pack();
  const signed = signedCatalog(pkg);
  const f = fixture(t, { catalog: signed.envelope, trustedKeys: signed.trustedKeys, packageProvider: () => pkg });
  const item = f.store.installOfficial(scope, 'product-ad', pkg.packageDigest);
  assert.equal(item.origin, 'official');
  assert.equal(item.compatibility, 'image-adapter');
  assert.equal(item.quality.status, 'unverified');
  f.store.packageProvider = () => pack('tampered');
  assert.throws(() => f.store.installOfficial(scope, 'product-ad', pkg.packageDigest), matches('CREATOR_SKILL_INTEGRITY'));
});

test('official signature cannot override a known missing required dependency', t => {
  const pkg = pack('\nRead [required guide](references/missing.md).');
  const signed = signedCatalog(pkg);
  const f = fixture(t, { catalog: signed.envelope, trustedKeys: signed.trustedKeys, packageProvider: () => pkg });
  const item = f.store.installOfficial(scope, 'product-ad', pkg.packageDigest);
  assert.equal(item.adapterId, 'image-v1');
  assert.equal(item.compatibility, 'reference-only');
  assert.ok(item.diagnostics.some(item => item.code === 'missing-resource'));
});

test('official updates are explicit CAS operations; previous fixed version remains read-only', t => {
  const first = pack();
  const signed = signedCatalog(first);
  const f = fixture(t, { catalog: signed.envelope, trustedKeys: signed.trustedKeys, packageProvider: () => first });
  const item = f.store.installOfficial(scope, 'product-ad', first.packageDigest);
  const second = pack('Updated method.');
  const update = signedCatalog(second, 2, signed.keys);
  const next = new CreatorSkillStore({ root: f.root, catalog: update.envelope, trustedKeys: update.trustedKeys, packageProvider: () => second });
  assert.throws(() => next.installOfficial(scope, 'product-ad', second.packageDigest), matches('CREATOR_SKILL_UPDATE_REQUIRED'));
  const updated = next.updateOfficial(scope, item.id, first.packageDigest, second.packageDigest);
  assert.equal(updated.version, '2');
  assert.equal(updated.previousVersions[0].packageDigest, first.packageDigest);
  assert.equal(next.load(scope, item.id, second.packageDigest).pack.body, second.body);
  assert.throws(() => next.load(scope, item.id, first.packageDigest), matches('CREATOR_SKILL_VERSION_STALE'));
  assert.equal(next.load(scope, item.id, first.packageDigest, { readOnlyRecovery: true }).pack.body, first.body);
  const boundTask = next.loadForTask(scope, item.id, first.packageDigest);
  assert.equal(boundTask.executionAllowed, true);
  assert.equal(boundTask.context.body, first.body);
  assert.equal(boundTask.skill.version, '1');
  assert.throws(() => next.updateOfficial(scope, item.id, first.packageDigest, second.packageDigest), matches('CREATOR_SKILL_VERSION_STALE'));
  next.setStatus(scope, item.id, second.packageDigest, 'disabled');
  assert.throws(() => next.loadForTask(scope, item.id, first.packageDigest), matches('CREATOR_SKILL_DISABLED'));
});

test('revocation forbids new activation without destroying existing bytes', t => {
  const f = fixture(t);
  const pkg = pack();
  const item = f.store.installPrivate(scope, pkg);
  const revoked = new CreatorSkillStore({ root: f.root, revokedDigests: [pkg.packageDigest] });
  assert.equal(revoked.list(scope)[0].compatibility, 'revoked');
  assert.throws(() => revoked.load(scope, item.id, pkg.packageDigest), matches('CREATOR_SKILL_REVOKED'));
  assert.throws(() => revoked.loadForTask(scope, item.id, pkg.packageDigest), matches('CREATOR_SKILL_REVOKED'));
  assert.throws(() => revoked.installPrivate(scope, pkg), matches('CREATOR_SKILL_REVOKED'));
  assert.equal(revoked.load(scope, item.id, pkg.packageDigest, { readOnlyRecovery: true }).executionAllowed, false);
});

test('signed catalog replay cannot lower the persisted revision while old pinned work remains readable', t => {
  const first = pack();
  const old = signedCatalog(first, 1);
  const current = signedCatalog(first, 3, old.keys);
  const f = fixture(t, { catalog: current.envelope, trustedKeys: current.trustedKeys, packageProvider: () => first });
  const item = f.store.installOfficial(scope, 'product-ad', first.packageDigest);
  const replayed = new CreatorSkillStore({ root: f.root, catalog: old.envelope, trustedKeys: old.trustedKeys, packageProvider: () => first });
  assert.throws(() => replayed.getCatalog(scope), matches('CREATOR_SKILL_CATALOG_UNTRUSTED'));
  assert.throws(() => replayed.installOfficial(scope, 'product-ad', first.packageDigest), matches('CREATOR_SKILL_CATALOG_UNTRUSTED'));
  assert.equal(replayed.load(scope, item.id, first.packageDigest, { readOnlyRecovery: true }).pack.packageDigest, first.packageDigest);
});

test('failure between package and index commit never marks a partial install available', t => {
  let crash = true;
  const f = fixture(t, { faultInjector: point => { if (point === 'before-index-commit' && crash) throw new Error('injected interruption'); } });
  assert.throws(() => f.store.installPrivate(scope, pack()), /injected interruption/);
  assert.deepEqual(new CreatorSkillStore({ root: f.root }).list(scope), []);
  crash = false;
  const item = f.store.installPrivate(scope, pack());
  assert.equal(f.store.list(scope)[0].id, item.id);
});

test('interleaved writers retry the immutable index commit without losing either install', t => {
  const f = fixture(t);
  const second = new CreatorSkillStore({ root: f.root });
  let interleaved = false;
  f.store.faultInjector = point => {
    if (point === 'before-index-commit' && !interleaved) {
      interleaved = true;
      second.installPrivate(scope, pack('Second writer.'));
    }
  };
  f.store.installPrivate(scope, pack());
  assert.equal(f.store.list(scope).length, 2);
});

test('damaged packages are unavailable but can still be disabled or uninstalled', t => {
  const f = fixture(t);
  const pkg = pack();
  const item = f.store.installPrivate(scope, pkg);
  const scopeDir = fs.readdirSync(f.root)[0];
  const filename = path.join(f.root, scopeDir, 'packages', `${pkg.packageDigest}.json`);
  const record = JSON.parse(fs.readFileSync(filename, 'utf8'));
  record.files[0].content = Buffer.from('changed bytes').toString('base64');
  fs.writeFileSync(filename, JSON.stringify(record));
  assert.equal(f.store.list(scope)[0].compatibility, 'unavailable');
  assert.throws(() => f.store.load(scope, item.id, pkg.packageDigest), matches('CREATOR_SKILL_INTEGRITY'));
  assert.equal(f.store.setStatus(scope, item.id, pkg.packageDigest, 'retained').status, 'retained');
});

test('corrupt latest index fails closed instead of loading an older apparent success', t => {
  const f = fixture(t);
  f.store.installPrivate(scope, pack());
  const scopeDir = fs.readdirSync(f.root)[0];
  fs.writeFileSync(path.join(f.root, scopeDir, 'index', '000000000002.json'), '{incomplete');
  assert.throws(() => f.store.list(scope), matches('CREATOR_SKILL_STORE_INVALID'));
});

test('symlinked store directories cannot redirect library writes', t => {
  const f = fixture(t);
  f.store.installPrivate(scope, pack());
  const scopeDir = fs.readdirSync(f.root)[0];
  const packages = path.join(f.root, scopeDir, 'packages');
  const retained = path.join(f.root, scopeDir, 'retained');
  fs.renameSync(packages, retained);
  fs.symlinkSync(retained, packages, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => f.store.list(scope), matches('CREATOR_SKILL_STORE_PATH'));
});
