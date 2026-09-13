'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { ProjectDatabase } = require('../backend/src/services/projectDatabase');
const { AssetBlobStore } = require('../backend/src/services/assetBlobStore');
const { captureReferenceManifest, validManifest } = require('../backend/src/services/generationHistoryReferences');
const { listGenerationHistory } = require('../backend/src/services/generationHistory');
const { storedRunInput } = require('../backend/src/services/generationHistoryInputs');
const scope = { projectId: 'reference-project', canvasId: 'reference-canvas' };
const snapshot = urls => ({ schema: 't8-generation-settings-input-v1', purpose: 'prefill-only', complete: true, credentialsOmitted: false,
  node: { id: 'generator', type: 'seedance', position: { x: 0, y: 0 }, data: { prompt: 'reference test', localRefImages: urls } }, upstreamNodes: [], incomingEdges: [] });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't8-history-references-'));
  const filename = path.join(root, 'projects.sqlite3');
  const state = { root, filename, database: null, store: new AssetBlobStore(path.join(root, 'cas')) };
  t.after(async () => { await state.database?.close(); const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(root)); assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative)); fs.rmSync(root, { recursive: true, force: true }); });
  state.database = new ProjectDatabase(filename);
  state.canvas = state.database.ensureCanvas(scope.canvasId, { nodes: [{ id: 'generator', type: 'seedance', position: { x: 0, y: 0 }, data: {} }], edges: [] }, scope.projectId);
  state.install = async (id, text, sourceUrl, projectId = scope.projectId) => {
    const bytes = Buffer.from(text), contentHash = crypto.createHash('sha256').update(bytes).digest('hex');
    const input = path.join(root, `${crypto.randomUUID()}.txt`); fs.writeFileSync(input, bytes);
    let asset;
    await state.store.installVerifiedFile(input, { expectedHash: contentHash, expectedSize: bytes.length, onInstalled: installed => {
      state.database.withProjectDatabaseWrite('asset.upsert', () => {
        state.database.markAssetBlobStored({ ...installed, mimeType: 'text/plain' });
        asset = state.database.upsertAsset({ id, projectId, filename: 'ref.txt', kind: 'text', contentHash, contentHashVerification: 'verified',
          managedPath: installed.path, sourceUrl, storageMode: 'managed', availability: 'available' });
      });
    } });
    return asset;
  };
  return state;
}
test('index binding is captured at NodeRun creation and survives reference replacement, output commit, Run pruning and reopen', async t => {
  const state = fixture(t), database = state.database;
  const original = await state.install('reference', 'original verified bytes', '/files/input/ref.txt');
  const input = snapshot([original.sourceUrl, `/api/project-assets/${original.id}/media`, '/files/input/missing.png']);
  const run = database.createRun({ id: 'reference-run', ...scope, canvasRevision: state.canvas.revision, status: 'succeeded' });
  const node = database.createNodeRun({ id: 'reference-node', runId: run.id, nodeId: 'generator', status: 'succeeded', inputSnapshot: {}, historyInputSnapshot: input });
  assert.equal(JSON.stringify(database.getNodeRun(node.id)).includes('__generationHistoryReferences'), false);
  const atStart = JSON.parse(database.db.prepare('SELECT input_json FROM node_runs WHERE id = ?').get(node.id).input_json).__generationHistoryReferences;
  assert.equal(atStart.status, 'captured'); assert.equal(atStart.entries.length, 3);
  assert.deepEqual(atStart.entries.map(entry => entry.status), ['bound', 'bound', 'unresolved']);
  assert.equal(atStart.entries[0].contentHash, original.contentHash);
  assert.deepEqual(atStart.entries[1].path, ['node', 'data', 'localRefImages', 1]);
  const changed = await state.install(original.id, 'replacement verified bytes', original.sourceUrl);
  assert.notEqual(changed.contentHash, original.contentHash);
  const attempt = database.createAttempt({ nodeRunId: node.id, status: 'succeeded' });
  database.recordRunOutputAssets({ runId: run.id, nodeRunId: node.id, attemptId: attempt.id, outputs: [{ kind: 'video', sourceUrl: '/files/output/fixture.mp4', filename: 'fixture.mp4' }] });
  const list = listGenerationHistory(database, scope);
  const query = { ...scope, groupId: list.groups[0].id, includeInput: true };
  const archived = listGenerationHistory(database, query).groups[0].inputArchive;
  assert.equal(database.db.prepare('SELECT parent_asset_id FROM asset_lineage_events WHERE attempt_id = ?').get(attempt.id).parent_asset_id, null,
    'a reused asset ID with changed bytes must not be recorded as the original input');
  assert.deepEqual(archived.references, atStart, 'never re-resolve the URL at output completion');
  assert.equal(archived.references.entries[0].contentHash, original.contentHash);
  database.setRunRetentionPolicy(scope.projectId, { maxDays: 1, keepReferenced: false });
  const now = Date.now; try { Date.now = () => now() + 3 * 86400000; database.pruneRuns(scope.projectId); } finally { Date.now = now; }
  assert.equal(database.getRun(run.id), null);
  await database.close(); state.database = new ProjectDatabase(state.filename);
  assert.deepEqual(listGenerationHistory(state.database, query).groups[0].inputArchive.references, atStart);
  assert.equal(state.database.getAsset(original.id).contentHash, changed.contentHash, 'current asset is explicitly a different version');
});
test('reference lookup is read-only, project-scoped, ambiguity-rejecting and distinguishes CAS from hash-only evidence', async t => {
  const state = fixture(t), database = state.database;
  const one = await state.install('one', 'one', '/files/input/shared.txt');
  await state.install('two', 'two', '/files/input/shared.txt');
  const other = await state.install('foreign', 'foreign', '/files/input/foreign.txt', 'other-project');
  database.upsertAsset({ id: 'unverified', projectId: scope.projectId, kind: 'image', filename: 'unverified.png', sourceUrl: '/files/input/unverified.png', contentHash: 'a'.repeat(64) });
  database.upsertAsset({ id: 'hash-only', projectId: scope.projectId, kind: 'image', filename: 'linked.png', sourceUrl: '/files/input/linked.png', contentHash: 'b'.repeat(64), contentHashVerification: 'verified' });
  const before = database.db.prepare('SELECT total_changes() AS n').get().n;
  const manifest = captureReferenceManifest(database, scope.projectId, snapshot([one.sourceUrl, `/api/project-assets/${one.id}/media`, other.sourceUrl, `/api/project-assets/${other.id}/media`, '/files/input/unverified.png', '/files/input/linked.png']));
  assert.deepEqual(manifest.entries.map(entry => entry.status), ['unresolved', 'bound', 'unresolved', 'unresolved', 'unresolved', 'bound']);
  assert.equal(manifest.entries[1].storageEvidence, 'cas-index-verified');
  assert.equal(manifest.entries[5].storageEvidence, 'hash-index-only');
  assert.equal(database.db.prepare('SELECT total_changes() AS n').get().n, before);
  assert.equal(validManifest(manifest), true);
  manifest.entries[0] = null; assert.equal(validManifest(manifest), false);
});
test('output lineage uses the original indexed version even after the source URL points at a replacement', async t => {
  const state = fixture(t), database = state.database;
  const old = await state.install('old-version', 'original', '/files/input/versioned.txt');
  const run = database.createRun({ ...scope, canvasRevision: state.canvas.revision, status: 'succeeded' });
  const node = database.createNodeRun({ runId: run.id, nodeId: 'generator', status: 'succeeded', historyInputSnapshot: snapshot([old.sourceUrl]) });
  const replacement = await state.install('new-version', 'new bytes', old.sourceUrl);
  database.upsertAsset({ ...old, metadata: { ...old.metadata, sourceState: 'replaced' } });
  const attempt = database.createAttempt({ nodeRunId: node.id, status: 'succeeded' });
  database.recordRunOutputAssets({ runId: run.id, nodeRunId: node.id, attemptId: attempt.id,
    outputs: [{ kind: 'video', sourceUrl: '/files/output/versioned-result.mp4', filename: 'versioned-result.mp4' }] });
  const events = database.db.prepare('SELECT parent_asset_id FROM asset_lineage_events WHERE attempt_id = ?').all(attempt.id);
  assert.deepEqual(events.map(event => event.parent_asset_id), [old.id]);
  const after = captureReferenceManifest(database, scope.projectId, snapshot([old.sourceUrl, `/api/project-assets/${old.id}/media`]));
  assert.deepEqual(after.entries.map(entry => entry.assetId), [replacement.id, old.id], 'exact asset URLs keep their own version, unlike mutable source URLs');
});
test('too many URL occurrences never produces a silently incomplete manifest and caller fields cannot inject bindings', async t => {
  const state = fixture(t);
  const many = snapshot(Array.from({ length: 101 }, (_, i) => `/files/input/${i}.png`));
  assert.deepEqual(captureReferenceManifest(state.database, scope.projectId, many), { schema: 't8-generation-reference-bindings-v1', status: 'unavailable', reason: 'reference-limit' });
  assert.equal(storedRunInput({ __generationHistoryReferences: { injected: true } }, undefined, 'generator').__generationHistoryReferences, undefined);
  const value = snapshot(['/files/input/a.png']);
  const manifest = captureReferenceManifest(state.database, scope.projectId, value);
  assert.equal(validManifest(manifest, value), true);
  manifest.entries = []; assert.equal(validManifest(manifest, value), false, 'manifest paths cover every captured URL occurrence');
});

test('saved frozen media URLs bind only their original identity, never the current replacement version', async t => {
  const state = fixture(t);
  const original = await state.install('frozen-reference', 'original', '/files/input/frozen.txt');
  const identity = { projectId: original.projectId, entityUid: original.entityUid, contentHash: original.contentHash };
  const url = `/api/project-assets/${original.id}/media?${new URLSearchParams(identity)}`;
  const input = snapshot([url]);
  assert.equal(captureReferenceManifest(state.database, scope.projectId, input).entries[0].assetId, original.id);
  const bad = snapshot([`${url}&contentHash=${original.contentHash}`, `${url}&unknown=1`]);
  assert.deepEqual(captureReferenceManifest(state.database, scope.projectId, bad).entries.map(entry => entry.status), ['unresolved', 'unresolved']);
  await state.install(original.id, 'new bytes', original.sourceUrl);
  assert.equal(captureReferenceManifest(state.database, scope.projectId, input).entries[0].status, 'unresolved');
});
