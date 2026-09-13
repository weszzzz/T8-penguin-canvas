'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanupVerificationResources } = require('../scripts/verify-generation-history-canvas.cjs');

for (const failed of [null, 'pages', 'browser', 'frontend', 'backend', 'temporary-data']) {
  test(`history verifier attempts all owned resource cleanup after ${failed || 'no'} failure`, async () => {
    const observed = [];
    const names = ['pages', 'browser', 'frontend', 'backend', 'temporary-data'];
    const errors = await cleanupVerificationResources(names.map(name => [name, async () => {
      await Promise.resolve(); observed.push(name);
      if (name === failed) throw new Error(`fixture ${name} failed`);
    }]));
    assert.deepEqual(observed, names);
    assert.deepEqual(errors, failed ? [{ resource: failed, error: `fixture ${failed} failed` }] : []);
  });
}
