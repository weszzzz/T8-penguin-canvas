'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const { spawnSync } = require('node:child_process');
const { ProjectDatabase } = require('../backend/src/services/projectDatabase');
const { AssetBlobStore } = require('../backend/src/services/assetBlobStore');
const { recoverGenerationHistoryFile } = require('../backend/src/services/generationHistoryRecovery');
const { createHistoryRecoveryHandler } = require('../backend/src/routes/generationHistoryRecovery');
const { listGenerationHistory } = require('../backend/src/services/generationHistory');
const scope = { projectId: 'recovery-project', canvasId: 'recovery-canvas' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't8-history-recovery-test-'));
  const filename = path.join(root, 'projects.sqlite3');
  const state = { database: null, config: { ASSET_BLOB_DIR: path.join(root, 'cas') }, root, filename };
  t.after(async () => { await state.database?.close(); const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(root)); assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative)); fs.rmSync(root, { recursive: true, force: true }); });
  state.database = new ProjectDatabase(filename, options);
  state.database.ensureCanvas(scope.canvasId, { nodes: [], edges: [] }, scope.projectId);
  state.uploadPath = path.join(root, 'selected.png'); fs.writeFileSync(state.uploadPath, png);
  state.recover = (extra = {}) => recoverGenerationHistoryFile(state.database, state.config, { ...scope, uploadPath: state.uploadPath, filename: 'old.png', ...extra });
  return state;
}

async function referenceFixture(t) {
  const state = fixture(t), first = await state.recover();
  state.original = state.database.getAsset(first.assetId);
  const canvas = state.database.getCanvas(scope.canvasId);
  const generator = { id: 'generator', type: 'seedance', position: { x: 0, y: 0 }, data: { prompt: 'original reference', localRefImages: [state.original.sourceUrl] } };
  state.database.saveCanvasSnapshot(scope.canvasId, { ...canvas, nodes: [generator] }, { expectedRevision: canvas.revision });
  const run = state.database.createRun({ id: 'reference-run', ...scope, status: 'succeeded' });
  const node = state.database.createNodeRun({ runId: run.id, nodeId: generator.id, status: 'succeeded', inputSnapshot: {}, historyInputSnapshot: {
    schema: 't8-generation-settings-input-v1', purpose: 'prefill-only', complete: true, credentialsOmitted: false,
    node: generator, upstreamNodes: [], incomingEdges: [],
  } });
  const attempt = state.database.createAttempt({ nodeRunId: node.id, status: 'succeeded' });
  state.database.recordRunOutputAssets({ runId: run.id, nodeRunId: node.id, attemptId: attempt.id,
    outputs: [{ kind: 'video', sourceUrl: '/files/output/synthetic.mp4', filename: 'synthetic.mp4' }] });
  const group = listGenerationHistory(state.database, scope).groups.find(group => group.nodeId === generator.id);
  state.query = { ...scope, groupId: group.id, includeInput: true };
  state.detail = () => listGenerationHistory(state.database, state.query).groups[0];
  state.archive = state.detail().inputArchive;
  assert.equal(state.archive.status, 'available'); assert.equal(state.archive.references.entries[0].status, 'bound');
  state.target = { referenceGroupId: group.id, referenceArchiveDigest: state.archive.digest, referenceIndex: 0 };
  return state;
}

test('explicit input recovery restores exact original identity without adding output history and survives restart/Run pruning', async t => {
  const state = await referenceFixture(t), before = listGenerationHistory(state.database, scope).total;
  state.database.upsertAsset({ ...state.original, availability: 'missing', managedPath: path.join(state.root, 'gone.png') });
  const recovered = await state.recover(state.target);
  assert.equal(recovered.assetId, state.original.id); assert.equal(recovered.duplicate, false);
  assert.equal((await state.recover(state.target)).duplicate, true);
  assert.deepEqual(state.detail().inputArchive, state.archive, 'immutable original archive must not change');
  assert.equal(state.detail().referenceRecoveries[0].entityUid, state.original.entityUid);
  assert.equal(listGenerationHistory(state.database, scope).total, before);
  assert.equal(listGenerationHistory(state.database, scope).groups[0].referenceRecoveries, undefined);
  state.database.setRunRetentionPolicy(scope.projectId, { maxDays: 1, keepReferenced: false });
  const now = Date.now; try { Date.now = () => now() + 3 * 86400000; state.database.pruneRuns(scope.projectId); } finally { Date.now = now; }
  await state.database.close(); state.database = new ProjectDatabase(state.filename);
  assert.equal(state.database.getRun('reference-run'), null);
  assert.equal(state.detail().referenceRecoveries[0].assetId, state.original.id);
  assert.equal((await state.recover(state.target)).duplicate, true);
  assert.deepEqual(fs.readFileSync(state.database.getAsset(recovered.assetId).managedPath), png);
});

test('changed same-ID reference is never overwritten; wrong bytes reject before writes and exact old bytes create an explicit mapping', async t => {
  const state = await referenceFixture(t);
  const replacementPath = path.join(state.root, 'replacement.png');
  await require('sharp')({ create: { width: 16, height: 16, channels: 3, background: '#0000ff' } }).png().toFile(replacementPath);
  const newer = await state.recover({ uploadPath: replacementPath });
  const newerAsset = state.database.getAsset(newer.assetId);
  state.database.upsertAsset({ ...state.original, contentHash: newerAsset.contentHash, contentHashVerification: 'verified', managedPath: newerAsset.managedPath });
  const changes = state.database.db.prepare('SELECT total_changes() AS n').get().n;
  await assert.rejects(state.recover({ ...state.target, uploadPath: replacementPath }), { code: 'generation_reference_content_mismatch' });
  assert.equal(state.database.db.prepare('SELECT total_changes() AS n').get().n, changes);
  const count = listGenerationHistory(state.database, scope).total;
  const restored = await state.recover({ ...state.target, filename: 'renamed-original.png' });
  assert.notEqual(restored.assetId, state.original.id);
  assert.equal(state.database.getAsset(state.original.id).contentHash, newerAsset.contentHash);
  assert.equal(state.detail().referenceRecoveries[0].assetId, restored.assetId);
  assert.equal(state.detail().referenceRecoveries[0].contentHash, state.original.contentHash);
  assert.equal(listGenerationHistory(state.database, scope).total, count);
  assert.equal((await state.recover(state.target)).assetId, restored.assetId);
});

test('reference target requires an exact scoped archived binding and rollback leaves no mapping', async t => {
  const state = await referenceFixture(t);
  for (const extra of [{ referenceIndex: 99 }, { referenceIndex: [0] }, { referenceArchiveDigest: `sha256:${'0'.repeat(64)}` },
    { referenceGroupId: 'other' }, { canvasId: 'other' }, { projectId: 'other' }, { referenceIndex: undefined }]) {
    await assert.rejects(state.recover({ ...state.target, ...extra }));
  }
  const record = state.database.recordAssetLineageEvent;
  state.database.recordAssetLineageEvent = () => { throw new Error('reference receipt interruption'); };
  await assert.rejects(state.recover(state.target), /reference receipt interruption/);
  state.database.recordAssetLineageEvent = () => [];
  await assert.rejects(state.recover(state.target), /参考恢复凭证未保存/);
  state.database.recordAssetLineageEvent = record;
  assert.deepEqual(state.detail().referenceRecoveries, []);
  assert.equal((await state.recover(state.target)).duplicate, false);
  const { publicAssetLineage } = require('../backend/src/services/assetPublicView');
  assert.deepEqual(publicAssetLineage({ metadata: { generationReferenceRecovery: { private: 'input binding' } } }).metadata, {});
});

test('multipart reference recovery checks archive identity and gives an actionable wrong-file error', async t => {
  const state = await referenceFixture(t), app = express();
  app.post('/recover', createHistoryRecoveryHandler({ getDatabase: () => state.database, config: state.config, isTrustedRequest: req => req.headers['x-test-untrusted'] !== '1' }));
  const server = await new Promise(resolve => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); });
  t.after(async () => { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); });
  const upload = async (target, bytes = png, headers) => {
    const form = new FormData(); form.append('file', new Blob([bytes], { type: 'image/png' }), 'selected.png');
    return fetch(`http://127.0.0.1:${server.address().port}/recover?${new URLSearchParams({ ...scope, ...target })}`, { method: 'POST', body: form, headers });
  };
  assert.equal((await upload(state.target, png, { 'x-test-untrusted': '1' })).status, 403);
  assert.equal((await upload({ ...state.target, referenceIndex: '99' })).status, 409);
  const wrong = await require('sharp')({ create: { width: 16, height: 16, channels: 3, background: '#0000ff' } }).png().toBuffer();
  const rejected = await upload(state.target, wrong); assert.equal(rejected.status, 409);
  assert.match((await rejected.json()).error, /与当时的参考内容不一致/);
  assert.deepEqual(state.detail().referenceRecoveries, []);
  assert.equal((await upload(state.target)).status, 201); assert.equal((await upload(state.target)).status, 200);
});

test('selected file is stored in CAS with honest recovery lineage; repeated selection, rename and restart remain deduplicated', async t => {
  const state = fixture(t);
  const first = await state.recover(); assert.equal(first.duplicate, false);
  assert.deepEqual(fs.readFileSync(state.uploadPath), png, 'selected source is never modified');
  assert.equal((await state.recover({ filename: 'renamed.png' })).duplicate, true);
  const before = listGenerationHistory(state.database, scope);
  assert.equal(before.total, 1); assert.equal(before.groups[0].recovered, true);
  assert.equal(before.groups[0].snapshotAvailable, false); assert.equal(before.groups[0].promptPreview, '');
  assert.equal(before.groups[0].outputs[0].evidence, 'local-recovery');
  const blob = state.database.getAssetBlob(first.contentHash);
  assert.equal(blob.storageState, 'ready'); assert.equal(state.database.assetBlobReferenceCount(first.contentHash), 1);
  await state.database.close(); state.database = new ProjectDatabase(state.filename);
  assert.equal((await state.recover()).duplicate, true);
  assert.deepEqual(listGenerationHistory(state.database, scope).groups.map(group => group.id), before.groups.map(group => group.id));
  const stored = await new AssetBlobStore(state.config.ASSET_BLOB_DIR).resolveVerifiedBlob(first.contentHash, png.length);
  assert.deepEqual(fs.readFileSync(stored.path), png);
});

test('cross-project scope, unsupported files and corrupt bytes create no history', async t => {
  const state = fixture(t);
  await assert.rejects(state.recover({ projectId: 'other' }), { status: 404 });
  await assert.rejects(state.recover({ filename: 'payload.exe' }), { status: 400 });
  fs.writeFileSync(state.uploadPath, 'not a PNG');
  await assert.rejects(state.recover());
  assert.equal(listGenerationHistory(state.database, scope).total, 0);
});

test('real temporary video and audio bytes can be recovered and retain correct media kinds', async t => {
  const state = fixture(t);
  const ffmpeg = path.resolve(__dirname, '../tools/ffmpeg-runtime/ffmpeg.exe');
  for (const [filename, args, kind] of [
    ['old-video.mp4', ['-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=0.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p'], 'video'],
    ['old-audio.wav', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-c:a', 'pcm_s16le'], 'audio'],
  ]) {
    const uploadPath = path.join(state.root, filename);
    const encoded = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args, uploadPath], { timeout: 20000, windowsHide: true });
    assert.equal(encoded.status, 0, String(encoded.stderr));
    const recovered = await state.recover({ uploadPath, filename });
    assert.equal(state.database.getAsset(recovered.assetId).kind, kind);
    assert.equal((await state.recover({ uploadPath, filename })).duplicate, true);
  }
  const history = listGenerationHistory(state.database, scope);
  assert.equal(history.total, 2); assert.equal(history.counts.video, 1); assert.equal(history.counts.audio, 1);
});

test('existing generated file is restored without inventing another generation or losing original prompt', async t => {
  const state = fixture(t);
  const recovered = await state.recover();
  const asset = state.database.getAsset(recovered.assetId);
  state.database.ensureCanvas('generated-canvas', { nodes: [], edges: [] }, scope.projectId);
  state.database.recordAssetLineageEvent({ assetId: asset.id, canvasId: 'generated-canvas', sourceType: 'node-output', promptSummary: 'original prompt' });
  state.database.upsertAsset({ ...asset, availability: 'missing', managedPath: path.join(state.root, 'gone.png') });
  const result = await state.recover({ canvasId: 'generated-canvas' });
  assert.equal(result.duplicate, true);
  assert.equal(state.database.getAsset(asset.id).availability, 'available');
  const history = listGenerationHistory(state.database, { ...scope, canvasId: 'generated-canvas' });
  assert.equal(history.total, 1); assert.equal(history.groups[0].promptPreview, 'original prompt');
  assert.equal(history.groups[0].recovered, false);
});

test('reuse-only receipts do not prevent explicit local recovery from creating a visible history entry', async t => {
  const state = fixture(t);
  const recovered = await state.recover();
  state.database.ensureCanvas('reuse-only-canvas', { nodes: [], edges: [] }, scope.projectId);
  state.database.recordAssetLineageEvent({ assetId: recovered.assetId, canvasId: 'reuse-only-canvas', sourceType: 'node-output', metadata: { reusedResult: true } });
  const target = { ...scope, canvasId: 'reuse-only-canvas' };
  assert.equal(listGenerationHistory(state.database, target).total, 0);
  assert.equal((await state.recover(target)).duplicate, false);
  assert.equal((await state.recover(target)).duplicate, true);
  const history = listGenerationHistory(state.database, target);
  assert.equal(history.total, 1);
  assert.equal(history.groups[0].recovered, true);
  assert.equal(history.groups[0].promptPreview, '');
});

test('interrupted ledger transaction rolls back asset and lineage and explicit retry completes once', async t => {
  const state = fixture(t);
  const record = state.database.recordAssetLineageEvent;
  state.database.recordAssetLineageEvent = () => { throw new Error('injected ledger interruption'); };
  await assert.rejects(state.recover(), /injected ledger interruption/);
  assert.equal(state.database.db.prepare('SELECT COUNT(*) AS count FROM assets').get().count, 0);
  assert.equal(listGenerationHistory(state.database, scope).total, 0);
  state.database.recordAssetLineageEvent = record;
  assert.equal((await state.recover()).duplicate, false);
  assert.equal((await state.recover()).duplicate, true);
});

test('committed acknowledgement failure is explicitly non-retryable over HTTP and retains already committed recovery bytes', async t => {
  let inject = false;
  const state = fixture(t, { projectDatabaseWriteAcknowledgementPersistenceOptions32: {
    beforeReplace() { if (inject) throw Object.assign(new Error('synthetic private filesystem failure'), { code: 'EACCES' }); },
  } });
  const app = express();
  app.post('/recover', createHistoryRecoveryHandler({ getDatabase: () => state.database, config: state.config, isTrustedRequest: () => true }));
  const server = await new Promise(resolve => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); });
  t.after(async () => { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); });
  const upload = async () => { const form = new FormData(); form.append('file', new Blob([png], {type:'image/png'}), 'selected.png');
    return fetch(`http://127.0.0.1:${server.address().port}/recover?${new URLSearchParams(scope)}`, {method:'POST',body:form}); };
  inject = true;
  const first = await upload(); const failure = await first.json();
  assert.equal(first.status,503); assert.equal(failure.code,'HISTORY_RECOVERY_COMMIT_UNCONFIRMED');
  assert.equal(failure.committed,true); assert.equal(failure.retryable,false); assert.equal(failure.stopBatch,true);
  assert.ok(!JSON.stringify(failure).includes('synthetic private')); assert.ok(!JSON.stringify(failure).includes(state.root));
  const history = listGenerationHistory(state.database, scope); assert.equal(history.total,1);
  const asset = state.database.getAsset(history.groups[0].outputs[0].assetId);
  assert.deepEqual(fs.readFileSync(asset.managedPath),png);
  const changes = state.database.db.prepare('SELECT total_changes() n').get().n;
  // Exercise the already stopped writer, not a replay of the uncertain write.
  const second = await upload(); const stopped = await second.json();
  assert.equal(second.status,503); assert.equal(stopped.code,'HISTORY_RECOVERY_WRITES_STOPPED');
  assert.equal(stopped.retryable,false); assert.equal(stopped.stopBatch,true);
  assert.equal(state.database.db.prepare('SELECT total_changes() n').get().n,changes);
});

test('real multipart HTTP recovery copies only an explicit file, rejects untrusted requests and persists after reconnect', async t => {
  const state = fixture(t);
  const app = express();
  app.post('/recover', createHistoryRecoveryHandler({ getDatabase: () => state.database, config: state.config, isTrustedRequest: req => req.headers['x-test-untrusted'] !== '1' }));
  const server = await new Promise(resolve => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); });
  t.after(async () => { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}/recover?${new URLSearchParams(scope)}`;
  const upload = async (headers) => { const form = new FormData(); form.append('file', new Blob([png], { type: 'image/png' }), 'selected.png'); return fetch(url, { method: 'POST', body: form, headers }); };
  assert.equal((await upload({ 'x-test-untrusted': '1' })).status, 403);
  const first = await upload(); assert.equal(first.status, 201, JSON.stringify(await first.clone().json()));
  assert.equal((await upload()).status, 200);
  assert.equal((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 415);
  assert.equal(listGenerationHistory(state.database, scope).total, 1);
});
