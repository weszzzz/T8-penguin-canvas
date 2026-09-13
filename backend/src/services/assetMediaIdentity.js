'use strict';

const KEYS = ['projectId', 'entityUid', 'contentHash'];
const UID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;

// Optional for legacy media URLs, all-or-nothing when a frozen identity is
// requested. This is a version guard, never an authentication credential.
function validMediaIdentity(identity) {
  return Boolean(identity && typeof identity.projectId === 'string' && identity.projectId.length > 0
    && identity.projectId.length <= 240 && typeof identity.entityUid === 'string' && UID.test(identity.entityUid)
    && typeof identity.contentHash === 'string' && HASH.test(identity.contentHash));
}
function hasMediaIdentity(query) {
  return Object.keys(query || {}).some(key => /^(?:projectId|entityUid|contentHash)(?:\[|$)/.test(key));
}
function matchesMediaIdentity(asset, identity) {
  return validMediaIdentity(identity) && Boolean(asset) && KEYS.every(key => asset[key] === identity[key]);
}
function parseProjectAssetMediaUrl(value) {
  if (typeof value !== 'string') return null;
  const match = /^\/api\/project-assets\/([^/?#]+)\/media(?:\?([^#]+))?$/.exec(value);
  if (!match) return null;
  try {
    const assetId = decodeURIComponent(match[1]);
    if (!assetId || encodeURIComponent(assetId) !== match[1]) return null;
    if (!match[2]) return { assetId, identity: null };
    const params = new URLSearchParams(match[2]);
    const slot = params.getAll('referenceSlot');
    if (slot.length > 1 || (slot.length === 1 && !/^(?:0|[1-9]\d?)$/.test(slot[0]))) return null;
    if ([...params].length !== KEYS.length + slot.length || KEYS.some(key => params.getAll(key).length !== 1)) return null;
    params.delete('referenceSlot'); // Ordering alias, never part of content identity.
    const identity = Object.fromEntries(params);
    return validMediaIdentity(identity) ? { assetId, identity } : null;
  } catch { return null; }
}

module.exports = { validMediaIdentity, hasMediaIdentity, matchesMediaIdentity, parseProjectAssetMediaUrl };
