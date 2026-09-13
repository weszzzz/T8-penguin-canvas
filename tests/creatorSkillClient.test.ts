import assert from 'node:assert/strict';
import test from 'node:test';
import {
  importCreatorSkillV2, installCreatorSkillV2, updateCreatorSkillV2, setCreatorSkillStatusV2,
  listCreatorSkillsV2, getCreatorSkillCatalogV2, getCreatorSkillDetailsV2, prepareCreatorSkillV2, preflightCreatorSkillV2, sendCreatorMessageV2,
} from '../src/services/creatorAgentV2';

test('skill client preserves relative folder paths and lets the browser supply multipart boundaries', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const file = new File(['guide'], 'SKILL.md', { type: 'text/markdown' });
  Object.defineProperty(file, 'webkitRelativePath', { value: 'product/SKILL.md' });
  const controller = new AbortController();
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), '/api/creator-agent/v2/skills/import?projectId=project&canvasId=canvas');
    assert.equal(new Headers(init?.headers).has('Content-Type'), false);
    assert.equal(init?.signal, controller.signal);
    assert.ok(init?.body instanceof FormData);
    assert.equal((init.body.get('files') as File).name, 'product/SKILL.md');
    assert.equal((init.body.get('files') as File).size, 5);
    return Response.json({ ok: true, data: { item: { id: 'private:test' }, generated: false } });
  };
  assert.equal((await importCreatorSkillV2('project', 'canvas', [file], controller.signal)).generated, false);
});

test('skill management never sends a generation request or omits the exact version and scope', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {} });
    return Response.json({ ok: true, data: { items: [], generated: false } });
  };
  await listCreatorSkillsV2('project', 'canvas');
  await getCreatorSkillCatalogV2('project', 'canvas');
  await getCreatorSkillDetailsV2('project', 'canvas', 'official:test', 'a'.repeat(64));
  await installCreatorSkillV2('project', 'canvas', 'test', 'a'.repeat(64));
  await updateCreatorSkillV2('project', 'canvas', 'official:test', 'a'.repeat(64), 'b'.repeat(64));
  await setCreatorSkillStatusV2('project', 'canvas', 'official:test', 'b'.repeat(64), 'retained');
  assert.equal(seen.length, 6);
  assert.ok(seen.every(call => call.url.startsWith('/api/creator-agent/v2/skills')));
  assert.match(seen[2].url, /official%3Atest\?projectId=project&canvasId=canvas&packageDigest=a{64}$/);
  assert.deepEqual(seen[4].body, { projectId: 'project', canvasId: 'canvas', previousDigest: 'a'.repeat(64), packageDigest: 'b'.repeat(64) });
  assert.equal(seen[5].body.status, 'retained');
});

test('skill message payload carries fixed task identity without modifying the user draft or attachments', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const input = { projectId: 'project', canvasId: 'canvas', text: '用户完整原话', clientRequestId: 'turn-1',
    attachments: [], selectedNodeIds: ['node-1'], skill: { id: 'private:test', packageDigest: 'a'.repeat(64), taskId: 'task-1' } };
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), '/api/creator-agent/v2/sessions/session/messages');
    assert.equal(new Headers(init?.headers).get('Content-Type'), 'application/json');
    assert.deepEqual(JSON.parse(String(init?.body)), input);
    return Response.json({ ok: true, data: {} });
  };
  await sendCreatorMessageV2('session', input);
});

test('skill failures retain host error identity instead of reporting installation success', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => Response.json({ ok: false, code: 'CREATOR_SKILL_VERSION_STALE', message: '版本已经变化' }, { status: 409 });
  await assert.rejects(() => installCreatorSkillV2('project', 'canvas', 'test', 'a'.repeat(64)), error =>
    error instanceof Error && error.message === '版本已经变化' && (error as Error & { code: string }).code === 'CREATOR_SKILL_VERSION_STALE');
});

test('new task preparation uses a scoped current-version preflight, not historical detail reads', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const controller = new AbortController();
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), `/api/creator-agent/v2/skills/official%3Atest/prepare?projectId=project&canvasId=canvas&packageDigest=${'a'.repeat(64)}`);
    assert.equal(init?.signal, controller.signal);
    assert.equal(init?.body, undefined);
    return Response.json({ ok: true, data: { item: { id: 'official:test' }, generated: false } });
  };
  assert.equal((await prepareCreatorSkillV2('project', 'canvas', 'official:test', 'a'.repeat(64), controller.signal)).generated, false);
});

test('readiness sends reference identities only and carries an abort signal without sending a prompt', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const controller = new AbortController();
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /\/skills\/official%3Atest\/preflight$/);
    assert.equal(init?.signal, controller.signal);
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.attachments, [{ assetId: 'asset-1', kind: 'image' }]);
    assert.equal(body.sessionId, 'session');
    assert.equal(body.taskId, 'task-1');
    assert.equal(body.text, undefined);
    return Response.json({ ok: true, data: { generated: false } });
  };
  await preflightCreatorSkillV2({ projectId: 'project', canvasId: 'canvas', sessionId: 'session',
    skill: { id: 'official:test', packageDigest: 'a'.repeat(64), taskId: 'task-1' },
    attachments: [{ assetId: 'asset-1', kind: 'image', title: 'Do not send this private title', previewUrl: 'https://do-not-send.invalid' }], selectedNodeIds: [] }, controller.signal);
});
