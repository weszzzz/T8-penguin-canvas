'use strict';
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');

// Acceptance-only bounded numeric telemetry, not a heap/core dump. Never read
// environment variables, argv, requests, model inputs, URLs or native handles.
function startHistoryVerifierDiagnostics({ write, memory = () => process.memoryUsage(),
  now = () => performance.now(), schedule = setInterval, cancel = clearInterval }) {
  const runtime = { pid: process.pid, node: process.version, arch: process.arch,
    v8: process.versions.v8, uv: process.versions.uv };
  const started = now(), samples = [];
  let stage = 'initializing-verifier', timer, stopped = false, failed = false, recorded = 0;
  const record = () => {
    const usage = memory(), elapsedMs = Math.round(now() - started);
    assert.ok(Number.isSafeInteger(elapsedMs) && elapsedMs >= 0, 'Invalid verifier diagnostic clock');
    const sample = { elapsedMs, stage };
    for (const key of ['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers']) {
      assert.ok(Number.isSafeInteger(usage[key]) && usage[key] >= 0, 'Invalid verifier memory sample');
      sample[key] = usage[key];
    }
    samples.push(sample); if (samples.length > 24) samples.shift(); recorded++;
    const json = JSON.stringify({ schema: 't8-history-verifier-diagnostics-v1', runtime,
      intervalMs: 2000, maxSamples: 24, recorded, samples });
    assert.ok(Buffer.byteLength(json) <= 16384, 'Verifier diagnostics exceeded bounded size');
    write(json);
  };
  const clear = () => { if (timer !== undefined) { cancel(timer); timer = undefined; } };
  const attempt = () => { if (stopped) return; try { record(); } catch { failed = true; stopped = true; clear(); } };
  // Initial failures abort before expensive work. A later timer failure remains
  // fail-closed at the next checkpoint/stop, without throwing from a timer.
  try { record(); } catch { throw new Error('Verifier diagnostics initialization failed'); }
  timer = schedule(attempt, 2000); timer?.unref?.();
  return {
    checkpoint(value) {
      assert.ok(typeof value === 'string' && /^[a-z0-9-]{1,128}$/.test(value), 'Invalid diagnostic stage');
      assert.ok(!stopped && !failed, 'Verifier diagnostics unavailable');
      stage = value; attempt();
      assert.ok(!failed, 'Verifier diagnostics unavailable');
    },
    stop() {
      clear(); if (!stopped) attempt(); stopped = true;
      return { stopped, failed, recordedSampleCount: recorded };
    },
  };
}
module.exports = { startHistoryVerifierDiagnostics };
