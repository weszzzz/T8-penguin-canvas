'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { parseProjectAssetMediaUrl } = require('../backend/src/services/assetMediaIdentity');

test('frozen media GET, HEAD and Range reject wrong identity and physical/index replacement without writes', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-frozen-media-http-'));
  const previous = { T8PC_PACKAGED: process.env.T8PC_PACKAGED, T8PC_USER_DATA: process.env.T8PC_USER_DATA, T8_COLLAB_MANAGEMENT_TOKEN: process.env.T8_COLLAB_MANAGEMENT_TOKEN };
  process.env.T8PC_PACKAGED = '1'; process.env.T8PC_USER_DATA = directory;
  process.env.T8_COLLAB_MANAGEMENT_TOKEN = 'F'.repeat(43);
  const config = require('../backend/src/config');
  const router = require('../backend/src/routes/projectAssets');
  const database = require('../backend/src/services/projectDatabase').getProjectDatabase(config);
  router.getRuntime();
  // This test exercises media reads, not asynchronous index/preview workers.
  // Stop them before query_only so their unrelated maintenance cannot write.
  router.semanticPipeline.close(); router.previewPipeline.close();
  const app = express(); app.use('/api/project-assets', router);
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    router.previewPipeline.close(); await database.close();
    const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(directory));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const filename = path.join(directory, 'original-reference.txt');
  const original = 'historical bytes must not silently change'; fs.writeFileSync(filename, original);
  let asset = database.upsertAsset({ id: 'asset/version', projectId: 'project/one & two', filename: 'reference.txt',
    kind: 'text', mimeType: 'text/plain', managedPath: filename, storageMode: 'linked', availability: 'available',
    contentHash: crypto.createHash('sha256').update(original).digest('hex'), contentHashVerification: 'verified' });
  const identity = { projectId: asset.projectId, entityUid: asset.entityUid, contentHash: asset.contentHash };
  const bare = `/api/project-assets/${encodeURIComponent(asset.id)}/media`;
  const frozen = `${bare}?${new URLSearchParams(identity)}`;
  assert.deepEqual(parseProjectAssetMediaUrl(frozen), { assetId: asset.id, identity });
  const get = (url, options) => fetch(`${origin}${url}`, options);
  const { resolveMediaRef, resolveT8LocalMediaPath, assertResolvedMediaBuffer } = require('../backend/src/providers/mediaResolver');
  const before = database.db.prepare('SELECT total_changes() AS n').get().n;
  database.db.pragma('query_only = ON');
  try {
    const response = await get(frozen); assert.equal(response.status, 200); assert.equal(await response.text(), original);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const asLocal = await resolveMediaRef(frozen, { target: 'local-path', projectDatabase: database });
    assert.equal(asLocal.expectedContentHash, identity.contentHash);
    assert.equal(resolveT8LocalMediaPath(frozen, { projectDatabase: database }), fs.realpathSync.native(filename));
    const asData = await resolveMediaRef(frozen, { target: 'data-url', projectDatabase: database });
    assert.equal(Buffer.from(asData.base64, 'base64').toString(), original);
    assert.throws(() => assertResolvedMediaBuffer(Buffer.from('swapped after resolve'), asLocal), /内容已变化/);
    assert.equal((await get(frozen, { method: 'HEAD' })).status, 200);
    const range = await get(frozen, { headers: { Range: 'bytes=0-9' } });
    assert.equal(range.status, 206); assert.equal(await range.text(), original.slice(0, 10));
    for (const changed of [{ projectId: 'another-project' }, { entityUid: crypto.randomUUID() }, { contentHash: 'a'.repeat(64) }]) {
      const url = `${bare}?${new URLSearchParams({ ...identity, ...changed })}`;
      for (const method of ['GET', 'HEAD']) {
        const wrong = await get(url, { method }); assert.equal(wrong.status, 404);
        assert.equal((await wrong.arrayBuffer()).byteLength, 0);
      }
      assert.equal(resolveT8LocalMediaPath(url, { projectDatabase: database }), '');
      for (const target of ['local-path', 'data-url', 'base64', 'url']) {
        await assert.rejects(resolveMediaRef(url, { target, projectDatabase: database }), /固定版本/);
      }
    }
    for (const suffix of [`?projectId=${identity.projectId}`, `?${new URLSearchParams(identity)}&contentHash=${asset.contentHash}`, '?entityUid[bad]=value']) {
      assert.equal((await get(bare + suffix)).status, 404, 'partial, duplicate or structured identities fail closed');
      await assert.rejects(resolveMediaRef(bare + suffix, { target: 'local-path', projectDatabase: database }), /固定版本/);
    }
    fs.writeFileSync(filename, 'x'.repeat(original.length));
    assert.equal((await get(frozen)).status, 404, 'unchanged index cannot hide changed physical bytes');
    await assert.rejects(resolveMediaRef(frozen, { target: 'data-url', projectDatabase: database }), /固定版本/);
    assert.equal(database.db.prepare('SELECT total_changes() AS n').get().n, before);
  } finally { database.db.pragma('query_only = OFF'); }

  const replacement = 'newly indexed bytes at the same asset ID'; fs.writeFileSync(filename, replacement);
  asset = database.upsertAsset({ ...asset, contentHash: crypto.createHash('sha256').update(replacement).digest('hex'), contentHashVerification: 'verified' });
  const replacementBefore = database.db.prepare('SELECT total_changes() AS n').get().n;
  database.db.pragma('query_only = ON');
  try {
    const legacy = await get(bare); assert.equal(legacy.status, 200); assert.equal(await legacy.text(), replacement);
    for (const options of [{}, { method: 'HEAD' }, { headers: { Range: 'bytes=0-3' } }]) {
      assert.equal((await get(frozen, options)).status, 404, 'the saved URL never follows a re-indexed same-ID replacement');
    }
    await assert.rejects(resolveMediaRef(frozen, { target: 'local-path', projectDatabase: database }), /固定版本/);
    const fresh = await get(`${bare}?${new URLSearchParams({ ...identity, contentHash: asset.contentHash })}`);
    assert.equal(fresh.status, 200); assert.equal(await fresh.text(), replacement);
    fs.unlinkSync(filename); assert.equal((await get(frozen)).status, 404);
    assert.equal(database.db.prepare('SELECT total_changes() AS n').get().n, replacementBefore);
  } finally { database.db.pragma('query_only = OFF'); }

  // Exercise the actual local-to-Provider adapter and its cache, with a
  // synthetic PNG and a captured multipart transport (no external request).
  const sharp = require('sharp');
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#1268ab' } }).png().toBuffer();
  const pngPath = path.join(directory, 'provider-reference.png'); fs.writeFileSync(pngPath, png);
  const imageAsset = database.upsertAsset({ id: 'provider-reference', projectId: asset.projectId, filename: 'provider-reference.png',
    kind: 'image', mimeType: 'image/png', managedPath: pngPath, storageMode: 'linked', availability: 'available',
    contentHash: crypto.createHash('sha256').update(png).digest('hex'), contentHashVerification: 'verified' });
  const imageUrl = `/api/project-assets/${imageAsset.id}/media?${new URLSearchParams({ projectId: imageAsset.projectId, entityUid: imageAsset.entityUid, contentHash: imageAsset.contentHash })}`;
  const proxyMedia = require('../backend/src/routes/proxy')._test.readProviderLocalMediaRefBuffer;
  assert.deepEqual((await proxyMedia(imageUrl, { allowedKinds: ['image'] })).buffer, png);
  const seedance = require('../backend/src/providers/seedanceNz'); seedance.resetCachesForTests();
  let providerCalls = 0;
  const uploadOptions = { uploadIntervalMs: 0, fetchImpl: async (url, init) => {
    providerCalls += 1; assert.match(url, /\/v1\/files\/upload$/);
    assert.deepEqual(Buffer.from(await init.body.get('file').arrayBuffer()), png);
    return new Response(JSON.stringify({ url: 'https://example.invalid/frozen-test.png' }), { status: 200 });
  } };
  assert.equal(await seedance.uploadMedia(imageUrl, 'image', 'fixture-only', uploadOptions), 'https://example.invalid/frozen-test.png');
  assert.equal(providerCalls, 1);
  database.upsertAsset({ ...imageAsset, contentHash: 'c'.repeat(64), contentHashVerification: 'verified' });
  await assert.rejects(proxyMedia(imageUrl, { allowedKinds: ['image'] }), /固定版本/);
  await assert.rejects(seedance.uploadMedia(imageUrl, 'image', 'fixture-only', uploadOptions), /本地文件/);
  assert.equal(providerCalls, 1, 'cached upload must not bypass a replaced frozen identity');
  seedance.resetCachesForTests();
});

test('canonical reference parser accepts exact frozen queries and never drops malformed guards', () => {
  const path = '/api/project-assets/asset/media';
  const identity = { projectId: 'one', entityUid: '0190f23a-6c9d-7a31-8b4c-2d5e6f708192', contentHash: 'a'.repeat(64) };
  assert.deepEqual(parseProjectAssetMediaUrl(path), { assetId: 'asset', identity: null });
  assert.deepEqual(parseProjectAssetMediaUrl(`${path}?${new URLSearchParams(identity)}`), { assetId: 'asset', identity });
  assert.deepEqual(parseProjectAssetMediaUrl(`${path}?${new URLSearchParams(identity)}&referenceSlot=1`), { assetId: 'asset', identity });
  assert.equal(parseProjectAssetMediaUrl(`${path}?${new URLSearchParams(identity)}&referenceSlot=100`), null);
  for (const value of [`${path}?projectId=one`, `${path}?${new URLSearchParams(identity)}&projectId=two`, `${path}#ignored`, `${path}?${new URLSearchParams(identity)}&unknown=1`, path.replace('asset/media', '%61sset/media')]) {
    assert.equal(parseProjectAssetMediaUrl(value), null);
  }
});
