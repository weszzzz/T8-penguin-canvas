'use strict';
// Full development main + Vite config/App + in-process production backend.
// Only environment, storage locations and external-network access are isolated;
// no app.isPackaged override, copied lifecycle hook or replacement shutdown.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { withDeadline, withNativeRendererGuard, exitIsolatedTestMain } = require('./history-acceptance-safety.cjs');
const { prepareSerialHistoryWarmup, coldHistoryFileWatcherPlugin } = require('./history-serial-warmup.cjs');
const { ELECTRON_HEAP_FLAG, inspectHistoryMemoryBudget } = require('./history-low-load-memory.cjs');
const { startHistoryVerifierDiagnostics } = require('./history-verifier-diagnostics.cjs');
const ROOT = path.resolve(__dirname, '..');
const tick = ms => new Promise(resolve => setTimeout(resolve, ms));
async function port() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve)); return value;
}
async function listening(portNumber) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port: portNumber });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => finish(true)); socket.once('error', () => finish(false));
    socket.setTimeout(2000, () => finish(false));
  });
}
async function main() {
  if (process.platform === 'win32' && process.env.T8_ACCEPTANCE_LOW_LOAD !== '1') {
    throw new Error('Use scripts/run-history-low-load.ps1 -Mode FullHistory; unrestricted acceptance is disabled.');
  }
  const memoryBudget = process.env.T8_ACCEPTANCE_LOW_LOAD === '1' ? inspectHistoryMemoryBudget() : null;
  const { _electron } = require('playwright');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 't8-full-electron-'));
  const artifacts = path.join(ROOT, 'artifacts/generation-history-full-electron', new Date().toISOString().replace(/[:.]/g, '-')); fs.mkdirSync(artifacts, { recursive: true });
  const report = { startedAt: new Date().toISOString(), passed: false, cases: [], errors: [],
    scope: 'full-development-main-App-backend-isolated-data-no-private-extensions-or-Figma', providerCalls: 0, installed: false };
  report.resourceMode = { runner: 'run-history-low-load.ps1', cpuHardCapPercent: 10, jobCommitLimitMB: 4096,
    softwareRendering: process.env.T8_ACCEPTANCE_SOFTWARE_RENDERING === '1', automaticRetries: 0 };
  // The outer runner records child exit and Job peaks even when this process
  // cannot finish its own report. Neither receipt alone proves acceptance.
  report.runnerReceipt = process.env.T8_ACCEPTANCE_RUNNER_RECEIPT || null;
  report.memoryBudget = memoryBudget;
  const writeReport = () => fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2), { flush: true });
  const rendererEventsFile = path.join(artifacts, 'renderer-exits.jsonl');
  const guardRenderer = action => withNativeRendererGuard(() => {
    if (!fs.existsSync(rendererEventsFile)) return [];
    assert.ok(fs.statSync(rendererEventsFile).size <= 16384, 'Native renderer diagnostic exceeded its bounded record size');
    return fs.readFileSync(rendererEventsFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  }, action);
  const crashedPages = new WeakSet();
  const pendingModules = new Map();
  report.moduleTransport = { pending: [], failures: [], completed: 0 };
  report.pageCrashes = 0;
  let diagnostics;
  const snapshotModules = () => { report.moduleTransport.pending = [...pendingModules.values()].slice(-64); };
  const checkpoint = stage => { diagnostics?.checkpoint(stage); report.stage = stage; snapshotModules(); writeReport(); console.log(stage); };
  writeReport();
  const authorityFile = path.join(ROOT, '.t8-collaboration-management-authority.json');
  assert.ok(fs.existsSync(authorityFile), 'Do not create shared development authority during isolated acceptance');
  const authorityHash = () => crypto.createHash('sha256').update(fs.readFileSync(authorityFile)).digest('hex');
  const priorAuthorityHash = authorityHash(); // Never log token or digest.
  const dataRoot = path.join(temporary, 'user-data');
  const backendPort = await port(), collabPort = await port();
  assert.notEqual(backendPort, collabPort);
  for (const name of ['data', 'save', 'canvases', 'resources', 'themes', 'temp', 'registry']) fs.mkdirSync(path.join(dataRoot, name), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, 'data/settings.json'), JSON.stringify({
    fileSavePath: path.join(dataRoot, 'save'), canvasAutoSavePath: path.join(dataRoot, 'canvases'),
    resourceLibraryPath: path.join(dataRoot, 'resources'), themeTemplatePath: path.join(dataRoot, 'themes'),
    preferences: { uiLocale: 'zh-CN' },
  }));
  process.env.T8PC_DEV_BACKEND_ORIGIN = `http://127.0.0.1:${backendPort}`;
  process.env.T8_ENABLE_LOCAL_PRIVATE = '0';
  let server, application, page;
  const closed = new WeakSet();
  const backendOrigin = `http://127.0.0.1:${backendPort}`;
  const read = async (url, init) => {
    const response = await fetch(`${backendOrigin}${url}`, init);
    assert.equal(response.status, 200, url); const body = await response.json();
    assert.equal(body.success, true, url); return body.data;
  };
  const until = async (check, label, timeout = 120000) => {
    const deadline = Date.now() + timeout;
    do { if (await check()) return; await tick(100); } while (Date.now() < deadline);
    throw new Error(label);
  };
  const quit = async () => {
    const owned = application;
    const closing = owned.waitForEvent('close', { timeout: 30000 }); void closing.catch(() => {});
    await withDeadline(() => owned.evaluate(({ app }) => { setTimeout(() => app.quit(), 0); }), 5000, 'dispatch owned app.quit');
    await closing; assert.equal(await listening(backendPort), false, 'real backend port closes with app');
    assert.equal(fs.readdirSync(path.join(dataRoot, 'registry')).filter(name => name.endsWith('.json')).length, 0, 'real backend unregisters its Agent instance');
    application = null;
  };
  try {
    diagnostics = startHistoryVerifierDiagnostics({ write: json => fs.writeFileSync(path.join(artifacts, 'verifier-diagnostics.json'), json, { flush: true }) });
    const { createServer } = await import('vite');
    const providerBoundary = require('./history-controlled-provider.cjs').createControlledProviderBoundary();
    report.controlledProviderErrors = providerBoundary.errors;
    // Keep dependencies under node_modules, as in normal Vite development, so
    // React's source transform does not recompile optimized vendor bundles.
    server = await createServer({ root: ROOT, configFile: path.join(ROOT, 'vite.config.ts'), cacheDir: path.join(temporary, 'node_modules/.vite'),
      plugins: [coldHistoryFileWatcherPlugin(), { name: 'owned-history-provider-boundary', configureServer(vite) { vite.middlewares.use(providerBoundary.middleware); } }],
      optimizeDeps: { entries: ['index.html'] },
      // Test-only scheduling: serve imported modules on demand, without Vite's
      // recursive speculative transform fan-out. No application config change.
      // No source edits occur during a persistence acceptance run. Disabling
      // HMR lets the installed React plugin skip its Fast Refresh Babel pass;
      // JSX still uses Vite's development transform, not production semantics.
      // hmr:false does not stop Chokidar recursively watching ROOT, including
      // local runtimes/artifacts. Cold acceptance does not edit sources; keep
      // dependency discovery and all source transforms, disable only watching.
      server: { host: '127.0.0.1', port: 0, strictPort: false, preTransformRequests: false, hmr: false, watch: null } });
    assert.equal(server.config.server.hmr, false);
    assert.equal(server.config.server.watch, null);
    assert.deepEqual(server.watcher.getWatched(), {});
    assert.equal(server.config.isProduction, false, 'Keep development React semantics');
    const reactBabel = server.config.plugins.find(plugin => plugin.name === 'vite:react-babel');
    assert.ok(reactBabel, 'Expected installed React plugin');
    assert.equal(reactBabel.transform, undefined, 'Cold acceptance must not retain Fast Refresh Babel transforms');
    const warmup = prepareSerialHistoryWarmup(server);
    report.warmupScheduling = { mode: 'serial-explicit-files', files: warmup.urls, preTransformRequests: false, hmr: false, reactFastRefresh: false, fileWatching: false };
    await server.listen(); const frontendOrigin = `http://127.0.0.1:${server.httpServer.address().port}`;
    checkpoint('warming-development-server');
    let warmupTimer;
    try {
      await Promise.race([
        warmup.run(checkpoint),
        new Promise((_, reject) => { warmupTimer = setTimeout(() => reject(new Error('Development warmup exceeded 180 seconds')), 180000); }),
      ]);
    } finally { clearTimeout(warmupTimer); }
    report.developmentServerPrewarmed = true;
    assert.deepEqual(server.watcher.getWatched(), {}, 'Cold acceptance must not accumulate filesystem watches');
    const entry = path.join(temporary, 'full-main.cjs');
    fs.writeFileSync(entry, `const {app,session}=require('electron');
      require(${JSON.stringify(path.join(ROOT, 'scripts/history-acceptance-safety.cjs'))}).installRendererExitRecorder(app,record=>require('node:fs').appendFileSync(${JSON.stringify(rendererEventsFile)},JSON.stringify(record)+'\\n'));
      if(process.env.T8_ACCEPTANCE_SOFTWARE_RENDERING==='1') app.disableHardwareAcceleration();
      app.setPath('userData',${JSON.stringify(dataRoot)}); app.setPath('sessionData',${JSON.stringify(dataRoot)});
      app.setPath('temp',${JSON.stringify(path.join(dataRoot, 'temp'))});
      app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest((details,done)=>{
        const url=new URL(details.url); const local=['http:','ws:'].includes(url.protocol)&&url.hostname==='127.0.0.1'
          &&${JSON.stringify([String(backendPort), String(collabPort), new URL(frontendOrigin).port])}.includes(url.port);
        done({cancel:!local&&!['file:','data:','blob:','devtools:'].includes(url.protocol)});
      }));
      if(process.env.T8_ACCEPTANCE_SCENARIO==='basic-settings') globalThis.seedOwnedBasicSettings=()=>require(${JSON.stringify(path.join(ROOT, 'scripts/history-basic-settings-seed.cjs'))})(${JSON.stringify(dataRoot)});
      if(['image-input-draft','budget-image-input-draft','fal-image-input-draft','banana-image-input-draft','video-input-draft','fal-video-input-draft'].includes(process.env.T8_ACCEPTANCE_SCENARIO)) globalThis.seedOwnedImageInput=()=>require(${JSON.stringify(path.join(ROOT, 'scripts/history-image-input-seed.cjs'))})(${JSON.stringify(dataRoot)});
      require(${JSON.stringify(path.join(ROOT, 'electron/main.cjs'))});`);
    const launch = async () => {
      checkpoint('launching-full-main');
      const env = { ...process.env, T8PC_DEV_DATA_ROOT: dataRoot, T8PC_DEV_SERVER_URL: frontendOrigin,
        T8PC_DEV_BACKEND_PORT: String(backendPort), T8_COLLAB_PORT: String(collabPort),
        ZCANVAS_INSTANCE_DIR: path.join(dataRoot, 'registry'), T8_FIGMA_BRIDGE_AUTOSTART: '0', T8_ENABLE_LOCAL_PRIVATE: '0' };
      delete env.ELECTRON_RUN_AS_NODE;
      // An explicit executablePath skips Playwright's default loader. Load it
      // explicitly so browser attachment precedes the real app ready handler.
      const playwrightLoader = path.join(path.dirname(require.resolve('playwright-core')), 'lib/server/electron/loader.js');
      application = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron.exe'),
        args: [...(memoryBudget ? [ELECTRON_HEAP_FLAG] : []), '-r', playwrightLoader, entry], env, timeout: 60000 });
      const owned = application; owned.on('close', () => closed.add(owned));
      if (memoryBudget) {
        const flags = await withDeadline(() => owned.evaluate(({ app }) => app.commandLine.getSwitchValue('js-flags')),
          5000, 'read owned Electron memory flags');
        assert.equal(flags, '--max-old-space-size=768', 'Electron must receive its startup heap budget');
        report.electronMemoryFlags = flags;
      }
      owned.context().setDefaultTimeout(15000);
      const watchedPages = new WeakSet();
      const watchPage = candidate => {
        if (watchedPages.has(candidate)) return; watchedPages.add(candidate);
        // Only local script paths and HTTP status; no queries, headers or bodies.
        candidate.on('request', request => {
          if (request.resourceType() !== 'script') return;
          const url = new URL(request.url());
          if (url.origin === frontendOrigin && pendingModules.size < 256)
            pendingModules.set(request, url.pathname.replace(/\/t8-history-low-load-[^/]+\/[^/]+/g, '/owned-fixture'));
        });
        candidate.on('requestfinished', request => {
          if (pendingModules.delete(request)) report.moduleTransport.completed++;
        });
        candidate.on('requestfailed', request => {
          const pathname = pendingModules.get(request);
          if (pathname && report.moduleTransport.failures.length < 32) report.moduleTransport.failures.push(pathname);
          pendingModules.delete(request);
        });
        candidate.on('pageerror', error => report.errors.push(error.message));
        candidate.on('crash', () => { crashedPages.add(candidate); report.pageCrashes++; writeReport(); });
      };
      owned.on('window', watchPage); owned.windows().forEach(watchPage);
      checkpoint('electron-connected');
      await until(() => {
        page = owned.windows().find(candidate => candidate.url().startsWith(frontendOrigin)); return !!page;
      }, 'full development frontend did not open');
      checkpoint('frontend-window-observed');
      // The startup poster can arrive after the first canvas-ready frame.
      // Dismiss through its actual button whenever it blocks a user action.
      await page.addLocatorHandler(page.locator('.t8-startup-poster__close'), async button => button.click());
      checkpoint('waiting-for-canvas');
      await until(async () => {
        if (page.url().startsWith('data:text/html')) throw new Error('Full main displayed its startup failure page');
        return page.locator('.t8-canvas-shell').isVisible();
      }, 'full App canvas did not become visible');
      checkpoint('reading-owned-app-info');
      const info = await page.evaluate(() => window.t8pc.getInfo());
      assert.equal(info.userData, dataRoot); assert.equal(info.backendPort, backendPort); assert.equal(info.packaged, false);
      checkpoint('canvas-visible');
      return page;
    };
    if (['image-input-draft', 'budget-image-input-draft', 'fal-image-input-draft', 'banana-image-input-draft', 'video-input-draft', 'fal-video-input-draft'].includes(process.env.T8_ACCEPTANCE_SCENARIO)) {
      report.scenario = `${process.env.T8_ACCEPTANCE_SCENARIO}-only`;
      await guardRenderer(launch); report.visibleNativeWindow = true;
      providerBoundary.setHandler(() => { throw new Error('No Provider call permitted during input restoration'); });
      const fixture = await guardRenderer(() => application.evaluate(() => globalThis.seedOwnedImageInput()));
      checkpoint(`owned-${fixture.nodeType}-input-history-seeded`);
      await guardRenderer(() => require('./history-image-input-full-main.cjs')({ fixture, getPage: () => page, read, until, origin: backendOrigin,
        restart: async () => { await quit(); await launch(); }, report, artifacts, checkpoint }));
      await quit(); assert.deepEqual(report.errors, []); assert.deepEqual(providerBoundary.errors, []); report.passed = true;
      return;
    }
    if (process.env.T8_ACCEPTANCE_SCENARIO === 'basic-settings') {
      report.scenario = 'basic-settings-only';
      await launch(); report.visibleNativeWindow = true;
      providerBoundary.setHandler(() => { throw new Error('No Provider call permitted during settings restoration'); });
      const fixtures = await application.evaluate(() => globalThis.seedOwnedBasicSettings());
      await require('./history-basic-settings-full-main.cjs')({ fixtures, getPage: () => page, read, until,
        restart: async () => { await quit(); await launch(); }, report, artifacts });
      await quit(); assert.deepEqual(report.errors, []); assert.deepEqual(providerBoundary.errors, []); report.passed = true;
      return;
    }
    if (process.env.T8_ACCEPTANCE_SCENARIO === 'generated-versions') {
      report.scenario = 'generated-versions-only';
      await launch(); report.visibleNativeWindow = true;
      await require('./generation-history-full-main-rerun.cjs')({ root: ROOT, dataRoot, artifacts, origin: backendOrigin,
        setProviderHandler: providerBoundary.setHandler,
        getPage: () => page, restart: async () => { await quit(); await launch(); }, read, until, report, checkpoint });
      await quit(); assert.deepEqual(report.errors, []); report.passed = true;
      return;
    }
    await launch(); report.cases.push('full-development-main-and-App-started-with-owned-database');
    report.visibleNativeWindow = true;
    checkpoint('creating-owned-canvas');
    const canvas = await read('/api/canvas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Full Electron save acceptance' }) });
    const initial = await read(`/api/canvas/${canvas.id}`);
    await read(`/api/canvas/${canvas.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'If-Match': `"${initial.revision}"` }, body: JSON.stringify({
      ...initial, nodes: [{ id: 'owned-text', type: 'text', position: { x: 100, y: 100 }, data: { prompt: 'Initial owned draft', text: 'Initial owned draft' } }], edges: [], viewport: { x: 200, y: 100, zoom: 1 },
    }) });
    await page.evaluate(id => localStorage.setItem('t8-canvas-active-id-v1', id), canvas.id); await page.reload({ waitUntil: 'commit' });
    checkpoint('opening-owned-text-node');
    const textbox = page.locator('.react-flow__node[data-id="owned-text"] [contenteditable="true"][role="textbox"]');
    await textbox.waitFor({ timeout: 120000 });
    checkpoint('editing-and-quitting');
    const draft = 'Saved by real full Electron app.quit, including 中文 and a new draft';
    let held;
    await page.route(`**/api/canvas/${canvas.id}`, route => {
      if (route.request().method() === 'PUT' && JSON.stringify(route.request().postDataJSON()).includes(draft)) {
        assert.equal(held, undefined); held = route; return;
      }
      return route.fallback();
    });
    await textbox.click(); await textbox.press('ControlOrMeta+A'); await textbox.fill(draft);
    await application.evaluate(({ app }) => app.quit());
    await until(() => !!held, 'real main app.quit did not flush draft', 15000);
    assert.equal(page.isClosed(), false); assert.equal(await listening(backendPort), true);
    assert.notEqual((await read(`/api/canvas/${canvas.id}`)).nodes[0].data.text, draft);
    const closing = application.waitForEvent('close', { timeout: 30000 }); void closing.catch(() => {});
    await held.continue(); await closing;
    assert.equal(await listening(backendPort), false); application = null;
    assert.equal(fs.readdirSync(path.join(dataRoot, 'registry')).filter(name => name.endsWith('.json')).length, 0);
    report.cases.push('real-shutdownBackendForElectron-awaits-save-closes-server-and-unregisters-instance');
    await launch();
    const restored = await read(`/api/canvas/${canvas.id}`);
    assert.equal(restored.nodes[0].data.text, draft);
    assert.equal(restored.nodes[0].data.prompt, draft);
    const restoredTextbox = page.locator('.react-flow__node[data-id="owned-text"] [contenteditable="true"][role="textbox"]');
    await restoredTextbox.waitFor({ timeout: 120000 });
    assert.equal(await restoredTextbox.innerText(), draft);
    await page.screenshot({ path: path.join(artifacts, 'full-main-restarted.png') });
    report.cases.push('same-userData-full-main-and-App-restart-retains-active-canvas-and-draft');
    checkpoint('recovering-owned-old-media');
    const sharp = require('sharp');
    const { spawnSync } = require('node:child_process');
    const oldFiles = path.join(temporary, 'old-files'); fs.mkdirSync(oldFiles);
    const imageFile = path.join(oldFiles, 'old-red.png');
    await sharp({ create: { width: 160, height: 90, channels: 3, background: '#e53935' } }).png().toFile(imageFile);
    const videoFile = path.join(oldFiles, 'old-blue.mp4');
    const encoded = spawnSync(path.join(ROOT, 'tools/ffmpeg-runtime/ffmpeg.exe'),
      ['-hide_banner', '-loglevel', 'error', '-filter_threads', '1', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10:d=2', '-an', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoFile],
      { windowsHide: true, timeout: 30000, encoding: 'utf8' });
    assert.equal(encoded.status, 0, encoded.stderr);
    const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
    const originals = [imageFile, videoFile].map(file => ({ file, hash: hash(fs.readFileSync(file)) }));
    const openHistory = async () => {
      await page.locator('.t8-canvas-toolbar button').filter({ has: page.locator('svg.lucide-history') }).click();
      await page.getByRole('button', { name: '找回本地文件', exact: true }).waitFor();
    };
    await openHistory();
    await page.locator('input[aria-label="选择要找回的旧文件"]').setInputFiles([imageFile, videoFile]);
    await page.getByRole('button', { name: '确认找回', exact: true }).click();
    await page.getByText('已找回 2 个，已在历史中 0 个。', { exact: true }).waitFor({ timeout: 30000 });
    await until(async () => await page.locator('[data-history-group]').count() === 2, 'two recovered media cards');
    const historyUrl = `/api/project-runs/generation-history?${new URLSearchParams({ projectId: restored.projectId, canvasId: canvas.id })}`;
    const recoveredHistory = await read(historyUrl);
    assert.equal(recoveredHistory.groups.length, 2);
    assert.ok(recoveredHistory.groups.every(group => group.recovered && !group.snapshotAvailable && !group.promptPreview));
    let lostAcknowledgement = false;
    await page.route(`**/api/canvas/${canvas.id}/patches`, async route => {
      if (!lostAcknowledgement && route.request().method() === 'POST') {
        const response = await route.fetch(); assert.equal(response.status(), 200);
        lostAcknowledgement = true; await route.abort(); return;
      }
      await route.continue();
    });
    const videoCard = page.locator('[data-history-group]').filter({ has: page.locator('video') });
    await videoCard.getByRole('button', { name: '放到画布', exact: true }).click();
    await videoCard.getByRole('alert').waitFor();
    await videoCard.getByRole('button', { name: '放到画布', exact: true }).click();
    await videoCard.getByRole('button', { name: '已放到画布', exact: true }).waitFor();
    const imageCard = page.locator('[data-history-group]').filter({ has: page.locator('.t8-history-image-open') });
    await imageCard.getByRole('button', { name: '放到画布', exact: true }).click();
    await imageCard.getByRole('button', { name: '已放到画布', exact: true }).waitFor();
    const beforeRestart = await read(`/api/canvas/${canvas.id}`);
    const placements = beforeRestart.nodes.filter(node => node.data?.historyPlacement);
    assert.equal(placements.length, 2); assert.equal(lostAcknowledgement, true);
    assert.equal(beforeRestart.nodes.find(node => node.id === 'owned-text').data.prompt, draft);
    await page.locator('input[aria-label="选择要找回的旧文件"]').setInputFiles({ name: 'renamed-old-blue.mp4', mimeType: 'video/mp4', buffer: fs.readFileSync(videoFile) });
    await page.getByRole('button', { name: '确认找回', exact: true }).click();
    await page.getByText('已找回 0 个，已在历史中 1 个。', { exact: true }).waitFor();
    report.cases.push('full-App-explicit-old-image-video-recovery-and-lost-ACK-placement-retry-without-duplicates');
    await page.unrouteAll({ behavior: 'wait' });
    await quit(); await launch(); await openHistory();
    await until(async () => await page.locator('[data-history-group]').count() === 2, 'recovered cards after full restart');
    const afterRestart = await read(`/api/canvas/${canvas.id}`);
    const identity = nodes => nodes.map(node => ({ id: node.id, entityUid: node.entityUid, type: node.type, position: node.position,
      ref: node.data.historyAssetRef, imageUrl: node.data.imageUrl, videoUrl: node.data.videoUrl })).sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(identity(afterRestart.nodes.filter(node => node.data?.historyPlacement)), identity(placements));
    assert.equal(afterRestart.nodes.find(node => node.id === 'owned-text').data.prompt, draft);
    const afterHistory = await read(historyUrl);
    assert.deepEqual(afterHistory.groups.map(group => group.id).sort(), recoveredHistory.groups.map(group => group.id).sort());
    const recoveredHashes = [];
    for (const output of afterHistory.groups.flatMap(group => group.outputs)) {
      const response = await fetch(new URL(output.mediaUrl, backendOrigin)); assert.equal(response.status, 200);
      recoveredHashes.push(hash(Buffer.from(await response.arrayBuffer())));
    }
    assert.deepEqual(recoveredHashes.sort(), originals.map(item => item.hash).sort());
    for (const original of originals) assert.equal(hash(fs.readFileSync(original.file)), original.hash, 'selected original remains unchanged');
    await page.locator('[data-history-group] .t8-history-image-open img').evaluate(image => image.decode());
    await page.locator('[data-history-group] video').evaluate(async video => { video.muted = true; await video.play(); });
    await until(async () => page.locator('[data-history-group] video').evaluate(video => video.currentTime > 0 && video.videoWidth === 160 && video.videoHeight === 90), 'recovered video actually plays');
    await page.screenshot({ path: path.join(artifacts, 'old-media-full-main-restarted.png') });
    report.cases.push('full-App-restart-retains-recovered-media-identities-original-bytes-image-decode-and-video-playback');
    await require('./generation-history-full-main-rerun.cjs')({ root: ROOT, dataRoot, artifacts, origin: backendOrigin,
      setProviderHandler: providerBoundary.setHandler,
      getPage: () => page, restart: async () => { await quit(); await launch(); }, read, until, report, checkpoint });
    await quit();
    assert.deepEqual(report.errors, []); report.passed = true;
  } catch (error) {
    snapshotModules();
    report.failure = error.message;
    report.windows = application && !closed.has(application) ? application.windows().map(candidate => candidate.url()) : [];
    writeReport();
    if (page && !page.isClosed() && !crashedPages.has(page)) {
      report.body = (await withDeadline(() => page.locator('body').innerText({ timeout: 2000 }), 2500, 'failure body').catch(() => '')).slice(0, 4000);
      await withDeadline(() => page.screenshot({ path: path.join(artifacts, 'failure.png'), timeout: 2000 }), 2500, 'failure screenshot').catch(() => {});
    }
    throw error;
  } finally {
    report.verifierDiagnostics = diagnostics?.stop() || { stopped: true, failed: true, recordedSampleCount: 0 };
    const cleanupErrors = [];
    if (application && !closed.has(application)) {
      try { if (page && !page.isClosed()) await withDeadline(() => page.unrouteAll({ behavior: 'ignoreErrors' }), 3000, 'remove verifier routes'); }
      catch (error) { cleanupErrors.push(`routes: ${error.message}`); }
      try { await quit(); }
      catch (error) {
        cleanupErrors.push(`Electron: ${error.message}`);
        // Failed acceptance only. Force-disposal is never a successful quit or
        // persistence receipt; keep the original cleanup error and fail report.
        const owned = application;
        if (owned && !closed.has(owned)) {
          report.forcedTestExitAttempted = true;
          const closing = owned.waitForEvent('close', { timeout: 10000 }); void closing.catch(() => {});
          try {
            // app.exit may close transport before evaluate acknowledges it.
            await withDeadline(() => owned.evaluate(exitIsolatedTestMain, dataRoot), 3000, 'failed owned test disposal').catch(() => {});
            await closing;
            assert.equal(await listening(backendPort), false, 'owned backend must stop before deleting fixture');
            closed.add(owned); application = null; report.closedAfterForcedExitAttempt = true;
          } catch (disposalError) { cleanupErrors.push(`forced test disposal: ${disposalError.message}`); }
        }
      }
    }
    try { await server?.close(); } catch (error) { cleanupErrors.push(`Vite: ${error.message}`); }
    try {
      assert.equal(authorityHash(), priorAuthorityHash, 'shared authority must remain unchanged');
      assert.ok(!application || closed.has(application), 'do not delete live application data');
      const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(temporary));
      assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
      fs.rmSync(temporary, { recursive: true, force: true });
    } catch (error) { cleanupErrors.push(`temporary data: ${error.message}`); }
    if (cleanupErrors.length) { report.passed = false; report.cleanupErrors = cleanupErrors; }
    if (fs.existsSync(rendererEventsFile)) {
      report.rendererExits = fs.readFileSync(rendererEventsFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      if (report.rendererExits.some(event => event.reason !== 'clean-exit')) report.passed = false;
    }
    if (report.pageCrashes) report.passed = false;
    if (report.verifierDiagnostics.failed) report.passed = false;
    writeReport(); console.log(JSON.stringify(report));
    if (report.verifierDiagnostics.failed) throw new Error('Verifier diagnostics incomplete; acceptance did not pass.');
    if (cleanupErrors.length) throw new Error('Full Electron cleanup incomplete; inspect owned process before retry');
    if (report.pageCrashes || report.rendererExits?.some(event => event.reason !== 'clean-exit'))
      throw new Error('Native renderer failure observed; acceptance did not pass.');
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
