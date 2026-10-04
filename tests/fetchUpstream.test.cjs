'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildFetchEnvironment,
  classifyFetchFailure,
  parseScutilProxyOutput,
} = require('../scripts/fetch-upstream.cjs');

test('macOS system proxy parser prefers HTTPS proxy and validates the port', () => {
  const output = [
    'HTTPSEnable : 1',
    'HTTPSProxy : 127.0.0.1',
    'HTTPSPort : 7897',
    'HTTPEnable : 1',
    'HTTPProxy : 127.0.0.1',
    'HTTPPort : 8080',
  ].join('\n');
  assert.equal(parseScutilProxyOutput(output), 'http://127.0.0.1:7897');
  assert.equal(parseScutilProxyOutput('HTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 0'), '');
});

test('explicit proxy environment wins over the macOS system proxy', () => {
  const prepared = buildFetchEnvironment({
    platform: 'darwin',
    base: { HTTPS_PROXY: 'http://proxy.example:8443' },
    systemProxy: 'http://127.0.0.1:7897',
  });
  assert.equal(prepared.proxy, 'http://proxy.example:8443');
  assert.equal(prepared.source, 'environment');
  assert.equal(prepared.env.HTTPS_PROXY, 'http://proxy.example:8443');
});

test('system proxy is injected only when no explicit proxy exists', () => {
  const prepared = buildFetchEnvironment({
    platform: 'darwin',
    base: { PATH: '/usr/bin' },
    systemProxy: 'http://127.0.0.1:7897',
  });
  assert.equal(prepared.proxy, 'http://127.0.0.1:7897');
  assert.equal(prepared.source, 'macos-system');
  assert.equal(prepared.env.HTTPS_PROXY, 'http://127.0.0.1:7897');
  assert.equal(prepared.env.ALL_PROXY, 'http://127.0.0.1:7897');
});

test('fetch failures distinguish permission errors from network errors', () => {
  assert.equal(classifyFetchFailure('error: cannot open .git/FETCH_HEAD: Operation not permitted'), 'permission');
  assert.equal(classifyFetchFailure('fatal: unable to access github: Error in the HTTP2 framing layer'), 'network');
  assert.equal(classifyFetchFailure('fatal: repository not found'), 'unknown');
});
