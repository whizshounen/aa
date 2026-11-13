const test = require('node:test');
const assert = require('node:assert/strict');

const {
  dodgeVector,
  meatRescueOK,
  applySpawnLeash,
  steer,
  diagnoseDeath,
} = require('./steer-policy');

function makeBaseState(overrides = {}) {
  return {
    ok: true,
    state: 'playing',
    time: 100,
    hp: 130,
    maxHp: 130,
    zeny: 0,
    chestsOpened: 0,
    player: { x: 0, y: 0 },
    bounds: { x0: -2000, x1: 2000, y0: -2000, y1: 2000 },
    stats: { speedMult: 1 },
    enemies: [],
    pickups: [],
    fireRings: [],
    projectiles: [],
    bossBrains: [],
    ...overrides,
  };
}

test('dodgeVector finds multi-zone union escape outside active fireRings and imminent boss casts', () => {
  const state = makeBaseState({
    time: 160,
    fireRings: [
      { x: 0, y: 0, r: 90 },
      { x: 110, y: 0, r: 80 },
    ],
    enemies: [{ id: 'eclipse_1', x: 80, y: 0, boss: true, hp: 2000, maxHp: 3400 }],
    bossBrains: [{
      boss: 'eclipse_1',
      phase: 1,
      gcd: 0,
      busyUntil: 0,
      ready: [0.3],
      skills: [{ name: 'Sonic Blow', range: 200 }],
    }],
  });
  const st = { skillReadyAt: {}, prevReady: [0.9], castsExposed: 0 };
  const dg = dodgeVector(state, 0, 0, state.enemies[0], state.bossBrains[0], false, st);

  assert.equal(dg.hard, true);
  assert.ok(dg.reasons.includes('ring'));
  assert.ok(dg.reasons.includes('cast:Sonic Blow'));
  assert.ok(Math.hypot(dg.dx, dg.dy) > 0.9);
  // Should not run directly through the second overlapping fire ring at +X
  assert.ok(dg.dx < 0.5, `Expected dodge away from overlapping +X ring, got dx=${dg.dx}`);
});

test('steer triggers prethin before boss spawn when pack is thick, and breakout with hysteresis during boss fight', () => {
  const swarm = Array.from({ length: 45 }, (_, i) => ({
    id: `m_${i}`,
    x: (i % 5) * 14 + 30,
    y: Math.floor(i / 5) * 14 - 30,
    damage: 4,
    speed: 60,
  }));

  const preBossState = makeBaseState({
    time: 120, // Eclipse at 150 => 30s left <= PRETHIN_WINDOW (40s)
    enemies: swarm,
  });
  const preRes = steer(preBossState, { ranged: false, enableThinning: true, nowMs: 1000 });
  assert.equal(preRes.mode, 'prethin');

  const bossFightState = makeBaseState({
    time: 155,
    enemies: [
      { id: 'eclipse_1', x: 140, y: 0, boss: true, hp: 3400, maxHp: 3400 },
      ...swarm,
    ],
  });
  const st = { ranged: false, enableThinning: true, nowMs: 2000 };
  const breakRes = steer(bossFightState, st);
  assert.equal(breakRes.mode, 'breakout');
  assert.equal(st.inBreakout, true);

  // Hysteresis: even if add moves slightly out (> 100px) but still <= 130px, breakout stays latched
  const midGapState = makeBaseState({
    time: 156,
    enemies: [
      { id: 'eclipse_1', x: 140, y: 0, boss: true, hp: 3400, maxHp: 3400 },
      { id: 'add_1', x: 115, y: 0, damage: 4 },
    ],
  });
  const holdBreak = steer(midGapState, st);
  assert.equal(holdBreak.mode, 'breakout');

  // Once nearest add clears 130px, breakout unlatches back to boss mode
  const clearedState = makeBaseState({
    time: 157,
    enemies: [
      { id: 'eclipse_1', x: 140, y: 0, boss: true, hp: 3400, maxHp: 3400 },
      { id: 'add_1', x: 165, y: 0, damage: 4 },
    ],
  });
  const resumedBoss = steer(clearedState, st);
  assert.equal(resumedBoss.mode, 'boss');
  assert.equal(st.inBreakout, false);
});

test('meatRescueOK allows safe meat runs and denies suicidal pack crossings', () => {
  const safeState = makeBaseState({
    hp: 40,
    maxHp: 130,
    enemies: [{ id: 'far', x: 500, y: 500, damage: 4 }],
  });
  const okCheck = meatRescueOK(safeState, 0, 0, { x: 180, y: 0, kind: 'meat' });
  assert.equal(okCheck.ok, true);

  const lethalSwarm = Array.from({ length: 18 }, (_, i) => ({
    id: `e_${i}`,
    x: 40 + (i % 4) * 10,
    y: -20 + Math.floor(i / 4) * 10,
    damage: 6,
  }));
  const unsafeState = makeBaseState({
    hp: 35,
    maxHp: 130,
    enemies: lethalSwarm,
  });
  const deniedCheck = meatRescueOK(unsafeState, 0, 0, { x: 400, y: 0, kind: 'meat' });
  assert.equal(deniedCheck.ok, false);
});

test('applySpawnLeash preserves emergency/breakout/rescue modes and pulls idle farm back near center', () => {
  const state = makeBaseState({
    player: { x: 900, y: 0 },
  });

  const emer = applySpawnLeash(state, { dx: 1, dy: 0, mode: 'emergency' });
  assert.equal(emer.mode, 'emergency');
  assert.equal(emer.dx, 1);

  const leashed = applySpawnLeash(state, { dx: 1, dy: 0, mode: 'engage' });
  assert.equal(leashed.mode, 'spawn-leash');
  assert.ok(leashed.dx < 0);
});

test('diagnoseDeath distinguishes PACK-CONTACT from SKILL-OVERLAP accurately', () => {
  const contactStats = {
    death: {
      buf: [
        { t: 160, hp: 100, dhp: 0, zones: 0, nearest: 30, imminent: [] },
        { t: 161, hp: 70, dhp: -30, zones: 0, nearest: 12, imminent: [] },
        { t: 162, hp: 40, dhp: -30, zones: 0, nearest: 8, imminent: [] },
        { t: 163, hp: 0, dhp: -40, zones: 0, nearest: 6, imminent: [] },
      ],
    },
  };
  assert.equal(diagnoseDeath(contactStats).verdict, 'PACK-CONTACT');

  const skillStats = {
    death: {
      buf: [
        { t: 210, hp: 120, dhp: 0, zones: 0, nearest: 200, imminent: [] },
        { t: 211, hp: 60, dhp: -60, zones: 2, nearest: 200, imminent: ['Meteor Storm'] },
        { t: 212, hp: 0, dhp: -60, zones: 2, nearest: 200, imminent: ['Meteor Storm'] },
      ],
    },
  };
  const skillDiag = diagnoseDeath(skillStats);
  assert.equal(skillDiag.verdict, 'SKILL-OVERLAP');
  assert.ok(skillDiag.skillsNearDeath.some(s => s.includes('Meteor Storm')));
});
