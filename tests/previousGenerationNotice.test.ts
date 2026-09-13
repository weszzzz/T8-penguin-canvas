import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import i18n from '../src/i18n/index.ts';
import Notice from '../src/components/nodes/PreviousGenerationNotice.tsx';
import { beginVideoRegeneration, completeVideoRegeneration } from '../src/utils/generationResultRetention.ts';

function render(data: Record<string, unknown>) {
  return renderToStaticMarkup(React.createElement(Notice, { data }));
}

test('retained notice follows real begin/completion patches without promising archival', async () => {
  await i18n.changeLanguage('zh-CN');
  const previous = { videoUrl: '/files/output/old.mp4', lastPrompt: 'old', status: 'success' };
  assert.equal(render(previous), '');
  const pending = { ...previous, ...beginVideoRegeneration(previous) };
  assert.match(render(pending), /当前保留上一版结果/);
  assert.match(render(pending), /等待期间/);
  assert.match(render({ ...pending, status: 'polling' }), /等待期间/);
  assert.match(render({ ...pending, status: 'error' }), /本次生成未成功/);
  assert.doesNotMatch(render({ ...pending, status: 'error' }), /等待期间/);
  assert.match(render({ ...pending, status: 'idle' }), /可修改设置后重新生成/);
  assert.doesNotMatch(render(pending), /全部版本|已保存成功/);
  assert.equal(render({ ...pending, ...completeVideoRegeneration(['/files/output/new.mp4'], 'new') }), '');
});

test('empty, false-like or stale successful data does not display a retained-result notice', () => {
  for (const data of [{}, { showingPreviousResult: true }, { showingPreviousResult: true, videoUrl: '  ' },
    { showingPreviousResult: 'true', videoUrl: '/old.mp4' }, { showingPreviousResult: 1, videoUrl: '/old.mp4' },
    { showingPreviousResult: true, videoUrl: '/new.mp4', status: 'success' },
    { showingPreviousResult: true, videoUrls: [null, 42, ''] }]) assert.equal(render(data), '');
  assert.match(render({ showingPreviousResult: true, videoUrls: ['/old.mp4'] }), /role="status"/);
});

test('notice uses actual English catalog and has no actionable or automatic side effects', async () => {
  await i18n.changeLanguage('en-US');
  const html = render({ showingPreviousResult: true, videoUrl: '/old.mp4', status: 'error' });
  assert.match(html, /Previous result retained/);
  assert.match(html, /This generation did not succeed/);
  assert.match(html, /other saved versions/);
  assert.match(html, /aria-atomic="true"/);
  assert.doesNotMatch(html, /[\u3400-\u9fff]|<button|<a\s|<input/);
  await i18n.changeLanguage('zh-CN');
});

for (const file of ['VideoNode', 'SeedanceNode']) test(`${file} passes its actual data into the shared notice exactly once`, () => {
  const source = readFileSync(new URL(`../src/components/nodes/${file}.tsx`, import.meta.url), 'utf8');
  const tree = ts.createSourceFile(`${file}.tsx`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const usages: ts.JsxSelfClosingElement[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'PreviousGenerationNotice') usages.push(node);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(usages.length, 1);
  assert.equal(usages[0].attributes.getText(tree), 'data={d}');
});
