'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const source = readFileSync(require.resolve('../scripts/run-history-low-load.ps1'), 'utf8');

// Wiring guards only. Physical membership/termination is separately verified
// with the runner's short idle Probe and an independent owned sentinel.
test('native cleanup uses the exact Job and one verified handle, never process names or the whole Job', () => {
  const method = source.slice(source.indexOf('public bool StopOwnedProcess('), source.indexOf('public uint CpuRate'));
  assert.match(method, /pid<=0 \|\| \(uint\)pid==GetCurrentProcessId\(\)/);
  assert.match(method, /IntPtr process=OpenProcess\(0x1000\|0x1,false,\(uint\)pid\)/);
  assert.ok(method.indexOf('if(!Contains(process)) return false;') < method.indexOf('TerminateProcess(process,1)'));
  assert.match(method, /finally \{ CloseHandle\(process\); \}/);
  assert.doesNotMatch(source, /TerminateJobObject|Stop-Process/);
  assert.match(source, /QueryInformationJobObject\(handle,3,memory/);
  assert.match(source, /capacity<=4096/);
});

test('bounded descendant cleanup precedes the receipt and cannot turn forced disposal into success', () => {
  const cleanupStart = source.indexOf('# The synchronous verifier/probe has ended');
  const receipt = source.indexOf('if ($taskReceiptPath)', cleanupStart);
  const cleanup = source.slice(cleanupStart, receipt);
  assert.ok(cleanupStart > source.indexOf("$taskPhase = 'verifier-exited'"));
  assert.match(cleanup, /\$taskCleanupPass -lt 10/);
  assert.match(cleanup, /Where-Object \{ \$_ -ne \$PID \}/);
  assert.match(cleanup, /if \(\$taskExitCode -eq 0\) \{ \$taskExitCode = 1 \}/);
  assert.match(cleanup, /\$taskDescendantExitVerified = \$taskRemainingDescendantCount -eq 0/);
  assert.match(source.slice(receipt), /descendantExitVerified=\$taskDescendantExitVerified; cleanupStatus=\$taskCleanupStatus/);
  assert.ok(source.indexOf('$taskJob.Dispose()', receipt) > receipt);
  assert.match(source, /Orphan cleanup probe requires Probe with exit code 17/);
});
