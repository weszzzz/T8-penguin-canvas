import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareHistoryInputDraft, createHistoryInputDraftPatch, HistoryReferenceRecoveryRequired } from '../src/utils/generationHistoryInputDraft.ts';
import { resolveMediaMentions } from '../src/components/nodes/mediaMentions.ts';
import { orderMaterials } from '../src/components/nodes/useOrderedMaterials.ts';
import contract from '../backend/src/shared/generationHistoryInputContract.json';
import { createRequire } from 'node:module';
const { createContext: createPersistenceContext } = createRequire(import.meta.url)('../scripts/history-image-input-seed.cjs');

function fixture() {
  const scope = { projectId: 'p', canvasId: 'c' };
  const urls = ['/files/input/first.png', '/files/input/second.png'];
  const assets = urls.map((url, index) => ({ id: `asset-${index}`, projectId: 'p',
    entityUid: `a1000000-0000-4000-8000-00000000000${index}`, contentHash: String(index + 1).repeat(64),
    kind: 'image', availability: 'available', sourceUrl: url }));
  const group: any = { id: 'g', nodeId: 'deleted-image', nodeEntityUid: 'original-uid', nodeType: 'image', snapshotAvailable: true, sourceNodeExists: false };
  const context = { schema: contract.imageSettingsContextSchema, origin: 'frontend-common-context',
    prompt: 'Use @image2 and @image3; retain @img2 @image02 @image9 literally.\nImage adjustment requirements: original',
    referenceImages: [urls[1], urls[0], urls[1]], basicSettings: { model: 'gpt-image-2', apiModel: 'gpt-image-2.5-flare',
      aspectRatio: '1:1', sizeLevel: '2K', imageBuiltinSource: 'zhenzhen', providerSource: 'zhenzhen', providerId: '', providerModel: '',
      gptImageQuality: 'max', gptImageModeration: 'low', gptImage25Size: '1536x1024',
      gptImage25CustomWidth: 1024, gptImage25CustomHeight: 1024, gptImage25Count: 2, gptImage25Background: 'opaque' } };
  const archive: any = { status: 'available', digest: 'server-verified', binding: { ...scope, nodeId: group.nodeId, nodeEntityUid: group.nodeEntityUid },
    snapshot: { schema: contract.schema, node: { id: group.nodeId, type: 'image', data: {
      historyResolvedInput: context, prompt: 'old local', referenceImages: ['not-the-actual-input'], materialOrder: ['wrong'],
      imagePromptAdjustments: [{ id: 'do-not-reapply' }], taskId: 'old-task', imageUrl: 'old-output', runTrigger: 1, apiKey: 'never-copy',
    } }, upstreamNodes: [{ id: 'irrelevant', type: 'text', data: { text: 'not-the-effective-prompt' } }], incomingEdges: [] },
    references: { status: 'captured', entries: context.referenceImages.map((url, index) => {
      const asset = assets[urls.indexOf(url)];
      return { status: 'bound', path: ['node', 'data', 'historyResolvedInput', 'referenceImages', index],
        assetId: asset.id, entityUid: asset.entityUid, contentHash: asset.contentHash, kind: 'image' };
    }) } };
  const state = { current: true, gets: [] as string[], heads: [] as string[], active: 0, maxActive: 0 };
  const dependencies = {
    assertCurrent() { if (!state.current) throw new Error('scope changed'); },
    async getAsset(id: string): Promise<any> { state.gets.push(id); return assets.find(asset => asset.id === id); },
    async request(url: string, init: RequestInit) {
      assert.equal(init.method, 'HEAD'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
      state.active++; state.maxActive = Math.max(state.maxActive, state.active); await Promise.resolve(); state.active--;
      state.heads.push(url); return { ok: true };
    },
  };
  return { scope, group, archive, assets, state, dependencies, prepare: () => prepareHistoryInputDraft(archive, group, scope, dependencies) };
}

function bananaFixture(apiModel = 'nano-banana-pro') {
  const f = fixture();
  f.archive.snapshot.node.data.historyResolvedInput.basicSettings = {
    model: apiModel.startsWith('gemini-3.1') ? 'nano-banana-2' : 'nano-banana-pro', apiModel,
    imageBuiltinSource: 'zhenzhen', providerSource: 'zhenzhen', providerId: '', providerModel: '',
    aspectRatio: 'Auto', sizeLevel: '4K',
  };
  return f;
}

test('ordinary Banana fixed references produce one confirmed independent draft for all six models', async () => {
  for (const apiModel of ['gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'nano-banana-pro',
    'nano-banana-pro-2k', 'nano-banana-pro-4k', 'gemini-3-pro-image']) {
    const f = bananaFixture(apiModel), original = structuredClone(f.archive), draft = await f.prepare();
    assert.equal(draft.inputKind, 'banana-image'); assert.equal(draft.prompt, original.snapshot.node.data.historyResolvedInput.prompt);
    assert.deepEqual(f.state.gets, ['asset-1', 'asset-0']); assert.equal(f.state.maxActive, 1);
    assert.equal(draft.references.length, 3); assert.equal(new Set(draft.references.map(ref => ref.url)).size, 3);
    for (const [index, ref] of draft.references.entries()) {
      const url = new URL(ref.url, 'http://localhost'), asset = f.assets[index === 1 ? 0 : 1];
      assert.equal(url.pathname, `/api/project-assets/${asset.id}/media`);
      assert.equal(url.searchParams.get('entityUid'), asset.entityUid);
      assert.equal(url.searchParams.get('contentHash'), asset.contentHash);
      assert.equal(url.searchParams.get('projectId'), 'p'); assert.equal(url.searchParams.get('referenceSlot'), String(index));
    }
    assert.deepEqual((draft.data.promptMentions as any[]).map(mention => mention.token), ['@image2', '@image3']);
    const patch = createHistoryInputDraftPatch(draft, { ...f.scope, id: 'banana', baseRevision: 3, position: { x: 10, y: 20 } });
    assert.equal(patch.requiresConfirmation, true); assert.equal(patch.operations.length, 1); assert.equal(patch.operations[0].type, 'node.add');
    const node: any = patch.operations[0].payload.node; assert.notEqual(node.id, f.group.nodeId);
    for (const key of ['taskId', 'imageUrl', 'runTrigger', 'apiKey', 'providerParams', 'imagePromptAdjustments', 'historyResolvedInput', 'materialOrder', 'requestedImageSize']) {
      assert.equal(Object.hasOwn(node.data, key), false, key);
    }
    assert.deepEqual(f.archive, original);
    const lite = apiModel === 'gemini-3.1-flash-lite-image';
    assert.equal(node.data.sizeLevel, '4K');
    assert.equal(draft.fields.some(field => field.key === 'sizeLevel'), !lite);
    assert.equal(draft.fields.find(field => field.key === 'requestedImageSize')?.after, lite ? '1K' : undefined);
    assert.equal(draft.fields.find(field => field.key === 'aspectRatio')?.after, 'Auto');
  }
});

test('ordinary Banana validates archived identity and scope before asset reads and refuses changed references', async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.scope.canvasId = 'other'; },
    (f: ReturnType<typeof fixture>) => { f.archive.snapshot.node.data.providerParams = { n: 2 }; },
    (f: ReturnType<typeof fixture>) => { f.archive.snapshot.node.data.historyResolvedInput.basicSettings.model = 'nano-banana-2'; },
    (f: ReturnType<typeof fixture>) => { f.archive.snapshot.node.data.historyResolvedInput.basicSettings.imageBuiltinSource = 'seedance-nz'; },
    (f: ReturnType<typeof fixture>) => { delete f.archive.snapshot.node.data.historyResolvedInput.basicSettings.sizeLevel; },
  ]) {
    const f = bananaFixture(); mutate(f); await assert.rejects(f.prepare()); assert.deepEqual(f.state.gets, []);
  }
  for (const boundary of ['lookup', 'head']) {
    const f = bananaFixture();
    if (boundary === 'lookup') f.dependencies.getAsset = async () => { f.state.current = false; return f.assets[1]; };
    else f.dependencies.request = async () => { f.state.current = false; return { ok: true }; };
    await assert.rejects(f.prepare(), /scope changed/); assert.equal(f.state.gets.length <= 1, true);
  }
  const f = bananaFixture(), original = structuredClone(f.assets[1]); f.assets[1].contentHash = 'f'.repeat(64);
  await assert.rejects(f.prepare(), error => error instanceof HistoryReferenceRecoveryRequired && error.target.referenceIndex === 0);
  const recovered = { ...original, id: 'banana-recovered', entityUid: 'b1000000-0000-4000-8000-000000000000' };
  const deps = { ...f.dependencies, recoveredReferences: [{ referenceIndex: 0, assetId: recovered.id,
    entityUid: recovered.entityUid, contentHash: recovered.contentHash, kind: 'image' }],
    getAsset: async (id: string): Promise<any> => id === recovered.id ? recovered : f.assets.find(asset => asset.id === id) };
  const draft = await prepareHistoryInputDraft(f.archive, f.group, f.scope, deps);
  for (const index of [0, 2]) assert.match(draft.references[index].url, /banana-recovered\/media/);
  deps.recoveredReferences[0].contentHash = 'f'.repeat(64);
  await assert.rejects(prepareHistoryInputDraft(f.archive, f.group, f.scope, deps), /与原归档不一致/);
});

function falFixture(apiModel = 'gpt-image-2-fal') {
  const f = fixture(), gpt = apiModel === 'gpt-image-2-fal';
  f.archive.snapshot.node.data.historyResolvedInput.basicSettings = {
    model: gpt ? 'gpt-image-2' : apiModel.slice(0, -4), apiModel, imageBuiltinSource: 'zhenzhen',
    providerSource: 'zhenzhen', providerId: '', providerModel: '', aspectRatio: '16:9', sizeLevel: '2K',
    falN: 3, falFormat: 'webp', falSync: true,
    ...(gpt ? { falMode: 'edit', falSize: 'custom', falCustomW: 1001, falCustomH: 769, falQuality: 'high' }
      : { nbAspect: '9:16', nbResolution: '4K', nbSafety: '1', nbSeed: 0, nbSysPrompt: '', nbWebSearch: false, nbImgMode: 'base64' }),
  };
  return f;
}

test('ordinary Banana full-client seed passes actual draft preparation without an irrelevant advanced section', async () => {
  for (const apiModel of ['gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'nano-banana-pro',
    'nano-banana-pro-2k', 'nano-banana-pro-4k', 'gemini-3-pro-image']) {
    const f = fixture(), context = createPersistenceContext(f.assets, 'image', 'banana', apiModel);
    f.archive.snapshot.node.data.historyResolvedInput = context;
    const draft = await f.prepare(), lite = apiModel === 'gemini-3.1-flash-lite-image';
    assert.equal(draft.inputKind, 'banana-image');
    for (const [key, value] of Object.entries(context.basicSettings)) assert.deepEqual(draft.data[key], value, key);
    assert.equal(draft.prompt, context.prompt); assert.equal(draft.references.length, 3); assert.equal(f.state.heads.length, 2);
    assert.deepEqual((draft.data.promptMentions as any[]).map(item => item.token), ['@image2', '@image3']);
    assert.deepEqual(draft.fields.map(field => field.key).sort(),
      ['prompt', 'model', 'apiModel', 'aspectRatio', 'imageBuiltinSource', lite ? 'requestedImageSize' : 'sizeLevel'].sort());
    assert.ok(draft.fields.every(field => !field.advanced));
    assert.equal(draft.fields.find(field => field.key === 'requestedImageSize')?.after, lite ? '1K' : undefined);
    const patch = createHistoryInputDraftPatch(draft, { ...f.scope, id: 'banana-seed', baseRevision: 1, position: { x: 0, y: 0 } });
    assert.equal(patch.operations.length, 1); assert.equal(patch.operations[0].type, 'node.add');
    assert.equal(Object.hasOwn((patch.operations[0].payload as any).node.data, 'requestedImageSize'), false);
  }
});

test('FAL full-client seed passes real draft preparation with model-specific effective review fields', async () => {
  for (const apiModel of ['gpt-image-2-fal', 'nano-banana-pro-fal', 'nano-banana-2-fal']) {
    const f = fixture(), context = createPersistenceContext(f.assets, 'image', 'fal', apiModel);
    f.archive.snapshot.node.data.historyResolvedInput = context;
    const draft = await f.prepare(); assert.equal(draft.inputKind, 'fal-image');
    for (const [key, value] of Object.entries(context.basicSettings)) assert.deepEqual(draft.data[key], value, key);
    assert.equal(draft.references.length, 3); assert.equal(f.state.heads.length, 2);
    assert.deepEqual((draft.data.promptMentions as any[]).map(mention => mention.token), ['@image2', '@image3']);
    const gpt = apiModel === 'gpt-image-2-fal';
    assert.deepEqual(draft.fields.filter(field => field.advanced).map(field => [field.key, field.after]), gpt
      ? [['falFormat', 'webp'], ['falSync', 'true'], ['falQuality', 'high']]
      : [['falFormat', 'webp'], ['nbSafety', '1'], ['nbSeed', '0'], ['nbSysPrompt', ''], ['nbWebSearch', 'false'], ['nbImgMode', 'base64']]);
    assert.equal(draft.fields.some(field => field.key === 'falSync'), gpt);
    const patch = createHistoryInputDraftPatch(draft, { ...f.scope, id: 'fal-seed', baseRevision: 1, position: { x: 0, y: 0 } });
    assert.equal(patch.operations.length, 1); assert.equal(patch.operations[0].type, 'node.add');
  }
});

test('FAL fixed-asset drafts preserve ordered mentions and only create one independent node after strict validation', async () => {
  for (const apiModel of ['gpt-image-2-fal', 'nano-banana-pro-fal', 'nano-banana-2-fal']) {
    const f = falFixture(apiModel), original = structuredClone(f.archive), draft = await f.prepare();
    assert.equal(draft.inputKind, 'fal-image'); assert.equal(draft.references.length, 3);
    assert.deepEqual(f.state.gets, ['asset-1', 'asset-0']); assert.equal(f.state.maxActive, 1);
    assert.equal(new Set(draft.references.map(ref => ref.url)).size, 3);
    assert.deepEqual((draft.data.promptMentions as any[]).map(mention => mention.token), ['@image2', '@image3']);
    assert.equal(draft.prompt, original.snapshot.node.data.historyResolvedInput.prompt);
    const patch = createHistoryInputDraftPatch(draft, { ...f.scope, id: 'confirmed-fal', baseRevision: 1, position: { x: 0, y: 0 } });
    assert.equal(patch.requiresConfirmation, true); assert.equal(patch.operations.length, 1); assert.equal(patch.operations[0].type, 'node.add');
    const node: any = patch.operations[0].payload.node; assert.notEqual(node.id, f.group.nodeId);
    for (const key of ['taskId', 'imageUrl', 'runTrigger', 'apiKey', 'providerParams', 'imagePromptAdjustments', 'historyResolvedInput', 'materialOrder']) {
      assert.equal(Object.hasOwn(node.data, key), false, key);
    }
    assert.deepEqual(f.archive, original);
  }
});

test('FAL review hides inactive fields; gen neither reads nor restores unused historical references', async () => {
  const gpt = falFixture(), draft = await gpt.prepare();
  for (const key of ['falMode', 'falSize', 'falCustomW', 'falCustomH', 'falN']) {
    const field = draft.fields.find(item => item.key === key); assert.ok(field); assert.equal(field.advanced, undefined);
  }
  assert.equal(draft.fields.find(field => field.key === 'falCustomW')?.after, '1001');
  assert.equal(draft.fields.some(field => field.key === 'aspectRatio' || field.key === 'sizeLevel'), false);
  const gen = falFixture(); Object.assign(gen.archive.snapshot.node.data.historyResolvedInput.basicSettings, { falMode: 'gen', falSize: 'auto' });
  gen.archive.references = undefined;
  const genDraft = await gen.prepare();
  assert.deepEqual(gen.state.gets, []); assert.deepEqual(gen.state.heads, []); assert.deepEqual(genDraft.references, []);
  assert.deepEqual(genDraft.data.referenceImages, []); assert.deepEqual(genDraft.data.promptMentions, []);
  assert.equal(genDraft.prompt, gen.archive.snapshot.node.data.historyResolvedInput.prompt);
  assert.equal(genDraft.fields.some(field => ['falCustomW', 'falCustomH'].includes(field.key)), false);
  const banana = await falFixture('nano-banana-pro-fal').prepare();
  assert.equal(banana.data.falSync, true); assert.equal(banana.fields.some(field => field.key === 'falSync'), false);
  assert.equal(banana.fields.find(field => field.key === 'nbSeed')?.after, '0');
  assert.equal(banana.fields.find(field => field.key === 'nbWebSearch')?.after, 'false');
  for (const key of ['nbAspect', 'nbResolution', 'falN']) assert.equal(banana.fields.find(field => field.key === key)?.advanced, undefined);
});

test('FAL bad source and extras cannot bypass the reader; reference recovery stays bound to original hash', async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.archive.snapshot.node.data.providerParams = { n: 2 }; },
    (f: ReturnType<typeof fixture>) => { f.archive.snapshot.node.data.historyResolvedInput.basicSettings.imageBuiltinSource = 'seedance-nz'; },
    (f: ReturnType<typeof fixture>) => { f.archive.snapshot.node.data.historyResolvedInput.basicSettings.model = 'nano-banana-pro'; },
    (f: ReturnType<typeof fixture>) => { delete f.archive.snapshot.node.data.historyResolvedInput.basicSettings.falMode; },
  ]) {
    const f = falFixture(); mutate(f); await assert.rejects(f.prepare()); assert.deepEqual(f.state.gets, []);
  }
  const f = falFixture('nano-banana-2-fal'), original = structuredClone(f.assets[1]); f.assets[1].contentHash = 'f'.repeat(64);
  await assert.rejects(f.prepare(), error => error instanceof HistoryReferenceRecoveryRequired && error.target.referenceIndex === 0);
  const recovered = { ...original, id: 'fal-recovered', entityUid: 'b1000000-0000-4000-8000-000000000000' };
  const deps = { ...f.dependencies, recoveredReferences: [{ referenceIndex: 0, assetId: recovered.id,
    entityUid: recovered.entityUid, contentHash: recovered.contentHash, kind: 'image' }],
    getAsset: async (id: string): Promise<any> => id === recovered.id ? recovered : f.assets.find(asset => asset.id === id) };
  const draft = await prepareHistoryInputDraft(f.archive, f.group, f.scope, deps);
  for (const index of [0, 2]) assert.match(draft.references[index].url, /fal-recovered\/media/);
  deps.recoveredReferences[0].contentHash = 'f'.repeat(64);
  await assert.rejects(prepareHistoryInputDraft(f.archive, f.group, f.scope, deps), /与原归档不一致/);
});

function budgetFixture(variant = 'flare') {
  const f = fixture(), lowprice = variant === 'lowprice';
  f.archive.snapshot.node.data.historyResolvedInput.basicSettings = {
    model: 'gpt-image-2', apiModel: `zhenzhen-image-g-v2.5-${variant}`, imageBuiltinSource: 'seedance-nz',
    providerSource: 'zhenzhen', providerId: '', providerModel: '', aspectRatio: '16:9', sizeLevel: '2K',
    zhenzhenImageG25Size: lowprice ? '16:9' : 'custom', zhenzhenImageG25Resolution: '4k', zhenzhenImageG25Count: lowprice ? 1 : 4,
    ...(lowprice ? { zhenzhenImageG25NsfwCheck: false } : { zhenzhenImageG25CustomWidth: 1536, zhenzhenImageG25CustomHeight: 1024,
      zhenzhenImageG25Quality: 'max', zhenzhenImageG25OutputFormat: 'webp', zhenzhenImageG25OutputCompression: 0,
      zhenzhenImageG25Background: 'transparent', zhenzhenImageG25Moderation: 'low' }),
  };
  return f;
}

test('Budget full-client fixture passes real draft preparation with five advanced effective options', async () => {
  const f = fixture();
  const context = createPersistenceContext(f.assets, 'image', 'budget');
  f.archive.snapshot.node.data.historyResolvedInput = context;
  const draft = await f.prepare();
  assert.equal(draft.inputKind, 'budget-image');
  for (const [key, value] of Object.entries(context.basicSettings)) assert.deepEqual(draft.data[key], value, key);
  assert.equal(draft.prompt, context.prompt); assert.equal(draft.references.length, 3);
  assert.deepEqual(draft.fields.filter(field => field.advanced).map(field => [field.key, field.after]), [
    ['zhenzhenImageG25Quality', 'max'], ['zhenzhenImageG25OutputFormat', 'webp'],
    ['zhenzhenImageG25OutputCompression', '0'], ['zhenzhenImageG25Background', 'transparent'], ['zhenzhenImageG25Moderation', 'low'],
  ]);
  assert.equal(draft.fields.some(field => field.key === 'zhenzhenImageG25Resolution'), false);
  assert.deepEqual((draft.data.promptMentions as any[]).map(item => item.token), ['@image2', '@image3']);
  const patch = createHistoryInputDraftPatch(draft, { ...f.scope, id: 'budget-fixture', baseRevision: 1, position: { x: 0, y: 0 } });
  assert.equal(patch.operations.length, 1); assert.equal(patch.operations[0].type, 'node.add');
});

test('all Budget Image G drafts restore ordered fixed slots and mentions into one independent node without copying live data', async () => {
  for (const variant of ['lowprice', 'flare', 'sunburst']) {
    const f = budgetFixture(variant), original = structuredClone(f.archive), draft = await f.prepare();
    assert.equal(draft.inputKind, 'budget-image'); assert.equal(draft.nodeType, 'image');
    assert.equal(draft.references.length, 3); assert.equal(new Set(draft.references.map(ref => ref.url)).size, 3);
    assert.deepEqual(f.state.gets, ['asset-1', 'asset-0']); assert.equal(f.state.heads.length, 2); assert.equal(f.state.maxActive, 1);
    assert.deepEqual(draft.data.referenceImages, draft.references.map(ref => ref.url));
    assert.deepEqual((draft.data.promptMentions as any[]).map(item => item.token), ['@image2', '@image3']);
    const materials = draft.references.map(ref => ({ id: `local::image:${ref.url}`, kind: 'image' as const, url: ref.url, sourceNodeId: 'new', origin: 'local' as const }));
    assert.equal(resolveMediaMentions(draft.prompt, draft.data.promptMentions as any[], materials), draft.prompt);
    assert.equal(draft.prompt, original.snapshot.node.data.historyResolvedInput.prompt);
    const patch = createHistoryInputDraftPatch(draft, { ...f.scope, id: 'budget-approved', baseRevision: 1, position: { x: 0, y: 0 } });
    assert.equal(patch.operations.length, 1); assert.equal(patch.operations[0].type, 'node.add'); assert.equal(patch.requiresConfirmation, true);
    const node: any = patch.operations[0].payload.node; assert.notEqual(node.id, f.group.nodeId);
    for (const key of ['taskId', 'imageUrl', 'imagePromptAdjustments', 'runTrigger', 'apiKey', 'providerParams', 'materialOrder', 'historyResolvedInput']) {
      assert.equal(Object.hasOwn(node.data, key), false, key);
    }
    assert.deepEqual(f.archive, original);
  }
});

test('Budget confirmation shows only effective sizing and format options while preserving stored zero/false values', async () => {
  const custom = budgetFixture(), customDraft = await custom.prepare();
  for (const key of ['zhenzhenImageG25Size', 'zhenzhenImageG25Count', 'zhenzhenImageG25CustomWidth', 'zhenzhenImageG25CustomHeight']) {
    const field = customDraft.fields.find(item => item.key === key); assert.ok(field); assert.equal(field.advanced, undefined);
  }
  for (const key of ['aspectRatio', 'sizeLevel', 'providerId', 'providerModel', 'zhenzhenImageG25Resolution']) {
    assert.equal(customDraft.fields.some(field => field.key === key), false);
    assert.equal(customDraft.data[key], custom.archive.snapshot.node.data.historyResolvedInput.basicSettings[key]);
  }
  assert.equal(customDraft.fields.find(field => field.key === 'zhenzhenImageG25OutputCompression')?.after, '0');
  assert.equal(customDraft.fields.find(field => field.key === 'zhenzhenImageG25OutputCompression')?.advanced, true);
  const preset = budgetFixture(); Object.assign(preset.archive.snapshot.node.data.historyResolvedInput.basicSettings,
    { zhenzhenImageG25Size: 'preserve_reference', zhenzhenImageG25OutputFormat: 'png' });
  const presetDraft = await preset.prepare();
  assert.equal(presetDraft.fields.find(field => field.key === 'zhenzhenImageG25Resolution')?.after, '4k');
  for (const key of ['zhenzhenImageG25CustomWidth', 'zhenzhenImageG25CustomHeight', 'zhenzhenImageG25OutputCompression']) {
    assert.equal(presetDraft.fields.some(field => field.key === key), false); assert.ok(Object.hasOwn(presetDraft.data, key));
  }
  const low = await budgetFixture('lowprice').prepare();
  assert.equal(low.data.zhenzhenImageG25NsfwCheck, false);
  assert.equal(low.fields.find(field => field.key === 'zhenzhenImageG25NsfwCheck')?.after, 'false');
  assert.equal(low.fields.find(field => field.key === 'zhenzhenImageG25Count')?.after, '1');
});

test('Budget invalid archive or changed scope stops before assets; original recovery remains tied to fixed content', async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.archive.snapshot.node.data.historyResolvedInput.basicSettings.apiModel = 'zhenzhen-image-g2-t2i'; },
    (f: ReturnType<typeof fixture>) => { delete f.archive.snapshot.node.data.historyResolvedInput.basicSettings.zhenzhenImageG25Quality; },
    (f: ReturnType<typeof fixture>) => { f.scope.projectId = 'other'; },
  ]) {
    const f = budgetFixture(); mutate(f); await assert.rejects(f.prepare()); assert.deepEqual(f.state.gets, []);
  }
  const f = budgetFixture(), original = structuredClone(f.assets[1]); f.assets[1].contentHash = 'f'.repeat(64);
  await assert.rejects(f.prepare(), error => {
    assert.ok(error instanceof HistoryReferenceRecoveryRequired); assert.equal(error.target.referenceIndex, 0); return true;
  });
  const recovered = { ...original, id: 'budget-recovered', entityUid: 'b1000000-0000-4000-8000-000000000000' };
  const deps = { ...f.dependencies, recoveredReferences: [{ referenceIndex: 0, assetId: recovered.id,
    entityUid: recovered.entityUid, contentHash: recovered.contentHash, kind: 'image' }],
    getAsset: async (id: string): Promise<any> => id === recovered.id ? recovered : f.assets.find(asset => asset.id === id) };
  const draft = await prepareHistoryInputDraft(f.archive, f.group, f.scope, deps);
  for (const index of [0, 2]) assert.match(draft.references[index].url, /budget-recovered\/media/);
  assert.equal(f.archive.references.entries[0].assetId, original.id);
  deps.recoveredReferences[0].contentHash = 'f'.repeat(64);
  await assert.rejects(prepareHistoryInputDraft(f.archive, f.group, f.scope, deps), /与原归档不一致/);
});

test('image draft freezes three ordered slots with two sequential version checks and exact prompt/mentions after source deletion', async () => {
  const f = fixture(), original = structuredClone(f.archive), draft = await f.prepare();
  assert.equal(draft.nodeType, 'image'); assert.equal(draft.inputKind, 'standard-image'); assert.equal(draft.resolvedFrontendInputs, true);
  assert.equal(draft.prompt, original.snapshot.node.data.historyResolvedInput.prompt);
  assert.deepEqual(draft.references.map(ref => new URL(ref.url, 'http://localhost').pathname),
    ['/api/project-assets/asset-1/media', '/api/project-assets/asset-0/media', '/api/project-assets/asset-1/media']);
  assert.deepEqual(draft.data.referenceImages, draft.references.map(ref => ref.url));
  assert.equal(new Set(draft.references.map(ref => ref.url)).size, 3);
  assert.deepEqual(f.state.gets, ['asset-1', 'asset-0']); assert.equal(f.state.heads.length, 2); assert.equal(f.state.maxActive, 1);
  for (let index = 0; index < 3; index++) {
    const query = new URL(draft.references[index].url, 'http://localhost').searchParams;
    assert.equal(query.get('referenceSlot'), String(index)); assert.equal(query.get('projectId'), 'p');
    assert.equal(query.get('contentHash'), f.assets[index === 1 ? 0 : 1].contentHash);
  }
  const mentions = draft.data.promptMentions as any[];
  assert.deepEqual(mentions.map(item => item.token), ['@image2', '@image3']);
  assert.deepEqual(mentions.map(item => item.url), [draft.references[1].url, draft.references[2].url]);
  const materials = draft.references.map(ref => ({ id: `local::image:${ref.url}`, kind: 'image' as const, url: ref.url, sourceNodeId: 'new', origin: 'local' as const }));
  assert.equal(resolveMediaMentions(draft.prompt, mentions, orderMaterials(materials, [])), draft.prompt);
  assert.equal(resolveMediaMentions(draft.prompt, mentions, orderMaterials(materials, [materials[2].id])),
    draft.prompt.replace('Use @image2 and @image3', 'Use @image3 and @image1'));
  assert.equal(draft.fields.find(item => item.key === 'apiModel')?.label, '子模型');
  assert.equal(draft.fields.find(item => item.key === 'gptImageQuality')?.advanced, true);
  assert.equal(draft.fields.some(item => ['aspectRatio', 'sizeLevel', 'providerId', 'providerModel', 'providerSource',
    'gptImage25CustomWidth', 'gptImage25CustomHeight'].includes(item.key)), false, 'unused sizes and empty provider identity are not shown as effective inputs');
  assert.equal(draft.fields.find(item => item.key === 'gptImage25Size')?.after, '1536x1024');
  assert.equal(draft.fields.find(item => item.key === 'gptImage25Size')?.advanced, undefined);
  assert.equal(draft.fields.find(item => item.key === 'gptImage25Count')?.advanced, undefined);
  assert.deepEqual(f.archive, original);
  const patch = createHistoryInputDraftPatch(draft, { ...f.scope, id: 'approved', baseRevision: 4, position: { x: 10, y: 20 } });
  assert.equal(patch.requiresConfirmation, true); assert.equal(patch.operations.length, 1);
  assert.equal(patch.operations[0].type, 'node.add');
  const node: any = patch.operations[0].payload.node;
  assert.notEqual(node.id, f.group.nodeId); assert.equal(node.type, 'image');
  for (const key of ['localRefImages', 'localRefVideos', 'localRefAudios', 'imagePromptAdjustments', 'materialOrder',
    'providerParams', 'apiKey', 'imageUrl', 'taskId', 'runTrigger', 'historyResolvedInput']) assert.equal(Object.hasOwn(node.data, key), false, key);
  assert.equal(node.data.gptImageQuality, 'max'); assert.equal(node.data.gptImage25Count, 2);
});

test('custom image size/count are primary review values without changing stored settings; GPT2 keeps its active ratio and size', async () => {
  const custom = fixture(); custom.archive.snapshot.node.data.historyResolvedInput.basicSettings.gptImage25Size = 'custom';
  const draft = await custom.prepare();
  for (const key of ['gptImage25Size', 'gptImage25CustomWidth', 'gptImage25CustomHeight', 'gptImage25Count']) {
    const field = draft.fields.find(item => item.key === key); assert.ok(field); assert.equal(field.advanced, undefined);
    assert.equal(field.after, String(draft.data[key]));
  }
  assert.equal(draft.data.aspectRatio, '1:1'); assert.equal(draft.data.sizeLevel, '2K');
  assert.equal(draft.data.providerId, ''); assert.equal(draft.data.providerModel, '');
  const standard = fixture(); standard.archive.snapshot.node.data.historyResolvedInput.basicSettings.apiModel = 'gpt-image-2';
  standard.archive.snapshot.node.data.historyResolvedInput.basicSettings.gptImageQuality = 'high';
  const standardDraft = await standard.prepare();
  assert.equal(standardDraft.fields.find(item => item.key === 'aspectRatio')?.after, '1:1');
  assert.equal(standardDraft.fields.find(item => item.key === 'sizeLevel')?.after, '2K');
  assert.equal(standardDraft.fields.some(item => item.key.startsWith('gptImage25')), false);
});

test('image draft rejects mismatched scope/identity and unsupported inputs before reading any asset', async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.scope.canvasId = 'other'; },
    (f: ReturnType<typeof fixture>) => { f.archive.binding.nodeEntityUid = f.group.nodeEntityUid = null; },
    (f: ReturnType<typeof fixture>) => { f.group.nodeType = 'video'; },
    (f: ReturnType<typeof fixture>) => { f.archive.snapshot.node.data.historyResolvedInput.basicSettings.imageBuiltinSource = 'seedance-nz'; },
    (f: ReturnType<typeof fixture>) => { f.archive.snapshot.node.data.providerParams = { n: 5 }; },
    (f: ReturnType<typeof fixture>) => { delete f.archive.snapshot.node.data.historyResolvedInput; },
  ]) {
    const f = fixture(); mutate(f); await assert.rejects(f.prepare());
    assert.deepEqual(f.state.gets, []); assert.deepEqual(f.state.heads, []);
  }
});

test('image drafts reject unknown bindings, inconsistent aliases, changed bytes and cross-project media without partial drafts', async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.archive.references = undefined; },
    (f: ReturnType<typeof fixture>) => { f.archive.references.entries[2].kind = 'video'; },
    (f: ReturnType<typeof fixture>) => { f.archive.references.entries[2].contentHash = 'f'.repeat(64); },
    (f: ReturnType<typeof fixture>) => { f.assets[0].contentHash = 'f'.repeat(64); },
    (f: ReturnType<typeof fixture>) => { f.assets[0].projectId = 'other'; },
    (f: ReturnType<typeof fixture>) => { f.dependencies.request = async () => ({ ok: false }); },
  ]) { const f = fixture(); mutate(f); await assert.rejects(f.prepare()); }
});

test('image reference recovery uses only the exact archived hash target and preserves both duplicate slots', async () => {
  const f = fixture(), original = structuredClone(f.assets[1]); f.assets[1].contentHash = 'f'.repeat(64);
  await assert.rejects(f.prepare(), error => {
    assert.ok(error instanceof HistoryReferenceRecoveryRequired);
    assert.deepEqual(error.target, { referenceGroupId: 'g', referenceArchiveDigest: 'server-verified', referenceIndex: 0 }); return true;
  });
  const recovered = { ...original, id: 'recovered', entityUid: 'b1000000-0000-4000-8000-000000000000' };
  const dependencies = { ...f.dependencies, recoveredReferences: [{ referenceIndex: 0, assetId: recovered.id,
    entityUid: recovered.entityUid, contentHash: recovered.contentHash, kind: 'image' }],
    getAsset: async (id: string): Promise<any> => id === recovered.id ? recovered : f.assets.find(asset => asset.id === id) };
  const draft = await prepareHistoryInputDraft(f.archive, f.group, f.scope, dependencies);
  for (const index of [0, 2]) assert.match(draft.references[index].url, /recovered\/media/);
  assert.equal(draft.references.length, 3); assert.notEqual(draft.references[0].url, draft.references[2].url);
  assert.equal(f.archive.references.entries[0].assetId, original.id);
  dependencies.recoveredReferences[0].contentHash = 'f'.repeat(64);
  await assert.rejects(prepareHistoryInputDraft(f.archive, f.group, f.scope, dependencies), /与原归档不一致/);
});

test('image preparation stops on scope change at either asynchronous boundary', async () => {
  const lookup = fixture(); lookup.dependencies.getAsset = async () => { lookup.state.current = false; return lookup.assets[1]; };
  await assert.rejects(lookup.prepare(), /scope changed/); assert.equal(lookup.state.heads.length, 0);
  const head = fixture(); head.dependencies.request = async () => { head.state.current = false; return { ok: true }; };
  await assert.rejects(head.prepare(), /scope changed/); assert.equal(head.state.gets.length, 1);
});
