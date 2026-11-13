const test = require('node:test');
const assert = require('node:assert/strict');

const { gapDir, hordeThreatAt, routeVectorFromPath } = require('./movement-policy');

test('escape path avoids a mob pocket outside the current scan radius', () => {
  const state = {
    bounds: { x0: -2000, x1: 2000, y0: -2000, y1: 2000 },
    enemies: [
      // This pack is outside the old 260px directional scan, but sits where
      // an eastward escape would arrive.
      ...Array.from({ length: 12 }, (_, i) => ({ x: 300 + (i % 4) * 18, y: 120 + Math.floor(i / 4) * 18, damage: 8 })),
    ],
  };

  const vector = gapDir(state, 0, 0, 16, null);
  const destination = { x: vector.dx * 320, y: vector.dy * 320 };
  const threat = hordeThreatAt(state, destination.x, destination.y);

  assert.ok(
    threat.n === 0 || threat.near > 200,
    `escape selected a destination inside the mob pocket: ${JSON.stringify({ vector, threat })}`,
  );
});

test('map route replaces a blocked straight heading with its next waypoint', () => {
  const vector = routeVectorFromPath([{ x: 0, y: 320 }], 0, 0, { dx: 1, dy: 0 });

  assert.ok(vector);
  assert.equal(Math.round(vector.dx * 100), 0);
  assert.equal(Math.round(vector.dy * 100), 100);
  assert.deepEqual(vector.waypoint, { x: 0, y: 320 });
});

test('route helper keeps the caller fallback when no route is available', () => {
  const fallback = { dx: -1, dy: 0 };
  assert.equal(routeVectorFromPath(null, 0, 0, fallback), fallback);
});
