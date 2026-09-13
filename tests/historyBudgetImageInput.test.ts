import test from 'node:test';
import assert from 'node:assert/strict';
import { readHistoryBudgetImageInput } from '../src/utils/historyBudgetImageInput.ts';
import contract from '../backend/src/shared/generationHistoryInputContract.json';

function fixture(variant = 'flare') {
  const lowprice = variant === 'lowprice';
  return { prompt: 'old local', providerParams: { unused: true }, imagePromptAdjustments: [{ id: 'never-reapply' }],
    taskId: 'never-copy', apiKey: 'never-copy', referenceImages: ['not-effective'],
    historyResolvedInput: { schema: contract.imageSettingsContextSchema, origin: 'frontend-common-context',
      prompt: 'Compiled upstream @image2 with original adjustments', referenceImages: ['b', 'a', 'b'],
      basicSettings: { model: 'gpt-image-2', apiModel: `zhenzhen-image-g-v2.5-${variant}`, imageBuiltinSource: 'seedance-nz',
        providerSource: 'zhenzhen', providerId: '', providerModel: '', aspectRatio: '16:9', sizeLevel: '2K',
        zhenzhenImageG25Size: lowprice ? '16:9' : 'custom', zhenzhenImageG25Resolution: '4k', zhenzhenImageG25Count: lowprice ? 1 : 4,
        ...(lowprice ? { zhenzhenImageG25NsfwCheck: false } : { zhenzhenImageG25CustomWidth: 1536, zhenzhenImageG25CustomHeight: 1024,
          zhenzhenImageG25Quality: 'xhigh', zhenzhenImageG25OutputFormat: 'webp', zhenzhenImageG25OutputCompression: 0,
          zhenzhenImageG25Background: 'transparent', zhenzhenImageG25Moderation: 'low' }) } } };
}

test('all three Budget Image G variants preserve captured parameters, duplicate slots and compiled prompt without live fields', () => {
  for (const variant of ['lowprice', 'flare', 'sunburst']) {
    const data = fixture(variant), before = structuredClone(data), result = readHistoryBudgetImageInput(data);
    assert.equal(result.prompt, data.historyResolvedInput.prompt); assert.deepEqual(result.media.map(item => item.url), ['b', 'a', 'b']);
    assert.deepEqual(result.settings, data.historyResolvedInput.basicSettings);
    for (const key of ['providerParams', 'imagePromptAdjustments', 'taskId', 'apiKey', 'referenceImages']) assert.equal(Object.hasOwn(result.settings, key), false);
    result.settings.apiModel = 'changed'; result.media[0].url = 'changed'; assert.deepEqual(data, before);
  }
});

test('model-specific reference/output limits and lowprice-only prompt limit are exact', () => {
  for (const variant of ['lowprice', 'flare', 'sunburst']) {
    const data = fixture(variant), cap = variant === 'lowprice' ? 15 : 16;
    data.historyResolvedInput.referenceImages = Array.from({ length: cap }, (_, i) => `ref-${i}`);
    assert.equal(readHistoryBudgetImageInput(data).media.length, cap);
    data.historyResolvedInput.referenceImages.push('excess'); assert.throws(() => readHistoryBudgetImageInput(data), /参数不完整/);
    data.historyResolvedInput.referenceImages = []; assert.deepEqual(readHistoryBudgetImageInput(data).media, []);
    data.historyResolvedInput.prompt = 'x'.repeat(5001);
    if (variant === 'lowprice') assert.throws(() => readHistoryBudgetImageInput(data), /参数不完整/);
    else assert.equal(readHistoryBudgetImageInput(data).prompt.length, 5001, 'do not impose lowprice constraint on official variants');
  }
});

test('missing explicit settings, invalid size/count/format/background and unadapted identities never fall back', () => {
  assert.throws(() => readHistoryBudgetImageInput({}), /未记录完整图像/);
  for (const variant of ['lowprice', 'flare']) {
    const original = fixture(variant);
    for (const key of Object.keys(original.historyResolvedInput.basicSettings)) {
      const data = structuredClone(original); delete (data.historyResolvedInput.basicSettings as Record<string, unknown>)[key];
      assert.throws(() => readHistoryBudgetImageInput(data), key);
    }
  }
  for (const patch of [{ zhenzhenImageG25Size: 'unknown' }, { zhenzhenImageG25Resolution: '8k' }, { zhenzhenImageG25Count: 5 },
    { zhenzhenImageG25CustomWidth: 17 }, { zhenzhenImageG25CustomHeight: 9999 }, { zhenzhenImageG25OutputCompression: -1 },
    { zhenzhenImageG25OutputFormat: 'jpeg' }, { zhenzhenImageG25Quality: 'unknown' }]) {
    const data = fixture(); Object.assign(data.historyResolvedInput.basicSettings, patch); assert.throws(() => readHistoryBudgetImageInput(data), /参数不完整/);
  }
  for (const patch of [{ apiModel: 'gpt-image-2.5-flare' }, { model: 'midjourney' }, { imageBuiltinSource: 'zhenzhen' }, { providerId: 'stale' }]) {
    const data = fixture(); Object.assign(data.historyResolvedInput.basicSettings, patch); assert.throws(() => readHistoryBudgetImageInput(data), /此图像渠道/);
  }
  const low = fixture('lowprice'); low.historyResolvedInput.basicSettings.zhenzhenImageG25Count = 2;
  assert.throws(() => readHistoryBudgetImageInput(low), /参数不完整/);
});
