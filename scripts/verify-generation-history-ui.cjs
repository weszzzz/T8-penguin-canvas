'use strict';

// Real Chromium + production history query + temporary SQLite. The fixture
// output is synthetic; no production database, Provider or credentials enter.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { ProjectDatabase } = require('../backend/src/services/projectDatabase');
const { listGenerationHistory } = require('../backend/src/services/generationHistory');
const { coldHistoryFileWatcherPlugin } = require('./history-serial-warmup.cjs');
const ROOT = path.resolve(__dirname, '..');
const entry = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import Panel from '/src/components/GenerationHistoryPanel.tsx';
import Settings from '/src/components/GenerationHistorySettings.tsx';
import i18n from '/src/i18n/index.ts';
import {HistoryReferenceRecoveryRequired} from '/src/utils/generationHistoryInputDraft.ts';
import {applyThemeTemplate} from '/src/theme/applyTheme.ts';
import {BUILT_IN_THEME_TEMPLATES,TECH_TEMPLATE_ID} from '/src/theme/defaultTemplates.ts';
import '/src/styles/index.css';
document.documentElement.dataset.themeMode = new URLSearchParams(location.search).get('theme') || 'light';
await i18n.changeLanguage(new URLSearchParams(location.search).get('locale') || 'zh-CN');
window.changeHistoryLocale = locale => i18n.changeLanguage(locale);
applyThemeTemplate(BUILT_IN_THEME_TEMPLATES.find(t=>t.id===TECH_TEMPLATE_ID), document.documentElement.dataset.themeMode);
let referenceRecovered=false;
function App() {
  const [open,setOpen] = useState(true), [count,setCount] = useState(0), [node,setNode] = useState(undefined), [canvas,setCanvas] = useState('history-ui');
  if (new URLSearchParams(location.search).has('settings')) return React.createElement(Settings, {
    group: {id:'settings-fixture'}, newDraft:!new URLSearchParams(location.search).has('restore'),
    prepare: async()=>{
      document.body.dataset.prepareCount=String(Number(document.body.dataset.prepareCount||0)+1);
      if(new URLSearchParams(location.search).has('missing-reference')&&!referenceRecovered){
        const error=new HistoryReferenceRecoveryRequired({referenceGroupId:'fixture',referenceArchiveDigest:'fixture',referenceIndex:1},'图片 2');
        error.recover=async(file,signal)=>{document.body.dataset.recoveryFile=file.name;await new Promise(resolve=>{window.finishReferenceRecovery=resolve;});referenceRecovered=true;};
        throw error;
      }
      return {prompt:'历史提示词'.repeat(2000), resolvedFrontendInputs:true, referenceWarning:new URLSearchParams(location.search).has('restore'),
        fields:['prompt','model','duration','ratio','resolution',...Array.from({length:20},(_,i)=>'extra'+i)].map(key=>({key,label:key,before:'',beforeDefault:key==='duration',afterDefault:key==='ratio',after:key==='prompt'?'长提示词'.repeat(2000):'归档参数值'})),
        references:Array.from({length:30},(_,i)=>({kind:'image',url:'/api/project-assets/ui-reference/media',label:'图片 '+(i+1)})),
        apply:async()=>{document.body.dataset.applyCount=String(Number(document.body.dataset.applyCount||0)+1);document.body.dataset.applyStarted='true';await new Promise(resolve=>{window.finishHistoryApply=resolve;});document.body.dataset.applyFinished='true';}
      };
    }
  });
  return React.createElement(React.Fragment,null,
    React.createElement('button',{onClick:()=>setOpen(true)},'打开历史'),
    React.createElement('button',{onClick:()=>setNode('other-node')},'筛选其他节点'),
    React.createElement('button',{onClick:()=>{setNode(undefined);setCanvas('empty-ui');}},'切换空画布'),
    React.createElement(Panel,{key:canvas,open,projectId:'history-project',canvasId:canvas,nodeId:node,refreshKey:'fixture',generationCount:count,onCount:setCount,
      onClearNodeFilter:()=>setNode(undefined), onClose:()=>setOpen(false),onFocusNode:id=>{document.body.dataset.focusedNode=id;},
      onPlace:async output=>{document.body.dataset.placedAsset=output.assetId;},items:[]})
  );
}
createRoot(document.getElementById('root')).render(React.createElement(App));
`;

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 't8-generation-history-ui-'));
  const artifactDirectory = path.join(ROOT, 'artifacts', 'generation-history-ui', new Date().toISOString().replace(/[:.]/g, '-'));
  let database, server, browser;
  const report = { schema: 't8-generation-history-ui-evidence-v1', startedAt: new Date().toISOString(), passed: false, scope: 'real-browser-real-read-projection-temporary-SQLite-synthetic-media', productionDatabase: false, providerCalls: 0, placement: 'fixture-callback-not-canvas-persistence',
    resourceMode: { runner: 'run-history-low-load.ps1', cpuHardCapPercent: 10, jobCommitLimitMB: 4096, automaticRetries: 0, fileWatching: false }, cases: [] };
  try {
    database = new ProjectDatabase(path.join(temporary, 'projects.sqlite3'));
    const historyCanvas = database.ensureCanvas('history-ui', { nodes: ['source-node', 'other-node'].map((id, index) => ({ id, entityUid: `a1000000-0000-4000-8000-00000000000${index + 1}`, type: 'image', position: { x: 0, y: 0 }, data: {} })), edges: [] }, 'history-project');
    database.ensureCanvas('empty-ui', { nodes: [], edges: [] }, 'history-project');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    for (let index = 0; index < 27; index++) {
      const run = database.createRun({ id: `ui-run-${index}`, projectId: 'history-project', canvasId: 'history-ui', canvasRevision: historyCanvas.revision, status: 'succeeded' });
      const node = database.createNodeRun({ id: `ui-node-${index}`, runId: run.id, nodeId: index === 0 ? 'other-node' : 'source-node', status: 'succeeded', inputSnapshot: { node: { data: { prompt: `第 ${index + 1} 版提示词` } } } });
      const attempt = database.createAttempt({ id: `ui-attempt-${index}`, nodeRunId: node.id, status: 'succeeded', provider: 'synthetic-ui', model: 'fixture-image' });
      database.recordRunOutputAssets({ runId: run.id, nodeRunId: node.id, attemptId: attempt.id, outputs: Array.from({ length: index === 26 ? 7 : 1 }, (_, ordinal) => ({ kind: 'image', sourceUrl: `/files/output/ui-${index}-${ordinal}.png`, filename: `ui-${index}-${ordinal}.png`, storageMode: 'managed', availability: 'available' })) });
    }
    const { createServer } = await import('vite');
    server = await createServer({ root: ROOT, configFile: false, cacheDir: path.join(temporary, 'vite'), esbuild: { jsx: 'automatic' },
      optimizeDeps: { entries: ['src/components/GenerationHistoryPanel.tsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-i18next', 'i18next'] },
      server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false, watch: null, preTransformRequests: false },
      plugins: [coldHistoryFileWatcherPlugin(), { name: 'history-fixture', resolveId(id) { if (id === '/history-fixture.js') return '\0history-fixture.js'; }, load(id) { if (id === '\0history-fixture.js') return entry; },
        configureServer(vite) { vite.middlewares.use((req, res, next) => {
          const url = new URL(req.url, 'http://fixture');
          if (url.pathname === '/api/project-runs/generation-history') {
            res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
            try { res.end(JSON.stringify({ success: true, data: listGenerationHistory(database, Object.fromEntries(url.searchParams)) })); }
            catch (error) { res.statusCode = error.status || 500; res.end(JSON.stringify({ success: false, error: error.message })); }
            return;
          }
          if (/^\/api\/project-assets\/[^/]+\/media$/.test(url.pathname)) { res.setHeader('Content-Type', 'image/png'); res.end(png); return; }
          if (url.pathname.startsWith('/api/')) { res.statusCode = 403; res.end('Fixture forbids other API routes'); return; }
          if (url.pathname !== '/__history_ui') return next();
          res.setHeader('Content-Type', 'text/html');
          res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/history-fixture.js"></script></body></html>');
        }); },
      }],
    });
    assert.equal(server.config.server.watch, null); assert.deepEqual(server.watcher.getWatched(), {});
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    fs.mkdirSync(artifactDirectory, { recursive: true });
    for (const config of [{ name: 'light', theme: 'light', width: 1366, height: 900 }, { name: 'dark', theme: 'dark', width: 1366, height: 900 }, { name: 'narrow', theme: 'light', width: 390, height: 844 }]) {
      console.log(`[history-ui] checking ${config.name}`);
      const page = await browser.newPage({ viewport: { width: config.width, height: config.height } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
      await page.goto(`${origin}/__history_ui?theme=${config.theme}`, { waitUntil: 'commit' });
      // This fixture deliberately starts with a fresh Vite cache. Allow cold
      // dependency compilation, then retain normal interaction timeouts below.
      try { await page.locator('[data-history-group]').first().waitFor({ state: 'attached', timeout: 120000 }); }
      catch (error) {
        await page.screenshot({ path: path.join(artifactDirectory, 'failure.png') });
        console.error(JSON.stringify({ errors, body: (await page.locator('body').innerText()).slice(0, 1500) }));
        throw error;
      }
      await page.waitForFunction(() => document.querySelectorAll('[data-history-group]').length === 24);
      console.log(`[history-ui] ${config.name}: 24 records attached`);
      const first = page.locator('[data-history-group]').first();
      assert.match(await first.innerText(), /共 7 个结果/);
      await first.getByRole('button', { name: '展开其余结果' }).click();
      await page.waitForFunction(() => document.querySelector('[data-history-group]')?.querySelectorAll('.t8-history-image-open').length === 7);
      console.log(`[history-ui] ${config.name}: 7 outputs expanded`);
      const imageButton = first.getByRole('button', { name: /^放大预览/ }).first();
      await imageButton.click();
      assert.equal(await page.locator('dialog[open]').count(), 1);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('dialog[open]').count(), 0);
      assert.equal(await imageButton.evaluate(element => document.activeElement === element), true);
      await first.getByRole('button', { name: '放到画布', exact: true }).first().click();
      await first.getByRole('button', { name: '已放到画布' }).waitFor();
      assert.ok(await page.locator('body').getAttribute('data-placed-asset'));
      await page.getByRole('button', { name: '显示更早记录' }).click();
      await page.waitForFunction(() => document.querySelectorAll('[data-history-group]').length === 27);
      const drawer = page.locator('.t8-generation-history-panel');
      const dimensions = await drawer.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
      assert.ok(dimensions.scrollWidth <= dimensions.width + 1, 'drawer must not overflow horizontally');
      await page.screenshot({ path: path.join(artifactDirectory, `${config.name}.png`) });
      await page.getByRole('button', { name: '筛选其他节点' }).click();
      await page.waitForFunction(() => document.querySelectorAll('[data-history-group]').length === 1);
      assert.match(await drawer.innerText(), /第 1 版提示词/);
      await page.getByRole('button', { name: '切换空画布' }).click();
      await page.getByText('暂无已保存的生成记录。旧画布中的素材仍可在“当前素材”查看。', { exact: true }).waitFor();
      assert.equal(await page.locator('[data-history-group]').count(), 0);
      assert.deepEqual(errors, []);
      report.cases.push({ name: config.name, passed: true, groups: 27, groupOutputs: 7, dimensions, browserErrors: errors });
      await page.close();
    }
    // A stale available index must not hide the record or offer a broken insert.
    // Real browser requests receive 404, then recover without re-generating.
    const missingPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    let mediaUnavailable = true;
    const missingErrors = [];
    missingPage.on('pageerror', error => missingErrors.push(error.message));
    await missingPage.route('**/*', route => {
      const url = route.request().url();
      if (!url.startsWith(origin)) return route.abort();
      if (mediaUnavailable && /\/api\/project-assets\/[^/]+\/media$/.test(url)) {
        return route.fulfill({ status: 404, headers: { 'cache-control': 'no-store' }, body: '' });
      }
      return route.continue();
    });
    await missingPage.goto(`${origin}/__history_ui?theme=light`, { waitUntil: 'commit' });
    const missingCard = missingPage.locator('[data-history-group]').first();
    await missingCard.getByRole('button', { name: '重试预览' }).first().waitFor();
    assert.equal(await missingPage.locator('[data-history-group]').count(), 24);
    assert.equal(await missingCard.getByRole('button', { name: '放到画布', exact: true }).first().isDisabled(), true);
    assert.match(await missingCard.innerText(), /生成记录仍保留/);
    await missingPage.screenshot({ path: path.join(artifactDirectory, 'missing-file.png') });
    mediaUnavailable = false;
    await missingCard.getByRole('button', { name: '重试预览' }).first().click();
    await missingPage.waitForFunction(() => {
      const image = document.querySelector('[data-history-group] .t8-history-image-open img');
      return image && image.complete && image.naturalWidth > 0;
    });
    assert.equal(await missingCard.getByRole('button', { name: '放到画布', exact: true }).first().isEnabled(), true);
    assert.deepEqual(missingErrors, []);
    report.cases.push({ name: 'missing-file-retry', passed: true, groupsRetained: 24, insertionDisabledUntilRetry: true, browserErrors: missingErrors });
    await missingPage.close();
    for (const code of ['HISTORY_RECOVERY_COMMIT_UNCONFIRMED','HISTORY_RECOVERY_WRITES_STOPPED']) {
      const page = await browser.newPage({viewport:{width:390,height:844}});
      let recoveryPosts=0,historyReads=0;const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*',route=>{
        const request=route.request(),url=new URL(request.url());
        if(!request.url().startsWith(origin)) return route.abort();
        if(url.pathname==='/api/project-runs/generation-history/recover'&&request.method()==='POST') {
          recoveryPosts++;
          return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({success:false,code,committed:code==='HISTORY_RECOVERY_COMMIT_UNCONFIRMED',retryable:false,stopBatch:true,error:'private fixture error must not be rendered'})});
        }
        if(url.pathname==='/api/project-runs/generation-history') historyReads++;
        return route.continue();
      });
      await page.goto(`${origin}/__history_ui?theme=light`,{waitUntil:'commit'});
      await page.locator('[data-history-group]').first().waitFor();
      await page.locator('input[aria-label="选择要找回的旧文件"]').setInputFiles([
        {name:'old-a.png',mimeType:'image/png',buffer:png},{name:'old-b.png',mimeType:'image/png',buffer:png},
      ]);
      await page.getByRole('button',{name:'确认找回',exact:true}).click();
      const recovery=page.locator('.t8-history-recovery');
      await recovery.getByRole('alert').waitFor();
      assert.equal(recoveryPosts,1,'terminal writer failure must stop before the second file');
      assert.equal(await recovery.getByRole('button',{name:'确认找回',exact:true}).isDisabled(),true);
      assert.equal(await recovery.getByRole('button',{name:'找回本地文件',exact:true}).isDisabled(),true);
      assert.match(await recovery.innerText(),/2 个文件未确认或未处理/);
      assert.doesNotMatch(await recovery.innerText(),/可重试|private fixture/);
      const before=historyReads;
      await Promise.all([
        page.waitForResponse(response=>new URL(response.url()).pathname==='/api/project-runs/generation-history'),
        recovery.getByRole('button',{name:'刷新历史记录',exact:true}).click(),
      ]);
      assert.ok(historyReads>before);assert.equal(recoveryPosts,1);
      await page.screenshot({path:path.join(artifactDirectory,`${code.toLowerCase()}.png`)});
      assert.deepEqual(errors,[]);
      report.cases.push({name:code,passed:true,recoveryPosts,selectedFiles:2,batchStopped:true,refreshReadOnly:true,browserErrors:errors,failure:'controlled-HTTP-contract-not-real-disk-fault'});
      await page.close();
    }
    // Exercise the production 300-second recovery deadline in a real browser
    // without waiting five wall-clock minutes. Only the owned recovery fetch is
    // stalled; Playwright's clock advances the actual window timer/AbortSignal.
    const timeoutPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const timeoutErrors = []; timeoutPage.on('pageerror', error => timeoutErrors.push(error.message));
    await timeoutPage.clock.install();
    await timeoutPage.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window); window.__historyTimeoutPosts = 0;
      window.fetch = (input, init = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (url.pathname === '/api/project-runs/generation-history/recover' && init.method === 'POST') {
          window.__historyTimeoutPosts++;
          return new Promise((_, reject) => {
            const abort = () => reject(new DOMException('Aborted', 'AbortError'));
            if (init.signal?.aborted) abort(); else init.signal?.addEventListener('abort', abort, { once: true });
          });
        }
        return nativeFetch(input, init);
      };
    });
    await timeoutPage.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await timeoutPage.goto(`${origin}/__history_ui?theme=light`, { waitUntil: 'commit' });
    await timeoutPage.clock.runFor(300); await timeoutPage.locator('[data-history-group]').first().waitFor();
    await timeoutPage.locator('input[aria-label="选择要找回的旧文件"]').setInputFiles([
      { name: 'timeout-a.png', mimeType: 'image/png', buffer: png }, { name: 'timeout-b.png', mimeType: 'image/png', buffer: png },
    ]);
    await timeoutPage.getByRole('button', { name: '确认找回', exact: true }).click();
    await timeoutPage.waitForFunction(() => window.__historyTimeoutPosts === 1);
    await timeoutPage.clock.runFor(300001);
    const timeoutRecovery = timeoutPage.locator('.t8-history-recovery');
    await timeoutRecovery.getByRole('alert').waitFor();
    assert.match(await timeoutRecovery.innerText(), /等待找回结果超时/);
    assert.match(await timeoutRecovery.innerText(), /2 个文件未确认或未处理/);
    assert.equal(await timeoutPage.evaluate(() => window.__historyTimeoutPosts), 1, 'timeout must not retry or send the second file');
    assert.equal(await timeoutRecovery.getByRole('button', { name: '确认找回', exact: true }).isDisabled(), true);
    assert.deepEqual(timeoutErrors, []);
    await timeoutPage.screenshot({ path: path.join(artifactDirectory, 'recovery-timeout.png') });
    report.cases.push({ name: 'HISTORY_RECOVERY_TIMEOUT', passed: true, recoveryPosts: 1, selectedFiles: 2,
      batchStopped: true, noRetry: true, browserErrors: timeoutErrors, failure: 'controlled-stalled-fetch-real-browser-clock' });
    await timeoutPage.close();
    for (const config of [{name:'settings-narrow',theme:'light',width:390,height:640}, {name:'settings-short-dark',theme:'dark',width:1024,height:500}]) {
      const page = await browser.newPage({viewport:{width:config.width,height:config.height}});
      const errors=[]; page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
      await page.goto(`${origin}/__history_ui?theme=${config.theme}&settings=1`,{waitUntil:'commit'});
      const opener=page.getByRole('button',{name:'新建历史输入草稿',exact:true});
      await opener.click();
      const dialog=page.locator('dialog[open]');
      const confirm=dialog.getByRole('button',{name:'确认新建，不生成',exact:true});
      await page.waitForFunction(()=>[...document.querySelectorAll('dialog[open] img')].every(img=>img.complete&&img.naturalWidth>0));
      const assertFooterVisible=async()=>{
        const bounds=await confirm.boundingBox();
        const box=await dialog.boundingBox();
        assert.ok(bounds&&box&&bounds.y>=box.y&&bounds.y+bounds.height<=box.y+box.height&&bounds.y+bounds.height<=config.height,'confirmation must stay visible without scrolling to end');
        assert.equal(await confirm.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'confirmation must be hit-testable');
      };
      await assertFooterVisible();
      await dialog.getByText('查看其他参数（20 项）',{exact:true}).click();
      await assertFooterVisible();
      await dialog.locator('.t8-history-input-references img').last().scrollIntoViewIfNeeded();
      await assertFooterVisible();
      const geometry=await dialog.evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth}));
      assert.ok(geometry.scrollWidth<=geometry.width+1,'settings must not overflow horizontally');
      const colors=await dialog.evaluate(el=>{
        const actual=getComputedStyle(el);
        const probe=document.createElement('div');probe.style.backgroundColor='var(--t8-bg-panel)';probe.style.color='var(--t8-text-main)';document.body.append(probe);
        const expected=getComputedStyle(probe);const result={background:actual.backgroundColor,text:actual.color,expectedBackground:expected.backgroundColor,expectedText:expected.color};probe.remove();return result;
      });
      assert.equal(colors.background,colors.expectedBackground);assert.equal(colors.text,colors.expectedText);
      assert.notEqual(colors.background,colors.text);
      if(config.theme==='dark') assert.notEqual(colors.background,'rgb(255, 255, 255)','dark fixture must apply real theme tokens');
      await page.screenshot({path:path.join(artifactDirectory,`${config.name}.png`)});
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('dialog[open]').count(),0);
      assert.equal(await opener.evaluate(el=>document.activeElement===el),true);
      assert.equal(await page.locator('body').getAttribute('data-apply-started'),null);
      await opener.click();
      await confirm.click();
      await page.waitForFunction(()=>document.body.dataset.applyStarted==='true');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('dialog[open]').count(),1,'busy save must remain open');
      await page.evaluate(()=>window.finishHistoryApply());
      await page.getByText('已新建并保存输入草稿，尚未生成。',{exact:true}).waitFor();
      assert.equal(await page.locator('body').getAttribute('data-apply-finished'),'true');
      assert.deepEqual(errors,[]);
      report.cases.push({name:config.name,passed:true,geometry,colors,referenceCount:30,footerVisible:true,cancelDoesNotApply:true,busyEscapeGuard:true,browserErrors:errors,save:'controlled-callback-not-persistence'});
      await page.close();
    }
    await require('./generation-history-i18n-browser.cjs')({ browser, origin, artifactDirectory, report });
    report.passed = true;
    fs.writeFileSync(path.join(artifactDirectory, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch (error) {
    fs.mkdirSync(artifactDirectory, { recursive: true });
    fs.writeFileSync(path.join(artifactDirectory, 'report.json'), JSON.stringify({ ...report, failure: error.name }, null, 2));
    const currentPage = browser?.contexts().at(-1)?.pages().at(-1);
    if (currentPage) await currentPage.screenshot({ path: path.join(artifactDirectory, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser?.close(); await server?.close(); await database?.close();
    const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(temporary));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
