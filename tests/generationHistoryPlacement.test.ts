import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationHistoryPlacementPatch, prepareGenerationHistoryPlacement } from '../src/utils/generationHistoryPlacement.ts';
import type { GenerationHistoryOutput } from '../src/types/generationHistory';
import type { AssetRef } from '../src/types/project';
import { frozenAssetMediaUrl } from '../src/utils/frozenAssetMedia.ts';

function fixture() {
  const output: GenerationHistoryOutput = { assetId: 'asset-1', contentHash: 'a'.repeat(64), kind: 'image', title: 'version one', outputOrdinal: 0, availability: 'available', mediaUrl: '/api/project-assets/asset-1/media', evidence: 'host-recorded' };
  const asset: AssetRef = { id: 'asset-1', entityUid: 'a1000000-0000-4000-8000-000000000001', projectId: 'project-1', kind: 'image', filename: 'one.png', contentHash: 'a'.repeat(64), storageMode: 'managed', availability: 'available', createdAt: 1 };
  const state = { current: true, reads: 0, requests: [] as Array<{ url: string; init: RequestInit }> };
  const dependencies = {
    isCurrentScope: () => state.current,
    getAsset: async (_id: string) => { state.reads++; return asset; },
    request: async (url: string, init: RequestInit) => { state.requests.push({ url, init }); return { ok: true }; },
  };
  return { output, asset, state, dependencies, prepare: () => prepareGenerationHistoryPlacement(output, 'project-1', dependencies) };
}

test('placement patch adds one standalone media node with exact content reference, no edges or execution', async () => {
  const h = fixture();
  const asset = await h.prepare();
  const patch = createGenerationHistoryPlacementPatch(asset, { projectId: 'project-1', canvasId: 'canvas-1', baseRevision: 4, id: 'placement-1', position: { x: 100, y: 200 } });
  assert.equal(patch.baseRevision, 4); assert.equal(patch.operations.length, 1);
  assert.equal(patch.operations[0].type, 'node.add');
  const node = patch.operations[0].payload.node as any;
  assert.equal(node.type, 'upload'); assert.equal(node.data.historyAssetRef.assetId, asset.id);
  assert.equal(node.data.historyAssetRef.entityUid, asset.entityUid);
  assert.equal(node.data.historyAssetRef.contentHash, asset.contentHash);
  assert.equal(node.data.imageUrl, asset.sourceUrl); assert.equal(node.data.historyPlacement, true);
  assert.equal(node.data.runTrigger, undefined);
  assert.throws(() => createGenerationHistoryPlacementPatch(asset, { projectId: 'other', canvasId: 'canvas-1', baseRevision: 4, id: 'placement-1', position: { x: 0, y: 0 } }), /无效/);
});

test('history placement verifies physical media with a bounded HEAD request and returns the exact asset', async () => {
  const h = fixture();
  const prepared = await h.prepare();
  assert.equal(prepared.sourceUrl, frozenAssetMediaUrl(h.asset));
  assert.equal(prepared.contentHash, h.output.contentHash);
  assert.deepEqual(h.state.requests, [{ url: frozenAssetMediaUrl(h.asset), init: { method: 'HEAD', cache: 'no-store', credentials: 'same-origin', redirect: 'error' } }]);
  assert.equal(h.asset.sourceUrl, undefined, 'does not mutate the asset index object');
});

test('restored URLs persist all version guards with encoded IDs and reject incomplete evidence', () => {
  const h = fixture(); h.asset.projectId = '项目/one & two'; h.asset.id = 'asset/one';
  const url = new URL(frozenAssetMediaUrl(h.asset), 'http://localhost');
  assert.equal(url.pathname, '/api/project-assets/asset%2Fone/media');
  assert.equal(url.searchParams.get('projectId'), h.asset.projectId);
  assert.equal(url.searchParams.get('entityUid'), h.asset.entityUid);
  assert.equal(url.searchParams.get('contentHash'), h.asset.contentHash);
  for (const change of [{ entityUid: '' }, { contentHash: null }, { projectId: '' }]) {
    assert.throws(() => frozenAssetMediaUrl({ ...h.asset, ...change }), /固定版本/);
  }
});

test('missing physical file is rejected despite stale available metadata', async () => {
  const h = fixture(); h.dependencies.request = async () => ({ ok: false });
  await assert.rejects(h.prepare(), /文件暂不可用/);
});

test('network errors do not return a placeable asset', async () => {
  const h = fixture(); h.dependencies.request = async () => { throw new Error('offline'); };
  await assert.rejects(h.prepare(), /offline/);
});

test('scope is checked before reading and after each asynchronous boundary', async () => {
  const initial = fixture(); initial.state.current = false;
  await assert.rejects(initial.prepare(), /画布已切换/); assert.equal(initial.state.reads, 0);
  const afterRead = fixture(); afterRead.dependencies.getAsset = async () => { afterRead.state.current = false; return afterRead.asset; };
  await assert.rejects(afterRead.prepare(), /画布已切换/); assert.equal(afterRead.state.requests.length, 0);
  const afterHead = fixture(); afterHead.dependencies.request = async () => { afterHead.state.current = false; return { ok: true }; };
  await assert.rejects(afterHead.prepare(), /画布已切换/);
});

test('mismatched project, identity, content version or availability never requests media', async () => {
  for (const patch of [{ projectId: 'other' }, { id: 'other' }, { contentHash: 'new-hash' }, { availability: 'missing' as const }]) {
    const h = fixture(); Object.assign(h.asset, patch);
    await assert.rejects(h.prepare(), /素材已变化或不可用/); assert.equal(h.state.requests.length, 0);
  }
});

test('only the same-origin canonical asset media path is allowed, never supplied external URLs', async () => {
  for (const url of ['https://external.invalid/a', '//external.invalid/a', '/files/output/a.png', '/api/project-assets/other/media', null]) {
    const h = fixture(); h.output.mediaUrl = url;
    await assert.rejects(h.prepare(), /素材已变化或不可用/); assert.equal(h.state.reads, 0);
  }
  const h = fixture(); h.output.availability = 'changed';
  await assert.rejects(h.prepare(), /素材已变化或不可用/); assert.equal(h.state.reads, 0);
});
