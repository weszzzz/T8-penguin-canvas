'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { whilePageAlive } = require('./history-acceptance-safety.cjs');
function hasPersistedNodeSerials(document, nodeId) {
  if (!Array.isArray(document?.nodes) || !document.nodes.some(node => node.id === nodeId)) return false;
  const serials = document.nodes.map(node => node.data?.nodeSerialId);
  return serials.every(value => Number.isSafeInteger(value) && value > 0)
    && new Set(serials).size === serials.length && Number.isSafeInteger(document.nextNodeSerialId)
    && document.nextNodeSerialId > Math.max(...serials);
}
module.exports = async ({ fixtures, getPage, read, until, restart, report, artifacts }) => {
  report.basicSettings = { source: 'synthetic-history-production-Host-archive', providerCalls: 0, fixtures: [], mutations: [] };
  const observe = page => page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/api/project-runs') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method()))
      report.basicSettings.mutations.push({ method: request.method(), pathname });
  });
  let page = getPage(); observe(page);
  const openCanvas = async fixture => {
    await page.evaluate(id => localStorage.setItem('t8-canvas-active-id-v1', id), fixture.id);
    await whilePageAlive(page, async () => {
      await page.reload({ waitUntil: 'commit' });
      await page.locator(`.react-flow__node[data-id="${fixture.nodeId}"]`).waitFor({ timeout: 120000 });
    }, `open ${fixture.name}`);
    let last = '', stable = 0;
    // An unchanged seed document is not a saved initialized canvas. Canvas
    // assigns missing serials on hydration, before its debounced CAS save.
    await until(async () => {
      const document = await read(`/api/canvas/${fixture.id}`), next = JSON.stringify(document);
      stable = hasPersistedNodeSerials(document, fixture.nodeId) && next === last ? stable + 1 : 0;
      last = next; return stable >= 8;
    }, 'settings fixture initialized serials and save settle');
    if (!await page.locator('.t8-generation-history-panel').isVisible())
      await page.locator('.t8-canvas-toolbar button').filter({ has: page.locator('svg.lucide-history') }).click();
    await until(async () => await page.locator('[data-history-group]').count() === 1, 'single owned historical settings record');
  };
  const histories = async fixture => {
    const query = new URLSearchParams({ projectId: fixture.projectId, canvasId: fixture.id });
    const list = await read(`/api/project-runs/generation-history?${query}`);
    assert.equal(list.groups.length, 1);
    query.set('groupId', list.groups[0].id); query.set('includeInput', 'true');
    return read(`/api/project-runs/generation-history?${query}`);
  };
  const documents = [];
  for (const fixture of fixtures) {
    await openCanvas(fixture);
    const before = await read(`/api/canvas/${fixture.id}`), history = await histories(fixture);
    assert.equal(history.groups[0].snapshotAvailable, true);
    const beforeNode = before.nodes.find(node => node.id === fixture.nodeId);
    const card = page.locator('[data-history-group]');
    await card.locator('details > summary').click();
    const restore = card.getByRole('button', { name: '填回提示词与参数', exact: true });
    await restore.click();
    const dialog = page.getByRole('dialog', { name: '确认填回历史设置', exact: true });
    await dialog.waitFor(); await dialog.getByRole('button', { name: '取消', exact: true }).click();
    assert.deepEqual((await read(`/api/canvas/${fixture.id}`)).nodes.find(node => node.id === fixture.nodeId).data, beforeNode.data, 'cancel preserves all current data');
    await restore.click(); await dialog.waitFor();
    const confirm = dialog.getByRole('button', { name: '确认填回，不生成', exact: true });
    assert.equal(await confirm.isDisabled(), true); await dialog.getByRole('checkbox').check();
    if (Object.keys(fixture.options).length) {
      const extra = dialog.locator('.t8-history-settings-fields > details');
      assert.equal(await extra.evaluate(element => element.open), false);
      await extra.locator('summary').click();
      assert.equal(await extra.locator('section').count(), Object.keys(fixture.options).length);
      await page.screenshot({ path: path.join(artifacts, `${fixture.name}-settings-confirm.png`) });
    }
    const patches = []; let dropped = false;
    const routePattern = `**/api/canvas/${fixture.id}/patches`;
    await page.route(routePattern, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      patches.push(route.request().postDataJSON());
      if (fixture.type === 'image' && !dropped) {
        const response = await route.fetch(); assert.equal(response.ok(), true);
        dropped = true; await route.abort(); return;
      }
      await route.continue();
    });
    await confirm.click();
    if (fixture.type === 'image') {
      await dialog.getByRole('alert').waitFor(); await confirm.click();
    }
    await dialog.waitFor({ state: 'hidden', timeout: 30000 }); await page.unroute(routePattern);
    await until(async () => (await read(`/api/canvas/${fixture.id}`)).nodes.find(node => node.id === fixture.nodeId).data.prompt === fixture.saved.prompt, 'historical basic settings really saved');
    const after = await read(`/api/canvas/${fixture.id}`), node = after.nodes.find(item => item.id === fixture.nodeId);
    for (const [key, value] of Object.entries(fixture.saved)) assert.deepEqual(node.data[key], value, `${fixture.type}.${key}`);
    for (const key of ['lastPrompt', 'status', 'imageUrl', 'imageUrls', 'referenceImages', 'localRefImages', 'videoUrl', 'videoUrls', 'providerParams'])
      assert.deepEqual(node.data[key], beforeNode.data[key], `retained ${fixture.type}.${key}`);
    assert.equal(node.entityUid, beforeNode.entityUid); assert.deepEqual(after.edges, before.edges);
    assert.equal(patches.length, fixture.type === 'image' ? 2 : 1);
    if (dropped) assert.deepEqual(patches[0], patches[1]);
    const payload = patches[0].patch.operations[0].payload;
    for (const [key, value] of Object.entries(fixture.options)) assert.deepEqual(payload.dataPatch[key], value, `exact patch ${fixture.name}.${key}`);
    for (const key of ['historyResolvedInput', 'taskId', 'imageUrl', 'imageUrls', 'referenceImages', 'status', 'lastPrompt']) {
      assert.equal(Object.hasOwn(payload.dataPatch, key), false); assert.equal(payload.dataUnsetKeys.includes(key), false);
    }
    assert.deepEqual(await histories(fixture), history, 'settings cannot rewrite historical input or add generations');
    documents.push(after);
    report.basicSettings.fixtures.push({ canvasId: fixture.id, type: fixture.type, name: fixture.name,
      optionKeys: Object.keys(fixture.options), patchRequests: patches.length, lostAck: dropped, historyId: history.groups[0].id });
  }
  await restart(); page = getPage(); observe(page);
  for (const [index, fixture] of fixtures.entries()) {
    const persisted = await read(`/api/canvas/${fixture.id}`);
    const before = documents[index].nodes.find(node => node.id === fixture.nodeId);
    const node = persisted.nodes.find(item => item.id === fixture.nodeId);
    assert.deepEqual(node.data, before.data); assert.equal(node.entityUid, before.entityUid);
    await openCanvas(fixture);
    const group = (await histories(fixture)).groups[0]; assert.equal(group.id, report.basicSettings.fixtures[index].historyId);
    assert.equal(group.inputArchive.snapshot.node.data.prompt, fixture.saved.prompt);
    assert.deepEqual(group.inputArchive.snapshot.node.data.historyResolvedInput, fixture.archivedData.historyResolvedInput, 'v2 capture remains exact after restart');
    const reopened = (await read(`/api/canvas/${fixture.id}`)).nodes.find(item => item.id === fixture.nodeId);
    assert.deepEqual(reopened.data, before.data, 'actual node mount must retain restored options');
    await page.screenshot({ path: path.join(artifacts, `${fixture.name}-basic-settings-restarted.png`) });
    report.cases.push(`full-main-${fixture.name}-basic-settings-confirm-save-quit-restart-without-generation`);
  }
  assert.deepEqual(report.basicSettings.mutations, []);
};
module.exports.hasPersistedNodeSerials = hasPersistedNodeSerials;
