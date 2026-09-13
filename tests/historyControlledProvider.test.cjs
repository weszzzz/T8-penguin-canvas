'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createControlledProviderBoundary } = require('../scripts/history-controlled-provider.cjs');

test('owned HTTP boundary preserves status, bounds input and refuses unknown Provider calls', async () => {
  const boundary = createControlledProviderBoundary();
  const server = http.createServer((request, response) => boundary.middleware(request, response, () => {
    response.writeHead(404); response.end('passthrough');
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = body => fetch(origin + '/api/proxy/seedance/submit', { method: 'POST', body });
  try {
    assert.equal((await post('{}')).status, 404);
    const requests = [];
    boundary.setHandler(input => {
      requests.push(input);
      if (input.pathname === '/api/proxy/seedance/submit') return { status: 200, body: { success: true, data: { taskId: 'test-A' } } };
      if (input.pathname.endsWith('/throw')) throw new Error('owned assertion');
      return null;
    });
    const response = await post('{"prompt":"A"}');
    assert.equal(response.status, 200); assert.equal(response.ok, true);
    assert.deepEqual(await response.json(), { success: true, data: { taskId: 'test-A' } });
    assert.equal(requests[0].payload.prompt, 'A'); assert.equal(requests[0].method, 'POST');
    assert.equal((await fetch(origin + '/api/proxy/unconfigured')).status, 403);
    assert.equal((await fetch(origin + '/api/canvas')).status, 404);
    assert.equal((await post('malformed')).status, 400);
    assert.equal((await post(' '.repeat(65537))).status, 413);
    assert.equal(requests.length, 2, 'invalid and oversized bodies never reach the handler');
    assert.equal((await fetch(origin + '/api/proxy/throw')).status, 500);
    assert.deepEqual(boundary.errors, ['owned assertion']);
  } finally {
    server.closeIdleConnections(); await new Promise(resolve => server.close(resolve));
  }
});
