import test from 'node:test';
import assert from 'node:assert/strict';
import { readHistoryStandardVideoInput } from '../src/utils/historyStandardVideoInput.ts';
import contract from '../backend/src/shared/generationHistoryInputContract.json';

function fixture(model = 'grok-video-3') {
  return { prompt: 'old local', providerParams: {}, taskId: 'old-task', apiKey: 'never-copy',
    localRefImages: ['current-reference'], videoUrl: 'old-output',
    historyResolvedInput: { schema: contract.videoInputContextSchema, origin: 'frontend-common-context',
      prompt: 'Compiled upstream @image2', localRefImages: Array.from({ length: 9 }, (_, i) => `image-${i}`),
      localRefVideos: ['unused-video'], localRefAudios: ['unused-audio'], basicSettings: {
        mainId: 'grok-video-3', model, videoBuiltinSource: 'zhenzhen', providerSource: 'zhenzhen', providerId: '', providerModel: '',
        ratio: '16:9', duration: 15, resolution: '720P', seed: 0, size: '720x1280',
      } },
  };
}

test('standard Grok preparation selects only effective ordered image URLs and returns detached allowlisted settings', () => {
  const data = fixture(), before = structuredClone(data), result = readHistoryStandardVideoInput(data);
  assert.equal(result.prompt, data.historyResolvedInput.prompt);
  assert.deepEqual(result.media.map(item => item.url), data.historyResolvedInput.localRefImages.slice(0, 7));
  assert.ok(result.media.every(item => item.kind === 'image'));
  assert.equal(result.settings.seed, 0);
  for (const key of ['size', 'prompt', 'apiKey', 'taskId', 'providerParams', 'videoUrl', 'localRefImages', 'historyResolvedInput']) {
    assert.equal(Object.hasOwn(result.settings, key), false, key);
  }
  result.settings.seed = 123; result.media[0].url = 'changed'; assert.deepEqual(data, before);
  data.historyResolvedInput.localRefImages = [];
  assert.deepEqual(readHistoryStandardVideoInput(data).media, [], 'ordinary Grok permits text-only');
});

test('all three Grok New models require captured size and first image, without interpreting inactive duration', () => {
  for (const model of ['grok-1.5-video-6s', 'grok-1.5-video-10s', 'grok-1.5-video-15s']) {
    const data = fixture(model); data.historyResolvedInput.basicSettings.duration = 0;
    const result = readHistoryStandardVideoInput(data);
    assert.equal(result.settings.size, '720x1280');
    assert.deepEqual(result.media.map(item => item.url), ['image-0']);
    delete (data.historyResolvedInput.basicSettings as Record<string, unknown>).size;
    assert.throws(() => readHistoryStandardVideoInput(data), /参数不完整/);
    data.historyResolvedInput.basicSettings.size = '1280x720'; data.historyResolvedInput.localRefImages = [];
    assert.throws(() => readHistoryStandardVideoInput(data), /参数不完整/);
  }
});

test('missing, malformed, duplicate and incompatible captures never infer defaults or reorder inputs', () => {
  assert.throws(() => readHistoryStandardVideoInput({}), /未记录完整视频/);
  for (const patch of [{ ratio: '' }, { duration: 0 }, { duration: 99 }, { resolution: '' }, { resolution: 'unknown' }]) {
    const data = fixture(); Object.assign(data.historyResolvedInput.basicSettings, patch);
    assert.throws(() => readHistoryStandardVideoInput(data), /参数不完整/);
  }
  for (const patch of [{ prompt: '' }, { localRefImages: ['same', 'same'] }, { localRefImages: [''] },
    { localRefVideos: ['v', 'v'] }, { localRefAudios: [null] }, { schema: 'future' }]) {
    const data = fixture(); Object.assign(data.historyResolvedInput, patch);
    assert.throws(() => readHistoryStandardVideoInput(data));
  }
});

test('unadapted models, channels and additional request parameters fail closed before any asset operation', () => {
  for (const patch of [{ model: 'unknown' }, { model: 'grok-video-fal' }, { model: 'grok-imagine-video-1.5' },
    { mainId: 'veo3.1' }, { videoBuiltinSource: 'seedance-nz' }, { providerId: 'stale' },
    { providerSource: 'external', providerId: 'p', providerModel: 'm' }]) {
    const data = fixture(); Object.assign(data.historyResolvedInput.basicSettings, patch);
    assert.throws(() => readHistoryStandardVideoInput(data), /此视频渠道/);
  }
  for (const providerParams of [{ duration: 6 }, { seed: 0 }, [], '', 0, false, new Date()]) {
    assert.throws(() => readHistoryStandardVideoInput({ ...fixture(), providerParams }), /附加参数/);
  }
});
