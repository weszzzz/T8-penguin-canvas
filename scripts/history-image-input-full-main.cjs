'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { whilePageAlive } = require('./history-acceptance-safety.cjs');
const { hasPersistedNodeSerials } = require('./history-basic-settings-full-main.cjs');
module.exports = async ({ fixture, getPage, read, until, restart, origin, report, artifacts, checkpoint }) => {
  assert.ok(['image', 'video'].includes(fixture.nodeType));
  assert.ok(['standard-image', 'budget-image', 'fal-image', 'banana-image', 'standard-video', 'fal-video'].includes(fixture.inputKind));
  const video = fixture.nodeType === 'video', budget = fixture.inputKind === 'budget-image';
  const budgetLowprice = budget && fixture.settings.apiModel === 'zhenzhen-image-g-v2.5-lowprice';
  const fal = fixture.inputKind === 'fal-image', falGpt = fal && fixture.settings.apiModel === 'gpt-image-2-fal';
  const banana = fixture.inputKind === 'banana-image', bananaLite = banana && fixture.settings.apiModel === 'gemini-3.1-flash-lite-image';
  const falVideo = fixture.inputKind === 'fal-video';
  if (banana) assert.ok(['gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'nano-banana-pro',
    'nano-banana-pro-2k', 'nano-banana-pro-4k', 'gemini-3-pro-image'].includes(fixture.settings.apiModel));
  if (fal) assert.ok(['gpt-image-2-fal', 'nano-banana-pro-fal', 'nano-banana-2-fal'].includes(fixture.settings.apiModel));
  assert.equal(video, ['standard-video', 'fal-video'].includes(fixture.inputKind));
  const prefix = falVideo ? `fal-video-${fixture.settings.model}` : video ? 'video' : budget ? 'budget-image' : fal ? `fal-${fixture.settings.apiModel}` : banana ? `banana-${fixture.settings.apiModel}` : 'image';
  const referenceField = video ? 'localRefImages' : 'referenceImages', referenceCount = fixture.expectedHashes.length;
  assert.equal(fixture.expectedHashes.length, referenceCount);
  const stage = name => checkpoint(`${prefix.replaceAll('.', '-')}-input-${name}`);
  const result = report[falVideo ? 'falVideoInputDraft' : video ? 'videoInputDraft' : budget ? 'budgetImageInputDraft' : fal ? 'falImageInputDraft' : banana ? 'bananaImageInputDraft' : 'imageInputDraft'] = {
    source: 'synthetic-Host-history-real-recovery-and-CanvasPatch', inputKind: fixture.inputKind,
    apiModel: fixture.settings.apiModel || fixture.settings.model, mutations: [], providerCalls: 0 };
  let page = getPage();
  const observe = current => current.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/api/project-runs') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method()))
      result.mutations.push({ method: request.method(), pathname });
  });
  observe(page);
  const settled = async nodeId => {
    let previous = '', stable = 0;
    await until(async () => {
      const document = await read(`/api/canvas/${fixture.id}`), next = JSON.stringify(document);
      stable = hasPersistedNodeSerials(document, nodeId) && next === previous ? stable + 1 : 0;
      previous = next; return stable >= 8;
    }, 'image draft serials and canvas save settle');
  };
  const openCanvas = async () => {
    await page.evaluate(id => localStorage.setItem('t8-canvas-active-id-v1', id), fixture.id);
    await whilePageAlive(page, async () => {
      await page.reload({ waitUntil: 'commit' });
      await page.locator(`.react-flow__node[data-id="${fixture.keepId}"]`).waitFor({ timeout: 120000 });
    }, 'open owned image input canvas');
    await settled(fixture.keepId);
    if (!await page.locator('.t8-generation-history-panel').isVisible())
      await page.locator('.t8-canvas-toolbar button').filter({ has: page.locator('svg.lucide-history') }).click();
    await until(async () => await page.locator('[data-history-group]').count() === 1, 'one synthetic history record');
  };
  const history = async () => {
    const query = new URLSearchParams({ projectId: fixture.projectId, canvasId: fixture.id });
    const list = await read(`/api/project-runs/generation-history?${query}`); assert.equal(list.groups.length, 1);
    query.set('groupId', list.groups[0].id); query.set('includeInput', 'true');
    return (await read(`/api/project-runs/generation-history?${query}`)).groups[0];
  };
  const runs = async () => (await read(`/api/project-runs?${new URLSearchParams({ projectId: fixture.projectId, canvasId: fixture.id })}`)).map(run => run.id).sort();
  const verifyBytes = async references => {
    assert.equal(references.length, referenceCount); assert.equal(new Set(references).size, referenceCount);
    for (const [index, url] of references.entries()) {
      const address = new URL(url, origin); assert.equal(address.origin, origin);
      assert.equal(address.searchParams.get('projectId'), fixture.projectId);
      assert.equal(address.searchParams.get('contentHash'), fixture.expectedHashes[index]);
      const response = await fetch(address, { signal: AbortSignal.timeout(15000) }); assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), fixture.expectedHashes[index]);
    }
  };
  await openCanvas();
  const before = await read(`/api/canvas/${fixture.id}`), originalHistory = await history(), originalRuns = await runs();
  result.archiveStatus = originalHistory.inputArchive?.status;
  if (originalHistory.inputArchive?.status !== 'available') result.archiveReason = originalHistory.inputArchive?.reason;
  assert.equal(before.nodes.length, 1); assert.equal(originalHistory.sourceNodeExists, false);
  assert.equal(originalHistory.snapshotAvailable, true); assert.deepEqual(originalHistory.inputArchive.snapshot.node.data.historyResolvedInput, fixture.context);
  const card = page.locator('[data-history-group]'); await card.locator('details > summary').click();
  const openDraft = card.getByRole('button', { name: '新建历史输入草稿', exact: true }); await openDraft.click();
  const picker = page.getByLabel('选择图片 1的原文件', { exact: true }); await picker.waitFor({ state: 'attached' });
  assert.equal((await read(`/api/canvas/${fixture.id}`)).nodes.length, 1);
  stage('missing-reference-blocked');
  await picker.setInputFiles(fixture.wrongFile); await page.getByRole('button', { name: '确认找回此参考', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '与当时的参考内容不一致' }).waitFor();
  assert.equal((await read(`/api/canvas/${fixture.id}`)).nodes.length, 1);
  await picker.setInputFiles(fixture.originalFile); await page.getByRole('button', { name: '确认找回此参考', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '确认新建历史输入草稿', exact: true }); await dialog.waitFor();
  const confirm = dialog.getByRole('button', { name: '确认新建，不生成', exact: true });
  await until(() => confirm.isEnabled(), 'all effective original reference previews loaded');
  assert.equal(await dialog.locator('img').count(), referenceCount);
  const previewUrls = await dialog.locator('img').evaluateAll(images => images.map(image => image.getAttribute('src')));
  await verifyBytes(previewUrls);
  assert.equal((await read(`/api/canvas/${fixture.id}`)).nodes.length, 1, 'recovery is not permission to create a node');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  assert.deepEqual((await read(`/api/canvas/${fixture.id}`)).nodes, before.nodes);
  await openDraft.click(); await dialog.waitFor(); await until(() => confirm.isEnabled(), 'reopened fixed previews ready');
  const primary = dialog.locator('.t8-history-settings-fields > section');
  const falVideoPrimary = !falVideo ? [] : fixture.settings.model === 'veo3.1-fal'
    ? [['模型', 'veo3.1-fal'], ['FAL Veo 比例', '9:16'], ['FAL Veo 时长', '8s'], ['FAL Veo 分辨率', '4k'], ['FAL Veo 生成声音', 'false'], ['实际请求安全容忍度', '4']]
    : fixture.settings.model === 'sora-2'
      ? [['模型', 'sora-2'], ['FAL Sora 生成模式', 'image_to_video'], ['FAL Sora 比例', 'auto'], ['FAL Sora 时长', '8'], ['FAL Sora 分辨率', 'auto']]
      : [['模型', fixture.settings.model], ['FAL Grok 生成模式', fixture.settings.gkfMode],
        ...(fixture.settings.gkfRatio ? [['FAL Grok 比例', fixture.settings.gkfRatio]] : []), ['FAL Grok 时长', '10'], ['FAL Grok 分辨率', '720p']];
  for (const [label, value] of video ? falVideo ? falVideoPrimary : [['输出尺寸', '720x1280'], ['模型', 'grok-1.5-video-6s']]
    : banana ? [['子模型', fixture.settings.apiModel], ['比例', 'Auto'], [bananaLite ? '请求分辨率' : '图像尺寸', bananaLite ? '1K' : '4K']]
    : budget ? [['子模型', fixture.settings.apiModel], ...(budgetLowprice
      ? [['Image G 2.5 数量', '1'], ['Image G 2.5 图像规格', '16:9'], ['Image G 2.5 分辨率', '4k']]
      : [['Image G 2.5 自定义宽度', '1536'], ['Image G 2.5 自定义高度', '1024'], ['Image G 2.5 数量', '3'], ['Image G 2.5 图像规格', 'custom']])]
    : fal ? [['子模型', fixture.settings.apiModel], ['FAL 生成数量', '3'], ...(falGpt
      ? [['FAL 自定义宽度', '1001'], ['FAL 自定义高度', '769'], ['FAL 图像规格', 'custom'], ['FAL 生成模式', 'edit']]
      : [['FAL 香蕉比例', '9:16'], ['FAL 香蕉分辨率', '4K']])]
    : [['自定义宽度', '1536'], ['自定义高度', '1024'], ['生成数量', '3'], ['图像规格', 'custom']]) {
    const field = primary.filter({ has: page.getByText(label, { exact: true }) }); assert.equal(await field.count(), 1);
    assert.equal(await field.locator('pre').last().textContent(), value);
  }
  for (const label of [...(banana ? bananaLite ? ['图像尺寸'] : ['请求分辨率'] : ['比例', '图像尺寸']), '扩展模型', '扩展渠道', ...(video ? ['时长', '分辨率', '种子'] : []),
    ...(budget ? budgetLowprice ? ['Image G 2.5 自定义宽度', 'Image G 2.5 自定义高度', 'Image G 2.5 质量', 'Image G 2.5 输出格式'] : ['Image G 2.5 分辨率', 'Image G 2.5 内容检查'] : []),
    ...(fal && !falGpt ? ['FAL 同步模式', 'FAL 自定义宽度', 'FAL 自定义高度'] : [])]) assert.equal(await dialog.getByText(label, { exact: true }).count(), 0);
  const extra = dialog.locator('.t8-history-settings-fields > details');
  if (banana) assert.equal(await extra.count(), 0, 'ordinary Banana has no irrelevant advanced section');
  else {
    assert.equal(await extra.evaluate(element => element.open), false);
    await extra.locator('summary').click(); assert.equal(await extra.locator('section').count(), video ? falVideo
      ? fixture.settings.model === 'veo3.1-fal' ? 2 : fixture.settings.model === 'sora-2' ? 3 : 1
      : 1 : budget ? budgetLowprice ? 1 : 5 : fal && !falGpt ? 6 : 3);
  }
  if (banana) {
    const text = await dialog.textContent();
    assert.ok(text.includes('图像调节不会重复追加'));
    assert.ok(text.includes('比例 Auto 在当前渠道请求中按 1:1 处理'));
    assert.equal(text.includes('Lite 固定请求 1K'), bananaLite);
  }
  if (fal) {
    assert.ok((await dialog.textContent()).includes('已恢复此 FAL 图像模型归档的设置'));
    assert.equal((await dialog.textContent()).includes('下方宽高是历史设置值'), falGpt);
    for (const [label, value] of [['FAL 输出格式', 'webp'], ...(falGpt ? [['FAL 同步模式', 'true'], ['FAL 图像质量', 'high']]
      : [['FAL 安全容忍度', '1'], ['FAL 种子设置', '0'], ['FAL 系统提示词', ''], ['FAL 联网搜索', 'false'], ['FAL 图像传输方式', 'base64']])]) {
      const field = extra.locator('section').filter({ has: page.getByText(label, { exact: true }) });
      assert.equal(await field.count(), 1); assert.equal(await field.locator('pre').last().textContent(), value);
    }
  }
  if (budget) {
    assert.ok((await dialog.textContent()).includes('已恢复此平价小屋图像模型归档的参数'));
    for (const [label, value] of budgetLowprice ? [['Image G 2.5 内容检查', 'false']] : [['Image G 2.5 质量', 'max'], ['Image G 2.5 输出格式', 'webp'],
      ['Image G 2.5 压缩质量', '0'], ['Image G 2.5 背景', 'transparent'], ['Image G 2.5 审核', 'low']]) {
      const field = extra.locator('section').filter({ has: page.getByText(label, { exact: true }) });
      assert.equal(await field.count(), 1); assert.equal(await field.locator('pre').last().textContent(), value);
    }
  }
  if (falVideo) {
    assert.ok((await dialog.textContent()).includes('已恢复此 FAL 视频模型归档的参数'));
    const secondary = fixture.settings.model === 'veo3.1-fal' ? [['FAL Veo 安全容忍度', '0']]
      : fixture.settings.model === 'sora-2' ? [['FAL Sora Delete Video', 'false'], ['FAL Sora Block IP', 'true']] : [];
    for (const [label, value] of secondary) {
      const field = extra.locator('section').filter({ has: page.getByText(label, { exact: true }) });
      assert.equal(await field.count(), 1); assert.equal(await field.locator('pre').last().textContent(), value);
    }
  }
  await page.screenshot({ path: path.join(artifacts, `${prefix}-input-real-confirm.png`) });
  const patches = []; let dropped = false;
  const pattern = `**/api/canvas/${fixture.id}/patches`;
  await page.route(pattern, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    patches.push(route.request().postDataJSON());
    if (!dropped) { const response = await route.fetch(); assert.equal(response.ok(), true); dropped = true; await route.abort(); return; }
    await route.continue();
  });
  await confirm.click(); await dialog.getByRole('alert').waitFor(); await confirm.click();
  await dialog.waitFor({ state: 'hidden', timeout: 30000 });
  // Keep interception stable until normal app quit. Removing the final route
  // here toggles Chromium Fetch interception while the newly added lazy editor
  // is importing modules. The handler already passes subsequent PATCH requests.
  assert.equal(patches.length, 2); assert.deepEqual(patches[0], patches[1]);
  const operation = patches[0].patch.operations[0]; assert.equal(operation.type, 'node.add'); assert.equal(patches[0].patch.operations.length, 1);
  const newId = operation.payload.node.id;
  const newNode = page.locator(`.react-flow__node[data-id="${newId}"]`);
  await newNode.waitFor();
  // A visible lazy shell is not the mounted model editor. Bring the real node
  // into view and wait for its action before saving the full-node baseline,
  // retaining strict measured/data/identity equality across the restart.
  await page.locator('.react-flow__controls-fitview').click();
  await newNode.getByRole('button', { name: video ? '生成视频' : '生成', exact: true }).waitFor({ timeout: 120000 });
  await settled(newId);
  const saved = await read(`/api/canvas/${fixture.id}`), savedNode = saved.nodes.find(node => node.id === newId);
  assert.equal(saved.nodes.length, 2); assert.deepEqual(saved.nodes.find(node => node.id === fixture.keepId), before.nodes[0]);
  assert.deepEqual(saved.edges, before.edges); assert.equal(savedNode.data.prompt, fixture.context.prompt);
  for (const [key, value] of Object.entries(fixture.settings)) assert.deepEqual(savedNode.data[key], value, key);
  assert.equal(savedNode.type, fixture.nodeType);
  assert.deepEqual(savedNode.data[referenceField], previewUrls);
  assert.deepEqual(savedNode.data.promptMentions.map(mention => mention.url), video
    ? previewUrls.slice(0, Math.min(2, referenceCount)) : [previewUrls[1], previewUrls[2]]);
  if (video) { assert.deepEqual(savedNode.data.localRefVideos, []); assert.deepEqual(savedNode.data.localRefAudios, []); }
  for (const key of ['taskId', 'videoUrl', 'imageUrl', 'imagePromptAdjustments', 'historyResolvedInput', 'requestedImageSize', 'apiKey', 'providerParams', video ? 'referenceImages' : 'localRefImages']) assert.equal(Object.hasOwn(operation.payload.node.data, key), false, key);
  const recoveredHistory = await history(); assert.deepEqual(recoveredHistory.inputArchive, originalHistory.inputArchive);
  assert.ok(recoveredHistory.referenceRecoveries.length > 0); assert.deepEqual(await runs(), originalRuns);
  result.patchRequests = patches.length; result.historyId = recoveredHistory.id; result.newNodeId = newId;
  stage('original-recovered-and-real-draft-saved');
  await restart(); page = getPage(); observe(page);
  const restarted = await read(`/api/canvas/${fixture.id}`), restartedNode = restarted.nodes.find(node => node.id === newId);
  assert.deepEqual(restartedNode, savedNode); assert.deepEqual(restarted.edges, saved.edges);
  await verifyBytes(restartedNode.data[referenceField]); assert.deepEqual(await history(), recoveredHistory); assert.deepEqual(await runs(), originalRuns);
  await openCanvas(); await settled(newId);
  assert.deepEqual((await read(`/api/canvas/${fixture.id}`)).nodes.find(node => node.id === newId), savedNode, 'mounting restored image does not change saved inputs');
  result.normalRestartRetainsFullNode = true;
  stage('restart-data-and-original-bytes-verified');
  // SmartImage deliberately withholds src until the thumbnail enters the viewport.
  // Use normal UI controls; never force src/eager loading or disable the scheduler.
  // The full-main launch owns the poster locator handler. A second direct
  // click races that handler after it has already dismissed the same button.
  await page.getByRole('button', { name: '关闭历史记录', exact: true }).click();
  await page.locator('.react-flow__controls-fitview').click();
  // VideoNode renders local references as SmartImage directly; ImageNode uses
  // sortable MaterialThumbnail wrappers. Inspect each real node's own slots.
  const previewSelector = video
    ? `img[data-drag-kind="image"][data-drag-node-id="${newId}"]`
    : '[data-material-preview-thumb-id][data-drag-kind="image"] img';
  await whilePageAlive(page, () => until(async () => {
    const previews = await page.locator(`.react-flow__node[data-id="${newId}"] ${previewSelector}`).evaluateAll((images, { refs, video }) =>
      images.filter(image => refs.includes(image.getAttribute('data-full-src'))).slice(0, 4).map(image => {
        const rect = image.getBoundingClientRect();
        const wrapper = video ? image.parentElement : image.closest('[data-material-preview-thumb-id]');
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return {
          fullSrc: image.getAttribute('data-full-src'), src: image.getAttribute('src'),
          slotId: video ? image.getAttribute('data-drag-url') : wrapper?.getAttribute('data-material-preview-thumb-id'),
          complete: image.complete, width: image.naturalWidth, height: image.naturalHeight,
          visible: rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0
            && rect.right <= innerWidth && rect.bottom <= innerHeight && !!hit && !!wrapper?.contains(hit),
        };
      }), { refs: previewUrls, video });
    // Keep only the latest bounded diagnostic, including on timeout.
    result.restartedPreviews = previews;
    return previews.length === referenceCount && new Set(previews.map(item => item.slotId)).size === referenceCount
      && previews.every((item, index) => item.slotId && item.fullSrc === previewUrls[index]
        && item.src === previewUrls[index] && item.complete && item.width === 16 && item.height === 16 && item.visible);
  }, `restarted ${fixture.nodeType} node visibly decodes all original reference slots`), 'inspect restored reference previews');
  await settled(newId);
  assert.deepEqual((await read(`/api/canvas/${fixture.id}`)).nodes.find(node => node.id === newId), savedNode, 'overview only changes viewport, not restored inputs');
  await page.screenshot({ path: path.join(artifacts, `${prefix}-input-real-restarted.png`) });
  assert.equal(result.mutations.length, 2);
  assert.ok(result.mutations.every(item => item.method === 'POST' && item.pathname === '/api/project-runs/generation-history/recover'));
  result.referenceHashes = fixture.expectedHashes; result.sourceDeleted = true; result.wrongFileRejected = true;
  report.cases.push(`full-main-${prefix}-original-file-recovery-independent-draft-save-lost-ACK-retry-normal-quit-restart`);
};
