'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createContext, createSnapshot } = require('../scripts/history-image-input-seed.cjs');
const { completeSnapshot, archiveInput } = require('../backend/src/services/generationHistoryInputs');

test('Budget remaining variants archive only their explicit option family with false and ordered duplicate references', () => {
  const assets = [{ sourceUrl: '/files/input/owned-draft-0.png' }, { sourceUrl: '/files/input/owned-draft-1.png' }];
  const node = { id: 'budget-source', entityUid: 'a1000000-0000-4000-8000-000000000001', type: 'image', position: { x: 0, y: 0 }, data: {} };
  for (const variant of ['lowprice', 'flare', 'sunburst']) {
    const apiModel = `zhenzhen-image-g-v2.5-${variant}`;
    const context = createContext(assets, 'image', 'budget', apiModel);
    const snapshot = createSnapshot(node, context, assets[0].sourceUrl);
    assert.equal(completeSnapshot(snapshot, node.id), true);
    const archived = archiveInput({ projectId: 'p', canvasId: 'c', entityUid: 'run' },
      { nodeId: node.id, entityUid: 'node-run', nodeEntityUid: node.entityUid, historyInputSnapshot: snapshot }, { entityUid: 'attempt' });
    assert.equal(archived.status, 'available'); assert.deepEqual(archived.snapshot.node.data.historyResolvedInput, context);
    const settings = context.basicSettings;
    assert.equal(settings.apiModel, apiModel);
    assert.deepEqual(context.referenceImages, [assets[1].sourceUrl, assets[0].sourceUrl, assets[1].sourceUrl]);
    if (variant === 'lowprice') {
      assert.equal(settings.zhenzhenImageG25NsfwCheck, false); assert.equal(settings.zhenzhenImageG25Count, 1);
      assert.equal(settings.zhenzhenImageG25Size, '16:9'); assert.equal(settings.zhenzhenImageG25Resolution, '4k');
      for (const key of ['zhenzhenImageG25Quality', 'zhenzhenImageG25CustomWidth', 'zhenzhenImageG25OutputFormat']) assert.equal(Object.hasOwn(settings, key), false);
    } else {
      assert.equal(settings.zhenzhenImageG25OutputCompression, 0); assert.equal(settings.zhenzhenImageG25Size, 'custom');
      assert.equal(Object.hasOwn(settings, 'zhenzhenImageG25NsfwCheck'), false);
    }
  }
  assert.throws(() => createContext(assets, 'image', 'budget', 'unknown'), /supported Budget/);
});

test('FAL video persistence contexts select each exact model family and only effective reference slots', () => {
  const assets = [{ sourceUrl: '/files/input/orange.png' }, { sourceUrl: '/files/input/blue.png' }];
  for (const model of ['veo3.1-fal', 'grok-video-fal', 'grok-imagine-video-1.5', 'sora-2']) {
    const context = createContext(assets, 'video', 'fal', model), settings = context.basicSettings;
    assert.equal(settings.model, model); assert.equal(settings.videoBuiltinSource, 'zhenzhen');
    assert.deepEqual(context.localRefImages, [assets[1].sourceUrl, assets[0].sourceUrl]);
    assert.deepEqual([...context.prompt.matchAll(/@image(\d+)\b/g)]
      .filter(match => match[0] === `@image${Number(match[1])}`).map(match => Number(match[1])), [1, 2]);
    if (model === 'veo3.1-fal') { assert.equal(settings.vfSafety, 0); assert.equal(settings.vfAudio, false); }
    if (model === 'grok-video-fal') assert.equal(settings.gkfMode, 'reference_to_video');
    if (model === 'grok-imagine-video-1.5') { assert.equal(settings.gkfMode, 'image_to_video'); assert.equal(Object.hasOwn(settings, 'gkfRatio'), false); }
    if (model === 'sora-2') { assert.equal(settings.soraMode, 'image_to_video'); assert.equal(settings.soraDeleteVideo, false); }
  }
  assert.throws(() => createContext(assets, 'video', 'fal', 'unknown'), /explicit supported FAL/);
});

test('ordinary Banana persistence seed selects exactly one registered family and preserves the Lite 4K archive', () => {
  const assets = [{ sourceUrl: '/files/input/owned-draft-0.png' }, { sourceUrl: '/files/input/owned-draft-1.png' }];
  const node = { id: 'removed-banana-source', entityUid: 'a1000000-0000-4000-8000-000000000001', type: 'image', position: { x: 500, y: 0 }, data: {} };
  for (const invalid of [undefined, 'unknown', 'nano-banana-pro-fal'])
    assert.throws(() => createContext(assets, 'image', 'banana', invalid), /explicit supported Banana/);
  assert.throws(() => createContext(assets, 'video', 'banana', 'nano-banana-pro'));
  for (const model of ['gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'nano-banana-pro',
    'nano-banana-pro-2k', 'nano-banana-pro-4k', 'gemini-3-pro-image']) {
    const context = createContext(assets, 'image', 'banana', model), snapshot = createSnapshot(node, context, assets[0].sourceUrl);
    assert.equal(completeSnapshot(snapshot, node.id), true);
    const archive = archiveInput({ projectId: 'p', canvasId: 'c', entityUid: 'run' },
      { nodeId: node.id, entityUid: 'node-run', nodeEntityUid: node.entityUid, historyInputSnapshot: snapshot }, { entityUid: 'attempt' });
    assert.equal(archive.status, 'available'); assert.deepEqual(archive.snapshot.node.data.historyResolvedInput, context);
    assert.equal(context.basicSettings.model, model.startsWith('gemini-3.1') ? 'nano-banana-2' : 'nano-banana-pro');
    assert.equal(context.basicSettings.apiModel, model); assert.equal(context.basicSettings.sizeLevel, '4K');
    assert.equal(context.basicSettings.aspectRatio, 'Auto'); assert.equal(Object.keys(context.basicSettings).length, 8);
    assert.deepEqual(context.referenceImages, [assets[1].sourceUrl, assets[0].sourceUrl, assets[1].sourceUrl]);
  }
});

test('FAL persistence seed requires one explicit model and archives its own option family', () => {
  const assets = [{ sourceUrl: '/files/input/owned-draft-0.png' }, { sourceUrl: '/files/input/owned-draft-1.png' }];
  const node = { id: 'removed-fal-source', entityUid: 'a1000000-0000-4000-8000-000000000001', type: 'image', position: { x: 500, y: 0 }, data: {} };
  assert.throws(() => createContext(assets, 'image', 'fal'), /explicit supported FAL/);
  assert.throws(() => createContext(assets, 'image', 'fal', 'unknown-fal'), /explicit supported FAL/);
  assert.throws(() => createContext(assets, 'video', 'fal', 'gpt-image-2-fal'));
  for (const apiModel of ['gpt-image-2-fal', 'nano-banana-pro-fal', 'nano-banana-2-fal']) {
    const gpt = apiModel === 'gpt-image-2-fal', context = createContext(assets, 'image', 'fal', apiModel);
    const snapshot = createSnapshot(node, context, assets[0].sourceUrl);
    assert.equal(completeSnapshot(snapshot, node.id), true);
    const archived = archiveInput({ projectId: 'p', canvasId: 'c', entityUid: 'run' },
      { nodeId: node.id, entityUid: 'node-run', nodeEntityUid: node.entityUid, historyInputSnapshot: snapshot }, { entityUid: 'attempt' });
    assert.equal(archived.status, 'available'); assert.deepEqual(archived.snapshot.node.data.historyResolvedInput, context);
    assert.equal(context.basicSettings.apiModel, apiModel);
    assert.equal(context.basicSettings.model, gpt ? 'gpt-image-2' : apiModel.slice(0, -4));
    assert.deepEqual(context.referenceImages, [assets[1].sourceUrl, assets[0].sourceUrl, assets[1].sourceUrl]);
    assert.equal(context.basicSettings.falSync, true);
    if (gpt) {
      assert.equal(context.basicSettings.falCustomW, 1001); assert.equal(context.basicSettings.falCustomH, 769);
      assert.equal(Object.hasOwn(context.basicSettings, 'nbSeed'), false);
    } else {
      assert.equal(context.basicSettings.nbSeed, 0); assert.equal(context.basicSettings.nbWebSearch, false);
      assert.equal(context.basicSettings.nbSysPrompt, ''); assert.equal(context.basicSettings.nbImgMode, 'base64');
      assert.equal(Object.hasOwn(context.basicSettings, 'falCustomW'), false);
    }
  }
});

test('Budget Flare persistence seed archives exact custom WebP inputs without standard-model defaults', () => {
  const assets = [{ sourceUrl: '/files/input/owned-draft-0.png' }, { sourceUrl: '/files/input/owned-draft-1.png' }];
  const node = { id: 'removed-budget-source', entityUid: 'a1000000-0000-4000-8000-000000000001', type: 'image', position: { x: 500, y: 0 }, data: {} };
  const context = createContext(assets, 'image', 'budget'), snapshot = createSnapshot(node, context, assets[0].sourceUrl);
  assert.equal(completeSnapshot(snapshot, node.id), true);
  const archived = archiveInput({ projectId: 'p', canvasId: 'c', entityUid: 'run' },
    { nodeId: node.id, entityUid: 'node-run', nodeEntityUid: node.entityUid, historyInputSnapshot: snapshot }, { entityUid: 'attempt' });
  assert.equal(archived.status, 'available'); assert.deepEqual(archived.snapshot.node.data.historyResolvedInput, context);
  assert.equal(context.basicSettings.apiModel, 'zhenzhen-image-g-v2.5-flare');
  assert.equal(context.basicSettings.imageBuiltinSource, 'seedance-nz');
  assert.equal(context.basicSettings.zhenzhenImageG25Size, 'custom');
  assert.equal(context.basicSettings.zhenzhenImageG25Resolution, '4k', 'inactive value is retained but hidden from custom-size review');
  assert.equal(context.basicSettings.zhenzhenImageG25OutputCompression, 0);
  assert.equal(context.basicSettings.zhenzhenImageG25OutputFormat, 'webp');
  assert.deepEqual(context.referenceImages, [assets[1].sourceUrl, assets[0].sourceUrl, assets[1].sourceUrl]);
  for (const key of ['gptImage25Size', 'gptImageQuality', 'zhenzhenImageG25NsfwCheck']) assert.equal(Object.hasOwn(context.basicSettings, key), false);
  assert.throws(() => createContext(assets, 'image', 'unknown'));
  assert.throws(() => createContext(assets, 'video', 'budget'));
});

test('actual image persistence seed satisfies the archival contract; the former non-public absolute path is rejected', () => {
  const assets = [{ sourceUrl: '/files/input/owned-draft-0.png' }, { sourceUrl: '/files/input/owned-draft-1.png' }];
  const generator = { id: 'removed-image-source', entityUid: 'a1000000-0000-4000-8000-000000000001', type: 'image', position: { x: 500, y: 0 }, data: {} };
  const context = createContext(assets);
  const invalid = createSnapshot(generator, context, '/old-output.png');
  assert.equal(completeSnapshot(invalid, generator.id), false, 'same former fixture fails the production safety gate');
  const valid = createSnapshot(generator, context, assets[0].sourceUrl);
  assert.equal(completeSnapshot(valid, generator.id), true);
  assert.deepEqual(context.referenceImages, [assets[1].sourceUrl, assets[0].sourceUrl, assets[1].sourceUrl]);
  assert.equal(valid.node.data.imageUrl, assets[0].sourceUrl, 'still tests excluding an old result instead of deleting the field');
  const archived = archiveInput({ projectId: 'p', canvasId: 'c', entityUid: 'run' },
    { nodeId: generator.id, entityUid: 'node-run', nodeEntityUid: generator.entityUid, historyInputSnapshot: valid }, { entityUid: 'attempt' });
  assert.equal(archived.status, 'available'); assert.deepEqual(archived.snapshot.node.data.historyResolvedInput, context);
  assert.equal(completeSnapshot(valid, 'wrong-node'), false);
});

test('actual Grok New persistence seed archives video context while preserving the historical model/size mismatch for review', () => {
  const assets = [{ sourceUrl: '/files/input/owned-draft-0.png' }, { sourceUrl: '/files/input/owned-draft-1.png' }];
  const generator = { id: 'removed-video-source', entityUid: 'a1000000-0000-4000-8000-000000000001', type: 'video', position: { x: 500, y: 0 }, data: {} };
  const context = createContext(assets, 'video'), snapshot = createSnapshot(generator, context, assets[0].sourceUrl);
  assert.equal(context.schema, 't8-video-frontend-context-v1');
  assert.equal(context.basicSettings.model, 'grok-1.5-video-6s');
  assert.equal(context.basicSettings.size, '720x1280'); assert.equal(context.basicSettings.ratio, '16:9');
  assert.equal(context.basicSettings.duration, 15, 'inactive duration must not be presented as the model duration');
  assert.deepEqual(context.localRefImages, [assets[1].sourceUrl, assets[0].sourceUrl]);
  assert.equal(completeSnapshot(snapshot, generator.id), true);
  const archive = archiveInput({ projectId: 'p', canvasId: 'c', entityUid: 'run' },
    { nodeId: generator.id, entityUid: 'node-run', nodeEntityUid: generator.entityUid, historyInputSnapshot: snapshot }, { entityUid: 'attempt' });
  assert.equal(archive.status, 'available'); assert.deepEqual(archive.snapshot.node.data.historyResolvedInput, context);
  assert.equal(Object.hasOwn(snapshot.node.data, 'imagePromptAdjustments'), false);
  assert.equal(Object.hasOwn(snapshot.node.data, 'imageUrl'), false);
  assert.throws(() => createContext(assets, 'unknown'));
});
