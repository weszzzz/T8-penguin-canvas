import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('actual Canvas aggregate distinguishes explicit inline stops from failures without stopping peers', () => {
  const source = read('src/components/Canvas.tsx');
  const tree = ts.createSourceFile('Canvas.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let aggregate = '';
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'status'
      && node.initializer?.getText(tree).includes('stoppedCount')) aggregate = node.initializer.getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree); assert.ok(aggregate);
  const evaluate = new Function('runControl', 'failedCount', 'stoppedCount', `return (${aggregate});`);
  assert.equal(evaluate({ cancelled: false }, 0, 0), 'succeeded');
  assert.equal(evaluate({ cancelled: false }, 0, 1), 'stopped');
  assert.equal(evaluate({ cancelled: false }, 1, 1), 'failed');
  assert.equal(evaluate({ cancelled: true }, 1, 1), 'stopped');
  const done = source.slice(source.indexOf('if (!doneResult.ok)'), source.indexOf('return order.length;', source.indexOf('if (!doneResult.ok)')));
  assert.match(done, /if \(doneResult.stopped\) stoppedCount \+= 1/);
  assert.doesNotMatch(done, /cancelRun|cancelAll|runControl.cancelled\s*=/);
  assert.equal((source.match(/stopped: isStoppedRunCompletion\(/g) || []).length, 2);
});

test('actual hook returned stop closure captures its render token and origin instead of current global selection', async () => {
  const source = read('src/hooks/useRunTrigger.ts');
  const tree = ts.createSourceFile('useRunTrigger.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const fn = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'useRunTrigger') as ts.FunctionDeclaration;
  const ret = fn.body!.statements.filter(ts.isReturnStatement).at(-1)!;
  assert.ok(ret.expression);
  const calls: unknown[] = [];
  const evaluate = new Function('executionToken', 'executionNodeId', 'useRunBusStore', `return (${ret.expression!.getText(tree)});`);
  const executionTokens: Record<string, string> = { 'canvas-a/node': 'old' };
  const bus = { getState: () => ({ executionTokens, cancelExecution: async (...args: unknown[]) => { calls.push(args); return true; } }) };
  const oldStop = evaluate('old', 'canvas-a/node', bus);
  evaluate('new', 'canvas-b/node', bus);
  assert.equal(await oldStop(), true);
  assert.deepEqual(calls, [['canvas-a/node', 'old']]);
  executionTokens['canvas-a/node'] = 'new';
  assert.equal(oldStop(), false);
  assert.equal(evaluate(null, 'canvas-a/node', bus)(), false);
  delete executionTokens['canvas-a/node'];
  assert.equal(evaluate(null, 'canvas-a/node', bus)(), null);
  assert.equal(calls.length, 1);
});

for (const name of ['SeedanceNode', 'ImageNode', 'VideoNode']) test(`${name} stop requests scoped cancellation before local invalidation and hook surfaces persistence failure`, () => {
  const source = read(`src/components/nodes/${name}.tsx`);
  assert.match(source, /const cancelRunTrigger = useRunTrigger\(id,/);
  const stop = source.slice(source.indexOf('const handleStop'), source.indexOf('const cancelRunTrigger = useRunTrigger'));
  assert.match(stop, /if \(cancelRunTrigger\(\) === false\) return;/);
  assert.ok(stop.indexOf('cancelRunTrigger()') < stop.indexOf(name === 'SeedanceNode' ? 'generationRunRef.current += 1' : 'stopLocalGeneration()'));
  if (name !== 'SeedanceNode') assert.match(source, /if \(isCurrentGenerationRun\(runId\)\) stopLocalGeneration\(\)/);
  assert.match(read('src/hooks/useRunTrigger.ts'), /stopped && completionError === error \? 'stopped'/);
});
