import test from 'node:test';
import assert from 'node:assert/strict';
import { readHistoryFalVideoInput } from '../src/utils/historyFalVideoInput.ts';

function fixture(model = 'grok-video-fal') {
  const extras = model === 'veo3.1-fal' ? { vfRatio: '9:16', vfDuration: '8s', vfResolution: '4k', vfAudio: false, vfSafety: 0 }
    : model === 'sora-2' ? { soraMode: 'auto', soraRatio: 'auto', soraDuration: 8, soraResolution: 'auto', soraDeleteVideo: false, soraBlockIp: true }
    : { gkfMode: model === 'grok-imagine-video-1.5' ? 'image_to_video' : 'reference_to_video', gkfDuration: 10, gkfResolution: '720p',
      ...(model !== 'grok-imagine-video-1.5' ? { gkfRatio: 'auto' } : {}) };
  return { providerParams: { ignoredByBackend: true }, taskId: 'old-task', gkfReferenceUrls: '', soraCharacterIds: '',
    historyResolvedInput: { schema: 't8-video-frontend-context-v1', origin: 'frontend-common-context', prompt: 'Compiled @image1',
      localRefImages: Array.from({ length: 9 }, (_, i) => `/files/input/${i}.png`), localRefVideos: [], localRefAudios: [],
      basicSettings: { mainId: model === 'veo3.1-fal' ? 'veo3.1' : model === 'sora-2' ? 'sora-2' : 'grok-video-3', model,
        videoBuiltinSource: 'zhenzhen', providerSource: 'zhenzhen', providerId: '', providerModel: '', ratio: '16:9', duration: 15, resolution: '720P', seed: 0,
        ...extras } as Record<string, any> } };
}

test('FAL read-only preparation preserves exact options and selects each branch effective reference slots', () => {
  for (const [model, count] of [['veo3.1-fal', 3], ['grok-video-fal', 7], ['grok-imagine-video-1.5', 1], ['sora-2', 1]] as const) {
    const data = fixture(model), before = structuredClone(data), prepared = readHistoryFalVideoInput(data);
    assert.equal(prepared.media.length, count); assert.equal(prepared.prompt, data.historyResolvedInput.prompt);
    assert.deepEqual(prepared.settings, data.historyResolvedInput.basicSettings);
    assert.deepEqual(prepared.media.map(item => item.url), data.historyResolvedInput.localRefImages.slice(0, count));
    assert.equal(Object.hasOwn(prepared.settings, 'providerParams'), false);
    if (model === 'veo3.1-fal') { assert.equal(prepared.settings.vfSafety, 0); assert.equal(prepared.requestedSafetyTolerance, 4); }
    prepared.media[0].url = 'changed'; prepared.settings.seed = 9; assert.deepEqual(data, before);
  }
});

test('FAL text fallback and image-required modes follow captured branch semantics, not stale unused references', () => {
  const sora = fixture('sora-2'); sora.historyResolvedInput.basicSettings.soraMode = 'text_to_video';
  assert.deepEqual(readHistoryFalVideoInput(sora).media, []);
  for (const model of ['grok-video-fal', 'grok-imagine-video-1.5', 'sora-2']) {
    const data = fixture(model); data.historyResolvedInput.localRefImages = [];
    if (model === 'sora-2') data.historyResolvedInput.basicSettings.soraMode = 'image_to_video';
    assert.throws(() => readHistoryFalVideoInput(data), /参数不完整/);
  }
  const grok = fixture(); grok.historyResolvedInput.basicSettings.gkfMode = 'image_to_video';
  grok.historyResolvedInput.localRefImages = []; grok.gkfReferenceUrls = 'unused-in-image-mode';
  assert.deepEqual(readHistoryFalVideoInput(grok).media, []);
});

test('FAL preparation rejects unverified active external references and incomplete or mismatched captures', () => {
  const grok = fixture(); grok.gkfReferenceUrls = 'https://example.invalid/reference.png';
  assert.throws(() => readHistoryFalVideoInput(grok), /外部引用/);
  const sora = fixture('sora-2'); sora.soraCharacterIds = 'old-character';
  assert.throws(() => readHistoryFalVideoInput(sora), /外部引用/);
  for (const changes of [{ model: 'unknown' }, { mainId: 'veo3.1' }, { gkfDuration: 0 }, { gkfDuration: 31 },
    { gkfMode: 'unknown' }, { gkfRatio: '' }, { providerId: 'stale' }, { videoBuiltinSource: 'seedance-nz' }]) {
    const data = fixture(); Object.assign(data.historyResolvedInput.basicSettings, changes); assert.throws(() => readHistoryFalVideoInput(data));
  }
  const missing = fixture(); delete missing.historyResolvedInput.basicSettings.gkfDuration;
  assert.throws(() => readHistoryFalVideoInput(missing), /参数不完整/);
  const duplicate = fixture(); duplicate.historyResolvedInput.localRefImages = ['same', 'same'];
  assert.throws(() => readHistoryFalVideoInput(duplicate), /参数不完整/);
  assert.throws(() => readHistoryFalVideoInput({}), /未记录完整/);
});
