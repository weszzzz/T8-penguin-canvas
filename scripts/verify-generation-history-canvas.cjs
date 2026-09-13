'use strict';
// Actual Canvas.tsx + production canvas/history/recovery/media HTTP routes.
// Only peripheral app shell is omitted. Files and DB live under one owned TEMP
// directory. Backend process is restarted, not merely browser-refreshed.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');

async function cleanupVerificationResources(steps) {
  const errors = [];
  for (const [resource, cleanup] of steps) {
    try { await cleanup(); }
    catch (error) { errors.push({ resource, error: error?.message || String(error) }); }
  }
  return errors;
}

async function backend() {
  const root = process.env.T8PC_DEV_DATA_ROOT;
  assert.ok(root && path.isAbsolute(root) && path.basename(root).startsWith('t8-history-canvas-'));
  const config = require('../backend/src/config');
  assert.equal(config.BASE_DIR, root);
  for (const key of ['DEFAULT_LOCAL_SAVE_DIR', 'DEFAULT_CANVAS_AUTO_SAVE_DIR', 'DEFAULT_RESOURCE_LIBRARY_DIR', 'DEFAULT_THEME_TEMPLATE_DIR']) config[key] = path.join(root, key.toLowerCase());
  config.COLLAB_PORT = 0;
  for (const key of ['DATA_DIR', 'INPUT_DIR', 'OUTPUT_DIR', 'THUMBNAILS_DIR']) fs.mkdirSync(config[key], { recursive: true });
  const { getProjectDatabase, closeProjectDatabase } = require('../backend/src/services/projectDatabase');
  const database = getProjectDatabase(config);
  if (!database.getCanvas('generation-canvas')) {
    // Only the Provider boundary is synthetic. Runs, output ingestion, history
    // and Canvas writes below are driven by the actual browser UI and routes.
    const { spawnSync } = require('node:child_process');
    for (const [label, color] of [['a', 'red'], ['b', 'blue']]) {
      const encoded = spawnSync(path.join(ROOT, 'tools/ffmpeg-runtime/ffmpeg.exe'),
        ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=160x90:r=10:d=1`,
          '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(config.OUTPUT_DIR, `generation-${label}.mp4`)],
        { windowsHide: true, timeout: 30000, encoding: 'utf8' });
      assert.equal(encoded.status, 0, encoded.stderr);
    }
    database.ensureCanvas('generation-canvas', { nodes: [{ id: 'actual-generator', type: 'seedance',
      position: { x: 0, y: 0 }, data: { prompt: 'History acceptance version A', pollInt: 2,
        seedanceApiSource: 'zhenzhen-legacy', duration: 5, ratio: '16:9', resolution: '720p' } }],
      edges: [], viewport: { x: 200, y: 80, zoom: 0.8 } }, 'history-project');
  }
  for (const kind of ['image', 'video']) if (!database.getCanvas(`${kind}-generation-canvas`)) {
    if (kind === 'image') for (const [label, color] of [['a', '#ff0000'], ['b', '#0000ff']]) {
      await require('sharp')({ create: { width: 32, height: 32, channels: 3, background: color } }).png().toFile(path.join(config.OUTPUT_DIR, `generation-${label}.png`));
    }
    database.ensureCanvas(`${kind}-generation-canvas`, {
      nodes: [{ id: `${kind}-generator`, type: kind, position: { x: 0, y: 0 },
        data: { prompt: `${kind} history A`, ...(kind === 'image'
          ? { model: 'gpt-image-2', apiModel: 'gpt-image-2' }
          : { mainId: 'grok-video-3', model: 'grok-video-3', duration: 6, ratio: '16:9', resolution: '720P' }) } }],
      edges: [], viewport: { x: 140, y: 60, zoom: 0.75 },
    }, 'history-project');
  }
  if (!database.getCanvas('history-canvas')) database.ensureCanvas('history-canvas', {
    nodes: [{ id: 'source', type: 'text', position: { x: 0, y: 0 }, data: { text: 'Original canvas content must survive', prompt: 'Original canvas content must survive' } }], edges: [], viewport: { x: 350, y: 200, zoom: 1 },
  }, 'history-project');
  // Separate identity scenario uses actual Host/CAS output receipts with
  // synthetic text bytes. It exercises the real selected-node action bar,
  // not a mocked count and not a paid Provider invocation.
  if (!database.getCanvas('identity-canvas')) {
    let document = database.ensureCanvas('identity-canvas', { nodes: [{ id: 'same-generator', entityUid: 'a1000000-0000-4000-8000-000000000001', type: 'seedance', position: { x: 0, y: 0 }, data: { prompt: 'Replacement identity test' } }], edges: [], viewport: { x: 300, y: 150, zoom: 0.8 } }, 'history-project');
    const { AssetIndexer } = require('../backend/src/services/assetIndexer');
    const { AssetBlobStore } = require('../backend/src/services/assetBlobStore');
    const indexer = new AssetIndexer(config, database, { blobStore: new AssetBlobStore(config.ASSET_BLOB_DIR) });
    fs.writeFileSync(path.join(config.OUTPUT_DIR, 'identity-output.txt'), 'Synthetic local output for identity acceptance.');
    for (const label of ['old-1', 'old-2', 'new-1']) {
      if (label === 'new-1') {
        database.saveCanvasSnapshot('identity-canvas', { ...document, nodes: document.nodes.map(node => ({ ...node, entityUid: 'a1000000-0000-4000-8000-000000000002' })) }, { expectedRevision: document.revision });
        document = database.getCanvas('identity-canvas');
      }
      const run = database.createRun({ id: `identity-${label}`, projectId: 'history-project', canvasId: 'identity-canvas', canvasRevision: document.revision, status: 'running' });
      const node = database.createNodeRun({ runId: run.id, nodeId: 'same-generator', status: 'running', inputSnapshot: {
        schema: 't8-run-node-input-v1', replayable: true,
        node: { id: 'same-generator', type: 'seedance', position: { x: 0, y: 0 }, data: { prompt: label, duration: 10, localRefImages: ['/files/input/historical-reference.png'] } }, upstreamNodes: [], incomingEdges: [],
      } });
      const attempt = database.createAttempt({ nodeRunId: node.id, status: 'running' });
      await indexer.commitHostRunOutputAssets({ runId: run.id, nodeRunId: node.id, attemptId: attempt.id, outputs: [{ sourceUrl: '/files/output/identity-output.txt', outputOrdinal: 0 }] });
      database.updateAttempt(attempt.id, { status: 'succeeded' }); database.updateNodeRun(node.id, { status: 'succeeded' }); database.updateRun(run.id, { status: 'succeeded' });
    }
  }
  if (!database.getCanvas('input-draft-canvas')) {
    const sharp = require('sharp');
    const { AssetIndexer } = require('../backend/src/services/assetIndexer');
    const { AssetBlobStore } = require('../backend/src/services/assetBlobStore');
    const indexer = new AssetIndexer(config, database, { blobStore: new AssetBlobStore(config.ASSET_BLOB_DIR) });
    for (const [name, color] of [['draft-red.png', '#e53935'], ['draft-blue.png', '#1565c0']]) {
      const filename = path.join(config.INPUT_DIR, name);
      await sharp({ create: { width: 16, height: 16, channels: 3, background: color } }).png().toFile(filename);
      await indexer.indexFile(filename, { projectId: 'history-project', rootName: 'input', rootPath: config.INPUT_DIR });
    }
    const generator = { id: 'removed-generator', type: 'seedance', position: { x: 600, y: 0 }, data: { prompt: 'Ignored node prompt', duration: 10,
      materialOrder: ['draft-refs::image:/files/input/draft-blue.png', 'draft-refs::image:/files/input/draft-red.png'] } };
    const sources = [{ id: 'draft-refs', type: 'upload', position: { x: 0, y: 0 }, data: { imageUrls: ['/files/input/draft-red.png', '/files/input/draft-blue.png'] } },
      { id: 'draft-text', type: 'text', position: { x: 300, y: 0 }, data: { text: 'Historical upstream prompt with @image2' } }];
    const edges = sources.map((node, index) => ({ id: `draft-edge-${index}`, source: node.id, target: generator.id }));
    const document = database.ensureCanvas('input-draft-canvas', { nodes: [generator, ...sources], edges, viewport: { x: 300, y: 150, zoom: 0.8 } }, 'history-project');
    const run = database.createRun({ id: 'input-draft-run', projectId: 'history-project', canvasId: 'input-draft-canvas', canvasRevision: document.revision, status: 'running' });
    const node = database.createNodeRun({ runId: run.id, nodeId: generator.id, status: 'running',
      inputSnapshot: { schema: 't8-run-node-input-v1', replayable: true, node: generator, upstreamNodes: sources, incomingEdges: edges }, historyInputSnapshot: {
      schema: 't8-generation-settings-input-v1', purpose: 'prefill-only', complete: true, credentialsOmitted: false,
      node: generator, upstreamNodes: sources, incomingEdges: edges,
    } });
    const attempt = database.createAttempt({ nodeRunId: node.id, status: 'running' });
    fs.writeFileSync(path.join(config.OUTPUT_DIR, 'input-draft-output.txt'), 'Synthetic output; input restoration must never submit a new generation.');
    await indexer.commitHostRunOutputAssets({ runId: run.id, nodeRunId: node.id, attemptId: attempt.id, outputs: [{ sourceUrl: '/files/output/input-draft-output.txt', outputOrdinal: 0 }] });
    database.updateAttempt(attempt.id, { status: 'succeeded' }); database.updateNodeRun(node.id, { status: 'succeeded' }); database.updateRun(run.id, { status: 'succeeded' });
    const history = require('../backend/src/services/generationHistory').listGenerationHistory(database, { projectId: 'history-project', canvasId: 'input-draft-canvas' });
    assert.equal(history.groups[0].nodeType, 'seedance');
    assert.equal(history.groups[0].snapshotAvailable, true);
    database.saveCanvasSnapshot('input-draft-canvas', { ...document,
      nodes: [{ id: 'keep', type: 'text', position: { x: 0, y: 0 }, data: { text: 'Keep this current node unchanged' } }], edges: [],
    }, { expectedRevision: document.revision });
  }
  if (!database.getCanvas('resolved-input-canvas')) {
    const resolved = { schema: 't8-seedance-frontend-input-v1', origin: 'frontend-request', prompt: 'Historical effective prompt',
      model: 'doubao-seedance-2-0-fast-260128', seedanceNzModel: 'fast', seedanceApiSource: 'zhenzhen-legacy', providerSource: 'zhenzhen',
      duration: 7, ratio: '9:16', resolution: '720p', generateAudio: true, returnLastFrame: true, watermark: false, webSearch: false,
      seed: 88, maxPoll: 360, pollInt: 10, frameMode: 'auto', localRefImages: [], localRefVideos: [], localRefAudios: [], providerParams: { motion: 0.25 } };
    const generator = { id: 'resolved-generator', type: 'seedance', position: { x: 0, y: 0 }, data: { prompt: 'Raw node prompt' } };
    const document = database.ensureCanvas('resolved-input-canvas', { nodes: [generator], edges: [], viewport: { x: 300, y: 150, zoom: 0.8 } }, 'history-project');
    const run = database.createRun({ id: 'resolved-input-run', projectId: 'history-project', canvasId: 'resolved-input-canvas', canvasRevision: document.revision, status: 'running' });
    const node = database.createNodeRun({ runId: run.id, nodeId: generator.id, status: 'running', inputSnapshot: { schema: 't8-run-node-input-v1', replayable: true, node: generator, upstreamNodes: [], incomingEdges: [] },
      historyInputSnapshot: { schema: 't8-generation-settings-input-v1', purpose: 'prefill-only', complete: true, credentialsOmitted: false,
        node: { ...generator, data: { ...generator.data, historyResolvedInput: resolved } }, upstreamNodes: [], incomingEdges: [] } });
    const attempt = database.createAttempt({ nodeRunId: node.id, status: 'running' });
    const filename = path.join(config.OUTPUT_DIR, 'resolved-input.txt'); fs.writeFileSync(filename, 'Synthetic output for resolved-input restoration acceptance');
    const { AssetIndexer } = require('../backend/src/services/assetIndexer');
    await new AssetIndexer(config, database).commitHostRunOutputAssets({ runId: run.id, nodeRunId: node.id, attemptId: attempt.id, outputs: [{ sourceUrl: '/files/output/resolved-input.txt', outputOrdinal: 0 }] });
    database.updateAttempt(attempt.id, { status: 'succeeded' }); database.updateNodeRun(node.id, { status: 'succeeded' }); database.updateRun(run.id, { status: 'succeeded' });
    database.saveCanvasSnapshot('resolved-input-canvas', { ...document, nodes: [{ id: 'keep-resolved', type: 'text', position: { x: 0, y: 0 }, data: { text: 'Unchanged' } }] }, { expectedRevision: document.revision });
  }
  const express = require('express');
  const app = express(); app.use(express.json({ limit: '8mb' }));
  const runs = require('../backend/src/routes/projectRuns');
  const assets = require('../backend/src/routes/projectAssets');
  app.use('/api/canvas', require('../backend/src/routes/canvas'));
  app.use('/api/project-runs', runs);
  app.use('/api/project-assets', assets);
  app.use('/api/settings', require('../backend/src/routes/settings'));
  app.use('/files', express.static(root));
  app.use((_req, res) => res.status(404).json({ success: false, error: 'Outside history acceptance scope' }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  process.send({ port: server.address().port });
  process.on('message', async message => {
    if (message === 'replace-input-reference') {
      // Test-only IPC, confined to this owned temporary DB. Simulate a mutable
      // asset ID now pointing at different verified bytes; never edit archives.
      try {
        const list = require('../backend/src/services/generationHistory').listGenerationHistory;
        const group = list(database, { projectId: 'history-project', canvasId: 'input-draft-canvas' }).groups[0];
        const archive = list(database, { projectId: 'history-project', canvasId: 'input-draft-canvas', groupId: group.id, includeInput: true }).groups[0].inputArchive;
        const original = archive.references.entries[1];
        assert.deepEqual(original.path, ['upstreamNodes', 0, 'data', 'imageUrls', 1]);
        const filename = path.join(config.INPUT_DIR, 'replacement-green.png');
        await require('sharp')({ create: { width: 16, height: 16, channels: 3, background: '#00ff00' } }).png().toFile(filename);
        const { AssetIndexer } = require('../backend/src/services/assetIndexer');
        const indexer = new AssetIndexer(config, database);
        const changed = await indexer.indexFile(filename, { projectId: 'history-project', rootName: 'input', rootPath: config.INPUT_DIR });
        assert.ok(changed?.id);
        const next = database.getAsset(changed.id);
        database.upsertAsset({ ...database.getAsset(original.assetId), contentHash: next.contentHash, contentHashVerification: 'verified',
          managedPath: filename, sourceUrl: '/files/input/replacement-green.png', storageMode: 'linked', availability: 'available' });
        process.send({ replaced: true, assetId: original.assetId, newHash: next.contentHash });
      } catch (error) { process.send({ replaced: false, error: error.message }); }
      return;
    }
    if (message !== 'stop') return;
    try {
      server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve));
      const runtime = runs.peekRuntime();
      await runtime?.recoveryManager?.shutdown();
      await runtime?.previewPipeline?.shutdown();
      await runtime?.collaborationGateway?.shutdown();
      await closeProjectDatabase();
      process.exit(0);
    } catch (error) { console.error(error); process.exit(1); }
  });
}

async function main() {
  const { chromium } = require('playwright');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 't8-history-canvas-'));
  const artifacts = path.join(ROOT, 'artifacts', 'generation-history-canvas'); fs.mkdirSync(artifacts, { recursive: true });
  let child, server, browser, backendPort;
  const report = { schema: 't8-generation-history-canvas-acceptance-v1', startedAt: new Date().toISOString(), passed: false,
    scope: 'actual-Canvas-production-routes-temporary-database-backend-process-restart', providerCalls: 0, installedElectron: false, cases: [] };
  const writeReport = () => fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  // An abrupt browser protocol failure must not leave an older passed report
  // looking like the outcome of this run. Never swallow that fatal exception.
  writeReport();
  const recordFatal = error => { report.passed = false; report.failure = error.message; writeReport(); };
  process.on('uncaughtExceptionMonitor', recordFatal);
  const closePage = async page => {
    writeReport();
    // Drain outstanding interception handlers before detaching the CDP page.
    // https://playwright.dev/docs/api/class-page#page-unroute-all
    await page.unrouteAll({ behavior: 'wait' });
    await page.close();
  };
  const start = async () => {
    child = fork(__filename, ['--backend'], { cwd: ROOT, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', T8PC_DEV_DATA_ROOT: temporary }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout.on('data', data => process.stdout.write(data)); child.stderr.on('data', data => process.stderr.write(data));
    backendPort = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Isolated backend startup timed out')), 60000);
      child.once('message', message => { clearTimeout(timer); resolve(message.port); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Isolated backend exited ${code}`)); });
    });
  };
  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Isolated backend did not close')), 30000); child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Backend shutdown ${code}`)); }); child.send('stop'); });
  };
  try {
    await start();
    const { createServer } = await import('vite');
    const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
      import Canvas from '/src/components/Canvas.tsx'; import {useCanvasStore} from '/src/stores/canvas.ts';
      import '/src/i18n'; import '/src/styles/index.css';
      const canvasId = new URLSearchParams(location.search).get('canvas') || 'history-canvas';
      useCanvasStore.setState({activeId:canvasId,bootstrapped:true,loading:false,canvases:[{id:canvasId,name:'History acceptance',nodeCount:1,createdAt:1,updatedAt:1}]});
      document.documentElement.dataset.themeMode='light';
      createRoot(document.getElementById('root')).render(React.createElement(Canvas));`;
    server = await createServer({ root: ROOT, configFile: false, cacheDir: path.join(temporary, 'vite'), esbuild: { jsx: 'automatic' },
      define: { __APP_VERSION__: JSON.stringify('3.1.5'), __APP_NAME__: JSON.stringify('History acceptance') },
      optimizeDeps: { entries: ['src/components/Canvas.tsx'], include: ['react', 'react-dom/client'] },
      server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'history-canvas-acceptance',
        resolveId(id) { if (id === '/history-canvas-entry.js') return '\0history-canvas-entry'; if (id === 'virtual:t8-local-extensions') return path.join(ROOT, 'src/extensions/emptyLocalExtensions.tsx'); },
        load(id) { if (id === '\0history-canvas-entry') return entry; },
        configureServer(vite) { vite.middlewares.use((req, res, next) => {
          if (req.url.startsWith('/api/') || req.url.startsWith('/files/')) {
            const http = require('node:http');
            const upstream = http.request({ hostname: '127.0.0.1', port: backendPort, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${backendPort}` } }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
            upstream.on('error', () => { res.statusCode = 502; res.end(); }); req.pipe(upstream); return;
          }
          if (req.url.split('?')[0] !== '/__history_canvas') return next();
          res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><div id="root" style="display:flex;width:100vw;height:100vh"></div><script type="module" src="/history-canvas-entry.js"></script></body></html>');
        }); },
      }],
    });
    await server.listen(); const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    let page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], failedRequests = [];
    report.browserErrors = errors;
    report.pageDiagnostics = [];
    const setupPage = async (page, canvasId = 'history-canvas') => {
      page.on('pageerror', error => errors.push(error.message));
      const diagnostic = item => {
        if (report.pageDiagnostics.length < 80) report.pageDiagnostics.push({ canvasId, ...item });
      };
      page.on('crash', () => diagnostic({ event: 'page-crash' }));
      page.on('requestfailed', request => diagnostic({ event: 'request-failed', path: new URL(request.url()).pathname, failure: request.failure()?.errorText }));
      page.on('response', response => { if (response.status() >= 400 && !response.url().includes('/api/')) diagnostic({ event: 'module-response', status: response.status(), path: new URL(response.url()).pathname }); });
      page.on('response', response => { if (response.status() >= 400 && response.url().includes('/api/')) failedRequests.push(new URL(response.url()).pathname); });
      await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
      await page.goto(`${origin}/__history_canvas?canvas=${canvasId}`, { waitUntil: 'commit' });
      await page.locator('.react-flow__node').first().waitFor({ timeout: 120000 });
      assert.ok((await page.locator('.t8-canvas-shell').boundingBox()).height >= 800, 'real Canvas must occupy the viewport, not a clipped fixture');
      // A ReactFlow node may still be the Suspense placeholder. Fresh Vite
      // compilation and poster image loading share the same cold-start budget;
      // do not mistake a mounted placeholder for the completed Canvas surface.
      await page.locator('.t8-startup-poster__close').waitFor({ timeout: 120000 });
      await page.locator('.t8-startup-poster__close').click();
      await page.locator('.t8-canvas-toolbar button').filter({ has: page.locator('svg.lucide-history') }).click();
      await page.getByRole('button', { name: '找回本地文件', exact: true }).waitFor();
    };
    await require('./generation-history-run-browser.cjs')({ page, browser, setupPage, closePage, start, stop, origin, artifacts, report });
    await require('./generation-history-image-video-browser.cjs')({ browser, setupPage, closePage, start, stop, origin, artifacts, report });
    await require('./generation-history-electron-close.cjs')({ temporary, setupPage, start, stop, origin, artifacts, report });
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await setupPage(page);
    const sharp = require('sharp');
    const red = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#e53935' } }).png().toBuffer();
    const blue = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#1565c0' } }).png().toBuffer();
    const selectFiles = async files => { await page.locator('input[aria-label="选择要找回的旧文件"]').setInputFiles(files); await page.getByRole('button', { name: '确认找回', exact: true }).click(); };
    await selectFiles([{ name: 'old-red.png', mimeType: 'image/png', buffer: red }, { name: 'old-blue.png', mimeType: 'image/png', buffer: blue }]);
    await page.getByText('已找回 2 个，已在历史中 0 个。', { exact: true }).waitFor({ timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-history-group]').length === 2);
    let acknowledgementDropped = false;
    await page.route('**/api/canvas/history-canvas/patches', async route => {
      if (!acknowledgementDropped && route.request().method() === 'POST') {
        const committed = await route.fetch(); assert.equal(committed.status(), 200);
        acknowledgementDropped = true; await route.abort(); return;
      }
      await route.continue();
    });
    await page.getByRole('button', { name: '放到画布', exact: true }).first().click();
    await page.locator('[data-history-group]').first().getByRole('alert').waitFor();
    await page.getByRole('button', { name: '放到画布', exact: true }).first().click();
    await page.getByRole('button', { name: '已放到画布', exact: true }).waitFor({ timeout: 30000 });
    const saved = (await (await fetch(`${origin}/api/canvas/history-canvas`)).json()).data;
    const placed = saved.nodes.filter(node => node.data?.historyPlacement);
    assert.equal(placed.length, 1); assert.equal(saved.edges.length, 0);
    assert.equal(saved.nodes.find(node => node.id === 'source').data.text, 'Original canvas content must survive');
    assert.ok(placed[0].data.historyAssetRef.contentHash);
    assert.ok(placed[0].data.historyAssetRef.entityUid);
    const frozenUrl = new URL(placed[0].data.imageUrl, origin);
    assert.equal(frozenUrl.searchParams.get('contentHash'), placed[0].data.historyAssetRef.contentHash);
    assert.equal(frozenUrl.searchParams.get('entityUid'), placed[0].data.historyAssetRef.entityUid);
    assert.ok(frozenUrl.searchParams.get('projectId'));
    assert.equal((placed[0].data.unverifiedIdentityReferences || []).some(item => item.field === 'sourceAssetId'), false);
    assert.equal(acknowledgementDropped, true);
    await page.screenshot({ path: path.join(artifacts, 'placed.png') });
    report.cases.push('explicit-file-recovery-and-real-Canvas-persisted-placement', 'lost-commit-response-retry-does-not-duplicate-node');
    await selectFiles([{ name: 'renamed-red.png', mimeType: 'image/png', buffer: red }]);
    await page.getByText('已找回 0 个，已在历史中 1 个。', { exact: true }).waitFor();
    await closePage(page); await stop(); await start();
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await setupPage(page);
    await page.waitForFunction(() => document.querySelectorAll('[data-history-group]').length === 2);
    const reopened = (await (await fetch(`${origin}/api/canvas/history-canvas`)).json()).data;
    // ReactFlow measures the visible node and assigns its display serial after
    // commit. Compare persisted identity/content/position, not rendering fields.
    const persistedIdentity = nodes => nodes.map(node => ({ id: node.id, entityUid: node.entityUid, type: node.type, position: node.position,
      historyAssetRef: node.data.historyAssetRef, imageUrl: node.data.imageUrl, imageUrls: node.data.imageUrls,
    }));
    assert.deepEqual(persistedIdentity(reopened.nodes.filter(node => node.data?.historyPlacement)), persistedIdentity(placed));
    const restoredImage = page.locator(`.react-flow__node[data-id="${placed[0].id}"] img`).first();
    await restoredImage.waitFor();
    await page.waitForFunction(id => { const image = document.querySelector(`.react-flow__node[data-id="${id}"] img`); return image && image.complete && image.naturalWidth > 0; }, placed[0].id);
    await page.screenshot({ path: path.join(artifacts, 'restarted.png') });
    report.cases.push('backend-process-restart-history-and-canvas-node-restored', 'renamed-file-content-deduplication');
    await closePage(page);
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await setupPage(page, 'identity-canvas');
    await page.waitForFunction(() => document.querySelectorAll('[data-history-group]').length === 3);
    assert.equal(await page.getByText(/来源节点已删除/).count(), 2);
    for (const summary of await page.locator('[data-history-group] details > summary').all()) await summary.click();
    assert.equal(await page.getByRole('button', { name: '定位来源节点', exact: true }).count(), 1);
    await page.getByRole('button', { name: '定位来源节点', exact: true }).click();
    const nodeHistoryButton = page.getByRole('button', { name: '历史 · 1 次', exact: true });
    await nodeHistoryButton.waitFor();
    const historyStyle = await nodeHistoryButton.evaluate(element => ({ foreground: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
    assert.equal(historyStyle.foreground, 'rgb(26, 20, 16)');
    assert.equal(historyStyle.background, 'rgb(255, 255, 255)');
    await nodeHistoryButton.click();
    await page.waitForFunction(() => document.querySelectorAll('[data-history-group]').length === 1);
    assert.match(await page.locator('[data-history-group]').innerText(), /new-1/);
    await page.screenshot({ path: path.join(artifacts, 'node-identity.png') });
    await page.getByRole('button', { name: '查看整个画布', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-history-group]').length === 3);
    report.cases.push('real-node-history-count-and-source-focus-isolate-same-display-id-replacement');
    const currentGroup = page.locator('[data-history-group]').filter({ hasText: 'new-1' });
    const generatorBefore = (await (await fetch(`${origin}/api/canvas/identity-canvas`)).json()).data;
    const settingsRequests = [];
    const observeSettingsRequest = request => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) settingsRequests.push({ method: request.method(), path: new URL(request.url()).pathname });
    };
    page.on('request', observeSettingsRequest);
    const runsBeforeSettings = (await (await fetch(`${origin}/api/project-runs?projectId=history-project&canvasId=identity-canvas`)).json()).data.map(run => run.id).sort();
    await currentGroup.locator('details > summary').first().click();
    await currentGroup.getByRole('button', { name: '填回提示词与参数', exact: true }).click();
    const settingsDialog = page.getByRole('dialog', { name: '确认填回历史设置', exact: true });
    await settingsDialog.waitFor();
    await settingsDialog.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal((await (await fetch(`${origin}/api/canvas/identity-canvas`)).json()).data.nodes[0].data.prompt, generatorBefore.nodes[0].data.prompt);
    await currentGroup.getByRole('button', { name: '填回提示词与参数', exact: true }).click();
    await settingsDialog.waitFor();
    assert.equal(await settingsDialog.getByRole('button', { name: '确认填回，不生成', exact: true }).isEnabled(), false);
    await settingsDialog.getByRole('checkbox').check();
    await page.screenshot({ path: path.join(artifacts, 'settings-review.png') });
    let settingsAcknowledgementDropped = false;
    await page.route('**/api/canvas/identity-canvas/patches', async route => {
      if (!settingsAcknowledgementDropped && route.request().method() === 'POST') {
        const committed = await route.fetch(); assert.equal(committed.status(), 200);
        settingsAcknowledgementDropped = true; await route.abort(); return;
      }
      await route.continue();
    });
    await settingsDialog.getByRole('button', { name: '确认填回，不生成', exact: true }).click();
    await settingsDialog.getByRole('alert').waitFor();
    await settingsDialog.getByRole('button', { name: '确认填回，不生成', exact: true }).click();
    await settingsDialog.waitFor({ state: 'hidden', timeout: 30000 });
    const generatorSaved = (await (await fetch(`${origin}/api/canvas/identity-canvas`)).json()).data;
    assert.equal(generatorSaved.nodes[0].data.prompt, 'new-1');
    assert.equal(generatorSaved.nodes[0].data.duration, 10);
    assert.deepEqual(generatorSaved.edges, generatorBefore.edges);
    assert.equal(generatorSaved.nodes.length, generatorBefore.nodes.length);
    assert.equal(generatorSaved.nodes[0].data.runTrigger, generatorBefore.nodes[0].data.runTrigger);
    assert.equal(settingsAcknowledgementDropped, true);
    assert.deepEqual(generatorSaved.nodes[0].data.localRefImages, generatorBefore.nodes[0].data.localRefImages);
    assert.equal((await (await fetch(`${origin}/api/project-runs/generation-history?projectId=history-project&canvasId=identity-canvas`)).json()).data.total, 3);
    assert.deepEqual((await (await fetch(`${origin}/api/project-runs?projectId=history-project&canvasId=identity-canvas`)).json()).data.map(run => run.id).sort(), runsBeforeSettings);
    page.off('request', observeSettingsRequest);
    assert.ok(settingsRequests.length > 0);
    assert.ok(settingsRequests.every(request => /^\/api\/canvas\/identity-canvas(?:\/(?:patches(?:\/preview)?|auto-save))?$/.test(request.path)), JSON.stringify(settingsRequests));
    report.settingsMutationRequests = settingsRequests;
    await closePage(page); await stop(); await start();
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await setupPage(page, 'identity-canvas');
    const generatorReopened = (await (await fetch(`${origin}/api/canvas/identity-canvas`)).json()).data;
    assert.equal(generatorReopened.nodes[0].data.prompt, 'new-1'); assert.equal(generatorReopened.nodes[0].data.duration, 10);
    report.cases.push('settings-review-cancel-reference-acknowledgement-lost-response-and-prefill-persist-without-generation-after-process-restart');
    await closePage(page);
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await setupPage(page, 'input-draft-canvas');
    await page.waitForFunction(() => document.querySelectorAll('[data-history-group]').length === 1);
    const inputCard = page.locator('[data-history-group]');
    assert.ok((await inputCard.innerText()).includes('来源节点已删除'));
    await inputCard.locator('details > summary').first().click();
    const inputMutations = [];
    page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) inputMutations.push({ method: request.method(), path: new URL(request.url()).pathname }); });
    const inputRunsBefore = (await (await fetch(`${origin}/api/project-runs?projectId=history-project&canvasId=input-draft-canvas`)).json()).data.map(run => run.id).sort();
    await inputCard.getByRole('button', { name: '新建历史输入草稿', exact: true }).click();
    const inputDialog = page.getByRole('dialog', { name: '确认新建历史输入草稿', exact: true });
    await inputDialog.waitFor();
    await inputDialog.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal((await (await fetch(`${origin}/api/canvas/input-draft-canvas`)).json()).data.nodes.length, 1);
    await inputCard.getByRole('button', { name: '新建历史输入草稿', exact: true }).click();
    await inputDialog.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.is-new-input .t8-history-input-references img')].length === 2
      && [...document.querySelectorAll('.is-new-input .t8-history-input-references img')].every(image => image.complete && image.naturalWidth > 0));
    await page.screenshot({ path: path.join(artifacts, 'input-draft-review.png') });
    let inputAckDropped = false; const inputPatchIds = [];
    await page.route('**/api/canvas/input-draft-canvas/patches', async route => {
      if (route.request().method() === 'POST') {
        inputPatchIds.push(route.request().postDataJSON().patch.id);
        if (!inputAckDropped) { const committed = await route.fetch(); assert.equal(committed.status(), 200); inputAckDropped = true; await route.abort(); return; }
      }
      await route.continue();
    });
    await inputDialog.getByRole('button', { name: '确认新建，不生成', exact: true }).click();
    await inputDialog.getByRole('alert').waitFor();
    // Closing/reopening an uncertain confirmation must retain the same patch.
    await inputDialog.getByRole('button', { name: '取消', exact: true }).click();
    await inputCard.getByRole('button', { name: '新建历史输入草稿', exact: true }).click();
    await inputDialog.waitFor();
    await inputDialog.getByRole('button', { name: '确认新建，不生成', exact: true }).click();
    await inputDialog.waitFor({ state: 'hidden', timeout: 30000 });
    const inputSaved = (await (await fetch(`${origin}/api/canvas/input-draft-canvas`)).json()).data;
    const restoredInputs = inputSaved.nodes.filter(node => node.data?.historyInputDraft);
    assert.equal(restoredInputs.length, 1); assert.equal(inputSaved.nodes.length, 2); assert.equal(inputSaved.edges.length, 0);
    assert.equal(inputSaved.nodes.find(node => node.id === 'keep').data.text, 'Keep this current node unchanged');
    assert.equal(restoredInputs[0].data.prompt, 'Historical upstream prompt with @image2');
    assert.equal(restoredInputs[0].data.duration, 10); assert.equal(restoredInputs[0].data.localRefImages.length, 2);
    assert.equal(restoredInputs[0].data.promptMentions[0].url, restoredInputs[0].data.localRefImages[1]);
    assert.equal(restoredInputs[0].data.runTrigger, undefined); assert.equal(restoredInputs[0].data.videoUrl, undefined);
    assert.equal(inputPatchIds.length, 2); assert.equal(inputPatchIds[0], inputPatchIds[1]);
    assert.deepEqual((await (await fetch(`${origin}/api/project-runs?projectId=history-project&canvasId=input-draft-canvas`)).json()).data.map(run => run.id).sort(), inputRunsBefore);
    assert.ok(inputMutations.every(request => /^\/api\/canvas\/input-draft-canvas(?:\/(?:patches(?:\/preview)?|auto-save))?$/.test(request.path)), JSON.stringify(inputMutations));
    report.inputDraftMutationRequests = inputMutations;
    await closePage(page); await stop(); await start();
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await setupPage(page, 'input-draft-canvas');
    const inputReopened = (await (await fetch(`${origin}/api/canvas/input-draft-canvas`)).json()).data.nodes.find(node => node.data?.historyInputDraft);
    for (const key of ['prompt', 'duration', 'localRefImages', 'promptMentions', 'historyInputDraft']) assert.deepEqual(inputReopened.data[key], restoredInputs[0].data[key]);
    for (const url of inputReopened.data.localRefImages) assert.equal((await fetch(`${origin}${url}`, { method: 'HEAD' })).status, 200);
    // Verify actual reference bytes/order, not just count and HTTP availability.
    for (const [index, expected] of [blue, red].entries()) {
      const response = await fetch(`${origin}${inputReopened.data.localRefImages[index]}`);
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
    }
    await page.waitForFunction(() => document.querySelectorAll('[data-history-group]').length === 1);
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll('.react-flow__node-seedance img')];
      return images.length >= 2 && images.every(image => image.complete && image.naturalWidth > 0);
    });
    await page.screenshot({ path: path.join(artifacts, 'input-draft-restarted.png') });
    report.cases.push('deleted-source-input-draft-keeps-upstream-prompt-reference-order-mentions-and-same-patch-after-reopen-and-process-restart-without-generation');
    const replacement = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Reference replacement fixture timed out')), 30000);
      child.once('message', message => { clearTimeout(timer); resolve(message); }); child.send('replace-input-reference');
    });
    assert.equal(replacement.replaced, true, replacement.error);
    const referenceWrites = [];
    page.on('request', request => { if (request.method() === 'POST') referenceWrites.push(new URL(request.url()).pathname); });
    await page.getByText('生成信息', { exact: true }).click();
    await page.getByRole('button', { name: '新建历史输入草稿', exact: true }).click();
    const referencePicker = page.getByLabel('选择图片 1的原文件', { exact: true });
    await referencePicker.waitFor({ state: 'attached' });
    assert.equal((await (await fetch(`${origin}/api/canvas/input-draft-canvas`)).json()).data.nodes.length, 2);
    await referencePicker.setInputFiles({ name: 'wrong-original.png', mimeType: 'image/png', buffer: red });
    await page.getByRole('button', { name: '确认找回此参考', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '与当时的参考内容不一致' }).waitFor();
    await page.screenshot({ path: path.join(artifacts, 'reference-recovery-wrong-file.png') });
    let referenceResponseDropped = false;
    await page.route('**/api/project-runs/generation-history/recover?*', async route => {
      if (!referenceResponseDropped && route.request().method() === 'POST') {
        const response = await route.fetch(); assert.equal(response.status(), 201);
        referenceResponseDropped = true; await route.abort(); return;
      }
      await route.continue();
    });
    await referencePicker.setInputFiles({ name: 'renamed-original-blue.png', mimeType: 'image/png', buffer: blue });
    await page.getByRole('button', { name: '确认找回此参考', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(referenceResponseDropped, true);
    await page.getByRole('button', { name: '确认找回此参考', exact: true }).click();
    await page.getByRole('dialog', { name: '确认新建历史输入草稿' }).waitFor();
    assert.equal((await (await fetch(`${origin}/api/canvas/input-draft-canvas`)).json()).data.nodes.length, 2, 'recovering input alone must not add a node');
    await page.getByRole('button', { name: '确认新建，不生成', exact: true }).click();
    await page.getByText('已新建并保存输入草稿，尚未生成。', { exact: true }).waitFor();
    const recoveryDocument = (await (await fetch(`${origin}/api/canvas/input-draft-canvas`)).json()).data;
    const newInput = recoveryDocument.nodes.find(node => node.data?.historyInputDraft && node.id !== inputReopened.id);
    assert.ok(newInput); assert.equal(recoveryDocument.nodes.length, 3);
    assert.notEqual(newInput.data.localRefImages[0], inputReopened.data.localRefImages[0]);
    assert.equal((await (await fetch(`${origin}/api/project-assets/${encodeURIComponent(replacement.assetId)}`)).json()).data.contentHash, replacement.newHash);
    assert.ok(referenceWrites.every(url => url === '/api/project-runs/generation-history/recover' || /^\/api\/canvas\/input-draft-canvas(?:\/(?:patches(?:\/preview)?|auto-save))?$/.test(url)), JSON.stringify(referenceWrites));
    await closePage(page); await stop(); await start();
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); await setupPage(page, 'input-draft-canvas');
    await page.waitForFunction(() => document.querySelectorAll('[data-history-group]').length === 1);
    const recoveredAgain = (await (await fetch(`${origin}/api/canvas/input-draft-canvas`)).json()).data.nodes.find(node => node.id === newInput.id);
    assert.deepEqual(recoveredAgain.data.localRefImages, newInput.data.localRefImages);
    for (const [index, expected] of [blue, red].entries()) assert.deepEqual(Buffer.from(await (await fetch(`${origin}${recoveredAgain.data.localRefImages[index]}`)).arrayBuffer()), expected);
    await page.getByText('生成信息', { exact: true }).click();
    await page.getByRole('button', { name: '新建历史输入草稿', exact: true }).click();
    await page.getByRole('dialog', { name: '确认新建历史输入草稿' }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.t8-history-input-references img')].every(img => img.complete && img.naturalWidth > 0));
    await page.screenshot({ path: path.join(artifacts, 'reference-recovery-restarted.png') });
    assert.deepEqual((await (await fetch(`${origin}/api/project-runs?projectId=history-project&canvasId=input-draft-canvas`)).json()).data.map(run => run.id).sort(), inputRunsBefore);
    report.cases.push('explicit-reference-recovery-rejects-wrong-file-retries-lost-response-preserves-new-version-and-persists-exact-old-byte-mapping-after-process-restart-without-extra-history-or-generation');
    await closePage(page); page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); await setupPage(page, 'resolved-input-canvas');
    await page.locator('.t8-history-prompt').filter({ hasText: 'Historical effective prompt' }).waitFor();
    await page.getByText('生成信息', { exact: true }).click();
    await page.getByRole('button', { name: '新建历史输入草稿', exact: true }).click();
    const resolvedDialog = page.getByRole('dialog', { name: '确认新建历史输入草稿' }); await resolvedDialog.waitFor();
    await resolvedDialog.getByText(/已记录前端提交时的参数/).waitFor();
    await resolvedDialog.locator('summary').filter({ hasText: '查看其他参数' }).click();
    await resolvedDialog.getByText('提交时的附加参数（不含凭据）', { exact: true }).waitFor();
    await resolvedDialog.locator('summary').filter({ hasText: '查看其他参数' }).click();
    await page.screenshot({ path: path.join(artifacts, 'resolved-input-review.png') });
    await page.getByRole('button', { name: '确认新建，不生成', exact: true }).click();
    await page.getByText('已新建并保存输入草稿，尚未生成。', { exact: true }).waitFor();
    const resolvedSaved = (await (await fetch(`${origin}/api/canvas/resolved-input-canvas`)).json()).data.nodes.find(node => node.data?.historyInputDraft);
    assert.equal(resolvedSaved.data.prompt, 'Historical effective prompt'); assert.equal(resolvedSaved.data.duration, 7);
    assert.equal(resolvedSaved.data.resolution, '720p'); assert.equal(resolvedSaved.data.ratio, '9:16'); assert.equal(resolvedSaved.data.seed, 88);
    assert.equal(resolvedSaved.data.returnLastFrame, true); assert.deepEqual(resolvedSaved.data.providerParams, { motion: 0.25 });
    await closePage(page); await stop(); await start();
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); await setupPage(page, 'resolved-input-canvas');
    const resolvedReopened = (await (await fetch(`${origin}/api/canvas/resolved-input-canvas`)).json()).data.nodes.find(node => node.id === resolvedSaved.id);
    for (const key of ['model', 'prompt', 'duration', 'resolution', 'ratio', 'seed', 'returnLastFrame', 'providerParams']) assert.deepEqual(resolvedReopened.data[key], resolvedSaved.data[key]);
    assert.deepEqual((await (await fetch(`${origin}/api/project-runs?projectId=history-project&canvasId=resolved-input-canvas`)).json()).data.map(run => run.id), ['resolved-input-run']);
    await page.waitForFunction(() => document.querySelectorAll('[data-history-group]').length === 1);
    await page.screenshot({ path: path.join(artifacts, 'resolved-input-restarted.png') });
    report.cases.push('archived-frontend-resolved-parameters-not-raw-missing-defaults-confirmed-saved-and-restored-after-process-restart-without-generation');
    assert.deepEqual(errors, []);
    report.peripheralFailedRequests = [...new Set(failedRequests)]; report.passed = true;
  } catch (error) {
    report.failure = error.message;
    const page = browser?.contexts().at(-1)?.pages().at(-1);
    if (page) {
      report.body = (await page.locator('body').innerText().catch(() => '')).slice(0, 2500);
      report.documentState = await page.evaluate(() => ({ readyState: document.readyState, path: location.pathname,
        rootPresent: !!document.getElementById('root'), childCount: document.getElementById('root')?.childElementCount,
        scripts: [...document.scripts].map(script => new URL(script.src, location.href).pathname) })).catch(() => null);
      await page.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {});
    }
    throw error;
  } finally {
    const cleanupErrors = await cleanupVerificationResources([
      ['pages', async () => { for (const context of browser?.contexts() || []) for (const page of context.pages()) await closePage(page); }],
      ['browser', async () => { await browser?.close(); }],
      ['frontend', async () => { await server?.close(); }],
      ['backend', stop],
      ['temporary-data', async () => {
        assert.ok(!child || child.exitCode !== null, 'Do not delete temporary data while its backend is still alive');
        const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(temporary));
        assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative)); fs.rmSync(temporary, { recursive: true, force: true });
      }],
    ]);
    if (cleanupErrors.length) { report.passed = false; report.cleanupErrors = cleanupErrors; }
    writeReport(); console.log(JSON.stringify(report));
    process.off('uncaughtExceptionMonitor', recordFatal);
    if (cleanupErrors.length) throw new Error(`History verifier cleanup failed: ${cleanupErrors.map(item => item.resource).join(', ')}`);
  }
}
module.exports = { cleanupVerificationResources };
if (require.main === module) (process.argv.includes('--backend') ? backend() : main()).catch(error => { console.error(error); process.exitCode = 1; });
