'use strict';

// Host-owned trust roots. Never populate from an uploaded package or catalog.
// This bootstrap root signs only this immutable bundled revision. Its private
// key was used in memory and not retained; future revisions require a reviewed
// host trust-root update. Remote updates are not enabled by this module.
const TRUSTED_CREATOR_SKILL_KEYS = Object.freeze({
  "creator-bundled-20260910": "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAqxDaB4m42Dx3qUNLr8rH/O3g2Vn4Hjsux/5vQ/HHwy4=\n-----END PUBLIC KEY-----\n"
});
module.exports = { TRUSTED_CREATOR_SKILL_KEYS };
