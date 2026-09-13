'use strict';
// Synthetic history in the already-running owned main's fresh database. Never
// create a second database handle or touch a retained/user project.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const falModels = ['gpt-image-2-fal', 'nano-banana-pro-fal', 'nano-banana-2-fal'];
const budgetModels = ['zhenzhen-image-g-v2.5-lowprice', 'zhenzhen-image-g-v2.5-flare', 'zhenzhen-image-g-v2.5-sunburst'];
const falVideoModels = ['veo3.1-fal', 'grok-video-fal', 'grok-imagine-video-1.5', 'sora-2'];
const bananaModels = ['gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'nano-banana-pro',
  'nano-banana-pro-2k', 'nano-banana-pro-4k', 'gemini-3-pro-image'];
function createContext(assets, nodeType = 'image', imageSource = 'standard', selectedModel) {
  assert.ok(['image', 'video'].includes(nodeType));
  assert.ok(['standard', 'budget', 'fal', 'banana'].includes(imageSource));
  assert.ok(nodeType === 'image' || ['standard', 'fal'].includes(imageSource));
  if (imageSource === 'fal') assert.ok((nodeType === 'video' ? falVideoModels : falModels).includes(selectedModel), 'One explicit supported FAL model is required');
  else if (imageSource === 'banana') assert.ok(bananaModels.includes(selectedModel), 'One explicit supported Banana model is required');
  else if (imageSource === 'budget') assert.ok(selectedModel === undefined || budgetModels.includes(selectedModel), 'One supported Budget model is required');
  else assert.equal(selectedModel, undefined);
  const falModel = imageSource === 'fal' ? selectedModel : undefined;
  const budgetModel = imageSource === 'budget' ? selectedModel || budgetModels[1] : undefined;
  const budgetLowprice = budgetModel === budgetModels[0];
  if (nodeType === 'video') {
    const falVideo = imageSource === 'fal';
    const settings = !falVideo ? { mainId: 'grok-video-3', model: 'grok-1.5-video-6s', videoBuiltinSource: 'zhenzhen',
      providerSource: 'zhenzhen', providerId: '', providerModel: '', ratio: '16:9', duration: 15, resolution: '720P', seed: 0, size: '720x1280' }
      : { mainId: selectedModel === 'veo3.1-fal' ? 'veo3.1' : selectedModel === 'sora-2' ? 'sora-2' : 'grok-video-3',
        model: selectedModel, videoBuiltinSource: 'zhenzhen', providerSource: 'zhenzhen', providerId: '', providerModel: '',
        ratio: '16:9', duration: 15, resolution: '720P', seed: 0,
        ...(selectedModel === 'veo3.1-fal' ? { vfRatio: '9:16', vfDuration: '8s', vfResolution: '4k', vfAudio: false, vfSafety: 0 }
          : selectedModel === 'sora-2' ? { soraMode: 'image_to_video', soraRatio: 'auto', soraDuration: 8, soraResolution: 'auto', soraDeleteVideo: false, soraBlockIp: true }
          : { gkfMode: selectedModel === 'grok-imagine-video-1.5' ? 'image_to_video' : 'reference_to_video', gkfDuration: 10,
            gkfResolution: '720p', ...(selectedModel === 'grok-video-fal' ? { gkfRatio: 'auto' } : {}) }) };
    return {
    schema: 't8-video-frontend-context-v1', origin: 'frontend-common-context',
    prompt: 'Historical upstream: use @image1; keep @img1 @image01 @image2 literally.',
    localRefImages: [assets[1].sourceUrl, assets[0].sourceUrl], localRefVideos: [], localRefAudios: [],
    basicSettings: settings,
    };
  }
  const settings = imageSource === 'banana' ? {
    model: selectedModel.startsWith('gemini-3.1') ? 'nano-banana-2' : 'nano-banana-pro', apiModel: selectedModel,
    imageBuiltinSource: 'zhenzhen', providerSource: 'zhenzhen', providerId: '', providerModel: '', aspectRatio: 'Auto', sizeLevel: '4K',
  } : imageSource === 'budget' ? {
    model: 'gpt-image-2', apiModel: budgetModel, imageBuiltinSource: 'seedance-nz',
    providerSource: 'zhenzhen', providerId: '', providerModel: '', aspectRatio: '16:9', sizeLevel: '2K',
    zhenzhenImageG25Size: budgetLowprice ? '16:9' : 'custom', zhenzhenImageG25Resolution: '4k', zhenzhenImageG25Count: budgetLowprice ? 1 : 3,
    ...(budgetLowprice ? { zhenzhenImageG25NsfwCheck: false } : {
    zhenzhenImageG25CustomWidth: 1536, zhenzhenImageG25CustomHeight: 1024, zhenzhenImageG25Quality: 'max',
    zhenzhenImageG25OutputFormat: 'webp', zhenzhenImageG25OutputCompression: 0,
    zhenzhenImageG25Background: 'transparent', zhenzhenImageG25Moderation: 'low' }),
  } : imageSource === 'fal' ? {
    model: falModel === 'gpt-image-2-fal' ? 'gpt-image-2' : falModel.slice(0, -4), apiModel: falModel, imageBuiltinSource: 'zhenzhen',
    providerSource: 'zhenzhen', providerId: '', providerModel: '', aspectRatio: '16:9', sizeLevel: '2K',
    falN: 3, falFormat: 'webp', falSync: true,
    ...(falModel === 'gpt-image-2-fal' ? { falMode: 'edit', falSize: 'custom', falCustomW: 1001, falCustomH: 769, falQuality: 'high' }
      : { nbAspect: '9:16', nbResolution: '4K', nbSafety: '1', nbSeed: 0, nbSysPrompt: '', nbWebSearch: false, nbImgMode: 'base64' }),
  } : { model: 'gpt-image-2', apiModel: 'gpt-image-2.5-flare', imageBuiltinSource: 'zhenzhen',
    providerSource: 'zhenzhen', providerId: '', providerModel: '', aspectRatio: '16:9', sizeLevel: '2K',
    gptImageQuality: 'xhigh', gptImageModeration: 'low', gptImage25Size: 'custom',
    gptImage25CustomWidth: 1536, gptImage25CustomHeight: 1024, gptImage25Count: 3, gptImage25Background: 'opaque' };
  return { schema: 't8-image-frontend-context-v2', origin: 'frontend-common-context',
    prompt: 'Historical upstream: use @image2 and @image3; keep @img2 literally.\nImage adjustment requirements: original composition.',
    referenceImages: [assets[1].sourceUrl, assets[0].sourceUrl, assets[1].sourceUrl], basicSettings: settings };
}
function createSnapshot(generator, context, previousImageUrl) {
  return { schema: 't8-generation-settings-input-v1', purpose: 'prefill-only', complete: true, credentialsOmitted: false,
    node: { ...generator, data: { prompt: 'Original local text', taskId: 'do-not-restore',
      ...(generator.type === 'image' ? { imageUrl: previousImageUrl, imagePromptAdjustments: [{ id: 'do-not-reapply' }] } : {}),
      historyResolvedInput: context } }, upstreamNodes: [], incomingEdges: [] };
}
module.exports = async function seed(expectedRoot) {
  assert.ok(['image-input-draft', 'budget-image-input-draft', 'fal-image-input-draft', 'banana-image-input-draft', 'video-input-draft', 'fal-video-input-draft'].includes(process.env.T8_ACCEPTANCE_SCENARIO));
  const nodeType = ['video-input-draft', 'fal-video-input-draft'].includes(process.env.T8_ACCEPTANCE_SCENARIO) ? 'video' : 'image';
  const imageSource = process.env.T8_ACCEPTANCE_SCENARIO === 'budget-image-input-draft' ? 'budget'
    : process.env.T8_ACCEPTANCE_SCENARIO === 'fal-image-input-draft' ? 'fal'
    : process.env.T8_ACCEPTANCE_SCENARIO === 'fal-video-input-draft' ? 'fal'
    : process.env.T8_ACCEPTANCE_SCENARIO === 'banana-image-input-draft' ? 'banana' : 'standard';
  const selectedModel = imageSource === 'fal' ? (nodeType === 'video' ? process.env.T8_ACCEPTANCE_FAL_VIDEO_MODEL : process.env.T8_ACCEPTANCE_FAL_MODEL)
    : imageSource === 'banana' ? process.env.T8_ACCEPTANCE_BANANA_MODEL
    : imageSource === 'budget' ? process.env.T8_ACCEPTANCE_BUDGET_MODEL : undefined;
  if (imageSource === 'fal') assert.ok((nodeType === 'video' ? falVideoModels : falModels).includes(selectedModel), 'Reject missing or unknown model before creating owned fixtures');
  if (imageSource === 'banana') assert.ok(bananaModels.includes(selectedModel), 'Reject missing or unknown model before creating owned fixtures');
  if (imageSource === 'budget') assert.ok(budgetModels.includes(selectedModel), 'Reject missing or unknown model before creating owned fixtures');
  const inputKind = nodeType === 'video' ? (imageSource === 'fal' ? 'fal-video' : 'standard-video') : imageSource === 'budget' ? 'budget-image' : imageSource === 'fal' ? 'fal-image'
    : imageSource === 'banana' ? 'banana-image' : 'standard-image';
  const config = require('../backend/src/config');
  assert.equal(path.resolve(config.BASE_DIR), path.resolve(expectedRoot));
  assert.equal(path.basename(expectedRoot), 'user-data');
  assert.ok(path.basename(path.dirname(expectedRoot)).startsWith('t8-full-electron-'));
  const database = require('../backend/src/services/projectDatabase').getProjectDatabase(config);
  const { AssetIndexer } = require('../backend/src/services/assetIndexer');
  const indexer = new AssetIndexer(config, database);
  const id = `owned-${nodeType}-input-canvas`, projectId = `owned-${nodeType}-input-project`, nodeId = `removed-${nodeType}-source`, keepId = 'keep-current-text';
  assert.equal(database.getCanvas(id), null, 'Never overwrite an existing canvas');
  const assets = [], filenames = [];
  for (const [index, background] of ['#f97316', '#2563eb'].entries()) {
    const filename = path.join(config.INPUT_DIR, `owned-draft-${index}.png`);
    assert.equal(fs.existsSync(filename), false);
    await require('sharp')({ create: { width: 16, height: 16, channels: 3, background } }).png().toFile(filename);
    filenames.push(filename);
    assets.push(await indexer.indexFile(filename, { projectId, rootName: 'input', rootPath: config.INPUT_DIR, recordLineage: false }));
  }
  const context = createContext(assets, nodeType, imageSource, selectedModel), settings = context.basicSettings;
  const document = database.ensureCanvas(id, { nodes: [
    { id: nodeId, type: nodeType, position: { x: 500, y: 0 }, data: { prompt: 'Original local text' } },
    { id: keepId, type: 'text', position: { x: 0, y: 0 }, data: { prompt: 'Existing canvas content must remain unchanged.' } },
  ], edges: [], viewport: { x: 160, y: 80, zoom: 0.8 } }, projectId);
  const snapshot = createSnapshot(document.nodes.find(node => node.id === nodeId), context, assets[0].sourceUrl);
  assert.equal(require('../backend/src/services/generationHistoryInputs').completeSnapshot(snapshot, nodeId), true,
    'Owned fixture must satisfy the production history contract before seeding a Run');
  const archived = snapshot.node;
  const run = database.createRun({ projectId, canvasId: id, canvasRevision: document.revision, status: 'running' });
  const nodeRun = database.createNodeRun({ runId: run.id, nodeId, status: 'running',
    inputSnapshot: { schema: 't8-run-node-input-v1', replayable: true, node: archived, upstreamNodes: [], incomingEdges: [] },
    historyInputSnapshot: snapshot });
  const attempt = database.createAttempt({ nodeRunId: nodeRun.id, status: 'running' });
  const outputFile = path.join(config.OUTPUT_DIR, 'owned-image-input-output.txt');
  fs.writeFileSync(outputFile, 'Synthetic history, not a Provider generation.', { flag: 'wx' });
  await indexer.commitHostRunOutputAssets({ runId: run.id, nodeRunId: nodeRun.id, attemptId: attempt.id,
    outputs: [{ sourceUrl: '/files/output/owned-image-input-output.txt', outputOrdinal: 0 }] });
  database.updateAttempt(attempt.id, { status: 'succeeded' }); database.updateNodeRun(nodeRun.id, { status: 'succeeded' }); database.updateRun(run.id, { status: 'succeeded' });
  database.saveCanvasSnapshot(id, { ...document, nodes: document.nodes.filter(node => node.id === keepId) }, { expectedRevision: document.revision });
  // Move only this freshly generated fixture's blue source out of its indexed
  // location. The original remains available for an explicit file-picker test.
  const originalFile = path.resolve(expectedRoot, 'temp', 'owned-original-blue.png');
  for (const filename of [filenames[1], originalFile]) {
    const relative = path.relative(fs.realpathSync(expectedRoot), path.resolve(filename));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  }
  assert.equal(fs.lstatSync(filenames[1]).isSymbolicLink(), false);
  assert.equal(fs.existsSync(originalFile), false); fs.renameSync(filenames[1], originalFile);
  const videoReferenceCount = inputKind === 'fal-video' && ['veo3.1-fal', 'grok-video-fal'].includes(settings.model) ? 2 : 1;
  return { id, projectId, nodeId, nodeType, inputKind, keepId, settings, context, originalFile, wrongFile: filenames[0],
    expectedHashes: nodeType === 'video' ? [assets[1].contentHash, assets[0].contentHash].slice(0, videoReferenceCount) : [assets[1].contentHash, assets[0].contentHash, assets[1].contentHash],
    originalAssets: assets.map(asset => ({ id: asset.id, entityUid: asset.entityUid, contentHash: asset.contentHash })) };
};
module.exports.createContext = createContext;
module.exports.createSnapshot = createSnapshot;
