import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createRunNodeLifecycleController } from '../src/utils/runLifecycle.ts';
import { collectRunOutputAssets } from '../src/utils/runProviderTrace.ts';

// Execute the actual maintenance callbacks, with controlled read/install I/O.
// No runtime is installed, no Provider is contacted and no user data is read.
function callback(file: string, name: string, scope: Record<string, unknown>) {
  const source = readFileSync(new URL(`../src/components/nodes/${file}`, import.meta.url), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches: ts.Expression[] = [];
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer) {
      const expression = node.initializer;
      matches.push(ts.isCallExpression(expression) && expression.expression.getText(tree) === 'useCallback'
        ? expression.arguments[0] : expression);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(matches.length, 1);
  const code = ts.transpileModule(`return (${matches[0].getText(tree)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function('scope', `with(scope) { ${code} }`)(scope);
}

function fixture(kind: 'refresh' | 'install') {
  const old = { imageUrl: '/files/output/old.png', audioUrl: '/files/output/old.wav', outputText: 'old translation' };
  const state = { data: { ...old, status: 'idle' }, busy: false, installCalls: 0, reads: 0 };
  const scope: Record<string, any> = {
    t: (key: string) => key,
    update: (patch: object) => Object.assign(state.data, patch),
    setBusy: (value: boolean) => { state.busy = value; }, setError() {}, setRuntimeLocal() {},
    loadStatus: async () => { state.reads++; return { configured: true, project: 'fixture' }; },
    loadGroups: async () => [], loadAssets: async () => [], loadImportJobs: async () => [], projectName: '',
    readProject: () => ({ stage: 'review' }),
    commitProject: (base: object, patch: object, nodePatch: object) => {
      Object.assign(state.data, nodePatch); return { ...base, ...patch };
    },
    inspectLocalizationRuntime: async () => ({ licenseAccepted: true, ready: true, install: { running: false } }),
    installLocalizationRuntime: async () => { state.installCalls++; },
    cancelLocalizationRuntime: async () => {}, sleepWithSignal: async () => {},
  };
  const run = kind === 'refresh'
    ? callback('VolcengineAssetsNode.tsx', 'refreshAll', scope)
    : callback('LocalizationMasterNode.tsx', 'runInstall', scope);
  return { state, scope, run, old };
}

for (const kind of ['refresh', 'install'] as const) {
  test(`${kind} explicitly completes without archiving retained media as a new result`, async () => {
    const { run, state, old } = fixture(kind);
    const events: { type: string; payload: Record<string, unknown> }[] = [];
    const lifecycle = createRunNodeLifecycleController({ runContext: null, executionToken: 'maintenance-test',
      sink: { async write(type, payload) { events.push({ type, payload }); } } });
    await run(lifecycle.reporter);
    await lifecycle.flush();
    assert.equal(lifecycle.outputEmitted(), true, 'explicit empty receipt must suppress useRunTrigger output fallback');
    const outputs = events.filter(event => event.type === 'node.output');
    assert.equal(outputs.length, 1);
    assert.deepEqual(outputs[0].payload.assets, []);
    assert.equal(outputs[0].payload.outputCount, 0);
    assert.equal(outputs[0].payload.status, 'succeeded');
    for (const [key, value] of Object.entries(old)) assert.equal((state.data as any)[key], value);
    assert.equal(collectRunOutputAssets(state.data).length, 3, 'old outputs remain usable downstream, not cleared to hide the bug');
    assert.equal(state.busy, false);
  });

  test(`${kind} rejects an output receipt persistence failure instead of reporting completion`, async () => {
    const { run, state, old } = fixture(kind);
    const lifecycle = createRunNodeLifecycleController({ runContext: null, executionToken: 'maintenance-failure',
      sink: { async write(type) { if (type === 'node.output') throw new Error('fixture receipt rejected'); } } });
    await assert.rejects(run(lifecycle.reporter), /fixture receipt rejected/);
    await assert.rejects(lifecycle.flush(), /fixture receipt rejected/);
    assert.equal(lifecycle.outputEmitted(), false);
    assert.notEqual(state.data.status, 'success');
    for (const [key, value] of Object.entries(old)) assert.equal((state.data as any)[key], value);
    assert.equal(state.busy, false);
  });

  test(`${kind} failed prerequisite emits no result and preserves earlier outputs`, async () => {
    const { run, scope, state, old } = fixture(kind);
    scope.loadStatus = async () => ({ configured: false });
    scope.inspectLocalizationRuntime = async () => ({ licenseAccepted: false });
    const events: string[] = [];
    const lifecycle = createRunNodeLifecycleController({ runContext: null, executionToken: 'maintenance-prerequisite',
      sink: { async write(type) { events.push(type); } } });
    await assert.rejects(run(lifecycle.reporter));
    await lifecycle.flush();
    assert.equal(lifecycle.outputEmitted(), false);
    assert.equal(events.includes('node.output'), false);
    assert.equal(state.installCalls, 0);
    for (const [key, value] of Object.entries(old)) assert.equal((state.data as any)[key], value);
  });
}
