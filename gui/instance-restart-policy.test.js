const test = require('node:test');
const assert = require('node:assert/strict');

let shouldAutoRestartInstance;
try { ({ shouldAutoRestartInstance } = require('./instance-restart-policy')); } catch {}

test('does not auto-restart an instance stopped by the user', () => {
  assert.equal(typeof shouldAutoRestartInstance, 'function', 'instance restart policy should be testable');
  assert.equal(shouldAutoRestartInstance({ userStopped: true }, { stopping: false, wasStopping: false, finished: false }), false);
});

test('does not double-restart an instance already being reset', () => {
  assert.equal(typeof shouldAutoRestartInstance, 'function', 'instance restart policy should be testable');
  assert.equal(shouldAutoRestartInstance({ restarting: true }, { stopping: false, wasStopping: false, finished: false }), false);
});

test('auto-restarts an unexpected crash', () => {
  assert.equal(typeof shouldAutoRestartInstance, 'function', 'instance restart policy should be testable');
  assert.equal(shouldAutoRestartInstance({}, { stopping: false, wasStopping: false, finished: false }), true);
});

test('does not auto-restart when batch is stopping, was stopping, or already finished', () => {
  assert.equal(shouldAutoRestartInstance({}, { stopping: true, wasStopping: false, finished: false }), false);
  assert.equal(shouldAutoRestartInstance({}, { stopping: false, wasStopping: true, finished: false }), false);
  assert.equal(shouldAutoRestartInstance({}, { stopping: false, wasStopping: false, finished: true }), false);
});
