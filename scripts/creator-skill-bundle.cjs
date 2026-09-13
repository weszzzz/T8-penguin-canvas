'use strict';

// Maintainer-only build input compiler. Never used by the import HTTP route.
// The one-time bootstrap private key stays in memory and is not retained. New
// signed bundle revisions require an explicitly supplied maintainer key or a
// host-code trust-root update; a package cannot supply its own trust root.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readSkillDirectory, canonicalJson } = require('../backend/src/services/creatorSkillPackages');
const { CATALOG_SCHEMA, verifyCatalog } = require('../backend/src/services/creatorSkillStore');
const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'resources', 'creator-skills');

function readSources() {
  const source = JSON.parse(fs.readFileSync(path.join(SOURCE, 'catalog.json'), 'utf8'));
  const packages = {};
  const skills = source.skills.map(definition => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(definition.id)) throw new Error('Invalid bundled skill id');
    const pack = readSkillDirectory(path.join(SOURCE, definition.id));
    if (pack.metadata.name !== definition.id || pack.metadata.declaredVersion !== definition.version || pack.diagnostics.length) {
      throw new Error(`Bundled skill ${definition.id} is incomplete or inconsistent`);
    }
    packages[definition.id] = pack;
    return { ...definition, packageDigest: pack.packageDigest };
  });
  return { manifest: { schema: CATALOG_SCHEMA, revision: source.revision, skills }, packages };
}

function compile(key, keyId) {
  const source = readSources();
  const trustedKeys = { [keyId]: crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' }) };
  const catalog = { manifest: source.manifest, keyId,
    signature: crypto.sign(null, Buffer.from(canonicalJson(source.manifest)), key).toString('base64') };
  verifyCatalog(catalog, trustedKeys);
  return { trustedKeys, bundle: { catalog, packages: source.packages } };
}

function check() {
  const { bundle } = require('../backend/src/services/creatorSkillBundledData');
  const { TRUSTED_CREATOR_SKILL_KEYS } = require('../backend/src/services/creatorSkillTrustRoots');
  const expected = readSources();
  const manifest = verifyCatalog(bundle.catalog, TRUSTED_CREATOR_SKILL_KEYS);
  if (canonicalJson(manifest) !== canonicalJson(expected.manifest)
    || canonicalJson(bundle.packages) !== canonicalJson(expected.packages)) throw new Error('Bundled skill sources drifted; a signed bundle update is required');
  return { skills: manifest.skills.length, revision: manifest.revision, packageBytes: Buffer.byteLength(JSON.stringify(bundle)), quality: 'unverified' };
}

if (require.main === module) {
  if (process.argv.includes('--check')) console.log(JSON.stringify(check()));
  else if (process.argv.includes('--bootstrap-output')) {
    if (fs.existsSync(path.join(ROOT, 'backend', 'src', 'services', 'creatorSkillTrustRoots.js'))
      || fs.existsSync(path.join(ROOT, 'backend', 'src', 'services', 'creatorSkillBundledData.js'))) {
      throw new Error('Bootstrap already exists. Use a reviewed additive host-key rotation and preserve roots needed by pinned tasks.');
    }
    const keys = crypto.generateKeyPairSync('ed25519');
    console.log(JSON.stringify(compile(keys.privateKey, 'creator-bundled-20260910')));
  } else throw new Error('Use --check, or explicitly --bootstrap-output for a reviewed host-root initialization');
}
module.exports = { readSources, compile, check };
