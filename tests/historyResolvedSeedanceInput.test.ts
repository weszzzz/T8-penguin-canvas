import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { captureHistoryExecution, historyResolvedSeedanceInput, HISTORY_SEEDANCE_INPUT_SCHEMA } from '../src/utils/historyResolvedSeedanceInput.ts';
import { captureGenerationHistoryInput } from '../src/utils/generationHistoryCapture.ts';
import { prepareHistoryInputDraft } from '../src/utils/generationHistoryInputDraft.ts';
import { prepareHistorySettingsDraft } from '../src/utils/generationHistorySettings.ts';
const { completeSnapshot, archiveInput } = createRequire(import.meta.url)('../backend/src/services/generationHistoryInputs');
function resolved() { return {
  schema: HISTORY_SEEDANCE_INPUT_SCHEMA, origin: 'frontend-request', prompt: 'executed upstream prompt',
  model: 'saved-model', seedanceNzModel: 'saved-nz', seedanceApiSource: 'auto', providerSource: 'zhenzhen',
  duration: 10, ratio: '9:16', resolution: '720p', generateAudio: true, returnLastFrame: false, watermark: false, webSearch: false,
  seed: -1, maxPoll: 360, pollInt: 10, frameMode: 'firstlast', localRefImages: [], localRefVideos: [], localRefAudios: [],
  providerParams: { temperature: 0.3 },
}; }
function captured() {
  const target = { id: 'g', type: 'seedance', entityUid: 'a1000000-0000-4000-8000-000000000001', position: { x: 0, y: 0 }, data: { prompt: 'raw node prompt' } };
  const snapshot = captureGenerationHistoryInput([target], [], target.id, resolved());
  const scope = { projectId: 'p', canvasId: 'c' };
  const archive = archiveInput({ ...scope, entityUid: 'run' }, { entityUid: 'node-run', nodeId: target.id, nodeEntityUid: target.entityUid, historyInputSnapshot: snapshot }, { entityUid: 'attempt' });
  const group: any = { id: 'group', nodeId: target.id, nodeEntityUid: target.entityUid, nodeType: target.type, snapshotAvailable: true };
  return { archive, target, group, scope };
}

test('one render executor and resolved inputs remain paired across async initialization; non-adapted nodes keep compatibility', async () => {
  let calls = '', current = { run: () => { calls += 'first'; }, capture: () => ({ prompt: 'first' }) };
  const execution = captureHistoryExecution(current.run, current.capture)!;
  current = { run: () => { calls += 'second'; }, capture: () => ({ prompt: 'second' }) };
  await Promise.resolve(); execution.run();
  assert.equal(calls, 'first'); assert.equal(execution.resolvedInput.prompt, 'first');
  assert.equal(captureHistoryExecution(current.run), undefined);
});

test('resolved defaults are isolated from raw graph, preserved by archive, and used by both explicit draft paths', async () => {
  const f = captured(); assert.equal(f.archive.status, 'available');
  assert.equal(f.archive.snapshot.node.data.duration, undefined, 'never pretend an omitted raw field was explicitly set');
  assert.equal(f.archive.snapshot.node.data.prompt, 'raw node prompt');
  const draft = await prepareHistoryInputDraft(f.archive, f.group, f.scope, { assertCurrent() {}, getAsset: async () => { throw new Error('no references'); }, request: async () => ({ ok: true }) });
  assert.equal(draft.data.prompt, 'executed upstream prompt'); assert.equal(draft.data.duration, 10);
  assert.equal(draft.data.resolution, '720p'); assert.equal(draft.data.seedanceApiSource, 'auto', 'never invent auto-provider final selection');
  assert.deepEqual(draft.data.providerParams, { temperature: 0.3 }); assert.equal(draft.resolvedFrontendInputs, true);
  assert.ok(draft.fields.some(field => field.key === 'providerParams'));
  const inPlace = prepareHistorySettingsDraft(f.archive, f.group, f.target, f.scope);
  assert.equal(inPlace.dataPatch.duration, 10); assert.equal(inPlace.dataPatch.prompt, draft.prompt);
  assert.equal(inPlace.dataPatch.providerParams, undefined, 'basic in-place path still leaves current extension configuration alone');
});

test('resolved capture strips credentials and stale metadata, validates complete values and never guesses unknown versions', () => {
  const target = { id: 'g', type: 'seedance', position: { x: 0, y: 0 }, data: { historyResolvedInput: { stale: true } } };
  const old = captureGenerationHistoryInput([target], [], 'g');
  assert.ok(old.complete); assert.equal(old.node.data.historyResolvedInput, undefined);
  const input = { ...resolved(), providerParams: { temperature: 0.3, apiKey: 'private-secret-value' } };
  const capture = captureGenerationHistoryInput([target], [], 'g', input);
  assert.ok(capture.complete); assert.equal(capture.credentialsOmitted, true); assert.equal(completeSnapshot(capture, 'g'), true);
  assert.equal(JSON.stringify(capture).includes('private-secret-value'), false);
  input.prompt = 'edited later';
  assert.equal(historyResolvedSeedanceInput(capture.node.data)?.prompt, 'executed upstream prompt');
  for (const update of [{ schema: 'future-schema' }, { duration: undefined }, { localRefImages: [null] }, { providerParams: [] }]) {
    assert.throws(() => historyResolvedSeedanceInput({ historyResolvedInput: { ...resolved(), ...update } }), /历史实际输入/);
  }
});
