# RO Survivors bot + GUI handoff

This is a source-only handoff of the current bot and Electron GUI.

## Included

- `bot/bot6.2.js`: active controller, including the current mage/AoE, horde, escape, loot, and route-aware movement logic.
- `bot/movement-policy.js` and regression tests.
- Login-contract and persistent-runner tests.
- `gui/`: Electron dashboard, detached engine, game preloads, launcher, supervisor, styles, and package manifests.
- `rea/patch.py`, `rea/patch_test.py`, and the proxy relay.
- `build/main-Dq84ileb.js`: current unpatched live bundle.
- `rea/patched/main-Dq84ileb.js`: current active patched bundle.
- `rea/patched/bundle.json`: active bundle manifest.
- Historical performance reports under `docs/`.

## Deliberately excluded

Credentials, session tokens, browser authentication/storage state, account files, browser profiles, logs, screenshots, runtime snapshots, caches, `node_modules`, generated engine state, and temporary login probes are not in this archive.

## Running from an extracted copy

From the handoff root:

```bash
cd bot && npm install
cd ../gui && npm install
cd ..
export RO_BOT_PATH="$PWD/bot/bot6.2.js"
export RO_BOT_DIR="$PWD/rea/patched"
cp gui/config.example.json gui/config.json
node --check bot/bot6.2.js
node --test bot/movement-policy.test.js bot/account-login-contract.test.js
python3 rea/patch_test.py
```

Start the dashboard with `gui/launch.sh` after installing Electron. The GUI stores account credentials in its own local app-data files at runtime; none are included here.

If the live game bundle changes, run `python3 rea/patch.py` from the handoff root and re-run the patch tests.

## Known handoff issues

- `bot/persistent-runner.test.js` documents a missing `persistent-runner.js` export.
- `gui/instance-restart-policy.test.js` documents a missing `instance-restart-policy.js` export.

Both tests are included for the next agent to repair; neither is part of the passing smoke-test command above.
