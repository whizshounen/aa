const test = require('node:test');
const assert = require('node:assert/strict');

const {
  JOB_DEFS,
  normalizeBuilds,
  planEntryFor,
  wizardScoreCard,
  scoreCard,
} = require('./build-planner');

test('JOB_DEFS defines all four playable jobs including acolyte', () => {
  assert.ok(JOB_DEFS.swordsman);
  assert.ok(JOB_DEFS.archer);
  assert.ok(JOB_DEFS.mage);
  assert.ok(JOB_DEFS.acolyte);
  assert.equal(JOB_DEFS.acolyte.start, 'heal');
});

test('early vs final-boss phase weighting flips priority from AoE to Single-target + Sustain', () => {
  const swordDance = 'Sword Dance Lv 2 · Wide slash AoE';
  const endure = 'Endure Lv 2 · Damage reduction';

  const earlyAoE = scoreCard(swordDance, { job: 'swordsman', elapsedS: 60, liveEnemies: 42, hpFrac: 0.9, level: 4 });
  const earlySustain = scoreCard(endure, { job: 'swordsman', elapsedS: 60, liveEnemies: 42, hpFrac: 0.9, level: 4 });
  assert.ok(earlyAoE.score > earlySustain.score, `Expected early AoE (${earlyAoE.score}) > early Sustain (${earlySustain.score})`);

  const bossSingle = scoreCard('Bash Lv 4 · Heavy single-target strike', { job: 'swordsman', elapsedS: 650, liveEnemies: 10, hpFrac: 0.7, level: 16, bossDueIn: 10 });
  const bossAoE = scoreCard(swordDance, { job: 'swordsman', elapsedS: 650, liveEnemies: 10, hpFrac: 0.7, level: 16, bossDueIn: 10 });
  assert.ok(bossSingle.score > bossAoE.score, `Expected late single-target (${bossSingle.score}) > late AoE (${bossAoE.score})`);
});

test('wizardScoreCard enforces user bans, Fire Bolt Deity supremacy, and skill tiers', () => {
  const deity = wizardScoreCard('Fire Bolt Deity · Scorching Barrage', { job: 'mage', pickType: 'skill', deterministic: true });
  const firebolt = wizardScoreCard('Fire Bolt Lv 2', { job: 'mage', pickType: 'skill', deterministic: true });
  const lightning = wizardScoreCard('Lightning Bolt Lv 2', { job: 'mage', pickType: 'skill', deterministic: true });
  const banned = wizardScoreCard('Firewall Lv 1 · defensive wall', { job: 'mage', pickType: 'skill', deterministic: true });

  assert.equal(deity.score, 1000000);
  assert.ok(firebolt.score > lightning.score);
  assert.equal(banned.score, -1000000);
  assert.deepEqual(banned.hits, ['user-banned']);
});

test('normalizeBuilds and user-defined builds override default heuristic scoring', () => {
  const normalized = normalizeBuilds({
    Acolyte: { cards: ['Magnus Exorcismus', 'Holy Light'], items: ['Healing Staff'] },
  });
  assert.deepEqual(normalized, {
    acolyte: { cards: ['magnus exorcismus', 'holy light'], items: ['healing staff'] },
  });

  const firstPick = scoreCard('Magnus Exorcismus Lv 1', { job: 'acolyte', pickType: 'skill' }, normalized);
  const secondPick = scoreCard('Holy Light Lv 1', { job: 'acolyte', pickType: 'skill' }, normalized);
  const itemPick = scoreCard('Healing Staff +1', { job: 'acolyte', pickType: 'item' }, normalized);

  assert.ok(firstPick.score > secondPick.score);
  assert.equal(firstPick.hits[0], 'user-build:card#1');
  assert.equal(itemPick.hits[0], 'user-build:item#1');
});

test('acolyte skills resolve in SKILL_PLAN and debuff damage words do not inflate debuff cards', () => {
  assert.equal(planEntryFor('Magnus Exorcismus', 'acolyte').id, 'magnus_exorcismus');
  assert.equal(planEntryFor('Kyrie Eleison', 'acolyte').id, 'kyrie_eleison');

  const bash = scoreCard('Bash Lv 1 · +120% damage', { job: 'swordsman', elapsedS: 100, liveEnemies: 20, hpFrac: 0.9, level: 4 });
  const provoke = scoreCard('Provoke · enemies take +damage', { job: 'swordsman', elapsedS: 100, liveEnemies: 20, hpFrac: 0.9, level: 4 });
  assert.ok(bash.score > provoke.score, `Expected Bash (${bash.score}) > Provoke (${provoke.score})`);
});

test('shield bash is always deprioritised without shield requirement met', () => {
  const sb = scoreCard('Shield Bash Lv 1 · +500% damage', { job: 'swordsman', elapsedS: 200, liveEnemies: 15, hpFrac: 0.9 });
  assert.ok(sb.score <= 30);
  assert.ok(sb.hits.includes('needs-shield-deprioritised'));
});
