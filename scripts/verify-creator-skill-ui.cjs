'use strict';

// Isolated real-browser component verification. No production backend, settings,
// project database, credentials, or paid model is read or contacted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { chromium } = require('playwright');
const express = require('express');
const { CreatorSkillStore } = require('../backend/src/services/creatorSkillStore');
const { buildSkillPackage, CreatorSkillError } = require('../backend/src/services/creatorSkillPackages');
const { bundledCreatorSkillOptions } = require('../backend/src/services/creatorSkillBundled');
const { createCreatorSkillRouter } = require('../backend/src/routes/creatorSkills');
const { buildSkillReadiness } = require('../backend/src/services/creatorSkillReadiness');
const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS = path.join(ROOT, 'artifacts', 'creator-skill-ui');

const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import Panel from '/src/components/CreatorAgentPanelV2.tsx';
import '/src/styles/index.css';
const query = new URLSearchParams(location.search);
const dark = query.get('theme') === 'dark';
await i18n.use(initReactI18next).init({ lng: query.get('lang') || 'zh-CN', fallbackLng: 'zh-CN', resources: {}, interpolation: { escapeValue: false } });
const tokens = { panelBg: dark ? '#111318' : '#fffdf9', panelBgElevated: dark ? '#181b22' : '#f4f1ea', panelBgMuted: dark ? '#20242d' : '#eae6dd', textMain: dark ? '#f5f7fb' : '#222520', textMuted: dark ? '#a7adba' : '#62695e', border: dark ? '#394039' : '#d3d8cc', accent: dark ? '#8cff3f' : '#327542', accentText: dark ? '#102000' : '#ffffff', danger: '#c84444', success: '#327542', warning: '#b38a29', fontFamily: 'Arial, sans-serif' };
document.body.style.background = dark ? '#080a0d' : '#e7ebe3';
createRoot(document.getElementById('root')).render(React.createElement(Panel, { projectId: 'ui-project', canvasId: 'ui-canvas', selectedNodeIds: ['reference-node'], selectedNodes: [{id:'reference-node',type:'text',label:'商品要求'}], availableNodeIds: ['reference-node'], visualStyle: 'plain', themeMode: dark ? 'dark' : 'light', themeTokens: tokens, onFocusNode: () => {}, onOpenApiSettings: () => { document.body.dataset.fixtureApiSettingsOpened = 'true'; }, initialOpen: true }));
`;

async function main() {
  const { createServer } = await import('vite');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 't8-skill-ui-vite-'));
  const portProbe = net.createServer();
  await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
  const port = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  let skillApp;
  const server = await createServer({ root: ROOT, configFile: false, cacheDir: temporary, esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: ['src/components/CreatorAgentPanelV2.tsx'], include: ['react', 'react-dom/client', 'i18next', 'react-i18next'] },
    server: { host: '127.0.0.1', port, strictPort: true },
    plugins: [{ name: 'isolated-creator-skill-ui',
      resolveId(id) { if (id === '/skill-ui-entry.js') return '\0skill-ui-entry.js'; },
      load(id) { if (id === '\0skill-ui-entry.js') return entry; },
      configureServer(vite) { vite.middlewares.use((req, res, next) => {
        if (req.url.startsWith('/api/creator-agent/v2/skills') && skillApp) return skillApp(req, res, next);
        if (!req.url.startsWith('/__skill_ui')) return next();
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/skill-ui-entry.js"></script></body></html>');
      }); },
    }],
  });
  let browser;
  const report = { schema: 't8-creator-skill-ui-evidence-v1', scope: 'isolated-real-browser-real-skill-http-mock-conversation-provider', realSkillHttp: true, productionBackend: false, paidCalls: 0, cases: [] };
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    assert.equal((await fetch(`${origin}/__skill_ui`)).status, 200);
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    for (const config of [{ name: 'light-desktop', width: 1366, height: 900, theme: 'light', lang: 'zh-CN' },
      { name: 'dark-desktop', width: 1366, height: 900, theme: 'dark', lang: 'zh-CN' },
      { name: 'english-narrow', width: 390, height: 844, theme: 'light', lang: 'en' }]) {
      const page = await browser.newPage({ viewport: { width: config.width, height: config.height } });
      const errors = [];
      const requests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => requests.push(request.url().replace(origin, '')));
      const calls = [];
      let rejectPrepare = true;
      let fixtureConfigured = true;
      const skillScope = { projectId: 'ui-project', actorId: 'local-owner' };
      const skillStore = new CreatorSkillStore({ root: path.join(temporary, config.name), ...bundledCreatorSkillOptions() });
      const initialItem = skillStore.installPrivate(skillScope, buildSkillPackage([{ path: 'SKILL.md', bytes: Buffer.from('---\nname: product-prompt-method\ndescription: Preserve product facts and write a complete prompt.\nmetadata:\n  version: "1"\n---\nOriginal instructions. <img src="https://must-not-load.invalid/leak">') }]));
      skillApp = express();
      skillApp.use(express.json({ limit: '1mb' }));
      // Scope/session/media are fixture data, while model planning and installed
      // package validation use the production helpers. No credentials are read.
      skillApp.post('/api/creator-agent/v2/skills/:id/preflight', (req, res) => {
        if (req.body.projectId !== 'ui-project' || req.body.canvasId !== 'ui-canvas') return res.status(404).json({ ok: false });
        const loaded = skillStore.load(skillScope, req.params.id, req.body.packageDigest);
        const materials = (req.body.attachments || []).map(item => ({ assetId: item.assetId, kind: item.kind, title: 'My product', contentRevision: 1 }));
        const readiness = buildSkillReadiness(loaded, { providerId: 'auto' }, fixtureConfigured ? { zhenzhenSd2ApiKey: 'fixture-only' } : {}, materials);
        return res.json({ ok: true, data: { readiness, materials, generated: false } });
      });
      skillApp.use('/api/creator-agent/v2/skills', createCreatorSkillRouter({ getStore: () => skillStore, requireScope: input => {
        if (input.projectId !== 'ui-project' || input.canvasId !== 'ui-canvas') throw new CreatorSkillError('SCOPE_NOT_FOUND', 'Unknown fixture scope', 404);
        return skillScope;
      } }));
      const conversation = { schema: 't8-creator-conversation-v2', id: 'ui-session', projectId: 'ui-project', canvasId: 'ui-canvas', title: 'UI test', phase: 'idea', status: 'active', sequence: 0, workingBrief: {}, phaseEvidence: {}, currentSceneId: null, createdAt: 1, updatedAt: 1 };
      let messages = [];
      const fullText = 'A complete product prompt. Keep every product detail.\n'.repeat(100);
      await page.addInitScript(() => {
        window.EventSource = class { addEventListener() {} removeEventListener() {} close() {} };
        localStorage.setItem('t8.creator-agent.v2.draft.ui-project.ui-canvas', JSON.stringify({ schema: 't8-creator-agent-v2-composer-draft-v1', draft: 'Keep my unsent draft', attachments: [{assetId:'input-asset',kind:'image',title:'My product'}], selectedNodeIds: ['reference-node'], selectedNodes: [{id:'reference-node',type:'text',label:'Product requirements'}], creationMode: 'auto' }));
      });
      await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const endpoint = url.pathname.replace('/api/creator-agent/v2', '');
        calls.push({ endpoint, method: request.method() });
        const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ schema: 't8-creator-agent-http-v2', ok: true, data }) });
        if (url.pathname.startsWith('/api/project-assets/')) return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1kAAAAASUVORK5CYII=', 'base64') });
        if (endpoint === '/skills' || endpoint.startsWith('/skills/')) {
          if (endpoint.endsWith('/prepare') && rejectPrepare) {
            rejectPrepare = false;
            return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'CREATOR_SKILL_VERSION_STALE', message: 'Version changed' }) });
          }
          return route.continue();
        }
        if (endpoint === '/settings') return json({ preferences: { providerId: 'auto', llm: null, image: null, video: null, catalogDigest: 'a'.repeat(64) } });
        if (endpoint === '/settings/catalog') return json({ catalogDigest:'a'.repeat(64), providers:[], llm:[{providerId:'seedance-nz',modelId:'test-llm',label:'Test LLM',providerLabel:'Test',family:'llm',configured:true,recommended:true,visionCapable:true}], image:[],video:[] });
        if (endpoint === '/sessions') return request.method() === 'POST' ? json({ conversation }, 201) : json({ items: [], nextBefore: null });
        if (endpoint.endsWith('/scenes')) return json({total:0,scenes:[],currentSceneId:null,work:{revision:0,digest:null}});
        if (endpoint.endsWith('/messages')) {
          const input = request.postDataJSON();
          assert.ok(input.skill, 'sending the selected skill must include its task identity');
          assert.equal(input.skill.id, initialItem.id);
          assert.equal(input.skill.packageDigest, initialItem.packageDigest);
          assert.equal(input.text, 'Keep my unsent draft');
          assert.equal(input.attachments[0].assetId, 'input-asset');
          const binding = {schema:'t8-creator-skill-binding-v1',selection:input.skill,title:initialItem.title,version:'1',origin:'private',adapterId:'text-v1',projectId:'ui-project',canvasId:'ui-canvas',contextDigest:'c'.repeat(64),referenceOnly:false,assets:[],nodes:[],bindingDigest:'d'.repeat(64)};
          const common = { sessionId:'ui-session',status:'completed',suggestions:[],actionId:null,media:[],selectedNodes:[],errorCode:null,createdAt:1,updatedAt:1,skillBinding:binding };
          messages = [{...common,id:'ui-user',sequence:1,role:'user',body:input.text,responseId:null,replyToMessageId:null,media:input.attachments},
            {...common,id:'ui-assistant',sequence:2,role:'assistant',body:'Your full prompt is ready.',responseId:`response-${input.clientRequestId}`,replyToMessageId:'ui-user',skillOutput:{schema:'t8-creator-skill-output-v1',title:'Complete prompt',body:fullText,status:'text-produced',skillBindingDigest:binding.bindingDigest}}];
          return json({conversation:{...conversation,sequence:2},messages,pendingAction:null,nextBeforeSequence:null,assistant:messages[1],evidence:{providerCalls:0}},201);
        }
        if (endpoint === '/sessions/ui-session') return json({conversation,messages,pendingAction:null,nextBeforeSequence:null});
        throw new Error(`Unexpected fixture request: ${endpoint}`);
      });
      await page.goto(`${origin}/__skill_ui?theme=${config.theme}&lang=${config.lang}`, { waitUntil: 'commit' });
      const english = config.lang === 'en';
      const composer = page.locator('[data-creator-agent-composer]');
      try { await composer.waitFor({ timeout: 45_000 }); } catch (error) {
        await page.screenshot({ path: path.join(ARTIFACTS, 'failure.png') });
        console.error(JSON.stringify({ errors, requests: requests.slice(-30), body: (await page.locator('body').innerText()).slice(0, 1500) }));
        throw error;
      }
      await page.getByRole('button', { name: english ? 'Skill library' : '技能市场', exact: true }).click();
      await page.getByRole('heading', { name: english ? 'Product hero image' : '商品主视觉', exact: true }).waitFor();
      assert.equal(await page.locator('.t8-skill-market__card').count(), 3);
      await page.screenshot({ path: path.join(ARTIFACTS, `${config.name}-featured.png`) });
      const featuredTab = page.getByRole('tab', { name: english ? 'Featured' : '精选', exact: true });
      await featuredTab.focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.getByRole('tab', { name: english ? 'My skills' : '我的', exact: true }).getAttribute('aria-selected'), 'true');
      assert.equal(await composer.evaluate(element => !!element.closest('[inert]')), true, 'covered composer must be inert');
      await page.getByRole('button', { name: english ? 'Close skill library' : '关闭技能市场' }).focus();
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.getByRole('button', { name: english ? 'Import folder' : '导入文件夹' }).evaluate(element => element === document.activeElement), true, 'modal focus wraps at its boundary');
      await page.getByRole('button', { name: english ? 'Use this method' : '用这个创作', exact: true }).waitFor();
      await page.screenshot({ path: path.join(ARTIFACTS, `${config.name}-market.png`) });
      const overflow = await page.locator('.t8-skill-market').evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth, height: element.clientHeight }));
      assert.ok(overflow.scrollWidth <= overflow.width + 1, 'market must not overflow horizontally');
      await page.getByRole('button', { name: english ? 'Details' : '详情', exact: true }).click();
      await page.locator('.t8-skill-market details summary').click();
      assert.equal(await page.locator('.t8-skill-market pre img').count(), 0, 'untrusted HTML must remain text');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: english ? 'Use this method' : '用这个创作', exact: true }).click();
      await page.locator('.t8-skill-market__error').waitFor();
      assert.equal(await composer.inputValue(), 'Keep my unsent draft', 'stale version must retain draft');
      assert.equal(calls.filter(call => call.endpoint.endsWith('/messages')).length, 0);
      await page.getByRole('button', { name: english ? 'Use this method' : '用这个创作', exact: true }).click();
      await page.locator('.t8-creator-v2-skill-chip').waitFor();
      assert.equal(await composer.evaluate(element => !!element.closest('[inert]')), false, 'closing restores composer interaction');
      assert.equal(await composer.inputValue(), 'Keep my unsent draft');
      assert.equal(calls.filter(call => call.endpoint.endsWith('/messages')).length, 0, 'using a skill must not send');
      await page.getByRole('region', { name: english ? 'Skill preparation' : '本次技能准备情况' }).waitFor();
      assert.equal(await page.locator('.t8-skill-readiness__materials img').getAttribute('src'), '/api/project-assets/input-asset/media');
      const preflightCount = calls.filter(call => call.endpoint.endsWith('/preflight')).length;
      await composer.fill('Typing should not trigger a model preflight');
      await composer.fill('Keep my unsent draft');
      assert.equal(calls.filter(call => call.endpoint.endsWith('/preflight')).length, preflightCount);
      await page.getByRole('button', { name: english ? 'Send' : '发送', exact: true }).click();
      await page.locator('.t8-skill-output').waitFor();
      assert.equal(await page.locator('.t8-creator-v2-skill-chip').count(), 0, 'ordinary next turn must not inherit a skill');
      await page.locator('.t8-skill-output summary').click();
      assert.equal(await page.locator('.t8-skill-output pre').textContent(), fullText);
      await page.screenshot({ path: path.join(ARTIFACTS, `${config.name}-work.png`) });
      await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }); });
      await page.getByRole('button', { name: english ? 'Copy full text' : '复制全文', exact: true }).click();
      await page.getByText(english ? 'Could not copy. Expand the work and select its text manually.' : '未能复制，请展开作品后手动选择文字。', { exact: true }).waitFor();
      await page.getByRole('button', { name: english ? 'Refine' : '继续修改', exact: true }).click();
      await page.locator('.t8-creator-v2-skill-chip').waitFor();
      assert.equal(calls.filter(call => call.endpoint.endsWith('/messages')).length, 1, 'refine must prepare, not send');
      const refineDraft = await composer.inputValue();
      await page.getByRole('button', { name: english ? 'Skill library' : '技能市场', exact: true }).click();
      await page.locator('.t8-skill-market input[type=file]').first().setInputFiles({ name: 'SKILL.md', mimeType: 'text/markdown', buffer: Buffer.from('---\nname: imported\ndescription: Test prompt method.\n---\nPreserve facts.') });
      const importedCard = page.locator('.t8-skill-market__card').filter({ has: page.getByRole('heading', { name: 'imported', exact: true }) });
      await importedCard.getByRole('button', { name: english ? 'Details' : '详情', exact: true }).click();
      await page.getByRole('button', { name: english ? 'Remove, keep existing work' : '移除，保留旧作品', exact: true }).click();
      await page.locator('.t8-skill-market__notice').waitFor();
      assert.equal(await importedCard.count(), 0);
      await page.keyboard.press('Escape');
      assert.equal(await composer.inputValue(), refineDraft, 'library management preserves an existing continuation draft');
      assert.equal(await page.locator('.t8-creator-v2-skill-chip').count(), 1);
      assert.equal(calls.filter(call => call.endpoint.endsWith('/messages')).length, 1, 'import and removal do not create a turn');
      assert.equal(skillStore.list(skillScope).length, 1, 'the real store removed only the imported test package');
      await page.getByRole('button', { name: english ? 'Skill library' : '技能市场', exact: true }).click();
      const officialCard = page.locator('.t8-skill-market__card').filter({ has: page.getByRole('heading', { name: english ? 'Product hero image' : '商品主视觉', exact: true }) });
      fixtureConfigured = false;
      await officialCard.getByRole('button', { name: english ? 'Use this method' : '用这个创作', exact: true }).click();
      await page.locator('.t8-skill-market').waitFor({ state: 'detached' });
      assert.equal(skillStore.list(skillScope).find(item => item.origin === 'official').adapterId, 'image-v1');
      assert.equal(await composer.inputValue(), refineDraft, 'installing a signed method preserves the draft');
      assert.equal(calls.filter(call => call.endpoint.endsWith('/messages')).length, 1);
      const setup = page.locator('.t8-skill-readiness').getByRole('button', { name: english ? 'Set up API' : '配置 API', exact: true });
      await setup.click();
      assert.equal(await page.locator('body').getAttribute('data-fixture-api-settings-opened'), 'true');
      assert.equal(await composer.inputValue(), refineDraft, 'opening API settings must not clear the prepared task');
      await page.screenshot({ path: path.join(ARTIFACTS, `${config.name}-readiness.png`) });
      assert.equal(requests.some(url => url.includes('must-not-load.invalid')), false);
      assert.deepEqual(errors, []);
      report.cases.push({ name: config.name, passed: true, overflow, messagePosts: 1, browserErrors: errors,
        verified: ['signed-bundled-directory-and-install', 'keyboard-tabs', 'modal-focus-and-inert-restoration', 'stale-version-draft-preserved', 'use-does-not-send', 'full-text-delivery', 'copy-api-unavailable', 'explicit-refinement', 'real-import-remove-keeps-draft', 'untrusted-html-no-remote-request', 'scoped-material-preview', 'typing-no-preflight', 'api-settings-keeps-draft'] });
      await page.close();
    }
    fs.writeFileSync(path.join(ARTIFACTS, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await browser?.close(); await server.close(); fs.rmSync(temporary, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
