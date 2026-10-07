'use strict';

/**
 * Runs the required upstream-sync gates in order and writes a machine-readable
 * result file. Long gates (type-check) can then be inspected by reading the
 * result file instead of holding a terminal session open.
 *
 * Usage: node scripts/run-sync-gates.cjs [--out=<file>]
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const GATES = [
  {
    id: 'diff-check',
    command: 'git',
    args: ['diff', '--cached', '--check'],
    label: 'git diff --cached --check',
  },
  {
    id: 'worktree-check',
    command: 'npm',
    args: ['run', 'worktree:check'],
    label: 'npm run worktree:check',
  },
  {
    id: 'feature-sync-check',
    command: 'npm',
    args: ['run', 'feature-sync:check'],
    label: 'npm run feature-sync:check',
  },
  {
    id: 'type-check',
    command: 'npm',
    args: ['run', 'type-check'],
    label: 'npm run type-check',
  },
];

function parseOut(argv) {
  const flag = argv.find((item) => item.startsWith('--out='));
  if (flag) return path.resolve(flag.slice('--out='.length));
  return path.join(os.tmpdir(), 't8-sync-gates-result.json');
}

function tail(value, limit = 4000) {
  const text = String(value || '');
  return text.length > limit ? `…${text.slice(-limit)}` : text;
}

function runGate(gate) {
  const startedAt = Date.now();
  const result = spawnSync(gate.command, gate.args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, T8_SYNC_GATE: '1' },
  });
  const exitCode = result.error ? -1 : Number.isInteger(result.status) ? result.status : -1;
  return {
    id: gate.id,
    label: gate.label,
    exitCode,
    durationMs: Date.now() - startedAt,
    error: result.error ? String(result.error.message || result.error) : null,
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
  };
}

function main(argv = process.argv.slice(2)) {
  const out = parseOut(argv);
  const startedAt = new Date().toISOString();
  const results = [];
  let ok = true;

  for (const gate of GATES) {
    const result = runGate(gate);
    results.push(result);
    const seconds = (result.durationMs / 1000).toFixed(1);
    process.stdout.write(`[sync-gates] ${result.id} exit=${result.exitCode} (${seconds}s)\n`);
    if (result.exitCode !== 0) {
      ok = false;
      process.stdout.write(`${tail(result.stdout)}\n${tail(result.stderr)}\n`);
      break;
    }
  }

  const payload = {
    schema: 't8-sync-gates-result-v1',
    root: ROOT,
    startedAt,
    finishedAt: new Date().toISOString(),
    ok,
    results,
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  process.stdout.write(`[sync-gates] ok=${ok} result=${out}\n`);
  if (!ok) {
    const failed = results.find((item) => item.exitCode !== 0);
    process.stdout.write(`[sync-gates] failed gate: ${failed ? failed.label : 'unknown'}\n`);
  }
  return ok ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  GATES,
  main,
  parseOut,
  runGate,
};
