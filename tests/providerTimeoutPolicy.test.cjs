const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const policy = require('../backend/src/providers/providerTimeoutPolicy');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('Provider timeout policy clamps media generation up to 15 minutes and LLM down to 3 minutes', () => {
  assert.equal(policy.MIN_PROVIDER_MEDIA_TIMEOUT_MS, 15 * 60 * 1000);
  assert.equal(policy.DEFAULT_PROVIDER_LLM_TIMEOUT_MS, 3 * 60 * 1000);
  assert.equal(policy.MAX_PROVIDER_LLM_TIMEOUT_MS, 3 * 60 * 1000);

  assert.equal(policy.normalizeProviderMediaTimeoutMs(), 15 * 60 * 1000);
  assert.equal(policy.normalizeProviderMediaTimeoutMs(90_000), 15 * 60 * 1000);
  assert.equal(policy.normalizeProviderMediaTimeoutMs(30 * 60 * 1000), 30 * 60 * 1000);
  assert.equal(policy.normalizeProviderLlmTimeoutMs(), 3 * 60 * 1000);
  assert.equal(policy.normalizeProviderLlmTimeoutMs(10 * 60 * 1000), 3 * 60 * 1000);
  assert.equal(policy.normalizeProviderLlmTimeoutMs(2 * 60 * 1000), 2 * 60 * 1000);
  assert.equal(policy.minimumProviderMediaPollCount(3000, 20), 300);
  assert.equal(policy.minimumProviderMediaPollCount(5000, 720), 720);
  assert.equal(policy.minimumProviderMediaPollCount(Infinity, Infinity), 15 * 60 * 1000);
});

test('frontend custom polling and recovery paths preserve the same 15-minute floor', () => {
  const frontendPolicy = read('src/utils/providerTimeoutPolicy.ts');
  assert.match(frontendPolicy, /MIN_PROVIDER_MEDIA_TIMEOUT_MS\s*=\s*15\s*\*\s*60\s*\*\s*1000/);
  for (const source of [
    'src/services/falToolbox.ts',
    'src/utils/falToolbox.ts',
    'src/services/rhToolbox.ts',
    'src/components/nodes/DirectorStoryboardNode.tsx',
    'src/utils/runRecovery.ts',
    'backend/src/services/runRecovery.js',
  ]) {
    assert.match(read(source), /minimumProviderMediaPollCount/, source);
  }
});

test('all current and future external adapters pass through the shared media/LLM policy', () => {
  const adapters = read('backend/src/providers/adapters.js');
  assert.match(adapters, /adapter\.generateImage\(provider, input, providerMediaGenerationOptions\(options\)\)/);
  assert.match(adapters, /adapter\.generateVideo\(provider, input, providerMediaGenerationOptions\(options\)\)/);
  assert.match(adapters, /adapter\.generateChat\(provider, input, providerLlmGenerationOptions\(options\)\)/);

  const openaiCompatible = read('backend/src/providers/openaiCompatible.js');
  const agnes = read('backend/src/providers/agnes.js');
  const modelscope = read('backend/src/providers/modelscope.js');
  const jimeng = read('backend/src/providers/jimengCli.js');
  assert.match(openaiCompatible, /timeoutMs:\s*normalizeProviderMediaTimeoutMs\([\s\S]*?options\.referenceTimeoutMs/);
  assert.match(agnes, /timeoutMs:\s*normalizeProviderLlmTimeoutMs\(options\.timeoutMs/);
  assert.match(modelscope, /timeoutMs:\s*normalizeProviderLlmTimeoutMs\(options\.timeoutMs/);
  assert.match(jimeng, /Math\.max\(MIN_PROVIDER_MEDIA_TIMEOUT_MS \/ 1000/);
});

test('built-in proxy and seedance boundaries cannot restore a sub-15-minute media timeout', () => {
  const proxy = read('backend/src/routes/proxy.js');
  const seedance = read('backend/src/providers/seedanceNz.js');
  assert.doesNotMatch(proxy, /T8_PROXY_REMOTE_DEADLINE_MS,[\s\r\n]*90_000/);
  assert.match(proxy, /PROXY_REMOTE_DEADLINE_MS\s*=\s*normalizeProviderMediaTimeoutMs/);
  assert.match(proxy, /timeoutKind:\s*'llm'/);
  assert.match(proxy, /Math\.ceil\(MIN_PROVIDER_MEDIA_TIMEOUT_MS \/ 2000\)/);
  assert.match(seedance, /DEFAULT_PROVIDER_DEADLINE_MS\s*=\s*MIN_PROVIDER_MEDIA_TIMEOUT_MS/);
  assert.match(seedance, /DEFAULT_PROVIDER_UPLOAD_DEADLINE_MS\s*=\s*MIN_PROVIDER_MEDIA_TIMEOUT_MS/);

  const productionSources = [
    'backend/src/routes/proxy.js',
    'backend/src/providers/seedanceNz.js',
    'backend/src/providers/adapters.js',
    'backend/src/routes/externalProviders.js',
    'backend/src/routes/grokOAuth.js',
    'backend/src/routes/photoshopBridge.js',
    'backend/src/providers/jimengCli.js',
    'backend/src/services/assetIndexer.js',
    'backend/src/services/creatorActionExecutor.js',
  ].map(read).join('\n');
  assert.equal(
    (productionSources.match(/allowShortProviderTimeoutsForTests/g) || []).length,
    3,
    'the short-timeout escape hatch must remain confined to the proxy and seedance Provider boundary implementations',
  );
});
