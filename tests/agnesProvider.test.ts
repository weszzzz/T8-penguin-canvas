import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  DEFAULT_AGNES_BASE_URL,
  DEFAULT_AGNES_CHAT_MODELS,
  DEFAULT_AGNES_IMAGE_MODELS,
  DEFAULT_AGNES_VIDEO_MODELS,
  normalizeAdvancedProviders,
} = require('../backend/src/providers/registry.js');
const adapters = require('../backend/src/providers/adapters.js');

function jsonResponse(body: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

test('Agnes AI is a built-in advanced provider for image, video, and LLM nodes', () => {
  const providers = normalizeAdvancedProviders(undefined);
  const agnes = providers.find((provider: any) => provider.id === 'agnes');

  assert.ok(agnes);
  assert.equal(agnes.protocol, 'agnes');
  assert.equal(agnes.label, 'Agnes AI');
  assert.equal(agnes.baseUrl, DEFAULT_AGNES_BASE_URL);
  assert.deepEqual(agnes.imageModels, DEFAULT_AGNES_IMAGE_MODELS);
  assert.deepEqual(agnes.videoModels, DEFAULT_AGNES_VIDEO_MODELS);
  assert.deepEqual(agnes.chatModels, DEFAULT_AGNES_CHAT_MODELS);
  assert.equal(agnes.defaults.imageModel, DEFAULT_AGNES_IMAGE_MODELS[0]);
  assert.equal(agnes.defaults.videoModel, DEFAULT_AGNES_VIDEO_MODELS[0]);
  assert.equal(agnes.defaults.chatModel, DEFAULT_AGNES_CHAT_MODELS[0]);
});

test('Agnes adapter sends image JSON extra_body and normalizes returned URLs', async () => {
  const agnes = adapters.getAdapterForProtocol('agnes');
  const calls: any[] = [];
  const provider = {
    id: 'agnes',
    protocol: 'agnes',
    baseUrl: 'https://apihub.agnes-ai.com/v1/',
    apiKey: 'sk-secret',
    imageModels: ['agnes-image-2.1-flash'],
  };

  const result = await agnes.generateImage(provider, {
    prompt: 'tiny penguin',
    model: 'agnes-image-2.1-flash',
    size: '512x512',
    n: 3,
    providerParams: { response_format: 'url' },
  }, {
    fetchImpl: async (url: string, init: any) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return jsonResponse({ data: [{ url: 'https://cdn.example.com/agnes.png' }] });
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.imageUrls, ['https://cdn.example.com/agnes.png']);
  assert.equal(calls[0].url, 'https://apihub.agnes-ai.com/v1/images/generations');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-secret');
  assert.deepEqual(calls[0].body, {
    model: 'agnes-image-2.1-flash',
    prompt: 'tiny penguin',
    size: '512x512',
    extra_body: {
      response_format: 'url',
    },
  });
});

test('Agnes adapter sends image edit aliases in extra_body.image without edits-only fields', async () => {
  const agnes = adapters.getAdapterForProtocol('agnes');
  const calls: any[] = [];
  const provider = {
    id: 'agnes',
    protocol: 'agnes',
    baseUrl: 'https://apihub.agnes-ai.com/v1/',
    apiKey: 'sk-secret',
    imageModels: ['agnes-image-2.1-flash'],
  };

  const result = await agnes.generateImage(provider, {
    prompt: 'make the cup matte black',
    model: 'agnes-image-2.1-flash',
    size: '1024x1024',
    imageUrls: ['data:image/png;base64,QUJD'],
    response_format: 'url',
  } as any, {
    fetchImpl: async (url: string, init: any) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return jsonResponse({ data: [{ url: 'https://cdn.example.com/agnes-edited.png' }] });
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.imageUrls, ['https://cdn.example.com/agnes-edited.png']);
  assert.equal(calls[0].url, 'https://apihub.agnes-ai.com/v1/images/generations');
  assert.equal(calls[0].body.model, 'agnes-image-2.1-flash');
  assert.equal(calls[0].body.prompt, 'make the cup matte black');
  assert.equal(calls[0].body.size, '1024x1024');
  assert.deepEqual(calls[0].body.extra_body, {
    image: ['data:image/png;base64,QUJD'],
    response_format: 'url',
  });
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0].body, 'response_format'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0].body, 'tags'), false);
});

test('Agnes adapter converts video controls to width height and polls agnesapi', async () => {
  const agnes = adapters.getAdapterForProtocol('agnes');
  const calls: any[] = [];
  const provider = {
    id: 'agnes',
    protocol: 'agnes',
    baseUrl: 'https://apihub.agnes-ai.com/v1',
    apiKey: 'sk-secret',
    videoModels: ['agnes-video-v2.0'],
  };

  const result = await agnes.generateVideo(provider, {
    prompt: 'a tiny penguin waves',
    model: 'agnes-video-v2.0',
    aspect_ratio: '9:16',
    resolution: '480p',
    duration: 2,
    providerParams: { frameRate: 8 },
  }, {
    fetchImpl: async (url: string, init: any = {}) => {
      calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
      if (String(url).endsWith('/v1/videos')) {
        return jsonResponse({ video_id: 'vid-1', status: 'queued' });
      }
      return jsonResponse({
        status: 'completed',
        remixed_from_video_id: 'https://cdn.example.com/agnes.mp4',
      });
    },
    sleepImpl: async () => undefined,
    maxPolls: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.taskId, 'vid-1');
  assert.deepEqual(result.videoUrls, ['https://cdn.example.com/agnes.mp4']);
  assert.equal(calls[0].url, 'https://apihub.agnes-ai.com/v1/videos');
  assert.deepEqual(calls[0].body, {
    model: 'agnes-video-v2.0',
    prompt: 'a tiny penguin waves',
    width: 408,
    height: 720,
    num_frames: 17,
    frame_rate: 8,
  });
  assert.match(calls[1].url, /^https:\/\/apihub\.agnes-ai\.com\/agnesapi\?video_id=vid-1&model_name=agnes-video-v2\.0$/);
});

test('Agnes chat uses the shared three-minute LLM cap instead of the OpenAI compatible 8s default', async (t) => {
  const agnes = adapters.getAdapterForProtocol('agnes');
  const provider = {
    id: 'agnes',
    protocol: 'agnes',
    baseUrl: 'https://apihub.agnes-ai.com/v1',
    apiKey: 'sk-secret',
    chatModels: ['agnes-2.0-flash'],
  };

  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let usedShortDefault = false;
  let usedThreeMinuteTimeout = false;
  (globalThis as any).setTimeout = ((callback: (...args: any[]) => void, ms?: number, ...args: any[]) => {
    if (ms === 8000) usedShortDefault = true;
    if (Number(ms) === 3 * 60 * 1000) usedThreeMinuteTimeout = true;
    return originalSetTimeout(callback, ms as any, ...args);
  }) as any;
  (globalThis as any).clearTimeout = ((timer: any) => originalClearTimeout(timer)) as any;
  t.after(() => {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });

  const result = await agnes.generateChat(provider, {
    prompt: 'hello',
    model: 'agnes-2.0-flash',
  }, {
    fetchImpl: async () => jsonResponse({ choices: [{ message: { content: 'world' } }] }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.text, 'world');
  assert.equal(usedShortDefault, false);
  assert.equal(usedThreeMinuteTimeout, true);
});

test('Agnes video sends local T8 reference images as base64 payloads for remote task workers', async (t) => {
  const agnes = adapters.getAdapterForProtocol('agnes');
  const config = require('../backend/src/config.js');
  const oldInputDir = config.INPUT_DIR;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 't8-agnes-video-ref-'));
  t.after(() => {
    config.INPUT_DIR = oldInputDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  config.INPUT_DIR = tmpDir;
  fs.writeFileSync(path.join(tmpDir, 'ref.png'), Buffer.from('PNGDATA'));

  const calls: any[] = [];
  const provider = {
    id: 'agnes',
    protocol: 'agnes',
    baseUrl: 'https://apihub.agnes-ai.com/v1',
    apiKey: 'sk-secret',
    videoModels: ['agnes-video-v2.0'],
  };

  const result = await agnes.generateVideo(provider, {
    prompt: 'a tiny penguin waves',
    model: 'agnes-video-v2.0',
    aspect_ratio: '9:16',
    resolution: '480p',
    duration: 2,
    images: ['http://127.0.0.1:18766/files/input/ref.png'],
    providerParams: { frameRate: 8 },
  }, {
    baseUrl: 'http://127.0.0.1:18766',
    fetchImpl: async (url: string, init: any = {}) => {
      calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
      if (String(url).endsWith('/v1/videos')) {
        return jsonResponse({ video_id: 'vid-local-ref', status: 'queued' });
      }
      return jsonResponse({
        status: 'completed',
        remixed_from_video_id: 'https://cdn.example.com/agnes-ref.mp4',
      });
    },
    sleepImpl: async () => undefined,
    maxPolls: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0].body.image, Buffer.from('PNGDATA').toString('base64'));
  assert.doesNotMatch(calls[0].body.image, /^data:image\//);
  assert.doesNotMatch(calls[0].body.image, /^https?:\/\/127\.0\.0\.1/);
});

test('Agnes video failure errors stringify nested provider error objects', async () => {
  const agnes = adapters.getAdapterForProtocol('agnes');
  const provider = {
    id: 'agnes',
    protocol: 'agnes',
    baseUrl: 'https://apihub.agnes-ai.com/v1',
    apiKey: 'sk-secret',
    videoModels: ['agnes-video-v2.0'],
  };

  const result = await agnes.generateVideo(provider, {
    prompt: 'a tiny penguin waves',
    model: 'agnes-video-v2.0',
  }, {
    fetchImpl: async (url: string, init: any = {}) => {
      if (String(url).endsWith('/v1/videos')) {
        return jsonResponse({ video_id: 'vid-fail', status: 'queued' });
      }
      return jsonResponse({
        status: 'failed',
        error: {
          code: 'invalid_reference_image',
          message: 'reference image is not reachable',
        },
      });
    },
    sleepImpl: async () => undefined,
    maxPolls: 1,
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /reference image is not reachable/);
  assert.doesNotMatch(result.error, /\[object Object\]/);
});

test('Agnes video polling treats HTTP 429 as a transient status', async () => {
  const agnes = adapters.getAdapterForProtocol('agnes');
  const provider = {
    id: 'agnes',
    protocol: 'agnes',
    baseUrl: 'https://apihub.agnes-ai.com/v1',
    apiKey: 'sk-secret',
    videoModels: ['agnes-video-v2.0'],
  };
  let pollCount = 0;

  const result = await agnes.generateVideo(provider, {
    prompt: 'a tiny penguin waves',
    model: 'agnes-video-v2.0',
  }, {
    fetchImpl: async (url: string, init: any = {}) => {
      if (String(url).endsWith('/v1/videos')) {
        return jsonResponse({ video_id: 'vid-rate-limited', status: 'queued' });
      }
      pollCount += 1;
      if (pollCount === 1) {
        return jsonResponse({ message: 'rate limited' }, 429);
      }
      return jsonResponse({
        status: 'completed',
        remixed_from_video_id: 'https://cdn.example.com/agnes-rate-limit.mp4',
      });
    },
    sleepImpl: async () => undefined,
    maxPolls: 2,
  });

  assert.equal(result.ok, true);
  assert.equal(pollCount, 2);
  assert.deepEqual(result.videoUrls, ['https://cdn.example.com/agnes-rate-limit.mp4']);
});
