// Axial hex coordinates, pointy-top layout.
export const HEX_SIZE = 28; // px, center to corner

export const DIRS = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

export function key(q, r) { return q + ',' + r; }
export function parseKey(k) { const [q, r] = k.split(',').map(Number); return { q, r }; }

export function hexDist(aq, ar, bq, br) {
  const dq = aq - bq, dr = ar - br;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

export function hexToPixel(q, r, size = HEX_SIZE) {
  return {
    x: size * Math.sqrt(3) * (q + r / 2),
    y: size * 1.5 * r,
  };
}

export function pixelToHex(x, y, size = HEX_SIZE) {
  const qf = (Math.sqrt(3) / 3 * x - 1 / 3 * y) / size;
  const rf = (2 / 3 * y) / size;
  return hexRound(qf, rf);
}

export function hexRound(qf, rf) {
  const sf = -qf - rf;
  let q = Math.round(qf), r = Math.round(rf), s = Math.round(sf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

export function neighbors(q, r) {
  return DIRS.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
}

export function ring(cq, cr, radius) {
  const out = [];
  if (radius === 0) return [{ q: cq, r: cr }];
  let q = cq + DIRS[4][0] * radius, r = cr + DIRS[4][1] * radius;
  for (let side = 0; side < 6; side++) {
    for (let i = 0; i < radius; i++) {
      out.push({ q, r });
      q += DIRS[side][0]; r += DIRS[side][1];
    }
  }
  return out;
}

export function spiral(cq, cr, radius) {
  const out = [];
  for (let k = 0; k <= radius; k++) out.push(...ring(cq, cr, k));
  return out;
}

// Polygon corners for drawing.
export function corners(cx, cy, size = HEX_SIZE) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i - 30);
    pts.push([cx + size * Math.cos(a), cy + size * Math.sin(a)]);
  }
  return pts;
}
