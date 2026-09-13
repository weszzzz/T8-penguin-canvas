'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

// Execute the real hook with controlled React state/effect scheduling and HTTP.
// No DOM, client, database, media or wall-clock timers are needed.
function harness() {
  const slots = [], effects = [], timers = new Map(), calls = [];
  let cursor = 0, timerId = 0;
  const react = {
    useRef(value) { const id = cursor++; return slots[id] ||= { current: value }; },
    useState(value) {
      const id = cursor++; if (!(id in slots)) slots[id] = typeof value === 'function' ? value() : value;
      return [slots[id], next => { slots[id] = typeof next === 'function' ? next(slots[id]) : next; }];
    },
    useCallback(callback) { cursor++; return callback; },
    useEffect(callback, deps) {
      const id = cursor++, previous = slots[id];
      if (!previous || deps.some((dep, index) => dep !== previous.deps[index])) {
        const state = { deps, cleanup: previous?.cleanup }; slots[id] = state;
        effects.push(() => { state.cleanup?.(); state.cleanup = callback(); });
      }
    },
  };
  const api = { listGenerationHistory(query, options) {
    return new Promise((resolve, reject) => calls.push({ query, options, resolve, reject }));
  } };
  const source = fs.readFileSync(require.resolve('../src/hooks/useGenerationHistory.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'window', compiled)(id => {
    if (id === 'react') return react;
    if (id === '../services/api') return api;
    throw new Error(`Unexpected hook dependency ${id}`);
  }, module, module.exports, {
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  return {
    calls,
    render(refresh = 'v1', query = { projectId: 'p', canvasId: 'c' }) {
      cursor = 0; return module.exports.useGenerationHistory(query, refresh);
    },
    effects() { for (const effect of effects.splice(0)) effect(); },
    timers() { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } },
  };
}
const page = (id, nextCursor) => ({ groups: [{ id }], counts: { all: 3 }, total: 3, nextCursor });
async function loaded() {
  const h = harness(); h.render(); h.effects(); h.timers();
  h.calls[0].resolve(page('newest', 'older')); await Promise.resolve();
  return h;
}

test('history pagination sends one request for repeated invocation before React renders loading', async () => {
  const h = await loaded(), view = h.render();
  const first = view.loadMore(), second = view.loadMore();
  assert.equal(h.calls.length, 2, 'one first page and exactly one older-page request');
  h.calls[1].resolve(page('older', null)); await Promise.all([first, second]);
  assert.deepEqual(h.render().page.groups.map(group => group.id), ['newest', 'older']);
});

test('old pagination callback cannot borrow a refreshed controller and append an obsolete cursor', async () => {
  const h = await loaded(), oldView = h.render();
  h.render('v2'); h.effects(); h.timers();
  h.calls[1].resolve(page('latest-after-refresh', 'fresh-cursor')); await Promise.resolve();
  const stale = oldView.loadMore();
  assert.equal(h.calls.length, 2, 'stale callback must not send old cursor using new controller');
  await stale;
  const current = h.render('v2'), request = current.loadMore();
  assert.equal(h.calls[2].query.cursor, 'fresh-cursor');
  h.calls[2].resolve(page('fresh-older', null)); await request;
  assert.deepEqual(h.render('v2').page.groups.map(group => group.id), ['latest-after-refresh', 'fresh-older']);
});

test('late older-page response after refresh cannot replace the refreshed first page', async () => {
  const h = await loaded(), pending = h.render().loadMore();
  h.render('v2'); h.effects(); h.timers();
  assert.equal(h.calls[1].options.signal.aborted, true);
  h.calls[2].resolve(page('latest-after-refresh', 'fresh-cursor')); await Promise.resolve();
  h.calls[1].resolve(page('stale-older', null)); await pending;
  assert.deepEqual(h.render('v2').page.groups.map(group => group.id), ['latest-after-refresh']);
});

test('failed page unlocks retry while retaining the existing records and cursor', async () => {
  const h = await loaded(), pending = h.render().loadMore();
  h.calls[1].reject(new Error('offline')); await pending;
  const failed = h.render();
  assert.equal(failed.loading, false); assert.equal(failed.error, 'offline');
  assert.deepEqual(failed.page.groups.map(group => group.id), ['newest']);
  const retry = failed.loadMore(); assert.equal(h.calls[2].query.cursor, 'older');
  h.calls[2].resolve({ ...page('older', null), groups: [{ id: 'newest' }, { id: 'older' }] }); await retry;
  assert.deepEqual(h.render().page.groups.map(group => group.id), ['newest', 'older']);
});

test('scope change hides old records immediately and rejects old response before effect cleanup', async () => {
  const h = await loaded(), pending = h.render().loadMore();
  const nextQuery = { projectId: 'other', canvasId: 'other' }, view = h.render('v1', nextQuery);
  assert.equal(view.page, undefined); assert.equal(view.loading, true);
  h.calls[1].resolve(page('wrong-scope', null)); await pending;
  assert.equal(h.render('v1', nextQuery).page, undefined);
  h.effects(); h.timers();
  h.calls[2].resolve(page('correct-scope', null)); await Promise.resolve();
  assert.deepEqual(h.render('v1', nextQuery).page.groups.map(group => group.id), ['correct-scope']);
});

test('old pending request cannot release a refreshed pagination lock', async () => {
  const h = await loaded(), old = h.render().loadMore();
  h.render('v2'); h.effects(); h.timers();
  h.calls[2].resolve(page('fresh', 'fresh-older')); await Promise.resolve();
  const view = h.render('v2'), current = view.loadMore();
  h.calls[1].resolve(page('stale', null)); await old;
  await view.loadMore(); assert.equal(h.calls.length, 4);
  h.calls[3].resolve(page('fresh-older', null)); await current;
  assert.deepEqual(h.render('v2').page.groups.map(group => group.id), ['fresh', 'fresh-older']);
});
