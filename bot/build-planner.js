'use strict';

const JOB_DEFS = {
  swordsman: { re: /swordsman|espadach/i, hp: 130, speed: 150, start: 'bash', basic: 'atk_sword', basicRange: 90, basicDps: 18.8, ranged: false },
  archer: { re: /archer|arquero/i, hp: 95, speed: 165, start: 'double_strafe', basic: 'atk_bow', basicRange: 770, basicDps: 17.3, ranged: true },
  mage: { re: /mage|mago|wizard/i, hp: 80, speed: 145, start: 'firebolt', basic: 'atk_rod', basicRange: 728, basicDps: 14.1, ranged: true },
  acolyte: { re: /acolyte|acólito|priest|sacerdote/i, hp: 105, speed: 150, start: 'heal', basic: 'atk_club', basicRange: 100, basicDps: 13, ranged: true },
};

const SKILL_PLAN = [
  // Swordsman
  { id: 'bash', job: 'swordsman', names: [/bash/i], dps: 120, aoe: 1, role: 'single', phase: 'early', prio: 1, note: 'Primary single-target boss killer' },
  { id: 'magnum', job: 'swordsman', names: [/magnum/i], dps: 45, aoe: 6, role: 'aoe', phase: 'early', prio: 1, note: 'AoE+knockback 260' },
  { id: 'sword_dance', job: 'swordsman', names: [/sword dance|danza de espadas/i], dps: 40, aoe: 8, role: 'aoe', phase: 'early', prio: 2, note: 'AoE 3 ticks r185' },
  { id: 'demoralizing_shout', job: 'swordsman', names: [/demoralizing|desmoral/i], dps: 10, aoe: 3, role: 'debuff', phase: 'mid', prio: 4, note: 'weaken -dmg' },
  { id: 'provoke', job: 'swordsman', names: [/provoke|provoca/i], dps: 0, aoe: 3, role: 'debuff', phase: 'mid', prio: 5, note: 'mark +dmg taken' },
  { id: 'endure', job: 'swordsman', names: [/endure|aguant/i], dps: 0, aoe: 0, role: 'survive', phase: 'late', prio: 6, note: 'dmg reduction' },
  { id: 'hp_recovery', job: 'swordsman', names: [/hp recovery|recuperaci/i], dps: 0, aoe: 0, role: 'survive', phase: 'late', prio: 7, note: 'regen' },
  { id: 'shield_bash', job: 'swordsman', names: [/shield bash|golpe de escudo/i], dps: 0, aoe: 0, role: 'never', phase: 'never', prio: 9, note: 'needs shield' },
  // Archer
  { id: 'double_strafe', job: 'archer', names: [/double strafe|doble/i], dps: 83, aoe: 1, role: 'single', phase: 'early', prio: 1, note: '83 DPS L1, +20%/lvl' },
  { id: 'arrow_shower', job: 'archer', names: [/arrow shower|lluvia de flechas|shower/i], dps: 14, aoe: 6, role: 'aoe', phase: 'early', prio: 2, note: 'cone 60deg r300, 2 volleys' },
  { id: 'blitz_beat', job: 'archer', names: [/blitz beat/i], dps: 30, aoe: 2, role: 'single', phase: 'early', prio: 3, note: 'falcon 3 hits' },
  { id: 'beast_strafing', job: 'archer', names: [/beast strafing|strafing/i], dps: 25, aoe: 1, role: 'single', phase: 'mid', prio: 4, note: 'projectile cd5' },
  { id: 'phantasmic_arrow', job: 'archer', names: [/phantasmic/i], dps: 20, aoe: 3, role: 'aoe', phase: 'mid', prio: 5, note: 'pierce projectile cd9' },
  { id: 'fire_arrow', job: 'archer', names: [/fire arrow/i], dps: 25, aoe: 4, role: 'aoe', phase: 'early', prio: 3, note: 'AoE lobbed arrow, bursts on hit' },
  { id: 'arcane_shot', job: 'archer', names: [/arcane shot/i], dps: 30, aoe: 1, role: 'single', phase: 'mid', prio: 4, note: 'single-target shot' },
  { id: 'arrow_repel', job: 'archer', names: [/arrow repel/i], dps: 15, aoe: 3, role: 'aoe', phase: 'mid', prio: 5, note: 'reactive repel' },
  { id: 'retreat', job: 'archer', names: [/retreat/i], dps: 0, aoe: 0, role: 'survive', phase: 'mid', prio: 6, note: 'leap back + damage on landing' },
  // Mage
  { id: 'firebolt', job: 'mage', names: [/fire ?bolt|fire ?ball|bola de fuego/i], dps: 15, aoe: 1, role: 'single', phase: 'early', prio: 1, note: '15 DPS/bolt, +bolts/lvl' },
  { id: 'soul_strike', job: 'mage', names: [/soul strike/i], dps: 12, aoe: 1, role: 'single', phase: 'early', prio: 2, note: 'count grows, burst 2+' },
  { id: 'sight', job: 'mage', names: [/sight/i], dps: 20, aoe: 2, role: 'orbit', phase: 'early', prio: 3, note: 'orbit flames r88' },
  { id: 'meteor_storm', job: 'mage', names: [/meteor storm|meteor/i], dps: 30, aoe: 6, role: 'aoe', phase: 'early', prio: 2, note: 'AoE ground cd14' },
  { id: 'fire_pillar', job: 'mage', names: [/fire pillar|pilar de fuego/i], dps: 25, aoe: 4, role: 'aoe', phase: 'early', prio: 3, note: 'AoE ground cd9' },
  { id: 'jupitel_thunder', job: 'mage', names: [/jupitel/i], dps: 20, aoe: 1, role: 'single', phase: 'mid', prio: 4, note: 'projectile cd6' },
  { id: 'earth_spike', job: 'mage', names: [/earth spike/i], dps: 20, aoe: 2, role: 'multi', phase: 'mid', prio: 4, note: 'multi cd6' },
  { id: 'frost_nova', job: 'mage', names: [/frost nova/i], dps: 10, aoe: 4, role: 'control', phase: 'mid', prio: 5, note: 'freeze 60% 2s' },
  { id: 'storm_gust', job: 'mage', names: [/storm gust/i], dps: 15, aoe: 4, role: 'control', phase: 'mid', prio: 6, note: 'AoE freeze' },
  { id: 'lord_of_vermilion', job: 'mage', names: [/lord of vermilion|vermilion/i], dps: 30, aoe: 6, role: 'aoe', phase: 'late', prio: 3, note: 'AoE ground cd18' },
  { id: 'energy_coat', job: 'mage', names: [/energy coat/i], dps: 0, aoe: 0, role: 'survive', phase: 'late', prio: 6, note: '-6% dmg taken/rank' },
  { id: 'increase_sp_recovery', job: 'mage', names: [/increase sp recovery|sp recovery/i], dps: 0, aoe: 0, role: 'haste', phase: 'mid', prio: 6, note: '+6% haste/rank' },
  // Acolyte
  { id: 'heal', job: 'acolyte', names: [/\bheal\b|curar/i], dps: 0, aoe: 0, role: 'survive', phase: 'early', prio: 2, note: 'sustain + heal bursts' },
  { id: 'holy_light', job: 'acolyte', names: [/holy light|luz sagrada/i], dps: 48, aoe: 1, role: 'single', phase: 'early', prio: 1, note: 'single-target holy beam' },
  { id: 'magnus_exorcismus', job: 'acolyte', names: [/magnus|exorcismus/i], dps: 34, aoe: 7, role: 'aoe', phase: 'early', prio: 2, note: 'AoE ground sigil' },
  { id: 'ruwach', job: 'acolyte', names: [/ruwach/i], dps: 18, aoe: 3, role: 'orbit', phase: 'early', prio: 3, note: 'orbit pulse' },
  { id: 'blessing', job: 'acolyte', names: [/blessing|bendici/i], dps: 0, aoe: 0, role: 'haste', phase: 'mid', prio: 4, note: 'stat/cast buff' },
  { id: 'kyrie_eleison', job: 'acolyte', names: [/kyrie/i], dps: 0, aoe: 0, role: 'survive', phase: 'late', prio: 5, note: 'barrier shield' },
];

const WIZARD_BANNED = [/napalm/i, /fire ?wall/i, /soul ?strike/i, /frost ?diver/i, /sight/i];
const WIZARD_ARMOR = /armor|armour|defen|shield|plate|mail|guard|resist|coat|robe|vest|helmet|boots|vit|hp|health|barrier/i;
const WIZARD_POWER = /damage|atk|attack|power|might|crit|pierc|sharp|element|magic|str/i;
const WIZARD_SKILL_TIERS = [
  { name: 'firebolt', patterns: [/fire ?bolt|bola de fuego/i] },
  { name: 'thunderstorm', patterns: [/thunder ?storm/i] },
  { name: 'lightning', patterns: [/lightning/i] },
  { name: 'cold', patterns: [/cold/i] },
  { name: 'armor', patterns: [WIZARD_ARMOR] },
  { name: 'power', patterns: [WIZARD_POWER] },
];
const WIZARD_ITEM_TIERS = [
  { name: 'bulwark', patterns: [/bulwark/i] },
  { name: 'armor', patterns: [WIZARD_ARMOR] },
  { name: 'power', patterns: [WIZARD_POWER] },
];

const SCORE_RULES = [
  [/damage|daño|dmg/i, 250, 'damage'], [/flee|huida|esquiva|evasion/i, 220, 'flee'],
  [/crit|crít/i, 150, 'crit'], [/attack speed|velocidad de ataque|aspd/i, 140, 'attack speed'],
  [/cooldown|enfriamiento|recarga/i, 130, 'cooldown'], [/move ?speed|velocidad de movimiento|movement speed/i, 120, 'move speed'],
  [/area|área|radius|radio/i, 100, 'area'], [/projectile|proyectil|extra hit|golpe extra|multishot/i, 110, 'projectiles'],
  [/max hp|hp máx|vida máx|\+ ?\d+ hp/i, 120, 'max hp'], [/armor|armadura|defense|defensa|def\b/i, 90, 'defense'],
  [/discovery|descubrimiento/i, 80, 'discovery (late-game only)'], [/exp|experiencia/i, 60, 'exp'],
  [/zeny/i, 40, 'zeny'], [/luck|suerte/i, 50, 'luck'], [/regen|regener/i, 110, 'regen'], [/lifesteal|robo de vida/i, 100, 'lifesteal'],
];

function normalizeBuilds(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const [job, b] of Object.entries(raw)) {
    if (!b || typeof b !== 'object') continue;
    const cards = Array.isArray(b.cards) ? b.cards.map(s => String(s).trim().toLowerCase()).filter(Boolean) : [];
    const items = Array.isArray(b.items) ? b.items.map(s => String(s).trim().toLowerCase()).filter(Boolean) : [];
    if (cards.length || items.length) out[String(job).toLowerCase()] = { cards, items };
  }
  return Object.keys(out).length ? out : null;
}

function userTierIndex(text, ctx, userBuilds = null) {
  const builds = userBuilds || (ctx && ctx.userBuilds) || null;
  if (!builds) return null;
  const b = builds[String((ctx && ctx.job) || '').toLowerCase()];
  if (!b) return null;
  const list = ctx && ctx.pickType === 'item' ? b.items : b.cards;
  if (!list || !list.length) return null;
  const s = String(text || '').toLowerCase();
  for (let i = 0; i < list.length; i++) {
    const entry = String(list[i] || '').toLowerCase();
    if (entry && s.includes(entry)) return i;
  }
  return null;
}

function planEntryFor(text, job) {
  const t = (text || '').slice(0, 80);
  if (/shield bash|golpe de escudo/i.test(t)) return SKILL_PLAN.find(p => p.id === 'shield_bash');
  for (const p of SKILL_PLAN) if (p.job === job && p.names.some(re => re.test(t))) return p;
  for (const p of SKILL_PLAN) if (p.names.some(re => re.test(t))) return p;
  return null;
}

function wizardScoreCard(text, ctx = {}, userBuilds = null) {
  const name = String(text || '').slice(0, 80);
  const userTier = userTierIndex(name, ctx, userBuilds);
  if (userTier != null) return { score: 1000000 - userTier * 10000, hits: [`user-build:${ctx.pickType === 'item' ? 'item' : 'card'}#${userTier + 1}`], plan: null, isNew: false };
  if (ctx.pickType === 'skill' && WIZARD_BANNED.some(re => re.test(name))) {
    return { score: -1000000, hits: ['user-banned'], plan: null, isNew: false };
  }
  const tiers = ctx.pickType === 'skill' ? WIZARD_SKILL_TIERS : WIZARD_ITEM_TIERS;
  if (/fire\s*bolt\s+deity|deity.{0,20}fire\s*bolt|deidad.{0,24}bola de fuego/i.test(name)) {
    return { score: 1000000, hits: ['user-required:firebolt-deity'], plan: null, isNew: false };
  }
  const tier = tiers.findIndex(t => t.patterns.some(re => re.test(name)));
  if (tier >= 0) return { score: 10000 - tier * 1000, hits: [`user-priority:${tiers[tier].name}`], plan: null, isNew: false };
  return { score: ctx.deterministic ? 50 : Math.random() * 100, hits: ['user-priority:fallback'], plan: null, isNew: false };
}

function scoreCard(text, ctx = {}, userBuilds = null) {
  if (ctx.job === 'mage' && ctx.pickType) return wizardScoreCard(text, ctx, userBuilds);
  const t = (text || '').toLowerCase();
  let score = 0;
  const hits = [];
  const userTier = userTierIndex(text, ctx, userBuilds);
  if (userTier != null) return { score: 1000000 - userTier * 10000, hits: [`user-build:${ctx.pickType === 'item' ? 'item' : 'card'}#${userTier + 1}`], plan: null, isNew: false };

  const isNew = /new!|nuevo|new skill|nueva habilidad|new weapon|nueva arma|desbloquea/i.test(t);
  const plan = planEntryFor(text, ctx.job);
  const owned = plan && ctx.ownedSkills && ctx.ownedSkills.some(s => String(s).toLowerCase().includes(plan.id.replace('_', '')) || String(s).toLowerCase() === plan.id);
  for (const [re, w, note] of SCORE_RULES) {
    if (note === 'damage' && plan && (plan.role === 'debuff' || plan.role === 'control')) continue;
    if (re.test(t)) { score += w; hits.push(note); }
  }
  const live = ctx.liveEnemies || 0;
  const bossDue = ctx.bossDueIn != null && ctx.bossDueIn <= 40;
  const bossPhase = (ctx.elapsedS || 0) >= 600 || !!ctx.masteringActive;
  const masteringDue = ctx.timeToMastering != null && ctx.timeToMastering <= 60;
  let singleMul = 1, aoeMul = 1, sustainMul = 1, discMul = 1, zenyMul = 1;
  if ((ctx.elapsedS || 0) < 150) { aoeMul = 1.3; sustainMul = 0.8; }
  else if ((ctx.elapsedS || 0) < 600) { singleMul = 1.1; sustainMul = 1.2; }
  else { singleMul = 2.0; aoeMul = 0.5; sustainMul = 2.0; discMul = 0.25; zenyMul = 0.5; }
  if (ctx.masteringActive) { singleMul = 2.5; sustainMul = 2.5; aoeMul = 0.3; discMul = 0; zenyMul = 0.5; }

  if (plan) {
    hits.push('plan:' + plan.id);
    if (plan.role === 'never') { score = Math.min(score, 30); hits.push('needs-shield-deprioritised'); }
    else if (plan.role === 'survive') {
      score += Math.round(130 * sustainMul); hits.push('survive-base');
      if (bossDue || ctx.bossActive) { score *= 2.5; hits.push('boss-due-survive-x2.5'); }
      else if ((ctx.hpFrac ?? 1) < 0.5) { score *= 2; hits.push('lowhp-survive-x2'); }
      else if ((ctx.level || 1) >= 6) score += 60;
      if (masteringDue) { score += 150; hits.push('mastering-due-sustain+150'); }
    } else if (plan.role === 'debuff' || plan.role === 'control') {
      score += Math.round((100 + Math.min(60, live * 2)) * (bossPhase ? 1.2 : 1)); hits.push('debuff-control');
      if (bossDue || ctx.bossActive) { score += 60; hits.push('boss-debuff'); }
    } else if (plan.role === 'haste') {
      score += Math.round(140 * (bossPhase ? 1.5 : 1)); hits.push('haste');
    } else {
      const targets = (plan.role === 'aoe' || plan.role === 'multi' || plan.role === 'orbit')
        ? Math.min(plan.aoe || 1, Math.max(1, live / 3))
        : 1;
      let effDps = plan.dps * targets;
      if (plan.role === 'single') { effDps *= singleMul; hits.push('single-x' + singleMul); }
      else { effDps *= aoeMul; if (aoeMul !== 1) hits.push('aoe-x' + aoeMul); }
      if ((bossDue || ctx.bossActive) && plan.role !== 'single') { effDps *= 0.85; hits.push('boss-due-aoe-x0.85'); }
      score += Math.round(effDps * 2); hits.push('dps:' + Math.round(effDps));
    }
    if (isNew && plan.role !== 'never') {
      const slotsFree = ctx.slotsFree == null ? true : ctx.slotsFree > 0;
      if (bossPhase && plan.role === 'aoe') { score -= 100; hits.push('boss-phase-no-new-aoe'); }
      else { score += slotsFree ? Math.max(60, 340 - plan.prio * 30) : -200; hits.push(slotsFree ? 'new-skill-bonus' : 'slots-full'); }
    } else if (owned && plan.role !== 'never') { score += 240; hits.push('upgrade-owned'); }
    if (plan.phase === 'late' && (ctx.level || 1) < 5 && plan.role !== 'survive') score -= 60;
    if (plan.phase === 'early' && (ctx.level || 1) >= 8 && plan.role === 'aoe') score -= 20;
  } else if (isNew) {
    score += 120; hits.push('new-skill-generic');
  }

  const isMeat = /meat|carne/.test(t) && /50|recupera|heal|curar/.test(t);
  if (isMeat) {
    const hpFrac = ctx.hpFrac ?? 1;
    if (hpFrac < 0.35) score = 1000;
    else if (bossDue && hpFrac < 0.75) score = 600;
    else score = hpFrac < 0.6 ? 400 : 5;
    hits.push('meat');
  }
  const lootEarly = (ctx.level || 1) < 8 || (ctx.elapsedS || 0) < 300;
  const isDiscSrc = /surprise|sorpresa|plenty|abundancia|avarice|avaricia|wisdom|sabidur/i.test(t) && /discovery|descubrimiento/.test(t);
  const isZenySrc = /greed|avaricia|plenty|abundancia|avarice|avaricia/.test(t) && /zeny/.test(t);
  const isPickupSrc = /pickup|recogida|recolecci/i.test(t);
  const isDeityCard = /deity|deidad/.test(t);
  if (isDiscSrc) { score += Math.round((lootEarly ? 320 : 180) * discMul); hits.push(lootEarly ? 'loot:discovery-early' : 'loot:discovery'); }
  else if (/discovery|descubrimiento/.test(t)) { score += Math.round((lootEarly ? 120 : 80) * discMul); hits.push('loot:discovery-generic'); }
  if (isZenySrc) { score += Math.round((lootEarly ? 200 : 120) * zenyMul); hits.push('loot:zeny-buys-chests'); }
  if (isPickupSrc) { score += 220; hits.push('loot:pickup-radius'); }
  if (isDeityCard) { score += 80; hits.push('loot:deity-chest-only'); }
  if (/area|área/.test(t) && plan && (plan.role === 'aoe' || plan.role === 'orbit')) { score += 60; hits.push('loot:aoe-more-kills-more-gems'); }
  if (/legendario|legendary/.test(t)) score *= 1.6;
  else if (/épico|epic/.test(t)) score *= 1.35;
  else if (/raro|rare/.test(t)) score *= 1.15;
  return { score: Math.round(score), hits, plan: plan ? plan.id : null, isNew: !!isNew };
}

module.exports = {
  JOB_DEFS,
  SKILL_PLAN,
  WIZARD_BANNED,
  WIZARD_SKILL_TIERS,
  WIZARD_ITEM_TIERS,
  SCORE_RULES,
  normalizeBuilds,
  userTierIndex,
  planEntryFor,
  wizardScoreCard,
  scoreCard,
};
