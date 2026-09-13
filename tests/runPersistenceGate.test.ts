import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hook = readFileSync(new URL('../src/hooks/useRunTrigger.ts', import.meta.url), 'utf8');

test('Canvas Run creation binds project, canvas and revision from the same authoritative snapshot', () => {
  const canvas = readFileSync(new URL('../src/components/Canvas.tsx', import.meta.url), 'utf8');
  const call = canvas.match(/await api\.createProjectRun\(\{([\s\S]*?)summary:/)?.[1];
  assert.ok(call);
  for (const field of ['projectId', 'canvasId']) assert.match(call, new RegExp(`${field}: persistenceSnapshot\\.${field}`));
  assert.match(call, /canvasRevision: persistenceSnapshot\.revision/);
});

test('Run HTTP client preserves an explicit non-default project without changing the execution snapshot', async (t) => {
  const { createProjectRun } = await import('../src/services/api.ts');
  const input = { id: 'fixture-run', projectId: 'non-default-project', canvasId: 'fixture-canvas', canvasRevision: 7 };
  const calls: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls.push({ url, method: options.method, body: JSON.parse(String(options.body)) });
    return new Response(JSON.stringify({ success: true, data: { ...input, status: 'queued' } }), {
      status: 201, headers: { 'content-type': 'application/json' },
    });
  });
  const result = await createProjectRun(input);
  assert.deepEqual(calls, [{ url: '/api/project-runs', method: 'POST', body: input }]);
  assert.equal(result.projectId, input.projectId);
  assert.equal(result.canvasRevision, input.canvasRevision);
});

function orderedIndex(source: string, patterns: RegExp[]) {
  let cursor = 0;
  return patterns.map((pattern) => {
    const match = pattern.exec(source.slice(cursor));
    assert.ok(match, `missing ordered persistence gate: ${pattern}`);
    cursor += match.index + match[0].length;
    return cursor;
  });
}

test('Provider execution is impossible without a persisted Run, NodeRun, and Attempt', () => {
  assert.match(hook, /if \(!runId\) \{\s*throw new Error\('缺少持久化 Run 上下文，已停止调用 Provider'\);\s*\}/);
  assert.match(hook, /catch \(error\) \{\s*throw new Error\(`无法建立持久化 NodeRun\/Attempt，已停止调用 Provider：/);

  orderedIndex(hook, [
    /if \(!runId\)/,
    /await createProjectNodeRun\(/,
    /await createProjectRunAttempt\(/,
    /await updateProjectNodeRun\(/,
    /resolvePersistenceReady\(\);/,
    /await lifecycle\.reporter\.progress\(\{ phase: 'executing', progress: 0 \}\);/,
    /await \(\(historyExecution\?\.run \|\| runFnRef\.current\)/,
  ]);
});

test('a persistence failure is reported as failed completion without invoking the Provider callback first', () => {
  const persistenceCatch = hook.match(/catch \(error\) \{\s*throw new Error\(`无法建立持久化 NodeRun\/Attempt[\s\S]*?\n\s*\}/)?.[0] || '';
  assert.ok(persistenceCatch);
  assert.doesNotMatch(persistenceCatch, /runFnRef\.current/);
  const completionCatch = hook.match(/catch \(error: any\) \{[\s\S]*?\n\s*\} finally \{/)?.[0] || '';
  assert.ok(completionCatch);
  assert.match(completionCatch, /resolvePersistenceReady\(\);/);
  assert.match(completionCatch, /if \(terminalWrite\) await terminalWrite;/);
  assert.match(completionCatch, /else await persistTerminal\(stopped \? 'stopped' : 'failed', error\);/);
  assert.match(completionCatch, /terminal evidence persistence failed/);
  assert.match(completionCatch, /markDone\(/);
});
