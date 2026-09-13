'use strict';
// Tiny isolated transport diagnostic: no App, Vite, database or Provider.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

async function main() {
  assert.equal(process.env.T8_ACCEPTANCE_LOW_LOAD, '1', 'Use the low-load runner');
  const { _electron } = require('playwright');
  const root = path.resolve(__dirname, '..');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 't8-history-transport-'));
  const report = { passed: false, cases: [], scope: 'isolated-Electron-transport-no-App-no-database-no-Provider' };
  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/api/')) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ success: true, data: { taskId: 'owned-probe' } }));
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>Transport diagnostic</title>');
    }
  });
  let application;
  let closed = false;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const entry = path.join(temporary, 'entry.cjs');
    fs.writeFileSync(entry, `const {app,BrowserWindow,session}=require('electron');app.disableHardwareAcceleration();
      globalThis.installOwnedHeaderBridge=()=>require(${JSON.stringify(path.join(root, 'electron/systemFetchBridge.cjs'))}).installChromiumResponseHeaderBridge(session.defaultSession);
      app.setPath('userData',${JSON.stringify(path.join(temporary, 'profile'))});
      app.whenReady().then(()=>{const window=new BrowserWindow({show:false});window.loadURL(${JSON.stringify(origin)});});`);
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const loader = path.join(path.dirname(require.resolve('playwright-core')), 'lib/server/electron/loader.js');
    application = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: ['-r', loader, entry], env, timeout: 30000 });
    application.on('close', () => { closed = true; });
    const page = await application.firstWindow(); await page.waitForURL(origin + '/');
    for (const mode of ['baseline', 'network-filter', 'production-header-bridge']) {
      if (mode === 'network-filter') await application.evaluate(({ session }, allowedOrigin) => {
        session.defaultSession.webRequest.onBeforeRequest((details, done) => {
          const url = new URL(details.url);
          done({ cancel: url.origin !== allowedOrigin && !['file:', 'data:', 'blob:', 'devtools:'].includes(url.protocol) });
        });
      }, origin);
      if (mode === 'production-header-bridge') await application.evaluate(() => globalThis.installOwnedHeaderBridge());
      for (const transport of ['http', 'fulfill-default', 'fulfill-explicit']) {
        if (transport !== 'http') await page.route('**/api/proxy/seedance/submit', route => route.fulfill({
          ...(transport === 'fulfill-explicit' ? { status: 200 } : {}),
          json: { success: true, data: { taskId: 'owned-probe' } },
        }));
        const result = await page.evaluate(async () => {
          const response = await fetch('/api/proxy/seedance/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          return { status: response.status, ok: response.ok, type: response.type, body: await response.json() };
        });
        report.cases.push({ mode, transport, ...result });
        await page.unrouteAll();
      }
    }
    // A diagnostic pass means the suspected conflict was reproduced and the
    // real HTTP alternative stayed sound, not that mocked transport works.
    report.passed = report.cases.every(item => {
      const interceptedWithFilter = item.mode !== 'baseline' && item.transport !== 'http';
      return item.status === (interceptedWithFilter ? 0 : 200)
        && item.ok === !interceptedWithFilter && item.body.success === true;
    });
    report.meaning = 'conflict-reproduced-real-HTTP-alternative-validated-not-product-acceptance';
  } finally {
    if (application && !closed) {
      const closing = application.waitForEvent('close', { timeout: 10000 });
      await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 0); });
      await closing;
    }
    await new Promise(resolve => server.close(resolve));
    if (application) assert.equal(closed, true, 'Do not delete live diagnostic profile');
    const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(temporary));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(temporary, { recursive: true, force: true });
    const artifacts = path.join(root, 'artifacts/generation-history-transport'); fs.mkdirSync(artifacts, { recursive: true });
    fs.writeFileSync(path.join(artifacts, new Date().toISOString().replace(/[:.]/g, '-') + '.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
  if (!report.passed) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
