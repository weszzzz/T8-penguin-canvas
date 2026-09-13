'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');

module.exports = async ({ launch, closeWindow, dispose, setupPage, start, stop, origin, artifacts, report }) => {
  const read = async url => {
    const response = await fetch(`${origin}${url}`);
    assert.equal(response.status, 200, url);
    const body = await response.json(); assert.equal(body.success, true);
    return body.data;
  };
  const until = async (check, label) => {
    const deadline = Date.now() + 45000;
    do { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); } while (Date.now() < deadline);
    throw new Error(`Native generated-result close: ${label}`);
  };
  report.electronGeneratedClose = [];
  for (const kind of ['image', 'video']) {
    const canvasId = `${kind}-generation-canvas`, nodeId = `${kind}-generator`;
    const prompt = `${kind} freshly generated C before native close`;
    const media = `/files/output/generation-a.${kind === 'image' ? 'png' : 'mp4'}`;
    const document = () => read(`/api/canvas/${canvasId}`);
    const history = () => read(`/api/project-runs/generation-history?projectId=history-project&canvasId=${canvasId}`);
    const runs = () => read(`/api/project-runs?projectId=history-project&canvasId=${canvasId}`);
    const evidence = { kind, submissions: [], outputReceipts: [], phase: 'opening' };
    report.electronGeneratedClose.push(evidence);
    let page = await launch();
    try {
      await setupPage(page, canvasId);
      const node = page.locator(`.react-flow__node[data-id="${nodeId}"]`);
      const originalGroups = (await history()).groups;
      assert.equal(originalGroups.length, 2);
      const previousRunIds = new Set((await runs()).map(run => run.id));
      const prior = (await document()).nodes.find(n => n.id === nodeId).data;
      assert.ok(prior[`${kind}Url`].endsWith(kind === 'image' ? 'generation-b.png' : 'generation-b.mp4'));
      const textbox = node.getByRole('textbox');
      await textbox.click(); await textbox.press('ControlOrMeta+A'); await textbox.fill(prompt);
      assert.equal(await textbox.innerText(), prompt); await textbox.press('Tab');
      await until(async () => (await document()).nodes.find(n => n.id === nodeId).data.prompt === prompt, 'input draft saved before Run snapshot');
      await page.route(`**/api/proxy/${kind}/submit`, async route => {
        evidence.submissions.push(route.request().postDataJSON().prompt);
        await route.fulfill({ json: { success: true, data: { taskId: `${kind}-native-close-C`, sync: false, status: 'pending', progress: '5%' } } });
      });
      await page.route(kind === 'image' ? '**/api/proxy/image/status/**' : '**/api/proxy/video/query?**', route => route.fulfill({
        json: { success: true, data: kind === 'image'
          ? { status: 'completed', progress: '100%', urls: [media] }
          : { status: 'succeeded', progress: '100%', videoUrl: media } },
      }));
      page.on('response', response => {
        if (/\/api\/project-runs\/[^/]+\/nodes\/[^/]+\/outputs$/.test(new URL(response.url()).pathname)) evidence.outputReceipts.push(response.status());
      });
      // Hold only the NEW successful result. Earlier draft/running saves and
      // durable Run/output receipts still pass through production routes.
      let held;
      await page.route(`**/api/canvas/${canvasId}`, route => {
        if (route.request().method() !== 'PUT') return route.fallback();
        const data = route.request().postDataJSON()?.nodes?.find(n => n.id === nodeId)?.data;
        if (data?.lastPrompt === prompt && data?.status === 'success' && data?.[`${kind}Url`] === media) {
          assert.equal(held, undefined, 'only one CAS write can be in flight'); held = route; return;
        }
        return route.fallback();
      });
      evidence.phase = 'generating';
      await node.getByRole('button', { name: kind === 'image' ? '生成' : '生成视频', exact: true }).click();
      await until(async () => {
        const fresh = (await runs()).filter(run => !previousRunIds.has(run.id));
        return fresh.length === 1 && fresh[0].status === 'succeeded'
          && node.getByRole('button', { name: kind === 'image' ? '生成' : '生成视频', exact: true }).isVisible();
      }, `${kind} C Run succeeds`);
      evidence.generationObservedAt = Date.now();
      const beforeClose = (await document()).nodes.find(n => n.id === nodeId).data;
      assert.equal(beforeClose[`${kind}Url`], prior[`${kind}Url`]);
      assert.notEqual(beforeClose.lastPrompt, prompt, 'C must still be unsaved when native close is requested');
      evidence.persistedBeforeClose = { media: beforeClose[`${kind}Url`], lastPrompt: beforeClose.lastPrompt, status: beforeClose.status };
      const closing = page.waitForEvent('close', { timeout: 15000 });
      // Keep a timeout observed even if a different assertion fails first.
      void closing.catch(() => {});
      await closeWindow();
      evidence.closeRequestedAfterObservationMs = Date.now() - evidence.generationObservedAt;
      await until(() => !!held, 'native close flushes C save');
      assert.equal(page.isClosed(), false);
      await page.getByRole('status').filter({ hasText: '正在保存画布' }).waitFor({ timeout: 5000 });
      assert.notEqual((await document()).nodes.find(n => n.id === nodeId).data.lastPrompt, prompt);
      await held.continue();
      await closing;
      evidence.phase = 'closed-after-C-saved';
      assert.deepEqual(evidence.submissions, [prompt]);
      assert.deepEqual(evidence.outputReceipts, [201]);
      const saved = (await document()).nodes.find(n => n.id === nodeId).data;
      assert.equal(saved[`${kind}Url`], media); assert.equal(saved.lastPrompt, prompt); assert.equal(saved.status, 'success');
      const groups = (await history()).groups;
      assert.equal(groups.length, 3);
      assert.ok(originalGroups.every(old => groups.some(group => group.id === old.id)));
      assert.equal(groups.filter(group => group.promptPreview === prompt).length, 1);
      const freshRun = (await runs()).find(run => !previousRunIds.has(run.id));
      const detail = await read(`/api/project-runs/${freshRun.id}`);
      assert.equal(detail.nodeRuns.length, 1); assert.equal(detail.nodeRuns[0].attempts.length, 1);
      evidence.hierarchy = { run: freshRun.id, node: detail.nodeRuns[0].id, attempt: detail.nodeRuns[0].attempts[0].id };
      await dispose(); await stop(); await start();
      page = await launch(); await setupPage(page, canvasId);
      const reopened = (await document()).nodes.find(n => n.id === nodeId).data;
      for (const key of ['prompt', 'lastPrompt', 'status', `${kind}Url`, `${kind}Urls`]) assert.deepEqual(reopened[key], saved[key]);
      const restored = (await history()).groups;
      assert.deepEqual(restored.map(g => g.id).sort(), groups.map(g => g.id).sort());
      const run = await read(`/api/project-runs/${freshRun.id}`);
      assert.equal(run.status, 'succeeded'); assert.equal(run.nodeRuns[0].status, 'succeeded');
      assert.equal(run.nodeRuns[0].attempts[0].status, 'succeeded');
      assert.equal(run.nodeRuns[0].id, evidence.hierarchy.node); assert.equal(run.nodeRuns[0].attempts[0].id, evidence.hierarchy.attempt);
      await page.waitForFunction(() => document.querySelectorAll('[data-history-group]').length === 3);
      for (const group of restored) {
        const output = group.outputs[0]; const response = await fetch(new URL(output.mediaUrl, origin));
        assert.equal(response.status, 200);
        assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), output.contentHash);
      }
      const previews = page.locator(`[data-history-group] ${kind === 'image' ? 'img' : 'video'}`);
      assert.equal(await previews.count(), 3);
      for (const preview of await previews.all()) {
        if (kind === 'image') await preview.evaluate(image => image.decode());
        else {
          await preview.evaluate(async video => { video.muted = true; await video.play(); });
          await preview.evaluate(video => new Promise((resolve, reject) => {
            const deadline = Date.now() + 10000;
            const check = () => video.currentTime > 0 && video.videoWidth > 0 ? resolve()
              : Date.now() > deadline ? reject(new Error('Native historical video did not advance')) : setTimeout(check, 100);
            check();
          }));
          await preview.evaluate(video => video.pause());
        }
      }
      assert.ok((await page.locator('.react-flow__node-output').innerText()).includes(`generation-a.${kind === 'image' ? 'png' : 'mp4'}`));
      await page.screenshot({ path: path.join(artifacts, `electron-${kind}-fresh-C-restarted.png`) });
      evidence.phase = 'accepted'; evidence.historyCount = 3; evidence.restoredMedia = reopened[`${kind}Url`];
      report.controlledGenerationSubmissions += evidence.submissions.length;
      report.cases.push(`native-${kind}-fresh-generated-unsaved-C-close-and-process-restart-preserve-C-three-histories-and-success-hierarchy`);
      process.stdout.write(`[electron-generated-close] ${kind} accepted\n`);
    } catch (error) {
      evidence.failure = error.message;
      if (!page.isClosed()) {
        evidence.body = (await page.locator('body').innerText()).slice(0, 10000);
        await page.screenshot({ path: path.join(artifacts, `electron-${kind}-fresh-C-failure.png`) }).catch(() => {});
      }
      throw error;
    } finally { await dispose(); }
  }
};
