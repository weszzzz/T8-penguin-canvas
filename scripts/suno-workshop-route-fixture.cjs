'use strict';
// Execute the actual submit route with isolated settings/ledger boundaries.
// No project database, user settings, or key-group state is loaded or written.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
module.exports = function workshopFixture({ apiKey = 'unit-key', fetchResponse, baseUrl = 'https://ai.t8star.org' }) {
  const source = fs.readFileSync(path.join(__dirname, '../backend/src/routes/proxy.js'), 'utf8');
  const start = source.indexOf('const SUNO_MV_MAP =');
  const end = source.indexOf("router.get('/audio/query'", start);
  assert.ok(start > 0 && end > start);
  let submit;
  const context = vm.createContext({
    router: { post(route, handler) { assert.equal(route, '/audio/submit'); submit = handler; } },
    config: { ZHENZHEN_BASE_URL: baseUrl },
    loadRawSettings: () => ({ zhenzhenApiKey: apiKey }),
    ensureKeyOrSelectedGroup: () => true,
    applyZhenzhenProviderContext: async () => ({ taskMeta: {} }),
    fetchProviderResponse: fetchResponse,
    parseJsonResponse: response => response.json(),
    boundedProviderHttpError: async response => ({ message: `Provider HTTP ${response.status}` }),
    invalidateZhenzhenProviderKey: async () => {}, rememberTaskKey: () => {},
    proxyRouteError: () => {}, proxyErrorStatus: () => 502,
    proxyPublicError: () => 'Provider request failed; do not resubmit automatically',
  });
  vm.runInContext(source.slice(start, end), context);
  return { resolve: value => context.resolveSunoMv(value), async submit(body) {
    let status = 200, result;
    const response = { status(value) { status = value; return this; }, json(value) { result = value; return this; } };
    await submit({ body }, response);
    return { status, body: result };
  } };
};
