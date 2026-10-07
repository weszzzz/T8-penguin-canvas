'use strict';

/**
 * Daily upstream sync for the fork, fail-closed at every step:
 * precheck -> fetch -> divergence -> deletion/protected checks -> keep-local
 * three-way merge -> generated-artifact resolution -> gates -> commit -> push
 * -> remote verification.
 *
 * Usage:
 *   node scripts/upstream-sync.cjs [--dry-run] [--no-push] [--branch=main]
 *                                  [--result=<file>]
 *
 * Classification is one of:
 *   no-sync-needed, dry-run-complete, merged-committed-pushed,
 *   committed-not-pushed, merged-not-committed, gates-failed,
 *   committed-push-failed, conflict-needs-decision, upstream-deletions,
 *   protected-drift, blocked-dirty-worktree, in-progress-merge,
 *   branch-mismatch, fetch-blocked
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const UPSTREAM_REMOTE = 'upstream';
const UPSTREAM_BRANCH = 'main';
const PUSH_REMOTE = 'origin';
const PUSH_BRANCH = 'main';

const PROTECTED_PATHS = [
  'tools/ffmpeg-runtime/ffmpeg.exe',
  'tools/remove-ai-watermarks-runtime/README.md',
];

const GENERATED_TARGET_EXPORT_KEYS = [
  'COMMAND_CATALOG_TARGET',
  'JSON_TARGET',
  'MARKDOWN_TARGET',
  'SURFACES_BACKEND_TARGET',
  'SURFACES_CLI_TARGET',
  'SURFACES_UI_TARGET',
  'SURFACES_SKILL_TARGET',
  'RUNTIME_BACKEND_TARGET',
  'RUNTIME_CLI_TARGET',
  'GRAPH_BACKEND_TARGET',
  'GRAPH_CLI_TARGET',
  'GRAPH_MARKDOWN_TARGET',
];

class SyncError extends Error {
  constructor(classification, message, details = {}) {
    super(message);
    this.classification = classification;
    this.details = details;
  }
}

function parseArgs(argv) {
  const options = { dryRun: false, noPush: false, branch: 'main' };
  for (const item of argv) {
    if (item === '--dry-run') options.dryRun = true;
    else if (item === '--no-push') options.noPush = true;
    else if (item.startsWith('--branch=')) options.branch = item.slice('--branch='.length);
    else if (item.startsWith('--result=')) options.result = path.resolve(item.slice('--result='.length));
    else throw new Error(`unknown argument: ${item}`);
  }
  if (!options.result) options.result = path.join(os.tmpdir(), 't8-upstream-sync-result.json');
  return options;
}

function run(command, args, { input = null } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    input,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, T8_SYNC_GATE: '1' },
  });
  const code = result.error ? -1 : Number.isInteger(result.status) ? result.status : -1;
  return {
    code,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    error: result.error ? String(result.error.message || result.error) : null,
  };
}

function git(args, { allowFailure = false } = {}) {
  const result = run('git', args);
  if (!allowFailure && result.code !== 0) {
    throw new SyncError('git-command-failed', `git ${args.join(' ')} failed`, {
      code: result.code,
      stderr: result.stderr.trim(),
    });
  }
  return result;
}

function gitOk(args) {
  return git(args, { allowFailure: true }).code === 0;
}

function relative(absolutePath) {
  return path.relative(ROOT, absolutePath).split(path.sep).join('/');
}

function generatedTargets() {
  try {
    const generator = require('../tools/zcanvas-cli/scripts/generateCreativeCapabilityArtifacts.cjs');
    return new Set(
      GENERATED_TARGET_EXPORT_KEYS
        .map((key) => generator[key])
        .filter(Boolean)
        .map((target) => relative(target)),
    );
  } catch (error) {
    return { error: String(error?.message || error) };
  }
}

function revParse(revision) {
  return git(['rev-parse', revision]).stdout.trim();
}

function blobId(revision, filePath) {
  const result = git(['rev-parse', `${revision}:${filePath}`], { allowFailure: true });
  return result.code === 0 ? result.stdout.trim() : null;
}

function lines(text) {
  return String(text || '')
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasConflictMarkers(filePath) {
  let content;
  try {
    content = fs.readFileSync(path.join(ROOT, filePath), 'utf8');
  } catch (error) {
    return true;
  }
  return /^(<<<<<<< |>>>>>>> )/mu.test(content);
}

function writeResult(options, payload) {
  fs.mkdirSync(path.dirname(options.result), { recursive: true });
  fs.writeFileSync(options.result, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = {
    schema: 't8-upstream-sync-result-v1',
    root: ROOT,
    startedAt: new Date().toISOString(),
    options,
    upstream: { remote: UPSTREAM_REMOTE, branch: UPSTREAM_BRANCH },
    push: { remote: PUSH_REMOTE, branch: PUSH_BRANCH },
    steps: [],
    classification: null,
    mergeInProgress: false,
  };

  const step = (name, details = {}) => {
    result.steps.push({ name, at: new Date().toISOString(), ...details });
  };

  try {
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
    result.branch = branch;
    result.head = revParse('HEAD');
    step('precheck', { branch, head: result.head });
    if (options.branch && branch !== options.branch) {
      throw new SyncError('branch-mismatch', `expected branch ${options.branch}, found ${branch}`);
    }

    const worktreeCheck = run('npm', ['run', 'worktree:check']);
    if (worktreeCheck.code !== 0) {
      throw new SyncError('worktree-role-failed', 'npm run worktree:check failed', {
        stderr: worktreeCheck.stderr.trim(),
      });
    }

    const mergeHead = fs.existsSync(path.join(ROOT, '.git', 'MERGE_HEAD'));
    const statusShort = git(['status', '--porcelain']).stdout.trim();
    step('state', { mergeHead, dirty: Boolean(statusShort) });
    if (mergeHead) {
      result.mergeInProgress = true;
      throw new SyncError('in-progress-merge', 'a merge is already in progress; inspect it before syncing');
    }
    if (statusShort) {
      throw new SyncError('blocked-dirty-worktree', 'worktree has uncommitted changes', {
        status: lines(statusShort),
      });
    }

    const fetch = run('npm', ['run', 'upstream:fetch']);
    step('fetch', { code: fetch.code, stdout: fetch.stdout.trim(), stderr: fetch.stderr.trim() });
    if (fetch.code !== 0) {
      throw new SyncError('fetch-blocked', 'npm run upstream:fetch failed');
    }

    const upstreamHead = revParse(`${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}`);
    const counts = git(['rev-list', '--left-right', '--count', `HEAD...${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}`])
      .stdout.trim()
      .split(/\s+/u)
      .map((value) => Number(value));
    const [ahead, behind] = counts;
    const base = git(['merge-base', 'HEAD', `${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}`]).stdout.trim();
    result.upstream.head = upstreamHead;
    result.upstream.base = base;
    result.upstream.ahead = ahead;
    result.upstream.behind = behind;
    step('divergence', { upstreamHead, base, ahead, behind });
    if (behind === 0) {
      result.classification = 'no-sync-needed';
      return finish(options, result, 0);
    }

    const withoutRenames = lines(git(['diff', '--diff-filter=D', '--name-status', `${base}..${upstreamHead}`]).stdout);
    const withRenames = lines(git(['diff', '--diff-filter=D', '-M', '--name-status', `${base}..${upstreamHead}`]).stdout);
    result.upstream.deletions = withRenames;
    step('deletions', { exact: withoutRenames, withRenameDetection: withRenames });
    if (withoutRenames.length || withRenames.length) {
      throw new SyncError('upstream-deletions', 'upstream deletes paths that exist locally; human review required', {
        deletions: withRenames,
      });
    }

    const protectedReport = PROTECTED_PATHS.map((filePath) => ({
      path: filePath,
      head: blobId('HEAD', filePath),
      base: blobId(base, filePath),
      upstream: blobId(upstreamHead, filePath),
    }));
    result.protected = protectedReport;
    step('protected', { paths: protectedReport });
    const drifted = protectedReport.filter(
      (entry) => !entry.head || entry.head !== entry.base || entry.head !== entry.upstream,
    );
    if (drifted.length) {
      throw new SyncError('protected-drift', 'protected file content differs between HEAD, base and upstream', {
        drifted,
      });
    }

    if (options.dryRun) {
      result.classification = 'dry-run-complete';
      return finish(options, result, 0);
    }

    git(['config', 'merge.keep-local.driver', 'true']);
    const merge = git(['merge', '--no-commit', '--no-ff', `${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}`], { allowFailure: true });
    result.mergeInProgress = true;
    step('merge', { code: merge.code, stdout: merge.stdout.trim(), stderr: merge.stderr.trim() });

    let conflictPaths = lines(git(['diff', '--name-only', '--diff-filter=U']).stdout);
    const generated = generatedTargets();
    result.generatedTargetCount = generated instanceof Set ? generated.size : 0;
    step('conflicts', { paths: conflictPaths });

    if (conflictPaths.length) {
      if (!(generated instanceof Set)) {
        throw new SyncError('conflict-needs-decision', 'cannot load the generated-artifact target list', {
          conflicts: conflictPaths,
        });
      }
      const unknown = conflictPaths.filter((filePath) => !generated.has(filePath));
      if (unknown.length) {
        throw new SyncError('conflict-needs-decision', 'conflicts outside the generated artifact set', {
          conflicts: conflictPaths,
          unknown,
        });
      }
      const generate = run('npm', ['run', 'feature-sync:generate']);
      step('regenerate', { code: generate.code, stdout: generate.stdout.trim(), stderr: generate.stderr.trim() });
      if (generate.code !== 0) {
        throw new SyncError('conflict-needs-decision', 'generator failed while resolving generated artifacts');
      }
      const marked = conflictPaths.filter((filePath) => hasConflictMarkers(filePath));
      if (marked.length) {
        throw new SyncError('conflict-needs-decision', 'conflict markers remain after regeneration', {
          marked,
        });
      }
      git(['add', '--', ...conflictPaths]);
      conflictPaths = lines(git(['diff', '--name-only', '--diff-filter=U']).stdout);
      if (conflictPaths.length) {
        throw new SyncError('conflict-needs-decision', 'unmerged paths remain after regenerating artifacts', {
          conflicts: conflictPaths,
        });
      }
      step('regenerated', { resolved: generated instanceof Set ? true : false });
    }

    const gateResultPath = path.join(os.tmpdir(), 't8-sync-gates-result.json');
    const gates = run('node', ['scripts/run-sync-gates.cjs', `--out=${gateResultPath}`]);
    step('gates', { code: gates.code, resultPath: gateResultPath });
    if (gates.code !== 0) {
      result.gates = readGateResult(gateResultPath);
      throw new SyncError('gates-failed', 'sync gates failed; merge left staged and uncommitted', {
        resultPath: gateResultPath,
      });
    }
    result.gates = readGateResult(gateResultPath);

    const commit = git(['commit', '--no-edit']);
    const commitSha = revParse('HEAD');
    result.mergeCommit = commitSha;
    result.mergeInProgress = false;
    step('commit', { sha: commitSha, stdout: commit.stdout.trim() });
    result.report = commitReport(base, upstreamHead);

    if (options.noPush) {
      result.classification = 'committed-not-pushed';
      return finish(options, result, 0);
    }

    const push = git(['push', PUSH_REMOTE, PUSH_BRANCH], { allowFailure: true });
    step('push', { code: push.code, stdout: push.stdout.trim(), stderr: push.stderr.trim() });
    if (push.code !== 0) {
      throw new SyncError('committed-push-failed', 'git push origin main failed; local commit is kept');
    }

    const remoteHead = git(['ls-remote', PUSH_REMOTE, `refs/heads/${PUSH_BRANCH}`]).stdout.trim().split(/\s+/u)[0];
    result.remoteHead = remoteHead;
    step('verify-remote', { local: commitSha, remote: remoteHead });
    if (remoteHead !== commitSha) {
      throw new SyncError('committed-push-failed', 'remote origin/main does not match the local merge commit', {
        local: commitSha,
        remote: remoteHead,
      });
    }

    result.classification = 'merged-committed-pushed';
    return finish(options, result, 0);
  } catch (error) {
    const classification = error instanceof SyncError ? error.classification : 'git-command-failed';
    result.classification = classification;
    result.error = { message: String(error?.message || error), details: error?.details || null };
    if (result.mergeInProgress && !result.mergeCommit) {
      result.mergeInProgress = true;
    }
    return finish(options, result, 2);
  }
}

function readGateResult(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

function commitReport(base, upstreamHead) {
  const changed = lines(git(['diff', '--name-status', `${base}..${upstreamHead}`]).stdout);
  const log = git(['log', '--oneline', '--no-merges', `${base}..${upstreamHead}`], { allowFailure: true }).stdout.trim();
  return { changedFiles: changed, commits: lines(log) };
}

function finish(options, result, exitCode) {
  result.finishedAt = new Date().toISOString();
  result.exitCode = exitCode;
  writeResult(options, result);
  process.stdout.write(`[upstream-sync] classification=${result.classification} exit=${exitCode}\n`);
  process.stdout.write(`[upstream-sync] result=${options.result}\n`);
  if (result.mergeInProgress && !result.mergeCommit && result.classification !== 'in-progress-merge') {
    process.stdout.write('[upstream-sync] note: repository is left with an in-progress merge\n');
  }
  return exitCode;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  GENERATED_TARGET_EXPORT_KEYS,
  PROTECTED_PATHS,
  main,
  parseArgs,
};
