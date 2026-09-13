import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getVideoOutputPrompt } from '../src/utils/videoOutputPrompt.ts';
import ts from 'typescript';

test('video output attribution keeps the successful prompt across draft edits, pending, failure and stop', () => {
  for (const type of ['video', 'seedance']) for (const status of ['success', 'submitting', 'polling', 'error', 'idle']) {
    const data = Object.freeze({ videoUrl: '/old.mp4', lastPrompt: 'Original successful prompt', prompt: 'New draft', status });
    assert.deepEqual(getVideoOutputPrompt(type, data), { prompt: 'Original successful prompt' });
    assert.equal(data.prompt, 'New draft');
  }
});

test('array-only video output and newer success bind their own recorded prompt', () => {
  assert.deepEqual(getVideoOutputPrompt('video', { videoUrls: ['', '/a.mp4'], lastPrompt: 'A', prompt: 'B' }), { prompt: 'A' });
  assert.deepEqual(getVideoOutputPrompt('seedance', { videoUrls: ['/b.mp4'], lastPrompt: 'B', prompt: 'C' }), { prompt: 'B' });
});

test('blank or absent legacy generation prompt cannot be invented from current inputs', () => {
  for (const lastPrompt of [undefined, null, 7, '', '  ']) {
    assert.deepEqual(getVideoOutputPrompt('seedance', { videoUrl: '/old.mp4', prompt: 'Unrelated new draft', lastPrompt }), {
      prompt: typeof lastPrompt === 'string' ? lastPrompt : '',
    });
  }
});

test('normal text, routed text-only data and not-yet-generated inputs retain their existing semantics', () => {
  for (const type of ['text', 'llm', 'output', 'material-set', 'image', undefined]) {
    assert.equal(getVideoOutputPrompt(type, { videoUrl: '/old.mp4', prompt: 'Input', lastPrompt: 'Previous' }), null);
  }
  for (const data of [{ prompt: 'Input' }, { videoUrl: ' ', videoUrls: [null, 42, ''] }, { localRefVideos: ['/reference.mp4'] }]) {
    assert.equal(getVideoOutputPrompt('seedance', data), null);
  }
});

test('OutputNode text and media attribution share the selector and track lastPrompt changes', () => {
  const source = readFileSync(new URL('../src/components/nodes/OutputNode.tsx', import.meta.url), 'utf8');
  assert.match(source, /pushUniqueText\(out\.texts, getVideoOutputPrompt\(\(n as any\)\?\.type, ud\)\?\.prompt \?\? ud\.prompt\)/);
  assert.match(source, /const videoPrompt = getVideoOutputPrompt\(nodeType, ud\)/);
  assert.match(source, /if \(videoPrompt\) return clean\(videoPrompt\.prompt\)/);
  const signature = source.slice(source.indexOf('const upstreamSig'), source.indexOf('const collected'));
  assert.match(signature, /ud\.lastPrompt/);
});

test('actual OutputNode media mapping reserves unknown video attribution instead of borrowing unrelated text', () => {
  const source = readFileSync(new URL('../src/components/nodes/OutputNode.tsx', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('OutputNode.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback = '';
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'mediaPromptByUrl' && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0].getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree); assert.ok(callback);
  const compiled = ts.transpileModule(`return (${callback})();`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const evaluate = new Function('upstreamNodes', 'd', 'displayText', 'getVideoOutputPrompt', compiled);
  for (const lastPrompt of ['', undefined, 'Original']) {
    const map = evaluate([{ type: 'seedance', data: { videoUrl: '/old.mp4', lastPrompt, prompt: 'New input' } }], {}, 'Other connected text', getVideoOutputPrompt);
    assert.deepEqual(map.get('/old.mp4'), { prompt: lastPrompt || '', negative: '' });
  }
  assert.match(source, /mediaPromptByUrl\.get\(u\)\?\.prompt \?\? displayText/);
  assert.doesNotMatch(source, /mediaPromptByUrl\.get\(u\)\?\.prompt \|\| displayText/);
});
