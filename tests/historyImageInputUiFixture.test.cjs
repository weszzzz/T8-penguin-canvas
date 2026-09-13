'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFixture } = require('../scripts/history-image-input-ui.cjs');

test('image UI transport fails the first held preview exactly once, checks identity and serves later PNG reads', async () => {
  const fixture = await createFixture();
  const asset = fixture.assets[0];
  const url = `/api/project-assets/${asset.id}/media?` + new URLSearchParams({
    projectId: asset.projectId, entityUid: asset.entityUid, contentHash: asset.contentHash, referenceSlot: '0',
  });
  function response() {
    return { destroyed: false, status: 200, headers: {}, ended: false, body: null,
      setHeader(key, value) { this.headers[key] = value; }, writeHead(status) { this.status = status; },
      end(value) { this.ended = true; this.body = value; } };
  }
  const head = response(); assert.equal(fixture.serve({ url, method: 'HEAD' }, head), true);
  assert.equal(head.ended, true); assert.equal(head.status, 200); assert.equal(fixture.stats.heads, 1);
  const first = response(); fixture.serve({ url, method: 'GET' }, first); assert.equal(first.ended, false);
  fixture.failOnePreview(); fixture.releasePreviews();
  assert.equal(first.ended, true); assert.equal(first.status, 404); assert.equal(fixture.stats.previewFailures, 1);
  const next = response(); fixture.serve({ url, method: 'GET' }, next);
  assert.equal(next.status, 200); assert.equal(next.headers['Content-Type'], 'image/png');
  assert.equal(next.headers['Cache-Control'], 'no-store');
  assert.ok(Buffer.isBuffer(next.body)); assert.equal(next.body.subarray(1, 4).toString(), 'PNG');
  assert.equal(fixture.stats.previewFailures, 1);
  const changed = response(); fixture.serve({ url: url.replace(asset.contentHash, 'f'.repeat(64)), method: 'GET' }, changed);
  assert.equal(changed.status, 409); assert.equal(changed.body, 'Wrong fixture identity');
  assert.equal(fixture.serve({ url: '/api/proxy/image', method: 'POST' }, response()), false);
});
