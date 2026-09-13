'use strict';
// Real Electron window + production preload/close gate/Canvas and CAS routes.
// Isolated shell only: not the packaged bootstrap, updater, or OS power loss.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ temporary, setupPage, start, stop, origin, artifacts, report }) => {
  const { _electron } = require('playwright');
  const root = path.resolve(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
  const begin = main.indexOf('function createCanvasCloseGate(window) {');
  const end = main.indexOf('\nlet vibeXRhLoginWindow', begin);
  assert.ok(begin > 0 && end > begin);
  const quitBegin = main.indexOf("app.on('before-quit', (event) => {");
  assert.ok(quitBegin > end && main.slice(quitBegin).trim().endsWith('});'));
  const entry = path.join(temporary, 'close-shell.cjs');
  fs.writeFileSync(entry, `const {app,BrowserWindow,ipcMain,dialog}=require('electron');
    const crypto=require('node:crypto');
    const {electronT}=require(${JSON.stringify(path.join(root, 'electron/i18n.cjs'))});
    app.setPath('userData',process.env.T8_CLOSE_PROFILE);
    app.setPath('sessionData',process.env.T8_CLOSE_PROFILE);
    app.commandLine.appendSwitch('disable-gpu');
    ${main.slice(begin, end)}
    let mainWindowCloseGate=null;
    if(process.env.T8_CLOSE_QUIT==='1') {
      let electronQuitRequested=false, electronQuitReady=false, electronQuitFinalizationPromise=null;
      const ELECTRON_SINGLE_INSTANCE_OWNER=true;
      const dbgLog=message=>console.error(message);
      globalThis.__quitBackendRequest=null;
      const shutdownBackendForElectron=reason=>new Promise(resolve=>{
        globalThis.__quitBackendRequest={reason}; globalThis.__releaseQuitBackend=resolve;
      });
      ${main.slice(quitBegin)}
    }
    ipcMain.handle('t8pc:get-info',()=>({version:'3.1.5',isPackaged:false,backendUrl:${JSON.stringify(origin)}}));
    ipcMain.handle('t8pc:locale:get',()=>({locale:'zh-CN'}));
    ipcMain.handle('t8pc:locale:set',()=>({success:true,locale:'zh-CN'}));
    app.on('window-all-closed',()=>{});
    app.whenReady().then(()=>{
      const win=new BrowserWindow({width:1440,height:1040,show:false,webPreferences:{
        preload:${JSON.stringify(path.join(root, 'electron/preload.cjs'))},contextIsolation:true,nodeIntegration:false}});
      mainWindowCloseGate=createCanvasCloseGate(win); win.loadURL('about:blank');
    });`);
  let electronApp;
  const closedApplications = new WeakSet();
  let sequence = 0;
  const launch = async ({ quit = false } = {}) => {
    const env = { ...process.env, T8_CLOSE_PROFILE: path.join(temporary, `close-profile-${++sequence}`), T8_CLOSE_QUIT: quit ? '1' : '0' };
    fs.mkdirSync(env.T8_CLOSE_PROFILE, { recursive: true });
    delete env.ELECTRON_RUN_AS_NODE;
    electronApp = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry], env, timeout: 60000 });
    const launched = electronApp;
    launched.on('close', () => closedApplications.add(launched));
    return electronApp.firstWindow();
  };
  const dispose = async () => {
    if (!electronApp) return;
    const owned = electronApp;
    if (closedApplications.has(owned)) { electronApp = null; return; }
    const exited = owned.waitForEvent('close', { timeout: 10000 });
    // Native exit may beat the evaluate ACK; only an observed close event can
    // validate disposal, never a swallowed transport failure alone.
    void exited.catch(() => {});
    try {
      await owned.evaluate(({ app }) => { setTimeout(() => app.exit(0), 0); });
    } catch (error) {
      report.electronDisposalTransportErrors ||= [];
      report.electronDisposalTransportErrors.push(String(error).split('\n')[0]);
    }
    await exited;
    if (electronApp === owned) electronApp = null;
  };
  const document = async () => {
    const response = await fetch(`${origin}/api/canvas/image-generation-canvas`);
    assert.equal(response.status, 200);
    return (await response.json()).data;
  };
  const until = async (check, label) => {
    const deadline = Date.now() + 15000;
    do { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); } while (Date.now() < deadline);
    throw new Error(`Electron close: ${label}`);
  };
  report.electronClose = { scope: 'isolated-native-shell-production-preload-gate-and-Canvas', installed: false };
  const phase = value => { report.electronClose.phase = value; process.stdout.write(`[electron-close] ${value}\n`); };
  try {
    phase('opening-first-window');
    let page = await launch();
    await setupPage(page, 'image-generation-canvas');
    const node = page.locator('.react-flow__node[data-id="image-generator"]');
    const prior = (await document()).nodes.find(n => n.id === 'image-generator').data;
    assert.equal(prior.imageUrl, '/files/output/generation-b.png');
    const prompt = 'Immediately closed draft; keep generated B and its original prompt';
    let held;
    await page.route('**/api/canvas/image-generation-canvas', async route => {
      if (route.request().method() !== 'PUT') return route.fallback();
      const payload = route.request().postDataJSON();
      if (JSON.stringify(payload).includes(prompt)) { held = route; return; }
      return route.fallback();
    });
    const textbox = node.getByRole('textbox');
    await textbox.click();
    await textbox.press('ControlOrMeta+A');
    await textbox.fill(prompt);
    assert.equal(await textbox.innerText(), prompt);
    // Do not wait for 800ms debounce or backend confirmation; native close
    // itself must blur the draft, flush, and keep the window alive for the ACK.
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await until(() => !!held, 'close starts the pending CAS write');
    assert.equal(page.isClosed(), false);
    assert.notEqual((await document()).nodes.find(n => n.id === 'image-generator').data.prompt, prompt);
    await page.getByRole('status').filter({ hasText: '正在保存画布' }).waitFor();
    assert.equal(await page.locator('#root').evaluate(el => el.inert), true);
    const heldGraph = () => page.locator('.react-flow__node').evaluateAll(nodes => nodes.map(node => ({
      id: node.getAttribute('data-id'), selected: node.classList.contains('selected'),
      prompt: node.querySelector('[contenteditable]')?.textContent || '',
    })));
    const beforeShortcuts = await heldGraph();
    const heldStartedAt = Date.now();
    report.electronClose.shortcutChecks = [];
    for (const shortcut of ['ControlOrMeta+z', 'ControlOrMeta+Shift+z', 'ControlOrMeta+d', 'ControlOrMeta+g', 'ControlOrMeta+a', 'Delete']) {
      const check = { shortcut, beforeMs: Date.now() - heldStartedAt,
        beforeInert: await page.locator('#root').evaluate(el => el.inert) };
      report.electronClose.shortcutChecks.push(check);
      assert.equal(check.beforeInert, true, `hold must still be active before ${shortcut}`);
      await page.keyboard.press(shortcut);
      // Hidden Electron windows may throttle animation frames past the save
      // deadline. Yield on the verifier clock and explicitly verify the hold.
      await new Promise(resolve => setTimeout(resolve, 50));
      check.afterMs = Date.now() - heldStartedAt;
      check.afterInert = await page.locator('#root').evaluate(el => el.inert);
      assert.equal(check.afterInert, true, `hold must remain active after ${shortcut}`);
      assert.deepEqual(await heldGraph(), beforeShortcuts, `saving hold blocks ${shortcut}`);
    }
    report.electronClose.heldShortcuts = ['undo', 'redo', 'duplicate', 'group', 'select-all', 'delete'];
    await page.screenshot({ path: path.join(artifacts, 'electron-close-waits-for-save.png') });
    await held.continue();
    await page.waitForEvent('close', { timeout: 15000 });
    phase('native-window-closed-after-save');
    const saved = (await document()).nodes.find(n => n.id === 'image-generator').data;
    assert.equal(saved.prompt, prompt);
    assert.equal(saved.imageUrl, prior.imageUrl);
    assert.equal(saved.lastPrompt, prior.lastPrompt);
    await electronApp.close(); electronApp = null;
    await stop(); await start();
    phase('reopening-after-backend-restart');
    page = await launch();
    await setupPage(page, 'image-generation-canvas');
    const restored = (await document()).nodes.find(n => n.id === 'image-generator').data;
    assert.equal(restored.prompt, prompt);
    assert.equal(restored.imageUrl, prior.imageUrl);
    assert.equal(restored.lastPrompt, prior.lastPrompt);
    assert.equal(await page.locator('.react-flow__node[data-id="image-generator"]').getByRole('textbox').innerText(), prompt);
    const history = await (await fetch(`${origin}/api/project-runs/generation-history?projectId=history-project&canvasId=image-generation-canvas`)).json();
    assert.equal(history.data.groups.length, 2);
    await page.screenshot({ path: path.join(artifacts, 'electron-close-restarted.png') });
    report.electronClose.savedPrompt = prompt;
    report.electronClose.retainedImageUrl = restored.imageUrl;
    report.electronClose.retainedLastPrompt = restored.lastPrompt;
    report.electronClose.historyCount = history.data.groups.length;
    report.cases.push('native-Electron-close-flushes-unblurred-draft-before-closing-and-restart-retains-B-and-two-histories');
    phase('accepted');
    await dispose();
    await require('./generation-history-electron-generated-close.cjs')({
      launch, dispose, setupPage, start, stop, origin, artifacts, report,
      closeWindow: () => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()),
    });
    await require('./generation-history-electron-quit.cjs')({
      launch, dispose, setupPage, start, stop, origin, artifacts, report,
      requestQuit: () => electronApp.evaluate(({ app }) => app.quit()),
      readQuitStatus: () => electronApp.evaluate(() => globalThis.__quitBackendRequest),
      finishQuit: async () => {
        const closing = electronApp.waitForEvent('close', { timeout: 15000 });
        void closing.catch(() => {});
        try { await electronApp.evaluate(() => { setTimeout(() => globalThis.__releaseQuitBackend(), 0); }); }
        catch (error) { report.electronQuit.releaseTransportError = String(error).split('\n')[0]; }
        await closing;
      },
    });
  } finally {
    // Dispose through Electron itself, not ChildProcess.kill(): on Windows the
    // Playwright child may be a launcher, leaving GPU/network children alive.
    // app.exit is test cleanup only, never evidence of a graceful native close.
    await dispose();
  }
};
