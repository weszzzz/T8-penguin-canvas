import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForCanvasCloseSave } from '../src/utils/canvasCloseSave';

function fixture(states: Array<{ dirty: boolean; queued: boolean; blocked?: 'running' | 'conflict' }>) {
  let time = 0;
  let reads = 0;
  let flushes = 0;
  let cancelled = false;
  return {
    options: {
      read: () => states[Math.min(reads++, states.length - 1)],
      flush: () => { flushes++; },
      cancelled: () => cancelled,
      now: () => time,
      turn: async () => { time += 50; },
      timeoutMs: 500,
    },
    get flushes() { return flushes; },
    get reads() { return reads; },
    cancel: () => { cancelled = true; },
  };
}
const clean = { dirty: false, queued: false };
test('close flushes debounce and waits for acknowledged latest graph, not just Run completion', async () => {
  const f = fixture([{ dirty: true, queued: true }, { dirty: true, queued: false }, clean, clean]);
  assert.deepEqual(await waitForCanvasCloseSave(f.options), { ok: true });
  assert.equal(f.flushes, 1);
  assert.equal(f.reads, 4);
});
test('swallowed save failure never becomes an accepted close receipt', async () => {
  const f = fixture([{ dirty: true, queued: false }]);
  assert.deepEqual(await waitForCanvasCloseSave(f.options), { ok: false, reason: 'save' });
});
test('in-flight queue and a graph edited after first clean check both delay close', async () => {
  const f = fixture([clean, { dirty: false, queued: true }, clean, { dirty: true, queued: false }, clean, clean]);
  assert.deepEqual(await waitForCanvasCloseSave(f.options), { ok: true });
  assert.equal(f.reads, 6);
});
for (const blocked of ['running', 'conflict'] as const) {
  test(`close retains window on ${blocked}, without flushing or cancelling tasks`, async () => {
    const f = fixture([{ ...clean, blocked }]);
    assert.deepEqual(await waitForCanvasCloseSave(f.options), { ok: false, reason: blocked });
    assert.equal(f.flushes, 0);
  });
}
test('main cancellation or unmount refuses even an otherwise clean graph', async () => {
  const f = fixture([clean]);
  f.cancel();
  assert.deepEqual(await waitForCanvasCloseSave(f.options), { ok: false, reason: 'save' });
  assert.equal(f.reads, 0);
});

test('persistent save failure does not turn observation polling into a write storm', async () => {
  const f = fixture([{ dirty: true, queued: false }]);
  f.options.timeoutMs = 8000;
  assert.deepEqual(await waitForCanvasCloseSave(f.options), { ok: false, reason: 'save' });
  assert.ok(f.flushes <= 10, `Expected at most ten explicit flushes, got ${f.flushes}`);
});
