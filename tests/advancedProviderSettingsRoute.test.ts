import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('settings route persists advancedProviders with masking and secret preservation', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 't8-advanced-settings-'));
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const config = require('../backend/src/config.js');
  const oldConfig = {
    SETTINGS_FILE: config.SETTINGS_FILE,
    DEFAULT_LOCAL_SAVE_DIR: config.DEFAULT_LOCAL_SAVE_DIR,
    DEFAULT_CANVAS_AUTO_SAVE_DIR: config.DEFAULT_CANVAS_AUTO_SAVE_DIR,
    DEFAULT_RESOURCE_LIBRARY_DIR: config.DEFAULT_RESOURCE_LIBRARY_DIR,
    DEFAULT_THEME_TEMPLATE_DIR: config.DEFAULT_THEME_TEMPLATE_DIR,
  };
  t.after(() => {
    Object.assign(config, oldConfig);
  });
  config.SETTINGS_FILE = path.join(tmpDir, 'settings.json');
  config.DEFAULT_LOCAL_SAVE_DIR = path.join(tmpDir, 'save');
  config.DEFAULT_CANVAS_AUTO_SAVE_DIR = path.join(tmpDir, 'canvas');
  config.DEFAULT_RESOURCE_LIBRARY_DIR = path.join(tmpDir, 'resources');
  config.DEFAULT_THEME_TEMPLATE_DIR = path.join(tmpDir, 'themes');

  const express = require('express');
  const settingsRouter = require('../backend/src/routes/settings.js');
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/settings', settingsRouter);
  const server = await new Promise<any>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => {
    server.close();
  });

  const base = `http://127.0.0.1:${server.address().port}/api/settings`;

  const initial = await fetch(base).then((res) => res.json());
  assert.equal(initial.success, true);
  assert.ok(Array.isArray(initial.data.advancedProviders));
  assert.equal(initial.data.advancedProviderSummary.enabledCount, 0);
  assert.equal(initial.data.advancedProviders.find((p: any) => p.id === 'modelscope')?.apiKey, '');

  const save = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      advancedProviders: [
        {
          id: 'modelscope',
          protocol: 'modelscope',
          enabled: true,
          apiKey: 'ms-secret-123456',
          imageModels: ['MusePublic/489_ckpt_FLUX_1'],
        },
        {
          id: 'custom-openai',
          protocol: 'openai-compatible',
          enabled: true,
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'openai-secret-123456',
          imageSizeOverride: '1024X1536',
        },
        {
          id: 'bad url',
          protocol: 'modelscope',
          baseUrl: 'ftp://not-allowed',
          apiKey: 'drop-me',
        },
      ],
    }),
  }).then((res) => res.json());
  assert.equal(save.success, true);

  const masked = await fetch(base).then((res) => res.json());
  const modelscope = masked.data.advancedProviders.find((p: any) => p.id === 'modelscope');
  assert.equal(modelscope.apiKey, '****3456');
  assert.equal(modelscope.hasApiKey, true);
  const customOpenAi = masked.data.advancedProviders.find((p: any) => p.id === 'custom-openai');
  assert.equal(customOpenAi.imageSizeOverride, '1024x1536');
  assert.equal(masked.data.advancedProviderSummary.enabledCount, 2);
  assert.equal(masked.data.advancedProviderSummary.configuredKeyCount, 2);
  assert.equal(masked.data.advancedProviders.some((p: any) => p.id === 'bad url'), false);
  assert.equal(JSON.stringify(masked.data).includes('ms-secret-123456'), false);

  const raw = await fetch(`${base}/raw`).then((res) => res.json());
  assert.equal(raw.data.advancedProviders.find((p: any) => p.id === 'modelscope').apiKey, 'ms-secret-123456');

  const preserve = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      advancedProviders: [
        { id: 'modelscope', protocol: 'modelscope', enabled: true, apiKey: '****3456' },
      ],
    }),
  }).then((res) => res.json());
  assert.equal(preserve.success, true);

  const preservedRaw = await fetch(`${base}/raw`).then((res) => res.json());
  assert.equal(preservedRaw.data.advancedProviders.find((p: any) => p.id === 'modelscope').apiKey, 'ms-secret-123456');
});
