'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');

// Real app.quit and actual production before-quit hook, not production startup.
// The shutdown boundary pauses until the verifier has gracefully stopped its
// owned backend. This does not exercise the packaged backend shutdown service.
module.exports = async ({ launch, dispose, setupPage, start, stop, origin, artifacts, report, requestQuit, readQuitStatus, finishQuit }) => {
  const evidence = report.electronQuit = { scope: 'native-app-quit-production-hook-controlled-backend-boundary', phase: 'opening', order: [] };
  const read = async url => {
    const response = await fetch(`${origin}${url}`); assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.success, true); return body.data;
  };
  const document = () => read('/api/canvas/image-generation-canvas');
  const history = () => read('/api/project-runs/generation-history?projectId=history-project&canvasId=image-generation-canvas');
  const until = async (check, message) => {
    const deadline = Date.now() + 15000;
    do { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); } while (Date.now() < deadline);
    throw new Error(`Electron quit: ${message}`);
  };
  let page;
  try {
    page = await launch({ quit: true }); await setupPage(page, 'image-generation-canvas');
    const prior = (await document()).nodes.find(node => node.id === 'image-generator').data;
    const groups = (await history()).groups;
    assert.equal(groups.length, 3);
    const prompt = 'Unsaved draft before whole application quit; preserve generated C and A/B/C history';
    let held;
    await page.route('**/api/canvas/image-generation-canvas', route => {
      if (route.request().method() !== 'PUT') return route.fallback();
      if (JSON.stringify(route.request().postDataJSON()).includes(prompt)) {
        assert.equal(held, undefined, 'one pending canvas write'); held = route; return;
      }
      return route.fallback();
    });
    const textbox = page.locator('.react-flow__node[data-id="image-generator"]').getByRole('textbox');
    await textbox.click(); await textbox.press('ControlOrMeta+A'); await textbox.fill(prompt);
    assert.equal(await textbox.innerText(), prompt);
    await requestQuit(); await requestQuit();
    await until(() => !!held, 'app.quit flushes draft');
    assert.equal(await readQuitStatus(), null, 'backend shutdown must not start before save acknowledgement');
    assert.equal(page.isClosed(), false);
    assert.equal(await page.locator('#root').evaluate(root => root.inert), true);
    assert.notEqual((await document()).nodes.find(node => node.id === 'image-generator').data.prompt, prompt);
    evidence.order.push('save-held-backend-still-readable');
    await held.continue();
    await until(async () => (await readQuitStatus())?.reason === 'ELECTRON_QUIT', 'approved save reaches backend shutdown boundary');
    const saved = (await document()).nodes.find(node => node.id === 'image-generator').data;
    assert.equal(saved.prompt, prompt); assert.equal(saved.imageUrl, prior.imageUrl); assert.equal(saved.lastPrompt, prior.lastPrompt);
    evidence.order.push('latest-draft-confirmed-before-backend-stop');
    assert.equal(page.isClosed(), false);
    await stop(); evidence.order.push('owned-backend-gracefully-exited');
    await finishQuit(); evidence.order.push('native-application-exited-through-app-quit');
    assert.equal(page.isClosed(), true);
    await dispose(); await start();
    page = await launch(); await setupPage(page, 'image-generation-canvas');
    const reopened = (await document()).nodes.find(node => node.id === 'image-generator').data;
    for (const key of ['prompt', 'lastPrompt', 'imageUrl', 'imageUrls', 'status']) assert.deepEqual(reopened[key], saved[key]);
    assert.equal(await page.locator('.react-flow__node[data-id="image-generator"]').getByRole('textbox').innerText(), prompt);
    assert.deepEqual((await history()).groups.map(group => group.id).sort(), groups.map(group => group.id).sort());
    assert.equal(await page.locator('#root').evaluate(root => root.inert), false);
    await page.screenshot({ path: path.join(artifacts, 'electron-app-quit-restarted.png') });
    evidence.order.push('backend-and-new-window-restarted-with-draft-C-and-three-histories');
    evidence.phase = 'accepted';
    report.cases.push('native-app-quit-awaits-save-before-owned-backend-shutdown-and-restart-retains-draft-C-three-histories');
    process.stdout.write('[electron-app-quit] accepted\n');
  } catch (error) { evidence.failure = error.message; throw error; }
  finally { await dispose(); }
};
