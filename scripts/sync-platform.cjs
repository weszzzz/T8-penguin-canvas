'use strict';

const { spawnSync } = require('node:child_process');

function buildSyncEnvironment(platform, base = process.env) {
  const env = { ...base };
  if (platform === 'darwin') env.GIT_LFS_SKIP_SMUDGE = '1';
  else delete env.GIT_LFS_SKIP_SMUDGE;
  return env;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status || 1;
  return result.status;
}

function resolveMacFfmpeg() {
  const candidates = [];
  if (process.env.T8_FFMPEG_BIN) candidates.push(process.env.T8_FFMPEG_BIN);
  try {
    candidates.push(require('ffmpeg-static'));
  } catch (_) {
    // Optional package fallback; Homebrew/system ffmpeg remains valid.
  }
  const which = spawnSync('sh', ['-lc', 'command -v ffmpeg'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) candidates.push(which.stdout.trim());
  return candidates.find((candidate) => {
    const probe = spawnSync(candidate, ['-version'], { stdio: 'ignore' });
    return probe.status === 0;
  }) || null;
}

function configureLfs(platform) {
  if (platform === 'darwin') {
    run('git', ['config', '--local', 'lfs.skipSmudge', 'true']);
    return;
  }
  // Windows release worktrees must materialize the protected runtime.
  spawnSync('git', ['config', '--local', '--unset', 'lfs.skipSmudge'], { stdio: 'ignore' });
}

function main() {
  const platform = process.platform;
  configureLfs(platform);
  const status = run('git', ['pull', '--ff-only', 'origin', 'main'], {
    env: buildSyncEnvironment(platform),
  });
  if (status !== 0) return;
  if (platform === 'darwin') {
    const ffmpeg = resolveMacFfmpeg();
    if (!ffmpeg) {
      console.error('[sync-platform] macOS native ffmpeg is unavailable');
      process.exitCode = 1;
      return;
    }
    console.log(`[sync-platform] macOS ffmpeg=${ffmpeg}`);
  }
}

if (require.main === module) main();

module.exports = {
  buildSyncEnvironment,
  resolveMacFfmpeg,
};
