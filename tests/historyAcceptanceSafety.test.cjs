'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { withDeadline, installRendererExitRecorder, whilePageAlive, withNativeRendererGuard, exitIsolatedTestMain } = require('../scripts/history-acceptance-safety.cjs');

test('diagnostic deadline bounds a hung read without retrying or asserting exit', async () => {
  let calls = 0;
  await assert.rejects(withDeadline(() => { calls++; return new Promise(() => {}); }, 15, 'diagnostic'), /deadline exceeded/);
  assert.equal(calls, 1);
  assert.equal(await withDeadline(() => 42, 100, 'quick'), 42);
  await assert.rejects(withDeadline(() => { throw new Error('original'); }, 100, 'quick'), /original/);
});
test('native recorder keeps only bounded reason/code, never native payload or credentials', () => {
  const app = new EventEmitter(), records = [], dispose = installRendererExitRecorder(app, record => records.push(record));
  app.emit('render-process-gone', { secret: 'event' }, { url: 'private' }, { reason: 'oom', exitCode: 7, token: 'secret' });
  app.emit('render-process-gone', {}, {}, { reason: 'secret-value', exitCode: 'private' });
  assert.deepEqual(records, [{ reason: 'oom', exitCode: 7 }, { reason: 'unknown', exitCode: null }]);
  for (let index = 0; index < 100; index++) app.emit('render-process-gone', {}, {}, { reason: 'crashed', exitCode: 1 });
  assert.equal(records.length, 32); dispose(); assert.equal(app.listenerCount('render-process-gone'), 0);
});
test('diagnostic write failure never replaces the native event with a main-process exception', () => {
  const app = new EventEmitter(); installRendererExitRecorder(app, () => { throw new Error('disk unavailable'); });
  assert.doesNotThrow(() => app.emit('render-process-gone', {}, {}, { reason: 'crashed', exitCode: 1 }));
});
for (const event of ['crash', 'close']) test(`page ${event} interrupts a stuck locator and removes listeners`, async () => {
  const page = new EventEmitter(); page.isClosed = () => false;
  const guarded = whilePageAlive(page, () => new Promise(() => {}), 'fixture');
  page.emit(event); await assert.rejects(guarded, event === 'crash' ? /renderer crashed/ : /page closed/);
  assert.equal(page.listenerCount('crash'), 0); assert.equal(page.listenerCount('close'), 0);
});
test('normal page operations and already-closed pages leave no observers or late failure', async () => {
  const page = new EventEmitter(); page.isClosed = () => false;
  assert.equal(await whilePageAlive(page, () => 42, 'fixture'), 42);
  assert.equal(page.listenerCount('close'), 0);
  page.isClosed = () => true; let ran = false;
  await assert.rejects(whilePageAlive(page, () => { ran = true; }, 'fixture'), /already closed/);
  assert.equal(ran, false); assert.equal(page.listenerCount('crash'), 0);
});
test('failed-test forced exit requires exact owned data root, development app and low-load context', () => {
  const old = process.env.T8_ACCEPTANCE_LOW_LOAD;
  const calls = [], app = { isPackaged: false, getPath: () => 'owned-temporary-data', exit: code => calls.push(code) };
  try {
    process.env.T8_ACCEPTANCE_LOW_LOAD = '1';
    assert.throws(() => exitIsolatedTestMain({ app }, 'other-data'), /identity mismatch/);
    assert.throws(() => exitIsolatedTestMain({ app }, ''), /identity mismatch/);
    app.isPackaged = true; assert.throws(() => exitIsolatedTestMain({ app }, 'owned-temporary-data'), /identity mismatch/);
    app.isPackaged = false; delete process.env.T8_ACCEPTANCE_LOW_LOAD;
    assert.throws(() => exitIsolatedTestMain({ app }, 'owned-temporary-data'), /identity mismatch/);
    assert.deepEqual(calls, []);
    process.env.T8_ACCEPTANCE_LOW_LOAD = '1'; exitIsolatedTestMain({ app }, 'owned-temporary-data');
    assert.deepEqual(calls, [1]);
  } finally { if (old === undefined) delete process.env.T8_ACCEPTANCE_LOW_LOAD; else process.env.T8_ACCEPTANCE_LOW_LOAD = old; }
});

test('native OOM interrupts a hung locator even when no page crash event arrives', async () => {
  const records = []; let calls = 0, reads = 0;
  const signal = setTimeout(() => records.push({ reason: 'oom', exitCode: -536870904 }), 10);
  try {
    await assert.rejects(withNativeRendererGuard(() => { reads++; return records; }, () => {
      calls++; return new Promise(() => {});
    }, 5), /Native renderer failure observed: oom/);
    assert.equal(calls, 1);
    const finishedReads = reads;
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(reads, finishedReads, 'monitor stops after failure, without restarting the action');
  } finally { clearTimeout(signal); }
});

test('native guard preserves normal results, rejects pre-existing failures and never exposes unknown event text', async () => {
  assert.equal(await withNativeRendererGuard(() => [{ reason: 'clean-exit' }], () => 42), 42);
  await assert.rejects(withNativeRendererGuard(() => [], () => { throw new Error('original'); }), /original/);
  let calls = 0;
  await assert.rejects(withNativeRendererGuard(() => [{ reason: 'private-token' }], () => { calls++; }), error => {
    assert.equal(error.message, 'Native renderer failure observed: unknown'); return true;
  });
  await assert.rejects(withNativeRendererGuard(() => null, () => { calls++; }), /diagnostics unavailable/);
  await assert.rejects(withNativeRendererGuard(() => [null], () => { calls++; }), /diagnostics unavailable/);
  assert.equal(calls, 0);
  await assert.rejects(withNativeRendererGuard(() => [], () => new Promise(() => {}), 5, 20), /deadline exceeded/);
});
