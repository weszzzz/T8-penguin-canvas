'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { ProjectDatabase } = require('../backend/src/services/projectDatabase');
const { listGenerationHistory } = require('../backend/src/services/generationHistory');
const { AssetIndexer } = require('../backend/src/services/assetIndexer');
const { AssetBlobStore } = require('../backend/src/services/assetBlobStore');
const { readGenerationHistoryInput } = require('../backend/src/services/generationHistoryInputs');

const scope = { projectId: 'history-project', canvasId: 'history-canvas' };
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-generation-history-'));
  const filename = path.join(directory, 'projects.sqlite3');
  const state = { database: null, filename };
  t.after(async () => {
    await state.database?.close();
    const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(directory));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  state.database = new ProjectDatabase(filename);
  return state;
}
function generation(database, label, options = {}) {
  const target = { ...scope, ...options.scope };
  const nodeId = options.nodeId || 'sd2-source';
  const canvas = database.ensureCanvas(target.canvasId, {
    nodes: [{ id: nodeId, entityUid: randomUUID(), type: 'seedance', position: { x: 0, y: 0 }, data: { prompt: 'current canvas prompt' } }], edges: [],
  }, target.projectId);
  const run = database.createRun({ id: `history-run-${label}`, ...target, canvasRevision: canvas.revision, status: 'succeeded' });
  const nodeRun = database.createNodeRun({ id: `history-node-${label}`, runId: run.id, nodeId, originalNodeId: nodeId,
    status: 'succeeded', inputSnapshot: options.inputSnapshot || { schema: 't8-run-node-input-v1', replayable: true,
      node: { id: nodeId, type: 'seedance', position: { x: 0, y: 0 }, data: { prompt: `frozen prompt ${label}` } }, upstreamNodes: [], incomingEdges: [] },
    historyInputSnapshot: options.historyInputSnapshot,
  });
  const attempt = database.createAttempt({ id: `history-attempt-${label}`, nodeRunId: nodeRun.id,
    provider: 'fixture-provider', model: options.model || `model-${label}`, status: 'succeeded', metadata: options.attemptMetadata || {} });
  const outputs = Array.from({ length: options.count || 1 }, (_, index) => ({
    kind: options.outputKinds?.[index] || options.kind || 'video', sourceUrl: options.url || `/files/output/${label}-${index}.mp4`,
    filename: `${label}-${index}.mp4`, storageMode: 'managed', availability: 'available',
    contentHash: 'a'.repeat(64),
  }));
  // SQLite/lineage fixture only: no claim that these media bytes were generated.
  const recorded = database.recordRunOutputAssets({ runId: run.id, nodeRunId: nodeRun.id, attemptId: attempt.id, outputs });
  return { run, nodeRun, attempt, outputs, ...recorded };
}

test('frontend-resolved values and prompt preview survive Run pruning/reopen without rewriting the raw graph', async t => {
  const state = fixture(t);
  const historyInputSnapshot = { schema: 't8-generation-settings-input-v1', purpose: 'prefill-only', complete: true, credentialsOmitted: false,
    node: { id: 'sd2-source', type: 'seedance', position: { x: 0, y: 0 }, data: { prompt: 'Raw node prompt', historyResolvedInput: {
      schema: 't8-seedance-frontend-input-v1', origin: 'frontend-request', prompt: 'Actual effective upstream prompt',
      model: 'historical-model', seedanceNzModel: 'fast', seedanceApiSource: 'auto', providerSource: 'zhenzhen',
      duration: 7, ratio: '9:16', resolution: '720p', generateAudio: true, returnLastFrame: false, watermark: false, webSearch: false,
      seed: -1, maxPoll: 360, pollInt: 10, frameMode: 'auto', localRefImages: [], localRefVideos: [], localRefAudios: [], providerParams: { motion: 0.25 },
    } } }, upstreamNodes: [], incomingEdges: [] };
  const entry = generation(state.database, 'resolved', { historyInputSnapshot });
  const before = listGenerationHistory(state.database, scope);
  assert.equal(before.groups[0].promptPreview, 'Actual effective upstream prompt');
  const query = { ...scope, groupId: before.groups[0].id, includeInput: true };
  const archive = listGenerationHistory(state.database, query).groups[0].inputArchive;
  assert.equal(archive.snapshot.node.data.duration, undefined);
  assert.deepEqual(archive.snapshot, historyInputSnapshot);
  state.database.setRunRetentionPolicy(scope.projectId, { maxDays: 1, keepReferenced: false });
  const now = Date.now; try { Date.now = () => now() + 3 * 86400000; state.database.pruneRuns(scope.projectId); } finally { Date.now = now; }
  await state.database.close(); state.database = new ProjectDatabase(state.filename);
  assert.equal(state.database.getRun(entry.run.id), null);
  assert.deepEqual(listGenerationHistory(state.database, query).groups[0].inputArchive, archive);
  assert.equal(listGenerationHistory(state.database, scope).groups[0].promptPreview, 'Actual effective upstream prompt');
});

test('three changed-prompt generations remain independently visible after node removal and database reopen', async t => {
  const state = fixture(t);
  const { database } = state;
  for (const label of ['first', 'second', 'third']) generation(database, label);
  const before = listGenerationHistory(database, scope);
  assert.equal(before.total, 3);
  assert.ok(before.groups.every(group => group.sourceNodeExists));
  assert.deepEqual(new Set(before.groups.map(group => group.promptPreview)), new Set(['frozen prompt first', 'frozen prompt second', 'frozen prompt third']));
  const current = database.getCanvas(scope.canvasId);
  database.saveCanvasSnapshot(scope.canvasId, { nodes: [], edges: [] }, { expectedRevision: current.revision });
  await database.close();
  state.database = new ProjectDatabase(state.filename);
  const after = listGenerationHistory(state.database, scope);
  assert.deepEqual(after.groups.map(group => group.id), before.groups.map(group => group.id));
  assert.ok(after.groups.every(group => !group.sourceNodeExists && group.snapshotAvailable));
  assert.equal(after.groups.flatMap(group => group.outputs).length, 3);
});

test('empty MODAL/maintenance output and failed/stopped attempts never turn retained input media into another generation after reopen', async t => {
  const state = fixture(t); const previous = generation(state.database, 'before-modal');
  const before = listGenerationHistory(state.database, scope);
  for (const [label, status, nodeType] of [
    ['modal', 'succeeded', 'image'], ['validation', 'failed', 'image'], ['cancelled', 'stopped', 'image'],
    ['catalog-refresh', 'succeeded', 'volcengine-assets'], ['runtime-install', 'succeeded', 'localization-master'],
  ]) {
    const run = state.database.createRun({ id: `empty-${label}`, ...scope, canvasRevision: state.database.getCanvas(scope.canvasId).revision, status });
    const nodeRun = state.database.createNodeRun({ runId: run.id, nodeId: 'sd2-source', status,
      inputSnapshot: { schema: 't8-run-node-input-v1', replayable: true, node: { id: 'sd2-source', type: nodeType,
        position: { x: 0, y: 0 }, data: { prompt: 'new prompt', imageUrl: previous.outputs[0].sourceUrl, imageUrls: [previous.outputs[0].sourceUrl] } }, upstreamNodes: [], incomingEdges: [] },
    });
    state.database.createAttempt({ nodeRunId: nodeRun.id, status, provider: 'fixture-provider', model: 'midjourney-modal' });
    if (status === 'succeeded') state.database.appendRunEvent(run.id, { nodeRunId: nodeRun.id, type: 'node.output',
      payload: { status: 'succeeded', outputCount: 0, assets: [], ...(label === 'modal' ? { interactionRequired: true } : {}) },
    });
  }
  assert.deepEqual(listGenerationHistory(state.database, scope).groups.map(group => group.id), before.groups.map(group => group.id));
  await state.database.close(); state.database = new ProjectDatabase(state.filename);
  const reopened = listGenerationHistory(state.database, scope);
  assert.equal(reopened.total, 1); assert.deepEqual(reopened.groups.map(group => group.id), before.groups.map(group => group.id));
  assert.equal(reopened.groups[0].promptPreview, 'frozen prompt before-modal');
});

test('deduplicated files do not merge separate generations or overwrite their original provider/model descriptions', t => {
  const { database } = fixture(t);
  const one = generation(database, 'one', { url: '/files/output/same.mp4', model: 'original-model' });
  const two = generation(database, 'two', { url: '/files/output/same.mp4', model: 'later-model' });
  assert.equal(one.assets[0].id, two.assets[0].id, 'exercise actual legacy asset deduplication');
  const result = listGenerationHistory(database, scope);
  assert.equal(result.total, 2);
  assert.deepEqual(new Set(result.groups.map(group => group.model)), new Set(['original-model', 'later-model']));
  database.recordRunOutputAssets({ runId: two.run.id, nodeRunId: two.nodeRun.id, attemptId: two.attempt.id, outputs: two.outputs });
  assert.equal(listGenerationHistory(database, scope).total, 2, 'lost-response replay must not add a generation');
});

test('node history and cursors bind stable source identity across deletion and display-ID reuse', async t => {
  const state = fixture(t);
  const { database } = state;
  const first = generation(database, 'identity-old-1');
  generation(database, 'identity-old-2');
  const oldUid = database.getNodeRun(first.nodeRun.id).nodeEntityUid;
  assert.ok(oldUid);
  const oldPage = listGenerationHistory(database, { ...scope, nodeId: 'sd2-source', limit: 1 });
  assert.equal(oldPage.scope.nodeEntityUid, oldUid);
  assert.ok(oldPage.groups[0].sourceNodeExists);
  const current = database.getCanvas(scope.canvasId);
  database.saveCanvasSnapshot(scope.canvasId, { nodes: [], edges: [] }, { expectedRevision: current.revision });
  const deleted = database.getCanvas(scope.canvasId);
  database.saveCanvasSnapshot(scope.canvasId, { nodes: [{ id: 'sd2-source', entityUid: 'a1000000-0000-4000-8000-000000000099', type: 'seedance', position: { x: 1, y: 2 }, data: {} }], edges: [] }, { expectedRevision: deleted.revision });
  const fresh = generation(database, 'identity-new');
  const newUid = database.getNodeRun(fresh.nodeRun.id).nodeEntityUid;
  assert.notEqual(newUid, oldUid);
  const all = listGenerationHistory(database, scope);
  assert.equal(all.total, 3);
  assert.equal(all.groups.filter(group => group.sourceNodeExists).length, 1);
  assert.equal(all.groups.find(group => group.sourceNodeExists).nodeEntityUid, newUid);
  assert.equal(listGenerationHistory(database, { ...scope, nodeId: 'sd2-source' }).total, 1);
  assert.equal(listGenerationHistory(database, { ...scope, nodeId: 'sd2-source', nodeEntityUid: oldUid }).total, 2);
  assert.throws(() => listGenerationHistory(database, { ...scope, nodeId: 'sd2-source', limit: 1, cursor: oldPage.nextCursor }), { status: 400 });
  const oldTail = listGenerationHistory(database, { ...scope, nodeId: 'sd2-source', nodeEntityUid: oldUid, limit: 1, cursor: oldPage.nextCursor });
  assert.equal(oldTail.groups.length, 1);
  assert.equal(oldTail.groups[0].sourceNodeExists, false);
  assert.throws(() => listGenerationHistory(database, { ...scope, nodeEntityUid: oldUid }), { status: 400 });
  assert.throws(() => listGenerationHistory(database, { ...scope, nodeId: 'sd2-source', nodeEntityUid: 'invalid' }), { status: 400 });
  await database.close(); state.database = new ProjectDatabase(state.filename);
  assert.equal(listGenerationHistory(state.database, { ...scope, nodeId: 'sd2-source' }).total, 1);
  assert.equal(listGenerationHistory(state.database, { ...scope, nodeId: 'sd2-source', nodeEntityUid: oldUid }).total, 2);
});

test('unverified legacy source remains visible but cannot be attributed to a same-ID current node', t => {
  const { database } = fixture(t);
  const first = generation(database, 'identity-known');
  database.recordAssetLineageEvent({ assetId: first.assets[0].id, canvasId: scope.canvasId, sourceNodeId: 'sd2-source', sourceType: 'node-output', promptSummary: 'legacy unknown identity' });
  const all = listGenerationHistory(database, scope);
  assert.equal(all.total, 2);
  const legacy = all.groups.find(group => group.promptPreview === 'legacy unknown identity');
  assert.equal(legacy.nodeEntityUid, null);
  assert.equal(legacy.sourceNodeExists, false);
  assert.equal(listGenerationHistory(database, { ...scope, nodeId: 'sd2-source' }).total, 1);
});

test('intentional legacy output reuse keeps runtime receipts but never adds history, including after retention and reopen', async t => {
  const state = fixture(t);
  const { database } = state;
  const originalNow = Date.now;
  let first, reused, next;
  try {
    Date.now = () => originalNow() - 5 * 24 * 60 * 60 * 1000;
    const url = '/files/output/shared.mp4';
    first = generation(database, 'reuse-original', { url });
    reused = generation(database, 'reuse-cached', { url, attemptMetadata: { reusedResult: true, source: 'existing-node-output' } });
    next = generation(database, 'reuse-new-generation', { url, attemptMetadata: { reusedResult: false } });
  } finally { Date.now = originalNow; }
  assert.equal(reused.assets[0].id, first.assets[0].id);
  assert.ok(database.getNodeRun(reused.nodeRun.id).outputRefs.includes(first.assets[0].id));
  const expected = new Set([`attempt:${first.attempt.entityUid}`, `attempt:${next.attempt.entityUid}`]);
  const verify = () => {
    const page = listGenerationHistory(state.database, { ...scope, kind: 'video', limit: 1 });
    assert.equal(page.total, 2);
    assert.equal(page.counts.all, 2);
    assert.equal(page.counts.video, 2);
    assert.equal(listGenerationHistory(state.database, { ...scope, nodeId: 'sd2-source' }).total, 2);
    const tail = listGenerationHistory(state.database, { ...scope, kind: 'video', limit: 1, cursor: page.nextCursor });
    assert.deepEqual(new Set([...page.groups, ...tail.groups].map(group => group.id)), expected);
    assert.throws(() => listGenerationHistory(state.database, { ...scope, groupId: `attempt:${reused.attempt.entityUid}` }), { status: 404 });
  };
  verify();
  database.setRunRetentionPolicy(scope.projectId, { maxDays: 1, keepReferenced: false });
  database.pruneRuns(scope.projectId);
  assert.equal(database.getRun(reused.run.id), null);
  verify();
  await database.close();
  state.database = new ProjectDatabase(state.filename);
  verify();
});

test('cursor pagination has no duplicates and rejects cross-scope cursor reuse', t => {
  const { database } = fixture(t);
  for (let index = 0; index < 13; index++) generation(database, `page-${index}`);
  generation(database, 'another-canvas', { scope: { canvasId: 'another-canvas' } });
  generation(database, 'another-project', { scope: { projectId: 'another-project', canvasId: 'private-canvas' } });
  const ids = [];
  let cursor;
  do {
    const page = listGenerationHistory(database, { ...scope, limit: 3, ...(cursor ? { cursor } : {}) });
    assert.equal(page.total, 13);
    ids.push(...page.groups.map(group => group.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(ids.length, 13);
  assert.equal(new Set(ids).size, 13);
  const page = listGenerationHistory(database, { ...scope, limit: 1 });
  assert.throws(() => listGenerationHistory(database, { ...scope, canvasId: 'another-canvas', cursor: page.nextCursor }), { code: 'GENERATION_HISTORY_INVALID' });
  assert.throws(() => listGenerationHistory(database, { ...scope, projectId: 'another-project' }), { status: 404 });
  assert.equal(listGenerationHistory(database, { ...scope, nodeId: "' OR 1=1 --" }).total, 0);
  assert.throws(() => listGenerationHistory(database, { canvasId: scope.canvasId }), { status: 400 });
  assert.throws(() => listGenerationHistory(database, { ...scope, cursor: 'bad' }), { status: 400 });
});

test('multiple outputs stay in one generation and remain reachable through bounded group expansion', t => {
  const { database } = fixture(t);
  generation(database, 'batch', { count: 7 });
  generation(database, 'image', { kind: 'image' });
  const list = listGenerationHistory(database, { ...scope, kind: 'video' });
  assert.equal(list.total, 1);
  assert.equal(list.counts.all, 2);
  assert.equal(list.counts.image, 1);
  assert.equal(list.groups[0].outputCount, 7);
  assert.equal(list.groups[0].outputs.length, 4);
  assert.equal(list.groups[0].hasMoreOutputs, true);
  const tail = listGenerationHistory(database, { ...scope, kind: 'video', groupId: list.groups[0].id, outputOffset: 4 });
  assert.equal(tail.groups[0].outputs.length, 3);
  assert.equal(tail.groups[0].hasMoreOutputs, false);
  assert.deepEqual(tail.groups[0].outputs.map(output => output.outputOrdinal), [4, 5, 6]);
});

test('bulk page reads keep mixed-kind batches, duplicate receipts, original provenance and offset bounds intact', t => {
  const { database } = fixture(t);
  const generated = generation(database, 'mixed-kind', { count: 30, outputKinds: Array.from({length:30}, (_,i)=>i%2 ? 'image' : 'video') });
  database.recordAssetLineageEvent({assetId:generated.assets[0].id,canvasId:scope.canvasId,runId:generated.run.id,nodeRunId:generated.nodeRun.id,attemptId:generated.attempt.id,
    sourceType:'host-node-output',sourceNodeId:'sd2-source',outputOrdinal:0,derivedOperation:'duplicate-fixture',createdAt:Date.now()+1000,metadata:{model:'must-not-replace-original'}});
  const all = listGenerationHistory(database, scope);
  assert.equal(all.total,1);assert.equal(all.groups[0].outputCount,30);
  const images = listGenerationHistory(database,{...scope,kind:'image'});
  assert.equal(images.total,1);assert.equal(images.counts.all,1);assert.equal(images.counts.video,1);assert.equal(images.counts.image,1);
  assert.equal(images.groups[0].outputCount,15);
  assert.deepEqual(images.groups[0].outputs.map(output=>output.outputOrdinal),[1,3,5,7]);
  const tail=listGenerationHistory(database,{...scope,kind:'image',groupId:images.groups[0].id,outputOffset:4,includeInput:true});
  assert.deepEqual(tail.groups[0].outputs.map(output=>output.outputOrdinal),Array.from({length:11},(_,i)=>9+i*2));
  assert.equal(tail.groups[0].model,'model-mixed-kind');assert.equal(tail.groups[0].inputArchive.status,'available');
  assert.equal(tail.groups[0].hasMoreOutputs,false);
  const beyond=listGenerationHistory(database,{...scope,kind:'image',groupId:images.groups[0].id,outputOffset:999});
  assert.deepEqual(beyond.groups[0].outputs,[]);assert.equal(beyond.groups[0].model,'model-mixed-kind');
});

test('missing media remains discoverable without exposing paths, secrets, or making read queries mutate state', t => {
  const { database } = fixture(t);
  const result = generation(database, 'missing', { model: 'fixture sk-sensitive123456789' });
  const asset = result.assets[0];
  database.upsertAsset({ ...asset, availability: 'missing', managedPath: 'C:\\Users\\Private\\secret.mp4' });
  const before = database.db.prepare('SELECT total_changes() AS changes').get().changes;
  const page = listGenerationHistory(database, scope);
  assert.equal(page.groups[0].outputs[0].availability, 'missing');
  assert.equal(page.groups[0].outputs[0].mediaUrl, null);
  assert.equal(JSON.stringify(page).includes('sensitive123456789'), false);
  assert.equal(JSON.stringify(page).includes('Private'), false);
  assert.equal(database.db.prepare('SELECT total_changes() AS changes').get().changes, before);
});

test('normal Run retention keeps lineage history and its validated archived input visible', t => {
  const { database } = fixture(t);
  const originalNow = Date.now;
  let result;
  try {
    Date.now = () => originalNow() - 5 * 24 * 60 * 60 * 1000;
    result = generation(database, 'retained');
  } finally { Date.now = originalNow; }
  database.setRunRetentionPolicy(scope.projectId, { maxDays: 1, keepReferenced: false });
  database.pruneRuns(scope.projectId);
  assert.equal(database.getRun(result.run.id), null);
  const page = listGenerationHistory(database, scope);
  assert.equal(page.total, 1);
  assert.equal(page.groups[0].snapshotAvailable, true);
  assert.equal(page.groups[0].promptPreview, 'frozen prompt retained');
  assert.equal(page.groups[0].outputs[0].assetId, result.assets[0].id);
});

test('a batch archives complete settings once, preserves them after prune/reopen, and only explicit scoped detail returns them', async t => {
  const state = fixture(t);
  const { database } = state;
  const originalNow = Date.now;
  let result;
  try {
    Date.now = () => originalNow() - 5 * 24 * 60 * 60 * 1000;
    result = generation(database, 'input-batch', { count: 7 });
  } finally { Date.now = originalNow; }
  const events = database.db.prepare('SELECT * FROM asset_lineage_events WHERE attempt_id = ? ORDER BY created_at, id').all(result.attempt.id);
  assert.equal(events.filter(event => JSON.parse(event.metadata_json).generationInput).length, 1);
  assert.equal(events.filter(event => JSON.parse(event.metadata_json).generationInputRef).length, 6);
  const archived = readGenerationHistoryInput(database, events.find(event => JSON.parse(event.metadata_json).generationInputRef));
  assert.equal(archived.status, 'available');
  assert.equal(archived.snapshot.node.data.prompt, 'frozen prompt input-batch');
  assert.equal(JSON.stringify(database.listAssetLineage(result.assets[0].id)).includes('generationInput'), false);
  const list = listGenerationHistory(database, scope);
  assert.equal(list.groups[0].snapshotAvailable, true);
  assert.equal(list.groups[0].inputArchive, undefined, 'no full snapshots in paged lists');
  assert.throws(() => listGenerationHistory(database, { ...scope, includeInput: true }), { status: 400 });
  const query = { ...scope, groupId: list.groups[0].id, includeInput: true };
  assert.deepEqual(listGenerationHistory(database, query).groups[0].inputArchive, archived);
  database.recordRunOutputAssets({ runId: result.run.id, nodeRunId: result.nodeRun.id, attemptId: result.attempt.id, outputs: result.outputs });
  assert.equal(database.db.prepare('SELECT COUNT(*) AS n FROM asset_lineage_events WHERE attempt_id = ?').get(result.attempt.id).n, 7);
  database.setRunRetentionPolicy(scope.projectId, { maxDays: 1, keepReferenced: false }); database.pruneRuns(scope.projectId);
  assert.equal(database.getNodeRun(result.nodeRun.id), null);
  await database.close(); state.database = new ProjectDatabase(state.filename);
  assert.deepEqual(listGenerationHistory(state.database, query).groups[0].inputArchive, archived);
  assert.throws(() => listGenerationHistory(state.database, { ...query, canvasId: 'unrelated' }), { status: 404 });
  const wrongRef = { ...events[0], metadata_json: JSON.stringify({ generationInputRef: events[1].id }), project_id: 'another-project' };
  assert.equal(readGenerationHistoryInput(state.database, wrongRef).status, 'unavailable');
});

test('an incomplete live NodeRun never claims settings availability or archives sensitive input', t => {
  const { database } = fixture(t);
  generation(database, 'incomplete', { inputSnapshot: { node: { id: 'sd2-source', type: 'seedance', data: { prompt: 'a redacted preview' } } } });
  const result = listGenerationHistory(database, scope);
  assert.equal(result.groups[0].snapshotAvailable, false);
  assert.equal(result.groups[0].snapshotUnavailableReason, 'input-incomplete-or-unsafe');
});

test('long settings-only input survives retention without entering legacy Run replies or being clipped', async t => {
  const state = fixture(t);
  const prompt = '原始长提示词与参数完整保留。'.repeat(1200);
  const settings = { schema: 't8-generation-settings-input-v1', purpose: 'prefill-only', complete: true, credentialsOmitted: false,
    node: { id: 'sd2-source', type: 'seedance', position: { x: 0, y: 0 }, data: { prompt, seed: 123, duration: 10 } },
    upstreamNodes: [], incomingEdges: [] };
  const legacy = { schema: 't8-run-node-input-v1', replayable: false, nodeId: 'sd2-source', nodeType: 'seedance', reason: 'long input exceeds replay limit' };
  const originalNow = Date.now; let generated;
  try {
    Date.now = () => originalNow() - 5 * 24 * 60 * 60 * 1000;
    generated = generation(state.database, 'long-settings', { inputSnapshot: legacy, historyInputSnapshot: settings });
  } finally { Date.now = originalNow; }
  assert.deepEqual(state.database.getNodeRun(generated.nodeRun.id).inputSnapshot, legacy);
  assert.equal(JSON.stringify(state.database.listNodeRuns(generated.run.id)).includes(prompt), false);
  const first = listGenerationHistory(state.database, scope);
  assert.equal(first.groups[0].snapshotAvailable, true);
  assert.equal(first.groups[0].promptPreview, prompt.slice(0, 280));
  state.database.setRunRetentionPolicy(scope.projectId, { maxDays: 1, keepReferenced: false }); state.database.pruneRuns(scope.projectId);
  assert.equal(state.database.getNodeRun(generated.nodeRun.id), null);
  await state.database.close(); state.database = new ProjectDatabase(state.filename);
  const detail = listGenerationHistory(state.database, { ...scope, groupId: first.groups[0].id, includeInput: true });
  assert.deepEqual(detail.groups[0].inputArchive.snapshot, settings);
});

test('history HTTP reads are scoped and read-only; settings-only capture survives the actual NodeRun POST', async t => {
  const { database } = fixture(t);
  const original = generation(database, 'http');
  const originals = [];
  const mock = (name, value) => {
    const id = require.resolve(name);
    originals.push([id, require.cache[id]]);
    require.cache[id] = { id, filename: id, loaded: true, exports: value };
  };
  mock('../backend/src/services/projectRuntime', {
    createLazyRuntime: factory => { let runtime; return { get: () => runtime || (runtime = factory()), peek: () => runtime }; },
    getProjectStorageRuntime: () => ({ database }),
    sendProjectRuntimeUnavailable: (_res, error) => { throw error; },
  });
  mock('../backend/src/services/assetPreviewPipeline', { getAssetPreviewPipeline: () => ({}) });
  mock('../backend/src/services/assetIndexer', { getBackgroundAssetIndexer: () => ({}) });
  mock('../backend/src/collaboration/gateway', { getCollaborationGateway: () => ({ broadcastHostNodeRunState: () => {} }) });
  mock('../backend/src/services/runRecovery', { getRunRecoveryManager: () => ({}) });
  const routeId = require.resolve('../backend/src/routes/projectRuns');
  originals.push([routeId, require.cache[routeId]]);
  delete require.cache[routeId];
  let router;
  try { router = require(routeId); }
  finally {
    originals.reverse().forEach(([id, previous]) => { if (previous) require.cache[id] = previous; else delete require.cache[id]; });
  }
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/project-runs', router);
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(async () => { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/api/project-runs/generation-history`;
  const before = database.db.prepare('SELECT total_changes() AS changes').get().changes;
  const response = await fetch(`${base}?${new URLSearchParams(scope)}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).data.total, 1);
  const groupId = listGenerationHistory(database, scope).groups[0].id;
  const detail = await fetch(`${base}?${new URLSearchParams({ ...scope, groupId, includeInput: '1' })}`);
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).data.groups[0].inputArchive.snapshot.node.data.prompt, 'frozen prompt http');
  assert.equal((await fetch(`${base}?${new URLSearchParams({ ...scope, includeInput: '1' })}`)).status, 400);
  assert.equal((await fetch(base)).status, 400);
  assert.equal((await fetch(`${base}?${new URLSearchParams({ ...scope, projectId: 'wrong-project' })}`)).status, 404);
  assert.equal(database.db.prepare('SELECT total_changes() AS changes').get().changes, before);

  const prompt = '通过真实接口保存的长提示词。'.repeat(1200);
  const settings = { schema: 't8-generation-settings-input-v1', purpose: 'prefill-only', complete: true, credentialsOmitted: false,
    node: { id: 'sd2-source', type: 'seedance', position: { x: 0, y: 0 }, data: { prompt, seed: 999 } }, upstreamNodes: [], incomingEdges: [] };
  const legacy = { schema: 't8-run-node-input-v1', replayable: false, reason: 'input too long' };
  const created = await fetch(`${base.replace('/generation-history', '')}/${original.run.id}/nodes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'http-long-node', nodeId: 'sd2-source', inputSnapshot: legacy, historyInputSnapshot: settings }),
  });
  assert.equal(created.status, 201);
  const nodeRun = (await created.json()).data;
  assert.deepEqual(nodeRun.inputSnapshot, legacy);
  assert.equal(JSON.stringify(nodeRun).includes(prompt), false);
  assert.equal(JSON.stringify(database.listNodeRuns(original.run.id)).includes('__generationHistoryInput'), false);
  assert.equal(JSON.stringify(database.listNodeRuns(original.run.id)).includes('__generationHistoryReferences'), false);
  const attempt = database.createAttempt({ id: 'http-long-attempt', nodeRunId: nodeRun.id, status: 'succeeded' });
  database.recordRunOutputAssets({ runId: original.run.id, nodeRunId: nodeRun.id, attemptId: attempt.id, outputs: original.outputs });
  const group = listGenerationHistory(database, scope).groups.find(item => item.promptPreview === prompt.slice(0, 280));
  assert.ok(group?.snapshotAvailable);
  const full = await fetch(`${base}?${new URLSearchParams({ ...scope, groupId: group.id, includeInput: '1' })}`);
  assert.deepEqual((await full.json()).data.groups[0].inputArchive.snapshot, settings);

  settings.node.data.credentials = { secret: 'private-http-fixture-value' };
  const rejected = await fetch(`${base.replace('/generation-history', '')}/${original.run.id}/nodes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'http-unsafe-node', nodeId: 'sd2-source', inputSnapshot: legacy, historyInputSnapshot: settings }),
  });
  assert.equal(rejected.status, 201, 'unsafe optional archive does not stop the existing run lifecycle');
  const rejectedInput = database.db.prepare('SELECT input_json FROM node_runs WHERE id = ?').get('http-unsafe-node').input_json;
  assert.equal(rejectedInput.includes('private-http-fixture-value'), false);
  assert.equal(JSON.parse(rejectedInput).__generationHistoryInput.complete, false);
});

test('real temporary host output bytes enter history through the CAS commit and replay without a duplicate generation', async t => {
  const state = fixture(t);
  const { database } = state;
  const root = path.dirname(state.filename);
  const config = { INPUT_DIR: path.join(root, 'input'), OUTPUT_DIR: path.join(root, 'output'), ASSET_BLOB_DIR: path.join(root, 'cas'), ASSET_INDEX_STABILITY_ATTEMPTS: 2 };
  fs.mkdirSync(config.INPUT_DIR); fs.mkdirSync(config.OUTPUT_DIR);
  fs.writeFileSync(path.join(config.OUTPUT_DIR, 'actual.txt'), 'Actual temporary host output, not a Provider generation.');
  const canvas = database.ensureCanvas(scope.canvasId, { nodes: [{ id: 'source', type: 'text', position: { x: 0, y: 0 }, data: {} }], edges: [] }, scope.projectId);
  const run = database.createRun({ id: 'host-history-run', ...scope, canvasRevision: canvas.revision, status: 'running' });
  const node = database.createNodeRun({ id: 'host-history-node', runId: run.id, nodeId: 'source', status: 'running', inputSnapshot: {
    schema: 't8-run-node-input-v1', replayable: true, upstreamNodes: [], incomingEdges: [],
    node: { id: 'source', type: 'text', position: { x: 0, y: 0 }, data: { prompt: 'original input' } },
  } });
  const attempt = database.createAttempt({ id: 'host-history-attempt', nodeRunId: node.id, provider: 'local-fixture', model: 'fixture', status: 'running' });
  const request = { runId: run.id, nodeRunId: node.id, attemptId: attempt.id, outputs: [{ sourceUrl: '/files/output/actual.txt', outputOrdinal: 0 }] };
  const indexer = new AssetIndexer(config, database, { blobStore: new AssetBlobStore(config.ASSET_BLOB_DIR) });
  const committed = await indexer.commitHostRunOutputAssets(request);
  const before = listGenerationHistory(database, scope);
  assert.equal(before.total, 1);
  assert.equal(before.groups[0].outputs[0].evidence, 'host-recorded');
  assert.equal(before.groups[0].outputs[0].contentHash, committed.assets[0].contentHash);
  assert.equal(before.groups[0].outputs[0].kind, 'text');
  assert.equal(before.groups[0].promptPreview, 'original input');
  assert.equal(before.groups[0].snapshotAvailable, true);
  await database.close();
  state.database = new ProjectDatabase(state.filename);
  const reopenedIndexer = new AssetIndexer(config, state.database, { blobStore: new AssetBlobStore(config.ASSET_BLOB_DIR) });
  assert.equal((await reopenedIndexer.commitHostRunOutputAssets(request)).duplicate, true);
  assert.deepEqual(listGenerationHistory(state.database, scope).groups.map(group => group.id), before.groups.map(group => group.id));
  const detail = listGenerationHistory(state.database, { ...scope, groupId: before.groups[0].id, includeInput: true });
  assert.equal(detail.groups[0].inputArchive.snapshot.node.data.prompt, 'original input');
});

test('host CAS output reuse is durably excluded without discarding its verified output slot', async t => {
  const state = fixture(t);
  const { database } = state;
  const root = path.dirname(state.filename);
  const config = { INPUT_DIR: path.join(root, 'input'), OUTPUT_DIR: path.join(root, 'output'), ASSET_BLOB_DIR: path.join(root, 'cas'), ASSET_INDEX_STABILITY_ATTEMPTS: 2 };
  fs.mkdirSync(config.INPUT_DIR); fs.mkdirSync(config.OUTPUT_DIR);
  fs.writeFileSync(path.join(config.OUTPUT_DIR, 'reuse.txt'), 'Temporary host reuse fixture; no Provider call.');
  const canvas = database.ensureCanvas(scope.canvasId, { nodes: [{ id: 'source', type: 'text', position: { x: 0, y: 0 }, data: {} }], edges: [] }, scope.projectId);
  const indexer = new AssetIndexer(config, database, { blobStore: new AssetBlobStore(config.ASSET_BLOB_DIR) });
  const originalNow = Date.now;
  const attempts = [];
  try {
    Date.now = () => originalNow() - 5 * 24 * 60 * 60 * 1000;
    for (const [label, reusedResult] of [['fresh', false], ['cached', true], ['next-fresh', false]]) {
      const run = database.createRun({ id: `host-reuse-${label}`, ...scope, canvasRevision: canvas.revision, status: 'running' });
      const node = database.createNodeRun({ id: `host-reuse-node-${label}`, runId: run.id, nodeId: 'source', status: 'running', inputSnapshot: { node: { id: 'source', type: 'text', data: {} } } });
      const attempt = database.createAttempt({ id: `host-reuse-attempt-${label}`, nodeRunId: node.id, status: 'running', metadata: { reusedResult } });
      const request = { runId: run.id, nodeRunId: node.id, attemptId: attempt.id, outputs: [{ sourceUrl: '/files/output/reuse.txt', outputOrdinal: 0 }] };
      const committed = await indexer.commitHostRunOutputAssets(request);
      assert.ok(database.getNodeRun(node.id).outputRefs.includes(committed.assets[0].id));
      assert.equal((await indexer.commitHostRunOutputAssets(request)).duplicate, true);
      const slot = database.db.prepare('SELECT reservation_state FROM run_output_slot_reservations WHERE attempt_entity_uid = ?').get(attempt.entityUid);
      assert.equal(slot.reservation_state, 'host-verified');
      database.updateAttempt(attempt.id, { status: 'succeeded' });
      database.updateNodeRun(node.id, { status: 'succeeded' });
      database.updateRun(run.id, { status: 'succeeded' });
      attempts.push({ run, attempt, reusedResult });
    }
  } finally { Date.now = originalNow; }
  const expected = new Set(attempts.filter(item => !item.reusedResult).map(item => `attempt:${item.attempt.entityUid}`));
  assert.deepEqual(new Set(listGenerationHistory(database, scope).groups.map(group => group.id)), expected);
  database.setRunRetentionPolicy(scope.projectId, { maxDays: 1, keepReferenced: false });
  database.pruneRuns(scope.projectId);
  assert.ok(attempts.every(item => !database.getRun(item.run.id)));
  await database.close();
  state.database = new ProjectDatabase(state.filename);
  const page = listGenerationHistory(state.database, scope);
  assert.equal(page.total, 2);
  assert.deepEqual(new Set(page.groups.map(group => group.id)), expected);
});
