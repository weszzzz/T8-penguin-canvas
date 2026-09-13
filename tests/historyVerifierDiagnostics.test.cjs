'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startHistoryVerifierDiagnostics } = require('../scripts/history-verifier-diagnostics.cjs');

function fixture(overrides = {}) {
  let tick, elapsed = 0, unrefs = 0, cancels = 0;
  const writes = [], handle = { unref() { unrefs++; } };
  const recorder = startHistoryVerifierDiagnostics({
    write(json) { writes.push(json); }, now: () => elapsed,
    memory: () => ({ rss: 100, heapTotal: 80, heapUsed: 60, external: 20, arrayBuffers: 10, secret: 'never-record' }),
    schedule(callback, interval) { assert.equal(interval, 2000); tick = callback; return handle; },
    cancel(value) { assert.equal(value, handle); cancels++; }, ...overrides,
  });
  return { recorder, writes, tick() { elapsed += 2000; tick(); }, state: () => ({ unrefs, cancels }) };
}

test('diagnostics bound history and bytes, whitelist numeric memory and retain exact process identity without private context', () => {
  const f = fixture(); f.recorder.checkpoint('waiting-for-canvas');
  for (let i = 0; i < 40; i++) f.tick();
  const last = JSON.parse(f.writes.at(-1));
  assert.equal(last.samples.length, 24); assert.equal(last.recorded, 42);
  assert.equal(last.runtime.pid, process.pid); assert.equal(last.runtime.node, process.version);
  assert.deepEqual(Object.keys(last.runtime), ['pid', 'node', 'arch', 'v8', 'uv']);
  assert.equal(last.samples.at(-1).stage, 'waiting-for-canvas');
  assert.deepEqual(Object.keys(last.samples[0]), ['elapsedMs', 'stage', 'rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers']);
  assert.ok(f.writes.every(json => Buffer.byteLength(json) <= 16384 && !json.includes('never-record')));
  assert.deepEqual(f.recorder.stop(), { stopped: true, failed: false, recordedSampleCount: 43 });
  const count = f.writes.length; f.recorder.stop(); f.tick(); assert.equal(f.writes.length, count);
  assert.deepEqual(f.state(), { unrefs: 1, cancels: 1 });
  assert.throws(() => f.recorder.checkpoint('after-stop'), /unavailable/);
});

test('invalid data and write failure stop telemetry and fail closed without exposing arbitrary errors', () => {
  assert.throws(() => fixture({ memory: () => ({ rss: -1 }) }), /diagnostics initialization failed/);
  assert.throws(() => fixture({ write() { throw new Error('private-initial-write'); } }), /diagnostics initialization failed/);
  const f = fixture(); const count = f.writes.length;
  assert.throws(() => f.recorder.checkpoint('https://private.invalid/key'), /Invalid diagnostic stage/);
  assert.equal(f.writes.length, count); f.recorder.stop();
  let calls = 0;
  const failed = fixture({ write() { if (++calls > 1) throw new Error('private-path-and-token'); } });
  failed.tick(); assert.equal(failed.state().cancels, 1);
  assert.throws(() => failed.recorder.checkpoint('canvas-visible'), /Verifier diagnostics unavailable/);
  assert.equal(failed.recorder.stop().failed, true);
  failed.tick(); assert.equal(calls, 2, 'queued timer cannot retry I/O after failure');
});

test('full verifier starts diagnostics before Vite and rejects missing final telemetry without changing limits', () => {
  const source = require('node:fs').readFileSync(require.resolve('../scripts/verify-generation-history-full-electron.cjs'), 'utf8');
  assert.ok(source.indexOf('diagnostics = startHistoryVerifierDiagnostics') < source.indexOf("await import('vite')"));
  for (const stage of ['frontend-window-observed', 'waiting-for-canvas', 'reading-owned-app-info']) assert.ok(source.includes(`checkpoint('${stage}')`));
  assert.match(source, /diagnostics\?\.stop\(\)/);
  assert.match(source, /if \(report.verifierDiagnostics.failed\) report.passed = false/);
});

test('actual acceptance stage call sites comply with the bounded recorder', () => {
  const fs = require('node:fs');
  const f = fixture();
  for (const file of ['verify-generation-history-full-electron', 'generation-history-full-main-rerun']) {
    const source = fs.readFileSync(require.resolve(`../scripts/${file}.cjs`), 'utf8');
    for (const match of source.matchAll(/checkpoint\('([^']+)'\)/g)) f.recorder.checkpoint(match[1]);
  }
  const source = fs.readFileSync(require.resolve('../scripts/history-image-input-full-main.cjs'), 'utf8');
  const factory = source.match(/const stage = (name => checkpoint\([^;]+\));/);
  assert.ok(factory);
  const vm = require('node:vm');
  for (const prefix of ['video', 'image', 'budget-image', 'fal-gpt-image-2-fal', 'banana-gemini-3.1-flash-lite-image']) {
    const stage = vm.runInNewContext(`(${factory[1]})`, { prefix, checkpoint: value => f.recorder.checkpoint(value) });
    for (const match of source.matchAll(/stage\('([^']+)'\)/g)) stage(match[1]);
  }
  assert.equal(f.recorder.stop().failed, false);
});
