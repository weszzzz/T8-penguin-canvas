'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');

module.exports = async function verifyActualGeneration({ page, browser, setupPage, closePage, start, stop, origin, artifacts, report }) {
  const canvasId = 'generation-canvas';
  const prompts = ['History acceptance version A', 'History acceptance version B'];
  const expectedSubmissions = [prompts[0], 'History acceptance failed attempt', 'History acceptance stopped attempt', prompts[1]];
  let pendingStopRoute;
  const submissions = [];
  const outputReceipts = [];
  const requests = [];
  report.actualGeneration = { submissions, outputReceipts, requests };
  const read = async url => {
    const response = await fetch(`${origin}${url}`);
    assert.equal(response.status, 200, url);
    const result = await response.json(); assert.equal(result.success, true, url);
    return result.data;
  };
  const document = () => read(`/api/canvas/${canvasId}`);
  const history = () => read(`/api/project-runs/generation-history?projectId=history-project&canvasId=${canvasId}`);
  const until = async (check, description) => {
    const deadline = Date.now() + 45000;
    do {
      if (await check()) return;
      await new Promise(resolve => setTimeout(resolve, 150));
    } while (Date.now() < deadline);
    report.actualGeneration.logs = await page.evaluate(async () => {
      const { useLogStore } = await import('/src/stores/logs.ts');
      return useLogStore.getState().entries.slice(-20).map(({ level, source, message }) => ({ level, source, message }));
    });
    report.actualGeneration.runs = (await read(`/api/project-runs?projectId=history-project&canvasId=${canvasId}`)).map(({ status }) => ({ status }));
    throw new Error(`Actual generation acceptance timed out: ${description}`);
  };
  // setupPage rejects every off-origin request; no production proxy is mounted
  // in the isolated backend. Exactly these two known transport endpoints are
  // replaced, never Canvas/Run/NodeRun/Attempt/Host-output persistence.
  await setupPage(page, canvasId);
  await page.route('**/api/proxy/seedance/submit', async route => {
    assert.equal(route.request().method(), 'POST');
    const payload = route.request().postDataJSON();
    assert.equal(payload.prompt, expectedSubmissions[submissions.length]);
    assert.ok(submissions.length < expectedSubmissions.length, 'No unrequested generation');
    submissions.push(payload.prompt);
    await route.fulfill({ json: { success: true, data: { taskId: `fixture-${submissions.length}`, taskProvider: 'zhenzhen-legacy', model: payload.model, taskType: 't2v' } } });
  });
  await page.route('**/api/proxy/seedance/query?*', async route => {
    const id = new URL(route.request().url()).searchParams.get('taskId');
    assert.ok(['fixture-1', 'fixture-2', 'fixture-3', 'fixture-4'].includes(id));
    if (id === 'fixture-2') {
      await route.fulfill({ json: { success: true, data: { status: 'failed', failReason: 'Controlled generation failure' } } });
      return;
    }
    if (id === 'fixture-3') { pendingStopRoute = route; return; }
    await route.fulfill({ json: { success: true, data: { status: 'succeeded', taskProvider: 'zhenzhen-legacy',
      videoUrl: `/files/output/generation-${id === 'fixture-1' ? 'a' : 'b'}.mp4` } } });
  });
  page.on('response', response => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.startsWith('/api/project-runs') && response.request().method() !== 'GET' && requests.length < 100) requests.push({ path: pathname, status: response.status() });
    if (/\/api\/project-runs\/[^/]+\/nodes\/[^/]+\/outputs$/.test(pathname)) outputReceipts.push(response.status());
  });
  const node = page.locator('.react-flow__node[data-id="actual-generator"]');
  // Observe the real initial save settling before the first user action. Keep
  // every production preflight/revision guard active; this is not a retry of
  // a refused Run or permission to ignore edits during dispatch.
  let initialDocument = '', unchangedReads = 0;
  await until(async () => {
    const current = JSON.stringify(await document());
    unchangedReads = current === initialDocument ? unchangedReads + 1 : 0;
    initialDocument = current;
    return unchangedReads >= 5;
  }, 'initial persisted canvas settles');
  const archived = [];
  const editPrompt = async prompt => {
    await node.getByRole('textbox').fill(prompt);
    await node.getByRole('textbox').press('Tab');
    await until(async () => (await document()).nodes.find(item => item.id === 'actual-generator').data.prompt === prompt, 'edited prompt saved');
  };
  const checkPrevious = async () => {
    const data = (await document()).nodes.find(item => item.id === 'actual-generator').data;
    assert.equal(data.videoUrl, '/files/output/generation-a.mp4');
    assert.deepEqual(data.videoUrls, ['/files/output/generation-a.mp4']);
    assert.equal(data.lastPrompt, prompts[0]);
    assert.equal((await history()).groups.length, 1);
    assert.deepEqual(outputReceipts, [201]);
    const output = page.locator('.react-flow__node-output');
    assert.equal(await output.count(), 1);
    assert.ok((await output.innerText()).includes(prompts[0]), 'retained video must show its original generation prompt');
    for (const draft of expectedSubmissions.slice(1)) assert.ok(!(await output.innerText()).includes(draft), 'new input must not be displayed as old video attribution');
  };
  for (let index = 0; index < prompts.length; index += 1) {
    if (index) {
      await editPrompt(expectedSubmissions[1]);
      await checkPrevious();
      await node.getByRole('button', { name: '生成视频', exact: true }).click();
      await node.locator('[data-previous-generation-notice]').filter({ hasText: '本次生成未成功' }).waitFor();
      await until(async () => {
        const runs = await read(`/api/project-runs?projectId=history-project&canvasId=${canvasId}`);
        return runs.length === 2 && runs.filter(run => run.status === 'failed').length === 1;
      }, 'failed attempt durable terminal');
      await checkPrevious();
      await page.screenshot({ path: path.join(artifacts, 'actual-generation-failed-retained.png') });
      report.cases.push('actual-SD2-failed-regeneration-retains-prior-preview-prompt-and-one-history-without-new-output-receipt');
      await editPrompt(expectedSubmissions[2]);
      await node.getByRole('button', { name: '生成视频', exact: true }).click();
      await until(() => Boolean(pendingStopRoute), 'stoppable query pending');
      await node.locator('[data-previous-generation-notice]').filter({ hasText: '等待期间仍可查看上一版' }).waitFor();
      await checkPrevious();
      await node.getByRole('button', { name: /^停止\(/ }).click();
      await node.locator('[data-previous-generation-notice]').filter({ hasText: '可修改设置后重新生成' }).waitFor();
      await until(async () => {
        const runs = await read(`/api/project-runs?projectId=history-project&canvasId=${canvasId}`);
        return runs.length === 3 && runs.map(run => run.status).sort().join(',') === 'failed,stopped,succeeded';
      }, 'local stop settles Run without successful output');
      await checkPrevious();
      await page.screenshot({ path: path.join(artifacts, 'actual-generation-stopped-retained.png') });
      await editPrompt(prompts[index]);
    }
    await node.getByRole('button', { name: '生成视频', exact: true }).click();
    await until(async () => (await history()).groups.length === index + 1, `generation ${index + 1} archived`);
    await until(async () => {
      const runs = await read(`/api/project-runs?projectId=history-project&canvasId=${canvasId}`);
      return runs.length === (index ? 4 : 1) && runs.filter(run => run.status === 'succeeded').length === index + 1;
    }, `generation ${index + 1} durable success`);
    await until(async () => (await document()).nodes.find(item => item.id === 'actual-generator').data.lastPrompt === prompts[index], 'latest preview saved');
    const groups = (await history()).groups;
    const current = groups.find(group => group.promptPreview === prompts[index]);
    assert.ok(current, `Exact archived prompt ${index}`);
    assert.equal(current.outputs.length, 1);
    archived.push(current);
  }
  assert.deepEqual(outputReceipts, [201, 201]);
  assert.deepEqual(submissions, expectedSubmissions);
  assert.ok((await page.locator('.react-flow__node-output').innerText()).includes(prompts[1]));
  // Deliver the stopped query only after B is durably successful. Its older
  // result must not replace B or create a third historical generation.
  const lateResponse = page.waitForResponse(response => response.url().includes('taskId=fixture-3'));
  await pendingStopRoute.fulfill({ json: { success: true, data: { status: 'succeeded', videoUrl: '/files/output/generation-a.mp4' } } });
  await (await lateResponse).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal((await document()).nodes.find(item => item.id === 'actual-generator').data.videoUrl, '/files/output/generation-b.mp4');
  assert.equal((await history()).groups.length, 2);
  assert.deepEqual(outputReceipts, [201, 201]);
  report.actualGeneration.terminalStatuses = (await read(`/api/project-runs?projectId=history-project&canvasId=${canvasId}`)).map(run => run.status).sort();
  assert.deepEqual(report.actualGeneration.terminalStatuses, ['failed', 'stopped', 'succeeded', 'succeeded']);
  const inspectStoppedHierarchy = async () => {
    const stopped = (await read(`/api/project-runs?projectId=history-project&canvasId=${canvasId}`)).find(run => run.status === 'stopped');
    assert.ok(stopped);
    const detail = await read(`/api/project-runs/${stopped.id}`);
    assert.equal(detail.nodeRuns.length, 1);
    assert.equal(detail.nodeRuns[0].status, 'stopped');
    assert.equal(detail.nodeRuns[0].attempts.length, 1);
    assert.equal(detail.nodeRuns[0].attempts[0].status, 'stopped');
    assert.equal(detail.nodeRuns[0].attempts[0].error.code, 'RUN_EXECUTION_STOPPED');
    return { runId: detail.id, nodeRunId: detail.nodeRuns[0].id, attemptId: detail.nodeRuns[0].attempts[0].id };
  };
  report.actualGeneration.stoppedHierarchy = await inspectStoppedHierarchy();
  report.cases.push('actual-SD2-local-stop-retains-prior-result-and-late-completion-cannot-overwrite-next-success-or-create-history');
  await page.waitForFunction(() => document.querySelectorAll('[data-history-group]').length === 2);
  await page.screenshot({ path: path.join(artifacts, 'actual-generation-two-versions.png') });
  const saved = await document();
  const latest = saved.nodes.find(item => item.id === 'actual-generator');
  assert.equal(latest.data.videoUrl, '/files/output/generation-b.mp4');
  assert.notEqual(archived[0].outputs[0].contentHash, archived[1].outputs[0].contentHash);
  report.cases.push('actual-SD2-primary-button-rerun-after-prompt-edit-produces-two-durable-Host-output-history-groups');
  report.controlledGenerationSubmissions = submissions.length;
  await closePage(page); await stop(); await start();
  const reopenedPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await setupPage(reopenedPage, canvasId);
  await reopenedPage.waitForFunction(() => document.querySelectorAll('[data-history-group]').length === 2);
  assert.ok((await reopenedPage.locator('.react-flow__node-output').innerText()).includes(prompts[1]));
  const reopened = await document();
  const reopenedNode = reopened.nodes.find(item => item.id === latest.id);
  for (const key of ['prompt', 'lastPrompt', 'videoUrl', 'videoUrls']) assert.deepEqual(reopenedNode.data[key], latest.data[key]);
  const restored = (await history()).groups;
  assert.deepEqual(restored.map(group => group.id).sort(), archived.map(group => group.id).sort());
  for (const group of restored) {
    assert.ok(prompts.includes(group.promptPreview));
    const output = group.outputs[0];
    assert.ok(output.mediaUrl);
    const response = await fetch(new URL(output.mediaUrl, origin));
    assert.equal(response.status, 200);
    assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), output.contentHash);
  }
  // Exercise native HTML video playback against the restored history URLs,
  // not merely a successful HEAD or a non-empty preview element.
  const videos = reopenedPage.locator('[data-history-group] video');
  assert.equal(await videos.count(), 2);
  for (const video of await videos.all()) {
    await video.evaluate(async element => { element.muted = true; await element.play(); });
    await until(async () => video.evaluate(element => element.currentTime > 0 && element.videoWidth === 160 && element.videoHeight === 90 && !element.error), 'restored historical video decodes and advances');
    await video.evaluate(element => element.pause());
  }
  assert.deepEqual((await read(`/api/project-runs?projectId=history-project&canvasId=${canvasId}`)).map(run => run.status).sort(), report.actualGeneration.terminalStatuses);
  assert.deepEqual(await inspectStoppedHierarchy(), report.actualGeneration.stoppedHierarchy);
  report.cases.push('both-restored-historical-videos-decode-and-play-after-restart-with-no-extra-generation');
  await reopenedPage.screenshot({ path: path.join(artifacts, 'actual-generation-restarted.png') });
  report.cases.push('actual-SD2-two-generated-versions-prompts-identities-and-media-bytes-survive-backend-process-restart');
  await closePage(reopenedPage);
};
