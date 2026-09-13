'use strict';

// Verifier-only deadlines. A timeout does not cancel the underlying operation:
// do not retry writes or infer that an application has exited from this result.
async function withDeadline(action, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(action),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: deadline exceeded`)), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}

function installRendererExitRecorder(app, write) {
  const reasons = new Set(['clean-exit', 'abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'integrity-failure']);
  let count = 0;
  const listener = (_event, _contents, details) => {
    if (count++ >= 32) return;
    // Never persist contents URL, native event, process dump or arbitrary text.
    const record = { reason: reasons.has(details?.reason) ? details.reason : 'unknown',
      exitCode: Number.isSafeInteger(details?.exitCode) ? details.exitCode : null };
    try { write(record); } catch { /* Diagnostic I/O must not crash the main process. Missing evidence stays unknown. */ }
  };
  app.on('render-process-gone', listener);
  return () => app.removeListener('render-process-gone', listener);
}

async function whilePageAlive(page, action, label) {
  let crashed, closed;
  const lost = new Promise((_, reject) => {
    crashed = () => reject(new Error(`${label}: renderer crashed`));
    closed = () => reject(new Error(`${label}: page closed`));
    page.once('crash', crashed); page.once('close', closed);
  });
  try {
    if (page.isClosed()) throw new Error(`${label}: page already closed`);
    return await Promise.race([Promise.resolve().then(action), lost]);
  } finally { page.removeListener('crash', crashed); page.removeListener('close', closed); }
}

// Chromium can lose its renderer without delivering Playwright's page crash
// event or resolving a pending locator. Observe the owned main's bounded native
// event record independently. Rejecting the wait does not cancel the action:
// the caller must close/dispose the original owned app before doing more work.
async function withNativeRendererGuard(readRecords, action, intervalMs = 1000, timeoutMs = 300000) {
  const started = Date.now();
  const inspect = () => {
    if (Date.now() - started >= timeoutMs) throw new Error('Native renderer guarded operation deadline exceeded');
    const records = readRecords();
    if (!Array.isArray(records) || records.some(record => !record || typeof record.reason !== 'string'))
      throw new Error('Native renderer diagnostics unavailable');
    const failed = records.find(record => record?.reason !== 'clean-exit');
    if (failed) {
      const reason = ['abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'integrity-failure'].includes(failed.reason)
        ? failed.reason : 'unknown';
      throw new Error(`Native renderer failure observed: ${reason}`);
    }
  };
  inspect(); // An existing native failure must not start another operation.
  let rejectFailure;
  const failure = new Promise((_, reject) => { rejectFailure = reject; });
  const timer = setInterval(() => { try { inspect(); } catch (error) { rejectFailure(error); } }, intervalMs);
  try { return await Promise.race([Promise.resolve().then(action), failure]); }
  finally { clearInterval(timer); }
}

// Serialized into the already-owned Electron main by Playwright. No path
// lookup, process enumeration, shared user data or unrelated app termination.
function exitIsolatedTestMain({ app }, expectedRoot) {
  if (process.env.T8_ACCEPTANCE_LOW_LOAD !== '1' || app.isPackaged
    || !expectedRoot || app.getPath('userData') !== expectedRoot) throw new Error('Isolated test main identity mismatch');
  app.exit(1);
}

module.exports = { withDeadline, installRendererExitRecorder, whilePageAlive, withNativeRendererGuard, exitIsolatedTestMain };
