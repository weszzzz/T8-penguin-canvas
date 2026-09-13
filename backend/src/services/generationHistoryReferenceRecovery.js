'use strict';

const crypto = require('node:crypto');
const SOURCE = 'recovered-input';
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid = () => Object.assign(new Error('历史参考恢复目标无效'), { code: 'generation_reference_target_invalid', status: 409 });
function referenceKey(archive, entry) {
  return hash([archive.digest, entry.assetId, entry.entityUid, entry.contentHash, entry.kind]);
}
function recoveryOperation(archive, entry) { return `explicit-reference-recovery:${referenceKey(archive, entry)}`; }

// Target IDs/hashes come only from a validated immutable archive, not from a
// client assertion. Lazy import avoids a dependency cycle with the read view.
function resolveReferenceRecovery(database, input) {
  const keys = ['referenceGroupId', 'referenceArchiveDigest', 'referenceIndex'];
  if (!keys.some(key => Object.hasOwn(input, key))) return null;
  if (typeof input.referenceGroupId !== 'string' || !input.referenceGroupId || input.referenceGroupId.length > 240
    || typeof input.referenceArchiveDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(input.referenceArchiveDigest)
    || !/^(?:0|[1-9]\d?)$/.test(String(input.referenceIndex)) || !['string', 'number'].includes(typeof input.referenceIndex)) throw invalid();
  const page = require('./generationHistory').listGenerationHistory(database, {
    projectId: input.projectId, canvasId: input.canvasId, groupId: input.referenceGroupId, includeInput: true,
  });
  const archive = page.groups[0]?.inputArchive;
  if (page.groups.length !== 1 || archive?.status !== 'available' || archive.digest !== input.referenceArchiveDigest
    || archive.references?.status !== 'captured') throw invalid();
  const index = Number(input.referenceIndex), entry = archive.references.entries[index];
  if (entry?.status !== 'bound' || !['image', 'video', 'audio'].includes(entry.kind)) throw invalid();
  return { archive, entry, index, operation: recoveryOperation(archive, entry), key: referenceKey(archive, entry) };
}

// Explicit recovery receipts are separate from both the original immutable
// archive and output history. Only scoped detail reads expose this mapping.
function readReferenceRecovery(database, archive, entry) {
  const row = database.db.prepare(`SELECT e.asset_id, e.asset_entity_uid, e.metadata_json
    FROM asset_lineage_events e JOIN assets a ON a.id = e.asset_id AND a.entity_uid = e.asset_entity_uid
    WHERE e.project_id = ? AND e.canvas_id = ? AND e.source_type = ? AND e.derived_operation = ?
      AND a.project_id = e.project_id AND a.content_hash = ? AND a.kind = ?
    ORDER BY e.created_at DESC, e.id DESC LIMIT 1`).get(archive.binding.projectId, archive.binding.canvasId,
      SOURCE, recoveryOperation(archive, entry), entry.contentHash, entry.kind);
  if (!row) return null;
  let saved; try { saved = JSON.parse(row.metadata_json).generationReferenceRecovery; } catch { return null; }
  if (!saved || saved.archiveDigest !== archive.digest || saved.assetId !== entry.assetId
    || saved.entityUid !== entry.entityUid || saved.contentHash !== entry.contentHash || saved.kind !== entry.kind) return null;
  return { assetId: row.asset_id, entityUid: row.asset_entity_uid, contentHash: entry.contentHash, kind: entry.kind };
}
function listReferenceRecoveries(database, archive) {
  if (archive?.status !== 'available' || archive.references?.status !== 'captured') return [];
  const cache = new Map();
  return archive.references.entries.flatMap((entry, referenceIndex) => {
    if (entry.status !== 'bound') return [];
    const key = referenceKey(archive, entry);
    if (!cache.has(key)) cache.set(key, readReferenceRecovery(database, archive, entry));
    const asset = cache.get(key);
    return asset ? [{ referenceIndex, ...asset }] : [];
  });
}
module.exports = { resolveReferenceRecovery, readReferenceRecovery, listReferenceRecoveries, REFERENCE_RECOVERY_SOURCE: SOURCE };
