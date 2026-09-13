'use strict';
// Actual dialog + settings planner; controlled apply callback, NO persistence.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { whilePageAlive, withDeadline } = require('./history-acceptance-safety.cjs');
const ROOT = path.resolve(__dirname, '..');
const imageInputMode = process.env.T8_ACCEPTANCE_UI_KIND === 'image-input';
// One browser, serial pages. These are dialog fixtures, not Provider executions.
const cases = [
  { id: 'image-gpt25', type: 'image', locale: 'zh-CN', theme: 'light',
    values: { model: 'gpt-image-2', apiModel: 'gpt-image-2.5-flare', aspectRatio: '16:9', sizeLevel: '2K' },
    options: { gptImageQuality: 'xhigh', gptImageModeration: 'low', gptImage25Size: 'custom',
      gptImage25CustomWidth: 1536, gptImage25CustomHeight: 1024, gptImage25Count: 3, gptImage25Background: 'opaque' } },
  { id: 'image-fal', type: 'image', locale: 'en-US', theme: 'dark',
    values: { model: 'nano-banana-pro', apiModel: 'fixture-fal', aspectRatio: '1:1', sizeLevel: '1K' },
    options: { falN: 2, falFormat: 'webp', falSync: false, nbWebSearch: false, nbSeed: 0,
      nbSysPrompt: 'Archived system prompt: ' + 'Exact long value with punctuation / 中文 / 0123456789. '.repeat(90) } },
  { id: 'image-mj', type: 'image', locale: 'zh-CN', theme: 'dark',
    values: { model: 'midjourney', apiModel: 'midjourney', aspectRatio: '1:1', sizeLevel: '1K' },
    options: { mjVersion: 'v 8.1', mjAr: '16:9', mjSpeed: 'relax', mjC: 10, mjS: 150, mjIw: 2,
      mjSw: 120, mjSv: '2', mjNo: 'blur', mjSeed: 0, mjMaxPoll: 200, mjPollInt: 4 } },
  { id: 'image-budget', type: 'image', locale: 'en-US', theme: 'light',
    values: { model: 'gpt-image-2', apiModel: 'zhenzhen-image-g-v2.5-flare', aspectRatio: '16:9', sizeLevel: '2K', imageBuiltinSource: 'seedance-nz' },
    options: { zhenzhenImageG25Size: 'custom', zhenzhenImageG25Resolution: '2k', zhenzhenImageG25Count: 2,
      zhenzhenImageG25CustomWidth: 1536, zhenzhenImageG25CustomHeight: 1024, zhenzhenImageG25Quality: 'high',
      zhenzhenImageG25OutputFormat: 'webp', zhenzhenImageG25OutputCompression: 0,
      zhenzhenImageG25Background: 'opaque', zhenzhenImageG25Moderation: 'low' } },
  { id: 'video-basic', type: 'video', locale: 'en-US', theme: 'dark',
    values: { mainId: 'grok-video', model: 'grok-video-3', duration: 6, ratio: '16:9', resolution: '720p', generateAudio: false }, options: {} },
];
const entry = `import React from 'react';import{createRoot}from'react-dom/client';
import Settings from '/src/components/GenerationHistorySettings.tsx';
import{prepareHistorySettingsDraft,createHistorySettingsPatch}from'/src/utils/generationHistorySettings.ts';
import i18n from '/src/i18n/index.ts';import '/src/styles/index.css';
import{applyThemeTemplate}from'/src/theme/applyTheme.ts';
import{BUILT_IN_THEME_TEMPLATES,TECH_TEMPLATE_ID}from'/src/theme/defaultTemplates.ts';
const fixture=${JSON.stringify(cases)}.find(item=>item.id===new URLSearchParams(location.search).get('case'));
const {type,locale,values,options,theme}=fixture;
await i18n.changeLanguage(locale);applyThemeTemplate(BUILT_IN_THEME_TEMPLATES.find(t=>t.id===TECH_TEMPLATE_ID),theme);
const scope={projectId:'owned-project',canvasId:'owned-canvas'},uid='a1000000-0000-4000-8000-000000000001';
const target={id:'source',entityUid:uid,type,position:{x:0,y:0},data:{prompt:'current draft',status:'success',imageUrl:'/current.png',videoUrl:'/current.mp4',referenceImages:['/reference.png'],localRefVideos:['/reference.mp4'],apiKey:'fixture-only',providerParams:{current:true}}};
const group={id:'owned-history',nodeId:target.id,nodeEntityUid:uid,nodeType:type,snapshotAvailable:true};
const archive={status:'available',binding:{...scope,nodeId:target.id,nodeEntityUid:uid},snapshot:{node:{id:target.id,type,data:{prompt:'Original prompt '+('detail '.repeat(40)),...values}},upstreamNodes:[],incomingEdges:[]}};
if(type==='image')archive.snapshot.node.data.historyResolvedInput={schema:'t8-image-frontend-context-v2',origin:'frontend-common-context',prompt:'Compiled prompt must not replace local prompt',referenceImages:[],
 basicSettings:{imageBuiltinSource:'zhenzhen',providerSource:'zhenzhen',providerId:'',providerModel:'',...values,...options}};
window.settingsFixture={calls:[],target,original:JSON.stringify(target),ready:false};
const prepare=async()=>{const draft=prepareHistorySettingsDraft(archive,group,target,scope);window.settingsFixture.fields=draft.fields.map(field=>({key:field.key,label:i18n.t('generationHistory.field_'+field.key,{ns:'canvas'}),advanced:field.advanced}));return{...draft,apply:async()=>{
 const patch=createHistorySettingsPatch(draft,{...scope,id:'owned-confirmed-patch',baseRevision:1});
 window.settingsFixture.calls.push(patch);
 await new Promise((resolve,reject)=>{window.settingsFixture.finish=ok=>ok?resolve():reject(new Error('Controlled apply failure'));});
}}};
createRoot(document.getElementById('root')).render(<main style={{padding:20}}><Settings group={group} prepare={prepare}/></main>);
window.settingsFixture.ready=true;`;

async function main() {
  assert.equal(process.env.T8_ACCEPTANCE_LOW_LOAD, '1', 'Use run-history-low-load.ps1');
  const { chromium } = require('playwright');
  const { createServer, transformWithEsbuild } = await import('vite');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 't8-history-settings-ui-'));
  const artifacts = path.join(ROOT, imageInputMode ? 'artifacts/history-image-input-ui' : 'artifacts/history-basic-settings-ui', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(artifacts, { recursive: true });
  const report = { passed: false, scope: 'actual-dialog-controlled-apply-not-Canvas-or-persistence', cases: [], errors: [], apiRequests: [], mediaRequests: [], providerCalls: 0 };
  let server, browser, page, failure, imageFixture;
  try {
    if (imageInputMode) imageFixture = await require('./history-image-input-ui.cjs').createFixture();
    server = await createServer({ root: ROOT, configFile: false, cacheDir: path.join(temporary, 'node_modules/.vite'), esbuild: { jsx: 'automatic' },
      optimizeDeps: { entries: ['src/components/GenerationHistorySettings.tsx'], include: ['react', 'react-dom/client', 'react-i18next'] },
      server: { host: '127.0.0.1', port: 0, strictPort: true },
      plugins: [{ name: 'owned-settings-dialog',
        resolveId(id) { if (id === '/settings-fixture.tsx') return '\0settings-fixture.tsx'; },
        async load(id) { if (id === '\0settings-fixture.tsx') return (await transformWithEsbuild(imageFixture?.entry || entry, 'settings-fixture.tsx', { loader: 'tsx', jsx: 'automatic' })).code; },
        configureServer(vite) { vite.middlewares.use((request, response, next) => {
          const url = new URL(request.url, 'http://fixture');
          if (imageFixture?.serve(request, response)) return;
          if (url.pathname.startsWith('/api/')) { response.writeHead(403); response.end('Forbidden'); return; }
          if (url.pathname !== '/__settings') return next();
          response.setHeader('Content-Type', 'text/html');
          response.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/settings-fixture.tsx"></script></body></html>');
        }); },
      }],
    });
    await server.listen(); const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu'] });
    for (const fixture of imageInputMode ? [{ id: 'image-input' }] : cases) {
      const { id, type, locale, options, theme } = fixture;
      page = await browser.newPage({ viewport: { width: 390, height: 720 } });
      page.setDefaultTimeout(10000);
      page.on('pageerror', error => report.errors.push(error.message));
      page.on('crash', () => report.errors.push('Renderer crashed'));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        const fixtureMedia = url.origin === origin && imageFixture?.isMediaPath(url);
        if (fixtureMedia) report.mediaRequests.push({ method: route.request().method(), path: url.pathname });
        else if (url.pathname.startsWith('/api/')) report.apiRequests.push(url.pathname);
        return url.origin === origin && (!url.pathname.startsWith('/api/') || fixtureMedia) ? route.continue() : route.abort();
      });
      await page.goto(`${origin}/__settings?case=${id}`, { waitUntil: 'commit' });
      if (imageFixture) {
        await whilePageAlive(page, () => require('./history-image-input-ui.cjs').verify(page, report, artifacts, imageFixture), 'Image input UI');
        await page.close(); continue;
      }
      const open = page.locator('.t8-history-settings-open'); await open.waitFor({ timeout: 120000 });
      const dialog = page.locator('dialog'), cancel = dialog.locator('footer button').first(), confirm = dialog.locator('footer button').last();
      const snapshot = () => page.evaluate(() => ({ calls: window.settingsFixture.calls, unchanged: JSON.stringify(window.settingsFixture.target) === window.settingsFixture.original }));
      await open.click(); await dialog.waitFor({ state: 'visible' });
      assert.equal(await confirm.isDisabled(), true); assert.equal((await snapshot()).calls.length, 0);
      await cancel.click(); await dialog.waitFor({ state: 'hidden' });
      assert.equal((await snapshot()).calls.length, 0);
      await open.click(); await dialog.getByRole('checkbox').check(); assert.equal(await confirm.isEnabled(), true);
      const readBounds = () => dialog.evaluate(element => {
        const rect = element.getBoundingClientRect(), footer = element.querySelector('footer').getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, footerBottom: footer.bottom, width: element.clientWidth, scrollWidth: element.scrollWidth };
      });
      const bounds = await readBounds();
      const assertBounds = value => assert.ok(value.left >= 0 && value.right <= 391 && value.top >= 0 && value.bottom <= 721 && value.footerBottom <= 721 && value.scrollWidth <= value.width + 1);
      assertBounds(bounds);
      assert.match(await dialog.innerText(), locale === 'zh-CN' ? /模型专属项可展开查看/ : /expand model-specific options to review them/);
      await page.screenshot({ path: path.join(artifacts, `${id}-collapsed.png`) });
      let expandedBounds, advancedCount = 0;
      const extra = dialog.locator('.t8-history-settings-fields > details');
      if (Object.keys(options).length) {
        assert.equal(await extra.count(), 1);
        assert.equal(await extra.evaluate(element => element.open), false);
        const fields = await page.evaluate(() => window.settingsFixture.fields.filter(field => field.advanced));
        advancedCount = fields.length; assert.equal(advancedCount, Object.keys(options).length);
        await extra.locator('summary').click(); assert.equal(await extra.evaluate(element => element.open), true);
        for (const field of fields) {
          const section = extra.locator('section').filter({ has: page.getByText(field.label, { exact: true }) });
          assert.equal(await section.count(), 1);
          assert.equal(await section.locator('pre').last().textContent(), String(options[field.key]), field.key);
        }
        await extra.locator('section').last().scrollIntoViewIfNeeded();
        expandedBounds = await readBounds(); assertBounds(expandedBounds);
        const overflow = await dialog.locator('.t8-history-settings-content').evaluate(element => ({ x: element.scrollWidth > element.clientWidth + 1, y: element.scrollHeight > element.clientHeight }));
        assert.equal(overflow.x, false); assert.equal(overflow.y, true);
        await page.screenshot({ path: path.join(artifacts, `${id}-expanded.png`) });
        await extra.locator('summary').click(); assert.equal(await extra.evaluate(element => element.open), false);
        assert.equal((await snapshot()).calls.length, 0, 'reviewing/collapsing does not apply');
      } else assert.equal(await extra.count(), 0);
      await confirm.click(); await page.waitForFunction(() => window.settingsFixture.calls.length === 1);
      assert.equal(await cancel.isDisabled(), true); assert.equal(await confirm.isDisabled(), true);
      await page.evaluate(() => window.settingsFixture.finish(false));
      await dialog.getByRole('alert').getByText('Controlled apply failure', { exact: true }).waitFor();
      assert.equal(await dialog.isVisible(), true);
      await confirm.click(); await page.waitForFunction(() => window.settingsFixture.calls.length === 2);
      await page.evaluate(() => window.settingsFixture.finish(true)); await dialog.waitFor({ state: 'hidden' });
      const after = await snapshot(); assert.equal(after.unchanged, true); assert.deepEqual(after.calls[0], after.calls[1]);
      const patch = after.calls[0]; assert.equal(patch.requiresConfirmation, true); assert.equal(patch.operations[0].type, 'node.patch');
      for (const [key, value] of Object.entries(options)) assert.deepEqual(patch.operations[0].payload.dataPatch[key], value, key);
      assert.equal(patch.operations[0].payload.dataPatch.prompt, 'Original prompt ' + 'detail '.repeat(40));
      assert.equal(Object.hasOwn(patch.operations[0].payload.dataPatch, 'historyResolvedInput'), false);
      for (const key of ['apiKey', 'providerParams', 'imageUrl', 'videoUrl', 'referenceImages', 'localRefVideos', 'status', 'runTrigger', 'taskId']) {
        assert.equal(Object.hasOwn(patch.operations[0].payload.dataPatch, key), false);
        assert.equal(patch.operations[0].payload.dataUnsetKeys.includes(key), false);
      }
      report.cases.push({ id, type, locale, theme, bounds, expandedBounds, advancedCount, exactOptionValues: true, cancelCalls: 0, explicitApplyCalls: 2, retryPatchUnchanged: true });
      await page.close();
    }
    assert.deepEqual(report.errors, []); assert.deepEqual(report.apiRequests, []); report.passed = true;
  } catch (error) {
    failure = error; report.failure = error.message;
    if (page && !page.isClosed()) {
      try { await withDeadline(() => page.screenshot({ path: path.join(artifacts, 'failure.png'), timeout: 2000 }), 2500, 'UI failure screenshot'); }
      catch { /* Missing diagnostic screenshot is not an acceptance pass. */ }
    }
  }
  finally {
    imageFixture?.releasePreviews();
    try { if (browser) await withDeadline(() => browser.close(), 15000, 'UI browser close'); browser = null; } catch (error) { failure ||= error; report.cleanupError = error.message; }
    try { if (server) await withDeadline(() => server.close(), 10000, 'UI server close'); server = null; } catch (error) { failure ||= error; report.cleanupError = error.message; }
    if (!browser && !server) {
      const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(temporary));
      assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative)); fs.rmSync(temporary, { recursive: true, force: true });
    }
    if (failure) report.passed = false;
    fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  }
  if (failure) throw failure;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
