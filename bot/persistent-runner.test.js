const test = require('node:test');
const assert = require('node:assert/strict');

let runPersistentRuns;
try { ({ runPersistentRuns } = require('./persistent-runner')); } catch {}

function fakeContext(id) {
  let closed = false;
  const handlers = {};
  const page = {
    id,
    on(event, fn) { handlers[event] = fn; },
    isClosed() { return closed; },
    crash() { closed = true; handlers.crash?.(); },
  };
  return {
    page,
    context: {
      pages: () => [page],
      close: async () => { closed = true; },
    },
  };
}

test('relaunches a crashed browser context before trying the next run', async () => {
  assert.equal(typeof runPersistentRuns, 'function', 'persistent runner should expose a testable recovery loop');

  const contexts = [];
  const pageIds = [];
  const results = [];
  const completed = await runPersistentRuns({
    runs: 3,
    launchContext: async () => {
      const c = fakeContext(contexts.length + 1);
      contexts.push(c);
      return c.context;
    },
    runOne: async page => {
      pageIds.push(page.id);
      if (page.id === 1) page.crash();
      return { run: pageIds.length };
    },
    onResult: result => results.push(result),
    sleep: async () => {},
    betweenRunsMs: 0,
    recoveryDelayMs: 0,
    maxConsecutiveCrashes: 3,
  });

  assert.deepEqual(pageIds, [1, 2, 2]);
  assert.equal(contexts.length, 2);
  assert.equal(results.length, 3);
  assert.equal(completed.length, 3);
});
