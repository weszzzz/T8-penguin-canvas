import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { SUNO_VERSIONS, DEFAULT_SUNO_VERSION, sunoWorkshopTextLimitError } from '../src/providers/models';
import { zhCN, enUS } from '../src/i18n/resources';
const fixture = createRequire(import.meta.url)('../scripts/suno-workshop-route-fixture.cjs');
const versions = [['v6', 'chirp-hawk'], ['v6 wild', 'chirp-hawk-wild'], ['v6 mini', 'chirp-goose']];

test('Workshop appends exact V6 versions without migrating old defaults or Budget versions', () => {
  assert.deepEqual(SUNO_VERSIONS.map(v => v.value), ['v3.0', 'v3.5', 'v4', 'v4.5', 'v4.5+', 'v5', 'v5.5', ...versions.map(v => v[0])]);
  assert.equal(DEFAULT_SUNO_VERSION, 'v5.5');
  const route = fixture({ fetchResponse: () => { throw new Error('no network'); } });
  assert.equal(route.resolve('suno-v5.5'), 'chirp-fenix');
  assert.equal(route.resolve('unknown'), 'chirp-fenix');
  for (const [v, mv] of [['v3.0', 'chirp-v3.0'], ['v3.5', 'chirp-v3.5'], ['v4', 'chirp-v4'], ['v4.5', 'chirp-auk'], ['v4.5+', 'chirp-bluejay'], ['v5', 'chirp-crow']]) assert.equal(route.resolve(v), mv);
  for (const [version, mv] of versions) {
    assert.equal(route.resolve(version), mv); assert.equal(route.resolve(`suno-${version}`), mv); assert.equal(route.resolve(mv), mv);
  }
});

test('network errors and Provider rejection never cause a second paid submission', async () => {
  for (const failure of ['network', 'http']) {
    let calls = 0;
    const route = fixture({ fetchResponse: async () => {
      calls++; if (failure === 'network') throw new Error('private details');
      return new Response('{}', { status: 503 });
    } });
    const result = await route.submit({ version: 'v6 mini', prompt: 'test' });
    assert.equal(calls, 1); assert.equal(result.status, failure === 'network' ? 502 : 503);
  }
});

test('V6 information and limits are present in both locale catalogs', () => {
  for (const locale of [zhCN, enUS]) {
    for (const key of ['sunoV6Hint', 'sunoV6PromptLimit', 'sunoV6TagsLimit']) {
      assert.equal(typeof (locale.nodes.audio as any)[key], 'string');
    }
  }
});

test('actual submit route sends all three V6 models through generate, cover, extend without replay', async () => {
  for (const [version, mv] of versions) for (const mode of ['generate', 'cover', 'extend']) {
    const calls: any[] = [];
    const route = fixture({ fetchResponse: async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ id: 'unit-task', clips: [{ id: 'unit-clip' }] }));
    } });
    const result = await route.submit({ version, mode, prompt: 'original lyrics', tags: 'piano', title: 'test', seed: 12,
      cover_clip_id: 'reference', continue_clip_id: 'reference', continue_at: 470 });
    assert.equal(result.status, 200); assert.equal(calls.length, 1); assert.equal(calls[0].body.mv, mv);
    assert.equal(calls[0].body.prompt, 'original lyrics'); assert.equal(calls[0].body.seed, 12);
    assert.equal(calls[0].url, `https://ai.t8star.org/suno/${mode === 'cover' ? 'submit/music' : 'generate'}`);
    if (mode === 'extend') assert.equal(calls[0].body.continue_at, 470);
    if (mode === 'cover') assert.equal(calls[0].body.cover_clip_id, 'reference');
    assert.equal(calls[0].body.duration, undefined, '8 min capability is not an invented request field');
  }
});

test('front/back V6 Unicode boundaries reject overlong text before Provider work', async () => {
  for (const [version] of versions) {
    let calls = 0;
    const route = fixture({ fetchResponse: async () => { calls++; return new Response(JSON.stringify({ id: 'unit-task', clips: [{ id: 'unit-clip' }] })); } });
    for (const [prompt, tags, error] of [['🎵'.repeat(5000), '风'.repeat(1000), null], ['p'.repeat(5001), '', 'prompt'], ['p', 't'.repeat(1001), 'tags']] as const) {
      assert.equal(sunoWorkshopTextLimitError(version, prompt, tags), error);
      assert.equal((await route.submit({ version, prompt, tags })).status, error ? 400 : 200);
    }
    assert.equal(calls, 1);
    assert.equal((await route.submit({ version, prompt: {}, tags: '' })).status, 400);
    assert.equal(calls, 1);
  }
  const source = readFileSync(new URL('../src/components/nodes/AudioNode.tsx', import.meta.url), 'utf8');
  assert.ok(source.indexOf('sunoWorkshopTextLimitError(version, finalPrompt, tags)') < source.indexOf("logBus.info('检测到上游音频 URL"));
  assert.match(source, /if \(isSuno && !isSunoNz\)/);
});
