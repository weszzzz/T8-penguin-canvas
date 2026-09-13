import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { HISTORY_QUERY_TIMEOUT, HISTORY_RECOVERY_TIMEOUT, HistoryRequestTimeoutError, withHistoryRequestDeadline } from '../src/utils/historyRequestDeadline.ts';
import { terminalHistoryRecoveryFailure } from '../src/utils/historyRecoveryFailure.ts';
const never = () => new Promise<never>(() => {});

test('history deadline bounds a stalled body, aborts its request and ignores late completion', async () => {
  let signal: AbortSignal | undefined, complete!: (value: string) => void;
  const pending = withHistoryRequestDeadline(10, undefined, current => {
    signal = current; return new Promise<string>(resolve => { complete = resolve; });
  }, HISTORY_QUERY_TIMEOUT);
  await assert.rejects(pending, error => error instanceof HistoryRequestTimeoutError && error.message === HISTORY_QUERY_TIMEOUT);
  assert.equal(signal?.aborted, true); complete('late success');
});

test('parent cancellation is not timeout and pre-cancelled calls never start work', async () => {
  const parent = new AbortController(); let started = 0;
  parent.abort();
  await assert.rejects(withHistoryRequestDeadline(100, parent.signal, async () => { started++; return 1; }, 'timeout'), { name: 'AbortError' });
  assert.equal(started, 0);
  const live = new AbortController(); let child: AbortSignal | undefined;
  const request = withHistoryRequestDeadline(100, live.signal, signal => { child = signal; return never(); }, 'timeout');
  await Promise.resolve(); live.abort();
  await assert.rejects(request, { name: 'AbortError' }); assert.equal(child?.aborted, true);
});

test('completed history operation clears timeout and parent listener without changing ordinary failures', async () => {
  const parent = new AbortController(); let signal!: AbortSignal;
  assert.equal(await withHistoryRequestDeadline(10, parent.signal, async current => { signal = current; return 7; }, 'timeout'), 7);
  parent.abort(); await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(signal.aborted, false, 'completed work is not aborted by a stale listener or timer');
  const original = new Error('ordinary error');
  await assert.rejects(withHistoryRequestDeadline(10, undefined, async () => { throw original; }, 'timeout'), error => error === original);
});

test('actual history query wrapper applies thirty seconds around request and preserves cancellation', async () => {
  const source = readFileSync(new URL('../src/services/api.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function listGenerationHistory('), end = source.indexOf('export async function listProjectRuns(', start);
  assert.ok(start >= 0 && end > start);
  const code = ts.transpileModule(source.slice(start, end).replace('export ', ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const parent = new AbortController(); let requested = '', child: AbortSignal | undefined;
  const fn = new Function('BASE', 'request', 'withHistoryRequestDeadline', 'HISTORY_QUERY_TIMEOUT', `${code}; return listGenerationHistory;`)(
    '/api', (url: string, options: { signal: AbortSignal }) => { requested = url; child = options.signal; return never(); },
    (ms: number, signal: AbortSignal, action: (signal: AbortSignal) => Promise<unknown>, message: string) => {
      assert.equal(ms, 30000); assert.equal(signal, parent.signal);
      return withHistoryRequestDeadline(10, signal, action, message);
    }, HISTORY_QUERY_TIMEOUT);
  await assert.rejects(fn({ projectId: 'p', canvasId: 'c' }, { signal: parent.signal }), HistoryRequestTimeoutError);
  assert.match(requested, /^\/api\/project-runs\/generation-history\?/); assert.equal(child?.aborted, true);
});

test('actual bulk callback pauses at an uncertain timeout without submitting remaining files or claiming failure', async () => {
  const source = readFileSync(new URL('../src/components/GenerationHistoryRecovery.tsx', import.meta.url), 'utf8');
  const match = source.match(/  const recover = async \(\) => \{[\s\S]*?\n  \};/); assert.ok(match);
  const code = ts.transpileModule(match[0], { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const files = [new File(['one'], 'one.png'), new File(['two'], 'two.png'), new File(['three'], 'three.png')];
  const state: any = { calls: 0, refresh: 0 }, request = { current: null }, stopped = { current: false };
  const context: Record<string, unknown> = {
    request, stopped, files, blocked: '', projectId: 'p', canvasId: 'c',
    setBusy: (value: boolean) => { state.busy = value; }, setMessage: (value: unknown) => { state.message = value; },
    setBlocked: (value: string) => { state.blocked = value; }, setFiles: (value: File[]) => { state.files = value; },
    onRecovered: () => { state.refresh++; }, terminalHistoryRecoveryFailure, HISTORY_RECOVERY_TIMEOUT, HistoryRequestTimeoutError,
    withHistoryRequestDeadline: (ms: number, signal: AbortSignal, action: (signal: AbortSignal) => Promise<unknown>, message: string) => {
      assert.equal(ms, 300000); return withHistoryRequestDeadline(10, signal, action, message);
    },
    fetch: async () => { state.calls++; return { ok: true, json: state.calls === 1
      ? async () => ({ success: true, data: { assetId: 'confirmed' } }) : never }; },
  };
  const recover = new Function(...Object.keys(context), `${code}; return recover;`)(...Object.values(context));
  await recover(); await recover();
  assert.equal(state.calls, 2); assert.equal(state.refresh, 1); assert.equal(state.busy, false);
  assert.equal(request.current, null); assert.equal(stopped.current, true);
  assert.equal(state.blocked, HISTORY_RECOVERY_TIMEOUT); assert.deepEqual(state.files, files.slice(1));
  assert.deepEqual(state.message, { key: 'generationHistory.recoveryPartial', values: { added: 1, duplicate: 0, failed: 2 } });
});
