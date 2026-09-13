'use strict';
// Test-only records, not claimed as real generations. Called inside the owned
// full Electron main so its existing production database instance is reused.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
module.exports = async function seed(expectedRoot) {
  assert.equal(process.env.T8_ACCEPTANCE_SCENARIO, 'basic-settings');
  const config = require('../backend/src/config');
  assert.equal(path.resolve(config.BASE_DIR), path.resolve(expectedRoot));
  assert.equal(path.basename(expectedRoot), 'user-data');
  assert.ok(path.basename(path.dirname(expectedRoot)).startsWith('t8-full-electron-'));
  const database = require('../backend/src/services/projectDatabase').getProjectDatabase(config);
  const { AssetIndexer } = require('../backend/src/services/assetIndexer');
  const indexer = new AssetIndexer(config, database);
  const imageFile = path.join(config.INPUT_DIR, 'owned-settings-reference.png');
  await require('sharp')({ create: { width: 16, height: 16, channels: 3, background: '#e53935' } }).png().toFile(imageFile);
  const reference = '/files/input/owned-settings-reference.png';
  const outputFile = path.join(config.OUTPUT_DIR, 'owned-settings-output.txt');
  fs.writeFileSync(outputFile, 'Synthetic history output for settings persistence; not a Provider generation.');
  const result = [];
  const cases = [
    { name: 'image-standard', type: 'image', model: 'gpt-image-2', apiModel: 'gpt-image-2.5-flare',
      options: { gptImageQuality: 'xhigh', gptImageModeration: 'low', gptImage25Size: 'custom',
        gptImage25CustomWidth: 1536, gptImage25CustomHeight: 1024, gptImage25Count: 3, gptImage25Background: 'opaque' } },
    { name: 'image-fal', type: 'image', model: 'nano-banana-pro', apiModel: 'nano-banana-pro-fal',
      options: { falN: 2, falFormat: 'webp', falSync: false, nbWebSearch: false, nbSeed: 0,
        nbSysPrompt: 'Archived settings persistence: ' + 'Exact prompt 中文 0123456789. '.repeat(90) } },
    { name: 'image-mj', type: 'image', model: 'midjourney', apiModel: 'midjourney',
      options: { mjVersion: 'v 8.1', mjAr: '16:9', mjSpeed: 'relax', mjC: 10, mjS: 150, mjIw: 2,
        mjSw: 120, mjSv: '2', mjNo: 'blur', mjSeed: 0, mjMaxPoll: 200, mjPollInt: 4 } },
    { name: 'image-budget', type: 'image', model: 'gpt-image-2', apiModel: 'zhenzhen-image-g-v2.5-flare', source: 'seedance-nz',
      options: { zhenzhenImageG25Size: 'custom', zhenzhenImageG25Resolution: '2k', zhenzhenImageG25Count: 2,
        zhenzhenImageG25CustomWidth: 1536, zhenzhenImageG25CustomHeight: 1024, zhenzhenImageG25Quality: 'high',
        zhenzhenImageG25OutputFormat: 'webp', zhenzhenImageG25OutputCompression: 0,
        zhenzhenImageG25Background: 'opaque', zhenzhenImageG25Moderation: 'low' } },
    { name: 'video', type: 'video', options: {} },
  ];
  const selected = cases.filter(fixture => fixture.name === process.env.T8_ACCEPTANCE_SETTINGS_CASE);
  assert.equal(selected.length, 1, 'Full-client settings acceptance requires one explicit supported case');
  for (const fixture of selected) {
    const { type, name, options } = fixture;
    const id = `owned-basic-${name}`, nodeId = `${name}-source`, projectId = 'owned-basic-project';
    assert.equal(database.getCanvas(id), null, 'Never overwrite an existing fixture');
    const settings = type === 'image'
      ? { model: fixture.model, apiModel: fixture.apiModel, imageBuiltinSource: fixture.source || 'zhenzhen',
        providerSource: 'zhenzhen', providerId: '', providerModel: '', aspectRatio: '1:1', sizeLevel: '1K' }
      : { mainId: 'grok-video-3', model: 'grok-video-3', videoBuiltinSource: 'zhenzhen', duration: 6, ratio: '16:9', resolution: '720P', generateAudio: false, enhancePrompt: false };
    const saved = { prompt: `${name} archived prompt`, ...settings, ...options };
    // New options exist only in the v2 capture, not raw data. This proves the
    // real history route/planner reads captured values rather than raw defaults.
    const archivedData = { prompt: saved.prompt, ...settings, ...(type === 'image' ? { historyResolvedInput: {
      schema: 't8-image-frontend-context-v2', origin: 'frontend-common-context',
      prompt: `${name} compiled prompt`, referenceImages: [reference], basicSettings: { ...settings, ...options },
    } } : {}) };
    const current = { ...settings, prompt: `${name} current draft`, status: 'success', lastPrompt: `${name} existing output prompt`,
      ...(type === 'image' ? { sizeLevel: '2K', referenceImages: [reference], imageUrl: reference, imageUrls: [reference] }
        : { duration: 10, localRefImages: [reference] }) };
    const document = database.ensureCanvas(id, { nodes: [{ id: nodeId, type, position: { x: 0, y: 0 }, data: current }],
      edges: [], viewport: { x: 160, y: 80, zoom: 0.8 } }, projectId);
    const generator = document.nodes[0];
    const archived = { ...generator, data: archivedData };
    const run = database.createRun({ projectId, canvasId: id, canvasRevision: document.revision, status: 'running' });
    const nodeRun = database.createNodeRun({ runId: run.id, nodeId, status: 'running',
      inputSnapshot: { schema: 't8-run-node-input-v1', replayable: true, node: archived, upstreamNodes: [], incomingEdges: [] },
      historyInputSnapshot: { schema: 't8-generation-settings-input-v1', purpose: 'prefill-only', complete: true, credentialsOmitted: false,
        node: archived, upstreamNodes: [], incomingEdges: [] } });
    const attempt = database.createAttempt({ nodeRunId: nodeRun.id, status: 'running' });
    await indexer.commitHostRunOutputAssets({ runId: run.id, nodeRunId: nodeRun.id, attemptId: attempt.id,
      outputs: [{ sourceUrl: '/files/output/owned-settings-output.txt', outputOrdinal: 0 }] });
    database.updateAttempt(attempt.id, { status: 'succeeded' }); database.updateNodeRun(nodeRun.id, { status: 'succeeded' }); database.updateRun(run.id, { status: 'succeeded' });
    result.push({ id, nodeId, projectId, type, name, saved, options, archivedData });
  }
  return result;
};
