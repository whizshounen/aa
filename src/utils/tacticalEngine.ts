export interface SimEnemy {
  id: string;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  boss?: boolean;
  elite?: boolean;
  dead?: boolean;
}

export interface SimPickup {
  id: string;
  x: number;
  y: number;
  kind: 'meat' | 'magnet' | 'chest' | 'loot' | 'card' | 'egg' | 'gem_blue' | 'gem_yellow' | 'gem_red';
  value?: number;
  quality?: number;
}

export interface SimFireRing {
  x: number;
  y: number;
  r: number;
  ttl?: number;
}

export interface SimProjectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface SimBossBrain {
  boss: string;
  phase: number;
  gcd: number;
  busyUntil: number;
  ready: number[];
  skills: Array<{ name: string; range: number; cd: number }>;
}

export interface SimState {
  ok: boolean;
  state: 'playing' | 'levelup' | 'over';
  time: number;
  hp: number;
  maxHp: number;
  zeny: number;
  chestsOpened: number;
  player: { x: number; y: number };
  bounds: { x0: number; x1: number; y0: number; y1: number };
  stats: { speedMult: number };
  enemies: SimEnemy[];
  pickups: SimPickup[];
  fireRings: SimFireRing[];
  projectiles: SimProjectile[];
  bossBrains: SimBossBrain[];
  bossSchedule?: Array<{ t: number; id: string }>;
  nextHordeAt?: number;
  lootUntil?: number;
  finalBossDefeated?: boolean;
}

export interface SteerRuntimeState {
  ranged: boolean;
  enableThinning: boolean;
  orbitDir: number;
  nowMs: number;
  inBreakout: boolean;
  escapeDir: { dx: number; dy: number } | null;
  escapeUntil: number;
  skillReadyAt: Record<number, number>;
  prevReady: number[];
  castsExposed: number;
  dodges: number;
  hardDodges: number;
  rescuesAttempted: number;
  rescueDenied: number;
  modeTicks: Record<string, number>;
}

export interface SteerDecision {
  dx: number;
  dy: number;
  nearest: number | null;
  nearestAdd: number | null;
  nearestBoss: number | null;
  nNear: number;
  nEnemies: number;
  nPickups: number;
  hpFrac: number;
  mode: string;
  thinReady: boolean;
  timeToBoss: number | null;
  timeToHorde: number | null;
  bossId: string | null;
  bossHp: number | null;
  bossMaxHp: number | null;
  bossBusy: boolean;
  nearestElite: number | null;
  bestPickup: { kind: string; d: number; w: number } | null;
  dodge: { reasons: string[]; hard: boolean };
  rescue: { denied?: boolean; d: number; tReach?: number; projected: number } | null;
  castsExposed: number;
  dodges: number;
  nearestMeat: number | null;
  mastering: boolean;
}

const FALLBACK_BOSS_TIMES = [150, 300, 450, 600, 720];
const SWORD_MIN = 55;
const SWORD_MAX = 95;
const SWARM_R = 260;
const FLEE_HP = 0.35;
const THIN_N = 40;
const EMERG_N = 55;
const EMERG_NEAR = 25;
const PRETHIN_WINDOW = 40;
const THIN_LIVE = 40;
const THIN_NEAR = 100;
const BOSS_MAX_SKILL_RANGE = 700;
const ESCAPE_DISTANCE = 320;
const ESCAPE_HOLD_MS = 4000;
const HORDE_PREP_WINDOW = 18;
const MEAT_RESCUE_RANGE = 1300;
const SPAWN_FARM_RADIUS = 500;
const VALUABLE_LOOT_RADIUS = 1500;

export function hordeThreatAt(s: SimState, x: number, y: number) {
  let n = 0;
  let dmg = 0;
  let near = Infinity;
  for (const e of s.enemies || []) {
    if (!e || e.dead) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < near) near = d;
    if (d < 220) {
      n++;
      dmg += e.damage || 4;
    }
  }
  return { n, dmg, near };
}

export function pathThreat(s: SimState, px: number, py: number, ux: number, uy: number) {
  let maxN = 0;
  let maxDmg = 0;
  let minNear = Infinity;
  let sumN = 0;
  for (const distance of [80, 160, 240, ESCAPE_DISTANCE]) {
    const threat = hordeThreatAt(s, px + ux * distance, py + uy * distance);
    maxN = Math.max(maxN, threat.n);
    maxDmg = Math.max(maxDmg, threat.dmg);
    minNear = Math.min(minNear, threat.near);
    sumN += threat.n;
  }
  return { maxN, maxDmg, minNear, sumN };
}

export function gapDir(s: SimState, px: number, py: number, nDirs = 16, bossE: SimEnemy | null = null) {
  const b = s.bounds;
  let best: { dx: number; dy: number; score: number } | null = null;
  for (let k = 0; k < nDirs; k++) {
    const a = (k * Math.PI * 2) / nDirs;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    let cone = 0;
    let coneMin = Infinity;
    for (const e of s.enemies || []) {
      if (!e || e.dead) continue;
      const rx = e.x - px;
      const ry = e.y - py;
      const d = Math.hypot(rx, ry) || 1;
      if (d > 260) continue;
      const along = (rx * ux + ry * uy) / d;
      if (along > 0.5) {
        cone++;
        if (d < coneMin) coneMin = d;
      }
    }

    const route = pathThreat(s, px, py, ux, uy);
    const destination = hordeThreatAt(s, px + ux * ESCAPE_DISTANCE, py + uy * ESCAPE_DISTANCE);
    let score = route.sumN * 18 + route.maxN * 42 + route.maxDmg * 1.5;
    score += destination.n * 35 + Math.max(0, 180 - destination.near) * 3;
    score += cone * 12 + (coneMin === Infinity ? 0 : Math.max(0, 220 - coneMin));
    if (route.minNear < 45) score += 180;

    if (bossE) {
      const bdx = px + ux * 200 - bossE.x;
      const bdy = py + uy * 200 - bossE.y;
      if (Math.hypot(bdx, bdy) < BOSS_MAX_SKILL_RANGE) score += 200;
    }
    if (b) {
      const ex = px + ux * ESCAPE_DISTANCE;
      const ey = py + uy * ESCAPE_DISTANCE;
      if (ex < b.x0 + 150 || ex > b.x1 - 150 || ey < b.y0 + 150 || ey > b.y1 - 150) score += 120;
    }
    if (!best || score < best.score) best = { dx: ux, dy: uy, score };
  }
  return best || { dx: 1, dy: 0, score: 0 };
}

function isValuablePickup(p: SimPickup) {
  if (!p) return false;
  if (p.kind === 'magnet' || p.kind === 'loot' || p.kind === 'card' || p.kind === 'egg' || p.kind === 'chest') return true;
  return Number(p.quality || 0) >= 3;
}

function nextBossTime(s: SimState, now: number) {
  const live = Array.isArray(s.bossSchedule)
    ? s.bossSchedule.map(b => Number(b.t)).filter(t => Number.isFinite(t) && t >= 0).sort((a, b) => a - b)
    : [];
  const list = live.length ? live : FALLBACK_BOSS_TIMES;
  return list.find(t => t > now) ?? null;
}

export function meatRescueOK(s: SimState, px: number, py: number, meat: SimPickup) {
  const d = Math.hypot(meat.x - px, meat.y - py);
  const speed = 150 * ((s.stats && s.stats.speedMult) || 1);
  const tReach = d / (speed * 0.85);
  let incoming = 0;
  for (const e of s.enemies || []) {
    if (e.dead) continue;
    const ed = Math.hypot(e.x - px, e.y - py);
    if (ed < 180) incoming += e.damage || 4;
  }
  const bossE = (s.enemies || []).find(e => !e.dead && e.boss);
  if (bossE) {
    const bd = Math.hypot(bossE.x - px, bossE.y - py);
    const bb = s.bossBrains ? s.bossBrains.find(b => b.boss === bossE.id) : null;
    if (bb && bd < 650 && bb.ready.length && Math.min(...bb.ready) < 2) {
      incoming += 25 / Math.max(tReach, 0.5);
    }
  }
  const projected = s.hp - incoming * tReach;
  const floor = Math.max(20, 0.12 * s.maxHp);
  return {
    ok: projected > floor,
    tReach: +tReach.toFixed(1),
    projected: Math.round(projected),
    floor,
    incoming: Math.round(incoming),
  };
}

function zonesAtPoint(x: number, y: number, zones: Array<{ x: number; y: number; r: number; w: number; kind: string }>) {
  let n = 0;
  let w = 0;
  const kinds: string[] = [];
  for (const z of zones) {
    if (Math.hypot(x - z.x, y - z.y) < z.r) {
      n++;
      w += z.w;
      if (!kinds.includes(z.kind)) kinds.push(z.kind);
    }
  }
  return { n, w, kinds };
}

function sampleSafeDir(
  s: SimState,
  px: number,
  py: number,
  zones: Array<{ x: number; y: number; r: number; w: number; kind: string }>,
  imminent: Array<{ name: string; range: number }>,
  bossE: SimEnemy | null,
) {
  const cands = [{ x: px, y: py, dist: 0 }];
  for (let k = 0; k < 16; k++) {
    const a = (k * Math.PI * 2) / 16;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    for (const dist of [120, 220, 340]) cands.push({ x: px + ux * dist, y: py + uy * dist, dist });
  }
  let best: { x: number; y: number; dist: number; score: number; zones: number } | null = null;
  for (const c of cands) {
    let z = 0;
    for (const zn of zones) {
      if (Math.hypot(c.x - zn.x, c.y - zn.y) < zn.r + 30) z += zn.w;
    }
    if (imminent.length && Math.hypot(c.x - px, c.y - py) < 130) z += 2;
    for (const pr of s.projectiles || []) {
      const pvx = pr.vx || 0;
      const pvy = pr.vy || 0;
      const ps = Math.hypot(pvx, pvy);
      if (!ps) continue;
      const rx = c.x - pr.x;
      const ry = c.y - pr.y;
      const tca = Math.max(0, -(rx * pvx + ry * pvy) / (ps * ps));
      const cd = Math.hypot(c.x - (pr.x + pvx * tca), c.y - (pr.y + pvy * tca));
      if (cd < 45 && tca < 1.2) z += 2;
    }
    let pack = 0;
    for (const e of s.enemies || []) {
      if (!e.dead && Math.hypot(e.x - c.x, e.y - c.y) < 60) pack++;
    }
    let bossPen = 0;
    let radialPen = 0;
    if (bossE) {
      const bd = Math.hypot(c.x - bossE.x, c.y - bossE.y);
      bossPen = bd > 150 ? (bd - 150) / 150 : bd < 40 ? 0.5 : 0;
      if (imminent.length) {
        const bdx = px - bossE.x;
        const bdy = py - bossE.y;
        const bdd = Math.hypot(bdx, bdy) || 1;
        const mx = c.x - px;
        const my = c.y - py;
        const md = Math.hypot(mx, my) || 1;
        radialPen = Math.abs((mx / md) * (bdx / bdd) + (my / md) * (bdy / bdd)) * 5;
      }
    }
    const score = z * 10 + pack * 2 + bossPen + radialPen + c.dist * 0.001;
    if (!best || score < best.score) best = { x: c.x, y: c.y, dist: c.dist, score, zones: z };
  }
  return best || { x: px, y: py, dist: 0, score: 0, zones: 0 };
}

export function dodgeVector(
  s: SimState,
  px: number,
  py: number,
  bossE: SimEnemy | null,
  bossBrain: SimBossBrain | null,
  st: SteerRuntimeState,
) {
  let dx = 0;
  let dy = 0;
  let hard = false;
  const reasons: string[] = [];
  const zones: Array<{ x: number; y: number; r: number; w: number; kind: string }> = [];
  for (const r of s.fireRings || []) zones.push({ x: r.x, y: r.y, r: r.r + 20, w: 3, kind: 'ring' });
  const imminent: Array<{ name: string; range: number }> = [];
  let driftX = 0;
  let driftY = 0;

  if (bossE && bossBrain && bossBrain.ready) {
    const bdx = px - bossE.x;
    const bdy = py - bossE.y;
    const bd = Math.hypot(bdx, bdy) || 1;
    bossBrain.skills.forEach((sk, i) => {
      const rdy = bossBrain.ready[i];
      if (rdy == null) return;
      if (rdy > 2) {
        delete st.skillReadyAt[i];
        return;
      }
      if (rdy <= 0.7 && bd <= sk.range + 80) {
        if (st.skillReadyAt[i] == null) st.skillReadyAt[i] = s.time;
        const sinceReady = s.time - st.skillReadyAt[i];
        if (sinceReady <= 1.5) {
          imminent.push({ name: sk.name, range: sk.range });
          reasons.push('cast:' + sk.name);
        } else if (bd > 150) {
          driftX += (bdx / bd) * 0.8;
          driftY += (bdy / bd) * 0.8;
          reasons.push('precast:' + sk.name);
        }
      } else if (rdy <= 1.5 && bd <= sk.range * 0.6 && bd > 150) {
        driftX += (bdx / bd) * 0.8;
        driftY += (bdy / bd) * 0.8;
        reasons.push('precast:' + sk.name);
      }
      const prev = st.prevReady || [];
      if (prev[i] != null && prev[i] > 0.5 && rdy <= 0.5 && bd <= (sk.range || 650) + 80) {
        st.castsExposed++;
      }
    });
    st.prevReady = bossBrain.ready.slice();
  }

  let projDanger = false;
  for (const pr of s.projectiles || []) {
    const rx = px - pr.x;
    const ry = py - pr.y;
    const pvx = pr.vx || 0;
    const pvy = pr.vy || 0;
    const ps = Math.hypot(pvx, pvy);
    if (!ps) continue;
    const tca = Math.max(0, -(rx * pvx + ry * pvy) / (ps * ps));
    const cd = Math.hypot(px - (pr.x + pvx * tca), py - (pr.y + pvy * tca));
    if (cd < 45 && tca < 1.2) {
      projDanger = true;
      reasons.push('proj');
    }
  }

  const here = zonesAtPoint(px, py, zones);
  for (const k of here.kinds) if (!reasons.includes(k)) reasons.push(k);
  const nearZone = zones.some(z => Math.hypot(px - z.x, py - z.y) < z.r + 90);
  if (here.n > 0 || imminent.length > 0 || projDanger || nearZone) {
    const best = sampleSafeDir(s, px, py, zones, imminent, bossE);
    const bx = best.x - px;
    const by = best.y - py;
    const bd = Math.hypot(bx, by);
    if (bd > 5) {
      dx = bx / bd;
      dy = by / bd;
    } else {
      dx = driftX;
      dy = driftY;
    }
    hard = here.n > 0 || imminent.length > 0 || projDanger;
    if (best.zones === 0 && here.n > 0) reasons.push('union:safe');
  } else {
    dx = driftX;
    dy = driftY;
  }
  return { dx, dy, hard, reasons };
}

function engageBand(px: number, py: number, e: SimEnemy, d: number, nNear: number, cx: number, cy: number, nSwarm: number, dir: number) {
  const sp = e.speed || 60;
  const ex = e.x + ((px - e.x) / (d || 1)) * sp * 0.3;
  const ey = e.y + ((py - e.y) / (d || 1)) * sp * 0.3;
  const ax = ex - px;
  const ay = ey - py;
  const ad = Math.hypot(ax, ay) || 1;
  let vx = 0;
  let vy = 0;
  if (d > 100) {
    vx = ax / ad;
    vy = ay / ad;
  } else if (d < SWORD_MIN) {
    vx = (-ax / ad) * 0.7 + (-ay / ad) * 0.8;
    vy = (-ay / ad) * 0.7 + (ax / ad) * 0.8;
  } else {
    vx = (-ay / ad) * dir;
    vy = (ax / ad) * dir;
  }
  if (nNear >= 2 && d <= 130 && nSwarm > 0) {
    const gx = cx / nSwarm - px;
    const gy = cy / nSwarm - py;
    const gd = Math.hypot(gx, gy) || 1;
    vx += (gx / gd) * 0.35;
    vy += (gy / gd) * 0.35;
  }
  return { vx, vy };
}

function heldGapDir(s: SimState, px: number, py: number, bossE: SimEnemy | null, st: SteerRuntimeState) {
  if (st.escapeDir && st.nowMs < st.escapeUntil) return st.escapeDir;
  const g = gapDir(s, px, py, 16, bossE);
  st.escapeDir = { dx: g.dx, dy: g.dy };
  st.escapeUntil = st.nowMs + ESCAPE_HOLD_MS;
  return st.escapeDir;
}

export function createRuntimeState(opts: { ranged?: boolean; enableThinning?: boolean } = {}): SteerRuntimeState {
  return {
    ranged: Boolean(opts.ranged),
    enableThinning: opts.enableThinning !== false,
    orbitDir: 1,
    nowMs: 0,
    inBreakout: false,
    escapeDir: null,
    escapeUntil: 0,
    skillReadyAt: {},
    prevReady: [],
    castsExposed: 0,
    dodges: 0,
    hardDodges: 0,
    rescuesAttempted: 0,
    rescueDenied: 0,
    modeTicks: {},
  };
}

export function steer(s: SimState, st: SteerRuntimeState): SteerDecision {
  const px = s.player.x;
  const py = s.player.y;
  const ranged = st.ranged;
  const enableThinning = st.enableThinning;
  let vx = 0;
  let vy = 0;
  let nearest = Infinity;
  let nearestE: SimEnemy | null = null;
  let nearestBoss = Infinity;
  let nearestBossE: SimEnemy | null = null;
  let nNear = 0;
  let nearestElite = Infinity;
  let nearestEliteE: SimEnemy | null = null;
  let nearestAdd = Infinity;
  let nearestAddE: SimEnemy | null = null;
  let cx = 0;
  let cy = 0;
  let nSwarm = 0;

  for (const e of s.enemies || []) {
    if (!e || e.dead) continue;
    const d = Math.hypot(px - e.x, py - e.y) || 1;
    if (d < nearest) { nearest = d; nearestE = e; }
    if (e.boss && d < nearestBoss) { nearestBoss = d; nearestBossE = e; }
    if (!e.boss && d < nearestAdd) { nearestAdd = d; nearestAddE = e; }
    if (e.elite && !e.boss && d < nearestElite) { nearestElite = d; nearestEliteE = e; }
    if (d < SWARM_R) { nNear++; cx += e.x; cy += e.y; nSwarm++; }
  }

  const hpFrac = s.maxHp ? s.hp / s.maxHp : 1;
  const live = (s.enemies || []).filter(e => e && !e.dead).length;
  const bossActive = Boolean(nearestBossE);
  const bossBrain = bossActive && nearestBossE ? s.bossBrains.find(bb => bb.boss === nearestBossE!.id) || null : null;
  const bossBusy = Boolean(bossBrain && bossBrain.busyUntil > s.time);
  const mastering = Boolean(nearestBossE && /mastering/i.test(nearestBossE.id || ''));

  let nearestMeat: SimPickup | null = null;
  let nearestMeatD = Infinity;
  for (const p of s.pickups || []) {
    if (p.kind !== 'meat') continue;
    const d = Math.hypot(p.x - px, p.y - py);
    if (d < nearestMeatD) { nearestMeatD = d; nearestMeat = p; }
  }

  const dg = dodgeVector(s, px, py, nearestBossE, bossBrain, st);
  if (dg.reasons.length) {
    st.dodges++;
    if (dg.hard) st.hardDodges++;
  }

  let rescue: { meat: SimPickup; d: number; ok: boolean; tReach: number; projected: number } | null = null;
  let rescueDenied: { d: number; projected: number } | null = null;
  if (hpFrac < 0.5 && nearestMeat && nearestMeatD <= MEAT_RESCUE_RANGE) {
    const chk = meatRescueOK(s, px, py, nearestMeat);
    if (chk.ok) {
      rescue = { meat: nearestMeat, d: nearestMeatD, ...chk };
      st.rescuesAttempted++;
    } else {
      rescueDenied = { d: Math.round(nearestMeatD), projected: chk.projected };
      st.rescueDenied++;
    }
  }

  const nextBossT = nextBossTime(s, s.time);
  const timeToBoss = nextBossT != null ? nextBossT - s.time : null;
  const preBossWindow = enableThinning && timeToBoss != null && timeToBoss <= PRETHIN_WINDOW;
  const timeToHorde = Number.isFinite(Number(s.nextHordeAt)) && Number(s.nextHordeAt) > s.time
    ? Number(s.nextHordeAt) - s.time
    : null;
  const hordeWindow = timeToHorde != null && timeToHorde <= HORDE_PREP_WINDOW;
  const thickPack = enableThinning && live > THIN_LIVE && nearestAdd < THIN_NEAR;
  const thinReady = live < THIN_LIVE && nearestAdd >= THIN_NEAR;

  if (st.inBreakout && nearestAdd > 130) st.inBreakout = false;
  if (bossActive && thickPack) st.inBreakout = true;

  let mode = ranged ? 'kite' : 'engage';
  if (rescue && !dg.hard) mode = 'rescue';
  else if (bossActive && (thickPack || st.inBreakout)) mode = 'breakout';
  else if (bossActive) mode = mastering ? 'mastering' : 'boss';
  else if (live >= EMERG_N || nearest < EMERG_NEAR || (ranged && nearest < 150) || (hpFrac < FLEE_HP && nearest < 200)) mode = 'emergency';
  else if (hordeWindow) mode = 'horde-prep';
  else if (preBossWindow && (live >= THIN_LIVE || nearestAdd < THIN_NEAR)) mode = 'prethin';
  else if (live >= THIN_N) mode = 'thin';

  if (mode === 'rescue' && rescue) {
    const mdx = rescue.meat.x - px;
    const mdy = rescue.meat.y - py;
    const md = Math.hypot(mdx, mdy) || 1;
    vx = (mdx / md) * 1.6;
    vy = (mdy / md) * 1.6;
  } else if (mode === 'emergency' || mode === 'breakout') {
    const g = heldGapDir(s, px, py, nearestBossE, st);
    vx = g.dx * 1.6;
    vy = g.dy * 1.6;
  } else if (mode === 'horde-prep') {
    const g = heldGapDir(s, px, py, nearestBossE, st);
    vx = g.dx * 1.3;
    vy = g.dy * 1.3;
  } else if (mode === 'prethin') {
    const dir = st.orbitDir;
    if ((nearestAdd < 50 || live >= EMERG_N) && nearestAddE) {
      const g = heldGapDir(s, px, py, nearestBossE, st);
      vx = g.dx * 1.6;
      vy = g.dy * 1.6;
    } else if (live >= THIN_LIVE && nearestAddE) {
      const eb = engageBand(px, py, nearestAddE, nearestAdd, nNear, cx, cy, nSwarm, dir);
      vx = eb.vx;
      vy = eb.vy;
      if (nSwarm > 0) {
        const gx = px - cx / nSwarm;
        const gy = py - cy / nSwarm;
        const gd = Math.hypot(gx, gy) || 1;
        vx += (gx / gd) * 0.6;
        vy += (gy / gd) * 0.6;
      }
    } else if (nearestAdd < THIN_NEAR && nearestAddE) {
      const ax = nearestAddE.x - px;
      const ay = nearestAddE.y - py;
      const ad = Math.hypot(ax, ay) || 1;
      vx = (-ax / ad) * 1.2 + (-ay / ad) * dir * 0.6;
      vy = (-ay / ad) * 1.2 + (ax / ad) * dir * 0.6;
    } else {
      const a = (s.time * 0.5) % (Math.PI * 2);
      vx = Math.cos(a) * 0.6;
      vy = Math.sin(a) * 0.6;
    }
  } else if (mode === 'thin') {
    const g = gapDir(s, px, py, 8, nearestBossE);
    vx = g.dx;
    vy = g.dy;
  } else if ((mode === 'mastering' || mode === 'boss') && nearestBossE) {
    const dx = px - nearestBossE.x;
    const dy = py - nearestBossE.y;
    const d = Math.hypot(dx, dy) || 1;
    const dir = st.orbitDir;
    const addInBand = mode === 'boss' && nearestE && !nearestE.boss && nearest <= 100;
    if (addInBand && d > 150 && nearestE) {
      const eb = engageBand(px, py, nearestE, nearest, nNear, cx, cy, nSwarm, dir);
      vx = eb.vx;
      vy = eb.vy;
    } else if (hpFrac < (mode === 'mastering' ? 0.35 : 0.5) && !rescue) {
      if (d < 280) { vx = (dx / d) * 1.45; vy = (dy / d) * 1.45; }
      else if (d > 380) { vx = (-dx / d) * 0.75; vy = (-dy / d) * 0.75; }
      else { vx = (-dy / d) * dir; vy = (dx / d) * dir; }
    } else {
      if (d > SWORD_MAX) { vx = (-dx / d) * 1.6 + (-dy / d) * dir * 0.6; vy = (-dy / d) * 1.6 + (dx / d) * dir * 0.6; }
      else if (d < SWORD_MIN) { vx = (dx / d) * 0.7 + (-dy / d) * dir; vy = (dy / d) * 0.7 + (dx / d) * dir; }
      else { vx = (-dy / d) * dir; vy = (dx / d) * dir; }
      if (bossBusy && d > 100) { vx = (-dx / d) * 1.5; vy = (-dy / d) * 1.5; }
    }
  } else if (mode === 'kite' && nearestE) {
    const dx = nearestE.x - px;
    const dy = nearestE.y - py;
    const d = Math.hypot(dx, dy) || 1;
    const dir = st.orbitDir;
    const radialW = nearest < 400 ? 1.2 : nearest < 550 ? 0.5 : 0;
    if (nearest > 700) { vx = dx / d; vy = dy / d; }
    else if (nearest < 200) { vx = (-dx / d) * 1.3 + (-dy / d) * 0.9; vy = (-dy / d) * 1.3 + (dx / d) * 0.9; }
    else { vx = (-dy / d) * dir + (-dx / d) * radialW; vy = (dx / d) * dir + (-dy / d) * radialW; }
  } else if (nearestE) {
    const eb = engageBand(px, py, nearestE, nearest, nNear, cx, cy, nSwarm, st.orbitDir);
    vx = eb.vx;
    vy = eb.vy;
  }

  if (dg.reasons.length) {
    if (dg.hard) { vx = dg.dx; vy = dg.dy; }
    else { vx += dg.dx * 1.5; vy += dg.dy * 1.5; }
  }

  const chestCost = (n: number) => Math.round(30 + 25 * n + 1.5 * n * n);
  const zenyNow = s.zeny || 0;
  const chestsNow = s.chestsOpened || 0;
  let bestP: { dx: number; dy: number; d: number; kind: string; w: number } | null = null;
  let bestScore = -1;
  for (const p of s.pickups || []) {
    const dx = p.x - px;
    const dy = p.y - py;
    const d = Math.hypot(dx, dy) || 1;
    const valuable = isValuablePickup(p);
    let w = 0;
    if (mode === 'mastering') {
      if (valuable && d < 220) w = 2.5;
    } else if (p.kind === 'magnet') {
      if (d < 1600) w = d < 260 ? 3.0 : 1.6;
    } else if (p.kind === 'loot' || p.kind === 'card' || p.kind === 'egg') {
      if (d < 1500) w = d < 220 ? 2.4 : 1.4;
    } else if (p.kind === 'chest' && d < 1400) {
      w = zenyNow >= chestCost(chestsNow) ? (d < 220 ? 2.2 : 1.2) : 0;
    } else if (p.kind === 'meat' && hpFrac <= 0.9 && hpFrac >= 0.5 && d < 700 && (nearest > 120 || nNear <= 6)) {
      w = 1.0;
    } else if (p.kind.startsWith('gem') && d < 400 && (nearest > 200 || nNear <= 3)) {
      w = 0.4 + Math.min(0.6, (p.value || 1) / 20);
    }
    if (w > 0 && valuable && d > 260) {
      const there = hordeThreatAt(s, p.x, p.y);
      const route = pathThreat(s, px, py, dx / d, dy / d);
      const projectedLoss = there.dmg * Math.min(3, d / 140);
      if (there.n >= 12 || route.maxN >= 12 || (s.hp > 0 && projectedLoss > s.hp * 0.25)) w = 0;
    }
    const score = w * (1 - d / 1600);
    if (score > bestScore) {
      bestScore = score;
      bestP = { dx, dy, d, kind: p.kind, w };
    }
  }
  if (bestP && bestP.w > 0 && !['emergency', 'horde-prep', 'rescue', 'prethin', 'breakout'].includes(mode) && (mode !== 'boss' || bestP.w >= 1.0)) {
    vx += (bestP.dx / bestP.d) * bestP.w;
    vy += (bestP.dy / bestP.d) * bestP.w;
  }

  if (nearestEliteE && !['emergency', 'boss', 'mastering', 'rescue', 'prethin', 'breakout'].includes(mode) && hpFrac > 0.5 && live < EMERG_N && nearestElite < 600) {
    const ex = nearestEliteE.x - px;
    const ey = nearestEliteE.y - py;
    const ed = Math.hypot(ex, ey) || 1;
    vx += (ex / ed) * 0.5;
    vy += (ey / ed) * 0.5;
  }

  if (!['emergency', 'horde-prep', 'rescue'].includes(mode) && !dg.hard) {
    const ahead = hordeThreatAt(s, px + vx * 140, py + vy * 140);
    const hereT = hordeThreatAt(s, px, py);
    const projectedLoss = ahead.dmg * 1.8;
    const headingIntoHorde = (ahead.n >= EMERG_N || (s.hp > 0 && projectedLoss > s.hp * 0.28)) && ahead.n > hereT.n + 3;
    if (headingIntoHorde) {
      const g = gapDir(s, px, py, 16, nearestBossE);
      vx = g.dx * 1.4;
      vy = g.dy * 1.4;
      mode = 'horde-avoid';
    }
  }

  const distCenter = Math.hypot((s.bounds.x0 + s.bounds.x1) / 2 - px, (s.bounds.y0 + s.bounds.y1) / 2 - py);
  if (distCenter > SPAWN_FARM_RADIUS && !['emergency', 'horde-prep', 'breakout', 'prethin', 'rescue', 'boss', 'mastering', 'horde-avoid'].includes(mode)) {
    if (VALUABLE_LOOT_RADIUS > 0 && bestP && bestP.w >= 1.4) {
      // let detour proceed
    } else {
      const cdx = (s.bounds.x0 + s.bounds.x1) / 2 - px;
      const cdy = (s.bounds.y0 + s.bounds.y1) / 2 - py;
      const cd = Math.hypot(cdx, cdy) || 1;
      vx = cdx / cd;
      vy = cdy / cd;
      mode = 'spawn-leash';
    }
  }

  const b = s.bounds;
  if (b) {
    if (px < b.x0 + 300) vx += 1.5;
    if (px > b.x1 - 300) vx -= 1.5;
    if (py < b.y0 + 300) vy += 1.5;
    if (py > b.y1 - 300) vy -= 1.5;
  }
  const mag = Math.hypot(vx, vy);
  if (mag < 0.25) {
    const a = (s.time * 0.5) % (Math.PI * 2);
    vx = Math.cos(a) * 0.8;
    vy = Math.sin(a) * 0.8;
  } else {
    vx /= mag;
    vy /= mag;
  }

  st.modeTicks[mode] = (st.modeTicks[mode] || 0) + 1;

  return {
    dx: vx,
    dy: vy,
    nearest: nearest === Infinity ? null : Math.round(nearest),
    nearestAdd: nearestAdd === Infinity ? null : Math.round(nearestAdd),
    nearestBoss: nearestBoss === Infinity ? null : Math.round(nearestBoss),
    nNear,
    nEnemies: live,
    nPickups: (s.pickups || []).length,
    hpFrac,
    mode,
    thinReady,
    timeToBoss,
    timeToHorde,
    bossId: nearestBossE ? nearestBossE.id : null,
    bossHp: nearestBossE ? nearestBossE.hp : null,
    bossMaxHp: nearestBossE ? nearestBossE.maxHp : null,
    bossBusy,
    nearestElite: nearestElite === Infinity ? null : Math.round(nearestElite),
    bestPickup: bestP ? { kind: bestP.kind, d: Math.round(bestP.d), w: bestP.w } : null,
    dodge: { reasons: dg.reasons, hard: dg.hard },
    rescue: rescue
      ? { d: Math.round(rescue.d), tReach: rescue.tReach, projected: rescue.projected }
      : rescueDenied
        ? { denied: true, d: rescueDenied.d, projected: rescueDenied.projected }
        : null,
    castsExposed: st.castsExposed,
    dodges: st.dodges,
    nearestMeat: nearestMeat ? Math.round(nearestMeatD) : null,
    mastering,
  };
}

export interface TacticalScenarioSpec {
  id: 'eclipse-contact' | 'toad-overlap' | 'pocket-escape' | 'mastering-window';
  title: string;
  subtitle: string;
  defaultRanged: boolean;
}

export const TACTICAL_SCENARIOS: TacticalScenarioSpec[] = [
  {
    id: 'eclipse-contact',
    title: 'Eclipse Pre-Spawn & Contact Trap',
    subtitle: 'Simulates t=128s pre-boss pack density (44 mobs) leading into Eclipse spawn at t=150s.',
    defaultRanged: false,
  },
  {
    id: 'toad-overlap',
    title: 'Toad Skill Overlap & Fire Rings',
    subtitle: 'Active overlapping fire rings + imminent Toad leap/bubble cooldowns requiring multi-zone escape.',
    defaultRanged: false,
  },
  {
    id: 'pocket-escape',
    title: 'Hidden Destination Pocket Escape',
    subtitle: 'Open near-cone east hides a 16-mob spawn pocket at 320px; gapDir routes clear northwest.',
    defaultRanged: false,
  },
  {
    id: 'mastering-window',
    title: 'Mastering t=720s Final Window',
    subtitle: 'Low-HP sustain threshold, scarce meat evaluation, and gap-close sidestep orbit around Mastering.',
    defaultRanged: false,
  },
];

export function createScenarioState(id: TacticalScenarioSpec['id']): SimState {
  const baseBounds = { x0: -1200, x1: 1200, y0: -900, y1: 900 };
  if (id === 'eclipse-contact') {
    const enemies: SimEnemy[] = Array.from({ length: 44 }, (_, i) => {
      const ang = (i / 44) * Math.PI * 2;
      const dist = 75 + (i % 4) * 35;
      return {
        id: `m_${i}`,
        x: Math.cos(ang) * dist,
        y: Math.sin(ang) * dist,
        hp: 85,
        maxHp: 85,
        speed: 62,
        damage: 4,
      };
    });
    return {
      ok: true,
      state: 'playing',
      time: 128,
      hp: 132,
      maxHp: 140,
      zeny: 64,
      chestsOpened: 1,
      player: { x: 0, y: 0 },
      bounds: baseBounds,
      stats: { speedMult: 1.08 },
      enemies,
      pickups: [
        { id: 'meat_1', x: -210, y: 120, kind: 'meat' },
        { id: 'gem_1', x: 140, y: -90, kind: 'gem_yellow', value: 8 },
      ],
      fireRings: [],
      projectiles: [],
      bossBrains: [],
      bossSchedule: [{ t: 150, id: 'eclipse' }],
    };
  }

  if (id === 'toad-overlap') {
    const enemies: SimEnemy[] = [
      { id: 'toad_1', x: 135, y: 10, hp: 4200, maxHp: 4600, speed: 58, damage: 14, boss: true },
      ...Array.from({ length: 18 }, (_, i) => ({
        id: `frog_${i}`,
        x: 60 + Math.cos(i * 0.7) * 140,
        y: Math.sin(i * 0.7) * 140,
        hp: 110,
        maxHp: 110,
        speed: 68,
        damage: 5,
      })),
    ];
    return {
      ok: true,
      state: 'playing',
      time: 312,
      hp: 104,
      maxHp: 145,
      zeny: 120,
      chestsOpened: 3,
      player: { x: 0, y: 0 },
      bounds: baseBounds,
      stats: { speedMult: 1.12 },
      enemies,
      pickups: [{ id: 'chest_1', x: -240, y: -160, kind: 'chest' }],
      fireRings: [
        { x: 15, y: 0, r: 95, ttl: 3.5 },
        { x: 110, y: -45, r: 85, ttl: 4.0 },
      ],
      projectiles: [{ x: 220, y: 40, vx: -180, vy: -30 }],
      bossBrains: [{
        boss: 'toad_1',
        phase: 2,
        gcd: 0.4,
        busyUntil: 311,
        ready: [0.4, 3.2, 6.5],
        skills: [
          { name: 'Chorro de burbujas', range: 420, cd: 8 },
          { name: 'Salto del sapo', range: 480, cd: 10 },
          { name: 'Croar', range: 210, cd: 11 },
        ],
      }],
    };
  }

  if (id === 'pocket-escape') {
    const enemies: SimEnemy[] = [
      // Close swarm to south/west pushing player east unless destination threat scores east pocket
      ...Array.from({ length: 24 }, (_, i) => ({
        id: `close_${i}`,
        x: -90 + (i % 6) * 28,
        y: 65 + Math.floor(i / 6) * 24,
        hp: 90,
        maxHp: 90,
        speed: 65,
        damage: 4,
      })),
      // Dense 18-mob destination pocket at +310px east
      ...Array.from({ length: 18 }, (_, i) => ({
        id: `pocket_${i}`,
        x: 310 + ((i % 5) - 2) * 22,
        y: ((Math.floor(i / 5) - 1) * 24),
        hp: 90,
        maxHp: 90,
        speed: 60,
        damage: 5,
      })),
    ];
    return {
      ok: true,
      state: 'playing',
      time: 242,
      hp: 58,
      maxHp: 140,
      zeny: 80,
      chestsOpened: 2,
      player: { x: 0, y: 0 },
      bounds: baseBounds,
      stats: { speedMult: 1.05 },
      enemies,
      pickups: [{ id: 'meat_p', x: -240, y: -180, kind: 'meat' }],
      fireRings: [],
      projectiles: [],
      bossBrains: [],
    };
  }

  // mastering-window
  return {
    ok: true,
    state: 'playing',
    time: 722,
    hp: 92,
    maxHp: 180,
    zeny: 260,
    chestsOpened: 7,
    player: { x: -110, y: 20 },
    bounds: baseBounds,
    stats: { speedMult: 1.2 },
    enemies: [
      { id: 'mastering_boss', x: 70, y: 0, hp: 44800, maxHp: 52000, speed: 84, damage: 22, boss: true },
      ...Array.from({ length: 12 }, (_, i) => ({
        id: `poring_${i}`,
        x: Math.cos(i * 0.55) * 180,
        y: Math.sin(i * 0.55) * 180,
        hp: 140,
        maxHp: 140,
        speed: 74,
        damage: 6,
      })),
    ],
    pickups: [
      { id: 'meat_m', x: -260, y: -110, kind: 'meat' },
      { id: 'mag_m', x: 180, y: 170, kind: 'magnet' },
    ],
    fireRings: [{ x: 70, y: 0, r: 90, ttl: 2.2 }],
    projectiles: [],
    bossBrains: [{
      boss: 'mastering_boss',
      phase: 2,
      gcd: 0,
      busyUntil: 720,
      ready: [0.55, 2.8, 5.4],
      skills: [
        { name: 'Royal Poring Slam', range: 260, cd: 7 },
        { name: 'Giga Drop', range: 440, cd: 10 },
        { name: 'Summon Guard', range: 600, cd: 16 },
      ],
    }],
  };
}

export function stepScenarioTick(s: SimState, st: SteerRuntimeState, dt = 0.1): SteerDecision {
  s.time = +(s.time + dt).toFixed(2);
  st.nowMs += Math.round(dt * 1000);

  // Spawn Eclipse dynamically if scenario crosses t=150s
  if (s.bossSchedule) {
    for (const sched of s.bossSchedule) {
      if (s.time >= sched.t && !s.enemies.some(e => e.boss && e.id.includes(sched.id))) {
        s.enemies.push({
          id: `${sched.id}_boss`,
          x: s.player.x + 170,
          y: s.player.y - 60,
          hp: 3400,
          maxHp: 3400,
          speed: 62,
          damage: 14,
          boss: true,
        });
        s.bossBrains.push({
          boss: `${sched.id}_boss`,
          phase: 1,
          gcd: 0,
          busyUntil: 0,
          ready: [1.8, 5.0],
          skills: [
            { name: 'Shadow Dash', range: 320, cd: 7 },
            { name: 'Nightmare Ring', range: 240, cd: 11 },
          ],
        });
      }
    }
  }

  const decision = steer(s, st);

  // Move player cleanly
  const speed = 150 * ((s.stats && s.stats.speedMult) || 1);
  s.player.x = Math.max(s.bounds.x0 + 40, Math.min(s.bounds.x1 - 40, s.player.x + decision.dx * speed * dt));
  s.player.y = Math.max(s.bounds.y0 + 40, Math.min(s.bounds.y1 - 40, s.player.y + decision.dy * speed * dt));

  // Auto-fire damage & pack movement
  for (const e of s.enemies) {
    if (e.dead) continue;
    const dx = s.player.x - e.x;
    const dy = s.player.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    e.x += (dx / d) * e.speed * dt;
    e.y += (dy / d) * e.speed * dt;

    // Auto-fire skills hit within sword/bow range
    const strikeRange = st.ranged ? 340 : 115;
    if (d <= strikeRange) {
      e.hp -= (e.boss ? 28 : 42) * dt * 2.5;
      if (e.hp <= 0) e.dead = true;
    }

    // Contact damage when inside 24px
    if (!e.dead && d < 24) {
      s.hp = Math.max(0, s.hp - e.damage * dt);
    }
  }

  // Boss cooldowns & occasional ring spawn
  for (const bb of s.bossBrains) {
    bb.ready = bb.ready.map((r, idx) => {
      const next = r - dt;
      if (next <= 0) {
        const bossE = s.enemies.find(e => e.id === bb.boss && !e.dead);
        if (bossE && Math.hypot(bossE.x - s.player.x, bossE.y - s.player.y) <= (bb.skills[idx]?.range || 300) + 60) {
          s.fireRings.push({ x: s.player.x, y: s.player.y, r: 78, ttl: 2.8 });
          bb.busyUntil = s.time + 0.8;
        }
        return bb.skills[idx]?.cd || 8;
      }
      return +next.toFixed(2);
    });
  }

  // Tick rings & projectiles
  s.fireRings = s.fireRings
    .map(r => ({ ...r, ttl: (r.ttl ?? 3) - dt }))
    .filter(r => (r.ttl ?? 1) > 0);

  for (const r of s.fireRings) {
    if (Math.hypot(s.player.x - r.x, s.player.y - r.y) < r.r) {
      s.hp = Math.max(0, s.hp - 12 * dt);
    }
  }

  for (const pr of s.projectiles) {
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;
    if (Math.hypot(pr.x - s.player.x, pr.y - s.player.y) < 18) {
      s.hp = Math.max(0, s.hp - 8);
      pr.x = s.bounds.x1 + 900;
    }
  }
  s.projectiles = s.projectiles.filter(pr => pr.x >= s.bounds.x0 - 200 && pr.x <= s.bounds.x1 + 200);

  // Collect pickups within pickup radius
  s.pickups = s.pickups.filter(p => {
    const d = Math.hypot(p.x - s.player.x, p.y - s.player.y);
    if (d < 36) {
      if (p.kind === 'meat') s.hp = Math.min(s.maxHp, s.hp + Math.round(s.maxHp * 0.5));
      else if (p.kind === 'chest') s.chestsOpened += 1;
      return false;
    }
    return true;
  });

  if (s.hp <= 0) s.state = 'over';
  return decision;
}
