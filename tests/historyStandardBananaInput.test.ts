import test from 'node:test';
import assert from 'node:assert/strict';
import { readHistoryStandardBananaInput } from '../src/utils/historyStandardBananaInput.ts';
import contract from '../backend/src/shared/generationHistoryInputContract.json';

const models = ['gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image',
  'nano-banana-pro', 'nano-banana-pro-2k', 'nano-banana-pro-4k', 'gemini-3-pro-image'];
function fixture(apiModel = 'nano-banana-pro') {
  return {
    prompt: 'current prompt', referenceImages: ['current image'], taskId: 'old-task',
    apiKey: 'synthetic-not-a-credential', imagePromptAdjustments: ['already compiled'], providerParams: {},
    historyResolvedInput: { schema: contract.imageSettingsContextSchema, origin: 'frontend-common-context',
      prompt: 'Compiled @image2, with adjustments already applied', referenceImages: ['blue', 'orange', 'blue'],
      basicSettings: { model: apiModel.startsWith('gemini-3.1') ? 'nano-banana-2' : 'nano-banana-pro',
        apiModel, aspectRatio: 'Auto', sizeLevel: '4K', imageBuiltinSource: 'zhenzhen',
        providerSource: 'zhenzhen', providerId: '', providerModel: '' },
    },
  };
}

test('ordinary Banana preparation keeps six exact models, compiled prompt and duplicate reference slots', () => {
  for (const apiModel of models) {
    const data = fixture(apiModel), original = structuredClone(data);
    // Inactive settings from an older branch must not become draft parameters.
    Object.assign(data.historyResolvedInput.basicSettings, { falN: 4, gptImageQuality: 'high' });
    const input = readHistoryStandardBananaInput(data);
    assert.deepEqual(input.settings, original.historyResolvedInput.basicSettings);
    assert.equal(input.prompt, original.historyResolvedInput.prompt);
    assert.deepEqual(input.media.map(item => item.url), ['blue', 'orange', 'blue']);
    assert.equal(input.settings.sizeLevel, '4K', 'preserve configured size; Lite backend remains fixed 1K');
    const before = structuredClone(data);
    input.settings.sizeLevel = '1K'; input.media[0].url = 'changed';
    assert.deepEqual(data, before, 'read-only detached output');
    data.historyResolvedInput.referenceImages = Array(5).fill('same');
    assert.equal(readHistoryStandardBananaInput(data).media.length, 5);
    data.historyResolvedInput.referenceImages.push('overflow');
    assert.throws(() => readHistoryStandardBananaInput(data), /参数不完整或已不兼容/);
    data.historyResolvedInput.referenceImages = [];
    assert.deepEqual(readHistoryStandardBananaInput(data).media, []);
  }
});

test('ordinary Banana rejects missing, legacy and invalid capture without current defaults', () => {
  assert.throws(() => readHistoryStandardBananaInput({}), /未记录完整图像输入/);
  const legacy = fixture(); legacy.historyResolvedInput.schema = contract.imageInputContextSchema;
  assert.throws(() => readHistoryStandardBananaInput(legacy), /未记录完整图像输入/);
  for (const key of Object.keys(fixture().historyResolvedInput.basicSettings)) {
    const data = fixture(); delete (data.historyResolvedInput.basicSettings as Record<string, unknown>)[key];
    assert.throws(() => readHistoryStandardBananaInput(data), /未套用当前默认值/, key);
  }
  for (const patch of [{ aspectRatio: '1:8' }, { aspectRatio: 'unknown' }, { sizeLevel: '512' }, { sizeLevel: '' }]) {
    const data = fixture(); Object.assign(data.historyResolvedInput.basicSettings, patch);
    assert.throws(() => readHistoryStandardBananaInput(data), /参数不完整或已不兼容/);
  }
  const flash = fixture('gemini-3.1-flash-image'); flash.historyResolvedInput.basicSettings.aspectRatio = '1:8';
  assert.equal(readHistoryStandardBananaInput(flash).settings.aspectRatio, '1:8');
  for (const patch of [{ prompt: '  ' }, { referenceImages: ['good', ' '] }, { referenceImages: [null] }]) {
    const data = fixture(); Object.assign(data.historyResolvedInput, patch);
    assert.throws(() => readHistoryStandardBananaInput(data), /未套用当前默认值/);
  }
});

test('ordinary Banana refuses crossed model families, other channels and uncaptured overrides', () => {
  for (const patch of [{ model: 'nano-banana-2' }, { apiModel: 'gemini-3.1-flash-image' },
    { apiModel: 'nano-banana-pro-fal' }, { apiModel: 'banana' }, { model: 'gpt-image-2' },
    { imageBuiltinSource: 'seedance-nz' }, { providerSource: 'external', providerId: 'p', providerModel: 'm' },
    { providerId: 'stale' }, { providerModel: 'stale' }]) {
    const data = fixture(); Object.assign(data.historyResolvedInput.basicSettings, patch);
    assert.throws(() => readHistoryStandardBananaInput(data), /此图像渠道尚未支持/);
  }
  for (const providerParams of [{ group: 'unknown' }, { n: 2 }, [], 'bad', false, 0, new Date()]) {
    assert.throws(() => readHistoryStandardBananaInput({ ...fixture(), providerParams }), /附加参数尚未支持/);
  }
});
