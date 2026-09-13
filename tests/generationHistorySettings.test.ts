import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareHistorySettingsDraft, createHistorySettingsPatch, supportsHistorySettings, supportsHistoryInputDraft } from '../src/utils/generationHistorySettings.ts';

function fixture() {
  const scope = { projectId: 'project', canvasId: 'canvas' };
  const target = { id: 'source', entityUid: 'a1000000-0000-4000-8000-000000000001', type: 'seedance', position: { x: 0, y: 0 },
    data: { prompt: 'new draft', duration: 10, ratio: '9:16', videoUrl: '/files/output/current.mp4', taskId: 'current-task', status: 'success', apiKey: 'current-config' } };
  const group: any = { id: 'group', nodeId: target.id, nodeEntityUid: target.entityUid, snapshotAvailable: true };
  const archive: any = { status: 'available', schema: 't8-generation-input-archive-v1', digest: 'verified-server-side',
    binding: { ...scope, nodeId: target.id, nodeEntityUid: target.entityUid }, snapshot: { schema: 't8-generation-settings-input-v1',
      node: { id: target.id, type: target.type, data: { prompt: '完整提示词'.repeat(3000), duration: 5,
        runTrigger: 111, taskId: 'old-task', status: 'polling', apiKey: 'must-not-copy', videoUrl: '/files/output/old.mp4', providerParams: { arbitrary: true } } },
      upstreamNodes: [], incomingEdges: [] } };
  return { scope, target, group, archive, prepare: () => prepareHistorySettingsDraft(archive, group, target, scope) };
}

test('image settings use archived frontend basic values instead of today defaults, without copying compiled prompt or extras', () => {
  const f = fixture(); f.target.type = f.archive.snapshot.node.type = 'image';
  const basicSettings = { model: 'seedream-v5', apiModel: 'saved-variant', aspectRatio: '16:9', sizeLevel: '2K',
    imageBuiltinSource: 'zhenzhen', providerSource: 'zhenzhen', providerId: '', providerModel: '', seedreamApiSource: 'seedance-nz' };
  f.archive.snapshot.node.data = { prompt: 'raw historical prompt', historyResolvedInput: {
    schema: 't8-image-frontend-context-v2', origin: 'frontend-common-context', prompt: 'compiled historical prompt',
    referenceImages: [], basicSettings,
  } };
  const before = structuredClone(f.archive);
  const draft = f.prepare();
  for (const [key, value] of Object.entries(basicSettings)) assert.equal(draft.dataPatch[key], value, key);
  assert.equal(draft.dataPatch.prompt, 'raw historical prompt', 'in-place restoration keeps current adjustment/mention semantics');
  for (const key of ['historyResolvedInput', 'providerParams', 'imagePromptAdjustments', 'referenceImages']) assert.equal(key in draft.dataPatch, false);
  assert.deepEqual(f.archive, before);
});

test('image settings refuse malformed/future frontend settings but retain explicit legacy raw-field behavior', () => {
  const f = fixture(); f.target.type = f.archive.snapshot.node.type = 'image';
  const context = { schema: 't8-image-frontend-context-v2', origin: 'frontend-common-context', prompt: 'compiled', referenceImages: [],
    basicSettings: { model: 'gpt-image-2', apiModel: 'variant', aspectRatio: '1:1', sizeLevel: '1K', imageBuiltinSource: 'zhenzhen', providerSource: 'zhenzhen', providerId: '', providerModel: '' } };
  for (const update of [{ schema: 'future' }, { basicSettings: {} }, { basicSettings: { ...context.basicSettings, sizeLevel: 12 } },
    { basicSettings: { ...context.basicSettings, taskId: 'not-an-input' } }, { origin: 'guessed' }, { referenceImages: [null] }]) {
    f.archive.snapshot.node.data = { prompt: 'old', historyResolvedInput: { ...context, ...update } };
    assert.throws(f.prepare, /历史实际输入/, JSON.stringify(update));
  }
  f.archive.snapshot.node.data = { prompt: 'old', model: 'legacy', historyResolvedInput: {
    schema: 't8-image-frontend-context-v1', origin: 'frontend-common-context', prompt: 'old compiled', referenceImages: [] } };
  assert.equal(f.prepare().dataPatch.model, 'legacy');
  assert.equal(f.prepare().dataPatch.prompt, 'old');
});

test('archived standard image options are restored as reviewed advanced fields, without filling unrecorded extras', () => {
  const f = fixture(); f.target.type = f.archive.snapshot.node.type = 'image';
  const options = { gptImageQuality: 'xhigh', gptImageModeration: 'low', gptImage25Size: 'custom',
    gptImage25CustomWidth: 1536, gptImage25CustomHeight: 1024, gptImage25Count: 3, gptImage25Background: 'opaque' };
  f.archive.snapshot.node.data = { prompt: 'original', historyResolvedInput: {
    schema: 't8-image-frontend-context-v2', origin: 'frontend-common-context', prompt: 'compiled', referenceImages: [],
    basicSettings: { model: 'gpt-image-2', apiModel: 'gpt-image-2.5-flare', aspectRatio: '1:1', sizeLevel: '1K',
      imageBuiltinSource: 'zhenzhen', providerSource: 'zhenzhen', providerId: '', providerModel: '', ...options },
  } };
  Object.assign(f.target.data, { gptImage25Count: 1, seedreamOutputFormat: 'jpeg', providerParams: { current: true } });
  const draft = f.prepare();
  for (const [key, value] of Object.entries(options)) {
    assert.equal(draft.dataPatch[key], value);
    assert.equal(draft.fields.find(field => field.key === key)?.advanced, true);
  }
  assert.equal(draft.fields.find(field => field.key === 'model')?.advanced, undefined);
  assert.equal('seedreamOutputFormat' in draft.dataPatch, false);
  assert.equal(draft.dataUnsetKeys.includes('seedreamOutputFormat'), false);
  assert.equal('providerParams' in draft.dataPatch, false);
  assert.equal(JSON.stringify(createHistorySettingsPatch(draft, { ...f.scope, id: 'options', baseRevision: 2 })).includes('advanced'), false);
  for (const invalid of [null, '3', NaN, Infinity, {}]) {
    f.archive.snapshot.node.data.historyResolvedInput.basicSettings.gptImage25Count = invalid;
    assert.throws(f.prepare, /历史实际输入/);
  }
});

test('FAL recovery preserves false, zero and full system prompt while refusing stringified booleans and oversized writes', () => {
  const f = fixture(); f.target.type = f.archive.snapshot.node.type = 'image';
  const basicSettings: Record<string, unknown> = { model: 'nano-banana-pro', apiModel: 'fal-fixture', aspectRatio: '1:1', sizeLevel: '1K',
    imageBuiltinSource: 'zhenzhen', providerSource: 'zhenzhen', providerId: '', providerModel: '',
    falN: 2, falFormat: 'webp', falSync: false, nbWebSearch: false, nbSeed: 0, nbSysPrompt: 'Archived system prompt' };
  f.archive.snapshot.node.data = { prompt: 'old', historyResolvedInput: {
    schema: 't8-image-frontend-context-v2', origin: 'frontend-common-context', prompt: 'old', referenceImages: [], basicSettings,
  } };
  Object.assign(f.target.data, { falSync: true, nbWebSearch: true, nbSeed: 123, falCustomW: 2048 });
  const draft = f.prepare();
  assert.equal(draft.dataPatch.falSync, false); assert.equal(draft.dataPatch.nbWebSearch, false);
  assert.equal(draft.dataPatch.nbSeed, 0); assert.equal(draft.dataPatch.nbSysPrompt, 'Archived system prompt');
  assert.equal(draft.dataUnsetKeys.includes('falCustomW'), false);
  assert.equal(draft.fields.find(field => field.key === 'nbSeed')?.advanced, true);
  for (const invalid of ['false', 0, null]) { basicSettings.falSync = invalid; assert.throws(f.prepare, /历史实际输入/); }
  basicSettings.falSync = false; basicSettings.nbSysPrompt = 'x'.repeat(65537);
  const long = f.prepare(); assert.equal((long.dataPatch.nbSysPrompt as string).length, 65537);
  assert.throws(() => createHistorySettingsPatch(long, { ...f.scope, id: 'long-system', baseRevision: 2 }), /未截断/);
});

for (const [type, saved] of Object.entries({
  image: { model: 'gpt-image-2', apiModel: 'gpt-image-2-all', imageBuiltinSource: 'zhenzhen', aspectRatio: '16:9', sizeLevel: '2K' },
  video: { mainId: 'grok-video', model: 'grok-video-3', videoBuiltinSource: 'zhenzhen', duration: 6, ratio: '16:9', resolution: '720p', generateAudio: false, enhancePrompt: true, size: '1280x720', seed: 12 },
})) {
  test(`${type} history restores only its own basic parameters and preserves all current results and references`, () => {
    const f = fixture(); f.target.type = f.archive.snapshot.node.type = type;
    f.archive.snapshot.node.data = { prompt: 'old local prompt', ...saved, apiKey: 'must-not-copy',
      runTrigger: 3, status: 'success', referenceImages: ['/old.png'], providerParams: { secret: 'old' } };
    Object.assign(f.target.data, { referenceImages: ['/current.png'], localRefVideos: ['/current.mp4'],
      imageUrls: ['/current.png'], providerParams: { current: true } });
    const before = structuredClone(f.target);
    const draft = f.prepare();
    for (const [key, value] of Object.entries(saved)) assert.deepEqual(draft.dataPatch[key], value);
    assert.equal(draft.dataPatch.prompt, 'old local prompt');
    assert.equal(draft.referenceWarning, true);
    assert.deepEqual(f.target, before);
    for (const key of ['referenceImages', 'localRefVideos', 'imageUrls', 'videoUrl', 'taskId', 'status', 'apiKey', 'providerParams', 'runTrigger']) {
      assert.equal(Object.hasOwn(draft.dataPatch, key), false, key);
      assert.equal(draft.dataUnsetKeys.includes(key), false, key);
    }
    assert.equal(createHistorySettingsPatch(draft, { ...f.scope, id: 'basic-only', baseRevision: 2 }).operations[0].type, 'node.patch');
  });
}
test('settings draft uses an audited allowlist and unset keys; output/runtime/credential/reference state is untouched', () => {
  const f = fixture(), before = structuredClone(f.target), draft = f.prepare();
  assert.equal(draft.prompt, f.archive.snapshot.node.data.prompt);
  assert.equal(draft.dataPatch.duration, 5);
  assert.deepEqual(draft.dataUnsetKeys, ['ratio']);
  assert.deepEqual(Object.keys(draft.dataPatch).sort(), ['duration', 'prompt']);
  assert.deepEqual(f.target, before);
  const patch = createHistorySettingsPatch(draft, { ...f.scope, id: 'approved-patch', baseRevision: 4 });
  assert.equal(patch.operations.length, 1); assert.equal(patch.operations[0].type, 'node.patch');
  assert.equal(patch.operations[0].payload.nodeId, f.target.entityUid);
  assert.equal(patch.requiresConfirmation, true);
  assert.equal(JSON.stringify(patch).includes('must-not-copy'), false);
  assert.equal(JSON.stringify(patch).includes('runTrigger'), false);
});
test('settings cannot target a replaced source, different scope, running node, unsupported type or incomplete archive', () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.target.entityUid = 'replacement'; },
    (f: ReturnType<typeof fixture>) => { f.scope.canvasId = 'other'; },
    (f: ReturnType<typeof fixture>) => { f.target.data.status = 'polling'; },
    (f: ReturnType<typeof fixture>) => { f.archive.status = 'unavailable'; },
    (f: ReturnType<typeof fixture>) => { f.target.type = f.archive.snapshot.node.type = 'unknown'; },
    (f: ReturnType<typeof fixture>) => { f.archive.snapshot.node.data.prompt = { unsupported: true }; },
  ]) { const f = fixture(); mutate(f); assert.throws(f.prepare); }
});
test('image generating status is busy; image-only references require acknowledgement', () => {
  const f = fixture(); f.target.type = f.archive.snapshot.node.type = 'image';
  f.target.data.status = 'generating'; assert.throws(f.prepare, /节点正在运行/);
  f.target.data.status = 'success';
  f.archive.snapshot.node.data.referenceImages = ['/old-only.png'];
  assert.equal(f.prepare().referenceWarning, true);
});
test('basic support is separate from complete input recovery, with exact node types', () => {
  for (const type of ['image', 'video']) {
    assert.equal(supportsHistorySettings(type), true);
    assert.equal(supportsHistoryInputDraft(type), true, 'each type must still pass its strict archived-input adapter');
  }
  for (const type of ['seedance', 'seedance25']) assert.equal(supportsHistoryInputDraft(type), true);
  for (const type of ['upload', 'audio', 'image-custom', 'toString', '__proto__']) assert.equal(supportsHistorySettings(type), false);
  const ui = readFileSync(new URL('../src/components/GenerationHistoryRecords.tsx', import.meta.url), 'utf8');
  assert.match(ui, /onPrepareSettings && group.snapshotAvailable && group.sourceNodeExists && supportsHistorySettings\(group.nodeType\)/);
  assert.match(ui, /onPrepareInputDraft && group.snapshotAvailable && supportsHistoryInputDraft\(group.nodeType\)/);
});
test('video string references are retained with explicit acknowledgement', () => {
  for (const key of ['wanAudioUrl', 'gkfReferenceUrls']) {
    const f = fixture(); f.target.type = f.archive.snapshot.node.type = 'video';
    f.archive.snapshot.node.data[key] = '/owned-reference';
    assert.equal(f.prepare().referenceWarning, true);
    assert.equal(Object.hasOwn(f.prepare().dataPatch, key), false);
  }
});

test('MJ special references require explicit acknowledgement but are never copied by scalar restoration', () => {
  for (const key of ['mjSrefImages', 'mjOrefImages', 'mjNzCref', 'mjNzSref', 'mjNzDref']) {
    for (const location of ['history', 'current']) {
      const f = fixture(); f.target.type = f.archive.snapshot.node.type = 'image';
      f.archive.snapshot.node.data = { prompt: 'old prompt' };
      const data: any = location === 'history' ? f.archive.snapshot.node.data : f.target.data;
      data[key] = key.endsWith('Images') ? ['/files/input/ref.png'] : '/files/input/ref.png';
      const draft = f.prepare();
      assert.equal(draft.referenceWarning, true, `${location}:${key}`);
      assert.equal(key in draft.dataPatch, false); assert.equal(draft.dataUnsetKeys.includes(key), false);
    }
  }
});

test('budget MJ task actions cannot silently reuse the current task identity when restoring history', () => {
  for (const location of ['history', 'current']) for (const action of ['midjourney-upscale', 'midjourney-modal', 'midjourney-video', 'unknown-action']) {
    const f = fixture(); f.target.type = f.archive.snapshot.node.type = 'image';
    f.archive.snapshot.node.data = { model: 'midjourney', imageBuiltinSource: 'seedance-nz', prompt: 'old', mjNzOperation: 'midjourney-imagine' };
    Object.assign(f.target.data, { model: 'midjourney', imageBuiltinSource: 'seedance-nz', mjNzOperation: 'midjourney-imagine', mjNzSourceTaskId: 'current-task' });
    const data: any = location === 'history' ? f.archive.snapshot.node.data : f.target.data;
    data.mjNzOperation = action; data.mjNzVideoSource = 'task'; data.mjNzSourceTaskId = `${location}-task`;
    const before = structuredClone(f.target);
    assert.throws(f.prepare, /Midjourney.*任务/); assert.deepEqual(f.target, before);
  }
  const ordinary = fixture(); ordinary.target.type = ordinary.archive.snapshot.node.type = 'image';
  ordinary.archive.snapshot.node.data = { model: 'gpt-image-2', prompt: 'old', mjNzOperation: 'midjourney-upscale' };
  assert.equal(ordinary.prepare().dataPatch.model, 'gpt-image-2', 'inactive stale MJ fields do not block another model');
});
test('new incoming connections added after generation still require current-reference acknowledgement', () => {
  const f = fixture(); f.target.type = f.archive.snapshot.node.type = 'image';
  f.archive.snapshot.node.data = { prompt: 'archived prompt' };
  const prepare = (currentEdges: Array<{ source: string; target: string }>) =>
    prepareHistorySettingsDraft(f.archive, f.group, f.target, { ...f.scope, currentEdges });
  assert.equal(prepare([]).referenceWarning, false);
  assert.equal(prepare([{ source: 'new-text', target: 'another-node' }]).referenceWarning, false);
  const edges = [{ source: 'new-text', target: f.target.id }], before = structuredClone(edges);
  const draft = prepare(edges);
  assert.equal(draft.referenceWarning, true);
  assert.deepEqual(edges, before);
  assert.deepEqual(Object.keys(draft.dataPatch), ['prompt']);
});
test('references are detected but never silently replaced; unchanged settings produce no write', () => {
  const f = fixture();
  f.archive.snapshot.upstreamNodes.push({ id: 'ref', type: 'upload', data: { imageUrl: '/files/input/old.png' } });
  const draft = f.prepare(); assert.equal(draft.referenceWarning, true);
  assert.equal(draft.dataPatch.localRefImages, undefined); assert.equal(draft.dataPatch.promptMentions, undefined);
  f.archive.snapshot.node.data = structuredClone(f.target.data);
  assert.equal(f.prepare().fields.length, 0);
  assert.throws(() => createHistorySettingsPatch(f.prepare(), { ...f.scope, id: 'noop', baseRevision: 4 }), /一致/);
});
test('historical text beyond the existing CanvasPatch string bound is never silently truncated', () => {
  const f = fixture(); f.archive.snapshot.node.data.prompt = 'x'.repeat(65537);
  const draft = f.prepare(); assert.equal(draft.prompt.length, 65537);
  assert.throws(() => createHistorySettingsPatch(draft, { ...f.scope, id: 'too-long', baseRevision: 4 }), /未截断/);
  assert.equal(f.target.data.prompt, 'new draft');
});
test('real Canvas settings wiring uses explicit detail and same approved patch with scope/draft/run guards, not replay', () => {
  const canvas = readFileSync(new URL('../src/components/Canvas.tsx', import.meta.url), 'utf8');
  const entry = canvas.slice(canvas.indexOf('onPrepareSettings={async'), canvas.indexOf('generationCount={durableHistoryCount'));
  assert.match(entry, /includeInput: true/); assert.match(entry, /runningIds/);
  assert.match(entry, /snapshot !== reviewSnapshot/);
  assert.match(entry, /node\.id === group\.nodeId/);
  assert.match(entry, /currentEdges: edgesRef\.current/);
  assert.match(entry, /if \(!pending\)/); assert.match(entry, /api\.applyCanvasPatch/);
  assert.match(entry, /commitAuthoritativeCanvasPatchDocument/);
  assert.doesNotMatch(entry, /requestCanvasNodeRun|runTrigger:|replayRun|runFrom/);
  const ui = readFileSync(new URL('../src/components/GenerationHistorySettings.tsx', import.meta.url), 'utf8');
  assert.match(ui, /referenceWarning && !acknowledged/);
  assert.match(ui, /generationHistory.confirmSettings/);
});
