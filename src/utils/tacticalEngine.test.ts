import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
  TACTICAL_SCENARIOS,
  createScenarioState,
  createRuntimeState,
  steer,
  stepScenarioTick,
} from './tacticalEngine.ts';

const require = createRequire(import.meta.url);
const nodeSteerPolicy = require('../../bot/steer-policy.js');

test('tacticalEngine steer matches bot/steer-policy.js across all preset scenarios', () => {
  for (const spec of TACTICAL_SCENARIOS) {
    const simTs = createScenarioState(spec.id);
    const simJs = structuredClone(simTs);
    const stTs = createRuntimeState({ ranged: spec.defaultRanged, enableThinning: true });
    const stJs = { ranged: spec.defaultRanged, enableThinning: true, nowMs: 0, orbitDir: 1 };

    const outTs = steer(simTs, stTs);
    const outJs = nodeSteerPolicy.steer(simJs, stJs);

    assert.equal(outTs.mode, outJs.mode, `Scenario ${spec.id} mode mismatch`);
    assert.ok(Math.abs(outTs.dx - outJs.dx) < 1e-6, `Scenario ${spec.id} dx mismatch`);
    assert.ok(Math.abs(outTs.dy - outJs.dy) < 1e-6, `Scenario ${spec.id} dy mismatch`);
  }
});

test('eclipse scenario with v6.2 pre-boss thinning survives longer and thins swarm before spawn', () => {
  const withThinning = createScenarioState('eclipse-contact');
  const stThin = createRuntimeState({ enableThinning: true });
  let firstDecision = null;
  for (let i = 0; i < 60; i++) {
    const d = stepScenarioTick(withThinning, stThin, 0.1);
    if (i === 0) firstDecision = d;
  }
  assert.equal(firstDecision?.mode, 'prethin');
  assert.ok(withThinning.hp > 0);
  const liveAfter = withThinning.enemies.filter(e => !e.dead).length;
  assert.ok(liveAfter < 44, `Expected prethin to kill enemies cleanly, live=${liveAfter}`);
});
