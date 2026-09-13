'use strict';

const crypto = require('crypto');
const path = require('path');
const { extensionInfo, readStableAssetSource } = require('./assetIndexer');
const { getAssetBlobStore } = require('./assetBlobStore');
const { resolveReferenceRecovery, readReferenceRecovery, REFERENCE_RECOVERY_SOURCE } = require('./generationHistoryReferenceRecovery');

const HISTORY_SOURCES = ['node-output', 'host-node-output', 'recovered-output'];
function recoveryError(message, status = 400) {
  return Object.assign(new Error(message), { code: 'generation_history_recovery_invalid', status });
}
function validateRecoveryScope(database, input) {
  const { projectId, canvasId } = input || {};
  if (![projectId, canvasId].every(value => typeof value === 'string' && value.trim() && value.length <= 240 && !/[\u0000-\u001f]/u.test(value))) {
    throw recoveryError('请选择找回文件所属的项目和画布');
  }
  const canvas = database.getCanvas(canvasId);
  if (!canvas || canvas.projectId !== projectId) throw recoveryError('画布不存在或不属于当前项目', 404);
  return { projectId, canvasId };
}

/** Receives only the route's private uploaded copy, never a client-supplied
 * host path. CAS bytes and the existing asset/lineage ledgers are the authority.
 * No Run, model, original generation time, or prompt is fabricated. */
async function recoverGenerationHistoryFile(database, config, input, options = {}) {
  const scope = validateRecoveryScope(database, input);
  const target = resolveReferenceRecovery(database, input);
  const filename = path.basename(String(input.filename || '').replace(/\\/g, '/')).slice(0, 240);
  const info = extensionInfo(filename);
  if (!['image', 'video', 'audio'].includes(info.kind)) throw recoveryError('请选择图像、视频或音频文件');
  const source = await readStableAssetSource(input.uploadPath, info.kind, { attempts: 2 });
  if (!source.stat.size || source.metadata.health === 'corrupt') throw recoveryError('文件为空或已损坏，未加入历史');
  if (target && (source.contentHash !== target.entry.contentHash || info.kind !== target.entry.kind)) {
    throw Object.assign(recoveryError('文件内容与当时的参考不一致，未恢复', 409), { code: 'generation_reference_content_mismatch' });
  }
  const blobStore = options.blobStore || getAssetBlobStore(config);
  // A changed/deleted last reference may leave this exact blob behind the
  // durable deletion fence. Use the existing verified GC protocol for this
  // hash only before reinstalling the user's private uploaded copy. Never
  // revive pending-delete in place or collect unrelated blobs.
  const pending = target && database.getAssetBlob(source.contentHash);
  if (pending?.storageState === 'pending-delete' && database.assetBlobReferenceCount(source.contentHash) === 0) {
    await blobStore.removeVerifiedBlob(source.contentHash, {
      expectedSize: pending.byteSize,
      beforeDelete: () => database.getAssetBlob(source.contentHash)?.storageState === 'pending-delete'
        && database.assetBlobReferenceCount(source.contentHash) === 0,
    });
    database.markAssetBlobDeleted(source.contentHash);
  }
  let result;
  await blobStore.installVerifiedFile(input.uploadPath, {
    expectedHash: source.contentHash, expectedSize: source.stat.size,
    onInstalled: installed => {
      // All identity lookup, blob reference, asset and lineage writes commit
      // together while the CAS content lock is held. Retrying a lost response
      // does not invent another recovered generation.
      result = database.withProjectDatabaseWrite('asset.history.recover', () => {
        validateRecoveryScope(database, scope);
        if (target && resolveReferenceRecovery(database, input)?.key !== target.key) throw recoveryError('历史参考已变化', 409);
        const recovered = target && readReferenceRecovery(database, target.archive, target.entry);
        const original = target && database.getAsset(target.entry.assetId);
        const keepOriginal = original && original.projectId === scope.projectId && original.entityUid === target.entry.entityUid
          && original.contentHash === target.entry.contentHash && original.kind === target.entry.kind;
        const row = !target && database.db.prepare(`SELECT a.id FROM assets a
          JOIN asset_lineage_events e ON e.asset_id = a.id AND e.asset_entity_uid = a.entity_uid
          WHERE a.project_id = ? AND e.project_id = ? AND e.canvas_id = ?
            AND a.content_hash = ? AND e.source_type IN (${HISTORY_SOURCES.map(() => '?').join(',')})
            AND COALESCE(json_type(e.metadata_json, '$.reusedResult'), '') <> 'true'
          ORDER BY e.created_at, e.id LIMIT 1`).get(scope.projectId, scope.projectId, scope.canvasId, source.contentHash, ...HISTORY_SOURCES);
        const id = target ? (recovered?.assetId || (keepOriginal ? original.id : `reference_recovered_${target.key.slice(0, 32)}`))
          : row?.id || `recovered_${crypto.createHash('sha256').update(JSON.stringify([scope.projectId, source.contentHash])).digest('hex').slice(0, 32)}`;
        const existing = database.getAsset(id);
        if (existing && (existing.projectId !== scope.projectId || existing.contentHash !== source.contentHash)) throw recoveryError('素材身份冲突，未覆盖原记录', 409);
        database.markAssetBlobStored({ ...installed, mimeType: info.mimeType });
        const asset = database.upsertAsset({
          ...(existing || {}), id, projectId: scope.projectId,
          kind: existing?.kind || info.kind, filename: existing?.filename || filename,
          mimeType: existing?.mimeType || info.mimeType, contentHash: source.contentHash, contentHashVerification: 'verified',
          managedPath: installed.path, sourceUrl: `/api/project-assets/${encodeURIComponent(id)}/media`,
          storageMode: 'managed', availability: 'available',
          metadata: { ...(existing?.metadata || {}), ...source.metadata, size: installed.byteSize, health: 'ok' },
          provenance: existing?.provenance || { source: 'local-history-recovery' },
          createdBy: existing?.createdBy || 'local-owner', createdAt: existing?.createdAt || Date.now(),
        });
        if (target) database.recordAssetLineageEvent({
          assetId: id, canvasId: scope.canvasId, sourceType: REFERENCE_RECOVERY_SOURCE,
          derivedOperation: target.operation, creatorId: 'local-owner', metadata: { generationReferenceRecovery: {
            archiveDigest: target.archive.digest, assetId: target.entry.assetId, entityUid: target.entry.entityUid,
            contentHash: target.entry.contentHash, kind: target.entry.kind,
          } },
        });
        else if (!row) database.recordAssetLineageEvent({
          assetId: id, canvasId: scope.canvasId, sourceType: 'recovered-output',
          derivedOperation: 'explicit-local-file-recovery', creatorId: 'local-owner',
          outputOrdinal: 0, metadata: { contentHash: source.contentHash, recovered: true },
        });
        if (target) {
          const receipt = readReferenceRecovery(database, target.archive, target.entry);
          if (!receipt || receipt.assetId !== asset.id || receipt.entityUid !== asset.entityUid) {
            throw recoveryError('参考恢复凭证未保存，未报告成功', 409);
          }
        }
        return { assetId: asset.id, duplicate: Boolean(target ? recovered : row), contentHash: source.contentHash };
      });
    },
  });
  return result;
}

module.exports = { recoverGenerationHistoryFile, validateRecoveryScope };
