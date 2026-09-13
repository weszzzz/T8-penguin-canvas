import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { captureGenerationHistoryInput } from '../src/utils/generationHistoryCapture.ts';
import { captureRunNodeInputSnapshot } from '../src/utils/runReplay.ts';
const require = createRequire(import.meta.url);
const { completeSnapshot, storedRunInput, runInputWithoutHistory } = require('../backend/src/services/generationHistoryInputs');
const { redactAndScanRunValue } = require('../backend/src/services/runRedaction');
const node = (prompt: string) => ({ id: 'generator', type: 'seedance', position: { x: 1, y: 2 }, data: { prompt, seed: 42, duration: 10 } });

test('long prompt and ordered reference graph are captured exactly without enabling the old replay path', () => {
  const prompt = '完整保存当时的创作要求。'.repeat(1600);
  const source = { id: 'upload', type: 'upload', position: { x: 0, y: 0 }, data: { imageUrls: Array.from({ length: 14 }, (_, index) => `/files/input/ref-${index}.png`) } };
  const nodes = [node(prompt), source];
  const edges = [{ id: 'reference-edge', source: 'upload', target: 'generator', sourceHandle: 'image', targetHandle: 'images' }];
  const legacy = captureRunNodeInputSnapshot(nodes, edges, 'generator');
  assert.equal(legacy.replayable, false);
  const result = captureGenerationHistoryInput(nodes, edges, 'generator');
  assert.equal(result.complete, true);
  if (!result.complete) throw new Error('Expected full settings capture');
  assert.equal(result.purpose, 'prefill-only');
  assert.equal(result.node.data.prompt, prompt);
  assert.deepEqual(result.upstreamNodes[0].data.imageUrls, source.data.imageUrls);
  assert.equal(result.node.data.seed, 42);
  assert.equal(completeSnapshot(result, 'generator'), true);
  nodes[0].data.prompt = 'new draft';
  assert.equal(result.node.data.prompt, prompt);
  const stored = storedRunInput(legacy, result, 'generator');
  assert.deepEqual(runInputWithoutHistory(stored), legacy);
  assert.equal(stored.__generationHistoryInput.node.data.prompt, prompt);
  assert.ok(redactAndScanRunValue({ prompt }).prompt.length < prompt.length, 'shared Run log redaction remains bounded');
});
test('configured credentials are excluded while harmless settings and optional omitted values survive', () => {
  const value = { ...node('prompt'), data: { prompt: 'prompt', apiKey: 'private-key-value', maxTokens: 8192, credentials: { accessKey: 'private-nested' }, apiBaseUrl: 'https://example.test/api', optional: undefined } };
  const result = captureGenerationHistoryInput([value], [], value.id);
  assert.equal(result.complete, true);
  if (!result.complete) throw new Error('Expected capture');
  assert.equal(result.credentialsOmitted, true);
  assert.equal(JSON.stringify(result).includes('private-key-value'), false);
  assert.equal(result.node.data.apiBaseUrl, 'https://example.test/api');
  assert.equal(result.node.data.maxTokens, 8192);
  assert.equal(result.node.data.credentials, undefined);
  assert.equal(completeSnapshot(result, value.id), true);
});
test('missing references, inline secrets, invalid structures and over-budget inputs never masquerade as complete', () => {
  for (const prompt of ['sk-' + 'a'.repeat(24), 'x'.repeat(131073)]) {
    const result = captureGenerationHistoryInput([node(prompt)], [], 'generator');
    assert.equal(result.complete, false); assert.equal('node' in result, false);
  }
  assert.equal(captureGenerationHistoryInput([node('normal')], [{ id: 'broken', source: 'missing', target: 'generator' }], 'generator').complete, false);
  const sparse = { ...node('normal'), data: { items: new Array(101) } };
  assert.equal(captureGenerationHistoryInput([sparse], [], 'generator').complete, false);
  const huge = { ...node('normal'), data: { paragraphs: Array.from({ length: 10 }, () => '长'.repeat(30000)) } };
  assert.equal(captureGenerationHistoryInput([huge], [], 'generator').complete, false);
});
test('normal run startup sends a distinct history capture and does not replace replay input', () => {
  const source = readFileSync(new URL('../src/hooks/useRunTrigger.ts', import.meta.url), 'utf8');
  assert.match(source, /const inputSnapshot = captureRunNodeInputSnapshot/);
  assert.match(source, /const historyInputSnapshot = captureGenerationHistoryInput/);
  assert.match(source, /historyInputSnapshot: historyInputSnapshot as unknown/);
  const captured = captureGenerationHistoryInput([node('current')], [], 'generator');
  const forged = storedRunInput({ __generationHistoryInput: captured }, undefined, 'generator');
  assert.equal(forged.__generationHistoryInput, undefined, 'legacy envelope cannot inject private history');
});

test('backend only exempts the exact boolean capture metadata, never similarly named secrets', () => {
  const capture = captureGenerationHistoryInput([node('safe')], [], 'generator');
  assert.equal(completeSnapshot(capture, 'generator'), true);
  for (const mutate of [
    (value: any) => { value.credentialsOmitted = 'private-value'; },
    (value: any) => { value.node.data.credentialsOmitted = 'private-value'; },
    (value: any) => { value.node.data.credentials = { value: 'private-value' }; },
    (value: any) => { value.node.data.accessKey = 'private-value'; },
    (value: any) => { value.purpose = 'execute'; },
  ]) {
    const invalid = structuredClone(capture); mutate(invalid);
    assert.equal(completeSnapshot(invalid, 'generator'), false);
    const saved = storedRunInput({}, invalid, 'generator');
    assert.equal(saved.__generationHistoryInput.complete, false);
    assert.equal(JSON.stringify(saved).includes('private-value'), false);
  }
});
