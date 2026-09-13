'use strict';
// Extends the existing real projection/browser fixture. Mutations below are
// controlled UI callbacks/HTTP responses, not canvas durability evidence.
const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async function verifyHistoryLocales({ browser, origin, artifactDirectory, report }) {
  const makePage = async (query = '') => {
    const page = await browser.newPage({ viewport: { width: 390, height: 640 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(`${origin}/__history_ui?locale=en-US&theme=dark${query}`, { waitUntil: 'commit' });
    return { page, errors };
  };
  const switchLocale = (page, locale) => page.evaluate(value => window.changeHistoryLocale(value), locale);
  const checkWidth = async locator => {
    const size = await locator.evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }));
    assert.ok(size.scrollWidth <= size.width + 1, 'translated content must not overflow');
    return size;
  };

  {
    const { page, errors } = await makePage();
    const panel = page.getByRole('dialog', { name: 'History', exact: true });
    await page.waitForFunction(() => document.querySelectorAll('[data-history-group]').length === 24);
    const first = page.locator('[data-history-group]').first();
    const groupId = await first.getAttribute('data-history-group');
    const prompt = await first.locator('.t8-history-prompt').innerText();
    assert.match(prompt, /第 27 版提示词/);
    await first.getByRole('button', { name: 'Show remaining results' }).click();
    await page.waitForFunction(() => document.querySelector('[data-history-group]')?.querySelectorAll('.t8-history-image-open').length === 7);
    assert.match(await first.innerText(), /Results: 7/);
    let apiRequests = 0;
    // Layout reflow may legitimately lazy-load a thumbnail. Only projection
    // refetches and writes would change the history workflow on locale switch.
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/project-runs/generation-history' || !['GET', 'HEAD'].includes(request.method())) apiRequests++; });
    await switchLocale(page, 'zh-CN');
    await first.getByText('共 7 个结果', { exact: true }).waitFor();
    await switchLocale(page, 'en-US');
    await first.getByText('Results: 7', { exact: true }).waitFor();
    assert.equal(await first.getAttribute('data-history-group'), groupId);
    assert.equal(await first.locator('.t8-history-prompt').innerText(), prompt);
    assert.equal(await first.locator('.t8-history-image-open').count(), 7);
    assert.equal(apiRequests, 0, 'locale changes must not refetch or mutate history');
    const dimensions = await checkWidth(panel);
    await page.screenshot({ path: path.join(artifactDirectory, 'history-english-dark.png') });
    await panel.getByRole('button', { name: 'Current assets', exact: true }).click();
    await panel.getByText('No records yet', { exact: true }).waitFor();
    await switchLocale(page, 'zh-CN');
    await page.getByText('暂无记录', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '当前素材', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.deepEqual(errors, []);
    report.cases.push({ name: 'history-live-locale-switch', passed: true, dimensions, expandedBatchRetained: 7, promptUnchanged: true, localeRequests: apiRequests });
    await page.close();
  }

  {
    const { page, errors } = await makePage('&settings=1&restore=1');
    const opener = page.getByRole('button', { name: 'Restore prompt and settings', exact: true });
    await opener.click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByText('Effective prompt (including upstream text)', { exact: true }).waitFor({ state: 'detached' });
    const confirm = dialog.getByRole('button', { name: 'Restore, do not generate', exact: true });
    assert.equal(await confirm.isDisabled(), true);
    const texts = await dialog.locator('pre').allTextContents();
    assert.ok(texts.includes('Not specified (node default)'));
    assert.ok(texts.includes('长提示词'.repeat(2000)));
    await dialog.getByRole('checkbox').check();
    await switchLocale(page, 'zh-CN');
    await dialog.getByRole('button', { name: '确认填回，不生成', exact: true }).waitFor();
    assert.equal(await dialog.getByRole('checkbox').isChecked(), true);
    assert.equal(await page.locator('body').getAttribute('data-prepare-count'), '1');
    assert.equal(await page.locator('body').getAttribute('data-apply-count'), null);
    await switchLocale(page, 'en-US');
    await confirm.waitFor();
    assert.equal(await confirm.isEnabled(), true);
    const dimensions = await checkWidth(dialog);
    await page.screenshot({ path: path.join(artifactDirectory, 'settings-english-dark.png') });
    await page.keyboard.press('Escape');
    assert.equal(await opener.evaluate(el => document.activeElement === el), true);
    assert.equal(await page.locator('body').getAttribute('data-apply-count'), null);
    assert.deepEqual(errors, []);
    report.cases.push({ name: 'settings-locale-switch-no-save', passed: true, dimensions, promptUntouched: true, defaultPlaceholderLocalized: true, acknowledgementRetained: true });
    await page.close();
  }

  {
    const { page, errors } = await makePage('&settings=1&missing-reference=1');
    await page.getByRole('button', { name: 'Create historical input draft', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'original file for Image 2' }).waitFor();
    await page.getByLabel('Choose the original file for Image 2', { exact: true }).setInputFiles({ name: '中文参考.png', mimeType: 'image/png', buffer: Buffer.from('fixture') });
    await page.getByText('中文参考.png', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Confirm reference recovery', exact: true }).click();
    await page.waitForFunction(() => typeof window.finishReferenceRecovery === 'function');
    await switchLocale(page, 'zh-CN');
    await page.getByRole('button', { name: '正在核对原文件…', exact: true }).waitFor();
    assert.equal(await page.locator('body').getAttribute('data-recovery-file'), '中文参考.png');
    await switchLocale(page, 'en-US');
    await page.evaluate(() => window.finishReferenceRecovery());
    const dialog = page.locator('dialog[open]');
    await dialog.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('dialog[open] img')].every(img => img.complete && img.naturalWidth > 0));
    assert.equal(await dialog.getByRole('img', { name: 'Image 2', exact: true }).count(), 1);
    await dialog.getByRole('button', { name: 'Create draft, do not generate', exact: true }).click();
    await page.waitForFunction(() => document.body.dataset.applyStarted === 'true');
    await switchLocale(page, 'zh-CN');
    await dialog.getByRole('button', { name: '正在保存…', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await dialog.count(), 1, 'locale switch does not remove busy-save guard');
    assert.equal(await page.locator('body').getAttribute('data-apply-count'), '1');
    assert.equal(await page.locator('body').getAttribute('data-prepare-count'), '2');
    await page.evaluate(() => window.finishHistoryApply());
    await page.getByText('已新建并保存输入草稿，尚未生成。', { exact: true }).waitFor();
    await switchLocale(page, 'en-US');
    await page.getByText('Input draft created and saved. Nothing has been generated.', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    report.cases.push({ name: 'reference-and-save-pending-locale-switch', passed: true, recoveries: 1, applies: 1, originalFilenameUnchanged: true, save: 'controlled-callback-not-persistence' });
    await page.close();
  }

  {
    const { page, errors } = await makePage();
    await page.waitForFunction(() => document.querySelectorAll('[data-history-group]').length === 24);
    let posts = 0, releaseResponse;
    const gate = new Promise(resolve => { releaseResponse = resolve; });
    await page.route('**/api/project-runs/generation-history/recover?*', async route => {
      posts++; await gate;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, committed: true, retryable: false, stopBatch: true,
        code: 'HISTORY_RECOVERY_COMMIT_UNCONFIRMED', error: 'private raw error must not render' }) });
    });
    const files = ['中文文件.png', '另一个文件.png'].map(name => ({ name, mimeType: 'image/png', buffer: Buffer.from('fixture') }));
    await page.getByLabel('Choose old files to recover', { exact: true }).setInputFiles(files);
    await page.getByRole('button', { name: 'Confirm recovery', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Recovering 1/2: 中文文件.png' }).waitFor();
    await switchLocale(page, 'zh-CN');
    await page.getByRole('status').filter({ hasText: '正在找回 1/2：中文文件.png' }).waitFor();
    assert.equal(posts, 1);
    releaseResponse();
    await page.getByRole('alert').filter({ hasText: '保存确认失败' }).waitFor();
    await switchLocale(page, 'en-US');
    await page.getByRole('alert').filter({ hasText: 'Some data was committed' }).waitFor();
    assert.match(await page.getByRole('status').first().innerText(), /2 file\(s\) remain unconfirmed or unprocessed/);
    assert.equal(await page.getByRole('button', { name: 'Confirm recovery', exact: true }).isDisabled(), true);
    assert.equal(posts, 1, 'locale change must not restart or advance a stopped batch');
    assert.doesNotMatch(await page.locator('body').innerText(), /private raw error/);
    await page.screenshot({ path: path.join(artifactDirectory, 'recovery-english-terminal.png') });
    assert.deepEqual(errors, []);
    report.cases.push({ name: 'recovery-progress-terminal-locale-switch', passed: true, posts, originalFilenamesUnchanged: true, noBatchReplay: true, response: 'controlled-terminal-error' });
    await page.unrouteAll({ behavior: 'wait' });
    await page.close();
  }
};
