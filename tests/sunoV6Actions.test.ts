import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SUNO_NZ_ACTIONS, SUNO_NZ_V6_VERSIONS } from '../src/providers/models.ts';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('Suno V6 action metadata mirrors the three explicit seedance.nz contracts', () => {
  assert.deepEqual(SUNO_NZ_V6_VERSIONS, ['v6', 'v6-wild', 'v6-mini']);
  const actions = Object.fromEntries(SUNO_NZ_ACTIONS.map((item) => [item.value, item]));
  assert.deepEqual(actions['suno-create-model'], {
    value: 'suno-create-model',
    label: '创建自定义模型',
    action: 'create-model',
    requiredFields: ['name', 'audio_urls'],
    allowedVersions: [],
    defaultVersion: undefined,
    resultFamily: 'model',
    referenceType: 'model_audios',
  });
  assert.deepEqual(actions['suno-upload-cover'].allowedVersions, SUNO_NZ_V6_VERSIONS);
  assert.equal(actions['suno-upload-cover'].defaultVersion, 'v6');
  assert.deepEqual(actions['suno-upload-extend'].requiredFields, ['audio_url', 'continue_at']);
});

test('saved Suno V6 workflows cover every action mode without credentials or live identities', () => {
  const names = [
    'suno-create-model.json',
    'suno-upload-cover-description.json',
    'suno-upload-cover-custom.json',
    'suno-upload-extend.json',
  ];
  const workflows = names.map((name) => JSON.parse(read(`../docs/workflows/${name}`)));
  for (const [index, workflow] of workflows.entries()) {
    assert.equal(workflow.schema, 't8-workflow-fragment', names[index]);
    assert.equal(workflow.nodeCount, workflow.nodes.length, names[index]);
    assert.equal(workflow.edgeCount, workflow.edges.length, names[index]);
    const serialized = JSON.stringify(workflow);
    assert.doesNotMatch(serialized, /\bsk-[A-Za-z0-9]/i, names[index]);
    assert.doesNotMatch(serialized, /https?:\/\//i, names[index]);
    assert.doesNotMatch(serialized, /"(?:taskId|task_id)"\s*:/i, names[index]);
    assert.doesNotMatch(serialized, /"(?:apiKey|authorization)"\s*:/i, names[index]);
  }

  const actionData = workflows.map((workflow) => workflow.nodes[0].data);
  assert.deepEqual(actionData.map((data) => data.sunoNzOperation), [
    'suno-create-model',
    'suno-upload-cover',
    'suno-upload-cover',
    'suno-upload-extend',
  ]);
  assert.equal(actionData[0].sunoNzLocalRefAudios.length, 0);
  assert.equal(workflows[0].nodes[1].data.outputType, 'text');
  assert.equal(actionData[1].sunoCustom, false);
  assert.ok(actionData[1].sunoNzGptDescription);
  assert.equal(actionData[2].sunoCustom, true);
  assert.equal(actionData[2].sunoInstrumental, false);
  assert.ok(actionData[2].prompt);
  assert.equal(actionData[3].continueAt, 2);
  assert.equal(actionData[3].custom, undefined);
  assert.equal(actionData[3].instrumental, undefined);
  assert.equal(actionData[3].gpt_description, undefined);
});

test('Suno V6 reference document preserves the paid-submit and source-duration safety boundaries', () => {
  const doc = read('../docs/seedance-nz-suno-v6-actions.md');
  const liveVerifier = read('../scripts/verify-suno-v6-actions-live.cjs');
  assert.match(doc, /拿到 `task_id` 后只能查询原任务/);
  assert.match(doc, /6–24 个有序 `audio_urls`/);
  assert.match(doc, /严格小于源音频经 ffprobe 得到的真实时长/);
  assert.match(doc, /custom_model_id.*persona_id/);
  assert.match(doc, /工作流、报告和日志不得保存密钥、任务 ID、签名 URL/);
  assert.match(liveVerifier, /SUNO_V6_ACTIONS_SCOPE/);
  assert.match(liveVerifier, /liveScope === 'all'/);
  assert.match(liveVerifier, /SUNO_V6_CREATE_MODEL_SOURCE_DIR/);
  assert.doesNotMatch(liveVerifier, /\bsk-[A-Za-z0-9]{20,}/i);
});
