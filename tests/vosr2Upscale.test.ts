import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  IMAGE_MODELS,
  VIDEO_MODELS,
  VOSR2_IMAGE_UPSCALE_MODEL,
  VOSR2_VIDEO_UPSCALE_MODEL,
} from '../src/providers/models.ts';
import { inferRunRecoveryDescriptor } from '../src/utils/runRecovery.ts';

const require = createRequire(import.meta.url);
const provider = require('../backend/src/providers/seedanceNz.js');
const root = join(import.meta.dirname, '..');
const IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const VIDEO = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb20=';

test('Vosr2 catalogs expose the exact image tab and video option on seedance.nz', () => {
  assert.equal(VOSR2_IMAGE_UPSCALE_MODEL, 'vosr2-image-upscale');
  const image = IMAGE_MODELS.find((item) => item.id === VOSR2_IMAGE_UPSCALE_MODEL);
  assert.ok(image);
  assert.equal(image.tabLabel, 'Vosr2');
  assert.equal(image.paramKind, 'vosr2-upscale');
  assert.deepEqual(image.capabilities, ['i2i']);
  assert.equal(image.maxReferenceImages, 1);
  assert.deepEqual(image.apiModelOptions.map((item) => item.value), [VOSR2_IMAGE_UPSCALE_MODEL]);

  assert.equal(VOSR2_VIDEO_UPSCALE_MODEL, 'vosr2-video-upscale');
  const video = VIDEO_MODELS.find((item) => item.id === VOSR2_VIDEO_UPSCALE_MODEL);
  assert.ok(video);
  assert.equal(video.label, 'Vosr2');
  assert.equal(video.kind, 'upscaler');
  assert.equal(video.builtinSource, 'seedance-nz');
  assert.equal(video.supportVideos, true);
  assert.deepEqual(video.apiModelOptions.map((item) => item.value), [VOSR2_VIDEO_UPSCALE_MODEL]);
});

test('Vosr2 image submission uses exactly model plus one uploaded image', async () => {
  provider.resetCachesForTests();
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const method = String(init?.method || 'GET').toUpperCase();
    let body: unknown = null;
    if (typeof init?.body === 'string') body = JSON.parse(init.body);
    requests.push({ url, method, body });
    if (url.endsWith('/v1/files/upload')) {
      return new Response(JSON.stringify({ url: 'https://cdn.example.com/vosr2-source.png' }), { status: 200 });
    }
    if (url.endsWith('/v1/image/generations') && method === 'POST') {
      return new Response(JSON.stringify({ data: { task_id: 'vosr2-image-task' } }), { status: 200 });
    }
    return new Response(JSON.stringify({
      data: { status: 'SUCCESS', result_url: 'https://cdn.example.com/vosr2-4k.png' },
    }), { status: 200 });
  };

  const submitted = await provider.submitImageTask({
    model: VOSR2_IMAGE_UPSCALE_MODEL,
    images: [IMAGE],
    prompt: 'must be ignored',
    resolution: '1k',
  }, 'test-key', { fetchImpl, uploadIntervalMs: 0 });
  assert.equal(submitted.taskId, 'vosr2-image-task');
  assert.equal(submitted.model, VOSR2_IMAGE_UPSCALE_MODEL);
  assert.equal(submitted.taskType, 'upscale');

  const generationPosts = requests.filter((item) => item.method === 'POST' && item.url.endsWith('/v1/image/generations'));
  assert.equal(generationPosts.length, 1);
  assert.deepEqual(generationPosts[0].body, {
    model: VOSR2_IMAGE_UPSCALE_MODEL,
    images: ['https://cdn.example.com/vosr2-source.png'],
  });

  const queried = await provider.queryImageTask(submitted.taskId, 'test-key', { fetchImpl });
  assert.equal(queried.status, 'succeeded');
  assert.equal(queried.imageUrl, 'https://cdn.example.com/vosr2-4k.png');
  assert.equal(requests.at(-1)?.url.endsWith('/v1/image/generations/vosr2-image-task'), true);
});

test('Vosr2 video submission uses exactly model plus metadata.video_url', async () => {
  provider.resetCachesForTests();
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const method = String(init?.method || 'GET').toUpperCase();
    let body: unknown = null;
    if (typeof init?.body === 'string') body = JSON.parse(init.body);
    requests.push({ url, method, body });
    if (url.endsWith('/v1/files/upload')) {
      return new Response(JSON.stringify({ url: 'https://cdn.example.com/vosr2-source.mp4' }), { status: 200 });
    }
    if (url.endsWith('/v1/video/generations') && method === 'POST') {
      return new Response(JSON.stringify({ data: { task_id: 'vosr2-video-task' } }), { status: 200 });
    }
    return new Response(JSON.stringify({
      data: { status: 'SUCCESS', result_url: 'https://cdn.example.com/vosr2-2k.mp4' },
    }), { status: 200 });
  };

  const submitted = await provider.submitVosr2VideoTask({
    model: VOSR2_VIDEO_UPSCALE_MODEL,
    videos: [VIDEO],
    prompt: 'must be ignored',
    resolution: '4k',
  }, 'test-key', { fetchImpl, uploadIntervalMs: 0 });
  assert.equal(submitted.taskId, 'vosr2-video-task');
  const generationPosts = requests.filter((item) => item.method === 'POST' && item.url.endsWith('/v1/video/generations'));
  assert.equal(generationPosts.length, 1);
  assert.deepEqual(generationPosts[0].body, {
    model: VOSR2_VIDEO_UPSCALE_MODEL,
    metadata: { video_url: 'https://cdn.example.com/vosr2-source.mp4' },
  });

  const queried = await provider.queryVosr2VideoTask(submitted.taskId, 'test-key', { fetchImpl });
  assert.equal(queried.status, 'succeeded');
  assert.equal(queried.videoUrl, 'https://cdn.example.com/vosr2-2k.mp4');
  assert.equal(requests.at(-1)?.url.endsWith('/v1/video/generations/vosr2-video-task'), true);
});

test('Vosr2 rejects missing or multiple media before upload or paid submission', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response('{}', { status: 500 });
  };
  await assert.rejects(
    provider.buildVosr2ImagePayload({ model: VOSR2_IMAGE_UPSCALE_MODEL, images: [] }, 'test-key', { fetchImpl }),
    /只能提供 1 张图片/,
  );
  await assert.rejects(
    provider.buildVosr2ImagePayload({ model: VOSR2_IMAGE_UPSCALE_MODEL, images: [IMAGE, IMAGE] }, 'test-key', { fetchImpl }),
    /只能提供 1 张图片/,
  );
  await assert.rejects(
    provider.buildVosr2VideoPayload({ model: VOSR2_VIDEO_UPSCALE_MODEL, videos: [] }, 'test-key', { fetchImpl }),
    /只能提供 1 个视频/,
  );
  await assert.rejects(
    provider.buildVosr2VideoPayload({ model: VOSR2_VIDEO_UPSCALE_MODEL, videos: [VIDEO, VIDEO] }, 'test-key', { fetchImpl }),
    /只能提供 1 个视频/,
  );
  assert.equal(calls, 0);
});

test('Vosr2 UI services, proxy routes and restart recovery stay on fixed local endpoints', () => {
  const generation = readFileSync(join(root, 'src', 'services', 'generation.ts'), 'utf8');
  const routes = readFileSync(join(root, 'backend', 'src', 'routes', 'proxy.js'), 'utf8');
  assert.match(generation, /\/api\/proxy\/video\/vosr2\/submit/);
  assert.match(generation, /\/api\/proxy\/video\/vosr2\/status/);
  assert.match(routes, /\/video\/vosr2\/submit/);
  assert.match(routes, /\/video\/vosr2\/status\/:tid/);
  assert.match(routes, /zhenzhenSd2ApiKey/);

  assert.deepEqual(inferRunRecoveryDescriptor({
    provider: 'seedance-nz',
    model: VOSR2_IMAGE_UPSCALE_MODEL,
    taskId: 'image/task',
  }), {
    version: 1,
    kind: 'seedream-nz',
    taskId: 'image/task',
    model: VOSR2_IMAGE_UPSCALE_MODEL,
    pollIntervalMs: 3000,
    maxPolls: 1200,
  });
  assert.deepEqual(inferRunRecoveryDescriptor({
    provider: 'seedance-nz',
    model: VOSR2_VIDEO_UPSCALE_MODEL,
    taskId: 'video/task',
  }), {
    version: 1,
    kind: 'vosr2',
    taskId: 'video/task',
    model: VOSR2_VIDEO_UPSCALE_MODEL,
    pollIntervalMs: 3000,
    maxPolls: 1200,
  });
});
