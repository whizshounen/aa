'use strict';

const BOSS_MAX_SKILL_RANGE = 700;
const ESCAPE_DISTANCE = 320;

function hordeThreatAt(s, x, y) {
  let n = 0, dmg = 0, near = Infinity;
  for (const e of (s && s.enemies) || []) {
    if (!e || e.dead) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < near) near = d;
    if (d < 220) { n++; dmg += (e.damage || 4); }
  }
  return { n, dmg, near };
}

function pathThreat(s, px, py, ux, uy) {
  let maxN = 0, maxDmg = 0, minNear = Infinity, sumN = 0;
  // A cone-only check misses a pack just beyond the current 260px radius.
  // Score the actual route the player will travel, not just the ray at the
  // player's current position.
  for (const distance of [80, 160, 240, ESCAPE_DISTANCE]) {
    const threat = hordeThreatAt(s, px + ux * distance, py + uy * distance);
    maxN = Math.max(maxN, threat.n);
    maxDmg = Math.max(maxDmg, threat.dmg);
    minNear = Math.min(minNear, threat.near);
    sumN += threat.n;
  }
  return { maxN, maxDmg, minNear, sumN };
}

// Convert the game's map route into an input vector. `walk.pathTo()` returns
// the next meaningful waypoint, not the current position, so skip any point
// that is already underneath the player before choosing the heading.
function routeVectorFromPath(route, px, py, fallback = null) {
  if (Array.isArray(route)) {
    for (const point of route) {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      const dx = point.x - px, dy = point.y - py, distance = Math.hypot(dx, dy);
      if (distance > 8) return { dx: dx / distance, dy: dy / distance, distance, waypoint: { x: point.x, y: point.y } };
    }
  }
  return fallback;
}

function gapDir(s, px, py, nDirs = 16, bossE = null) {
  // Score the full escape path. Lower score is safer.
  const b = s.bounds;
  let best = null;
  for (let k = 0; k < nDirs; k++) {
    const a = k * Math.PI * 2 / nDirs, ux = Math.cos(a), uy = Math.sin(a);
    let cone = 0, coneMin = Infinity;
    for (const e of s.enemies || []) {
      if (!e || e.dead) continue;
      const rx = e.x - px, ry = e.y - py, d = Math.hypot(rx, ry) || 1;
      if (d > 260) continue;
      const along = (rx * ux + ry * uy) / d;
      if (along > 0.5) { cone++; if (d < coneMin) coneMin = d; }
    }

    const route = pathThreat(s, px, py, ux, uy);
    const destination = hordeThreatAt(s, px + ux * ESCAPE_DISTANCE, py + uy * ESCAPE_DISTANCE);
    // The route and its destination dominate the old cone score. This stops
    // an escape from choosing a direction that looks empty now but ends in a
    // newly spawned pack.
    let score = route.sumN * 18 + route.maxN * 42 + route.maxDmg * 1.5;
    score += destination.n * 35 + Math.max(0, 180 - destination.near) * 3;
    score += cone * 12 + (coneMin === Infinity ? 0 : Math.max(0, 220 - coneMin));
    if (route.minNear < 45) score += 180;

    if (bossE) {
      const bdx = px + ux * 200 - bossE.x, bdy = py + uy * 200 - bossE.y;
      if (Math.hypot(bdx, bdy) < BOSS_MAX_SKILL_RANGE) score += 200;
    }
    if (b) {
      const ex = px + ux * ESCAPE_DISTANCE, ey = py + uy * ESCAPE_DISTANCE;
      if (ex < b.x0 + 150 || ex > b.x1 - 150 || ey < b.y0 + 150 || ey > b.y1 - 150) score += 120;
    }
    if (!best || score < best.score) best = { dx: ux, dy: uy, score, cone, route, destination };
  }
  return best;
}

module.exports = { gapDir, hordeThreatAt, pathThreat, routeVectorFromPath };
