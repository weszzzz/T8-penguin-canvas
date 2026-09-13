import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareHistoryInputDraft, createHistoryInputDraftPatch, HistoryReferenceRecoveryRequired } from '../src/utils/generationHistoryInputDraft.ts';
import { resolveMediaMentions } from '../src/components/nodes/mediaMentions.ts';
import { historyErrorText, generationHistoryEn, generationHistoryZh } from '../src/i18n/generationHistoryCatalog.ts';
import contract from '../backend/src/shared/generationHistoryInputContract.json';

function fixture(model = 'grok-video-3') {
  const scope = { projectId: 'p', canvasId: 'c' };
  const urls = Array.from({ length: 8 }, (_, i) => `/files/input/${i}.png`);
  const assets = urls.map((url, i) => ({ id: `asset-${i}`, projectId: 'p', entityUid: `a1000000-0000-4000-8000-00000000000${i}`,
    contentHash: String(i + 1).repeat(64), kind: 'image', availability: 'available', sourceUrl: url }));
  const context = { schema: contract.videoInputContextSchema, origin: 'frontend-common-context',
    prompt: 'Use @image1 then @image2; preserve @img1 @image01 @image8 @video1 literally.',
    localRefImages: urls, localRefVideos: ['/files/input/unused.mp4'], localRefAudios: ['/files/input/unused.wav'],
    basicSettings: { mainId: 'grok-video-3', model, videoBuiltinSource: 'zhenzhen', providerSource: 'zhenzhen',
      providerId: '', providerModel: '', ratio: '16:9', duration: 15, resolution: '720P', seed: 0, size: '720x1280' } };
  const group: any = { id: 'g', nodeId: 'deleted-video', nodeEntityUid: 'original-uid', nodeType: 'video', snapshotAvailable: true, sourceNodeExists: false };
  const archive: any = { status: 'available', digest: 'server-verified', binding: { ...scope, nodeId: group.nodeId, nodeEntityUid: group.nodeEntityUid },
    snapshot: { schema: contract.schema, node: { id: group.nodeId, type: 'video', data: { historyResolvedInput: context,
      prompt: 'old local', localRefImages: ['wrong-current'], taskId: 'old-task', videoUrl: 'old-output', apiKey: 'never-copy',
      providerParams: {}, runTrigger: 7, materialOrder: ['wrong-order'] } }, upstreamNodes: [], incomingEdges: [] },
    references: { status: 'captured', entries: urls.map((url, i) => ({ status: 'bound',
      path: ['node', 'data', 'historyResolvedInput', 'localRefImages', i], assetId: assets[i].id,
      entityUid: assets[i].entityUid, contentHash: assets[i].contentHash, kind: 'image' })) } };
  const state = { current: true, gets: [] as string[], heads: [] as string[], active: 0, maxActive: 0 };
  const dependencies = { assertCurrent() { if (!state.current) throw new Error('scope changed'); },
    async getAsset(id: string): Promise<any> { state.gets.push(id); return assets.find(asset => asset.id === id); },
    async request(url: string, init: RequestInit) {
      assert.equal(init.method, 'HEAD'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
      state.active++; state.maxActive = Math.max(state.maxActive, state.active); await Promise.resolve(); state.active--;
      state.heads.push(url); return { ok: true };
    } };
  return { scope, group, context, archive, assets, state, dependencies, prepare: () => prepareHistoryInputDraft(archive, group, scope, dependencies) };
}

test('Grok draft uses seven sequential fixed-asset checks, exact mentions and one independent node after source deletion', async () => {
  const f = fixture(), original = structuredClone(f.archive), draft = await f.prepare();
  assert.equal(draft.nodeType, 'video'); assert.equal(draft.inputKind, 'standard-video'); assert.equal(draft.resolvedFrontendInputs, true);
  assert.equal(draft.prompt, f.context.prompt); assert.equal(draft.references.length, 7);
  assert.deepEqual(f.state.gets, f.assets.slice(0, 7).map(asset => asset.id));
  assert.equal(f.state.heads.length, 7); assert.equal(f.state.maxActive, 1);
  assert.deepEqual(draft.data.localRefImages, draft.references.map(ref => ref.url));
  assert.deepEqual(draft.data.localRefVideos, []); assert.deepEqual(draft.data.localRefAudios, []);
  const mentions = draft.data.promptMentions as any[];
  assert.deepEqual(mentions.map(item => item.token), ['@image1', '@image2']);
  const materials = draft.references.map(ref => ({ id: `local::video-image:${ref.url}`, kind: 'image' as const,
    url: ref.url, sourceNodeId: 'new', origin: 'local' as const }));
  assert.equal(resolveMediaMentions(draft.prompt, mentions, materials), draft.prompt);
  for (const [i, ref] of draft.references.entries()) {
    const url = new URL(ref.url, 'http://localhost');
    assert.equal(url.pathname, `/api/project-assets/asset-${i}/media`);
    assert.equal(url.searchParams.get('contentHash'), f.assets[i].contentHash);
    assert.equal(url.searchParams.get('referenceSlot'), String(i));
  }
  for (const key of ['ratio', 'duration', 'resolution']) assert.ok(draft.fields.some(field => field.key === key));
  const patch = createHistoryInputDraftPatch(draft, { ...f.scope, id: 'approved', baseRevision: 4, position: { x: 10, y: 20 } });
  assert.equal(patch.operations.length, 1); assert.equal(patch.operations[0].type, 'node.add'); assert.equal(patch.requiresConfirmation, true);
  const node: any = patch.operations[0].payload.node;
  assert.notEqual(node.id, f.group.nodeId); assert.equal(node.type, 'video');
  for (const key of ['videoUrl', 'taskId', 'apiKey', 'providerParams', 'runTrigger', 'materialOrder', 'historyResolvedInput', 'referenceImages']) {
    assert.equal(Object.hasOwn(node.data, key), false, key);
  }
  assert.deepEqual(f.archive, original);
});

test('Grok New displays only active size, restores first image and leaves literal out-of-range mentions unchanged', async () => {
  for (const model of ['grok-1.5-video-6s', 'grok-1.5-video-10s', 'grok-1.5-video-15s']) {
    const f = fixture(model), draft = await f.prepare();
    assert.equal(draft.references.length, 1); assert.equal(f.state.gets.length, 1);
    assert.equal(draft.fields.find(field => field.key === 'size')?.after, '720x1280');
    for (const key of ['ratio', 'duration', 'resolution', 'seed', 'providerId', 'providerModel', 'providerSource']) {
      assert.equal(draft.fields.some(field => field.key === key), false, key);
      assert.equal(draft.data[key], (f.context.basicSettings as Record<string, unknown>)[key], 'display filtering must not change stored settings');
    }
    assert.deepEqual((draft.data.promptMentions as any[]).map(item => item.token), ['@image1']);
    assert.equal(draft.prompt, f.context.prompt);
  }
});

test('video draft rejects unsupported channel, missing context and scope mismatch before any asset read', async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.scope.canvasId = 'other'; },
    (f: ReturnType<typeof fixture>) => { f.archive.binding.nodeEntityUid = 'different'; },
    (f: ReturnType<typeof fixture>) => { f.context.basicSettings.model = 'grok-video-fal'; },
    (f: ReturnType<typeof fixture>) => { f.archive.snapshot.node.data.providerParams = { seed: 123 }; },
    (f: ReturnType<typeof fixture>) => { delete f.archive.snapshot.node.data.historyResolvedInput; },
  ]) {
    const f = fixture(); mutate(f); await assert.rejects(f.prepare());
    assert.deepEqual(f.state.gets, []); assert.deepEqual(f.state.heads, []);
  }
});

test('video fixed references reject missing bindings, changed hash/UID/project/kind and failed HEAD without partial drafts', async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.archive.references = undefined; },
    (f: ReturnType<typeof fixture>) => { f.archive.references.entries[0].status = 'unbound'; },
    (f: ReturnType<typeof fixture>) => { f.assets[0].contentHash = 'f'.repeat(64); },
    (f: ReturnType<typeof fixture>) => { f.assets[0].entityUid = 'replacement'; },
    (f: ReturnType<typeof fixture>) => { f.assets[0].projectId = 'different'; },
    (f: ReturnType<typeof fixture>) => { f.assets[0].kind = 'video'; },
    (f: ReturnType<typeof fixture>) => { f.dependencies.request = async () => ({ ok: false }); },
  ]) { const f = fixture(); mutate(f); await assert.rejects(f.prepare()); }
  const lookup = fixture(); lookup.dependencies.getAsset = async () => { lookup.state.current = false; return lookup.assets[0]; };
  await assert.rejects(lookup.prepare(), /scope changed/); assert.equal(lookup.state.heads.length, 0);
  const head = fixture(); head.dependencies.request = async () => { head.state.current = false; return { ok: true }; };
  await assert.rejects(head.prepare(), /scope changed/); assert.equal(head.state.gets.length, 1);
});

test('video old-file recovery accepts only the archived content and preserves the original immutable binding', async () => {
  const f = fixture('grok-1.5-video-6s'), original = structuredClone(f.assets[0]);
  f.assets[0].contentHash = 'f'.repeat(64);
  await assert.rejects(f.prepare(), error => {
    assert.ok(error instanceof HistoryReferenceRecoveryRequired);
    assert.deepEqual(error.target, { referenceGroupId: 'g', referenceArchiveDigest: 'server-verified', referenceIndex: 0 }); return true;
  });
  const recovered = { ...original, id: 'recovered', entityUid: 'b1000000-0000-4000-8000-000000000000' };
  const deps = { ...f.dependencies, recoveredReferences: [{ referenceIndex: 0, assetId: recovered.id,
    entityUid: recovered.entityUid, contentHash: recovered.contentHash, kind: 'image' }], getAsset: async (): Promise<any> => recovered };
  const draft = await prepareHistoryInputDraft(f.archive, f.group, f.scope, deps);
  assert.match(draft.references[0].url, /recovered\/media/); assert.equal(f.archive.references.entries[0].assetId, original.id);
  deps.recoveredReferences[0].contentHash = 'f'.repeat(64);
  await assert.rejects(prepareHistoryInputDraft(f.archive, f.group, f.scope, deps), /与原归档不一致/);
});

test('video input explanations and failures have exact bilingual mappings', () => {
  assert.ok(generationHistoryEn.standardVideoHint); assert.ok(generationHistoryZh.standardVideoHint);
  for (const key of ['falVideoHint', 'falVeoSafetyHint', 'field_requestedSafetyTolerance'] as const) {
    assert.ok(generationHistoryEn[key]); assert.ok(generationHistoryZh[key]);
  }
  const translate = (key: string) => (generationHistoryEn as Record<string, string>)[key.replace('generationHistory.', '')] || key;
  for (const key of ['error_videoInputMissing', 'error_videoInputUnsupported', 'error_videoInputExtras', 'error_videoInputInvalid', 'error_videoInputExternalReferences']) {
    const zh = (generationHistoryZh as Record<string, string>)[key], en = (generationHistoryEn as Record<string, string>)[key];
    assert.ok(zh); assert.ok(en); assert.equal(historyErrorText(zh, translate as any), en);
  }
});

function falFixture(model = 'grok-video-fal') {
  const f = fixture(model);
  const settings = f.context.basicSettings as Record<string, unknown>;
  delete settings.size;
  settings.mainId = model === 'veo3.1-fal' ? 'veo3.1' : model === 'sora-2' ? 'sora-2' : 'grok-video-3';
  Object.assign(settings, model === 'veo3.1-fal'
    ? { vfRatio: '9:16', vfDuration: '8s', vfResolution: '4k', vfAudio: false, vfSafety: 0 }
    : model === 'sora-2'
      ? { soraMode: 'auto', soraRatio: 'auto', soraDuration: 8, soraResolution: 'auto', soraDeleteVideo: false, soraBlockIp: true }
      : { gkfMode: model === 'grok-imagine-video-1.5' ? 'image_to_video' : 'reference_to_video', gkfDuration: 10, gkfResolution: '720p',
        ...(model === 'grok-imagine-video-1.5' ? {} : { gkfRatio: 'auto' }) });
  f.archive.snapshot.node.data.providerParams = { ignoredByClosedBackend: true };
  return { ...f, settings };
}

test('four FAL video drafts bind only effective fixed slots and keep request metadata outside the confirmed node', async () => {
  for (const [model, count] of [['veo3.1-fal', 3], ['grok-video-fal', 7], ['grok-imagine-video-1.5', 1], ['sora-2', 1]] as const) {
    const f = falFixture(model), before = structuredClone(f.archive), draft = await f.prepare();
    assert.equal(draft.inputKind, 'fal-video'); assert.equal(draft.prompt, f.context.prompt);
    assert.equal(draft.references.length, count); assert.equal(f.state.maxActive, 1);
    assert.deepEqual(f.state.gets, f.assets.slice(0, count).map(asset => asset.id));
    assert.deepEqual(draft.data.localRefImages, draft.references.map(ref => ref.url));
    assert.deepEqual(draft.data.localRefVideos, []); assert.deepEqual(draft.data.localRefAudios, []);
    assert.deepEqual((draft.data.promptMentions as any[]).map(item => item.token), count > 1 ? ['@image1', '@image2'] : ['@image1']);
    const patch = createHistoryInputDraftPatch(draft, { ...f.scope, id: 'confirmed', baseRevision: 4, position: { x: 10, y: 20 } });
    assert.equal(patch.requiresConfirmation, true); assert.equal(patch.operations.length, 1);
    assert.equal(patch.operations[0].type, 'node.add');
    const node: any = patch.operations[0].payload.node;
    assert.notEqual(node.id, f.group.nodeId); assert.equal(node.type, 'video');
    for (const [key, value] of Object.entries(f.settings)) assert.equal(node.data[key], value, key);
    for (const key of ['ratio', 'duration', 'resolution', 'seed']) assert.equal(draft.fields.some(field => field.key === key), false, key);
    for (const key of ['taskId', 'videoUrl', 'apiKey', 'providerParams', 'runTrigger', 'historyResolvedInput', 'requestedSafetyTolerance']) {
      assert.equal(Object.hasOwn(node.data, key), false, key);
    }
    if (model === 'veo3.1-fal') {
      assert.equal(draft.fields.find(field => field.key === 'vfSafety')?.after, '0');
      assert.equal(draft.fields.find(field => field.key === 'requestedSafetyTolerance')?.after, '4');
    } else assert.equal(draft.fields.some(field => field.key === 'requestedSafetyTolerance'), false);
    for (const [index, ref] of draft.references.entries()) {
      const url = new URL(ref.url, 'http://localhost');
      assert.equal(url.searchParams.get('contentHash'), f.assets[index].contentHash);
      assert.equal(url.searchParams.get('referenceSlot'), String(index));
    }
    assert.deepEqual(f.archive, before);
  }
});

test('FAL route rejects invalid captures before I/O and Sora text mode never reads unused images', async () => {
  for (const mutate of [
    (f: ReturnType<typeof falFixture>) => { delete f.settings.gkfDuration; },
    (f: ReturnType<typeof falFixture>) => { f.settings.providerSource = 'custom'; },
    (f: ReturnType<typeof falFixture>) => { f.settings.mainId = 'sora-2'; },
    (f: ReturnType<typeof falFixture>) => { f.archive.snapshot.node.data.gkfReferenceUrls = 'https://example.invalid/old.png'; },
  ]) {
    const f = falFixture(); mutate(f); await assert.rejects(f.prepare());
    assert.deepEqual(f.state.gets, []); assert.deepEqual(f.state.heads, []);
  }
  const sora = falFixture('sora-2'); sora.settings.soraMode = 'text_to_video'; sora.archive.references = undefined;
  const draft = await sora.prepare(); assert.deepEqual(draft.references, []); assert.deepEqual(draft.data.promptMentions, []);
  assert.equal(draft.prompt, sora.context.prompt); assert.deepEqual(sora.state.gets, []);
  sora.archive.snapshot.node.data.soraCharacterIds = 'old-character';
  await assert.rejects(sora.prepare(), /外部引用/);
});

test('FAL original-file recovery preserves same-byte alias slots and refuses wrong recovered identity', async () => {
  const f = falFixture('veo3.1-fal');
  // Different archived URLs may intentionally identify identical content.
  Object.assign(f.archive.references.entries[1], { assetId: f.assets[0].id, entityUid: f.assets[0].entityUid, contentHash: f.assets[0].contentHash });
  const original = structuredClone(f.assets[0]); f.assets[0].contentHash = 'f'.repeat(64);
  await assert.rejects(f.prepare(), HistoryReferenceRecoveryRequired);
  const recovered = { ...original, id: 'recovered', entityUid: 'b1000000-0000-4000-8000-000000000000' };
  const deps = { ...f.dependencies, recoveredReferences: [{ referenceIndex: 0, assetId: recovered.id,
    entityUid: recovered.entityUid, contentHash: recovered.contentHash, kind: 'image' }],
    getAsset: async (id: string): Promise<any> => id === recovered.id ? recovered : f.assets.find(asset => asset.id === id) };
  const draft = await prepareHistoryInputDraft(f.archive, f.group, f.scope, deps);
  assert.equal(draft.references.length, 3); assert.equal(f.state.heads.length, 2, 'same bytes are verified once, sequentially');
  assert.match(draft.references[0].url, /recovered\/media/); assert.match(draft.references[1].url, /recovered\/media/);
  assert.notEqual(draft.references[0].url, draft.references[1].url);
  assert.equal(f.archive.references.entries[0].assetId, original.id);
  recovered.entityUid = 'wrong'; await assert.rejects(prepareHistoryInputDraft(f.archive, f.group, f.scope, deps), HistoryReferenceRecoveryRequired);
});
