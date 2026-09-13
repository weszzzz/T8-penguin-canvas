import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relPath: string) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

test('main image/video/seedance/audio nodes keep 3600s polling windows', () => {
  assert.match(read('src/components/nodes/AudioNode.tsx'), /SUNO_POLL_TIMEOUT_SECONDS\s*=\s*3600/);
  assert.match(read('src/components/nodes/ImageNode.tsx'), /IMAGE_POLL_TIMEOUT_SECONDS\s*=\s*3600/);
  assert.match(read('src/components/nodes/VideoNode.tsx'), /VIDEO_POLL_TIMEOUT_SECONDS\s*=\s*3600/);
  assert.match(read('src/components/nodes/SeedanceNode.tsx'), /SEEDANCE_POLL_TIMEOUT_SECONDS\s*=\s*3600/);
});

test('batch and loop execution waits do not undercut long generation polling', () => {
  assert.match(read('src/components/Canvas.tsx'), /60\s*\*\s*60\s*\*\s*1000/);
  assert.match(read('src/components/nodes/LoopNode.tsx'), /LOOP_NODE_WAIT_TIMEOUT_MS\s*=\s*60\s*\*\s*60\s*\*\s*1000/);
});

test('external image/video providers default to 3600s generation timeout while preserving Jimeng poll config', () => {
  const { normalizeAdvancedProviders } = require('../backend/src/providers/registry.js');
  const providers = normalizeAdvancedProviders([
    { id: 'jimeng-cli', protocol: 'jimeng-cli', jimengConfig: { pollSeconds: 900 } },
  ]);
  const defaults = normalizeAdvancedProviders([
    { id: 'jimeng-cli', protocol: 'jimeng-cli', jimengConfig: {} },
  ]);

  assert.equal(providers.find((provider: any) => provider.id === 'jimeng-cli')?.jimengConfig?.pollSeconds, 900);
  assert.equal(defaults.find((provider: any) => provider.id === 'jimeng-cli')?.jimengConfig?.pollSeconds, 3600);
  assert.match(read('backend/src/providers/modelscope.js'), /DEFAULT_IMAGE_TIMEOUT_MS\s*=\s*60\s*\*\s*60\s*\*\s*1000/);
  assert.match(read('backend/src/providers/comfyui.js'), /GENERATION_TIMEOUT_MS\s*=\s*60\s*\*\s*60\s*\*\s*1000/);
  assert.match(read('backend/src/providers/volcengine.js'), /GENERATION_TIMEOUT_MS\s*=\s*60\s*\*\s*60\s*\*\s*1000/);
  assert.match(read('backend/src/routes/externalProviders.js'), /EXTERNAL_GENERATION_TIMEOUT_MS\s*=\s*60\s*\*\s*60\s*\*\s*1000/);
});

test('Jimeng production settings clamp legacy short polling windows to 15 minutes', () => {
  const { normalizeAdvancedProviders } = require('../backend/src/providers/registry.js');
  const providers = normalizeAdvancedProviders([
    { id: 'jimeng-cli', protocol: 'jimeng-cli', jimengConfig: { pollSeconds: 20 } },
  ]);
  assert.equal(providers.find((provider: any) => provider.id === 'jimeng-cli')?.jimengConfig?.pollSeconds, 15 * 60);
});
