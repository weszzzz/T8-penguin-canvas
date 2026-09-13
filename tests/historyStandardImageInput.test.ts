import test from 'node:test';
import assert from 'node:assert/strict';
import { readHistoryStandardImageInput } from '../src/utils/historyStandardImageInput.ts';
import { GPT_IMAGE_25_MODELS } from '../src/providers/models.ts';
import contract from '../backend/src/shared/generationHistoryInputContract.json';

function fixture(apiModel = 'gpt-image-2.5-flare') {
  return {
    prompt: 'old local prompt', imagePromptAdjustments: [{ id: 'do-not-reapply' }],
    referenceImages: ['current-ref'], materialOrder: ['current-order'], status: 'success', taskId: 'old-task',
    providerParams: {}, apiKey: 'never-copy-credential',
    historyResolvedInput: { schema: contract.imageSettingsContextSchema, origin: 'frontend-common-context',
      prompt: 'Ordered upstream @image2\nImage adjustment requirements: already compiled',
      referenceImages: ['old-b', 'old-a', 'old-b'], basicSettings: {
        model: 'gpt-image-2', apiModel, aspectRatio: '1:1', sizeLevel: '2K',
        imageBuiltinSource: 'zhenzhen', providerSource: 'zhenzhen', providerId: '', providerModel: '',
        gptImageQuality: 'high', gptImageModeration: 'low', gptImage25Size: 'custom',
        gptImage25CustomWidth: 1536, gptImage25CustomHeight: 1024, gptImage25Count: 2, gptImage25Background: 'opaque',
      } },
  };
}

test('standard image preparation keeps compiled prompt and ordered duplicate slots without copying live/runtime data', () => {
  const data = fixture(), before = structuredClone(data);
  const input = readHistoryStandardImageInput(data);
  assert.equal(input.prompt, data.historyResolvedInput.prompt);
  assert.deepEqual(input.media.map(item => item.url), ['old-b', 'old-a', 'old-b']);
  assert.equal(input.settings.gptImage25Count, 2);
  for (const key of ['prompt', 'providerParams', 'apiKey', 'imagePromptAdjustments', 'referenceImages', 'materialOrder', 'status', 'taskId']) {
    assert.equal(Object.hasOwn(input.settings, key), false, key);
  }
  input.media[0].url = 'changed'; input.settings.gptImage25Count = 9;
  assert.deepEqual(data, before, 'preparation returns detached values and does not edit source');
});

test('standard GPT2 and all registered GPT2.5 variants use exact bounded reference counts', () => {
  for (const apiModel of ['gpt-image-2', 'gpt-image-2-all', 'gpt-image-2-2K', 'gpt-image-2-4K', ...GPT_IMAGE_25_MODELS]) {
    const data = fixture(apiModel), is25 = apiModel.includes('2.5');
    const cap = is25 ? 14 : 9;
    data.historyResolvedInput.referenceImages = Array.from({ length: cap }, (_, i) => `ref-${i}`);
    assert.equal(readHistoryStandardImageInput(data).media.length, cap);
    if (!is25) assert.equal(Object.hasOwn(readHistoryStandardImageInput(data).settings, 'gptImage25Count'), false);
    data.historyResolvedInput.referenceImages.push('overflow');
    assert.throws(() => readHistoryStandardImageInput(data), /参数不完整或已不兼容/);
    data.historyResolvedInput.referenceImages = [];
    assert.deepEqual(readHistoryStandardImageInput(data).media, []);
  }
});

test('legacy, incomplete and invalid captures never acquire current defaults', () => {
  const missing: Record<string, unknown> = fixture(); delete missing.historyResolvedInput;
  assert.throws(() => readHistoryStandardImageInput(missing), /未记录完整图像输入/);
  const legacy = fixture(); legacy.historyResolvedInput.schema = contract.imageInputContextSchema;
  assert.throws(() => readHistoryStandardImageInput(legacy), /未记录完整图像输入/);
  for (const key of ['gptImageQuality', 'gptImageModeration', 'gptImage25Size', 'gptImage25Count', 'gptImage25CustomWidth', 'gptImage25CustomHeight', 'gptImage25Background']) {
    const data = fixture(); delete (data.historyResolvedInput.basicSettings as Record<string, unknown>)[key];
    assert.throws(() => readHistoryStandardImageInput(data), /参数不完整或已不兼容/, key);
  }
  for (const patch of [{ gptImage25Count: 0 }, { gptImage25Count: 1.5 }, { gptImage25CustomWidth: 17 },
    { gptImage25CustomHeight: 9999 }, { gptImageQuality: 'unknown' }, { gptImageModeration: 'none' },
    { gptImage25Background: 'transparent' }, { aspectRatio: 'invalid' }, { sizeLevel: '' }]) {
    const data = fixture(); Object.assign(data.historyResolvedInput.basicSettings, patch);
    assert.throws(() => readHistoryStandardImageInput(data), /参数不完整或已不兼容/);
  }
  const long = fixture(); long.historyResolvedInput.prompt = 'x'.repeat(32001);
  assert.throws(() => readHistoryStandardImageInput(long), /参数不完整或已不兼容/);
});

test('unadapted providers and nonempty/malformed additional parameters fail closed', () => {
  for (const patch of [{ apiModel: 'gpt-image-2-fal' }, { apiModel: 'unknown' }, { model: 'midjourney' },
    { imageBuiltinSource: 'seedance-nz' }, { providerSource: 'external', providerId: 'p', providerModel: 'm' }, { providerId: 'stale-provider' }]) {
    const data = fixture(); Object.assign(data.historyResolvedInput.basicSettings, patch);
    assert.throws(() => readHistoryStandardImageInput(data), /此图像渠道尚未支持/);
  }
  for (const params of [{ n: 3 }, { seed: 0 }, { prompt: 'override' }, [], 'invalid', 0, false]) {
    const data = { ...fixture(), providerParams: params };
    assert.throws(() => readHistoryStandardImageInput(data), /附加参数尚未支持/);
  }
});
