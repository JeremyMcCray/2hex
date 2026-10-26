import { key, hexDist, hexToPixel, ring, spiral, DIRS } from './hex.js';

export const MAP_RADIUS = 22;

// Player 0 = Swarm (center). Players 1 and 2 = Colony bases.
export const BASES = [
  { q: 16, r: -8 },
  { q: -16, r: 8 },
];

function angleBetween(a, b) {
  const pa = hexToPixel(a.q, a.r), pb = hexToPixel(b.q, b.r);
  return Math.atan2(pb.y - pa.y, pb.x - pa.x);
}
function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}
const deg = d => d * Math.PI / 180;

// Tile on `ringN` around center whose direction is closest to angle `ang`.
function ringTileAt(center, ringN, ang) {
  let best = null, bd = Infinity;
  for (const h of ring(center.q, center.r, ringN)) {
    const d = angDiff(angleBetween(center, h), ang);
    if (d < bd) { bd = d; best = h; }
  }
  return best;
}

export function buildMap() {
  const tiles = new Map();
  const center = { q: 0, r: 0 };
  const set = (h, t, extra = {}) => {
    const tile = tiles.get(key(h.q, h.r));
    if (tile) Object.assign(tile, { t }, extra);
  };

  for (const h of spiral(0, 0, MAP_RADIUS)) {
    tiles.set(key(h.q, h.r), { q: h.q, r: h.r, t: 'ground', elev: 0 });
  }

  // Central plateau for the Swarm.
  for (const h of spiral(0, 0, 3)) set(h, 'plateau', { elev: 1 });
  // Minerals around the hive on ring 2, every other tile.
  ring(0, 0, 2).forEach((h, i) => { if (i % 2 === 0) set(h, 'mineral', { elev: 1 }); });

  // Ramps on ring 4, pointed at each base.
  for (const b of BASES) {
    const a = angleBetween(center, b);
    for (const h of ring(0, 0, 4)) {
      if (angDiff(angleBetween(center, h), a) < deg(22)) set(h, 'ramp', { elev: 0.5 });
    }
  }

  // Colony bases.
  const prefab = []; // pre-placed structures and units
  const rocks = [];
  BASES.forEach((b, i) => {
    const owner = i + 1;
    const toCenter = angleBetween(b, center);
    const away = toCenter + Math.PI;
    // Ring 4 = wall of void with a front entrance and a rock-sealed back.
    for (const h of ring(b.q, b.r, 4)) {
      const a = angleBetween(b, h);
      if (angDiff(a, toCenter) < deg(28)) continue;           // entrance stays ground
      if (angDiff(a, away) < deg(20)) { rocks.push(h); continue; } // back door
      set(h, 'void');
    }
    // Rings 5-6: void except the back pocket (which holds a geyser).
    for (const n of [5, 6]) {
      for (const h of ring(b.q, b.r, n)) {
        if (!tiles.has(key(h.q, h.r))) continue;
        const a = angleBetween(b, h);
        if (n === 5 && angDiff(a, away) < deg(26)) continue; // pocket
        if (angDiff(a, toCenter) < deg(40)) continue; // keep the approach open
        set(h, 'void');
      }
    }
    const pocketGas = ringTileAt(b, 5, away);
    set(pocketGas, 'gas');
    // Minerals inside the base on ring 3.
    for (const off of [90, 180, 270]) set(ringTileAt(b, 3, toCenter + deg(off)), 'mineral');
    // Starting buildings.
    prefab.push({ kind: 'hub', owner, q: b.q, r: b.r });
    prefab.push({ kind: 'barracks', owner, ...ringTileAt(b, 2, toCenter) });
    prefab.push({ kind: 'generator', owner, ...ringTileAt(b, 2, toCenter + deg(120)) });
    prefab.push({ kind: 'battery', owner, ...ringTileAt(b, 2, toCenter - deg(120)) });
    for (const off of [-50, -30, -10, 10, 30, 50]) prefab.push({ unit: 'trooper', owner, ...ringTileAt(b, 3, toCenter + deg(off)) });
    // Two side geysers in the neutral zone near the base front.
    for (const off of [50, -50]) set(ringTileAt(b, 7, toCenter + deg(off)), 'gas');
  });

  // Contested geysers north and south, plus rock clumps as cover.
  const nAng = angleBetween(center, BASES[0]) - deg(90);
  const sAng = nAng + Math.PI;
  for (const a of [nAng, sAng]) {
    set(ringTileAt(center, 13, a), 'gas');
    const clump = ringTileAt(center, 9, a);
    rocks.push(clump, ...ring(clump.q, clump.r, 1).filter((_, i) => i % 2 === 0));
    for (const h of ring(center.q, center.r, 18)) {
      if (angDiff(angleBetween(center, h), a) < deg(14)) set(h, 'void');
    }
  }

  prefab.push({ kind: 'hive', owner: 0, q: 0, r: 0 });

  return { tiles, prefab, rocks: rocks.filter(h => tiles.get(key(h.q, h.r))?.t === 'ground'), radius: MAP_RADIUS };
}

export function tileAt(map, q, r) { return map.tiles.get(key(q, r)); }

export function passableTerrain(tile) {
  return !!tile && tile.t !== 'void';
}

// Can a unit step between two adjacent tiles given elevation?
export function canStep(a, b) {
  if (!passableTerrain(a) || !passableTerrain(b)) return false;
  if (a.elev === b.elev) return true;
  return a.t === 'ramp' || b.t === 'ramp';
}

export { DIRS, hexDist };
