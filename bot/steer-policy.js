'use strict';

const { gapDir, hordeThreatAt, pathThreat } = require('./movement-policy');

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
const SPAWN_FARM_RADIUS = 500;
const VALUABLE_LOOT_RADIUS = 1500;
const ESCAPE_HOLD_MS = 4000;
const HORDE_PREP_WINDOW = 18;
const MEAT_RESCUE_RANGE = 1300;

function mapBossTimes(s) {
  const live = Array.isArray(s && s.bossSchedule)
    ? s.bossSchedule.map(b => Number(b && b.t)).filter(t => Number.isFinite(t) && t >= 0).sort((a, b) => a - b)
    : [];
  return live.length ? live : FALLBACK_BOSS_TIMES;
}

function nextBossTime(s, now) {
  return mapBossTimes(s).find(t => t > now) ?? null;
}

function isValuablePickup(p) {
  if (!p) return false;
  if (p.kind === 'magnet' || p.kind === 'loot' || p.kind === 'card' || p.kind === 'egg') return true;
  if (p.kind === 'chest') return true;
  const q = Number(p.quality || 0);
  return Number.isFinite(q) && q >= 3;
}

function valuablePickupTarget(s, px, py) {
  if (!s || !Array.isArray(s.pickups)) return null;
  let best = null, bestScore = -Infinity;
  for (const p of s.pickups) {
    if (!isValuablePickup(p)) continue;
    const d = Math.hypot(p.x - px, p.y - py);
    if (d > VALUABLE_LOOT_RADIUS) continue;
    const mag = p.kind === 'magnet' ? 5000 : 0;
    const q = Number(p.quality || 0);
    const score = mag + (Number.isFinite(q) ? q * 120 : 0) - d;
    if (score > bestScore) { bestScore = score; best = { p, d }; }
  }
  return best;
}

function victorySweepActive(s) {
  return !!s && (s.lootUntil > s.time || (s.finalBossDefeated && s.state !== 'over'));
}

function activeBosses(s) {
  const seen = new Set();
  const out = [];
  for (const boss of [...((s && s.bosses) || []), ...(((s && s.enemies) || []).filter(e => e && e.boss))]) {
    if (!boss || boss.dead) continue;
    const id = boss.id || `${boss.x}:${boss.y}:${boss.hp}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(boss);
  }
  return out;
}

function isLiveRunState(s) {
  return !!(s && s.ok && ['playing', 'levelup'].includes(s.state));
}

function nearestVictoryPickup(s, px, py) {
  if (!victorySweepActive(s) || !Array.isArray(s.pickups)) return null;
  let nearest = null, nearestD = Infinity, magnet = null, magnetD = Infinity;
  for (const p of s.pickups) {
    const d = Math.hypot(p.x - px, p.y - py);
    if (p.kind === 'magnet' && d < magnetD) { magnet = p; magnetD = d; }
    if (d < nearestD) { nearest = p; nearestD = d; }
  }
  const best = magnet || nearest;
  return best ? { x: best.x, y: best.y, kind: best.kind, quality: best.quality ?? null, d: magnet ? magnetD : nearestD } : null;
}

function applySpawnLeash(s, v) {
  if (v && ['emergency', 'horde-prep', 'breakout', 'prethin', 'rescue', 'boss', 'mastering', 'horde-avoid'].includes(v.mode)) return v;
  const b = s.bounds;
  if (!b) return v;
  const px = s.player.x, py = s.player.y;
  const hx = (b.x0 + b.x1) / 2, hy = (b.y0 + b.y1) / 2;
  const dx = hx - px, dy = hy - py;
  const distCenter = Math.hypot(dx, dy);
  if (distCenter <= SPAWN_FARM_RADIUS) return v;
  if (v.mode === 'loot-sweep' && victorySweepActive(s)) return v;
  const vt = valuablePickupTarget(s, px, py);
  if (vt) {
    const vdx = vt.p.x - px, vdy = vt.p.y - py, vd = Math.hypot(vdx, vdy) || 1;
    const here = hordeThreatAt(s, px, py);
    const there = hordeThreatAt(s, vt.p.x, vt.p.y);
    const route = pathThreat(s, px, py, vdx / vd, vdy / vd);
    const hp = s.maxHp ? s.hp : (s.hp || 1);
    const projectedLoss = Math.max(there.dmg, route.maxDmg) * Math.min(3, vd / 140);
    const tooDangerous = here.n >= 12 || there.n >= 12 || route.maxN >= 12 || (hp > 0 && projectedLoss > hp * 0.25);
    if (!tooDangerous) return { ...v, dx: vdx / vd, dy: vdy / vd, mode: 'loot-detour' };
  }
  const d = distCenter || 1;
  return { ...v, dx: dx / d, dy: dy / d, mode: 'spawn-leash' };
}

function meatRescueOK(s, px, py, meat) {
  const d = Math.hypot(meat.x - px, meat.y - py);
  const speed = 150 * ((s.stats && s.stats.speedMult) || 1);
  const tReach = d / (speed * 0.85);
  let incoming = 0;
  for (const e of s.enemies || []) {
    const ed = Math.hypot(e.x - px, e.y - py);
    if (ed < 180) incoming += (e.damage || 4);
  }
  const bossE = (s.enemies || []).find(e => e.boss);
  if (bossE) {
    const bd = Math.hypot(bossE.x - px, bossE.y - py);
    const bb = s.bossBrains ? s.bossBrains.find(b => b.boss === bossE.id) : null;
    if (bb && bd < 650 && bb.ready && bb.ready.length && Math.min(...bb.ready) < 2) incoming += 25 / Math.max(tReach, 0.5);
  }
  const projected = s.hp - incoming * tReach;
  const floor = Math.max(20, 0.12 * s.maxHp);
  return { ok: projected > floor, tReach: +tReach.toFixed(1), projected: Math.round(projected), floor, incoming: Math.round(incoming) };
}

function zonesAtPoint(x, y, zones) {
  let n = 0, w = 0; const kinds = [];
  for (const z of zones) {
    const d = Math.hypot(x - z.x, y - z.y);
    if (d < z.r) { n++; w += z.w; if (!kinds.includes(z.kind)) kinds.push(z.kind); }
  }
  return { n, w, kinds };
}

function sampleSafeDir(s, px, py, zones, imminent, bossE) {
  const cands = [{ x: px, y: py, dist: 0 }];
  for (let k = 0; k < 16; k++) {
    const a = k * Math.PI * 2 / 16, ux = Math.cos(a), uy = Math.sin(a);
    for (const dist of [120, 220, 340]) cands.push({ x: px + ux * dist, y: py + uy * dist, dist });
  }
  let best = null;
  for (const c of cands) {
    let z = 0;
    for (const zn of zones) { const d = Math.hypot(c.x - zn.x, c.y - zn.y); if (d < zn.r + 30) z += zn.w; }
    if (imminent.length) { const d = Math.hypot(c.x - px, c.y - py); if (d < 130) z += 2; }
    for (const pr of s.projectiles || []) {
      const pvx = pr.vx || 0, pvy = pr.vy || 0, ps = Math.hypot(pvx, pvy);
      if (!ps) continue;
      const rx = c.x - pr.x, ry = c.y - pr.y;
      const tca = Math.max(0, -(rx * pvx + ry * pvy) / (ps * ps));
      const cd = Math.hypot(c.x - (pr.x + pvx * tca), c.y - (pr.y + pvy * tca));
      if (cd < 45 && tca < 1.2) z += 2;
    }
    let pack = 0;
    for (const e of s.enemies || []) { if (Math.hypot(e.x - c.x, e.y - c.y) < 60) pack++; }
    let bossPen = 0, radialPen = 0;
    if (bossE) {
      const bd = Math.hypot(c.x - bossE.x, c.y - bossE.y);
      bossPen = bd > 150 ? (bd - 150) / 150 : (bd < 40 ? 0.5 : 0);
      if (imminent.length) {
        const bdx = px - bossE.x, bdy = py - bossE.y, bdd = Math.hypot(bdx, bdy) || 1;
        const mx = c.x - px, my = c.y - py, md = Math.hypot(mx, my) || 1;
        radialPen = Math.abs((mx / md) * (bdx / bdd) + (my / md) * (bdy / bdd)) * 5;
      }
    }
    const score = z * 10 + pack * 2 + bossPen + radialPen + c.dist * 0.001;
    if (!best || score < best.score) best = { x: c.x, y: c.y, dist: c.dist, score, zones: z, pack };
  }
  return best;
}

function dodgeVector(s, px, py, bossE, bossBrain, mastering, st) {
  let dx = 0, dy = 0, hard = false;
  const reasons = [];
  const zones = [];
  for (const r of s.fireRings || []) zones.push({ x: r.x, y: r.y, r: r.r + 20, w: 3, kind: 'ring' });
  const imminent = [];
  let driftX = 0, driftY = 0;
  if (bossE && bossBrain && bossBrain.ready) {
    const bdx = px - bossE.x, bdy = py - bossE.y, bd = Math.hypot(bdx, bdy) || 1;
    const trk = st || null;
    if (trk && !trk.skillReadyAt) trk.skillReadyAt = {};
    (bossBrain.skills || []).forEach((sk, i) => {
      const rdy = bossBrain.ready[i];
      if (rdy == null) return;
      if (rdy > 2) { if (trk) delete trk.skillReadyAt[i]; return; }
      if (rdy <= 0.7 && bd <= sk.range + 80) {
        if (trk && trk.skillReadyAt[i] == null) trk.skillReadyAt[i] = s.time;
        const sinceReady = trk && trk.skillReadyAt[i] != null ? s.time - trk.skillReadyAt[i] : 0;
        if (sinceReady <= 1.5) { imminent.push({ name: sk.name, range: sk.range }); reasons.push('cast:' + sk.name); }
        else if (bd > 150) { driftX += (bdx / bd) * 0.8; driftY += (bdy / bd) * 0.8; reasons.push('precast:' + sk.name); }
      } else if (rdy <= 1.5 && bd <= sk.range * 0.6 && bd > 150) {
        driftX += (bdx / bd) * 0.8; driftY += (bdy / bd) * 0.8; reasons.push('precast:' + sk.name);
      }
      if (trk) {
        const prev = trk.prevReady || [];
        if (prev[i] != null && prev[i] > 0.5 && rdy <= 0.5 && bd <= ((sk && sk.range) || 650) + 80) trk.castsExposed = (trk.castsExposed || 0) + 1;
      }
    });
    if (trk) trk.prevReady = bossBrain.ready.slice();
  }
  let projDanger = false;
  for (const pr of s.projectiles || []) {
    const rx = px - pr.x, ry = py - pr.y, pvx = pr.vx || 0, pvy = pr.vy || 0, ps = Math.hypot(pvx, pvy);
    if (!ps) continue;
    const tca = Math.max(0, -(rx * pvx + ry * pvy) / (ps * ps));
    const cxp = pr.x + pvx * tca, cyp = pr.y + pvy * tca, cd = Math.hypot(px - cxp, py - cyp);
    if (cd < 45 && tca < 1.2) { projDanger = true; reasons.push('proj'); }
  }
  const here = zonesAtPoint(px, py, zones);
  for (const k of here.kinds) if (!reasons.includes(k)) reasons.push(k);
  const nearZone = zones.some(z => Math.hypot(px - z.x, py - z.y) < z.r + 90);
  if (here.n > 0 || imminent.length > 0 || projDanger || nearZone) {
    const best = sampleSafeDir(s, px, py, zones, imminent, bossE);
    const bx = best.x - px, by = best.y - py, bd = Math.hypot(bx, by);
    if (bd > 5) { dx = bx / bd; dy = by / bd; } else { dx = driftX; dy = driftY; }
    hard = here.n > 0 || imminent.length > 0 || projDanger;
    if (best.zones === 0 && here.n > 0) reasons.push('union:safe');
  } else {
    dx = driftX; dy = driftY; hard = false;
  }
  return { dx, dy, hard, reasons };
}

function engageBand(px, py, e, d, nNear, cx, cy, nSwarm, dir) {
  const sp = e.speed || 60;
  const ex = e.x + ((px - e.x) / (d || 1)) * sp * 0.3;
  const ey = e.y + ((py - e.y) / (d || 1)) * sp * 0.3;
  const ax = ex - px, ay = ey - py, ad = Math.hypot(ax, ay) || 1;
  let vx = 0, vy = 0;
  if (d > 100) { vx = ax / ad; vy = ay / ad; }
  else if (d < SWORD_MIN) { vx = -ax / ad * 0.7 + (-ay / ad) * 0.8; vy = -ay / ad * 0.7 + (ax / ad) * 0.8; }
  else { vx = (-ay / ad) * dir; vy = (ax / ad) * dir; }
  if (nNear >= 2 && d <= 130 && nSwarm > 0) {
    const gx = cx / nSwarm - px, gy = cy / nSwarm - py, gd = Math.hypot(gx, gy) || 1;
    vx += (gx / gd) * 0.35; vy += (gy / gd) * 0.35;
  }
  return { vx, vy };
}

function heldGapDir(s, px, py, bossE, st) {
  const now = (st && typeof st.nowMs === 'number') ? st.nowMs : Date.now();
  if (st && st.escapeDir && now < st.escapeUntil) return st.escapeDir;
  const g = gapDir(s, px, py, 16, bossE);
  if (st) {
    st.escapeDir = { dx: g.dx, dy: g.dy };
    st.escapeUntil = now + ESCAPE_HOLD_MS;
  }
  return g;
}

function steer(s, st) {
  const px = s.player.x, py = s.player.y;
  const ranged = !!(st && st.ranged);
  const enableThinning = st && st.enableThinning !== undefined ? !!st.enableThinning : true;
  let vx = 0, vy = 0, nearest = Infinity, nearestE = null, nearestBoss = Infinity, nearestBossE = null, nNear = 0;
  let nearestElite = Infinity, nearestEliteE = null;
  let nearestAdd = Infinity, nearestAddE = null;
  let cx = 0, cy = 0, nSwarm = 0;
  for (const e of s.enemies || []) {
    if (!e || e.dead) continue;
    const dx = px - e.x, dy = py - e.y, d = Math.hypot(dx, dy) || 1;
    if (d < nearest) { nearest = d; nearestE = e; }
    if (e.boss && d < nearestBoss) { nearestBoss = d; nearestBossE = e; }
    if (!e.boss && d < nearestAdd) { nearestAdd = d; nearestAddE = e; }
    if (e.elite && !e.boss && d < nearestElite) { nearestElite = d; nearestEliteE = e; }
    if (d < SWARM_R) { nNear++; cx += e.x; cy += e.y; nSwarm++; }
  }
  const hpFrac = s.maxHp ? s.hp / s.maxHp : 1;
  const live = (s.enemies || []).filter(e => e && !e.dead).length;
  const bossActive = !!nearestBossE;
  const bossBrain = bossActive && s.bossBrains ? s.bossBrains.find(bb => bb.boss === nearestBossE.id) : null;
  const bossBusy = bossBrain && bossBrain.busyUntil > s.time;
  const mastering = !!(nearestBossE && /mastering/i.test(nearestBossE.id || ''));
  const victoryPickup = nearestVictoryPickup(s, px, py);

  let nearestMeat = null, nearestMeatD = Infinity;
  for (const p of s.pickups || []) {
    if (p.kind !== 'meat') continue;
    const d = Math.hypot(p.x - px, p.y - py);
    if (d < nearestMeatD) { nearestMeatD = d; nearestMeat = p; }
  }

  const dg = dodgeVector(s, px, py, nearestBossE, bossBrain, mastering, st);
  if (dg.reasons.length && st) { st.dodges = (st.dodges || 0) + 1; if (dg.hard) st.hardDodges = (st.hardDodges || 0) + 1; }

  let rescue = null, rescueDenied = null;
  if (hpFrac < 0.5 && nearestMeat && nearestMeatD <= MEAT_RESCUE_RANGE) {
    const chk = meatRescueOK(s, px, py, nearestMeat);
    if (chk.ok) { rescue = { meat: nearestMeat, d: nearestMeatD, ...chk }; if (st) st.rescuesAttempted = (st.rescuesAttempted || 0) + 1; }
    else { rescueDenied = { d: Math.round(nearestMeatD), ...chk }; if (st) st.rescueDenied = (st.rescueDenied || 0) + 1; }
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

  if (st && st.inBreakout && nearestAdd > 130) st.inBreakout = false;
  if (bossActive && thickPack && st) st.inBreakout = true;

  let mode = ranged ? 'kite' : 'engage';
  if (rescue && !dg.hard) mode = 'rescue';
  else if (bossActive && (thickPack || (st && st.inBreakout))) mode = 'breakout';
  else if (bossActive) mode = mastering ? 'mastering' : 'boss';
  else if (live >= EMERG_N || nearest < EMERG_NEAR || (ranged && nearest < 150) || (hpFrac < FLEE_HP && nearest < 200)) mode = 'emergency';
  else if (hordeWindow && !victoryPickup) mode = 'horde-prep';
  else if (preBossWindow && !victoryPickup && (live >= THIN_LIVE || nearestAdd < THIN_NEAR)) mode = 'prethin';
  else if (victoryPickup && !dg.hard) mode = 'loot-sweep';
  else if (live >= THIN_N) mode = 'thin';

  if (mode === 'rescue' && rescue) {
    const mdx = rescue.meat.x - px, mdy = rescue.meat.y - py, md = Math.hypot(mdx, mdy) || 1;
    vx = (mdx / md) * 1.6; vy = (mdy / md) * 1.6;
  } else if (mode === 'emergency') {
    const g = heldGapDir(s, px, py, nearestBossE, st);
    vx = g.dx * 1.6; vy = g.dy * 1.6;
  } else if (mode === 'horde-prep') {
    const g = heldGapDir(s, px, py, nearestBossE, st);
    vx = g.dx * 1.3; vy = g.dy * 1.3;
  } else if (mode === 'breakout') {
    const g = heldGapDir(s, px, py, nearestBossE, st);
    vx = g.dx * 1.6; vy = g.dy * 1.6;
  } else if (mode === 'prethin') {
    const dir = (st && st.orbitDir) || 1;
    if ((nearestAdd < 50 || live >= EMERG_N) && nearestAddE) {
      const g = heldGapDir(s, px, py, nearestBossE, st);
      vx = g.dx * 1.6; vy = g.dy * 1.6;
    } else if (live >= THIN_LIVE && nearestAddE) {
      const eb = engageBand(px, py, nearestAddE, nearestAdd, nNear, cx, cy, nSwarm, dir);
      vx = eb.vx; vy = eb.vy;
      if (nSwarm > 0) { const gx = px - cx / nSwarm, gy = py - cy / nSwarm, gd = Math.hypot(gx, gy) || 1; vx += (gx / gd) * 0.6; vy += (gy / gd) * 0.6; }
    } else if (nearestAdd < THIN_NEAR && nearestAddE) {
      const ax = nearestAddE.x - px, ay = nearestAddE.y - py, ad = Math.hypot(ax, ay) || 1;
      vx = (-ax / ad) * 1.2 + (-ay / ad) * dir * 0.6; vy = (-ay / ad) * 1.2 + (ax / ad) * dir * 0.6;
    } else {
      const a = (s.time * 0.5) % (Math.PI * 2);
      vx = Math.cos(a) * 0.6; vy = Math.sin(a) * 0.6;
    }
  } else if (mode === 'loot-sweep' && victoryPickup) {
    const dx = victoryPickup.x - px, dy = victoryPickup.y - py, d = Math.hypot(dx, dy) || 1;
    vx = dx / d; vy = dy / d;
  } else if (mode === 'thin') {
    const g = gapDir(s, px, py, 8, nearestBossE);
    vx = g.dx; vy = g.dy;
    const b = s.bounds;
    if (b) {
      const dEdge = Math.min(px - b.x0, b.x1 - px, py - b.y0, b.y1 - py);
      if (dEdge < 600) {
        const nx = (px - b.x0 < b.x1 - px) ? 1 : (b.x1 - px < px - b.x0 ? -1 : 0);
        const ny = (py - b.y0 < b.y1 - py) ? 1 : (b.y1 - py < py - b.y0 ? -1 : 0);
        if (nx !== 0 && Math.abs(px - (nx > 0 ? b.x0 : b.x1)) <= Math.abs(py - (ny > 0 ? b.y0 : b.y1))) { vx = vx - nx * (vx * nx); vy = vy * 1.2; }
        else if (ny !== 0) { vy = vy - ny * (vy * ny); vx = vx * 1.2; }
      }
    }
  } else if (mode === 'mastering' && nearestBossE) {
    const dx = px - nearestBossE.x, dy = py - nearestBossE.y, d = Math.hypot(dx, dy) || 1;
    const dir = (st && st.orbitDir) || 1;
    if (bossBusy) {
      if (d > 100) { vx = (-dx / d) * 1.5; vy = (-dy / d) * 1.5; }
      else { vx = (-dy / d) * dir; vy = (dx / d) * dir; }
    } else if (hpFrac < 0.35) {
      if (d < 250) { vx = (dx / d) * 1.4; vy = (dy / d) * 1.4; }
      else if (d > 350) { vx = (-dx / d) * 0.8; vy = (-dy / d) * 0.8; }
      else { vx = (-dy / d) * dir; vy = (dx / d) * dir; }
      if (nearestE && !nearestE.boss && nearest < 150) {
        const ax = nearestE.x - px, ay = nearestE.y - py, ad = Math.hypot(ax, ay) || 1;
        if (nearest > 95) { vx += (-ax / ad) * 0.8; vy += (-ay / ad) * 0.8; }
      }
    } else {
      if (d > SWORD_MAX) { vx = (-dx / d) * 1.5 + (-dy / d) * dir * 0.6; vy = (-dy / d) * 1.5 + (dx / d) * dir * 0.6; }
      else if (d < SWORD_MIN) { vx = (dx / d) * 0.7 + (-dy / d) * dir; vy = (dy / d) * 0.7 + (dx / d) * dir; }
      else { vx = (-dy / d) * dir; vy = (dx / d) * dir; }
      let tx = nearestBossE.x, ty = nearestBossE.y, tn = 1;
      for (const e of s.enemies || []) {
        if (!e.boss && Math.hypot(e.x - nearestBossE.x, e.y - nearestBossE.y) < 200) { tx += e.x; ty += e.y; tn++; }
      }
      const cdx = tx / tn - px, cdy = ty / tn - py, cd = Math.hypot(cdx, cdy) || 1;
      if (cd > 95) { vx += (cdx / cd) * 0.35; vy += (cdy / cd) * 0.35; }
    }
  } else if (mode === 'boss' && nearestBossE) {
    const dx = px - nearestBossE.x, dy = py - nearestBossE.y, d = Math.hypot(dx, dy) || 1;
    const dir = (st && st.orbitDir) || 1;
    const addInBand = nearestE && !nearestE.boss && nearest <= 100;
    if (addInBand && d > 150) {
      const eb = engageBand(px, py, nearestE, nearest, nNear, cx, cy, nSwarm, dir);
      vx = eb.vx; vy = eb.vy;
    } else if (hpFrac < 0.5 && !rescue) {
      if (addInBand) { const eb = engageBand(px, py, nearestE, nearest, nNear, cx, cy, nSwarm, dir); vx = eb.vx; vy = eb.vy; }
      else if (d < 300) { vx = (dx / d) * 1.5; vy = (dy / d) * 1.5; }
      else if (d > 400) { vx = (-dx / d) * 0.7; vy = (-dy / d) * 0.7; }
      else { vx = (-dy / d) * dir; vy = (dx / d) * dir; }
    } else {
      if (d > SWORD_MAX) { vx = (-dx / d) * 1.6 + (-dy / d) * dir * 0.6; vy = (-dy / d) * 1.6 + (dx / d) * dir * 0.6; }
      else if (d < SWORD_MIN) { vx = (dx / d) * 0.7 + (-dy / d) * dir; vy = (dy / d) * 0.7 + (dx / d) * dir; }
      else { vx = (-dy / d) * dir; vy = (dx / d) * dir; }
      let tx = nearestBossE.x, ty = nearestBossE.y, tn = 1;
      for (const e of s.enemies || []) {
        if (!e.boss && Math.hypot(e.x - nearestBossE.x, e.y - nearestBossE.y) < 200) { tx += e.x; ty += e.y; tn++; }
      }
      const cdx = tx / tn - px, cdy = ty / tn - py, cd = Math.hypot(cdx, cdy) || 1;
      if (cd > 95) { vx += (cdx / cd) * 0.35; vy += (cdy / cd) * 0.35; }
      if (bossBusy && d > 100) { vx = (-dx / d) * 1.5; vy = (-dy / d) * 1.5; }
    }
  } else if (mode === 'kite' && nearestE) {
    const dx = nearestE.x - px, dy = nearestE.y - py, d = Math.hypot(dx, dy) || 1;
    const dir = (st && st.orbitDir) || 1;
    const radialW = nearest < 400 ? 1.2 : (nearest < 550 ? 0.5 : 0);
    if (nearest > 700) { vx = dx / d; vy = dy / d; }
    else if (nearest < 200) { vx = -dx / d * 1.3 + (-dy / d) * 0.9; vy = -dy / d * 1.3 + (dx / d) * 0.9; }
    else {
      vx = (-dy / d) * dir + (-dx / d) * radialW; vy = (dx / d) * dir + (-dy / d) * radialW;
      if (nNear >= 2 && nearest <= 450 && nSwarm > 0) { const ax = cx / nSwarm - px, ay = cy / nSwarm - py, ad = Math.hypot(ax, ay) || 1; vx += (ax / ad) * 0.3; vy += (ay / ad) * 0.3; }
    }
  } else if (nearestE) {
    const sp = nearestE.speed || 60;
    const ex = nearestE.x + ((px - nearestE.x) / (nearest || 1)) * sp * 0.3;
    const ey = nearestE.y + ((py - nearestE.y) / (nearest || 1)) * sp * 0.3;
    const dx = ex - px, dy = ey - py, d = Math.hypot(dx, dy) || 1;
    if (nearest > 100) { vx = dx / d; vy = dy / d; }
    else if (nearest < SWORD_MIN) { vx = -dx / d * 0.7 + (-dy / d) * 0.8; vy = -dy / d * 0.7 + (dx / d) * 0.8; }
    else {
      const dir = (st && st.orbitDir) || 1;
      vx = (-dy / d) * dir; vy = (dx / d) * dir;
    }
    if (nNear >= 2 && nearest <= 130 && nSwarm > 0) { const ax = cx / nSwarm - px, ay = cy / nSwarm - py, ad = Math.hypot(ax, ay) || 1; vx += (ax / ad) * 0.35; vy += (ay / ad) * 0.35; }
  }

  if (dg.reasons.length) {
    if (dg.hard) { vx = dg.dx; vy = dg.dy; }
    else { vx += dg.dx * 1.5; vy += dg.dy * 1.5; }
  }

  const chestCost = n => Math.round(30 + 25 * n + 1.5 * n * n);
  const zenyNow = s.zeny || 0, chestsNow = s.chestsOpened || 0;
  let bestP = null, bestScore = -1;
  for (const p of s.pickups || []) {
    const dx = p.x - px, dy = p.y - py, d = Math.hypot(dx, dy) || 1;
    const valuable = isValuablePickup(p);
    let w = 0;
    if (mode === 'mastering') {
      if (valuable && d < 220) w = 2.5;
    } else if (mode === 'loot-sweep') { /* handled */ }
    else if (p.kind === 'magnet') {
      if (d < 1600) w = d < 260 ? 3.0 : 1.6;
    } else if (p.kind === 'loot' || p.kind === 'card' || p.kind === 'egg') {
      if (d < 1500) w = d < 220 ? 2.4 : 1.4;
    } else if (p.kind === 'chest' && d < 1400) {
      w = zenyNow >= chestCost(chestsNow) ? (d < 220 ? 2.2 : 1.2) : 0;
    } else if (p.kind === 'meat' && hpFrac <= 0.9 && hpFrac >= 0.5 && d < 700 && (nearest > 120 || nNear <= 6)) {
      w = 1.0;
    } else if (p.kind && p.kind.startsWith('gem') && d < 400 && (nearest > 200 || nNear <= 3)) {
      w = 0.4 + Math.min(0.6, (p.value || 1) / 20);
    }
    const q = Number(p.quality || 0);
    if (Number.isFinite(q) && q >= 3 && d < 1600) w = Math.max(w, d < 260 ? 2.8 : 1.5);
    if (w > 0 && valuable && d > 260) {
      const there = hordeThreatAt(s, p.x, p.y);
      const pd = Math.hypot(dx, dy) || 1;
      const route = pathThreat(s, px, py, dx / pd, dy / pd);
      const projectedLoss = there.dmg * Math.min(3, d / 140);
      const hp = s.maxHp ? s.hp : (s.hp || 1);
      if (there.n >= 12 || route.maxN >= 12 || (hp > 0 && projectedLoss > hp * 0.25)) w = 0;
    }
    const score = w * (1 - d / 1600);
    if (score > bestScore) { bestScore = score; bestP = { dx, dy, d, kind: p.kind, w }; }
  }
  if (bestP && bestP.w > 0 && mode !== 'emergency' && mode !== 'horde-prep' && mode !== 'rescue' && mode !== 'prethin' && mode !== 'breakout' && (mode !== 'boss' || bestP.w >= 1.0)) {
    vx += (bestP.dx / bestP.d) * bestP.w; vy += (bestP.dy / bestP.d) * bestP.w;
  }

  if (nearestEliteE && mode !== 'emergency' && mode !== 'boss' && mode !== 'mastering' && mode !== 'rescue' && mode !== 'prethin' && mode !== 'breakout' && hpFrac > 0.5 && live < EMERG_N && nearestElite < 600) {
    const ex = nearestEliteE.x - px, ey = nearestEliteE.y - py, ed = Math.hypot(ex, ey) || 1;
    vx += (ex / ed) * 0.5; vy += (ey / ed) * 0.5;
  }

  if (mode !== 'emergency' && mode !== 'horde-prep' && mode !== 'rescue' && !(dg && dg.hard)) {
    const ahead = hordeThreatAt(s, px + vx * 140, py + vy * 140);
    const hereT = hordeThreatAt(s, px, py);
    const hp = s.maxHp ? s.hp : (s.hp || 1);
    const projectedLoss = ahead.dmg * 1.8;
    const headingIntoHorde = (ahead.n >= EMERG_N || (hp > 0 && projectedLoss > hp * 0.28)) && ahead.n > hereT.n + 3;
    if (headingIntoHorde) {
      const g = gapDir(s, px, py, 16, nearestBossE);
      if (g) { vx = g.dx * 1.4; vy = g.dy * 1.4; mode = 'horde-avoid'; }
    }
  }

  const b = s.bounds;
  if (b) {
    if (px < b.x0 + 300) vx += 1.5; if (px > b.x1 - 300) vx -= 1.5;
    if (py < b.y0 + 300) vy += 1.5; if (py > b.y1 - 300) vy -= 1.5;
  }
  const mag = Math.hypot(vx, vy);
  if (mag < 0.25) { const a = ((s.time || 0) * 0.5) % (Math.PI * 2); vx = Math.cos(a) * 0.8; vy = Math.sin(a) * 0.8; }
  else { vx /= mag; vy /= mag; }

  return {
    dx: vx, dy: vy,
    nearest: nearest === Infinity ? null : Math.round(nearest),
    nearestAdd: nearestAdd === Infinity ? null : Math.round(nearestAdd),
    nearestBoss: nearestBoss === Infinity ? null : Math.round(nearestBoss),
    nNear, nEnemies: live, nPickups: (s.pickups || []).length,
    hpFrac, mode, thinReady, timeToBoss, timeToHorde,
    bossId: nearestBossE ? nearestBossE.id : null,
    bossHp: nearestBossE ? nearestBossE.hp : null,
    bossMaxHp: nearestBossE ? nearestBossE.maxHp : null,
    bossBusy: !!bossBusy,
    bossBrain: bossBrain ? { phase: bossBrain.phase, gcd: bossBrain.gcd, skills: bossBrain.skills } : null,
    nearestElite: nearestElite === Infinity ? null : Math.round(nearestElite),
    bestPickup: bestP ? { kind: bestP.kind, d: Math.round(bestP.d), w: bestP.w } : null,
    zeny: s.zeny || 0, chestsOpened: s.chestsOpened || 0,
    dodge: { reasons: dg.reasons, hard: dg.hard },
    rescue: rescue ? { d: Math.round(rescue.d), tReach: rescue.tReach, projected: rescue.projected } : (rescueDenied ? { denied: true, d: rescueDenied.d, projected: rescueDenied.projected } : null),
    rescueKey: rescue ? rescue.meat.x + ',' + rescue.meat.y : null,
    castsExposed: st ? (st.castsExposed || 0) : 0,
    dodges: st ? (st.dodges || 0) : 0,
    nearestMeat: nearestMeat ? Math.round(nearestMeatD) : null,
    mastering,
  };
}

function diagnoseDeath(stats) {
  const buf = (stats && stats.death && stats.death.buf) || [];
  if (buf.length < 2) return { verdict: 'UNKNOWN', reason: 'no buffer' };
  const first = buf[0], last = buf[buf.length - 1];
  const hpLost = Math.max(0, first.hp - last.hp);
  let skillHp = 0, contactHp = 0, otherHp = 0, maxZones = first.zones;
  const skillsNear = new Set();
  for (let i = 1; i < buf.length; i++) {
    const b = buf[i];
    maxZones = Math.max(maxZones, b.zones);
    if (b.dhp < 0) {
      if (b.zones > 0 || (b.imminent && b.imminent.length)) { skillHp += -b.dhp; for (const sk of b.imminent || []) skillsNear.add(sk + ' (hit)'); }
      else if (b.nearest != null && b.nearest < 80) contactHp += -b.dhp;
      else if (b.dhp <= -8) skillHp += -b.dhp;
      else otherHp += -b.dhp;
    }
    if (last.t - b.t <= 2) for (const sk of b.imminent || []) skillsNear.add(sk);
  }
  let verdict = 'UNKNOWN';
  if (hpLost <= 0) verdict = 'UNKNOWN';
  else if (skillHp > contactHp && skillHp >= 0.5 * hpLost) verdict = 'SKILL-OVERLAP';
  else if (contactHp > skillHp && contactHp >= 0.5 * hpLost) verdict = 'PACK-CONTACT';
  else if (skillHp > 0 && contactHp > 0) verdict = 'MIXED';
  else if (skillHp > 0) verdict = 'SKILL-OVERLAP';
  else if (contactHp > 0) verdict = 'PACK-CONTACT';
  const diag = { verdict, windowS: Math.round((last.t - first.t) * 10) / 10, hpLost, skillHp, contactHp, otherHp, maxZones, zonesAtDeath: last.zones, nearestAtDeath: last.nearest, skillsNearDeath: [...skillsNear] };
  if (stats && stats.death) stats.death.diag = diag;
  return diag;
}

module.exports = {
  FALLBACK_BOSS_TIMES,
  SWORD_MIN,
  SWORD_MAX,
  THIN_LIVE,
  THIN_NEAR,
  EMERG_N,
  EMERG_NEAR,
  PRETHIN_WINDOW,
  HORDE_PREP_WINDOW,
  MEAT_RESCUE_RANGE,
  mapBossTimes,
  nextBossTime,
  isValuablePickup,
  valuablePickupTarget,
  victorySweepActive,
  activeBosses,
  isLiveRunState,
  nearestVictoryPickup,
  applySpawnLeash,
  meatRescueOK,
  zonesAtPoint,
  sampleSafeDir,
  dodgeVector,
  engageBand,
  heldGapDir,
  steer,
  diagnoseDeath,
};
