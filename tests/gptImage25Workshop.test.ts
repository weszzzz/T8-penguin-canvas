import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import sharp from 'sharp';
import { createRequire } from 'node:module';

import {
  GPT_IMAGE_25_BACKGROUNDS,
  GPT_IMAGE_25_MAX_IMAGES,
  GPT_IMAGE_25_MODELS,
  GPT_IMAGE_25_PROMPT_MAX_LENGTH,
  GPT_IMAGE_25_QUALITIES,
  GPT_IMAGE_25_SIZES,
  IMAGE_MODELS,
  isGptImage25Model,
  validateGptImage25Size,
} from '../src/providers/models.ts';

const require = createRequire(import.meta.url);
const { providerDeclarationForNode } = require('../backend/src/collaboration/runIntentAuthority.js');
const imageNodeSource = fs.readFileSync(new URL('../src/components/nodes/ImageNode.tsx', import.meta.url), 'utf8');
const proxySource = fs.readFileSync(new URL('../backend/src/routes/proxy.js', import.meta.url), 'utf8');

async function listen(app: any) {
  return new Promise<any>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('GPT Image 2.5 exposes the exact six Workshop models and verified limits in the GPT2 tab', () => {
  assert.deepEqual([...GPT_IMAGE_25_MODELS], [
    'gpt-image-2.5-flare',
    'gpt-image-2.5-flare-2k',
    'gpt-image-2.5-flare-4k',
    'gpt-image-2.5-sunburst',
    'gpt-image-2.5-sunburst-2k',
    'gpt-image-2.5-sunburst-4k',
  ]);
  assert.deepEqual([...GPT_IMAGE_25_QUALITIES], ['auto', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual([...GPT_IMAGE_25_BACKGROUNDS], ['auto', 'opaque']);
  assert.equal(GPT_IMAGE_25_MAX_IMAGES, 14);
  assert.equal(GPT_IMAGE_25_PROMPT_MAX_LENGTH, 32_000);
  assert.deepEqual([...GPT_IMAGE_25_SIZES], [
    '1024x1024', '1536x1024', '1024x1536', '2048x2048', '2048x1152',
    '1152x2048', '3840x2160', '2160x3840', 'custom',
  ]);

  const gpt2 = IMAGE_MODELS.find((item) => item.id === 'gpt-image-2');
  assert.ok(gpt2);
  for (const model of GPT_IMAGE_25_MODELS) {
    assert.equal(isGptImage25Model(model), true);
    const option = gpt2.apiModelOptions.find((item) => item.value === model);
    assert.equal(option?.paramKind, 'gpt-image-2.5');
    assert.equal(option?.maxReferenceImages, 14);
    assert.deepEqual(option?.sizes, [...GPT_IMAGE_25_SIZES]);
    assert.deepEqual(providerDeclarationForNode({
      id: `image-${model}`,
      type: 'image',
      data: { model: 'gpt-image-2', apiModel: model, imageBuiltinSource: 'zhenzhen' },
    }), { provider: 'zhenzhen', model });
  }
  assert.equal(isGptImage25Model('gpt-image-2'), false);
});

test('GPT Image 2.5 custom-size validation matches the reference node', () => {
  assert.equal(validateGptImage25Size('1280x720'), null);
  assert.match(validateGptImage25Size('1001x1024') || '', /16 的倍数/);
  assert.match(validateGptImage25Size('3840x2176') || '', /总像素/);
  assert.match(validateGptImage25Size('3840x1264') || '', /宽高比/);
  assert.match(validateGptImage25Size('4096x2048') || '', /不能超过 3840/);
  assert.match(validateGptImage25Size('512x512') || '', /总像素/);
});

test('Image node uses isolated GPT Image 2.5 controls and request fields', () => {
  assert.match(imageNodeSource, /const isGptImage25 = [\s\S]*isGptImage25Model\(apiModel\)/);
  assert.match(imageNodeSource, /isGptImage25\s*\? GPT_IMAGE_25_MAX_IMAGES/);
  assert.match(imageNodeSource, /nodes:generation\.gptImage25\.tooManyReferences/);
  assert.match(imageNodeSource, /paramKind: isGptImage25 \? 'gpt-image-2\.5'/);
  assert.match(imageNodeSource, /size: isGptImage25 \? gptImage25ResolvedSize/);
  assert.match(imageNodeSource, /n: isGptImage25 \? gptImage25Count/);
  assert.match(imageNodeSource, /background: isGptImage25 \? gptImage25Background/);
  assert.match(imageNodeSource, /isGptImage25[\s\S]*\? GPT_IMAGE_25_QUALITIES/);
});

test('GPT Image 2.5 route uses sync generations JSON and repeated edit image fields', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 't8-gpt-image-25-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const validPng = await sharp({
    create: { width: 8, height: 8, channels: 4, background: { r: 245, g: 155, b: 40, alpha: 1 } },
  }).png().toBuffer();

  const upstreamCalls: Array<{ path: string; query: Record<string, any>; contentType: string; body: Buffer }> = [];
  const upstreamApp = express();
  upstreamApp.use(express.raw({ type: () => true, limit: '16mb' }));
  const capture = (req: any, res: any) => {
    upstreamCalls.push({
      path: req.path,
      query: req.query,
      contentType: String(req.header('content-type') || ''),
      body: Buffer.from(req.body),
    });
    const item = { b64_json: validPng.toString('base64') };
    res.json({ data: req.path.endsWith('/generations') ? [item, item] : [item] });
  };
  upstreamApp.post('/v1/images/generations', capture);
  upstreamApp.post('/v1/images/edits', capture);
  const upstreamServer = await listen(upstreamApp);
  t.after(() => upstreamServer.close());

  const config = require('../backend/src/config.js');
  const oldConfig = {
    SETTINGS_FILE: config.SETTINGS_FILE,
    INPUT_DIR: config.INPUT_DIR,
    OUTPUT_DIR: config.OUTPUT_DIR,
    ZHENZHEN_BASE_URL: config.ZHENZHEN_BASE_URL,
  };
  t.after(() => Object.assign(config, oldConfig));
  config.SETTINGS_FILE = path.join(tmpDir, 'settings.json');
  config.INPUT_DIR = path.join(tmpDir, 'input');
  config.OUTPUT_DIR = path.join(tmpDir, 'output');
  config.ZHENZHEN_BASE_URL = `http://127.0.0.1:${upstreamServer.address().port}`;
  fs.mkdirSync(config.INPUT_DIR, { recursive: true });
  fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(config.SETTINGS_FILE, JSON.stringify({ zhenzhenApiKey: 'test-workshop-token' }));
  fs.writeFileSync(path.join(config.INPUT_DIR, 'reference.png'), validPng);

  const proxyRouter = require('../backend/src/routes/proxy.js');
  t.after(() => proxyRouter._test.resetProviderDispatcherForTests());
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use('/api/proxy', proxyRouter);
  const server = await listen(app);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const generation = await fetch(`${base}/api/proxy/image/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-image-2',
      apiModel: 'gpt-image-2.5-sunburst-4k',
      paramKind: 'gpt-image-2.5',
      prompt: 'a clean orange circle',
      quality: 'max',
      size: '1024x1024',
      n: 2,
      background: 'opaque',
      moderation: 'low',
    }),
  }).then((response) => response.json());
  assert.equal(generation.success, true);
  assert.equal(generation.data.sync, true);
  assert.equal(generation.data.urls.length, 2);
  assert.equal(upstreamCalls[0].path, '/v1/images/generations');
  assert.deepEqual(upstreamCalls[0].query, {});
  assert.match(upstreamCalls[0].contentType, /^application\/json/);
  assert.deepEqual(JSON.parse(upstreamCalls[0].body.toString('utf8')), {
    model: 'gpt-image-2.5-sunburst-4k',
    prompt: 'a clean orange circle',
    quality: 'max',
    size: '1024x1024',
    n: 2,
    background: 'opaque',
    moderation: 'low',
  });

  const references = Array.from({ length: 14 }, () => '/files/input/reference.png');
  const edit = await fetch(`${base}/api/proxy/image/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-image-2',
      apiModel: 'gpt-image-2.5-flare',
      prompt: 'combine every reference into one clean color chart',
      quality: 'low',
      size: '1024x1024',
      n: 1,
      background: 'auto',
      moderation: 'auto',
      images: references,
    }),
  }).then((response) => response.json());
  assert.equal(edit.success, true);
  assert.equal(edit.data.sync, true);
  assert.equal(upstreamCalls[1].path, '/v1/images/edits');
  assert.deepEqual(upstreamCalls[1].query, {});
  assert.match(upstreamCalls[1].contentType, /^multipart\/form-data; boundary=/);
  const multipart = upstreamCalls[1].body.toString('latin1');
  assert.equal((multipart.match(/name="image"/g) || []).length, 14);
  assert.match(multipart, /name="model"[\s\S]*gpt-image-2\.5-flare/);
  assert.match(multipart, /name="n"[\s\S]*1/);
  assert.doesNotMatch(multipart, /name="background"/);

  const rejected = await fetch(`${base}/api/proxy/image/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiModel: 'gpt-image-2.5-flare',
      prompt: 'too many references',
      size: '1024x1024',
      images: [...references, '/files/input/reference.png'],
    }),
  });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /最多输入 14 张参考图/);
  assert.equal(upstreamCalls.length, 2);
});

test('GPT Image 2.5 keeps a dedicated fifteen-minute response deadline', () => {
  assert.match(proxySource, /GPT_IMAGE_25_RESPONSE_DEADLINE_MS\s*=\s*boundedProxyInteger\([\s\S]*?15 \* 60_000/);
  assert.match(
    proxySource,
    /paramKind === 'gpt-image-2\.5'[\s\S]*?fetchProviderResponse\([\s\S]*?deadlineMs: GPT_IMAGE_25_RESPONSE_DEADLINE_MS/,
  );
  assert.match(proxySource, /longResponseWindow: true/);
  assert.match(proxySource, /headersTimeout: responseTimeout/);
  assert.match(proxySource, /!globalThis\.fetch\?\.\[SYSTEM_FETCH_BRIDGE_MARKER\][\s\S]*currentProviderLongResponseDispatcher/);
});
