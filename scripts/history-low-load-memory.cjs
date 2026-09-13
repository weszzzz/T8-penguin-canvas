'use strict';
const assert = require('node:assert/strict');
const v8 = require('node:v8');
const NODE_HEAP_FLAG = '--max-old-space-size=768';
const ELECTRON_HEAP_FLAG = '--js-flags=--max-old-space-size=768';
const GO_SOFT_LIMIT = '512MiB';

// Test harness only. Heap/Go GC budgets exclude native allocations; they do not
// replace the Windows Job's unchanged 4 GiB aggregate commit limit.
function inspectHistoryMemoryBudget({ env = process.env, execArgv = process.execArgv,
  heapSizeLimitBytes = v8.getHeapStatistics().heap_size_limit } = {}) {
  assert.equal(env.T8_ACCEPTANCE_LOW_LOAD, '1', 'Memory budget is only for the isolated low-load runner');
  assert.ok(execArgv.includes(NODE_HEAP_FLAG), 'Start the verifier with the bounded Node old-space flag');
  assert.ok(Number.isSafeInteger(heapSizeLimitBytes) && heapSizeLimitBytes > 0 && heapSizeLimitBytes <= 1024 ** 3,
    'Effective Node heap budget is missing or unexpectedly large');
  assert.equal(env.GOMEMLIMIT, GO_SOFT_LIMIT, 'The esbuild Go soft memory budget must be explicit');
  return { nodeOldSpaceMiB: 768, nodeHeapSizeLimitBytes: heapSizeLimitBytes,
    electronOldSpaceMiB: 768, goSoftMemoryLimit: GO_SOFT_LIMIT, replacesJobLimit: false };
}
module.exports = { NODE_HEAP_FLAG, ELECTRON_HEAP_FLAG, GO_SOFT_LIMIT, inspectHistoryMemoryBudget };
