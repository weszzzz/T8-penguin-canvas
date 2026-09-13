'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { prepareSerialHistoryWarmup, coldHistoryFileWatcherPlugin } = require('../scripts/history-serial-warmup.cjs');

test('serial acceptance warmup retains all configured files and waits for each request without duplicate dispatch', async () => {
  const config = readFileSync(require.resolve('../vite.config.ts'), 'utf8');
  const block = config.match(/warmup:\s*{\s*clientFiles:\s*\[([^\]]+)\]/);
  assert.ok(block); const files = [...block[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.equal(files.length, 6);
  const events = []; let active = 0, maxActive = 0;
  const client = { config: { dev: { warmup: [...files], preTransformRequests: false } }, depsOptimizer: { scanProcessing: Promise.resolve().then(() => events.push('scan')) } };
  const server = { environments: { client }, async transformRequest(url) {
    active++; maxActive = Math.max(maxActive, active); events.push(url); await Promise.resolve(); active--; return { code: 'export {}' };
  }, async waitForRequestsIdle() { assert.equal(active, 0); events.push('idle'); } };
  const warmup = prepareSerialHistoryWarmup(server);
  assert.deepEqual(client.config.dev.warmup, [], 'disable Vite auto fan-out before listen');
  assert.deepEqual(warmup.urls, files.map(file => file.slice(1)));
  await warmup.run(); assert.equal(maxActive, 1);
  assert.deepEqual(events, ['scan', ...warmup.urls, 'idle']);
  const verifier = readFileSync(require.resolve('../scripts/verify-generation-history-full-electron.cjs'), 'utf8');
  assert.ok(verifier.indexOf('const warmup = prepareSerialHistoryWarmup(server)') < verifier.indexOf('await server.listen()'));
  assert.match(verifier, /strictPort: false, preTransformRequests: false/);
});

test('invalid warmup config is unchanged and failed transforms do not start later warmups', async () => {
  for (const configured of [null, ['./src/**/*.tsx'], ['./src/../private.ts'], ['./index.html']]) {
    const client = { config: { dev: { warmup: configured, preTransformRequests: false } } };
    assert.throws(() => prepareSerialHistoryWarmup({ environments: { client } }));
    assert.equal(client.config.dev.warmup, configured);
  }
  const calls = [], server = { environments: { client: { config: { dev: { warmup: ['./src/main.tsx'], preTransformRequests: false } } } },
    async transformRequest(url) { calls.push(url); throw new Error('transform failure'); },
    async waitForRequestsIdle() { throw new Error('should not reach idle'); } };
  await assert.rejects(prepareSerialHistoryWarmup(server).run(), /transform failure/);
  assert.deepEqual(calls, ['/src/main.tsx']);
});

test('bounded warmup stage receipts distinguish scan, serial transforms and idle; observer failure stops work', async () => {
  const events = [];
  let finishScan;
  const server = { environments: { client: {
    config: { dev: { warmup: [], preTransformRequests: false } },
    depsOptimizer: { scanProcessing: new Promise(resolve => { finishScan = resolve; }) },
  } }, async transformRequest(url) { events.push(url); return { code: 'export {}' }; },
    async waitForRequestsIdle() { events.push('idle'); } };
  const warmup = prepareSerialHistoryWarmup(server);
  const pending = warmup.run(stage => events.push(stage));
  assert.deepEqual(events, ['warmup-dependency-scan']);
  finishScan(); await pending;
  assert.deepEqual(events, ['warmup-dependency-scan',
    ...warmup.urls.flatMap((url, index) => [`warmup-entry-${index + 1}`, url]),
    'warmup-waiting-idle', 'idle', 'warmup-complete']);
  events.length = 0;
  await assert.rejects(warmup.run(() => { throw new Error('diagnostics unavailable'); }), /diagnostics unavailable/);
  assert.deepEqual(events, [], 'do not transform after diagnostics fail');
  await assert.rejects(warmup.run(null), /observer must be a function/);
  const verifier = readFileSync(require.resolve('../scripts/verify-generation-history-full-electron.cjs'), 'utf8');
  assert.match(verifier, /warmup\.run\(checkpoint\)/);
});

test('speculative transforms and absent source are rejected before acceptance continues', async () => {
  for (const preTransformRequests of [true, undefined]) {
    const client = { config: { dev: { warmup: ['./src/main.tsx'], preTransformRequests } } };
    assert.throws(() => prepareSerialHistoryWarmup({ environments: { client } }), /speculative/);
    assert.deepEqual(client.config.dev.warmup, ['./src/main.tsx']);
  }
  const server = { environments: { client: { config: { dev: { warmup: [], preTransformRequests: false } } } },
    async transformRequest() { return null; } };
  await assert.rejects(prepareSerialHistoryWarmup(server).run(), /No transformed source/);
});

test('installed Vite fixture proves speculative fan-out is disabled but explicit imports remain transformable', { timeout: 20000 }, async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  // Windows TEMP may use an 8.3 user name; match Vite's realpath-resolved IDs.
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 't8-warmup-unit-')));
  let server;
  try {
    fs.mkdirSync(path.join(root, 'src/components'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/main.tsx'), 'import { value } from "./leaf.js"; export const main = value;');
    fs.writeFileSync(path.join(root, 'src/leaf.js'), 'export const value = 7;');
    fs.writeFileSync(path.join(root, 'src/App.tsx'), 'export const app = 1;');
    fs.writeFileSync(path.join(root, 'src/components/Canvas.tsx'), 'export const canvas = 2;');
    const { createServer, isFileLoadingAllowed, normalizePath } = await import('vite');
    for (const preTransformRequests of [true, false]) {
      const transformed = [];
      server = await createServer({ root, configFile: false, logLevel: 'silent',
        optimizeDeps: { noDiscovery: true, include: [] },
        plugins: [{ name: 'observe-owned-fixture', transform(code, id) {
          if (id.replaceAll('\\', '/').startsWith(root.replaceAll('\\', '/') + '/')) transformed.push(path.basename(id));
        } }],
        server: { middlewareMode: true, watch: null, hmr: false, preTransformRequests, fs: { allow: [root] } } });
      assert.equal(server.environments.client.config.dev.preTransformRequests, preTransformRequests);
      const mainFile = normalizePath(fs.realpathSync.native(path.join(root, 'src/main.tsx')));
      assert.ok(fs.readFileSync(mainFile, 'utf8').includes('leaf.js'));
      assert.ok(isFileLoadingAllowed(server.config, mainFile), JSON.stringify({ root, mainFile, allow: server.config.server.fs.allow }));
      await server.transformRequest('/src/main.tsx');
      await server.waitForRequestsIdle();
      assert.equal(transformed.includes('leaf.js'), preTransformRequests, 'static imports are speculative only when enabled');
      if (!preTransformRequests) {
        await prepareSerialHistoryWarmup(server).run();
        assert.ok(transformed.includes('App.tsx') && transformed.includes('Canvas.tsx'));
        const leaf = await server.transformRequest('/src/leaf.js');
        assert.match(leaf.code, /value = 7/);
        await assert.rejects(server.transformRequest('/src/missing.tsx'), /Failed to load/);
      }
      await server.close(); server = null;
    }
  } finally {
    if (server) await server.close();
    // Only this freshly allocated fixture, never the repository or retained data.
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installed React plugin skips Fast Refresh Babel for cold acceptance while preserving development JSX', { timeout: 20000 }, async () => {
  const fs = require('node:fs'), path = require('node:path');
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 't8-cold-react-unit-')));
  let server;
  try {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src/App.tsx'), 'export default function App(){ const value: string = "cold fixture"; return <div>{value}</div>; }');
    const { createServer } = await import('vite');
    const { default: react } = await import('@vitejs/plugin-react');
    for (const hmr of [true, false]) {
      server = await createServer({ root, configFile: false, logLevel: 'silent', plugins: [react()],
        optimizeDeps: { noDiscovery: true, include: [] },
        resolve: { alias: { 'react/jsx-dev-runtime': require.resolve('react/jsx-dev-runtime') } },
        server: { middlewareMode: true, watch: null, hmr, preTransformRequests: false,
          fs: { allow: [root, path.dirname(require.resolve('react/package.json'))] } } });
      assert.equal(server.config.isProduction, false); assert.equal(server.config.mode, 'development');
      const plugin = server.config.plugins.find(plugin => plugin.name === 'vite:react-babel'); assert.ok(plugin);
      assert.equal(Boolean(plugin.transform), hmr, 'actual installed plugin removes only unnecessary Babel pass');
      const result = await server.transformRequest('/src/App.tsx');
      assert.ok(result?.code.includes('cold fixture')); assert.match(result.code, /jsxDEV/);
      assert.doesNotMatch(result.code, /value: string/);
      assert.equal(result.code.includes('$RefreshReg$'), hmr);
      await server.close(); server = null;
    }
    const verifier = readFileSync(require.resolve('../scripts/verify-generation-history-full-electron.cjs'), 'utf8');
    assert.match(verifier, /preTransformRequests: false, hmr: false/);
    assert.match(verifier, /assert\.equal\(server\.config\.isProduction, false/);
    assert.match(verifier, /assert\.equal\(reactBabel\.transform, undefined/);
  } finally {
    if (server) await server.close();
    // The exact fresh fixture only, with no retained database or user data.
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('HMR off retains a filesystem watcher; cold watch:null retains HTTP source and asset serving without watchers', { timeout: 20000 }, async () => {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 't8-cold-watch-unit-')));
  let server;
  try {
    fs.mkdirSync(path.join(root, 'src'));
    fs.mkdirSync(path.join(root, 'unrelated-runtime'));
    fs.mkdirSync(path.join(root, 'public'));
    fs.writeFileSync(path.join(root, 'src/main.ts'), 'export const value: number = 42;');
    fs.writeFileSync(path.join(root, 'unrelated-runtime/unused.txt'), 'not an application import');
    fs.writeFileSync(path.join(root, 'public/fixture.txt'), 'owned static asset');
    const configFile = path.join(root, 'vite.config.mjs');
    fs.writeFileSync(configFile, 'export default { server: { watch: {} } };');
    const { createServer } = await import('vite');
    const { Agent } = require('undici');
    for (const watch of [{}, null]) {
      server = await createServer({ root, configFile, logLevel: 'silent',
        plugins: watch === null ? [coldHistoryFileWatcherPlugin()] : [],
        optimizeDeps: { noDiscovery: true, include: [] },
        server: { host: '127.0.0.1', port: 0, hmr: false, watch, preTransformRequests: false } });
      if (watch !== null) {
        // OS watch delivery may be unavailable in a temporary directory. Check
        // the actual installed implementation, not readiness/timing of events.
        assert.equal(server.watcher.constructor.name, 'FSWatcher');
      } else {
        assert.equal(server.config.server.watch, null, 'config-file merging cannot re-enable the watcher');
        assert.equal(server.watcher.constructor.name, 'NoopWatcher');
        assert.deepEqual(server.watcher.getWatched(), {});
      }
      await server.listen();
      const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
      // Sequential servers can reuse a port; do not reuse the previous
      // server's pooled keep-alive connection across a deliberate close.
      const dispatcher = new Agent({ connections: 1 });
      try {
        const source = await fetch(`${origin}/src/main.ts`, { dispatcher, headers: { connection: 'close' } });
        assert.equal(source.status, 200); assert.match(await source.text(), /value = 42/);
        const asset = await fetch(`${origin}/fixture.txt`, { dispatcher, headers: { connection: 'close' } });
        assert.equal(asset.status, 200); assert.equal(await asset.text(), 'owned static asset');
      } finally {
        await dispatcher.close();
      }
      if (watch === null) assert.deepEqual(server.watcher.getWatched(), {});
      server.httpServer?.closeAllConnections?.();
      await server.close(); server = null;
    }
    const verifier = readFileSync(require.resolve('../scripts/verify-generation-history-full-electron.cjs'), 'utf8');
    assert.match(verifier, /hmr: false, watch: null/);
  } finally {
    if (server) {
      server.httpServer?.closeAllConnections?.();
      await server.close();
    }
    const relative = path.relative(fs.realpathSync.native(os.tmpdir()), root);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
