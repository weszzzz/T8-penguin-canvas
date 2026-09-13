'use strict';

// Actual shared React component and theme/i18n, controlled state transitions.
// No database, generation, Provider access or installed-client claim.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const entry = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import Notice from '/src/components/nodes/PreviousGenerationNotice.tsx';
import {beginVideoRegeneration,completeVideoRegeneration} from '/src/utils/generationResultRetention.ts';
import i18n from '/src/i18n/index.ts';
import {applyThemeTemplate} from '/src/theme/applyTheme.ts';
import {BUILT_IN_THEME_TEMPLATES,TECH_TEMPLATE_ID} from '/src/theme/defaultTemplates.ts';
import '/src/styles/index.css';
const params=new URLSearchParams(location.search);
await i18n.changeLanguage(params.get('locale'));
applyThemeTemplate(BUILT_IN_THEME_TEMPLATES.find(t=>t.id===TECH_TEMPLATE_ID),params.get('theme'));
function App(){
  const [data,setData]=useState({status:'success',videoUrl:'/files/output/old.mp4',lastPrompt:'old'});
  const patch=(value)=>setData(current=>({...current,...value}));
  return <main style={{padding:16,color:'var(--t8-text-main)',background:'var(--t8-bg-canvas)',minHeight:'100vh'}}>
    <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:16}}>
      <button onClick={()=>patch(beginVideoRegeneration(data))}>Begin</button>
      <button onClick={()=>patch({status:'polling'})}>Poll</button>
      <button onClick={()=>patch({status:'error'})}>Fail</button>
      <button onClick={()=>patch({status:'idle'})}>Stop</button>
      <button onClick={()=>patch(completeVideoRegeneration(['/files/output/new.mp4'],'new'))}>Complete</button>
      <button onClick={()=>patch({showingPreviousResult:true,videoUrl:'',videoUrls:[]})}>Empty</button>
    </div>
    <section style={{width:240,maxWidth:'100%'}}><Notice data={data}/></section>
    <output data-preview-url={data.videoUrl} style={{display:'block',marginTop:12,fontSize:11}}>{data.lastPrompt}</output>
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
`;

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 't8-retention-notice-ui-'));
  const artifacts = path.join(ROOT, 'artifacts', 'generation-retention-notice-ui');
  const report = { schema: 't8-generation-retention-notice-ui-v1', startedAt: new Date().toISOString(), passed: false,
    scope: 'actual-shared-component-controlled-state-not-full-node-or-persistence', providerCalls: 0, installedElectron: false, cases: [] };
  fs.mkdirSync(artifacts, { recursive: true });
  const writeReport = () => fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  writeReport();
  let browser, server, failure;
  try {
    const { createServer, transformWithEsbuild } = await import('vite');
    server = await createServer({ root: ROOT, configFile: false, cacheDir: path.join(temporary, 'vite'), esbuild: { jsx: 'automatic' },
      optimizeDeps: { entries: ['src/components/nodes/PreviousGenerationNotice.tsx'], include: ['react','react-dom/client','react-i18next'] },
      server: { host: '127.0.0.1', port: 0, strictPort: true },
      plugins: [{ name: 'retention-notice-fixture',
        resolveId(id) { if (id === '/notice-fixture.tsx') return '\0notice-fixture.tsx'; },
        async load(id) { if (id === '\0notice-fixture.tsx') return (await transformWithEsbuild(entry, 'notice-fixture.tsx', { loader: 'tsx', jsx: 'automatic' })).code; },
        configureServer(vite) { vite.middlewares.use((req, res, next) => {
          const url = new URL(req.url, 'http://fixture');
          if (url.pathname.startsWith('/api/')) { res.statusCode = 403; res.end('API forbidden'); return; }
          if (url.pathname !== '/__notice') return next();
          res.setHeader('Content-Type', 'text/html');
          res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/notice-fixture.tsx"></script></body></html>');
        }); },
      }],
    });
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const theme of ['light', 'dark']) for (const locale of ['zh-CN', 'en-US']) {
      const name = `${theme}-${locale}`, errors = [], apiRequests = [];
      const page = await browser.newPage({ viewport: { width: 320, height: 640 } });
      page.on('pageerror', error => { errors.push(error.message); console.error(`[retention-notice-ui] ${name}: ${error.message}`); });
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith('/api/')) apiRequests.push(url.pathname);
        return url.origin === origin ? route.continue() : route.abort();
      });
      await page.goto(`${origin}/__notice?theme=${theme}&locale=${locale}`, { waitUntil: 'commit' });
      await page.getByRole('button', { name: 'Begin', exact: true }).waitFor({ timeout: 120000 });
      const notice = page.locator('[data-previous-generation-notice]');
      assert.equal(await notice.count(), 0);
      const chinese = locale === 'zh-CN';
      await page.getByRole('button', { name: 'Begin', exact: true }).click();
      await notice.waitFor();
      assert.match(await notice.innerText(), chinese ? /等待期间/ : /while waiting/);
      await page.getByRole('button', { name: 'Poll', exact: true }).click();
      assert.match(await notice.innerText(), chinese ? /等待期间/ : /while waiting/);
      await page.getByRole('button', { name: 'Fail', exact: true }).click();
      await notice.getByText(chinese ? '本次生成未成功，上一版预览仍保留。' : 'This generation did not succeed. The previous preview is still available.', { exact: true }).waitFor();
      assert.equal(await page.locator('output').getAttribute('data-preview-url'), '/files/output/old.mp4');
      assert.equal(await page.locator('output').innerText(), 'old');
      const layout = await notice.evaluate(element => {
        const style = getComputedStyle(element), bounds = element.getBoundingClientRect();
        const probe = document.createElement('div'); probe.style.color = 'var(--t8-text-main)'; probe.style.background = 'var(--t8-bg-panel)'; document.body.append(probe);
        const tokens = getComputedStyle(probe);
        const result = { width: element.clientWidth, scrollWidth: element.scrollWidth, right: bounds.right,
          bottom: bounds.bottom, color: style.color, background: style.backgroundColor,
          tokenColor: tokens.color, tokenBackground: tokens.backgroundColor };
        probe.remove(); return result;
      });
      assert.ok(layout.scrollWidth <= layout.width + 1 && layout.right <= 320 && layout.bottom <= 640);
      assert.equal(layout.color, layout.tokenColor); assert.equal(layout.background, layout.tokenBackground);
      assert.notEqual(layout.color, layout.background);
      assert.equal(await notice.getAttribute('role'), 'status');
      if (!chinese) assert.doesNotMatch(await notice.innerText(), /[\u3400-\u9fff]/);
      await page.screenshot({ path: path.join(artifacts, `${name}.png`) });
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      await notice.getByText(chinese ? '可修改设置后重新生成，上一版预览仍保留。' : 'You can edit the settings and generate again. The previous preview is still available.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Complete', exact: true }).click();
      await notice.waitFor({ state: 'detached' });
      assert.equal(await page.locator('output').getAttribute('data-preview-url'), '/files/output/new.mp4');
      await page.getByRole('button', { name: 'Empty', exact: true }).click();
      assert.equal(await notice.count(), 0);
      assert.deepEqual(errors, []); assert.deepEqual(apiRequests, []);
      report.cases.push({ name, passed: true, states: ['initial', 'submitting', 'polling', 'error', 'idle', 'success', 'empty'], layout });
      console.log(`[retention-notice-ui] ${name} passed`);
      await page.close();
    }
  } catch (error) {
    failure = error; report.failure = error.message;
    const page = browser?.contexts().at(-1)?.pages().at(-1);
    if (page) {
      report.visibleFailure = await page.locator('body').innerText({ timeout: 5000 }).catch(() => 'unavailable');
      await page.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {});
    }
  } finally {
    const cleanupErrors = [];
    for (const close of [() => browser?.close(), () => server?.close(), () => {
      const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(temporary));
      assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
      fs.rmSync(temporary, { recursive: true, force: true });
    }]) { try { await close(); } catch (error) { cleanupErrors.push(error.message); } }
    if (cleanupErrors.length) { report.cleanupErrors = cleanupErrors; failure ||= new Error('Fixture cleanup failed'); }
    report.passed = !failure && report.cases.length === 4;
    writeReport();
  }
  if (failure) throw failure;
  console.log(JSON.stringify(report));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
