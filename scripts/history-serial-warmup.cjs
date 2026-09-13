'use strict';
const assert = require('node:assert/strict');

function coldHistoryFileWatcherPlugin() {
  return {
    name: 'cold-history-file-watcher',
    configResolved(config) {
      assert.equal(config.isProduction, false, 'Cold history verification uses development semantics');
      assert.equal(config.server.hmr, false, 'Only disable watching for a cold acceptance run');
      // Vite's config-file merge skips null overrides. Set the resolved option
      // before createServer constructs Chokidar, rather than relying on merge.
      config.server.watch = null;
    },
  };
}

// Call after createServer resolves, before listen starts Vite's unawaited
// warmupFiles loop. Keep the resolved project's entire warmup list: only its
// scheduling changes. Vite/optimizer internals may still perform their own work.
function prepareSerialHistoryWarmup(server) {
  const client = server.environments?.client;
  const configured = client?.config?.dev?.warmup;
  assert.ok(Array.isArray(configured), 'Resolved client warmup list is unavailable');
  assert.equal(client.config.dev.preTransformRequests, false,
    'Serial acceptance warmup requires speculative dependency transforms disabled');
  const files = [...new Set([...configured, './src/main.tsx', './src/App.tsx', './src/components/Canvas.tsx'])];
  // Current project warmup uses explicit source files. Refuse unknown globs,
  // paths or HTML rather than silently skipping work or changing its meaning.
  assert.ok(files.every(file => typeof file === 'string' && /^\.\/src\/[\w/.-]+\.[cm]?[jt]sx?$/.test(file)
    && !file.split('/').includes('..')), 'Serial warmup requires explicit in-project source files');
  const urls = files.map(file => file.slice(1));
  client.config.dev.warmup = [];
  return {
    urls,
    async run(onStage = () => {}) {
      assert.equal(typeof onStage, 'function', 'Warmup stage observer must be a function');
      // Only fixed stage labels/ordinals enter bounded memory diagnostics. This
      // distinguishes dependency scanning from source transforms without dumps.
      onStage('warmup-dependency-scan');
      await client.depsOptimizer?.scanProcessing;
      for (const [index, url] of urls.entries()) {
        onStage(`warmup-entry-${index + 1}`);
        // Vite warmupRequest catches transform failures and only logs them.
        // Explicit transforms must propagate failure before launching Electron.
        const result = await server.transformRequest(url);
        assert.ok(result && typeof result.code === 'string', `No transformed source for ${url}`);
      }
      onStage('warmup-waiting-idle');
      await server.waitForRequestsIdle();
      onStage('warmup-complete');
    },
  };
}
module.exports = { prepareSerialHistoryWarmup, coldHistoryFileWatcherPlugin };
