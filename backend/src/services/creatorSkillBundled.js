'use strict';

const { CreatorSkillError, verifySkillPackage } = require('./creatorSkillPackages');
const { verifyCatalog } = require('./creatorSkillStore');
const { TRUSTED_CREATOR_SKILL_KEYS } = require('./creatorSkillTrustRoots');
const { bundle } = require('./creatorSkillBundledData');

function bundledCreatorSkillOptions() {
  // All bytes ship with the host and are loaded lazily; no network or mutable
  // checkout path is needed by Electron. Store activation verifies them again.
  const manifest = verifyCatalog(bundle.catalog, TRUSTED_CREATOR_SKILL_KEYS);
  for (const entry of manifest.skills) {
    const pack = verifySkillPackage(bundle.packages[entry.id]);
    if (pack.packageDigest !== entry.packageDigest) throw new CreatorSkillError('CREATOR_SKILL_INTEGRITY', '内置技能与签名目录不一致', 409);
  }
  return {
    catalog: bundle.catalog, trustedKeys: TRUSTED_CREATOR_SKILL_KEYS,
    minimumCatalogRevision: manifest.revision,
    packageProvider: (id, digest) => {
      const pack = bundle.packages[id];
      if (!Object.hasOwn(bundle.packages, id) || pack?.packageDigest !== digest) throw new CreatorSkillError('CREATOR_SKILL_NOT_FOUND', '固定版本内置技能不存在', 404);
      return pack;
    },
  };
}

module.exports = { bundledCreatorSkillOptions };
