import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchesGenerationHistorySource } from '../src/utils/generationHistorySource.ts';

const scope = { projectId: 'project', canvasId: 'canvas' };
const expected = { ...scope, nodeEntityUid: 'a1000000-0000-4000-8000-000000000001' };
const node = { id: 'generator', entityUid: expected.nodeEntityUid };

test('history focus checks exact node identity and live scope instead of trusting an earlier visible card', () => {
  assert.equal(matchesGenerationHistorySource(node, node.id, expected, scope), true);
  assert.equal(matchesGenerationHistorySource(undefined, node.id, expected, scope), false);
  assert.equal(matchesGenerationHistorySource({ ...node, entityUid: 'replacement' }, node.id, expected, scope), false);
  assert.equal(matchesGenerationHistorySource({ id: node.id }, node.id, expected, scope), false);
  assert.equal(matchesGenerationHistorySource(node, 'other-node', expected, scope), false);
  assert.equal(matchesGenerationHistorySource(node, node.id, expected, { ...scope, canvasId: 'other' }), false);
  assert.equal(matchesGenerationHistorySource(node, node.id, expected, { ...scope, projectId: 'other' }), false);
  assert.equal(matchesGenerationHistorySource(node, node.id, { ...expected, nodeEntityUid: '' }, scope), false);
});

test('selected-node history count, drawer scope and focus retain the immutable identity', () => {
  const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
  const actions = read('../src/components/NodeActionBar.tsx');
  const canvas = read('../src/components/Canvas.tsx');
  const records = read('../src/components/GenerationHistoryRecords.tsx');
  assert.match(actions, /nodeEntityUid: selectedHistoryUid/);
  assert.match(actions, /onOpenHistory\(selectedExe.id, selectedHistoryUid\)/);
  assert.match(canvas, /setGenerationHistorySource\(\{ nodeId, nodeEntityUid \}\)/);
  assert.match(canvas, /matchesGenerationHistorySource\(target, nodeId, expected/);
  assert.match(records, /nodeEntityUid: group.nodeEntityUid!/);
  assert.match(records, /generationHistory.uncertainSource/);
});
