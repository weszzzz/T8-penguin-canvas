'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');

module.exports = async ({ browser, setupPage, closePage, start, stop, origin, artifacts, report }) => {
  const read = async url => {
    const response = await fetch(`${origin}${url}`);
    assert.equal(response.status, 200, url);
    const result = await response.json(); assert.equal(result.success, true);
    return result.data;
  };
  report.imageVideoGeneration = [];
  for (const kind of ['image', 'video']) {
    const canvasId = `${kind}-generation-canvas`, nodeId = `${kind}-generator`;
    const evidence = { kind, submissions: [], outputReceipts: [], stopped: null };
    report.imageVideoGeneration.push(evidence);
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const until = async (check, label) => {
      const deadline = Date.now() + 45000;
      do { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 150)); } while (Date.now() < deadline);
      evidence.body = (await page.locator('body').innerText()).slice(0, 12000);
      evidence.runs = await read(`/api/project-runs?projectId=history-project&canvasId=${canvasId}`);
      throw new Error(`${kind} generation: ${label}`);
    };
    const document = () => read(`/api/canvas/${canvasId}`);
    const history = () => read(`/api/project-runs/generation-history?projectId=history-project&canvasId=${canvasId}`);
    const runs = () => read(`/api/project-runs?projectId=history-project&canvasId=${canvasId}`);
    const media = label => `/files/output/generation-${label}.${kind === 'image' ? 'png' : 'mp4'}`;
    const result = label => kind === 'image'
      ? { status: 'completed', progress: '100%', urls: [media(label)] }
      : { status: 'succeeded', progress: '100%', videoUrl: media(label) };
    let pending;
    await setupPage(page, canvasId);
    await page.route(`**/api/proxy/${kind}/submit`, async route => {
      const body = route.request().postDataJSON(); evidence.submissions.push(body.prompt);
      const taskId = `${kind}-fixture-${evidence.submissions.length}`;
      await route.fulfill({ json: { success: true, data: { taskId, sync: false, status: 'pending', progress: '5%' } } });
    });
    await page.route(kind === 'image' ? '**/api/proxy/image/status/**' : '**/api/proxy/video/query?**', async route => {
      const url = new URL(route.request().url());
      const taskId = kind === 'image' ? url.pathname.split('/').pop() : url.searchParams.get('taskId');
      if (taskId === `${kind}-fixture-2`) { pending = route; return; }
      assert.ok([`${kind}-fixture-1`, `${kind}-fixture-3`].includes(taskId));
      await route.fulfill({ json: { success: true, data: result(taskId.endsWith('-1') ? 'a' : 'b') } });
    });
    page.on('response', response => {
      if (/\/api\/project-runs\/[^/]+\/nodes\/[^/]+\/outputs$/.test(new URL(response.url()).pathname)) evidence.outputReceipts.push(response.status());
    });
    const node = page.locator(`.react-flow__node[data-id="${nodeId}"]`);
    const generate = () => node.getByRole('button', { name: kind === 'image' ? '生成' : '生成视频', exact: true }).click();
    let previous = '', stable = 0;
    await until(async () => { const value = JSON.stringify(await document()); stable = value === previous ? stable + 1 : 0; previous = value; return stable >= 5; }, 'initial save settles');
    const edit = async value => {
      const textbox = node.getByRole('textbox');
      await textbox.click();
      await textbox.press('ControlOrMeta+A');
      await textbox.fill(value);
      assert.equal(await textbox.innerText(), value, 'editor must contain exactly the intended replacement');
      await textbox.press('Tab');
      await until(async () => (await document()).nodes.find(n => n.id === nodeId).data.prompt === value, 'prompt saved');
    };
    await generate();
    await until(async () => (await history()).groups.length === 1 && (await runs()).every(r => r.status === 'succeeded'), 'A success is durable');
    const first = (await history()).groups[0];
    assert.equal(first.promptPreview, `${kind} history A`);
    await edit(`${kind} stopped draft`); await generate();
    await until(() => Boolean(pending), 'second query pending');
    await node.getByRole('button', { name: /^停止/ }).click();
    await until(async () => (await document()).nodes.find(n => n.id === nodeId).data.status === 'idle', 'inline stop saved');
    const retained = (await document()).nodes.find(n => n.id === nodeId).data;
    assert.equal(retained[`${kind}Url`], media('a')); assert.equal(retained.lastPrompt, `${kind} history A`);
    await pending.fulfill({ json: { success: true, data: result('a') } });
    await until(async () => (await runs()).map(r => r.status).sort().join(',') === 'stopped,succeeded', 'stopped Run is durable');
    const stopped = (await runs()).find(r => r.status === 'stopped');
    const detail = await read(`/api/project-runs/${stopped.id}`);
    assert.equal(detail.nodeRuns.length, 1); assert.equal(detail.nodeRuns[0].status, 'stopped');
    assert.equal(detail.nodeRuns[0].attempts.length, 1); assert.equal(detail.nodeRuns[0].attempts[0].status, 'stopped');
    evidence.stopped = { runId: stopped.id, nodeRunId: detail.nodeRuns[0].id, attemptId: detail.nodeRuns[0].attempts[0].id };
    assert.deepEqual(evidence.outputReceipts, [201]); assert.equal((await history()).groups.length, 1);
    await page.screenshot({ path: path.join(artifacts, `${kind}-inline-stop.png`) });
    report.cases.push(`actual-${kind}-inline-stop-preserves-A-and-late-result-adds-no-history`);
    await edit(`${kind} history B`); await generate();
    await until(async () => (await history()).groups.length === 2 && (await runs()).map(r => r.status).sort().join(',') === 'stopped,succeeded,succeeded', 'B success durable');
    assert.deepEqual(evidence.submissions, [`${kind} history A`, `${kind} stopped draft`, `${kind} history B`]);
    assert.deepEqual(evidence.outputReceipts, [201, 201]);
    const runCompletedAt = Date.now();
    const atRunCompletion = (await document()).nodes.find(n => n.id === nodeId).data;
    evidence.canvasAtRunCompletion = { status: atRunCompletion.status, lastPrompt: atRunCompletion.lastPrompt, media: atRunCompletion[`${kind}Url`] };
    // Output ingestion and the Canvas's 800ms debounced save are separate
    // commits. This case promises reopening AFTER save, not abrupt page loss.
    await until(async () => {
      const data = (await document()).nodes.find(n => n.id === nodeId).data;
      return data.status === 'success' && data.lastPrompt === `${kind} history B` && data[`${kind}Url`] === media('b');
    }, 'latest successful B canvas save completes');
    evidence.canvasSaveAfterRunMs = Date.now() - runCompletedAt;
    const before = await document(), groups = (await history()).groups;
    assert.deepEqual(groups.map(g => g.promptPreview).sort(), [`${kind} history A`, `${kind} history B`]);
    assert.notEqual(groups[0].outputs[0].contentHash, groups[1].outputs[0].contentHash);
    report.cases.push(`actual-${kind}-two-button-generated-versions-have-distinct-durable-history`);
    await closePage(page); await stop(); await start();
    const reopened = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await setupPage(reopened, canvasId);
    await reopened.waitForFunction(() => document.querySelectorAll('[data-history-group]').length === 2);
    const after = await document();
    assert.equal(after.nodes.find(n => n.id === nodeId).data.status, 'success');
    assert.equal(after.nodes.find(n => n.id === nodeId).data[`${kind}Url`], media('b'));
    for (const key of ['prompt', 'lastPrompt', `${kind}Url`, `${kind}Urls`]) assert.deepEqual(after.nodes.find(n => n.id === nodeId).data[key], before.nodes.find(n => n.id === nodeId).data[key]);
    const restored = (await history()).groups;
    assert.deepEqual(restored.map(g => g.id).sort(), groups.map(g => g.id).sort());
    for (const group of restored) {
      const output = group.outputs[0]; const response = await fetch(new URL(output.mediaUrl, origin)); assert.equal(response.status, 200);
      assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), output.contentHash);
    }
    const savedStop = await read(`/api/project-runs/${stopped.id}`);
    assert.equal(savedStop.status, 'stopped'); assert.equal(savedStop.nodeRuns[0].status, 'stopped');
    assert.equal(savedStop.nodeRuns[0].attempts[0].status, 'stopped');
    assert.equal(savedStop.nodeRuns[0].id, evidence.stopped.nodeRunId); assert.equal(savedStop.nodeRuns[0].attempts[0].id, evidence.stopped.attemptId);
    const previews = reopened.locator(`[data-history-group] ${kind === 'image' ? 'img' : 'video'}`);
    assert.equal(await previews.count(), 2);
    for (const preview of await previews.all()) {
      if (kind === 'image') await preview.evaluate(image => image.decode());
      else {
        await preview.evaluate(async video => { video.muted = true; await video.play(); });
        await preview.evaluate(video => new Promise((resolve, reject) => { const deadline = Date.now() + 10000; const check = () => video.currentTime > 0 && video.videoWidth > 0 ? resolve() : Date.now() > deadline ? reject(new Error('Video did not advance')) : setTimeout(check, 100); check(); }));
        await preview.evaluate(video => video.pause());
      }
    }
    await reopened.screenshot({ path: path.join(artifacts, `${kind}-generation-restarted.png`) });
    assert.ok((await reopened.locator('.react-flow__node-output').innerText()).includes(`generation-b.${kind === 'image' ? 'png' : 'mp4'}`), 'output node must display B, not just preserve stale A across restart');
    report.cases.push(`actual-${kind}-history-media-and-stopped-hierarchy-survive-backend-restart`);
    report.controlledGenerationSubmissions += evidence.submissions.length;
    await closePage(reopened);
  }
};
