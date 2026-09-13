'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const yazl = require('yazl');
const { CreatorSkillError, SKILL_LIMITS, buildSkillPackage, canonicalJson } = require('../backend/src/services/creatorSkillPackages');
const { CreatorSkillStore, CATALOG_SCHEMA } = require('../backend/src/services/creatorSkillStore');
const { createCreatorSkillRouter } = require('../backend/src/routes/creatorSkills');

const source = '---\nname: product-prompt\ndescription: Prepare a clear prompt from product facts.\n---\nPreserve the user facts; write a clear prompt.\n';
const query = '?projectId=project-a&canvasId=canvas-a';

async function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't8-skill-route-'));
  const store = new CreatorSkillStore({ root, ...options });
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/skills', createCreatorSkillRouter({ getStore: () => store, requireScope: input => {
    if (input.projectId !== 'project-a' || input.canvasId !== 'canvas-a') throw new CreatorSkillError('SCOPE_NOT_FOUND', '项目或画布不存在', 404);
    return { projectId: input.projectId };
  } }));
  app.use((_error, _req, res, _next) => res.status(500).json({ ok: false }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/skills`;
  const request = async (url, options = {}) => {
    const response = await fetch(base + url, options);
    return { status: response.status, data: await response.json() };
  };
  return { root, store, request };
}

function form(files) {
  const data = new FormData();
  for (const [name, content] of files) data.append('files', new Blob([content]), name);
  return data;
}
function json(value) { return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }; }

test('Skill import/list/detail/disable/uninstall keep original text and never generate', async t => {
  const f = await fixture(t);
  const result = await f.request('/import' + query, { method: 'POST', body: form([['SKILL.md', source]]) });
  assert.equal(result.status, 201);
  assert.equal(result.data.data.generated, false);
  const item = result.data.data.item;
  const list = await f.request('/' + query);
  assert.equal(list.data.data.items.length, 1);
  const detail = await f.request(`/${encodeURIComponent(item.id)}${query}&packageDigest=${item.packageDigest}`);
  assert.equal(detail.data.data.instructions, 'Preserve the user facts; write a clear prompt.');
  assert.equal(JSON.stringify(detail).includes(f.root), false);
  const body = { projectId: 'project-a', canvasId: 'canvas-a', packageDigest: item.packageDigest };
  const disabled = await f.request(`/${encodeURIComponent(item.id)}/status`, json({ ...body, status: 'disabled' }));
  assert.equal(disabled.status, 200);
  const removed = await f.request(`/${encodeURIComponent(item.id)}/status`, json({ ...body, status: 'retained' }));
  assert.equal(removed.data.data.retainedForExistingWork, true);
  assert.equal((await f.request('/' + query)).data.data.items.length, 0);
});

test('multipart directory import preserves relative resource paths', async t => {
  const f = await fixture(t);
  const result = await f.request('/import' + query, { method: 'POST', body: form([
    ['my-skill/SKILL.md', source + '\nRead [guide](references/guide.md).'], ['my-skill/references/guide.md', 'Use accurate product facts.'],
  ]) });
  assert.equal(result.status, 201);
  assert.equal(result.data.data.item.fileCount, 2);
  assert.deepEqual(result.data.data.item.diagnostics, []);
});

test('ZIP import supports a file larger than normal JSON while retaining resource limits', async t => {
  const f = await fixture(t);
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(source), 'SKILL.md');
  zip.addBuffer(Buffer.alloc(1024 * 1024 + 1, 2), 'assets/large.png', { compress: false });
  zip.end();
  const chunks = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk);
  const result = await f.request('/import' + query, { method: 'POST', body: form([['skill.zip', Buffer.concat(chunks)]]) });
  assert.equal(result.status, 201);
  assert.equal(result.data.data.item.fileCount, 2);
});

test('invalid scope is rejected before any package is stored', async t => {
  const f = await fixture(t);
  const result = await f.request('/import?projectId=other&canvasId=canvas-a', { method: 'POST', body: form([['SKILL.md', source]]) });
  assert.equal(result.status, 404);
  assert.deepEqual(fs.readdirSync(f.root), []);
});

test('host paths, extra fields and forged actor identity cannot become an import authority', async t => {
  const f = await fixture(t);
  const hostPath = await f.request('/import' + query, json({ directory: 'C:/Users/Administrator' }));
  assert.equal(hostPath.status, 400);
  const upload = form([['SKILL.md', source]]);
  upload.append('actorId', 'other-creator');
  assert.equal((await f.request('/import' + query, { method: 'POST', body: upload })).status, 413);
  assert.deepEqual(fs.readdirSync(f.root), []);
});

test('streamed upload rejects excess bytes without registering a partial package', async t => {
  const f = await fixture(t);
  const upload = form([['SKILL.md', source], ['assets/large.png', Buffer.alloc(SKILL_LIMITS.fileBytes + 1)]]);
  const result = await f.request('/import' + query, { method: 'POST', body: upload });
  assert.equal(result.status, 413);
  assert.equal(result.data.code, 'CREATOR_SKILL_TOO_LARGE');
  assert.deepEqual(fs.readdirSync(f.root), []);
});

test('an unconfigured official catalog is empty rather than fabricated as available', async t => {
  const f = await fixture(t);
  const catalog = await f.request('/catalog' + query);
  assert.deepEqual(catalog.data.data.items, []);
  const installed = await f.request('/install', json({ projectId: 'project-a', canvasId: 'canvas-a', id: 'imaginary', packageDigest: 'a'.repeat(64) }));
  assert.equal(installed.status, 404);
});

test('new-task preparation refuses disabled, removed, revoked and stale versions while details stay readable', async t => {
  const keys = crypto.generateKeyPairSync('ed25519');
  const trustedKeys = { test: keys.publicKey.export({ type: 'spki', format: 'pem' }) };
  const first = buildSkillPackage([{ path: 'SKILL.md', bytes: Buffer.from(source) }]);
  const second = buildSkillPackage([{ path: 'SKILL.md', bytes: Buffer.from(source + '\nNew method.') }]);
  const catalogFor = (pack, revision) => {
    const manifest = { schema: CATALOG_SCHEMA, revision, skills: [{ id: 'method', title: 'Method',
      version: String(revision), kind: 'text', adapterId: 'text-v1', packageDigest: pack.packageDigest }] };
    return { manifest, keyId: 'test', signature: crypto.sign(null, Buffer.from(canonicalJson(manifest)), keys.privateKey).toString('base64') };
  };
  const f = await fixture(t, { trustedKeys, catalog: catalogFor(first, 1), packageProvider: () => first });
  const scope = { projectId: 'project-a', actorId: 'local-owner' };
  const item = f.store.installOfficial(scope, 'method', first.packageDigest);
  const prepare = digest => f.request(`/${encodeURIComponent(item.id)}/prepare${query}&packageDigest=${digest}`);
  const read = digest => f.request(`/${encodeURIComponent(item.id)}${query}&packageDigest=${digest}`);
  const before = fs.readdirSync(path.join(f.root, f.store._scope(scope).key, 'index')).length;
  assert.equal((await prepare(first.packageDigest)).data.data.generated, false);
  assert.equal(fs.readdirSync(path.join(f.root, f.store._scope(scope).key, 'index')).length, before, 'preflight must not create tasks or writes');
  for (const status of ['disabled', 'retained']) {
    f.store.setStatus(scope, item.id, first.packageDigest, status);
    assert.equal((await prepare(first.packageDigest)).data.code, 'CREATOR_SKILL_DISABLED');
    assert.equal((await read(first.packageDigest)).status, 200);
  }
  f.store.setStatus(scope, item.id, first.packageDigest, 'active');
  f.store.revokedDigests.add(first.packageDigest);
  assert.equal((await prepare(first.packageDigest)).data.code, 'CREATOR_SKILL_REVOKED');
  assert.equal((await read(first.packageDigest)).status, 200);
  f.store.revokedDigests.clear();
  const updater = new CreatorSkillStore({ root: f.root, trustedKeys, catalog: catalogFor(second, 2), packageProvider: () => second });
  updater.updateOfficial(scope, item.id, first.packageDigest, second.packageDigest);
  assert.equal((await prepare(first.packageDigest)).data.code, 'CREATOR_SKILL_VERSION_STALE');
  assert.equal((await read(first.packageDigest)).status, 200);
  assert.equal((await prepare(second.packageDigest)).data.data.item.packageDigest, second.packageDigest);
});
