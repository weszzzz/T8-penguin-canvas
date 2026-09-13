import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { VIDEO_MODELS, inferVideoBuiltinSource, videoModelsForSource, videoModelOptionsForSource } from '../src/providers/models.ts';
import { historyVideoUsesTaskCache } from '../src/utils/historyVideoTaskBinding.ts';

// Cross-check the guard against the actual node's selection declarations so a
// legacy source/mainId/default change cannot silently bypass cache protection.
const source = readFileSync(new URL('../src/components/nodes/VideoNode.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('VideoNode.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['rawModel', 'isLegacySora2Model', 'savedModelDef', 'inferredBuiltinSource', 'videoBuiltinSource',
  'builtinVideoModels', 'requestedMainId', 'modelDef', 'builtinApiModelOptions', 'apiModel']);
const declarations: string[] = [];
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.has(node.name.text)) declarations.push(`const ${node.getText(tree)};`);
  ts.forEachChild(node, visit);
}
visit(tree); assert.equal(declarations.length, names.size);
const code = ts.transpileModule(`${declarations.join('\n')}\nreturn modelDef.kind === 'flux3' && apiModel.endsWith('-draft-enhance');`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const nodeSelection = new Function('scope', `with(scope) { ${code} }`);
const actual = (d: Record<string, unknown>) => nodeSelection({ d, VIDEO_MODELS, inferVideoBuiltinSource,
  videoModelsForSource, videoModelOptionsForSource, useMemo: (read: () => unknown) => read() });

test('task-cache guard matches actual model selection for registered options, sources and legacy fallbacks', () => {
  const cases: Record<string, unknown>[] = [{}, { model: 'sora-2-2025-01-01' }, { model: 'unknown-draft-enhance' },
    { mainId: 'flux-3-video' }, { model: 'flux-3-video-draft-enhance', mainId: 'unknown' },
    { model: 'flux-3-video-draft-enhance', providerSource: 'external', providerId: 'unknown-provider' }];
  for (const model of VIDEO_MODELS) for (const option of model.apiModelOptions) {
    for (const videoBuiltinSource of [undefined, 'zhenzhen', 'seedance-nz']) cases.push({ model: option.value, videoBuiltinSource });
  }
  for (const data of cases) assert.equal(historyVideoUsesTaskCache(data), actual(data), JSON.stringify(data));
  assert.equal(historyVideoUsesTaskCache({ model: 'flux-3-video-draft-enhance' }), true);
  assert.equal(historyVideoUsesTaskCache({ model: 'flux-3-video-global-draft-enhance' }), true);
  assert.equal(historyVideoUsesTaskCache({ model: 'flux-3-video-t2v', flux3DraftCache: 'unrelated-current-cache' }), false);
  assert.equal(historyVideoUsesTaskCache({ model: 'unknown-draft-enhance' }), false, 'suffix without actual registry selection is insufficient');
});
