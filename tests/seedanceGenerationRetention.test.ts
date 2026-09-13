import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { assertFreshGenerationCompleted, beginVideoRegeneration, completeVideoRegeneration } from '../src/utils/generationResultRetention.ts';
import { HISTORY_SEEDANCE_INPUT_SCHEMA } from '../src/utils/historyResolvedSeedanceInput.ts';
import * as seedanceConfig from '../src/config/seedance.ts';

// Execute the actual node callbacks, extracted structurally rather than copied.
// Dependencies and timer ticks are controlled; this is not a Provider/UI test.
const source = readFileSync(new URL('../src/components/nodes/SeedanceNode.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('SeedanceNode.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['stopPoll', 'nextGenerationRun', 'isCurrentGenerationRun', 'rejectStoppedGeneration', 'cancelActivePoll', 'startPolling', 'handleGenerate', 'handleStop', 'captureHistoryInput']);
const declarations: string[] = [];
const defaultNames = new Set(['savedBuiltinSource', 'builtinSource', 'effectiveTaskProvider', 'isSeedanceNzSelected', 'model', 'seedanceNzModel',
  'duration', 'ratio', 'resolution', 'generateAudio', 'returnLastFrame', 'watermark', 'webSearch', 'seed', 'maxPoll', 'pollInt',
  'rawFrameMode', 'frameMode', 'activeFrameMode', 'builtinModel', 'seedance25Mode', 'activeRatioOptions', 'seedanceNzIsStandard',
  'activeResolutionOptions', 'builtinRatio', 'builtinResolution']);
const defaultDeclarations: string[] = [];
let wrapper = '';
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.has(node.name.text)) declarations.push(`const ${node.getText(tree)};`);
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && defaultNames.has(node.name.text)) defaultDeclarations.push(`const ${node.getText(tree)};`);
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useRunTrigger') wrapper = node.arguments[1].getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
assert.equal(declarations.length, names.size);
assert.ok(wrapper);
const compiled = ts.transpileModule(`${declarations.join('\n')}\nreturn { wrapped: ${wrapper}, handleStop, captureHistoryInput };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
// Only repository-owned function source is evaluated. No supplied prompt is code.
const factory = new Function('scope', `with (scope) { ${compiled} }`);
assert.equal(defaultDeclarations.length, defaultNames.size);
const defaultFactory = new Function('scope', `with (scope) { ${ts.transpileModule(`${defaultDeclarations.join('\n')}\n${declarations.join('\n')}\nreturn { wrapped: ${wrapper}, handleStop, captureHistoryInput };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText} }`);

function harness(external = true, defaults?: { data: Record<string, unknown>; variant: boolean }) {
  const state: any = { data: { status: 'success', videoUrl: '/old.mp4', videoUrls: ['/old.mp4', '/old-2.mp4'], lastPrompt: 'old prompt' }, error: null, calls: 0, queries: 0 };
  let interval: (() => Promise<void>) | null = null;
  const scope: any = {
    cancelRunTrigger: () => true,
    HISTORY_SEEDANCE_INPUT_SCHEMA, model: 'legacy-default', seedanceNzModel: 'fast',
    d: state.data, id: 'fixture', src: 'fixture', localPrompt: 'new prompt', promptMentions: [], mentionMaterials: [],
    setError: (error: string | null) => { state.error = error; }, update: (patch: object) => Object.assign(state.data, patch),
    collectUpstream: () => ({ prompt: '', imageUrls: [], videoUrls: [], audioUrls: [] }), resolveMediaMentions: (prompt: string) => prompt,
    isSeedance25: false, seedance25Mode: 't2v', isJimengCliSelected: false, activeFrameMode: 'auto', isSeedanceNzSelected: false,
    isExternalSelected: external, providerSelection: { provider: { id: 'fixture-provider' } }, externalProviderModel: 'fixture-model',
    effectiveTaskProvider: 'seedance-nz', builtinSource: 'seedance-nz', builtinModel: 'fixture-model', builtinRatio: '16:9', builtinResolution: '480p',
    ratio: '16:9', duration: 5, resolution: '480p', seed: -1, generateAudio: false, returnLastFrame: false, watermark: false, webSearch: false, providerParams: {},
    generationRunRef: { current: 0 }, pollTimer: { current: null }, pollRejectRef: { current: null },
    logBus: { info() {}, warn() {}, error() {}, success() {}, debug() {} }, taskCompletionSound: { primeAudio() {}, notifyComplete() {} },
    assertFreshGenerationCompleted, beginVideoRegeneration, completeVideoRegeneration,
    pollInt: 360, maxPoll: 10, seedanceMinPollCount: (milliseconds: number) => Math.ceil(3600_000 / milliseconds),
    window: { setInterval: (fn: () => Promise<void>) => { interval = fn; return 1; }, clearInterval: () => { interval = null; } },
    generateExternalVideo: async () => { state.calls++; return { videoUrls: ['/new.mp4'] }; },
    submitSeedance: async () => { state.calls++; return { taskId: 'fixture-task', taskProvider: 'seedance-nz' }; },
    querySeedance: async () => { state.queries++; return { status: 'succeeded', videoUrl: '/new.mp4' }; },
    taskId: 'fixture-task',
  };
  Object.defineProperty(scope, 'status', { get: () => state.data.status });
  if (defaults) Object.assign(scope, seedanceConfig, { d: defaults.data, isSeedance25: defaults.variant, hasSeedanceNzKey: false,
    MODEL_OPTIONS: seedanceConfig.LEGACY_SEEDANCE_MODEL_OPTIONS, RATIO_OPTIONS: seedanceConfig.LEGACY_SEEDANCE_RATIO_OPTIONS,
    RESOLUTION_OPTIONS: seedanceConfig.LEGACY_SEEDANCE_RESOLUTION_OPTIONS });
  const callbacks = (defaults ? defaultFactory : factory)(scope);
  const reporter: any = { providerRequest: async () => {}, providerSubmitted: async () => {}, providerResponse: async () => {}, polling: async () => {} };
  const run = () => callbacks.wrapped(reporter);
  const tick = async () => { assert.ok(interval, 'production polling interval must be registered'); await interval(); };
  const untilPolling = async () => { for (let i = 0; i < 30 && !interval; i++) await Promise.resolve(); assert.ok(interval); };
  const oldIntact = () => {
    assert.equal(state.data.videoUrl, '/old.mp4'); assert.deepEqual(state.data.videoUrls, ['/old.mp4', '/old-2.mp4']); assert.equal(state.data.lastPrompt, 'old prompt');
  };
  return { state, scope, reporter, run, tick, untilPolling, oldIntact, stop: callbacks.handleStop, capture: callbacks.captureHistoryInput };
}

test('a stale inline stop closure cannot invalidate or clear the newer local generation', () => {
  const h = harness();
  h.scope.cancelRunTrigger = () => false;
  const before = structuredClone(h.state.data);
  h.stop();
  assert.equal(h.scope.generationRunRef.current, 0);
  assert.deepEqual(h.state.data, before);
});

test('actual SD2/SD2.5 default declarations and generation callback submit the same values as the history adapter', async () => {
  for (const defaults of [{ data: {}, variant: false }, { data: {}, variant: true }, { data: { ratio: 'obsolete-ratio', resolution: 'obsolete-resolution' }, variant: false }]) {
    const h = harness(false, defaults);
    h.scope.collectUpstream = () => ({ prompt: 'upstream @image2', imageUrls: ['/blue.png', '/red.png'], videoUrls: [], audioUrls: [] });
    const captured = h.capture(); let submitted: any;
    h.scope.submitSeedance = async (payload: any) => { submitted = payload; return { taskId: 'fixture-task', taskProvider: 'seedance-nz' }; };
    const running = h.run(); await h.untilPolling(); await h.tick(); await running;
    for (const key of ['prompt', 'duration', 'ratio', 'resolution']) assert.deepEqual(submitted[key], captured[key]);
    for (const [requestKey, field] of [['generate_audio', 'generateAudio'], ['return_last_frame', 'returnLastFrame'], ['watermark', 'watermark'], ['web_search', 'webSearch']]) assert.deepEqual(submitted[requestKey], captured[field]);
    assert.equal(submitted.model, captured.model); assert.equal(submitted.taskProvider, captured.seedanceApiSource);
    assert.deepEqual(defaults.variant ? [submitted.firstFrame, submitted.lastFrame] : submitted.refImages, captured.localRefImages);
    assert.equal(captured.seed, -1); assert.equal(submitted.seed, undefined);
    assert.equal(captured.schema, HISTORY_SEEDANCE_INPUT_SCHEMA);
  }
});

test('external history adapter records the merged request parameters rather than raw node defaults', async () => {
  const h = harness(true); h.scope.providerSelection.providerSource = 'custom'; h.scope.d.providerParams = { temperature: 0.2, generate_audio: true };
  let submitted: any; h.scope.generateExternalVideo = async (payload: any) => { submitted = payload; return { videoUrls: ['/new.mp4'] }; };
  const captured = h.capture(); await h.run();
  assert.deepEqual(captured.providerParams, submitted.providerParams);
  assert.equal(captured.providerParams.generate_audio, false, 'live explicit flag overrides the extension raw value');
  assert.equal(captured.providerId, submitted.providerId); assert.equal(captured.providerModel, submitted.providerModel);
  for (const key of ['prompt', 'duration', 'ratio', 'resolution']) assert.equal(captured[key], submitted[key]);
});

test('early validation failure cannot reuse a prior success or archive old output as new', async () => {
  const h = harness(); h.scope.localPrompt = '';
  await assert.rejects(h.run(), { code: 'GENERATION_NOT_COMPLETED' });
  h.oldIntact(); assert.equal(h.state.calls, 0); assert.match(h.state.error, /prompt/);
});

test('external rejection preserves the prior multi-output preview and its prompt', async () => {
  const h = harness();
  h.scope.generateExternalVideo = async () => { h.state.calls++; h.oldIntact(); assert.equal(h.state.data.showingPreviousResult, true); throw new Error('fixture upstream failed'); };
  await assert.rejects(h.run(), /fixture upstream failed/);
  h.oldIntact(); assert.equal(h.state.data.status, 'error'); assert.equal(h.state.calls, 1);
});

test('external success replaces the whole old output array and binds the submitted prompt', async () => {
  const h = harness(); await h.run();
  assert.equal(h.state.data.videoUrl, '/new.mp4'); assert.deepEqual(h.state.data.videoUrls, ['/new.mp4']);
  assert.equal(h.state.data.lastPrompt, 'new prompt'); assert.equal(h.state.data.showingPreviousResult, false);
});

test('local stop during external response evidence prevents late preview replacement and success', async () => {
  const h = harness(); h.reporter.providerResponse = async () => h.stop();
  await assert.rejects(h.run(), { code: 'GENERATION_NOT_COMPLETED' }); h.oldIntact(); assert.equal(h.state.calls, 1);
});

test('built-in polling retains old preview and prompt until a successful response', async () => {
  const h = harness(false); const running = h.run(); await h.untilPolling(); h.oldIntact();
  await h.tick(); await running;
  assert.deepEqual(h.state.data.videoUrls, ['/new.mp4']); assert.equal(h.state.data.lastPrompt, 'new prompt');
  assert.equal(h.state.calls, 1); assert.equal(h.state.queries, 1);
});

test('built-in terminal failure retains previous output and rejects the execution', async () => {
  const h = harness(false); h.scope.querySeedance = async () => ({ status: 'failed', failReason: 'fixture task failed' });
  const rejected = assert.rejects(h.run(), /fixture task failed/); await h.untilPolling(); await h.tick(); await rejected; h.oldIntact();
});

test('terminal evidence persistence rejection settles polling instead of hanging or replacing old preview', async () => {
  const h = harness(false); h.reporter.providerResponse = async () => { throw new Error('evidence unavailable'); };
  const rejected = assert.rejects(h.run(), /evidence unavailable/); await h.untilPolling(); await h.tick(); await rejected;
  h.oldIntact(); assert.equal(h.state.data.status, 'error');
});

test('stop while polling evidence awaits prevents a late successful task from replacing the old preview', async () => {
  const h = harness(false); h.reporter.polling = async () => h.stop();
  const rejected = assert.rejects(h.run(), { code: 'GENERATION_NOT_COMPLETED' }); await h.untilPolling(); await h.tick(); await rejected; h.oldIntact();
});

test('empty result and busy-node attempts do not resolve as newly completed generation', async () => {
  const h = harness(); h.scope.generateExternalVideo = async () => ({ videoUrls: [] });
  await assert.rejects(h.run(), /没有返回视频/); h.oldIntact();
  h.state.data.status = 'polling'; await assert.rejects(h.run(), { code: 'GENERATION_NOT_COMPLETED' }); h.oldIntact();
});

test('success, failed regeneration, and next success only admit the two fresh outputs', async () => {
  const h = harness(); const admitted: string[] = [];
  await h.run().then(() => admitted.push(h.state.data.videoUrl));
  h.scope.localPrompt = 'second prompt'; h.scope.generateExternalVideo = async () => { throw new Error('second failed'); };
  await assert.rejects(h.run().then(() => admitted.push(h.state.data.videoUrl)), /second failed/);
  assert.equal(h.state.data.videoUrl, '/new.mp4'); assert.equal(h.state.data.lastPrompt, 'new prompt');
  h.scope.localPrompt = 'third prompt'; h.scope.generateExternalVideo = async () => ({ videoUrls: ['/third.mp4'] });
  await h.run().then(() => admitted.push(h.state.data.videoUrl));
  assert.deepEqual(admitted, ['/new.mp4', '/third.mp4']); assert.equal(h.state.data.lastPrompt, 'third prompt');
});

test('polling timeout preserves the prior result and never resubmits generation', async () => {
  const h = harness(false); h.scope.querySeedance = async () => { h.state.queries++; return { status: 'running' }; };
  const rejected = assert.rejects(h.run(), /轮询超时/); await h.untilPolling();
  for (let index = 0; index < 11; index++) await h.tick();
  await rejected; h.oldIntact(); assert.equal(h.state.calls, 1); assert.equal(h.state.queries, 10);
});

test('a late failed task cannot overwrite a newer node state after user stop', async () => {
  const h = harness(false); h.scope.querySeedance = async () => ({ status: 'failed', failReason: 'late failure' });
  h.reporter.providerResponse = async () => { h.stop(); h.state.data.status = 'success'; h.state.data.videoUrl = '/newer.mp4'; };
  const rejected = assert.rejects(h.run(), { code: 'GENERATION_NOT_COMPLETED' }); await h.untilPolling(); await h.tick(); await rejected;
  assert.equal(h.state.data.status, 'success'); assert.equal(h.state.data.videoUrl, '/newer.mp4');
});
