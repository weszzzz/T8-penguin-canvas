import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MINIMAX_H3_V2_DURATIONS,
  MINIMAX_H3_V2_MODEL,
  MINIMAX_H3_V2_RATIOS,
  MINIMAX_H3_V2_RESOLUTIONS,
  VIDEO_MODELS,
  videoModelOptionsForSource,
} from '../src/providers/models.ts';
import { localizeNodeDynamicText, NODE_VISIBLE_CATALOG } from '../src/i18n/nodeVisibleCatalog.ts';

const require = createRequire(import.meta.url);
const provider = require('../backend/src/providers/seedanceNz.js');
const recovery = require('../backend/src/services/runRecovery.js');
const root = join(import.meta.dirname, '..');
const IMAGE = 'data:image/png;base64,iVBORw0KGgo=';
const VIDEO = 'data:video/mp4;base64,AAAAIGZ0eXBpc29t';
const AUDIO = 'data:audio/wav;base64,UklGRgAAAABXQVZF';

const uploadFetch = async () => new Response(JSON.stringify({ url: 'https://cdn.example.com/uploaded' }), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

test('Hailuo tab exposes MiniMax-H3 as one independent V2 model', () => {
  assert.equal(MINIMAX_H3_V2_MODEL, 'MiniMax-H3');
  assert.deepEqual(MINIMAX_H3_V2_RESOLUTIONS, ['480P', '768P']);
  assert.deepEqual(MINIMAX_H3_V2_DURATIONS, Array.from({ length: 57 }, (_, index) => index + 4));
  assert.deepEqual(MINIMAX_H3_V2_RATIOS, [
    '16:9', '1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '21:9', 'adaptive', 'auto', 'api_default',
  ]);
  const hailuo = VIDEO_MODELS.find((item) => item.id === 'hailuo-2.3');
  assert.ok(hailuo);
  const option = videoModelOptionsForSource(hailuo, 'seedance-nz')
    .find((item) => item.value === MINIMAX_H3_V2_MODEL);
  assert.ok(option);
  assert.equal(option.maxRefImages, 11);
  assert.equal(option.maxRefVideos, 3);
  assert.equal(option.maxRefAudios, 4);
});

test('MiniMax-H3 visible controls remain readable in English mode', () => {
  assert.equal(
    NODE_VISIBLE_CATALOG.englishByChinese['MiniMax-H3（V2 多模态视频）'],
    'MiniMax-H3 (V2 multimodal video)',
  );
  assert.equal(
    NODE_VISIBLE_CATALOG.englishByChinese['素材角色与音频控制'],
    'Media roles and audio controls',
  );
  assert.equal(localizeNodeDynamicText('视频 2 起始秒'), 'Video 2 start (seconds)');
  assert.equal(localizeNodeDynamicText('音频降噪强度 · 0（锁定）'), 'Audio denoise strength · 0 (locked)');
});

test('MiniMax-H3 pure text payload follows the exact case-sensitive V2 contract', async () => {
  const built = await provider.buildHailuoPayload({
    model: 'MiniMax-H3',
    prompt: 'A paper kite rises above a quiet shoreline.',
    duration: 4,
    resolution: '480P',
    ratio: '16:9',
    seed: 123,
  }, 'opaque-test-key');
  assert.deepEqual(built, {
    model: 'MiniMax-H3',
    taskType: 'minimax-h3-v2',
    payload: {
      model: 'MiniMax-H3',
      content: [{ type: 'text', text: 'A paper kite rises above a quiet shoreline.' }],
      resolution: '480P',
      duration: 4,
      ratio: '16:9',
    },
  });
  assert.equal('seed' in built.payload, false);
});

test('MiniMax-H3 preserves keyframe, reference, drive-audio, and start-offset roles', async () => {
  provider.resetCachesForTests();
  const built = await provider.buildHailuoPayload({
    model: 'MiniMax-H3',
    prompt: 'Keep identity and lighting stable while the camera moves forward.',
    duration: 20,
    resolution: '768P',
    ratio: 'adaptive',
    firstFrame: IMAGE,
    lastFrame: `${IMAGE}AA`,
    referenceImages: [`${IMAGE}AQ`],
    referenceVideos: [{ url: VIDEO, startTimeSeconds: 1.5 }],
    referenceAudios: [AUDIO],
    driveAudio: `${AUDIO}AA`,
    audioMode: 'remix_source',
    denoiseStrength: 0.42,
    addDriveAsReference: 'true',
  }, 'opaque-test-key', { fetchImpl: uploadFetch, uploadIntervalMs: 0 });
  assert.equal(built.taskType, 'minimax-h3-v2');
  assert.deepEqual(built.payload.content.map((item: any) => item.role).slice(1), [
    'first_frame',
    'last_frame',
    'reference_image',
    'reference_video',
    'reference_audio',
    'drive_audio',
  ]);
  const video = built.payload.content.find((item: any) => item.role === 'reference_video');
  assert.equal(video.start_time_seconds, 1.5);
  assert.deepEqual(built.payload.audio_control, {
    mode: 'remix_source',
    denoise_strength: 0.42,
    add_drive_as_reference: true,
  });
});

test('MiniMax-H3 rejects undocumented or conditionally invalid inputs before submission', async () => {
  await assert.rejects(() => provider.buildHailuoPayload({
    model: 'minimax-h3', prompt: 'x', duration: 4, resolution: '480P', ratio: '16:9',
  }, 'opaque-test-key'), /未知 Hailuo 模型/);
  await assert.rejects(() => provider.buildHailuoPayload({
    model: 'MiniMax-H3', prompt: '', duration: 4, resolution: '480P', ratio: '16:9',
  }, 'opaque-test-key'), /必须填写提示词/);
  await assert.rejects(() => provider.buildHailuoPayload({
    model: 'MiniMax-H3', prompt: 'x', duration: 16, resolution: '480P', ratio: '16:9',
  }, 'opaque-test-key'), /必须提供驱动音频/);
  await assert.rejects(() => provider.buildHailuoPayload({
    model: 'MiniMax-H3', prompt: 'x', duration: 4, resolution: '480P', ratio: 'api_default',
  }, 'opaque-test-key'), /纯文生视频必须选择固定比例/);
  await assert.rejects(() => provider.buildHailuoPayload({
    model: 'MiniMax-H3', prompt: 'x', duration: 4, resolution: '480P', ratio: 'adaptive', referenceImages: [IMAGE],
  }, 'opaque-test-key'), /必须提供首帧或尾帧/);
  await assert.rejects(() => provider.buildHailuoPayload({
    model: 'MiniMax-H3', prompt: 'x', duration: 4, resolution: '480P', ratio: '16:9', audioMode: 'lock_source',
  }, 'opaque-test-key'), /必须提供驱动音频/);
});

test('MiniMax-H3 submit and query use only the documented V2 endpoints', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const submitFetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ task_id: 'task-v2-test' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const submitted = await provider.submitHailuoTask({
    model: 'MiniMax-H3', prompt: 'A quiet shoreline.', duration: 4, resolution: '480P', ratio: '16:9',
  }, 'opaque-test-key', { baseUrl: 'https://example.test', fetchImpl: submitFetch });
  assert.equal(submitted.taskId, 'task-v2-test');
  assert.equal(calls[0].url, 'https://example.test/v2/video_generation');
  assert.equal(JSON.parse(String(calls[0].init?.body)).model, 'MiniMax-H3');

  const queried = await provider.queryMinimaxH3V2Task('task-v2-test', 'opaque-test-key', {
    baseUrl: 'https://example.test',
    fetchImpl: async (url: string) => {
      calls.push({ url });
      return new Response(JSON.stringify({
        task: { status: 'succeeded', content: { url: 'https://cdn.example.com/result.mp4' } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  assert.equal(calls[1].url, 'https://example.test/v2/query/video_generation/task-v2-test');
  assert.equal(queried.status, 'succeeded');
  assert.equal(queried.videoUrl, 'https://cdn.example.com/result.mp4');
});

test('MiniMax-H3 ambiguous 5xx with X-Task-Id is recovered without replay', async () => {
  let submits = 0;
  const result = await provider.submitHailuoTask({
    model: 'MiniMax-H3', prompt: 'A quiet shoreline.', duration: 4, resolution: '480P', ratio: '16:9',
  }, 'opaque-test-key', {
    baseUrl: 'https://example.test',
    fetchImpl: async () => {
      submits += 1;
      return new Response(JSON.stringify({ error: { code: 'gateway_timeout' } }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'X-Task-Id': 'task-recovered' },
      });
    },
  });
  assert.equal(submits, 1);
  assert.equal(result.taskId, 'task-recovered');
});

test('MiniMax-H3 recovery and UI retain the model discriminator after backend restart', () => {
  const request = recovery.recoveryRequest('http://127.0.0.1:18766', {
    kind: 'hailuo', taskId: 'task-v2-test', model: 'MiniMax-H3',
  });
  assert.equal(
    request.url,
    'http://127.0.0.1:18766/api/proxy/video/hailuo/status/task-v2-test?model=MiniMax-H3',
  );
  const route = readFileSync(join(root, 'backend', 'src', 'routes', 'proxy.js'), 'utf8');
  assert.match(route, /taskModel === seedanceNz\.MINIMAX_H3_V2_MODEL/);
  const ui = readFileSync(join(root, 'src', 'components', 'nodes', 'VideoNode.tsx'), 'utf8');
  assert.match(ui, /apiModel === MINIMAX_H3_V2_MODEL/);
  assert.match(ui, /queryHailuo\(tid, apiModel as HailuoModel\)/);
});

test('four MiniMax-H3 workflows are credential-free and cover the documented paths', () => {
  const expected = {
    'MiniMax-H3-text-to-video.json': { uploads: [], flags: {} },
    'MiniMax-H3-keyframes.json': { uploads: ['image', 'image'], flags: { first: true, last: true } },
    'MiniMax-H3-multimodal-reference.json': { uploads: ['image', 'video', 'audio'], flags: {} },
    'MiniMax-H3-drive-audio.json': { uploads: ['image', 'audio'], flags: { drive: true } },
  } as const;
  for (const [filename, expectation] of Object.entries(expected)) {
    const source = readFileSync(join(root, 'docs', 'workflows', filename), 'utf8');
    assert.doesNotMatch(source, /sk-[A-Za-z0-9]/);
    const workflow = JSON.parse(source);
    assert.equal(workflow.schema, 't8-workflow-fragment');
    const node = workflow.nodes.find((item: any) => item.type === 'video');
    assert.equal(node.data.model, 'MiniMax-H3');
    assert.equal(node.data.mainId, 'hailuo-2.3');
    assert.equal(node.data.videoBuiltinSource, 'seedance-nz');
    assert.equal(Boolean(node.data.minimaxH3FirstFrameEnabled), Boolean((expectation.flags as any).first));
    assert.equal(Boolean(node.data.minimaxH3LastFrameEnabled), Boolean((expectation.flags as any).last));
    assert.equal(Boolean(node.data.minimaxH3DriveAudioEnabled), Boolean((expectation.flags as any).drive));
    assert.deepEqual(
      workflow.nodes.filter((item: any) => item.type === 'upload').map((item: any) => item.data.uploadType),
      [...expectation.uploads],
    );
  }
});
