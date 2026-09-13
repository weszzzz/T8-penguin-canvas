import test from 'node:test';
import assert from 'node:assert/strict';
import { historyVideoBasicSettings, VIDEO_HISTORY_EXTRA_FIELDS } from '../src/utils/historyVideoBasicSettings.ts';
import { prepareHistorySettingsDraft, createHistorySettingsPatch, supportsHistoryInputDraft } from '../src/utils/generationHistorySettings.ts';
import { generationHistoryZh, generationHistoryEn } from '../src/i18n/generationHistoryCatalog.ts';
import contract from '../backend/src/shared/generationHistoryInputContract.json';

function fixture() {
  const scope = { projectId: 'p', canvasId: 'c' };
  const target = { id: 'video', entityUid: 'entity', type: 'video', position: { x: 0, y: 0 }, data: {
    prompt: 'current local', ratio: '9:16', duration: 12, seed: 9, model: 'current',
    videoUrl: '/files/output/current.mp4', taskId: 'current-task', providerParams: { current: true },
    localRefImages: ['/files/input/current.png'], enhancePrompt: true, generateAudio: false, size: 'current-size',
  } };
  const settings: Record<string, unknown> = { mainId: 'grok', model: 'grok-video-3', videoBuiltinSource: 'zhenzhen',
    ratio: '16:9', duration: 6, resolution: '720p', seed: 0, providerSource: 'zhenzhen', providerId: '', providerModel: '' };
  const input: any = { schema: contract.videoInputContextSchema, origin: 'frontend-common-context', prompt: 'compiled upstream prompt',
    localRefImages: ['/files/input/original.png'], localRefVideos: [], localRefAudios: [], basicSettings: settings };
  const archive: any = { status: 'available', binding: { ...scope, nodeId: target.id, nodeEntityUid: target.entityUid },
    snapshot: { node: { id: target.id, type: 'video', data: { prompt: 'raw local prompt', ratio: 'raw-stale-ratio',
      historyResolvedInput: input, taskId: 'old-task', providerParams: { old: true } } }, upstreamNodes: [], incomingEdges: [] } };
  const group: any = { nodeId: target.id, nodeEntityUid: target.entityUid, snapshotAvailable: true };
  return { scope, target, settings, input, archive, prepare: () => prepareHistorySettingsDraft(archive, group, target, scope) };
}
test('video parameters use captured values but keep local prompt semantics and unrecorded branch fields', () => {
  const f = fixture(), before = structuredClone({ target: f.target, archive: f.archive });
  const draft = f.prepare();
  for (const [key, value] of Object.entries(f.settings)) assert.deepEqual(draft.dataPatch[key], value, key);
  assert.equal(draft.dataPatch.prompt, 'raw local prompt', 'compiled upstream prompt must not overwrite local mention input');
  assert.equal(draft.referenceWarning, true);
  for (const key of ['size', 'generateAudio', 'enhancePrompt', 'providerParams', 'taskId', 'videoUrl', 'localRefImages', 'historyResolvedInput']) {
    assert.equal(Object.hasOwn(draft.dataPatch, key), false, key); assert.equal(draft.dataUnsetKeys.includes(key), false, key);
  }
  assert.deepEqual({ target: f.target, archive: f.archive }, before);
  assert.equal(supportsHistoryInputDraft('video'), true, 'archive-specific adapter still decides full input support');
});
test('captured Grok New size is primary, strict and explicit-only without touching current references or results', () => {
  const f = fixture();
  Object.assign(f.settings, { mainId: 'grok-video-3', model: 'grok-1.5-video-6s', size: '720x1280' });
  const before = structuredClone({ target: f.target, archive: f.archive });
  const draft = f.prepare();
  assert.equal(draft.dataPatch.size, '720x1280');
  assert.equal(draft.fields.find(field => field.key === 'size')?.advanced, undefined);
  assert.ok(generationHistoryZh.field_size); assert.ok(generationHistoryEn.field_size);
  assert.deepEqual({ target: f.target, archive: f.archive }, before);
  for (const key of ['videoUrl', 'taskId', 'providerParams', 'localRefImages']) {
    assert.equal(Object.hasOwn(draft.dataPatch, key), false); assert.equal(draft.dataUnsetKeys.includes(key), false);
  }
  for (const invalid of ['auto', '9:16', '1280X720', '', 720, false, null, {}, ['720x1280']]) {
    f.settings.size = invalid; assert.throws(f.prepare, /历史实际输入/);
  }
  delete f.settings.size;
  f.archive.snapshot.node.data.size = '1280x720';
  const missing = f.prepare();
  assert.equal(Object.hasOwn(missing.dataPatch, 'size'), false, 'raw stale size cannot fill a missing captured value');
  assert.equal(missing.dataUnsetKeys.includes('size'), false);
});

test('explicit video boolean options retain false and are review-only advanced metadata', () => {
  const f = fixture(); Object.assign(f.settings, { soraPrivate: false, enhancePrompt: false, enableUpsample: true });
  const draft = f.prepare();
  for (const key of ['soraPrivate', 'enhancePrompt', 'enableUpsample']) {
    assert.equal(draft.dataPatch[key], f.settings[key]); assert.equal(draft.fields.find(field => field.key === key)?.advanced, true);
    assert.ok((generationHistoryZh as Record<string, string>)[`field_${key}`]);
    assert.ok((generationHistoryEn as Record<string, string>)[`field_${key}`]);
  }
  const patch = createHistorySettingsPatch(draft, { ...f.scope, id: 'patch', baseRevision: 1 });
  assert.equal(JSON.stringify(patch).includes('advanced'), false);
});

test('FAL video options are explicit-only, typed, translated and never copy URL or character references', () => {
  const f = fixture(); Object.assign(f.settings, {
    vfRatio: '9:16', vfDuration: '8s', vfResolution: '1080p', vfAudio: false, vfSafety: 0,
    gkfMode: 'reference_to_video', gkfRatio: 'auto', gkfDuration: 10, gkfResolution: '720p',
    soraMode: 'auto', soraRatio: '16:9', soraDuration: 8, soraResolution: '1080p', soraDeleteVideo: false, soraBlockIp: true,
  });
  const draft = f.prepare();
  for (const key of Object.keys(f.settings).filter(key => Object.hasOwn(VIDEO_HISTORY_EXTRA_FIELDS, key))) {
    assert.equal(draft.dataPatch[key], f.settings[key]); assert.equal(draft.fields.find(field => field.key === key)?.advanced, true);
  }
  for (const key of Object.keys(VIDEO_HISTORY_EXTRA_FIELDS)) {
    assert.ok((generationHistoryZh as Record<string, string>)[`field_${key}`]);
    assert.ok((generationHistoryEn as Record<string, string>)[`field_${key}`]);
  }
  for (const [key, invalid] of [['vfSafety', Infinity], ['gkfDuration', '10'], ['soraDeleteVideo', 'false'],
    ['vfDuration', 8], ['soraCharacterIds', 'unverified-character'], ['gkfReferenceUrls', '/files/input/reference.png']] as const) {
    const saved = f.settings[key]; f.settings[key] = invalid; assert.throws(f.prepare, /历史实际输入/);
    if (saved === undefined) delete f.settings[key]; else f.settings[key] = saved;
  }
  for (const referenceKey of ['soraCharacterIds', 'gkfReferenceUrls', 'wan30FileUrl', 'wan30LinkUrl']) for (const side of ['current', 'archived']) {
    const fixtureWithoutImages = fixture(); fixtureWithoutImages.target.data.localRefImages = [];
    fixtureWithoutImages.input.localRefImages = [];
    assert.equal(fixtureWithoutImages.prepare().referenceWarning, false);
    const data = side === 'current' ? fixtureWithoutImages.target.data : fixtureWithoutImages.archive.snapshot.node.data;
    (data as Record<string, unknown>)[referenceKey] = 'existing-unverified-reference';
    const result = fixtureWithoutImages.prepare(); assert.equal(result.referenceWarning, true);
    assert.equal(Object.hasOwn(result.dataPatch, referenceKey), false); assert.equal(result.dataUnsetKeys.includes(referenceKey), false);
  }
});
test('malformed, missing, nonfinite, unknown or future captured video values fail without falling back to raw fields', () => {
  for (const override of [{ schema: 'future' }, { origin: 'guessed' }, { localRefImages: [null] }, { basicSettings: {} },
    { basicSettings: { ...fixture().settings, duration: '6' } }, { basicSettings: { ...fixture().settings, seed: NaN } },
    { basicSettings: { ...fixture().settings, soraPrivate: 'false' } }, { basicSettings: { ...fixture().settings, apiKey: 'unsafe' } },
    { basicSettings: { ...fixture().settings, providerSource: 'external', providerId: '', providerModel: '' } },
    { basicSettings: { ...fixture().settings, videoBuiltinSource: 'unknown' } }]) {
    const f = fixture(); Object.assign(f.input, override); assert.throws(f.prepare, /历史实际输入/);
  }
  const f = fixture(); delete f.settings.resolution; assert.throws(f.prepare, /历史实际输入/);
});
test('legacy raw video settings remain supported without inventing new captured options', () => {
  const f = fixture(); delete f.archive.snapshot.node.data.historyResolvedInput;
  const draft = f.prepare(); assert.equal(draft.dataPatch.ratio, 'raw-stale-ratio');
  assert.equal(draft.dataPatch.prompt, 'raw local prompt'); assert.equal('soraPrivate' in draft.dataPatch, false);
  assert.equal(historyVideoBasicSettings({}), undefined);
});

test('budget and multimodal options preserve explicit scalar values and reject truncation of long archived descriptions', () => {
  const f = fixture();
  const extras = { apimartOmniLowpriceMode: 'reference_video', apimartOmniLowpriceNsfwCheck: false,
    generateAudio: true, returnLastFrame: true, klingNegativePrompt: ' no blur ', viduSeed: 0,
    viduScriptName: 'Original script', viduStyle: 'realistic', viduAssetType: 'scene',
    viduAssetNamePrefix: 'Scene', viduAssetDescription: 'Original description' };
  Object.assign(f.settings, extras);
  const draft = f.prepare();
  for (const [key, value] of Object.entries(extras)) {
    assert.deepEqual(draft.dataPatch[key], value); assert.equal(draft.fields.find(field => field.key === key)?.advanced, true);
  }
  for (const [key, invalid] of [['returnLastFrame', 'true'], ['viduSeed', Infinity], ['apimartOmniLowpriceMode', 1],
    ['viduAssetDescription', {}], ['taskId', 'old-task']] as const) {
    const original = f.settings[key]; f.settings[key] = invalid; assert.throws(f.prepare, /历史实际输入/);
    if (original === undefined) delete f.settings[key]; else f.settings[key] = original;
  }
  f.settings.viduAssetDescription = 'X'.repeat(65537);
  assert.throws(() => createHistorySettingsPatch(f.prepare(), { ...f.scope, id: 'patch', baseRevision: 1 }), /未截断/);
  assert.equal((f.settings.viduAssetDescription as string).length, 65537);
});

test('task-bound FLUX enhancement cannot combine restored history with current cache; ordinary generation still works', () => {
  for (const model of ['flux-3-video-draft-enhance', 'flux-3-video-global-draft-enhance']) for (const legacy of [false, true]) {
    const f = fixture();
    Object.assign(f.settings, { mainId: 'flux-3-video', model, videoBuiltinSource: 'seedance-nz' });
    Object.assign(f.target.data, { flux3DraftCache: 'current-cache' });
    Object.assign(f.archive.snapshot.node.data, { flux3DraftCache: 'original-cache' });
    if (legacy) {
      delete f.archive.snapshot.node.data.historyResolvedInput;
      f.archive.snapshot.node.data.model = model;
    }
    const before = structuredClone({ target: f.target, archive: f.archive });
    assert.throws(f.prepare, /FLUX.*原任务缓存/);
    assert.deepEqual({ target: f.target, archive: f.archive }, before);
  }
  const f = fixture();
  Object.assign(f.target.data, { model: 'flux-3-video-draft-enhance', mainId: 'flux-3-video', videoBuiltinSource: 'seedance-nz', flux3DraftCache: 'current-cache' });
  // Moving back to ordinary generation does not consume a cache, even if one
  // remains on the old node; it must not be blocked just for its presence.
  const draft = f.prepare(); assert.equal(draft.dataPatch.model, 'grok-video-3');
  assert.equal(Object.hasOwn(draft.dataPatch, 'flux3DraftCache'), false);
  assert.equal(draft.dataUnsetKeys.includes('flux3DraftCache'), false);
});

test('FLUX and Wan flags restore explicitly, with strict API-default/zero distinction and no file/cache copying', () => {
  const f = fixture(); Object.assign(f.settings, { flux3Draft: false, flux3AudioMode: 'api_default', flux3SafetyTolerance: 0,
    wanNegativePrompt: 'No blur', wanPromptExtend: false, wanSeed: -1, wan30Seed: 0, wan30EnableThinking: false });
  let draft = f.prepare();
  for (const key of ['flux3Draft', 'flux3AudioMode', 'flux3SafetyTolerance', 'wanNegativePrompt', 'wanPromptExtend', 'wanSeed', 'wan30Seed', 'wan30EnableThinking']) {
    assert.deepEqual(draft.dataPatch[key], f.settings[key]); assert.equal(draft.fields.find(field => field.key === key)?.advanced, true);
  }
  f.settings.flux3SafetyTolerance = 'api_default'; draft = f.prepare();
  assert.equal(draft.dataPatch.flux3SafetyTolerance, 'api_default');
  for (const invalid of ['0', '4', 'default', -1, 5, 0.5, Infinity, null, false]) {
    f.settings.flux3SafetyTolerance = invalid; assert.throws(f.prepare, /历史实际输入/);
  }
  f.settings.flux3SafetyTolerance = 4;
  for (const key of ['flux3DraftCache', 'flux3DraftCacheResult', 'wan30FileUrl', 'wan30LinkUrl', 'wanAudioUrl']) {
    f.settings[key] = 'not-a-restorable-scalar'; assert.throws(f.prepare, /历史实际输入/); delete f.settings[key];
  }
});

test('H3 role controls and audio options are explicit, but video start offsets never transfer to current references', () => {
  const f = fixture();
  const extras = { minimaxH3FirstFrameEnabled: false, minimaxH3LastFrameEnabled: true, minimaxH3DriveAudioEnabled: true,
    minimaxH3AudioMode: 'remix_source', minimaxH3DenoiseStrength: 0, minimaxH3AddDriveAsReference: 'false' };
  Object.assign(f.settings, extras);
  f.input.referenceOptions = { minimaxH3VideoStartSeconds: [1, 2, 3] };
  Object.assign(f.target.data, { minimaxH3VideoStartSeconds: [4, 5, 6] });
  const draft = f.prepare();
  for (const [key, value] of Object.entries(extras)) {
    assert.deepEqual(draft.dataPatch[key], value); assert.equal(draft.fields.find(field => field.key === key)?.advanced, true);
  }
  assert.equal(draft.referenceWarning, true);
  for (const key of ['referenceOptions', 'minimaxH3VideoStartSeconds']) {
    assert.equal(Object.hasOwn(draft.dataPatch, key), false); assert.equal(draft.dataUnsetKeys.includes(key), false);
  }
  for (const [key, invalid] of [['minimaxH3DenoiseStrength', 1.1], ['minimaxH3DenoiseStrength', -0.1],
    ['minimaxH3AudioMode', 'unknown'], ['minimaxH3AddDriveAsReference', false], ['minimaxH3DriveAudioEnabled', 'true'],
    ['minimaxH3VideoStartSeconds', [1, 2, 3]]] as const) {
    const original = f.settings[key]; f.settings[key] = invalid; assert.throws(f.prepare, /历史实际输入/);
    if (original === undefined) delete f.settings[key]; else f.settings[key] = original;
  }
  // The offset field itself also warns even if no reference array is currently populated.
  f.target.data.localRefImages = []; f.input.localRefImages = [];
  assert.equal(f.prepare().referenceWarning, true);
});
