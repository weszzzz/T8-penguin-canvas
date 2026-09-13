import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { normalizeCanvasNodeSerials } from '../src/utils/nodeSerialIds';
const { hasPersistedNodeSerials } = createRequire(import.meta.url)('../scripts/history-basic-settings-full-main.cjs');

test('unchanged raw seed data is not accepted before Canvas serial normalization is persisted', () => {
  const nodes = [{ id: 'source', type: 'image', position: { x: 0, y: 0 }, data: { prompt: 'unchanged' } }];
  const raw = { nodes, nextNodeSerialId: 1 }, before = structuredClone(raw);
  for (let read = 0; read < 20; read++) assert.equal(hasPersistedNodeSerials(raw, 'source'), false);
  const normalized = normalizeCanvasNodeSerials(nodes, raw.nextNodeSerialId);
  assert.equal(hasPersistedNodeSerials({ nodes: normalized.nodes, nextNodeSerialId: normalized.nextNodeSerialId }, 'source'), true);
  assert.deepEqual(raw, before, 'readiness does not normalize or mutate test/user data');
});
test('source serial alone does not accept an uninitialized auto-output or stale serial counter', () => {
  const source = { id: 'source', type: 'image', position: { x: 0, y: 0 }, data: { nodeSerialId: 1 } };
  const output = { id: 'output', type: 'output', position: { x: 0, y: 0 }, data: {} };
  assert.equal(hasPersistedNodeSerials({ nodes: [source, output], nextNodeSerialId: 2 }, 'source'), false);
  const normalized = normalizeCanvasNodeSerials([source, output], 2);
  assert.equal(hasPersistedNodeSerials({ nodes: normalized.nodes, nextNodeSerialId: 2 }, 'source'), false);
  assert.equal(hasPersistedNodeSerials({ nodes: normalized.nodes, nextNodeSerialId: normalized.nextNodeSerialId }, 'source'), true);
});
test('missing source, duplicate serials and malformed initialization receipts fail closed', () => {
  for (const document of [undefined, { nodes: [] }, { nodes: [{ id: 'other', data: { nodeSerialId: 1 } }], nextNodeSerialId: 2 },
    { nodes: [{ id: 'source', data: { nodeSerialId: 1 } }, { id: 'other', data: { nodeSerialId: 1 } }], nextNodeSerialId: 2 },
    { nodes: [{ id: 'source', data: { nodeSerialId: 0 } }], nextNodeSerialId: 2 }]) {
    assert.equal(hasPersistedNodeSerials(document, 'source'), false);
  }
});
