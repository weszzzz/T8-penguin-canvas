'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { NODE_HEAP_FLAG, ELECTRON_HEAP_FLAG, GO_SOFT_LIMIT, inspectHistoryMemoryBudget } = require('../scripts/history-low-load-memory.cjs');

test('actual idle Node child has bounded heap and explicit esbuild soft budget without starting an app', () => {
  const child = spawnSync(process.execPath, [NODE_HEAP_FLAG, '-e',
    'console.log(JSON.stringify(require("./scripts/history-low-load-memory.cjs").inspectHistoryMemoryBudget()))'], {
    cwd: require('node:path').resolve(__dirname, '..'), encoding: 'utf8', windowsHide: true, timeout: 5000,
    env: { ...process.env, T8_ACCEPTANCE_LOW_LOAD: '1', GOMEMLIMIT: GO_SOFT_LIMIT },
  });
  assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stderr);
  const budget = JSON.parse(child.stdout);
  assert.equal(budget.nodeOldSpaceMiB, 768); assert.equal(budget.replacesJobLimit, false);
  assert.ok(budget.nodeHeapSizeLimitBytes > 0 && budget.nodeHeapSizeLimitBytes <= 1024 ** 3);
  assert.equal(budget.goSoftMemoryLimit, GO_SOFT_LIMIT);
});

test('missing or overridden memory policy fails before expensive verifier setup', () => {
  const base = { env: { T8_ACCEPTANCE_LOW_LOAD: '1', GOMEMLIMIT: GO_SOFT_LIMIT }, execArgv: [NODE_HEAP_FLAG], heapSizeLimitBytes: 855638016 };
  for (const patch of [{ env: {} }, { env: { ...base.env, GOMEMLIMIT: 'off' } }, { execArgv: [] },
    { heapSizeLimitBytes: 4 * 1024 ** 3 }, { heapSizeLimitBytes: NaN }, { heapSizeLimitBytes: 0 }]) {
    assert.throws(() => inspectHistoryMemoryBudget({ ...base, ...patch }));
  }
  assert.equal(inspectHistoryMemoryBudget(base).electronOldSpaceMiB, 768);
});

test('runner and full Electron verifier wire the same budgets without altering product startup or Job limits', () => {
  const runner = readFileSync(require.resolve('../scripts/run-history-low-load.ps1'), 'utf8');
  const verifier = readFileSync(require.resolve('../scripts/verify-generation-history-full-electron.cjs'), 'utf8');
  assert.ok(runner.includes(`$taskNodeHeapFlag = '${NODE_HEAP_FLAG}'`));
  assert.ok(runner.includes(`$env:GOMEMLIMIT = '${GO_SOFT_LIMIT}'`));
  assert.match(runner, /& \$taskNode \$taskNodeHeapFlag scripts\/verify-generation-history-full-electron\.cjs/);
  assert.match(runner, /JobMemory=new UIntPtr\(4UL\*1024\*1024\*1024\)/);
  assert.ok(verifier.indexOf('inspectHistoryMemoryBudget()') < verifier.indexOf('fs.mkdtempSync('));
  assert.ok(verifier.includes('...(memoryBudget ? [ELECTRON_HEAP_FLAG] : [])'));
  assert.equal(ELECTRON_HEAP_FLAG, '--js-flags=--max-old-space-size=768');
  assert.match(verifier, /getSwitchValue\('js-flags'\)/);
});
