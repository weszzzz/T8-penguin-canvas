'use strict';
// UI-only fixture: real dialog/planner and PNG decoding, controlled asset index,
// loopback media and apply. No production database, Provider or persistence.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const path = require('node:path');

async function createFixture() {
  const sharp = require('sharp');
  const assets = [], buffers = new Map();
  for (const [index, background] of ['#f97316', '#2563eb'].entries()) {
    const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background } }).png().toBuffer();
    const asset = { id: `owned-image-${index}`, entityUid: `a1000000-0000-4000-8000-00000000000${index}`,
      projectId: 'owned-project', contentHash: createHash('sha256').update(bytes).digest('hex'), kind: 'image', availability: 'available' };
    assets.push(asset); buffers.set(asset.id, bytes);
  }
  let holding = true, failNext = false;
  const pending = [];
  const stats = { previewFailures: 0, heads: 0 };
  const isMediaPath = url => /^\/api\/project-assets\/owned-image-[01]\/media$/.test(url.pathname);
  const options = { gptImageQuality: 'xhigh', gptImageModeration: 'low', gptImage25Size: 'custom',
    gptImage25CustomWidth: 1536, gptImage25CustomHeight: 1024, gptImage25Count: 3, gptImage25Background: 'opaque' };
  const prompt = 'Use @image2 and @image3; keep @img2 literally.\n' + 'Original composition detail. '.repeat(45)
    + '\nImage adjustment requirements: original archived adjustment';
  const entry = `import React from 'react';import{createRoot}from'react-dom/client';
import Settings from '/src/components/GenerationHistorySettings.tsx';
import{prepareHistoryInputDraft,createHistoryInputDraftPatch}from'/src/utils/generationHistoryInputDraft.ts';
import i18n from '/src/i18n/index.ts';import '/src/styles/index.css';
import{applyThemeTemplate}from'/src/theme/applyTheme.ts';
import{BUILT_IN_THEME_TEMPLATES,TECH_TEMPLATE_ID}from'/src/theme/defaultTemplates.ts';
await i18n.changeLanguage('zh-CN');const theme=mode=>applyThemeTemplate(BUILT_IN_THEME_TEMPLATES.find(t=>t.id===TECH_TEMPLATE_ID),mode);theme('light');
const assets=${JSON.stringify(assets)},options=${JSON.stringify(options)},prompt=${JSON.stringify(prompt)};
const scope={projectId:'owned-project',canvasId:'owned-canvas'},uid='b1000000-0000-4000-8000-000000000001';
const group={id:'owned-input-history',nodeId:'deleted-source',nodeEntityUid:uid,nodeType:'image',snapshotAvailable:true,sourceNodeExists:false};
const context={schema:'t8-image-frontend-context-v2',origin:'frontend-common-context',prompt,
 referenceImages:['/files/input/blue.png','/files/input/orange.png','/files/input/blue.png'],basicSettings:{model:'gpt-image-2',apiModel:'gpt-image-2.5-flare',
 aspectRatio:'16:9',sizeLevel:'2K',imageBuiltinSource:'zhenzhen',providerSource:'zhenzhen',providerId:'',providerModel:'',...options}};
const archive={status:'available',digest:'owned-verified-fixture',binding:{...scope,nodeId:group.nodeId,nodeEntityUid:uid},
 snapshot:{node:{id:group.nodeId,type:'image',data:{prompt:'old local',imageUrl:'/old-output.png',taskId:'old-task',imagePromptAdjustments:[{id:'do-not-copy'}],historyResolvedInput:context}},upstreamNodes:[],incomingEdges:[]},
 references:{status:'captured',entries:[1,0,1].map((assetIndex,index)=>({status:'bound',path:['node','data','historyResolvedInput','referenceImages',index],
 assetId:assets[assetIndex].id,entityUid:assets[assetIndex].entityUid,contentHash:assets[assetIndex].contentHash,kind:'image'}))}};
const state=window.draftFixture={calls:[],lookups:[],original:JSON.stringify(archive),unsupported:false,
 async setLanguage(locale,mode){await i18n.changeLanguage(locale);theme(mode);}};
const prepare=async()=>{const selected=structuredClone(archive);if(state.unsupported)selected.snapshot.node.data.historyResolvedInput.basicSettings.apiModel='gpt-image-2-fal';
const draft=await prepareHistoryInputDraft(selected,group,scope,{assertCurrent(){},getAsset:async id=>{state.lookups.push(id);return assets.find(asset=>asset.id===id);},
request:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(10000)})});
state.fields=draft.fields.map(field=>({key:field.key,advanced:field.advanced}));const patch=createHistoryInputDraftPatch(draft,{...scope,id:'same-approved-draft',baseRevision:1,position:{x:0,y:0}});
return{...draft,apply:async()=>{state.calls.push(patch);await new Promise((resolve,reject)=>{state.finish=ok=>ok?resolve():reject(new Error('Controlled apply failure'));});}}};
state.unchanged=()=>JSON.stringify(archive)===state.original;
createRoot(document.getElementById('root')).render(<main style={{padding:20}}><Settings group={group} prepare={prepare} newDraft/></main>);`;
  return { entry, assets, options, prompt, isMediaPath, stats,
    releasePreviews() { holding = false; for (const send of pending.splice(0)) send(); },
    failOnePreview() { failNext = true; },
    serve(request, response) {
      const url = new URL(request.url, 'http://fixture');
      if (!isMediaPath(url)) return false;
      const asset = assets.find(item => url.pathname.includes(`/${item.id}/`));
      const valid = ['GET', 'HEAD'].includes(request.method)
        && ['projectId', 'entityUid', 'contentHash'].every(key => url.searchParams.get(key) === asset[key]);
      response.setHeader('Cache-Control', 'no-store');
      if (!valid) { response.writeHead(409); response.end('Wrong fixture identity'); return true; }
      if (request.method === 'HEAD') { stats.heads++; response.writeHead(200); response.end(); return true; }
      const send = () => {
        if (response.destroyed) return;
        if (failNext) { failNext = false; stats.previewFailures++; response.writeHead(404); response.end('Controlled preview failure'); return; }
        response.setHeader('Content-Type', 'image/png'); response.end(buffers.get(asset.id));
      };
      if (holding) pending.push(send); else send();
      return true;
    },
  };
}

async function verify(page, report, artifacts, fixture) {
  const open = page.locator('.t8-history-settings-open'); await open.waitFor({ timeout: 120000 });
  const dialog = page.locator('dialog'), cancel = dialog.locator('footer button').first(), confirm = dialog.locator('footer button').last();
  const snapshot = () => page.evaluate(() => ({ calls: window.draftFixture.calls, lookups: window.draftFixture.lookups, unchanged: window.draftFixture.unchanged() }));
  await open.click(); await dialog.waitFor({ state: 'visible' });
  assert.equal(await dialog.locator('img').count(), 3); assert.equal(await confirm.isDisabled(), true);
  // Inject on the first held GET, not after successful images may already be
  // decoded/cached. A reopened image need not issue a new network request.
  fixture.failOnePreview(); fixture.releasePreviews();
  await dialog.getByRole('alert').waitFor(); assert.equal(await confirm.isDisabled(), true);
  assert.equal(fixture.stats.previewFailures, 1);
  assert.equal((await snapshot()).calls.length, 0); await cancel.click();
  await open.click(); await page.waitForFunction(() => [...document.querySelectorAll('dialog img')].length === 3
    && [...document.querySelectorAll('dialog img')].every(image => image.complete && image.naturalWidth === 16));
  assert.equal(await confirm.isEnabled(), true); await cancel.click(); assert.equal((await snapshot()).calls.length, 0);
  await open.click(); await page.waitForFunction(() => [...document.querySelectorAll('dialog img')].length === 3
    && [...document.querySelectorAll('dialog img')].every(image => image.complete && image.naturalWidth === 16));
  assert.equal(await confirm.isEnabled(), true);
  const urls = await dialog.locator('img').evaluateAll(images => images.map(image => image.getAttribute('src')));
  assert.deepEqual(urls.map(url => new URL(url, 'http://fixture').pathname),
    ['/api/project-assets/owned-image-1/media', '/api/project-assets/owned-image-0/media', '/api/project-assets/owned-image-1/media']);
  assert.equal(new Set(urls).size, 3);
  const extra = dialog.locator('.t8-history-settings-fields > details'); assert.equal(await extra.evaluate(element => element.open), false);
  await extra.locator('summary').click();
  const fields = await page.evaluate(() => window.draftFixture.fields.filter(field => field.advanced));
  assert.equal(fields.length, 3);
  const reviewFields = await page.evaluate(() => window.draftFixture.fields);
  assert.equal(reviewFields.some(field => ['aspectRatio', 'sizeLevel', 'providerId', 'providerModel', 'providerSource'].includes(field.key)), false);
  for (const key of ['gptImage25Size', 'gptImage25Count', 'gptImage25CustomWidth', 'gptImage25CustomHeight']) {
    assert.equal(reviewFields.find(field => field.key === key)?.advanced, undefined);
  }
  const values = await dialog.locator('.t8-history-settings-fields section pre').allTextContents();
  for (const value of Object.values(fixture.options)) assert.ok(values.includes(String(value)), String(value));
  const readBounds = () => dialog.evaluate(element => {
    const rect = element.getBoundingClientRect(), footer = element.querySelector('footer').getBoundingClientRect();
    const content = element.querySelector('.t8-history-settings-content');
    return { left: rect.left, right: rect.right, bottom: rect.bottom, top: rect.top, footerBottom: footer.bottom,
      horizontalOverflow: content.scrollWidth > content.clientWidth + 1, scrollable: content.scrollHeight > content.clientHeight };
  });
  const checkBounds = bounds => assert.ok(bounds.left >= 0 && bounds.right <= 391 && bounds.top >= 0 && bounds.bottom <= 721
    && bounds.footerBottom <= 721 && !bounds.horizontalOverflow && bounds.scrollable, JSON.stringify(bounds));
  await extra.locator('section').last().scrollIntoViewIfNeeded(); const chineseBounds = await readBounds(); checkBounds(chineseBounds);
  await page.screenshot({ path: path.join(artifacts, 'image-input-zh-light.png') });
  await extra.locator('summary').click(); await dialog.locator('.t8-history-input-references').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(artifacts, 'image-input-references.png') });
  await extra.locator('summary').click();
  const beforeLocale = await snapshot();
  await page.evaluate(() => window.draftFixture.setLanguage('en-US', 'dark'));
  await dialog.getByText('Create draft, do not generate', { exact: true }).waitFor();
  assert.equal(await extra.evaluate(element => element.open), true);
  assert.deepEqual(await snapshot(), beforeLocale, 'locale switch must not prepare/apply again');
  const englishBounds = await readBounds(); checkBounds(englishBounds);
  await page.screenshot({ path: path.join(artifacts, 'image-input-en-dark.png') });
  await confirm.click(); await page.waitForFunction(() => window.draftFixture.calls.length === 1);
  assert.equal(await confirm.isDisabled(), true); assert.equal(await cancel.isDisabled(), true);
  await page.evaluate(() => window.draftFixture.finish(false)); await dialog.getByRole('alert').getByText('Controlled apply failure', { exact: true }).waitFor();
  assert.equal(await dialog.isVisible(), true);
  await confirm.click(); await page.waitForFunction(() => window.draftFixture.calls.length === 2);
  await page.evaluate(() => window.draftFixture.finish(true)); await dialog.waitFor({ state: 'hidden' });
  const after = await snapshot(); assert.equal(after.unchanged, true); assert.deepEqual(after.calls[0], after.calls[1]);
  const patch = after.calls[0]; assert.equal(patch.requiresConfirmation, true); assert.equal(patch.operations.length, 1); assert.equal(patch.operations[0].type, 'node.add');
  const node = patch.operations[0].payload.node; assert.equal(node.type, 'image'); assert.notEqual(node.id, 'deleted-source');
  assert.equal(node.data.prompt, fixture.prompt); assert.deepEqual(node.data.referenceImages, urls);
  for (const [key, value] of Object.entries(fixture.options)) assert.deepEqual(node.data[key], value);
  assert.deepEqual(node.data.promptMentions.map(mention => mention.url), [urls[1], urls[2]]);
  for (const key of ['imagePromptAdjustments', 'historyResolvedInput', 'taskId', 'imageUrl', 'providerParams', 'apiKey', 'localRefImages']) assert.equal(Object.hasOwn(node.data, key), false);
  await page.evaluate(() => { window.draftFixture.unsupported = true; }); await open.click();
  await page.getByRole('alert').getByText('Full input recovery is not yet supported for this image provider.', { exact: true }).waitFor();
  assert.equal(await dialog.isVisible(), false); assert.deepEqual(await snapshot(), after);
  report.cases.push({ id: 'standard-image-input', localeSwitch: 'zh-CN/light -> en-US/dark', chineseBounds, englishBounds,
    orderedReferenceSlots: 3, advancedCount: 3, effectiveSizePrimary: true, pendingPreviewBlocksConfirm: true, failedPreviewBlocksConfirm: true,
    controlledPreviewFailures: fixture.stats.previewFailures,
    cancelCalls: 0, controlledApplyCalls: 2, retryPatchUnchanged: true, unsupportedBeforeAssetReads: true,
    persistenceVerified: false });
}
module.exports = { createFixture, verify };
