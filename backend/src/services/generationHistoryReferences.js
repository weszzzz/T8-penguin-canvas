'use strict';

const { parseProjectAssetMediaUrl, matchesMediaIdentity } = require('./assetMediaIdentity');

// Index evidence captured before execution, NOT a physical-byte verification or
// a claim that every URL in a node graph was sent to the Provider. No file reads,
// URL downloads, new assets, or writes occur here.
const SCHEMA = 't8-generation-reference-bindings-v1';
const MAX_ENTRIES = 100;
const HASH = /^[a-f0-9]{64}$/i;
const UID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const unavailable = reason => ({ schema: SCHEMA, status: 'unavailable', reason });
function collectOccurrences(snapshot) {
  const entries = [];
  function visit(value, path) {
    if (typeof value === 'string') {
      if (/^(?:https?:\/\/|\/files\/|\/input\/|\/output\/|\/api\/project-assets\/)/i.test(value)) {
        entries.push({ path, url: value });
        if (entries.length > MAX_ENTRIES) throw new Error('reference-limit');
      }
    } else if (Array.isArray(value)) value.forEach((item, index) => visit(item, [...path, index]));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => visit(item, [...path, key]));
  }
  visit(snapshot.node, ['node']);
  visit(snapshot.upstreamNodes, ['upstreamNodes']);
  return entries;
}
function validManifest(manifest, snapshot) {
  if (!manifest || manifest.schema !== SCHEMA) return false;
  if (manifest.status === 'unavailable') return ['reference-limit', 'input-unavailable'].includes(manifest.reason);
  if (manifest.status !== 'captured' || manifest.coverage !== 'captured-graph-url-occurrences'
    || manifest.timing !== 'node-run-created' || !Array.isArray(manifest.entries) || manifest.entries.length > MAX_ENTRIES) return false;
  if (snapshot) {
    try {
      const expected = collectOccurrences(snapshot).map(entry => entry.path);
      if (JSON.stringify(manifest.entries.map(entry => entry?.path)) !== JSON.stringify(expected)) return false;
    } catch { return false; }
  }
  return Array.from(manifest.entries).every(entry => entry && Array.isArray(entry.path) && entry.path.length <= 9
    && entry.path.length > 0 && ['node', 'upstreamNodes'].includes(entry.path[0])
    && entry.path.every(part => typeof part === 'string' ? part.length <= 200 && !['__proto__', 'constructor', 'prototype'].includes(part) : Number.isSafeInteger(part) && part >= 0)
    && (entry.status === 'unresolved' ? entry.reason === 'unindexed-or-unverified'
      : entry.status === 'bound' && typeof entry.assetId === 'string' && entry.assetId.length <= 240
        && UID.test(entry.entityUid) && HASH.test(entry.contentHash) && typeof entry.kind === 'string'
        && ['cas-index-verified', 'hash-index-only'].includes(entry.storageEvidence)));
}
function captureReferenceManifest(database, projectId, snapshot) {
  let occurrences;
  try { occurrences = collectOccurrences(snapshot); } catch { return unavailable('reference-limit'); }
  const select = `SELECT a.id, a.entity_uid, a.content_hash, a.kind, b.storage_state
    FROM assets a JOIN asset_blob_refs r ON r.asset_id = a.id AND r.project_id = a.project_id
    JOIN asset_blobs b ON b.id = r.blob_id
    WHERE a.project_id = ? AND a.availability = 'available'
      AND r.verification_state = 'verified' AND b.verification_state = 'verified'
      AND b.storage_state <> 'pending-delete' AND b.content_hash = a.content_hash AND `;
  const byUrl = database.db.prepare(select + "a.source_url = ? AND COALESCE(json_extract(a.metadata_json, '$.sourceState'), 'current') <> 'replaced' LIMIT 2");
  const byId = database.db.prepare(select + 'a.id = ? LIMIT 2');
  const cache = new Map();
  const entries = occurrences.map(({ path, url }) => {
    if (!cache.has(url)) {
      const canonical = parseProjectAssetMediaUrl(url);
      let rows = [];
      if (canonical) {
        rows = byId.all(projectId, canonical.assetId);
        if (canonical.identity) rows = rows.filter(row => matchesMediaIdentity({
          projectId, entityUid: row.entity_uid, contentHash: row.content_hash,
        }, canonical.identity));
      } else if (!/^\/api\/project-assets\//i.test(url)) rows = byUrl.all(projectId, url);
      const row = rows.length === 1 ? rows[0] : null;
      cache.set(url, row && UID.test(row.entity_uid) && HASH.test(row.content_hash)
        ? { status: 'bound', assetId: row.id, entityUid: row.entity_uid, contentHash: row.content_hash, kind: row.kind,
          storageEvidence: row.storage_state === 'ready' ? 'cas-index-verified' : 'hash-index-only' }
        : { status: 'unresolved', reason: 'unindexed-or-unverified' });
    }
    return { path, ...cache.get(url) };
  });
  return { schema: SCHEMA, status: 'captured', timing: 'node-run-created', coverage: 'captured-graph-url-occurrences', entries };
}
module.exports = { captureReferenceManifest, validManifest };
