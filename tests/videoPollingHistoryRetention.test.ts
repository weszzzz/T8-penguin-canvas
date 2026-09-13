import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { completeVideoRegeneration } from '../src/utils/generationResultRetention.ts';

const source = readFileSync(new URL('../src/components/nodes/VideoNode.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('VideoNode.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['stopPoll', 'isCurrentGenerationRun', 'rejectStoppedGeneration', 'cancelActivePoll', 'startPolling', 'startFalPolling', 'handleStop', 'stopLocalGeneration']);
const declarations: string[] = [];
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && names.has(node.name.getText(tree))) declarations.push(`const ${node.getText(tree)};`);
  ts.forEachChild(node, visit);
}
visit(tree);
assert.equal(declarations.length, names.size);
const code = ts.transpileModule(`${declarations.join('\n')}\nreturn {startPolling,startFalPolling,handleStop};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const create = new Function('scope', `with(scope) { ${code} }`);

// Real polling callbacks with controlled transport, timer and lifecycle writes.
// This deliberately does not claim coverage of submission or installed clients.
function fixture(fal: boolean) {
  let interval: (() => Promise<void>) | null = null;
  const state: any = { data: { videoUrl: '/old.mp4', videoUrls: ['/old.mp4', '/old-2.mp4'], lastPrompt: 'old prompt' }, queries: 0, outcome: 'pending', error: '', sound: 0 };
  const scope: any = {
    cancelRunTrigger: () => true,
    id: 'fixture', src: 'test', apiModel: 'test-model',
    completeVideoRegeneration,
    generationRunRef: { current: 1 }, pollTimer: { current: null }, pollRejectRef: { current: null },
    falPollRef: { current: { endpoint: 'test-endpoint', requestId: 'test-request' } },
    VIDEO_POLL_INTERVAL_MS: 3000, VIDEO_MAX_POLL: 2, VIDEO_FAL_POLL_INTERVAL_MS: 3000, VIDEO_FAL_MAX_POLL: 2,
    isWan: false, isSeedance25: false, isFlux3: false, isHailuo: false, isKling: false, isUpscaler: false,
    isVosr2: false, isFashVsr: false, isVidu: false, isHappyHorse: false, isApimartBudgetVideo: false, isSeedanceNzVideo: false,
    window: { setInterval(fn: () => Promise<void>) { interval = fn; return 1; }, clearInterval() { interval = null; } },
    update(patch: object) { Object.assign(state.data, patch); }, setError() {},
    logBus: { debug() {}, warn() {}, error() {}, success() {} }, console: { warn() {} },
    taskCompletionSound: { notifyComplete() { state.sound++; } },
    normalizeProviderErrorMessage: (value: any, fallback: string) => value?.message || value || fallback,
  };
  const query = async () => { state.queries++; return { status: fal ? 'completed' : 'succeeded', videoUrl: '/new.mp4' }; };
  scope.queryVideo = query; scope.queryVideoFal = query;
  const callbacks = create(scope);
  const reporter: any = { polling: async () => {}, providerResponse: async () => {} };
  function start() {
    const pending = fal ? callbacks.startFalPolling(1, reporter) : callbacks.startPolling('test-task', 1, reporter);
    void pending.then(() => { state.outcome = 'succeeded'; }, (error: Error) => { state.outcome = 'failed'; state.error = error.message; });
    return pending;
  }
  const tick = async () => { assert.ok(interval, 'actual polling interval must be live'); await interval(); await Promise.resolve(); };
  const setResult = (result: object) => { scope.queryVideo = scope.queryVideoFal = async () => { state.queries++; return result; }; };
  const oldIntact = () => { assert.equal(state.data.videoUrl, '/old.mp4'); assert.deepEqual(state.data.videoUrls, ['/old.mp4', '/old-2.mp4']); };
  return { state, scope, reporter, start, tick, setResult, oldIntact, stop: callbacks.handleStop };
}

for (const fal of [false, true]) {
  const label = fal ? 'FAL' : 'standard';
  test(`${label} polling replaces the entire successful video batch`, async t => {
    const h = fixture(fal); t.after(h.stop); const pending = h.start();
    await h.tick(); await pending;
    assert.equal(h.state.data.videoUrl, '/new.mp4');
    assert.deepEqual(h.state.data.videoUrls, ['/new.mp4']);
  });
  for (const success of [true, false]) {
    test(`${label} terminal ${success ? 'success' : 'failure'} receipt rejection settles rather than abandoning the Run`, async t => {
      const h = fixture(fal); t.after(h.stop);
      if (!success) h.setResult({ status: 'failed', error: 'provider failed', failReason: 'provider failed' });
      h.reporter.providerResponse = async () => { throw new Error('fixture receipt failed'); };
      h.start(); await h.tick();
      assert.equal(h.state.outcome, 'failed', 'terminal receipt failure must reject, not leave a pending Promise after timer removal');
      assert.match(h.state.error, /fixture receipt failed/); h.oldIntact();
    });
    test(`${label} stop during terminal ${success ? 'success' : 'failure'} receipt preserves stopped state and old batch`, async t => {
      const h = fixture(fal); t.after(h.stop);
      if (!success) h.setResult({ status: 'failed', error: 'provider failed', failReason: 'provider failed' });
      h.reporter.providerResponse = async () => { h.stop(); };
      h.start(); await h.tick();
      assert.equal(h.state.outcome, 'failed');
      assert.equal(h.state.data.status, 'idle'); h.oldIntact(); assert.equal(h.state.sound, 0);
    });
  }
  test(`${label} empty terminal output fails immediately instead of waiting until timeout`, async t => {
    const h = fixture(fal); t.after(h.stop); h.setResult({ status: fal ? 'completed' : 'succeeded' });
    h.start(); await h.tick(); assert.equal(h.state.outcome, 'failed'); h.oldIntact();
  });
  test(`${label} transient query failure remains retryable and does not discard the old preview`, async t => {
    const h = fixture(fal); t.after(h.stop);
    h.scope.queryVideo = h.scope.queryVideoFal = async () => { throw new Error('transient network'); };
    const pending = h.start(); await h.tick(); assert.equal(h.state.outcome, 'pending'); h.oldIntact();
    h.setResult({ status: fal ? 'completed' : 'succeeded', videoUrl: '/new.mp4' });
    await h.tick(); await pending; assert.equal(h.state.outcome, 'succeeded');
  });
  test(`${label} already aborted Run never queries the Provider`, async t => {
    const h = fixture(fal); t.after(h.stop);
    const controller = new AbortController(); controller.abort(); h.reporter.signal = controller.signal;
    h.start(); await h.tick();
    assert.equal(h.state.outcome, 'failed'); assert.equal(h.state.queries, 0); h.oldIntact();
  });
  test(`${label} Run abort during polling evidence cannot publish a late result`, async t => {
    const h = fixture(fal); t.after(h.stop);
    const controller = new AbortController(); h.reporter.signal = controller.signal;
    h.reporter.polling = async () => controller.abort();
    h.start(); await h.tick();
    assert.equal(h.state.outcome, 'failed'); h.oldIntact(); assert.equal(h.state.sound, 0);
  });
  test(`${label} pending terminal evidence leaves the preview untouched until it resolves`, async t => {
    const h = fixture(fal); t.after(h.stop); let release!: () => void;
    h.reporter.providerResponse = () => new Promise<void>(resolve => { release = resolve; });
    const pending = h.start(); const ticking = h.tick();
    for (let i = 0; i < 20 && !release; i++) await Promise.resolve();
    assert.ok(release); h.oldIntact(); assert.equal(h.state.outcome, 'pending');
    release(); await ticking; await pending; assert.equal(h.state.data.videoUrl, '/new.mp4');
  });
  test(`${label} ordinary timeout still rejects and keeps earlier output`, async t => {
    const h = fixture(fal); t.after(h.stop); h.setResult({ status: 'pending' });
    h.start(); await h.tick(); await h.tick(); await h.tick();
    assert.equal(h.state.outcome, 'failed'); assert.match(h.state.error, /超时/); h.oldIntact();
  });
}
