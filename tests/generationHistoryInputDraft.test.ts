import test from 'node:test';
import assert from 'node:assert/strict';
import { collectHistorySeedanceInputs, prepareHistoryInputDraft, createHistoryInputDraftPatch, HistoryReferenceRecoveryRequired } from '../src/utils/generationHistoryInputDraft.ts';

function fixture() {
  const scope = { projectId: 'p', canvasId: 'c' };
  const urls = ['/files/input/a.png', '/files/input/b.png', '/files/input/c.png'];
  const assets = urls.map((url, index) => ({ id: `asset-${index}`, entityUid: `a1000000-0000-4000-8000-00000000000${index}`, projectId: 'p', kind: 'image',
    contentHash: String(index + 1).repeat(64), filename: `${index}.png`, availability: 'available', sourceUrl: url }));
  const group: any = { id: 'g', nodeId: 'old-node', nodeEntityUid: 'old-source-uid', nodeType: 'seedance', snapshotAvailable: true, sourceNodeExists: false };
  const archive: any = { status: 'available', schema: 't8-generation-input-archive-v1', digest: 'server-verified', binding: { ...scope, nodeId: group.nodeId, nodeEntityUid: group.nodeEntityUid },
    snapshot: { schema: 't8-generation-settings-input-v1', node: { id: group.nodeId, type: 'seedance', data: { prompt: 'ignored local prompt', duration: 5,
      localRefImages: [urls[2]], videoUrl: '/files/output/old.mp4', taskId: 'old-runtime', runTrigger: 99, providerParams: { notAudited: true } } },
      upstreamNodes: [{ id: 'refs', type: 'upload', data: { imageUrls: urls.slice(0, 2) } }, { id: 'text', type: 'text', data: { text: 'Historical upstream @image2' } }],
      incomingEdges: [{ id: 'e1', source: 'refs', target: group.nodeId }, { id: 'e2', source: 'text', target: group.nodeId }] },
    references: { status: 'captured', entries: [
      { path: ['upstreamNodes', 0, 'data', 'imageUrls', 0], status: 'bound', assetId: assets[0].id, entityUid: assets[0].entityUid, contentHash: assets[0].contentHash, kind: 'image' },
      { path: ['upstreamNodes', 0, 'data', 'imageUrls', 1], status: 'bound', assetId: assets[1].id, entityUid: assets[1].entityUid, contentHash: assets[1].contentHash, kind: 'image' },
      { path: ['node', 'data', 'localRefImages', 0], status: 'bound', assetId: assets[2].id, entityUid: assets[2].entityUid, contentHash: assets[2].contentHash, kind: 'image' },
    ] } };
  const state = { current: true, head: [] as string[] };
  const dependencies = { assertCurrent: () => { if (!state.current) throw new Error('scope changed'); },
    getAsset: async (id: string): Promise<any> => assets.find(asset => asset.id === id),
    request: async (url: string, init: RequestInit) => { assert.equal(init.method, 'HEAD'); state.head.push(url); return { ok: true }; } };
  return { scope, group, archive, urls, assets, state, dependencies, prepare: () => prepareHistoryInputDraft(archive, group, scope, dependencies) };
}

test('unadapted image archives and video do not fall back to the Seedance complete-input adapter', async () => {
  for (const type of ['image', 'video']) {
    const f = fixture(); f.archive.snapshot.node.type = f.group.nodeType = type;
    await assert.rejects(f.prepare, type === 'image' ? /历史未记录完整图像输入/ : /历史未记录完整视频输入/);
    assert.equal(f.state.head.length, 0);
  }
});

test('new independent input draft restores upstream prompt, ordered fixed references and mentions after source deletion', async () => {
  const f = fixture(), original = structuredClone(f.archive);
  f.archive.snapshot.node.data.materialOrder = [`refs::image:${f.urls[1]}`, `refs::image:${f.urls[0]}`];
  const draft = await f.prepare();
  assert.equal(draft.prompt, 'Historical upstream @image2');
  assert.deepEqual(draft.references.map(ref => new URL(ref.url, 'http://localhost').pathname), ['/api/project-assets/asset-1/media', '/api/project-assets/asset-0/media', '/api/project-assets/asset-2/media']);
  assert.equal((draft.data.promptMentions as any[])[0].url, draft.references[1].url);
  assert.equal((draft.data.promptMentions as any[])[0].materialKey, `image:${draft.references[1].url}`);
  assert.equal(f.state.head.length, 3);
  const patch = createHistoryInputDraftPatch(draft, { ...f.scope, id: 'new-draft', baseRevision: 2, position: { x: 1, y: 2 } });
  assert.equal(patch.operations.length, 1); assert.equal(patch.operations[0].type, 'node.add');
  const node: any = patch.operations[0].payload.node;
  assert.notEqual(node.id, f.group.nodeId); assert.equal(node.type, 'seedance');
  for (const key of ['videoUrl', 'taskId', 'runTrigger', 'providerParams', 'apiKey', '__loopCustomInput']) assert.equal(node.data[key], undefined);
  assert.equal(patch.requiresConfirmation, true); assert.equal(f.archive.snapshot.node.data.prompt, original.snapshot.node.data.prompt);
});

test('live port filtering and explicit exclusions determine exactly which archived reference is restored', async () => {
  const f = fixture();
  f.archive.snapshot.node.data.excludedMaterialIds = [`refs::image:${f.urls[0]}`];
  assert.deepEqual(collectHistorySeedanceInputs(f.archive).media.map(ref => ref.url), [f.urls[1], f.urls[2]]);
  const frame = fixture(); frame.archive.snapshot.upstreamNodes[0].data = { firstFrameUrl: frame.urls[0], lastFrameUrl: frame.urls[1] };
  frame.archive.snapshot.incomingEdges[0].sourceHandle = 'last';
  assert.deepEqual(collectHistorySeedanceInputs(frame.archive).media.map(ref => ref.url), [frame.urls[1], frame.urls[2]]);
});

test('distinct aliases of one asset keep two reference slots without duplicate file reads', async () => {
  const f = fixture(); f.archive.snapshot.upstreamNodes = []; f.archive.snapshot.incomingEdges = [];
  f.archive.snapshot.node.data.localRefImages = [f.urls[0], '/api/project-assets/asset-0/media'];
  f.archive.references.entries = [0, 1].map(index => ({ ...f.archive.references.entries[0], path: ['node', 'data', 'localRefImages', index] }));
  const draft = await f.prepare();
  assert.equal(draft.references.length, 2); assert.notEqual(draft.references[0].url, draft.references[1].url); assert.equal(f.state.head.length, 1);
  const restored = { ...f.archive, snapshot: { node: { id: 'new', type: 'seedance', data: draft.data }, upstreamNodes: [], incomingEdges: [] } };
  assert.equal(collectHistorySeedanceInputs(restored).media.length, 2);
});

test('unverified, missing, changed and cross-project references reject the whole draft instead of partial restoration', async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.archive.references = undefined; },
    (f: ReturnType<typeof fixture>) => { f.assets[1].contentHash = 'f'.repeat(64); },
    (f: ReturnType<typeof fixture>) => { f.assets[1].projectId = 'other'; },
    (f: ReturnType<typeof fixture>) => { f.dependencies.request = async () => ({ ok: false }); },
    (f: ReturnType<typeof fixture>) => { f.scope.canvasId = 'other'; },
  ]) { const f = fixture(); change(f); await assert.rejects(f.prepare()); }
});

test('scope changes during file lookup stop preparation and oversized prompts remain unmodified', async () => {
  const f = fixture(); f.dependencies.getAsset = async () => { f.state.current = false; return f.assets[0]; };
  await assert.rejects(f.prepare(), /scope changed/); assert.equal(f.state.head.length, 0);
  const long = fixture(); long.archive.snapshot.upstreamNodes[1].data.text = 'x'.repeat(65537);
  const draft = await long.prepare();
  assert.throws(() => createHistoryInputDraftPatch(draft, { ...long.scope, id: 'oversized', baseRevision: 1, position: { x: 0, y: 0 } }), /未截断/);
  assert.equal(draft.prompt.length, 65537);
});

test('missing reference offers only its exact archived target; explicit durable mapping restores the same bytes under a new asset identity', async () => {
  const f = fixture(), original = { ...f.assets[0] };
  f.assets[0].contentHash = 'f'.repeat(64);
  await assert.rejects(f.prepare(), error => {
    assert.ok(error instanceof HistoryReferenceRecoveryRequired);
    assert.deepEqual(error.target, { referenceGroupId: f.group.id, referenceArchiveDigest: f.archive.digest, referenceIndex: 0 });
    return true;
  });
  const recovered = { ...original, id: 'recovered-reference', entityUid: 'b1000000-0000-4000-8000-000000000001' };
  const dependencies = { ...f.dependencies, recoveredReferences: [{ referenceIndex: 0, ...recovered, assetId: recovered.id }],
    getAsset: async (id: string) => id === recovered.id ? recovered : f.assets.find(asset => asset.id === id)! };
  const draft = await prepareHistoryInputDraft(f.archive, f.group, f.scope, dependencies);
  assert.match(draft.references[0].url, /recovered-reference\/media/);
  assert.equal(new URL(draft.references[0].url, 'http://localhost').searchParams.get('contentHash'), original.contentHash);
  dependencies.recoveredReferences[0].contentHash = 'f'.repeat(64);
  await assert.rejects(prepareHistoryInputDraft(f.archive, f.group, f.scope, dependencies), /与原归档不一致/);
  assert.equal(f.archive.references.entries[0].assetId, original.id);
});
