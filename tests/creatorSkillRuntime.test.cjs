'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CreatorSkillError } = require('../backend/src/services/creatorSkillPackages');
const {
  createSkillBinding, normalizeSkillBinding, normalizeSkillSelection, validateSkillAction,
  validateSkillActionInputs, normalizeSkillOutput, prepareSkillArtifactMutation,
  readCurrentSkillWork,
} = require('../backend/src/services/creatorSkillRuntime');
const { CreatorConversationRepository } = require('../backend/src/services/creatorConversationRepository');
const { CreatorActionExecutor } = require('../backend/src/services/creatorActionExecutor');

const scope = { projectId: 'skill-project', canvasId: 'skill-canvas' };
const selection = { id: 'official:product-ad', packageDigest: 'a'.repeat(64), taskId: 'skill-task' };
const asset = { assetId: 'asset-input', kind: 'image', contentHash: 'b'.repeat(64), contentRevision: 1 };
const node = { nodeId: 'node-input', type: 'text', label: '产品要求', content: '保持产品颜色', assetId: null };
function binding(adapterId = 'image-v1', overrides = {}) {
  // Unit fixture only: official signatures are exercised in the store and HTTP
  // integration suites, not simulated as production certification here.
  return createSkillBinding({ executionAllowed: true, context: { contextDigest: 'c'.repeat(64) },
    pack: { packageDigest: selection.packageDigest },
    skill: { id: selection.id, origin: 'official', adapterId, title: '商品创作', version: '1', compatibility: 'image-adapter', ...overrides },
  }, selection, scope, [asset], [node]);
}
const rejected = code => error => error.code === code;
const output = body => ({ schema: 't8-creator-skill-output-v1', title: '商品提示词', body });

test('binding preserves exact identities and rejects forged digests or missing task IDs', () => {
  const fixed = binding();
  assert.deepEqual(normalizeSkillBinding(fixed), fixed);
  assert.throws(() => normalizeSkillBinding({ ...fixed, adapterId: 'video-v1' }), rejected('CREATOR_SKILL_BINDING_INVALID'));
  assert.throws(() => normalizeSkillSelection({ ...selection, taskId: undefined }), rejected('CREATOR_SKILL_BINDING_INVALID'));
  assert.throws(() => normalizeSkillBinding({ ...fixed, schema: 'future-schema' }), rejected('CREATOR_SKILL_BINDING_INVALID'));
});

test('text, reference-only and wrong-modality skills cannot propose media; input scope includes every shot', () => {
  const action = { type: 'image', inputAssetIds: [asset.assetId] };
  validateSkillAction(binding(), action);
  for (const fixed of [binding('text-v1'), binding('video-v1'), binding('image-v1', { compatibility: 'reference-only' })]) {
    assert.throws(() => validateSkillAction(fixed, action), rejected('CREATOR_SKILL_ACTION_UNSUPPORTED'));
  }
  assert.throws(() => validateSkillAction(binding(), { ...action, shots: [{ inputAssetIds: ['other-asset'] }] }), rejected('CREATOR_SKILL_ASSET_SCOPE'));
  assert.throws(() => validateSkillAction(binding(), { ...action, inputAssetIds: Array(13).fill(asset.assetId) }), rejected('CREATOR_SKILL_ASSET_SCOPE'));
  assert.throws(() => validateSkillAction(binding(), { ...action, inputAssetIds: { assetId: asset.assetId } }), rejected('CREATOR_SKILL_ASSET_SCOPE'));
});

test('execution rechecks referenced content but does not bind unrelated canvas revisions', () => {
  const fixed = binding();
  const actual = { ...asset, id: asset.assetId, projectId: scope.projectId };
  const action = { type: 'image', inputAssetIds: [asset.assetId] };
  validateSkillActionInputs(fixed, action, { ...scope, revision: 999 }, { getAsset: () => actual }, () => [node]);
  for (const changed of [null, { ...actual, projectId: 'another-project' }, { ...actual, contentHash: 'd'.repeat(64) }, { ...actual, contentRevision: 2 }]) {
    assert.throws(() => validateSkillActionInputs(fixed, action, scope, { getAsset: () => changed }, () => [node]), rejected('CREATOR_SKILL_INPUT_STALE'));
  }
  assert.throws(() => validateSkillActionInputs(fixed, action, scope, { getAsset: () => actual }, () => [{ ...node, content: '更换商品颜色' }]), rejected('CREATOR_SKILL_INPUT_STALE'));
  assert.throws(() => validateSkillActionInputs(fixed, action, { ...scope, canvasId: 'other-canvas' }, { getAsset: () => actual }, () => [node]), rejected('CREATOR_SKILL_SCOPE_MISMATCH'));
});

test('text output is preserved without truncation and cannot forge completion or overwrite accepted work', () => {
  const fixed = binding('text-v1');
  const body = '完整正文。'.repeat(2400);
  const normalized = normalizeSkillOutput({ ...output(body), status: 'media-completed', quality: 'passed' }, fixed);
  assert.equal(normalized.body, body);
  assert.equal(normalized.status, 'text-produced');
  assert.equal(normalized.quality, undefined);
  assert.throws(() => normalizeSkillOutput(output('字'.repeat(16001)), fixed), rejected('CREATOR_SKILL_OUTPUT_INVALID'));
  assert.equal(normalizeSkillOutput(output(body), binding('text-v1', { compatibility: 'reference-only' })).status, 'reference-produced');
  const mutation = prepareSkillArtifactMutation(normalized, fixed);
  const currentWork = readCurrentSkillWork(fixed, [{ ...mutation, versionId: 'test-version' }]);
  assert.equal(currentWork.body, body);
  assert.equal(currentWork.status, 'model-draft');
  assert.equal(readCurrentSkillWork(fixed, [{ ...mutation, scopeKey: 'another-task' }]), null);
  assert.match(mutation.scopeKey, /^skill:[a-f0-9]{32}$/u);
  assert.throws(() => prepareSkillArtifactMutation(normalized, fixed, [{ kind: 'PromptPack', scopeKey: mutation.scopeKey, status: 'accepted' }]), rejected('CREATOR_SKILL_WORK_LOCKED'));
});

test('assistant staged recovery keeps skill text, task identity and one work version across restart', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-skill-staged-'));
  const filename = path.join(directory, 'conversations.sqlite3');
  let repository = new CreatorConversationRepository({ filename });
  t.after(() => { repository.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const fixed = binding('text-v1');
  repository.createConversation({ ...scope, id: 'skill-session' });
  const user = repository.appendUserMessage('skill-session', { ...scope, body: '整理提示词', clientRequestId: 'skill-request', skillBinding: fixed });
  const started = repository.startAssistantResponse('skill-session', { ...scope, responseId: 'skill-response', replyToMessageId: user.message.id });
  const skillOutput = normalizeSkillOutput(output('完整提示词。'.repeat(1800)), fixed);
  const completion = { ...scope, body: '已经整理好完整提示词。', suggestions: ['精简文案', '调整色调', '保留这版'],
    skillBinding: fixed, skillOutput, workMutation: {
      expectedWorkRevision: 0,
      taskProfile: { family: 'mixed', intent: '文本创作', deliveryKind: 'PromptPack', modalities: ['text'], qualityMode: 'quality' },
      mutations: [prepareSkillArtifactMutation(skillOutput, fixed)],
    } };
  repository.stageAssistantResult('skill-session', started.responseId, completion, scope);
  repository.close();
  repository = new CreatorConversationRepository({ filename });
  repository.recoverStagedAssistantResponses();
  const snapshot = repository.getConversation('skill-session', scope);
  const assistant = snapshot.messages.find(message => message.role === 'assistant');
  assert.equal(assistant.status, 'completed');
  assert.equal(assistant.skillBinding.bindingDigest, fixed.bindingDigest);
  assert.equal(assistant.skillOutput.body, skillOutput.body);
  const work = repository.getWorkState('skill-session', { ...scope, includeCurrentVersions: true });
  assert.equal(work.currentVersions.length, 1);
  assert.equal(work.currentVersions[0].fields.prompts[0].body, skillOutput.body);
  repository.completeAssistantResponse('skill-session', started.responseId, completion);
  assert.equal(repository.getWorkState('skill-session', scope).snapshot.revision, work.snapshot.revision);
});

test('repository rejects cross-task completions atomically and keeps retry action binding', t => {
  const repository = new CreatorConversationRepository();
  t.after(() => repository.close());
  const fixed = binding();
  repository.createConversation({ ...scope, id: 'skill-action-session' });
  const user = repository.appendUserMessage('skill-action-session', { ...scope, body: '生成图片', clientRequestId: 'skill-action-request', skillBinding: fixed });
  repository.startAssistantResponse('skill-action-session', { ...scope, responseId: 'skill-action-response', replyToMessageId: user.message.id });
  const action = { id: 'skill-action', type: 'image', prompt: '生成商品摄影', parameters: { ratio: '1:1', count: 1 },
    inputAssetIds: [asset.assetId], modelSnapshot: { kind: 'image', providerId: 'seedance-nz', modelId: 'zhenzhen-image-gk-v2', catalogDigest: 'd'.repeat(64) } };
  assert.throws(() => repository.completeAssistantResponse('skill-action-session', 'skill-action-response', { ...scope,
    body: '准备开始生成。', suggestions: ['调整色调', '修改构图', '开始生成'], skillBinding: fixed, action }), rejected('CREATOR_SKILL_BINDING_CONFLICT'));
  assert.equal(repository.getConversation('skill-action-session', scope).messages.find(message => message.role === 'assistant').status, 'streaming');
  repository.completeAssistantResponse('skill-action-session', 'skill-action-response', { ...scope, body: '准备开始生成。', suggestions: ['调整色调', '修改构图', '开始生成'], skillBinding: fixed, action: { ...action, skillBinding: fixed } });
  repository.updateAction(action.id, 'skill-action-session', { status: 'failed', errorCode: 'CREATOR_PROVIDER_TASK_FAILED' }, scope);
  const retry = repository.retryFailedAction(action.id, 'skill-action-session', { clientRequestId: 'skill-retry' }, scope);
  assert.equal(retry.skillBinding.bindingDigest, fixed.bindingDigest);
  assert.equal(repository.getSkillTaskBinding('skill-action-session', selection, scope).selection.packageDigest, selection.packageDigest);
  assert.throws(() => repository.getSkillTaskBinding('skill-action-session', { ...selection, packageDigest: 'e'.repeat(64) }, scope), rejected('CREATOR_SKILL_TASK_CONFLICT'));
  assert.throws(() => repository.findUserMessageByClientRequest('skill-action-session', { ...scope, body: '生成图片', clientRequestId: 'skill-action-request' }), rejected('CREATOR_REQUEST_CONFLICT'));
});

test('executor without a host skill guard fails before new execution or direct submit', async () => {
  const action = { id: 'guarded-action', status: 'pending', skillBinding: binding(), type: 'image' };
  const repository = { getAction: () => action };
  const executor = new CreatorActionExecutor({ repository, database: {}, assetIndexer: {} });
  assert.throws(() => executor.start('session', action.id, scope), rejected('CREATOR_SKILL_GUARD_REQUIRED'));
  await assert.rejects(() => executor.execute('session', action.id, scope), rejected('CREATOR_SKILL_GUARD_REQUIRED'));
  await assert.rejects(() => executor.submit(action, 'unused', {}, [], {}), rejected('CREATOR_SKILL_GUARD_REQUIRED'));
});

test('executor rechecks immediately before paid submit; revocation does not block query recovery', async () => {
  let revoked = false;
  let submissions = 0;
  const fixed = binding();
  const action = { id: 'guarded-action', status: 'running', skillBinding: fixed, type: 'image', prompt: '商品摄影', parameters: {}, inputAssetIds: [], modelSnapshot: { modelId: 'zhenzhen-image-gk-v2' } };
  const executor = new CreatorActionExecutor({ database: {}, assetIndexer: {}, repository: { getAction: () => action },
    skillActionGuard: () => { if (revoked) throw new CreatorSkillError('CREATOR_SKILL_REVOKED', '已撤回', 409); },
    provider: { submitImageTask: async () => { submissions += 1; return { taskId: 'test-task' }; } },
  });
  // Revocation occurs after initial checks but before the provider call.
  executor._guardSkillAction(action, scope);
  revoked = true;
  await assert.rejects(() => executor.submit(action, 'unused', {}, [], {}), rejected('CREATOR_SKILL_REVOKED'));
  assert.equal(submissions, 0);
  let recovered = 0;
  executor.reconcileAction = () => action;
  executor.resume = async () => { recovered += 1; };
  executor.start('session', action.id, scope);
  await executor.wait(action.id);
  assert.equal(recovered, 1);
  assert.equal(submissions, 0);
});
