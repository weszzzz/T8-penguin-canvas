'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../backend/src/routes/proxy.js'), 'utf8');
function section(from, to) {
  const first = source.indexOf(from), last = source.indexOf(to, first);
  assert.ok(first >= 0 && last > first, from); return source.slice(first, last);
}
// Actual converter, multipart append, Gemini contents and upstream dispatcher.
// Media reads, validation dependencies and HTTP are controlled, not a real
// API/database/file-byte acceptance test. A success records only a would-be POST.
const code = section('function summarizeImageRef(', '// 将 base64/URL')
  + section('function geminiOfficialImageSize(', '// ========================================================================')
  + section('async function callImageUpstreamAsync(', '// 将上游响应 normalize');
const create = new Function('scope', `with(scope) { ${code}\nreturn { callImageUpstreamAsync, collectConvertedImageRefs }; }`);
function harness(failure = {}) {
  const state = { reads: [], requests: [], active: 0, maxActive: 0 };
  const helpers = create({ config: { ZHENZHEN_BASE_URL: 'https://provider.invalid' }, FormData, Blob,
    console: { log() {}, warn() {} }, opaqueDiagnosticSummary: () => 'opaque reference', safeOutputExt: ext => ext,
    isGptImage25Model: model => model === 'gpt-image-2.5-flare',
    isOfficialGeminiImageModel: model => ['gemini-3-pro-image', 'gemini-3.1-flash-lite-image'].includes(model),
    validateGptImage25Request: input => ({ model: input.model, prompt: input.prompt, size: input.size, n: 1, quality: 'low', background: 'auto', moderation: 'auto' }),
    GPT_IMAGE_25_RESPONSE_DEADLINE_MS: 1,
    refToBuffer: async ref => {
      state.reads.push(ref); state.active++; state.maxActive = Math.max(state.maxActive, state.active);
      try {
        await Promise.resolve();
        if (state.reads.length === failure.index) {
          if (failure.kind === 'throw') throw new Error('controlled read failure');
          if (failure.kind === 'mime') return { mime: 'application/json', buf: Buffer.from('not image'), ext: 'json' };
          return null;
        }
        return { mime: 'image/png', buf: Buffer.from(ref), ext: 'png' };
      } finally { state.active--; }
    },
    fetchProviderResponse: async (url, options) => { state.requests.push({ url, options }); return { ok: true }; },
  });
  return { state, ...helpers };
}
const models = [
  ['nano-banana-pro', 'banana-ratio'], ['gemini-3-pro-image', 'banana-ratio'],
  ['gemini-3.1-flash-lite-image', 'banana-ratio'], ['gpt-image-2', 'gpt-size'], ['gpt-image-2.5-flare', 'gpt-image-2.5'],
];
function input(finalApiModel, paramKind, refs = ['blue', 'orange', 'blue']) {
  return { apiKey: 'synthetic-test-key', finalApiModel, paramKind, refs, prompt: 'Exact historical prompt',
    aspect_ratio: '16:9', image_size: '4K', size: '1024x1024', n: 1, quality: 'low', moderation: 'auto' };
}

test('shared image dispatcher refuses a partial reference conversion before any generation POST', async () => {
  for (const [model, kind] of models) for (const index of [1, 2, 3]) for (const failure of ['null', 'throw', 'mime']) {
    const h = harness({ index, kind: failure });
    await assert.rejects(h.callImageUpstreamAsync(input(model, kind)), /已中止生成/, `${model}/${index}/${failure}`);
    assert.equal(h.state.requests.length, 0); assert.equal(h.state.maxActive, 1);
  }
});

test('complete shared references preserve duplicate order in multipart and official Gemini contents', async () => {
  for (const [model, kind] of models) {
    const h = harness(), refs = ['blue', 'orange', 'blue'];
    assert.equal((await h.callImageUpstreamAsync(input(model, kind, refs))).ok, true);
    assert.equal(h.state.requests.length, 1); assert.deepEqual(h.state.reads, refs); assert.equal(h.state.maxActive, 1);
    const { options } = h.state.requests[0]; assert.equal(options.method, 'POST');
    if (options.body instanceof FormData) {
      const images = options.body.getAll('image'); assert.equal(images.length, 3);
      const contents = []; for (const image of images) contents.push(await image.text());
      assert.deepEqual(contents, refs);
      assert.equal(options.body.get('prompt'), 'Exact historical prompt');
    } else {
      const body = JSON.parse(options.body), parts = body.contents[0].parts;
      assert.deepEqual(parts.slice(0, -1).map(part => Buffer.from(part.inlineData.data, 'base64').toString()), refs);
      assert.deepEqual(parts.at(-1), { text: 'Exact historical prompt' });
      assert.equal(body.generationConfig.responseFormat.image.imageSize, model.includes('lite') ? '1K' : '4K');
    }
  }
});

test('shared converter still rejects all-missing references while deliberate text-only Banana remains supported', async () => {
  const missing = harness({ index: 1 });
  await assert.rejects(missing.callImageUpstreamAsync(input('nano-banana-pro', 'banana-ratio', ['missing'])), /避免按无参考图生成/);
  assert.equal(missing.state.requests.length, 0);
  const empty = harness();
  await empty.callImageUpstreamAsync(input('nano-banana-pro', 'banana-ratio', []));
  assert.deepEqual(empty.state.reads, []); assert.equal(empty.state.requests.length, 1);
  assert.deepEqual(JSON.parse(empty.state.requests[0].options.body), {
    model: 'nano-banana-pro', prompt: 'Exact historical prompt', aspect_ratio: '16:9', image_size: '4K',
  });
});

test('partial-reference rejection identifies the slot without exposing its private path or query', async () => {
  const h = harness({ index: 2 });
  await assert.rejects(h.collectConvertedImageRefs(['good', '/files/input/private-name.png?token=secret'], '参考图'), error => {
    assert.match(error.message, /#2/); assert.match(error.message, /已中止生成/);
    assert.doesNotMatch(error.message, /private-name|token|secret|\/files/); return true;
  });
  assert.equal(h.state.requests.length, 0);
});
