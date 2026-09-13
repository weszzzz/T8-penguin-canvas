import test from 'node:test';
import { IMAGE_HISTORY_EXTRA_FIELDS } from '../src/utils/historyImageBasicSettings';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import i18n from '../src/i18n/index.ts';
import { generationHistoryZh, generationHistoryEn, historyErrorText, historyReferenceLabel } from '../src/i18n/generationHistoryCatalog.ts';
import { terminalHistoryRecoveryFailure } from '../src/utils/historyRecoveryFailure.ts';
import { prepareHistorySettingsDraft, createHistorySettingsPatch } from '../src/utils/generationHistorySettings.ts';
import Panel from '../src/components/GenerationHistoryPanel.tsx';

test('history locales cover identical keys and substitutions with no CJK in English UI copy', () => {
  assert.deepEqual(Object.keys(generationHistoryZh), Object.keys(generationHistoryEn));
  for (const key of Object.keys(generationHistoryZh) as Array<keyof typeof generationHistoryZh>) {
    const placeholders = (s: string) => s.match(/{{\w+}}/g)?.sort() || [];
    assert.deepEqual(placeholders(generationHistoryZh[key]), placeholders(generationHistoryEn[key]), key);
    assert.doesNotMatch(generationHistoryEn[key], /[\u3400-\u9fff]/, key);
  }
});

test('known recovery failures translate without changing their strict terminal contract or arbitrary text', async () => {
  await i18n.changeLanguage('en-US'); const t = i18n.getFixedT(null, 'canvas');
  const known = terminalHistoryRecoveryFailure({ success: false, code: 'HISTORY_RECOVERY_COMMIT_UNCONFIRMED', committed: true, stopBatch: true, retryable: false, error: 'private path' })!;
  assert.match(historyErrorText(known, t), /Some data was committed/);
  assert.doesNotMatch(historyErrorText(known, t), /private path/);
  assert.equal(terminalHistoryRecoveryFailure({ success: false, code: 'HISTORY_RECOVERY_COMMIT_UNCONFIRMED', committed: false, stopBatch: true, retryable: false }), null);
  assert.match(historyErrorText('图片 2 的旧文件缺失或已变化。请选择当时的原文件，系统会核对内容；本次未创建草稿。', t), /original file for Image 2/);
  assert.equal(historyReferenceLabel('视频 3', t), 'Video 3');
  for (const key of ['error_imageInputMissing', 'error_imageInputUnsupported', 'error_imageInputExtras', 'error_imageInputInvalid', 'error_queryTimeout', 'error_recoveryTimeout'] as const) {
    assert.equal(historyErrorText(generationHistoryZh[key], t), generationHistoryEn[key]);
  }
  for (const text of ['客户自定义.jpg', '提示词', 'Unknown provider response', '图片 2 是我的文件名']) {
    assert.equal(historyErrorText(text, t), text); assert.equal(historyReferenceLabel(text, t), text);
  }
  await i18n.changeLanguage('zh-CN');
  assert.equal(historyErrorText(known, t), known, 'render-time translation follows the current locale');
});

test('locale switches preserve default-looking user prompt and exact patch content', async () => {
  const scope = { projectId: 'p', canvasId: 'c' }, entityUid = 'a1000000-0000-4000-8000-000000000001';
  const target = { id: 'n', entityUid, type: 'seedance', position: { x: 0, y: 0 }, data: { prompt: '新提示词', duration: 5 } };
  const group: any = { nodeId: 'n', nodeEntityUid: entityUid, snapshotAvailable: true };
  const archive: any = { status: 'available', binding: { ...scope, nodeId: 'n', nodeEntityUid: entityUid }, snapshot: {
    node: { id: 'n', type: 'seedance', data: { prompt: generationHistoryZh.unspecified, model: '中文模型名' } }, upstreamNodes: [], incomingEdges: [] } };
  const make = () => prepareHistorySettingsDraft(archive, group, target, scope);
  const original = JSON.stringify(archive), draft = make();
  assert.equal(draft.fields.find(f => f.key === 'prompt')?.afterDefault, undefined);
  assert.equal(draft.fields.find(f => f.key === 'duration')?.afterDefault, true);
  assert.equal(draft.fields.find(f => f.key === 'model')?.beforeDefault, true);
  const input = { ...scope, id: 'same-patch', baseRevision: 1 };
  const patch = createHistorySettingsPatch(draft, input);
  await i18n.changeLanguage('en-US');
  assert.deepEqual(createHistorySettingsPatch(make(), input), patch);
  assert.equal(JSON.stringify(archive), original);
  assert.equal((patch.operations[0].payload as any).dataPatch.prompt, generationHistoryZh.unspecified);
  assert.ok(!JSON.stringify(patch).includes('afterDefault'));
  await i18n.changeLanguage('zh-CN');
});

test('actual panel renders English accessible controls while leaving supplied material data untouched', async () => {
  await i18n.changeLanguage('en-US');
  const html = renderToStaticMarkup(React.createElement(Panel, { open: true, projectId: null, canvasId: null, items: [], refreshKey: '', onClose() {}, onFocusNode() {}, onClearNodeFilter() {}, async onPlace() {}, onCount() {}, generationCount: 0 }));
  assert.match(html, /aria-label="History"/); assert.match(html, /Generations/); assert.match(html, /Current assets/);
  assert.doesNotMatch(html, /[\u3400-\u9fff]/);
  await i18n.changeLanguage('zh-CN');
});

test('all history UI static translation keys exist; language does not join request or mutation dependencies', () => {
  for (const key of Object.keys(IMAGE_HISTORY_EXTRA_FIELDS)) {
    assert.ok(Object.hasOwn(generationHistoryZh, `field_${key}`), `zh model option: ${key}`);
    assert.ok(Object.hasOwn(generationHistoryEn, `field_${key}`), `en model option: ${key}`);
  }
  for (const file of ['GenerationHistoryPanel', 'GenerationHistoryRecords', 'GenerationHistoryRecovery', 'GenerationHistorySettings', 'NodeActionBar']) {
    const source = readFileSync(new URL(`../src/components/${file}.tsx`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/['"]generationHistory\.(\w+)['"]/g)) assert.ok(match[1] in generationHistoryZh, `${file}: ${match[1]}`);
    assert.doesNotMatch(source, /\[[^\]\n]*(?:i18n\.language|i18n\.resolvedLanguage)[^\]\n]*\]/);
  }
});
