// Canvas renderer for NerdHex. Draws terrain (cached), creep, entities, effects, UI overlays.
import { HEX_SIZE, hexToPixel, corners, key, spiral } from './hex.js';
import { UNITS, STRUCTURES } from './data.js';

export const PLAYER_COLORS = ['#c061ff', '#4da3ff', '#5ad8c8'];
export const PLAYER_DARK = ['#5a1f8a', '#1c4f8a', '#1b6b63'];
const TERRAIN = {
  ground: '#2e3b33', plateau: '#4a4a5e', ramp: '#6a6a7a', void: '#0b0d12',
  mineral: '#2e3b33', gas: '#2e3b33',
};
const HEXW = HEX_SIZE * Math.sqrt(3);

export class Renderer {
  constructor(canvas, map) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = map;
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.effects = [];
    this.buildTerrain();
  }

  buildTerrain() {
    const R = this.map.radius + 1;
    const ext = hexToPixel(R, 0).x + HEX_SIZE * 2;
    this.terrainOrigin = { x: -ext, y: -ext };
    const tc = document.createElement('canvas');
    tc.width = Math.ceil(ext * 2); tc.height = Math.ceil(ext * 2);
    const g = tc.getContext('2d');
    g.fillStyle = TERRAIN.void; g.fillRect(0, 0, tc.width, tc.height);
    g.translate(ext, ext);
    for (const t of this.map.tiles.values()) {
      if (t.t === 'void') continue;
      const p = hexToPixel(t.q, t.r);
      this.hexPath(g, p.x, p.y, HEX_SIZE - 0.6);
      g.fillStyle = TERRAIN[t.t]; g.fill();
      // subtle plateau edge
      if (t.t === 'plateau' || t.t === 'ramp') { g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1; g.stroke(); }
      else { g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1; g.stroke(); }
      if (t.t === 'mineral') this.drawMineral(g, p.x, p.y);
      if (t.t === 'gas') this.drawGas(g, p.x, p.y);
      if (t.t === 'ramp') { g.strokeStyle = 'rgba(255,255,255,0.18)'; for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(p.x - 14, p.y + i * 8); g.lineTo(p.x + 14, p.y + i * 8); g.stroke(); } }
    }
    this.terrain = tc;
    // minimap thumbnail
    const mm = document.createElement('canvas'); mm.width = 200; mm.height = 200;
    const m = mm.getContext('2d');
    m.fillStyle = '#0b0d12'; m.fillRect(0, 0, 200, 200);
    m.drawImage(tc, 0, 0, 200, 200);
    this.minimapBase = mm;
    this.worldExt = ext;
  }
  hexPath(g, x, y, size) {
    const c = corners(x, y, size);
    g.beginPath(); g.moveTo(c[0][0], c[0][1]);
    for (let i = 1; i < 6; i++) g.lineTo(c[i][0], c[i][1]);
    g.closePath();
  }
  drawMineral(g, x, y) {
    g.fillStyle = '#6fe3ff';
    for (const [dx, dy, s] of [[-8, 4, 7], [4, 6, 6], [-1, -6, 8], [9, -4, 5]]) {
      g.beginPath(); g.moveTo(x + dx, y + dy - s); g.lineTo(x + dx + s * 0.7, y + dy); g.lineTo(x + dx, y + dy + s * 0.6); g.lineTo(x + dx - s * 0.7, y + dy); g.closePath(); g.fill();
    }
  }
  drawGas(g, x, y) {
    g.fillStyle = '#1f3a2a'; g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#7dff9a'; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#4caf6a'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.stroke();
  }

  // ---- coordinate transforms ----
  worldToScreen(x, y) {
    const w = this.canvas.width, h = this.canvas.height;
    return { x: (x - this.cam.x) * this.cam.zoom + w / 2, y: (y - this.cam.y) * this.cam.zoom + h / 2 };
  }
  screenToWorld(sx, sy) {
    const w = this.canvas.width, h = this.canvas.height;
    return { x: (sx - w / 2) / this.cam.zoom + this.cam.x, y: (sy - h / 2) / this.cam.zoom + this.cam.y };
  }
  clampCam() {
    const e = this.worldExt;
    this.cam.x = Math.max(-e, Math.min(e, this.cam.x));
    this.cam.y = Math.max(-e, Math.min(e, this.cam.y));
    this.cam.zoom = Math.max(0.35, Math.min(2.2, this.cam.zoom));
  }

  addEffects(events) {
    const now = performance.now();
    for (const ev of events) {
      if (ev.ev === 'shot') this.effects.push({ ...ev, t0: now, dur: 120 });
      else if (ev.ev === 'die') this.effects.push({ ...ev, t0: now, dur: 450 });
    }
  }

  // state: { ents: Map(id -> interpolated ent), creep: Set, players, selected: Set, me, hover, buildKind, buildValid, dragRect }
  draw(state) {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0d12'; ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.scale(this.cam.zoom, this.cam.zoom); ctx.translate(-this.cam.x, -this.cam.y);
    ctx.drawImage(this.terrain, this.terrainOrigin.x, this.terrainOrigin.y);

    // creep
    ctx.fillStyle = 'rgba(150, 60, 220, 0.28)';
    for (const k of state.creep) {
      const [q, r] = k.split(',').map(Number);
      const p = hexToPixel(q, r);
      this.hexPath(ctx, p.x, p.y, HEX_SIZE - 0.5); ctx.fill();
    }

    // rally lines for selected spawners/barracks
    for (const id of state.selected) {
      const e = state.ents.get(id);
      if (e && e.extra && e.extra[2]) {
        const rp = hexToPixel(e.extra[2].q, e.extra[2].r);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(rp.x, rp.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(rp.x, rp.y, 6, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // structures first, then units
    const ents = [...state.ents.values()];
    for (const e of ents) if (STRUCTURES[e.kind] || e.kind === 'rock') this.drawStructure(ctx, e, state);
    for (const e of ents) if (UNITS[e.kind]) this.drawUnit(ctx, e, state);

    // effects
    const now = performance.now();
    this.effects = this.effects.filter(f => now - f.t0 < f.dur);
    for (const f of this.effects) {
      const a = 1 - (now - f.t0) / f.dur;
      if (f.ev === 'shot') {
        ctx.strokeStyle = f.side === 'colony' ? (f.weak ? `rgba(255,120,120,${a})` : `rgba(120,220,255,${a})`) : `rgba(190,255,120,${a})`;
        ctx.lineWidth = f.side === 'colony' ? 2 : 1.5;
        ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.stroke();
      } else if (f.ev === 'die') {
        const r = (UNITS[f.kind]?.radius || 18) * (1 + (1 - a) * 1.5);
        ctx.strokeStyle = `rgba(255,200,120,${a})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // build preview
    if (state.buildKind && state.hover) {
      const p = hexToPixel(state.hover.q, state.hover.r);
      const fp = STRUCTURES[state.buildKind]?.footprint || 0;
      for (const h of spiral(state.hover.q, state.hover.r, fp)) {
        const pp = hexToPixel(h.q, h.r);
        this.hexPath(ctx, pp.x, pp.y, HEX_SIZE - 1);
        ctx.fillStyle = state.buildValid ? 'rgba(120,255,160,0.35)' : 'rgba(255,90,90,0.4)'; ctx.fill();
      }
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(STRUCTURES[state.buildKind]?.name || UNITS[state.buildKind]?.name, p.x, p.y - HEX_SIZE - 6);
    } else if (state.hover && !state.dragRect) {
      const p = hexToPixel(state.hover.q, state.hover.r);
      this.hexPath(ctx, p.x, p.y, HEX_SIZE - 1);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.restore();

    // drag rect (screen space)
    if (state.dragRect) {
      const r = state.dragRect;
      ctx.strokeStyle = '#9fe6a0'; ctx.lineWidth = 1; ctx.fillStyle = 'rgba(159,230,160,0.12)';
      ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0); ctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    }
  }

  colorOf(e) { return e.owner < 0 ? '#7b6f5c' : PLAYER_COLORS[e.owner]; }

  drawStructure(ctx, e, state) {
    const def = e.kind === 'rock' ? null : STRUCTURES[e.kind];
    const fp = def?.footprint || 0;
    const size = fp ? HEX_SIZE * 2.4 : HEX_SIZE * 0.82;
    const col = this.colorOf(e);
    const sel = state.selected.has(e.id);
    if (e.kind === 'rock') {
      ctx.fillStyle = '#6b6258'; this.hexPath(ctx, e.x, e.y, HEX_SIZE * 0.8); ctx.fill();
      ctx.fillStyle = '#8a8070';
      for (const [dx, dy, r] of [[-7, -4, 8], [6, 2, 9], [-2, 8, 6]]) { ctx.beginPath(); ctx.arc(e.x + dx, e.y + dy, r, 0, Math.PI * 2); ctx.fill(); }
    } else {
      ctx.fillStyle = e.progress < 1 ? 'rgba(0,0,0,0.5)' : PLAYER_DARK[e.owner];
      this.hexPath(ctx, e.x, e.y, size); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = sel ? 3 : 2; ctx.stroke();
      if (e.progress < 1) { // construction wedge
        ctx.fillStyle = col; ctx.globalAlpha = 0.35;
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.arc(e.x, e.y, size * 0.8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * e.progress); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
      }
      this.drawStructureIcon(ctx, e, size, col);
    }
    if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); this.hexPath(ctx, e.x, e.y, size + 5); ctx.stroke(); ctx.setLineDash([]); }
    if (e.hp < e.maxhp || sel) this.hpBar(ctx, e.x, e.y - size - 8, size * 1.6, e.hp / e.maxhp, col);
  }
  drawStructureIcon(ctx, e, size, col) {
    const { x, y } = e;
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2;
    const s = size * 0.5;
    switch (e.kind) {
      case 'hive': // layered blob
        ctx.beginPath(); ctx.arc(x, y, s * 1.2, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, s * 0.6, 0, Math.PI * 2); ctx.fill();
        for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; ctx.beginPath(); ctx.arc(x + Math.cos(a) * s * 1.2, y + Math.sin(a) * s * 1.2, s * 0.3, 0, Math.PI * 2); ctx.fill(); }
        break;
      case 'hub': // cross + ring
        ctx.beginPath(); ctx.arc(x, y, s * 1.1, 0, Math.PI * 2); ctx.stroke();
        ctx.fillRect(x - s * 0.15, y - s * 0.8, s * 0.3, s * 1.6); ctx.fillRect(x - s * 0.8, y - s * 0.15, s * 1.6, s * 0.3);
        break;
      case 'extractor': ctx.beginPath(); ctx.arc(x, y, s * 0.9, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, s * 0.35, 0, Math.PI * 2); ctx.fill(); break;
      case 'nest': for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(x + Math.cos(i * 2.1) * s * 0.5, y + Math.sin(i * 2.1) * s * 0.5, s * 0.4, 0, Math.PI * 2); ctx.fill(); } break;
      case 'spine': ctx.beginPath(); ctx.moveTo(x - s * 0.8, y + s * 0.8); ctx.lineTo(x, y - s); ctx.lineTo(x + s * 0.8, y + s * 0.8); ctx.stroke(); break;
      case 'barracks': ctx.strokeRect(x - s * 0.9, y - s * 0.6, s * 1.8, s * 1.2); ctx.fillRect(x - s * 0.25, y - s * 0.1, s * 0.5, s * 0.7); break;
      case 'generator': ctx.beginPath(); ctx.moveTo(x + s * 0.2, y - s); ctx.lineTo(x - s * 0.4, y + s * 0.1); ctx.lineTo(x + s * 0.1, y + s * 0.1); ctx.lineTo(x - s * 0.2, y + s); ctx.stroke(); break;
      case 'battery': ctx.strokeRect(x - s * 0.5, y - s * 0.8, s, s * 1.6); ctx.fillRect(x - s * 0.5, y - s * 0.1, s, s * 0.9); break;
      case 'turret': ctx.beginPath(); ctx.arc(x, y, s * 0.5, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + s, y - s * 0.6); ctx.stroke(); break;
      case 'wall': ctx.fillRect(x - s * 0.9, y - s * 0.5, s * 1.8, s); break;
      case 'refinery': ctx.beginPath(); ctx.arc(x, y, s * 0.8, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = '#7dff9a'; ctx.beginPath(); ctx.arc(x, y, s * 0.35, 0, Math.PI * 2); ctx.fill(); break;
      case 'rig': ctx.beginPath(); ctx.moveTo(x - s, y + s * 0.6); ctx.lineTo(x, y - s * 0.8); ctx.lineTo(x + s, y + s * 0.6); ctx.closePath(); ctx.stroke(); break;
      case 'techlab': ctx.beginPath(); ctx.arc(x, y, s * 0.9, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, s * 0.4, 0, Math.PI * 2); ctx.stroke(); ctx.fillRect(x - 1, y - s, 2, s * 2); break;
      case 'depot': ctx.strokeRect(x - s * 0.8, y - s * 0.8, s * 1.6, s * 1.6); ctx.beginPath(); ctx.moveTo(x - s * 0.8, y); ctx.lineTo(x + s * 0.8, y); ctx.stroke(); break;
    }
  }
  drawUnit(ctx, e, state) {
    const def = UNITS[e.kind];
    const col = this.colorOf(e);
    const sel = state.selected.has(e.id);
    const r = def.radius;
    if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(e.x, e.y, r + 4, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = col; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.2;
    switch (e.kind) {
      case 'spawner':
        ctx.beginPath(); ctx.ellipse(e.x, e.y, r, r * 0.8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = PLAYER_DARK[0]; ctx.beginPath(); ctx.arc(e.x, e.y, r * 0.45, 0, Math.PI * 2); ctx.fill();
        if (e.extra) { // spawn progress ring
          const def2 = UNITS[e.extra[0]]; const frac = 1 - e.extra[3] / def2.interval;
          ctx.strokeStyle = e.extra[1] ? '#ff8a5c' : '#fff'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(e.x, e.y, r + 1, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
        }
        break;
      case 'lancer':
        ctx.beginPath(); ctx.moveTo(e.x, e.y - r); ctx.lineTo(e.x + r, e.y + r * 0.8); ctx.lineTo(e.x - r, e.y + r * 0.8); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
      case 'behemoth':
        ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = PLAYER_DARK[0]; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(e.x + Math.cos(i * 2.1) * r * 0.5, e.y + Math.sin(i * 2.1) * r * 0.5, r * 0.25, 0, Math.PI * 2); ctx.fill(); }
        break;
      case 'trooper': case 'gunner':
        ctx.fillRect(e.x - r * 0.8, e.y - r * 0.8, r * 1.6, r * 1.6); ctx.strokeRect(e.x - r * 0.8, e.y - r * 0.8, r * 1.6, r * 1.6);
        if (e.kind === 'gunner') { ctx.fillStyle = '#fff'; ctx.fillRect(e.x - 2, e.y - 2, 4, 4); }
        break;
      default:
        ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (e.kind === 'striker') { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(e.x, e.y, r * 0.3, 0, Math.PI * 2); ctx.fill(); }
    }
    if (e.hp < e.maxhp || sel) this.hpBar(ctx, e.x, e.y - r - 7, r * 2.4, e.hp / e.maxhp, col);
  }
  hpBar(ctx, x, y, w, frac, col) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x - w / 2, y, w, 4);
    ctx.fillStyle = frac > 0.5 ? '#6fdc6f' : frac > 0.25 ? '#ffc44d' : '#ff5c5c';
    ctx.fillRect(x - w / 2, y, w * Math.max(0, frac), 4);
  }

  drawMinimap(mctx, size, state) {
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.drawImage(this.minimapBase, 0, 0, size, size);
    const sc = size / (this.worldExt * 2);
    const tx = x => (x + this.worldExt) * sc, ty = y => (y + this.worldExt) * sc;
    for (const k of state.creep) { const [q, r] = k.split(',').map(Number); const p = hexToPixel(q, r); mctx.fillStyle = 'rgba(150,60,220,0.5)'; mctx.fillRect(tx(p.x) - 1, ty(p.y) - 1, 3, 3); }
    for (const e of state.ents.values()) {
      if (e.kind === 'rock') continue;
      mctx.fillStyle = this.colorOf(e);
      const s = STRUCTURES[e.kind] ? (STRUCTURES[e.kind].footprint ? 7 : 4) : 2.5;
      mctx.fillRect(tx(e.x) - s / 2, ty(e.y) - s / 2, s, s);
    }
    const W = this.canvas.width / this.cam.zoom, H = this.canvas.height / this.cam.zoom;
    mctx.strokeStyle = '#fff'; mctx.lineWidth = 1;
    mctx.strokeRect(tx(this.cam.x - W / 2), ty(this.cam.y - H / 2), W * sc, H * sc);
  }
  minimapToWorld(mx, my, size) {
    const sc = size / (this.worldExt * 2);
    return { x: mx / sc - this.worldExt, y: my / sc - this.worldExt };
  }
}
