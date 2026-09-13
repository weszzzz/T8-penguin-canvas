import test from 'node:test';
import assert from 'node:assert/strict';
import { readHistoryFalImageInput } from '../src/utils/historyFalImageInput.ts';

function fixture(apiModel = 'gpt-image-2-fal') {
  const gpt = apiModel === 'gpt-image-2-fal';
  return { providerParams: {}, taskId: 'never-copy', imageUrl: 'old-output', imagePromptAdjustments: ['never-reapply'],
    historyResolvedInput: { schema: 't8-image-frontend-context-v2', origin: 'frontend-common-context',
      prompt: 'Compiled upstream @image2; @img1 remains literal.', referenceImages: ['blue', 'orange', 'blue'],
      basicSettings: { model: gpt ? 'gpt-image-2' : apiModel.slice(0, -4), apiModel, imageBuiltinSource: 'zhenzhen',
        providerSource: 'zhenzhen', providerId: '', providerModel: '', aspectRatio: '1:1', sizeLevel: '2K',
        falN: 4, falFormat: 'webp', falSync: false,
        ...(gpt ? { falMode: 'edit', falSize: 'custom', falCustomW: 1001, falCustomH: 769, falQuality: 'high' }
          : { nbAspect: '16:9', nbResolution: '4K', nbSafety: '1', nbSeed: 0, nbSysPrompt: '', nbWebSearch: false, nbImgMode: 'base64' }),
      } as Record<string, any> } };
}

test('FAL preparer preserves explicit settings, compiled prompt and effective ordered slots for all three models', () => {
  for (const name of ['gpt-image-2-fal', 'nano-banana-pro-fal', 'nano-banana-2-fal']) {
    const data = fixture(name), original = structuredClone(data), result = readHistoryFalImageInput(data);
    assert.deepEqual(result.settings, data.historyResolvedInput.basicSettings);
    assert.equal(result.prompt, data.historyResolvedInput.prompt);
    assert.deepEqual(result.media.map(item => item.url), ['blue', 'orange', 'blue']);
    result.settings.falN = 2; result.media[0].url = 'detached'; assert.deepEqual(data, original);
  }
  const data = fixture(); data.historyResolvedInput.basicSettings.falMode = 'gen';
  const result = readHistoryFalImageInput(data);
  assert.deepEqual(result.media, []); assert.equal(result.prompt, data.historyResolvedInput.prompt);
  assert.equal(result.settings.falCustomW, 1001, 'do not silently replace configured width with backend-rounded pixels');
});

test('FAL preparer rejects every missing explicit setting, wrong identity and uncaptured overrides without defaults', () => {
  for (const name of ['gpt-image-2-fal', 'nano-banana-pro-fal', 'nano-banana-2-fal']) {
    for (const key of Object.keys(fixture(name).historyResolvedInput.basicSettings)) {
      const data = fixture(name); delete data.historyResolvedInput.basicSettings[key]; assert.throws(() => readHistoryFalImageInput(data), key);
    }
  }
  for (const values of [{ model: 'nano-banana-pro' }, { apiModel: 'unknown-fal' }, { imageBuiltinSource: 'seedance-nz' },
    { providerSource: 'external', providerId: 'external', providerModel: 'external' }]) {
    const data = fixture(); Object.assign(data.historyResolvedInput.basicSettings, values); assert.throws(() => readHistoryFalImageInput(data));
  }
  for (const providerParams of [{ n: 2 }, [], 'invalid']) assert.throws(() => readHistoryFalImageInput({ ...fixture(), providerParams }));
  assert.throws(() => readHistoryFalImageInput({}));
});

test('FAL validation respects registry caps, booleans, seed zero and configured numeric/enum boundaries', () => {
  for (const [apiModel, cap] of [['gpt-image-2-fal', 5], ['nano-banana-pro-fal', 8], ['nano-banana-2-fal', 8]] as const) {
    const data = fixture(apiModel); data.historyResolvedInput.referenceImages = Array(cap).fill('same');
    assert.equal(readHistoryFalImageInput(data).media.length, cap);
    data.historyResolvedInput.referenceImages.push('one-too-many'); assert.throws(() => readHistoryFalImageInput(data));
  }
  for (const [model, values] of [
    ['gpt-image-2-fal', { falN: 0 }], ['gpt-image-2-fal', { falN: 5 }], ['gpt-image-2-fal', { falSync: 'true' }],
    ['gpt-image-2-fal', { falMode: 'auto' }], ['gpt-image-2-fal', { falSize: 'unregistered' }],
    ['gpt-image-2-fal', { falCustomW: 0 }], ['gpt-image-2-fal', { falCustomH: 769.5 }],
    ['nano-banana-pro-fal', { nbSeed: -1 }], ['nano-banana-2-fal', { nbSafety: '0' }],
    ['nano-banana-2-fal', { nbImgMode: 'unknown' }], ['nano-banana-2-fal', { nbWebSearch: 'false' }],
  ] as const) {
    const data = fixture(model); Object.assign(data.historyResolvedInput.basicSettings, values); assert.throws(() => readHistoryFalImageInput(data));
  }
  const zero = readHistoryFalImageInput(fixture('nano-banana-pro-fal'));
  assert.equal(zero.settings.nbSeed, 0); assert.equal(zero.settings.nbWebSearch, false); assert.equal(zero.settings.nbSysPrompt, '');
});
