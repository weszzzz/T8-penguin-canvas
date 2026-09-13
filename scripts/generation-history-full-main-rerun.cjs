'use strict';
// Actual complete App and production lifecycle. Only the two Provider HTTP
// boundaries are controlled; Run/NodeRun/Attempt/output/history/CAS are real.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

module.exports = async ({ root, dataRoot, artifacts, origin, getPage, restart, read, until, report, checkpoint, setProviderHandler }) => {
  const prompts = ['Full client generation A', 'Full client generation B'];
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const expectedHashes = [];
  for (const [index, color] of ['red', 'green'].entries()) {
    const file = path.join(dataRoot, 'output', `full-generated-${index}.mp4`);
    const encoded = spawnSync(path.join(root, 'tools/ffmpeg-runtime/ffmpeg.exe'),
      ['-hide_banner', '-loglevel', 'error', '-filter_threads', '1', '-f', 'lavfi', '-i', `color=c=${color}:s=160x90:r=10:d=2`,
        '-an', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file],
      { windowsHide: true, timeout: 30000, encoding: 'utf8' });
    assert.equal(encoded.status, 0, encoded.stderr); expectedHashes.push(digest(fs.readFileSync(file)));
  }
  const created = await read('/api/canvas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Full client A and B history acceptance' }) });
  const initial = await read(`/api/canvas/${created.id}`);
  await read(`/api/canvas/${created.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'If-Match': `"${initial.revision}"` }, body: JSON.stringify({
    ...initial, nodes: [{ id: 'full-generator', type: 'seedance', position: { x: 0, y: 0 },
      data: { prompt: prompts[0], pollInt: 2, seedanceApiSource: 'zhenzhen-legacy', duration: 5, ratio: '16:9', resolution: '720p' } }],
    edges: [], viewport: { x: 180, y: 80, zoom: 0.8 },
  }) });
  let page = getPage();
  await page.evaluate(id => localStorage.setItem('t8-canvas-active-id-v1', id), created.id);
  await page.reload({ waitUntil: 'commit' });
  const node = page.locator('.react-flow__node[data-id="full-generator"]');
  await node.getByRole('button', { name: '生成视频', exact: true }).waitFor({ timeout: 120000 });
  const submissions = [], receipts = [], unexpected = [];
  const transportEvents = [];
  report.fullClientGeneration = { submissions, receipts, unexpected, transportEvents, transport: 'controlled-real-loopback-HTTP-Provider-boundary', providerCalls: 0 };
  // Bounded metadata only: never retain headers, request bodies or query values.
  // Keep failed transport evidence instead of diagnosing HTTP 0 from UI text.
  const observeTransport = target => {
    target.on('response', response => {
      const pathname = new URL(response.url()).pathname;
      if (pathname.startsWith('/api/proxy/') && transportEvents.length < 64)
        transportEvents.push({ event: 'response', pathname, status: response.status() });
    });
    target.on('requestfailed', request => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith('/api/proxy/') && transportEvents.length < 64)
        transportEvents.push({ event: 'requestfailed', pathname });
    });
  };
  observeTransport(page);
  setProviderHandler(async ({ method, pathname, payload, query }) => {
    if (pathname === '/api/proxy/seedance/submit') {
      assert.equal(method, 'POST'); assert.ok(submissions.length < 2);
      assert.equal(payload.prompt, prompts[submissions.length]);
      const index = submissions.length; submissions.push(payload.prompt);
      return { status: 200, body: { success: true, data: { taskId: `full-test-${index}`, taskProvider: 'zhenzhen-legacy', model: payload.model, taskType: 't2v' } } };
    }
    if (pathname === '/api/proxy/seedance/query') {
      assert.equal(method, 'GET');
      const taskId = query.get('taskId');
      assert.ok(['full-test-0', 'full-test-1'].includes(taskId));
      const index = taskId === 'full-test-0' ? 0 : 1;
      return { status: 200, body: { success: true, data: { status: 'succeeded', taskProvider: 'zhenzhen-legacy', videoUrl: `/files/output/full-generated-${index}.mp4` } } };
    }
    unexpected.push(pathname); return null;
  });
  page.on('response', response => {
    if (/\/api\/project-runs\/[^/]+\/nodes\/[^/]+\/outputs$/.test(new URL(response.url()).pathname)) receipts.push(response.status());
  });
  const document = () => read(`/api/canvas/${created.id}`);
  const query = new URLSearchParams({ projectId: initial.projectId, canvasId: created.id });
  const history = () => read(`/api/project-runs/generation-history?${query}`);
  const runs = () => read(`/api/project-runs?${query}`);
  let last = '', stable = 0;
  await until(async () => { const next = JSON.stringify(await document()); stable = next === last ? stable + 1 : 0; last = next; return stable >= 8; }, 'full client initial canvas settles');
  for (const [index, prompt] of prompts.entries()) {
    if (index) {
      await node.getByRole('textbox').fill(prompt); await node.getByRole('textbox').press('Tab');
      await until(async () => (await document()).nodes.find(item => item.id === 'full-generator').data.prompt === prompt, 'full client edited prompt saves');
      assert.equal((await history()).groups.length, 1);
      assert.equal((await document()).nodes.find(item => item.id === 'full-generator').data.lastPrompt, prompts[0]);
    }
    await node.getByRole('button', { name: '生成视频', exact: true }).click();
    await until(async () => (await history()).groups.length === index + 1, `full client generation ${index} archived`);
    await until(async () => {
      const list = await runs(); return list.length === index + 1 && list.every(run => run.status === 'succeeded');
    }, `full client generation ${index} run success`);
    await until(async () => (await document()).nodes.find(item => item.id === 'full-generator').data.lastPrompt === prompt, `full client generation ${index} canvas saved`);
  }
  assert.deepEqual(submissions, prompts); assert.deepEqual(receipts, [201, 201]); assert.deepEqual(unexpected, []);
  const before = await document();
  const beforeNode = before.nodes.find(item => item.id === 'full-generator');
  const beforeHistory = await history();
  assert.deepEqual(beforeHistory.groups.map(group => group.promptPreview).sort(), [...prompts].sort());
  const hierarchy = async () => Promise.all((await runs()).map(async run => {
    const detail = await read(`/api/project-runs/${run.id}`);
    assert.equal(detail.status, 'succeeded'); assert.equal(detail.nodeRuns.length, 1);
    const nodeRun = detail.nodeRuns[0]; assert.equal(nodeRun.status, 'succeeded'); assert.equal(nodeRun.attempts.length, 1);
    assert.equal(nodeRun.attempts[0].status, 'succeeded');
    return { run: run.id, nodeRun: nodeRun.id, attempt: nodeRun.attempts[0].id };
  }));
  const beforeHierarchy = await hierarchy();
  report.cases.push('full-main-SD2-primary-button-A-then-B-keeps-two-real-durable-generation-groups');
  checkpoint('restarting-full-client-with-generated-a-and-b');
  await restart(); page = getPage(); observeTransport(page);
  await page.locator('.react-flow__node[data-id="full-generator"]').waitFor({ timeout: 120000 });
  await page.locator('.t8-canvas-toolbar button').filter({ has: page.locator('svg.lucide-history') }).click();
  await until(async () => await page.locator('[data-history-group]').count() === 2, 'full restarted history shows both generations');
  const after = await document(), afterHistory = await history();
  const afterNode = after.nodes.find(item => item.id === 'full-generator');
  assert.equal(afterNode.entityUid, beforeNode.entityUid);
  for (const key of ['prompt', 'lastPrompt', 'videoUrl', 'videoUrls', 'status']) assert.deepEqual(afterNode.data[key], beforeNode.data[key]);
  assert.deepEqual(afterHistory.groups.map(group => group.id).sort(), beforeHistory.groups.map(group => group.id).sort());
  assert.deepEqual(await hierarchy(), beforeHierarchy);
  const actualHashes = [];
  for (const group of afterHistory.groups) {
    assert.ok(prompts.includes(group.promptPreview)); assert.equal(group.outputs.length, 1);
    const output = group.outputs[0]; const response = await fetch(new URL(output.mediaUrl, origin)); assert.equal(response.status, 200);
    const bytesHash = digest(Buffer.from(await response.arrayBuffer())); assert.equal(bytesHash, output.contentHash); actualHashes.push(bytesHash);
  }
  assert.deepEqual(actualHashes.sort(), [...expectedHashes].sort());
  const videos = page.locator('[data-history-group] video'); assert.equal(await videos.count(), 2);
  for (const video of await videos.all()) {
    await video.evaluate(async element => { element.muted = true; await element.play(); });
    await until(async () => video.evaluate(element => element.currentTime > 0 && element.videoWidth === 160 && element.videoHeight === 90 && !element.error), 'both full restarted generation videos play');
    await video.evaluate(element => element.pause());
  }
  assert.deepEqual(unexpected, []); assert.deepEqual(submissions, prompts);
  report.fullClientGeneration.hierarchy = beforeHierarchy;
  report.fullClientGeneration.historyIds = afterHistory.groups.map(group => group.id);
  await page.screenshot({ path: path.join(artifacts, 'generated-A-B-full-main-restarted.png') });
  report.cases.push('full-main-restart-retains-both-generated-versions-prompts-run-identities-bytes-and-video-playback');
};
