import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GPT_IMAGE_25_MODELS,
  ZHENZHEN_BUDGET_GPT2_MODEL_OPTIONS,
  ZHENZHEN_IMAGE_G25_BACKGROUNDS,
  ZHENZHEN_IMAGE_G25_LOWPRICE_MAX_IMAGES,
  ZHENZHEN_IMAGE_G25_LOWPRICE_MODEL,
  ZHENZHEN_IMAGE_G25_LOWPRICE_SIZES,
  ZHENZHEN_IMAGE_G25_MODELS,
  ZHENZHEN_IMAGE_G25_MODERATION,
  ZHENZHEN_IMAGE_G25_OFFICIAL_MAX_IMAGES,
  ZHENZHEN_IMAGE_G25_OFFICIAL_SIZES,
  ZHENZHEN_IMAGE_G25_OUTPUT_FORMATS,
  ZHENZHEN_IMAGE_G25_QUALITIES,
  ZHENZHEN_IMAGE_G25_RESOLUTIONS,
  isZhenzhenImageG25Model,
  isZhenzhenImageG25OfficialModel,
} from '../src/providers/models.ts';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('Image G v2.5 budget models are isolated under GPT Image 2 without colliding with Workshop IDs', () => {
  assert.deepEqual(ZHENZHEN_IMAGE_G25_MODELS, [
    'zhenzhen-image-g-v2.5-lowprice',
    'zhenzhen-image-g-v2.5-flare',
    'zhenzhen-image-g-v2.5-sunburst',
  ]);
  assert.deepEqual(
    ZHENZHEN_BUDGET_GPT2_MODEL_OPTIONS.slice(-3).map((item) => item.value),
    [...ZHENZHEN_IMAGE_G25_MODELS],
  );
  assert.equal(GPT_IMAGE_25_MODELS.some((model) => model.startsWith('zhenzhen-')), false);
  assert.equal(isZhenzhenImageG25Model(ZHENZHEN_IMAGE_G25_LOWPRICE_MODEL), true);
  assert.equal(isZhenzhenImageG25OfficialModel('zhenzhen-image-g-v2.5-flare'), true);
  assert.equal(isZhenzhenImageG25OfficialModel(ZHENZHEN_IMAGE_G25_LOWPRICE_MODEL), false);
});

test('Image G v2.5 frontend catalog matches the documented per-family controls and limits', () => {
  assert.deepEqual(ZHENZHEN_IMAGE_G25_RESOLUTIONS, ['1k', '2k', '4k']);
  assert.equal(ZHENZHEN_IMAGE_G25_LOWPRICE_MAX_IMAGES, 15);
  assert.equal(ZHENZHEN_IMAGE_G25_OFFICIAL_MAX_IMAGES, 16);
  assert.ok(ZHENZHEN_IMAGE_G25_LOWPRICE_SIZES.includes('auto'));
  assert.equal(ZHENZHEN_IMAGE_G25_LOWPRICE_SIZES.includes('custom' as never), false);
  assert.ok(ZHENZHEN_IMAGE_G25_OFFICIAL_SIZES.includes('preserve_reference'));
  assert.ok(ZHENZHEN_IMAGE_G25_OFFICIAL_SIZES.includes('custom'));
  assert.deepEqual(ZHENZHEN_IMAGE_G25_QUALITIES, ['auto', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(ZHENZHEN_IMAGE_G25_OUTPUT_FORMATS, ['png', 'jpeg', 'webp']);
  assert.deepEqual(ZHENZHEN_IMAGE_G25_BACKGROUNDS, ['auto', 'transparent', 'opaque']);
  assert.deepEqual(ZHENZHEN_IMAGE_G25_MODERATION, ['low', 'auto']);
});

test('Image node submits Image G v2.5 through seedance.nz with model-specific fields', () => {
  const node = read('../src/components/nodes/ImageNode.tsx');
  const generation = read('../src/services/generation.ts');

  assert.match(node, /isZhenzhenImageG25Model\(apiModel\)/);
  assert.match(node, /isZhenzhenImageG25Lowprice[\s\S]*ZHENZHEN_IMAGE_G25_LOWPRICE_MAX_IMAGES/);
  assert.match(node, /isZhenzhenImageG25Official[\s\S]*ZHENZHEN_IMAGE_G25_OFFICIAL_MAX_IMAGES/);
  assert.match(node, /quality: isZhenzhenImageG25Official \? zhenzhenImageG25Quality/);
  assert.match(node, /output_compression: isZhenzhenImageG25Official/);
  assert.match(node, /custom_size: isZhenzhenImageG25Official/);
  assert.match(node, /nsfw_check: isZhenzhenImageG25Lowprice/);
  assert.match(node, /透明背景必须使用 PNG 或 WebP/);
  for (const model of ZHENZHEN_IMAGE_G25_MODELS) assert.match(generation, new RegExp(model.replaceAll('.', '\\.')));
  assert.match(generation, /output_format\?: 'png' \| 'jpeg' \| 'webp'/);
});

test('canvas schema persists all Image G v2.5 controls with bounded values', () => {
  const schema = JSON.parse(read('../backend/src/shared/canvasNodeSchema.json'));
  const image = schema.types.find((item: { type?: string }) => item.type === 'image');
  const fields = image?.generation?.allowedDataFields || {};
  const defaults = image?.generation?.defaults || {};

  assert.deepEqual(fields.zhenzhenImageG25Resolution.enum, ['1k', '2k', '4k']);
  assert.deepEqual(fields.zhenzhenImageG25OutputFormat.enum, ['png', 'jpeg', 'webp']);
  assert.deepEqual(fields.zhenzhenImageG25Background.enum, ['auto', 'transparent', 'opaque']);
  assert.deepEqual(fields.zhenzhenImageG25Count, { type: 'integer', minimum: 1, maximum: 4 });
  assert.deepEqual(fields.zhenzhenImageG25OutputCompression, { type: 'integer', minimum: 0, maximum: 100 });
  assert.equal(fields.zhenzhenImageG25NsfwCheck.type, 'boolean');
  assert.equal(defaults.zhenzhenImageG25Moderation, 'low');
  assert.equal(defaults.zhenzhenImageG25OutputCompression, 90);
});

test('generated runtime catalog keeps Image G v2.5 under GPT2 with exact provider limits', () => {
  const catalog = JSON.parse(read('../backend/src/shared/creativeModelCatalog.json'));
  const entries = new Map(
    catalog.image
      .filter((item: { model?: string }) => ZHENZHEN_IMAGE_G25_MODELS.includes(item.model as never))
      .map((item: { model: string }) => [item.model, item]),
  );

  assert.equal(entries.size, 3);
  for (const model of ZHENZHEN_IMAGE_G25_MODELS) {
    const entry = entries.get(model) as any;
    assert.equal(entry.provider, 'seedance-nz');
    assert.equal(entry.platformLabel, '贞贞的平价AI小屋');
    assert.equal(entry.family, 'gpt-image-2');
    assert.equal(entry.parameters.tabLabel, 'GPT2');
    assert.deepEqual(entry.parameters.capabilities, ['t2i', 'i2i', 'edit']);
  }
  assert.equal(entries.get(ZHENZHEN_IMAGE_G25_LOWPRICE_MODEL)?.parameters.maxReferenceImages, 15);
  assert.equal(entries.get(ZHENZHEN_IMAGE_G25_LOWPRICE_MODEL)?.parameters.parameterKind, 'image-g-v2.5-lowprice');
  for (const model of ['zhenzhen-image-g-v2.5-flare', 'zhenzhen-image-g-v2.5-sunburst']) {
    assert.equal(entries.get(model)?.parameters.maxReferenceImages, 16);
    assert.equal(entries.get(model)?.parameters.parameterKind, 'image-g-v2.5-official');
  }
});
