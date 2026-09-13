'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { archiveInput, readGenerationHistoryInput, resolvedHistoryPrompt } = require('../backend/src/services/generationHistoryInputs');
const { publicAssetLineage } = require('../backend/src/services/assetPublicView');
const run = { projectId: 'project', canvasId: 'canvas', entityUid: 'run-uid' };
const attempt = { entityUid: 'attempt-uid' };
function snapshot() { return { schema: 't8-run-node-input-v1', replayable: true,
  node: { id: 'node', type: 'seedance', position: { x: 1, y: 2 }, data: { prompt: 'original prompt', seed: 123, duration: 5 } },
  upstreamNodes: [{ id: 'input', type: 'upload', position: { x: 0, y: 0 }, data: { imageUrl: '/files/input/ref.png' } }],
  incomingEdges: [{ id: 'edge', source: 'input', target: 'node' }] }; }
function archive(value) { return archiveInput(run, { entityUid: 'node-run-uid', nodeId: 'node', nodeEntityUid: 'node-uid', inputSnapshot: value }, attempt); }
function event(value) { return { project_id: 'project', canvas_id: 'canvas', run_entity_uid: 'run-uid', node_run_entity_uid: 'node-run-uid', attempt_entity_uid: 'attempt-uid', source_node_id: 'node', source_node_entity_uid: 'node-uid', metadata_json: JSON.stringify({ generationInput: value }) }; }

test('image public input context survives immutable archive and supplies only a recognized prompt projection', () => {
  const contract = require('../backend/src/shared/generationHistoryInputContract.json');
  const value = snapshot(); value.node.type = 'image';
  value.node.data.historyResolvedInput = { schema: contract.imageInputContextSchema, origin: 'frontend-common-context',
    prompt: 'Upstream plus image adjustments', referenceImages: ['/files/input/ref.png'] };
  const saved = archive(value); assert.equal(saved.status, 'available');
  assert.equal(resolvedHistoryPrompt(saved.snapshot), 'Upstream plus image adjustments');
  value.node.data.historyResolvedInput.prompt = 'changed';
  assert.equal(resolvedHistoryPrompt(saved.snapshot), 'Upstream plus image adjustments');
  for (const mutate of [
    data => { data.node.type = 'video'; },
    data => { data.node.data.historyResolvedInput.schema = 'unknown'; },
    data => { data.node.data.historyResolvedInput.origin = 'guessed'; },
    data => { data.node.data.historyResolvedInput.referenceImages = [42]; },
  ]) { const copy = structuredClone(saved.snapshot); mutate(copy); assert.equal(resolvedHistoryPrompt(copy), null); }
  assert.equal(resolvedHistoryPrompt(snapshot()), null);
});

test('archive keeps complete settings and references as a detached hash-bound copy', () => {
  const original = snapshot(); const saved = archive(original);
  assert.equal(saved.status, 'available'); assert.deepEqual(saved.snapshot, original);
  original.node.data.prompt = 'edited later';
  assert.equal(saved.snapshot.node.data.prompt, 'original prompt');
  assert.deepEqual(readGenerationHistoryInput({}, event(saved)), saved);
  saved.snapshot.node.data.seed = 999;
  assert.equal(readGenerationHistoryInput({}, event(saved)).reason, 'archive-invalid');
});
test('unsafe, truncated or structurally incomplete inputs cannot become complete archives', () => {
  for (const change of [
    value => { value.node.data.apiKey = 'private-value'; },
    value => { value.node.data.prompt = '[redacted]'; },
    value => { value.node.data.prompt = 'x'.repeat(4001); },
    value => { value.node.data.url = 'https://example.test/file?X-Amz-Signature=private'; },
    value => { value.node.data.prompt = 'sk-' + 'a'.repeat(24); },
    value => { value.node.data.reference = 'C:\\Users\\private.png'; },
    value => { value.node.data.reference = 'https://example.test/input?path=C%3A%5CUsers%5Cprivate.png'; },
    value => { value.node.data.reference = 'data:image/png;base64,AAAA'; },
    value => { value.upstreamNodes = []; },
    value => { value.upstreamNodes[0].id = 'node'; },
    value => { value.node.data.loop = value; },
    value => { value.node.data.unknown = undefined; },
    value => { value.replayable = false; },
  ]) {
    const value = snapshot(); change(value); const saved = archive(value);
    assert.equal(saved.status, 'unavailable'); assert.equal(saved.snapshot, undefined);
    assert.equal(JSON.stringify(saved).includes('private'), false);
  }
});
test('archive has an aggregate byte budget and rejects oversized or sparse collections before cloning', () => {
  const value = snapshot();
  value.upstreamNodes = Array.from({ length: 79 }, (_, index) => ({ id: `input-${index}`, type: 'text', position: { x: 0, y: 0 }, data: { prompt: 'x'.repeat(4000), text: 'y'.repeat(4000) } }));
  value.incomingEdges = [];
  assert.equal(archive(value).status, 'unavailable');
  const sparse = snapshot(); sparse.node.data.items = new Array(101);
  assert.equal(archive(sparse).status, 'unavailable');
});
test('ordinary public asset lineage omits private input archives and references entirely', () => {
  const value = publicAssetLineage({ sourceType: 'node-output', metadata: { provider: 'fixture', generationInput: archive(snapshot()), generationInputRef: 'private-ref' } });
  assert.deepEqual(value.metadata, { provider: 'fixture' });
});

test('typed material identities retain ordered public URLs without exempting private paths or credentials', () => {
  for (const field of ['materialOrder', 'excludedMaterialIds', 'materialKey']) {
    const set = (value, text) => { value.node.data[field] = field === 'materialKey' ? text : [text]; };
    for (const id of ['input::image:/files/input/ref.png', 'input::last:video:/api/project-assets/ref/media', 'input::audio:https://example.test/ref.mp3']) {
      const value = snapshot(); set(value, id);
      assert.equal(archive(value).status, 'available', id);
      assert.deepEqual(archive(value).snapshot.node.data[field], value.node.data[field]);
    }
    for (const id of ['input::image:C:/Users/private.png', 'input::image:/home/private.png',
      'input::image:/files/input/ref.png?path=C%3A%5CUsers%5Cprivate.png',
      'input::image:https://user:password@example.test/ref.png',
      'input::image:/files/input/ref.png?expires=123',
      'input::image:https://example.test/ref.png?sig=private']) {
      const value = snapshot(); set(value, id);
      assert.equal(archive(value).status, 'unavailable', id);
    }
  }
  const value = snapshot(); value.node.data.prompt = 'input::image:/files/input/ref.png';
  assert.equal(archive(value).status, 'unavailable');
  const mention = snapshot(); mention.node.data.promptMentions = [{ materialKey: 'image:/api/project-assets/ref/media?projectId=project', url: '/api/project-assets/ref/media?projectId=project' }];
  assert.equal(archive(mention).status, 'available');
});

test('reference identity is part of the archive digest and cannot be substituted after archival', () => {
  const input = snapshot();
  const references = { schema: 't8-generation-reference-bindings-v1', status: 'captured', timing: 'node-run-created', coverage: 'captured-graph-url-occurrences', entries: [
    { path: ['upstreamNodes', 0, 'data', 'imageUrl'], status: 'bound', assetId: 'ref', entityUid: 'a1000000-0000-4000-8000-000000000001', contentHash: 'a'.repeat(64), kind: 'image', storageEvidence: 'cas-index-verified' },
  ] };
  const saved = archiveInput(run, { entityUid: 'node-run-uid', nodeId: 'node', nodeEntityUid: 'node-uid', inputSnapshot: input, historyReferenceManifest: references }, attempt);
  assert.equal(saved.status, 'available'); assert.deepEqual(readGenerationHistoryInput({}, event(saved)), saved);
  saved.references.entries[0].contentHash = 'b'.repeat(64);
  assert.equal(readGenerationHistoryInput({}, event(saved)).reason, 'archive-invalid');
});
