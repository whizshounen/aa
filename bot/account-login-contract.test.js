'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const botPath = path.join(__dirname, 'bot6.2.js');
const source = fs.readFileSync(botPath, 'utf8');

function extractAsyncFunction(name, nextName) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `could not find ${name} in bot6.2.js`);
  const end = source.indexOf(`\nasync function ${nextName}(`, start);
  assert.notEqual(end, -1, `could not find ${nextName} after ${name}`);
  return source.slice(start, end).trim();
}

const attemptAccountLogin = new Function(
  'waitForPlay', 'dismissAccountModal', 'log', 'saveBrowserAuth',
  `return (\n${extractAsyncFunction('attemptAccountLogin', 'loginCamoufox')}\n);`
)(async () => 'play', async () => false, () => {}, async () => {});

const ensureAccountLogin = new Function(
  'ACCOUNT_USER', 'ACCOUNT_PASS', 'attemptAccountLogin', 'log',
  `return (\n${extractAsyncFunction('ensureAccountLogin', 'attemptAccountLogin')}\n);`
)('account-under-test', 'unused-when-session-is-valid', attemptAccountLogin, () => {});

test('an already-signed-in account is accepted by the login handoff', async () => {
  const page = {
    evaluate: async () => true,
    waitForTimeout: async () => {},
  };

  assert.equal(await ensureAccountLogin(page), true);
});
