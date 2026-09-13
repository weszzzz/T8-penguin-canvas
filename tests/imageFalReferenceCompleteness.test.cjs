'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the actual registry, converter and route body with controlled I/O. No
// server, database, filesystem media, upload or real Provider is started.
const source = fs.readFileSync(path.join(__dirname, '../backend/src/routes/proxy.js'), 'utf8');
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}
const registry = section('const FAL_REGISTRY = {', '\nfunction falRegistryEndpoints');
const converter = section('async function refToBananaImage(ref)', '\n// Grok Image');
const route = section("router.post('/image/fal/submit',", '// POST /api/proxy/image/fal/query');

function harness(failure = {}) {
  const state = { converted: [], uploaded: [], requests: [], registered: [], errors: [], active: 0, maxActive: 0 };
  let handler;
  const context = {
    router: { post(name, callback) { assert.equal(name, '/image/fal/submit'); assert.equal(handler, undefined); handler = callback; } },
    loadRawSettings: () => ({ zhenzhenApiKey: 'synthetic-test-key' }), ensureDefaultZhenzhenKey: () => true,
    config: { ZHENZHEN_BASE_URL: 'https://provider.invalid' }, console: { log() {} },
    refToBuffer: async ref => {
      state.converted.push(ref); state.active++; state.maxActive = Math.max(state.maxActive, state.active);
      try {
        await Promise.resolve();
        if (state.converted.length === failure.index) {
          if (failure.throws) throw new Error('controlled conversion error');
          return null;
        }
        return { mime: 'image/png', buf: Buffer.from(ref) };
      } finally { state.active--; }
    },
    uploadRefToZhenzhen: async ref => { state.uploaded.push(ref); return `https://upload.invalid/${encodeURIComponent(ref)}`; },
    fetchProviderResponse: async (url, options) => { state.requests.push({ url, payload: JSON.parse(options.body) }); return { ok: true }; },
    parseJsonResponse: async () => ({ request_id: 'controlled-request-id' }),
    safeFalRequestId: value => value,
    fixFalResponseUrl: () => 'https://provider.invalid/controlled-query',
    rememberFalTask: (...args) => { state.registered.push(args); return true; },
    proxyRouteError: (_label, error) => state.errors.push(error.message),
    proxyErrorStatus: () => 500, proxyPublicError: error => error.message,
  };
  vm.runInNewContext(`${registry}\n${converter}\n${route}`, context, { timeout: 1000 });
  return { state, async submit(body) {
    const result = { status: 200, body: undefined };
    const response = { status(code) { result.status = code; return this; }, json(value) { result.body = value; return this; } };
    await handler({ body }, response); return result;
  } };
}

test('FAL Banana base64 refuses each missing or failed reference before Provider submission', async () => {
  for (const apiModel of ['nano-banana-pro-fal', 'nano-banana-2-fal']) {
    for (const index of [1, 2, 3]) for (const throws of [false, true]) {
      const h = harness({ index, throws });
      const response = await h.submit({ apiModel, prompt: 'Use the exact three historical references', images: ['blue', 'orange', 'blue'], image_mode: 'base64' });
      assert.equal(response.body.success, false, `${apiModel} reference ${index}`);
      assert.equal(response.status, 500);
      assert.match(h.state.errors[0], new RegExp(`FAL 参考图 #${index}.*失败`));
      assert.equal(h.state.requests.length, 0, 'never submit a partial set or an unintended text-only generation');
      assert.equal(h.state.registered.length, 0);
      assert.equal(h.state.converted.length, index, 'stop at the first failed reference');
      assert.equal(h.state.maxActive, 1); assert.deepEqual(h.state.uploaded, []);
    }
  }
});

test('FAL complete base64 and URL references retain duplicate order, payload and single submission', async () => {
  for (const apiModel of ['nano-banana-pro-fal', 'nano-banana-2-fal']) for (const image_mode of ['base64', 'image_url']) {
    const h = harness(), images = ['blue', 'orange', 'blue'];
    const response = await h.submit({ apiModel, prompt: 'unchanged prompt', images, image_mode,
      n: 3, format: 'webp', aspect_ratio: '16:9', resolution: '4K', safety_tolerance: '4',
      seed: 0, system_prompt: '', enable_web_search: false });
    assert.equal(response.body.success, true); assert.equal(h.state.requests.length, 1); assert.equal(h.state.registered.length, 1);
    assert.deepEqual(h.state.requests[0].payload, { prompt: 'unchanged prompt', num_images: 3, aspect_ratio: '16:9',
      resolution: '4K', output_format: 'webp', safety_tolerance: '4', image_urls: images.map(ref => image_mode === 'base64'
        ? `data:image/png;base64,${Buffer.from(ref).toString('base64')}` : `https://upload.invalid/${ref}`) });
    assert.deepEqual(image_mode === 'base64' ? h.state.converted : h.state.uploaded, images);
    assert.deepEqual(h.state.errors, []);
  }
});

test('FAL GPT gen still omits inactive images; edit preserves uploaded order', async () => {
  for (const mode of ['gen', 'edit']) {
    const h = harness();
    const response = await h.submit({ apiModel: 'gpt-image-2-fal', prompt: 'unchanged', images: ['blue', 'orange', 'blue'], mode });
    assert.equal(response.body.success, true); assert.equal(h.state.requests.length, 1); assert.deepEqual(h.state.converted, []);
    assert.deepEqual(h.state.uploaded, mode === 'edit' ? ['blue', 'orange', 'blue'] : []);
    assert.equal(Object.hasOwn(h.state.requests[0].payload, 'image_urls'), mode === 'edit');
  }
});
