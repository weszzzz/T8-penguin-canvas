import test from 'node:test';
import assert from 'node:assert/strict';
import { terminalHistoryRecoveryFailure, assertHistoryRecoveryMayContinue, HistoryRecoveryStoppedError } from '../src/utils/historyRecoveryFailure.ts';
import { readFileSync } from 'node:fs';

test('terminal recovery advice requires exact non-retryable contract and never exposes raw exception text', () => {
  const response = {success:false,code:'HISTORY_RECOVERY_COMMIT_UNCONFIRMED',committed:true,retryable:false,stopBatch:true,error:'private filesystem path'};
  assert.match(terminalHistoryRecoveryFailure(response)!,/保存确认失败/);
  assert.ok(!terminalHistoryRecoveryFailure(response)!.includes(response.error));
  assert.match(terminalHistoryRecoveryFailure({...response,code:'HISTORY_RECOVERY_WRITES_STOPPED',committed:false})!,/暂停写入/);
  for (const other of [null,{},'error',{...response,committed:false},{...response,retryable:true},{...response,stopBatch:false},{...response,success:true},{...response,code:'OTHER_ERROR'}]) {
    assert.equal(terminalHistoryRecoveryFailure(other),null);
  }
});

test('single-reference recovery uses the exact terminal contract and sanitized failure', () => {
  for (const code of ['HISTORY_RECOVERY_COMMIT_UNCONFIRMED', 'HISTORY_RECOVERY_WRITES_STOPPED']) {
    const response = { success: false, code, committed: code === 'HISTORY_RECOVERY_COMMIT_UNCONFIRMED', retryable: false, stopBatch: true, error: 'secret-path' };
    assert.throws(() => assertHistoryRecoveryMayContinue(response), error => {
      assert.ok(error instanceof HistoryRecoveryStoppedError); assert.ok(!error.message.includes('secret-path')); return true;
    });
    assert.doesNotThrow(() => assertHistoryRecoveryMayContinue({ ...response, retryable: true }));
  }
  for (const ordinary of [{ success: true }, { success: false, error: 'wrong original' }, null])
    assert.doesNotThrow(() => assertHistoryRecoveryMayContinue(ordinary));
  const canvas = readFileSync(new URL('../src/components/Canvas.tsx', import.meta.url), 'utf8');
  assert.match(canvas, /const result = await response\.json\(\);\s*assertCurrent\(\);\s*assertHistoryRecoveryMayContinue\(result\);\s*if \(!response\.ok/);
});

test('actual reference recovery callback blocks repeated writes only after terminal errors', async () => {
  const source = readFileSync(new URL('../src/components/GenerationHistorySettings.tsx', import.meta.url), 'utf8');
  const callback = source.match(/const recoverReference = (async \(\) => \{[\s\S]*?\n  \});/); assert.ok(callback);
  // This callback contains plain JS; run its real body with controlled effects.
  for (const terminal of [true, false]) {
    const state = { calls: 0, opened: 0, blocked: false, busy: false, error: '' };
    const recoveryStopped = { current: false }, recoveryRequest = { current: null };
    const recover = new Function('recoveryStopped', 'missingReference', 'recoveryFile', 'recoveryRequest',
      'setBusy', 'setError', 'mounted', 'open', 'HistoryRecoveryStoppedError', 'setRecoveryBlocked', `return (${callback[1]});`)(
      recoveryStopped, { recover: async () => { state.calls++; throw terminal ? new HistoryRecoveryStoppedError('stopped') : new Error('wrong original'); } },
      {}, recoveryRequest, (value: boolean) => { state.busy = value; }, (value: string) => { state.error = value; }, { current: true },
      async () => { state.opened++; }, HistoryRecoveryStoppedError, (value: boolean) => { state.blocked = value; });
    await recover(); await recover();
    assert.equal(state.calls, terminal ? 1 : 2); assert.equal(state.blocked, terminal);
    assert.equal(state.busy, false); assert.equal(recoveryRequest.current, null); assert.equal(state.opened, 0);
  }
  assert.match(source, /if \(recoveryStopped\.current\) return;/);
  assert.match(source, /disabled=\{busy \|\| recoveryBlocked \|\| !recoveryFile\}/);
});
