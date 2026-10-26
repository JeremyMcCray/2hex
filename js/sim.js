// NerdHex simulation. Pure data, no DOM. Runs on the host; clients only render snapshots.
import { HEX_SIZE, key, hexDist, hexToPixel, pixelToHex, neighbors, spiral, DIRS } from './hex.js';
import { buildMap, canStep, passableTerrain } from './map.js';
import { UNITS, STRUCTURES, RESEARCH, START, TICK, SURGE_INTERVAL, SWARM_UNIT_CAP, SPAWNER_CAP, SPINE_CAP, LEAVER_REFUND } from './data.js';

const HEXW = HEX_SIZE * Math.sqrt(3); // distance between adjacent hex centers
const ROCK_HP = 3000;
const ACQUIRE_EXTRA = 2;
const LEASH = 6; // hexes an idle unit will chase before returning // hexes beyond weapon range at which units notice enemies
const CREEP_SPEED = 1.35;
const SIDE_OF = owner => owner === 0 ? 'swarm' : 'colony';

export class Sim {
  constructor(playerNames) {
    this.map = buildMap();
    this.time = 0;
    this.tick = 0;
    this.nextId = 1;
    this.ents = new Map();
    this.occ = new Map();      // hex key -> entity id (structures and rocks)
    this.creep = new Set();    // hex keys with creep
    this.winner = null;        // 'swarm' | 'colony'
    this.surges = 0;
    this.events = [];          // transient, cleared each tick, sent in snapshot
    this.players = [0, 1, 2].map(i => ({
      id: i, side: SIDE_OF(i), name: playerNames[i] || ['Swarm', 'Colony A', 'Colony B'][i],
      m: i === 0 ? START.swarm.m : START.colony.m, g: 0,
      energy: START.energyBase, energyCap: START.energyBase,
      supplyUsed: 0, supplyCap: 0,
      research: {}, researching: null,
      connected: true, alive: true,
    }));
    for (const p of this.map.prefab) {
      if (p.kind) this.addStructure(p.kind, p.owner, p.q, p.r, true);
      else this.addUnit(p.unit, p.owner, p.q, p.r);
    }
    for (const h of this.map.rocks) this.addStructure('rock', -1, h.q, h.r, true);
    this.updateCreep();
    this.recomputeCaps();
  }

  // ---------- entity helpers ----------
  tile(q, r) { return this.map.tiles.get(key(q, r)); }
  footprintHexes(kind, q, r) {
    const fp = kind === 'rock' ? 0 : STRUCTURES[kind].footprint;
    return fp ? spiral(q, r, fp) : [{ q, r }];
  }
  addStructure(kind, owner, q, r, complete) {
    const def = kind === 'rock' ? { hp: ROCK_HP, name: 'Rocks' } : STRUCTURES[kind];
    const p = hexToPixel(q, r);
    const e = {
      id: this.nextId++, type: 'structure', kind, owner, q, r, x: p.x, y: p.y,
      hp: complete ? def.hp : Math.max(1, def.hp * 0.1), maxhp: def.hp,
      built: !!complete, progress: complete ? 1 : 0, cd: 0,
      queue: [], trainT: 0, rally: null, target: null,
    };
    this.ents.set(e.id, e);
    for (const h of this.footprintHexes(kind, q, r)) this.occ.set(key(h.q, h.r), e.id);
    return e;
  }
  addUnit(kind, owner, q, r, x, y) {
    const def = UNITS[kind];
    const p = hexToPixel(q, r);
    const e = {
      id: this.nextId++, type: 'unit', kind, owner, q, r,
      x: x ?? p.x + (Math.random() - 0.5) * 10, y: y ?? p.y + (Math.random() - 0.5) * 10,
      hp: def.hp, maxhp: def.hp, cd: 0,
      order: { type: 'idle' }, path: null, target: null, repathT: 0,
      // spawner fields
      spawnType: 'skitter', spawnT: def.interval || 0, aggressive: false, rally: null,
    };
    this.ents.set(e.id, e);
    return e;
  }
  remove(e) {
    this.ents.delete(e.id);
    if (e.type === 'structure') {
      for (const h of this.footprintHexes(e.kind, e.q, e.r)) if (this.occ.get(key(h.q, h.r)) === e.id) this.occ.delete(key(h.q, h.r));
    }
    this.events.push({ ev: 'die', kind: e.kind, x: e.x, y: e.y, owner: e.owner });
  }
  isPassableHex(q, r, forUnit) {
    const t = this.tile(q, r);
    if (!passableTerrain(t)) return false;
    return !this.occ.has(key(q, r));
  }
  count(owner, kind, builtOnly = true) {
    let n = 0;
    for (const e of this.ents.values()) if (e.owner === owner && e.kind === kind && (!builtOnly || e.type === 'unit' || e.built)) n++;
    return n;
  }
  allyOf(owner) { return owner === 1 ? 2 : owner === 2 ? 1 : null; }
  isEnemy(a, b) {
    if (a === b) return false;
    if (b === -1) return true; // rocks can be attacked by anyone
    if (a === -1) return false;
    return SIDE_OF(a) !== SIDE_OF(b);
  }

  // ---------- creep ----------
  updateCreep() {
    const c = new Set();
    for (const e of this.ents.values()) {
      if (e.owner !== 0 || e.hp <= 0) continue;
      let rad = 0;
      if (e.kind === 'hive') rad = 4;
      else if (e.kind === 'nest' && e.built) rad = 2;
      else if (e.kind === 'spine' && e.built) rad = 1;
      else if (e.kind === 'spawner') rad = 2;
      if (!rad) continue;
      for (const h of spiral(e.q, e.r, rad)) {
        const t = this.tile(h.q, h.r);
        if (t && t.t !== 'void') c.add(key(h.q, h.r));
      }
    }
    this.creep = c;
  }

  // ---------- economy ----------
  recomputeCaps() {
    for (const p of this.players) {
      if (p.side !== 'colony') continue;
      let cap = 0, ecap = START.energyBase, used = 0;
      for (const e of this.ents.values()) {
        if (e.owner !== p.id) continue;
        if (e.type === 'structure' && e.built) {
          if (STRUCTURES[e.kind].supply) cap += STRUCTURES[e.kind].supply;
          if (STRUCTURES[e.kind].capacity) ecap += STRUCTURES[e.kind].capacity;
        }
        if (e.type === 'unit') used += UNITS[e.kind].supply || 0;
        if (e.type === 'structure' && e.kind === 'barracks') for (const u of e.queue) used += UNITS[u].supply;
      }
      p.supplyCap = Math.min(cap, 80); p.energyCap = ecap; p.supplyUsed = used;
      if (p.energy > p.energyCap) p.energy = p.energyCap;
    }
  }
  incomeRates() {
    const out = {};
    const spawners = this.count(0, 'spawner');
    const sw = this.players[0];
    let mRate = STRUCTURES.hive.income + this.surges * 20 + (sw.research.evolved ? 40 : 0);
    mRate += this.count(0, 'extractor') * (15 + spawners);
    out[0] = { m: mRate, g: 0, e: 0 };
    for (const id of [1, 2]) {
      let m = 0, g = 0, e = 0;
      for (const en of this.ents.values()) {
        if (en.owner !== id || en.type !== 'structure' || !en.built) continue;
        const d = STRUCTURES[en.kind];
        if (d.income) m += d.income;
        if (d.gasRate) g += d.gasRate;
        if (d.energyRate) e += d.energyRate;
      }
      out[id] = { m, g, e: e + 1 };
    }
    return out;
  }
  canAfford(p, cost) { return p.m >= (cost.m || 0) && p.g >= (cost.g || 0); }
  pay(p, cost) { p.m -= cost.m || 0; p.g -= cost.g || 0; }
  researchCost(p, k) {
    const def = RESEARCH[k];
    const ally = this.allyOf(p.id);
    const disc = ally !== null && this.players[ally].research[k] ? 0.5 : 1;
    return { m: Math.round((def.cost.m || 0) * disc), g: Math.round((def.cost.g || 0) * disc) };
  }

  // ---------- commands ----------
  // cmd: { pid, t, ... }
  apply(cmd) {
    const p = this.players[cmd.pid];
    if (!p || this.winner) return;
    const own = ids => (ids || []).map(id => this.ents.get(id)).filter(e => e && e.owner === cmd.pid);
    switch (cmd.t) {
      case 'move': {
        for (const e of own(cmd.ids)) {
          if (e.type !== 'unit') continue;
          e.order = { type: cmd.atk || cmd.tid ? 'attack' : 'move', q: cmd.q, r: cmd.r };
          e.target = null; e.forced = false; e.path = null; e.repathT = 0;
          if (cmd.tid) { const tg = this.ents.get(cmd.tid); if (tg && this.isEnemy(e.owner, tg.owner) && UNITS[e.kind].dmg > 0) { e.target = tg.id; e.forced = true; e.order = { type: 'attack', q: tg.q, r: tg.r }; } }
        }
        break;
      }
      case 'stop': {
        for (const e of own(cmd.ids)) if (e.type === 'unit') { e.order = { type: 'idle' }; e.path = null; e.target = null; }
        break;
      }
      case 'build': this.cmdBuild(p, cmd.kind, cmd.q, cmd.r); break;
      case 'train': {
        const b = this.ents.get(cmd.id);
        const u = UNITS[cmd.unit];
        if (!b || b.owner !== p.id || b.kind !== 'barracks' || !b.built || !u || u.side !== 'colony') return;
        if (u.tier >= 1 && this.count(p.id, 'techlab') === 0) return this.msg(p, 'Needs a Tech Lab');
        if (b.queue.length >= 5) return;
        if (p.supplyUsed + u.supply > p.supplyCap) return this.msg(p, 'Not enough supply');
        if (!this.canAfford(p, u.cost)) return this.msg(p, 'Not enough resources');
        this.pay(p, u.cost); b.queue.push(cmd.unit); this.recomputeCaps();
        break;
      }
      case 'spawnUnit': {
        for (const e of own(cmd.ids)) if (e.kind === 'spawner' && UNITS[cmd.unit]?.side === 'swarm' && UNITS[cmd.unit].interval) {
          const tier = UNITS[cmd.unit].tier;
          if (tier >= 1 && this.count(0, 'nest') === 0) { this.msg(p, 'Needs a Nest'); return; }
          if (tier >= 2 && !p.research.evolved) { this.msg(p, 'Needs Evolved Hive'); return; }
          e.spawnType = cmd.unit; e.spawnT = Math.min(e.spawnT, UNITS[cmd.unit].interval);
        }
        break;
      }
      case 'spawnMode': for (const e of own(cmd.ids)) if (e.kind === 'spawner') e.aggressive = !!cmd.aggressive; break;
      case 'rally': {
        for (const e of own(cmd.ids)) if (e.kind === 'spawner' || e.kind === 'barracks') e.rally = cmd.q === undefined ? null : { q: cmd.q, r: cmd.r };
        break;
      }
      case 'research': this.cmdResearch(p, cmd.key); break;
      case 'cancelResearch': if (p.researching) { this.pay(p, { m: -p.researching.cost.m, g: -p.researching.cost.g }); p.researching = null; } break;
    }
  }
  msg(p, text) { this.events.push({ ev: 'msg', pid: p.id, text }); }

  validBuild(p, kind, q, r) {
    const def = STRUCTURES[kind];
    if (!def || def.side !== p.side || !def.cost) return 'Cannot build that';
    const t = this.tile(q, r);
    if (!t || t.t === 'void') return 'Blocked';
    for (const h of this.footprintHexes(kind, q, r)) {
      if (!this.isPassableHex(h.q, h.r)) return 'Blocked';
      for (const e of this.ents.values()) if (e.type === 'unit' && e.q === h.q && e.r === h.r) return 'Units in the way';
    }
    if (def.on && t.t !== def.on) return `Must be on a ${def.on === 'gas' ? 'geyser' : 'mineral vein'}`;
    if (!def.on && (t.t === 'mineral' || t.t === 'gas')) return 'Cannot build on a resource';
    if (def.onCreep && !this.creep.has(key(q, r))) return 'Needs creep';
    if (kind === 'spine' && this.count(0, 'spine', false) >= SPINE_CAP) return `Max ${SPINE_CAP} Spines`;
    if (p.side === 'colony' && !def.on) {
      let near = false;
      for (const e of this.ents.values()) {
        if (e.owner === p.id && e.type === 'structure' && hexDist(e.q, e.r, q, r) <= 6) { near = true; break; }
      }
      if (!near) return 'Too far from your structures';
    }
    if (kind === 'techlab' && this.count(p.id, 'barracks') === 0) return 'Needs a Barracks';
    if (!this.canAfford(p, def.cost)) return 'Not enough resources';
    return null;
  }
  cmdBuild(p, kind, q, r) {
    if (kind === 'spawner') {
      if (this.count(0, 'spawner') >= SPAWNER_CAP) return this.msg(p, `Max ${SPAWNER_CAP} Spawners`);
      if (!this.creep.has(key(q, r))) return this.msg(p, 'Spawners hatch on creep');
      if (!this.isPassableHex(q, r)) return this.msg(p, 'Blocked');
      if (!this.canAfford(p, UNITS.spawner.cost)) return this.msg(p, 'Not enough minerals');
      this.pay(p, UNITS.spawner.cost);
      this.addUnit('spawner', 0, q, r);
      return;
    }
    const err = this.validBuild(p, kind, q, r);
    if (err) return this.msg(p, err);
    this.pay(p, STRUCTURES[kind].cost);
    this.addStructure(kind, p.id, q, r, false);
  }
  cmdResearch(p, k) {
    const def = RESEARCH[k];
    if (!def || def.side !== p.side || p.research[k] || p.researching) return;
    for (const r of def.req) if (!p.research[r]) return this.msg(p, `Needs ${RESEARCH[r].name}`);
    if (def.needs && this.count(p.id, def.needs) === 0) return this.msg(p, `Needs a ${STRUCTURES[def.needs].name}`);
    if (p.side === 'colony' && this.count(p.id, 'techlab') === 0) return this.msg(p, 'Needs a Tech Lab');
    const cost = this.researchCost(p, k);
    if (!this.canAfford(p, cost)) return this.msg(p, 'Not enough resources');
    this.pay(p, cost);
    p.researching = { key: k, t: 0, total: def.time, cost };
  }

  // ---------- pathfinding ----------
  findPath(fq, fr, tq, tr) {
    if (fq === tq && fr === tr) return [];
    const startK = key(fq, fr), goalK = key(tq, tr);
    const goalBlocked = !this.isPassableHex(tq, tr);
    const open = [{ k: startK, q: fq, r: fr, g: 0, f: hexDist(fq, fr, tq, tr) }];
    const came = new Map(); const gs = new Map([[startK, 0]]);
    let bestK = startK, bestH = hexDist(fq, fr, tq, tr), expansions = 0;
    const found = (k) => {
      const out = []; let c = k;
      while (c !== startK) { const [q, r] = c.split(',').map(Number); out.push({ q, r }); c = came.get(c); }
      return out.reverse();
    };
    while (open.length && expansions < 2500) {
      let bi = 0; for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const cur = open.splice(bi, 1)[0];
      expansions++;
      if (cur.k === goalK) return found(cur.k);
      const ct = this.tile(cur.q, cur.r);
      for (const [dq, dr] of DIRS) {
        const nq = cur.q + dq, nr = cur.r + dr, nk = key(nq, nr);
        const nt = this.tile(nq, nr);
        if (!canStep(ct, nt)) continue;
        if (nk === goalK && goalBlocked) { came.set(nk, cur.k); return found(cur.k); }
        if (this.occ.has(nk)) continue;
        const ng = cur.g + 1 + (nt.t === 'ramp' ? 0.2 : 0);
        if (ng < (gs.get(nk) ?? Infinity)) {
          gs.set(nk, ng); came.set(nk, cur.k);
          const h = hexDist(nq, nr, tq, tr);
          if (h < bestH) { bestH = h; bestK = nk; }
          open.push({ k: nk, q: nq, r: nr, g: ng, f: ng + h });
        }
      }
    }
    return found(bestK); // closest reachable
  }

  // ---------- main step ----------
  step() {
    if (this.winner) return;
    this.events = [];
    this.time += TICK; this.tick++;
    const rates = this.incomeRates();
    for (const p of this.players) {
      if (!p.alive) continue;
      const r = rates[p.id];
      p.m += r.m / 60 * TICK; p.g += r.g / 60 * TICK;
      if (p.side === 'colony') p.energy = Math.min(p.energyCap, p.energy + r.e * TICK);
      if (p.researching) {
        p.researching.t += TICK;
        if (p.researching.t >= p.researching.total) {
          p.research[p.researching.key] = true;
          this.events.push({ ev: 'msg', pid: p.id, text: `${RESEARCH[p.researching.key].name} complete` });
          p.researching = null;
        }
      }
    }
    // Pressure clock.
    if (Math.floor(this.time / SURGE_INTERVAL) > this.surges) {
      this.surges++;
      for (const e of [...this.ents.values()]) {
        if (e.kind === 'hub' && e.owner > 0 && this.players[e.owner].alive) {
          const spots = neighbors(e.q, e.r).flatMap(h => neighbors(h.q, h.r)).filter(h => this.isPassableHex(h.q, h.r));
          for (let i = 0; i < 2 && spots.length; i++) { const s = spots[(i * 3) % spots.length]; this.addUnit('trooper', e.owner, s.q, s.r); }
        }
      }
      this.events.push({ ev: 'msg', pid: -1, text: `Surge ${this.surges}: Hive income +20/min, each Colony gets 2 Troopers` });
    }
    if (this.tick % 10 === 0) this.updateCreep();

    const units = [], structs = [];
    for (const e of this.ents.values()) (e.type === 'unit' ? units : structs).push(e);

    // Spatial grid for separation and targeting.
    const grid = new Map();
    for (const u of units) {
      const k = key(u.q, u.r);
      let arr = grid.get(k); if (!arr) grid.set(k, arr = []); arr.push(u);
    }

    for (const s of structs) this.stepStructure(s, units);
    for (const u of units) this.stepUnit(u, units, structs, grid);

    // Deaths.
    let capsDirty = false;
    for (const e of [...this.ents.values()]) {
      if (e.hp <= 0) {
        this.remove(e); capsDirty = true;
        if (e.kind === 'hive') this.winner = 'colony';
      }
    }
    if (capsDirty || this.tick % 10 === 0) this.recomputeCaps();
    // Colony loses when both hubs are gone (or dead/left).
    for (const p of this.players) {
      if (p.side === 'colony' && p.alive && this.count(p.id, 'hub') === 0) {
        p.alive = false; this.events.push({ ev: 'msg', pid: -1, text: `${p.name}'s Command Hub has fallen` });
        for (const e of this.ents.values()) if (e.owner === p.id) e.hp = 0; // their stuff powers down
      }
    }
    if (!this.winner && !this.players[1].alive && !this.players[2].alive) this.winner = 'swarm';
    if (!this.winner && !this.players[0].alive) this.winner = 'colony';
  }

  stepStructure(s, units) {
    if (!s.built) {
      const def = STRUCTURES[s.kind];
      s.progress = Math.min(1, s.progress + TICK / def.build);
      s.hp = Math.min(def.hp, s.hp + def.hp * 0.9 * TICK / def.build);
      if (s.progress >= 1) { s.built = true; s.hp = Math.min(s.hp, def.hp); this.recomputeCaps(); }
      return;
    }
    // Training.
    if (s.kind === 'barracks' && s.queue.length) {
      const kind = s.queue[0], u = UNITS[kind];
      s.trainT += TICK;
      if (s.trainT >= u.train) {
        s.trainT = 0; s.queue.shift();
        const spot = neighbors(s.q, s.r).find(h => this.isPassableHex(h.q, h.r)) || { q: s.q + 1, r: s.r };
        const nu = this.addUnit(kind, s.owner, spot.q, spot.r);
        if (s.rally) nu.order = { type: 'attack', q: s.rally.q, r: s.rally.r };
      }
    }
    // Static defense.
    const def = s.kind === 'rock' ? null : STRUCTURES[s.kind];
    if (def && def.dmg) {
      s.cd = Math.max(0, s.cd - TICK);
      if (s.cd <= 0) {
        const range = this.rangeOf(s.owner, def.range);
        const tgt = this.nearestEnemy(s, units, null, range);
        if (tgt) { this.fire(s, tgt, def); }
      }
    }
  }

  rangeOf(owner, base) { return base + (owner > 0 && this.players[owner].research.lenses ? 1 : 0); }
  pxDist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  inRange(a, b, rangeHex) {
    const ra = a.type === 'unit' ? UNITS[a.kind].radius : HEX_SIZE * 0.8;
    const rb = b.type === 'unit' ? UNITS[b.kind].radius : HEX_SIZE * (b.kind !== 'rock' && STRUCTURES[b.kind].footprint ? 1.8 : 0.8);
    const reach = rangeHex <= 1 ? HEXW * 0.75 : rangeHex * HEXW;
    return this.pxDist(a, b) <= reach + ra + rb;
  }
  nearestEnemy(e, units, structs, maxHex, preferUnits = true) {
    const maxPx = maxHex * HEXW + HEX_SIZE * 2;
    let best = null, bd = Infinity;
    const consider = t => {
      if (t.hp <= 0 || !this.isEnemy(e.owner, t.owner)) return;
      if (t.kind === 'rock') return; // rocks are only attacked on explicit orders
      let d = this.pxDist(e, t);
      if (t.type === 'structure' && preferUnits) d += HEXW * 1.5;
      if (d < bd && this.pxDist(e, t) <= maxPx) { bd = d; best = t; }
    };
    for (const u of units) consider(u);
    if (structs) for (const s of structs) consider(s);
    else for (const s of this.ents.values()) if (s.type === 'structure') consider(s);
    return best;
  }
  fire(src, tgt, def) {
    const owner = src.owner;
    let dmg = def.dmg;
    let energyOk = true;
    if (owner > 0 && def.energy) {
      const p = this.players[owner];
      const cost = def.energy * (p.research.conserve ? 0.6 : 1);
      if (p.energy >= cost) p.energy -= cost; else energyOk = false;
    }
    if (!energyOk) dmg *= 0.3;
    if (owner === 0) {
      const p = this.players[0];
      const lvl = (p.research.claws1 ? 1 : 0) + (p.research.claws2 ? 1 : 0) + (p.research.claws3 ? 1 : 0);
      dmg *= 1 + 0.15 * lvl;
    }
    if (tgt.type === 'structure') {
      if (def.bldMult) dmg *= def.bldMult;
      if (owner > 0 && this.players[owner].research.shatter) dmg *= 2;
    }
    const armor = this.armorOf(tgt);
    dmg = Math.max(1, dmg - armor);
    tgt.hp -= dmg;
    src.cd = def.cd;
    this.events.push({ ev: 'shot', x1: src.x, y1: src.y, x2: tgt.x, y2: tgt.y, side: SIDE_OF(owner), weak: !energyOk });
  }
  armorOf(t) {
    if (t.type === 'structure') return (t.kind !== 'rock' && STRUCTURES[t.kind].armor) || 1;
    if (t.owner === 0 && t.kind !== 'spawner') {
      const p = this.players[0];
      return (p.research.carapace1 ? 1 : 0) + (p.research.carapace2 ? 1 : 0) + (p.research.carapace3 ? 1 : 0);
    }
    return 0;
  }

  stepUnit(u, units, structs, grid) {
    const def = UNITS[u.kind];
    u.cd = Math.max(0, u.cd - TICK);
    u.repathT -= TICK;

    // Spawner breeding.
    if (u.kind === 'spawner') {
      const swarmUnits = units.filter(x => x.owner === 0 && x.kind !== 'spawner').length;
      u.spawnT -= TICK;
      if (u.spawnT <= 0) {
        u.spawnT = UNITS[u.spawnType].interval;
        if (swarmUnits < SWARM_UNIT_CAP) {
          const nu = this.addUnit(u.spawnType, 0, u.q, u.r, u.x + (Math.random() - .5) * 20, u.y + (Math.random() - .5) * 20);
          if (u.rally) nu.order = { type: 'attack', q: u.rally.q, r: u.rally.r };
          else if (u.aggressive) {
            const hub = this.nearestHub(u);
            if (hub) nu.order = { type: 'attack', q: hub.q, r: hub.r };
          }
        }
      }
    }

    // Targeting.
    if (def.dmg > 0) {
      const range = this.rangeOf(u.owner, def.range);
      if (u.target) {
        const t = this.ents.get(u.target);
        if (!t || t.hp <= 0 || (!u.forced && this.pxDist(u, t) > (range + ACQUIRE_EXTRA + 2) * HEXW)) { u.target = null; u.forced = false; u.path = null; }
      }
      if (!u.target && u.order.type !== 'move') {
        const t = this.nearestEnemy(u, units, structs, range + ACQUIRE_EXTRA);
        if (t) { u.target = t.id; u.path = null; u.repathT = 0; }
      }
      if (u.target && u.order.type === 'idle' && !u.forced && u.order.q !== undefined && hexDist(u.q, u.r, u.order.q, u.order.r) > LEASH) {
        // Idle units don't chase forever: go back to where they were standing.
        u.target = null; u.order = { type: 'move', q: u.order.q, r: u.order.r, thenIdle: true }; u.path = null;
      }
      if (u.target) {
        const t = this.ents.get(u.target);
        if (this.inRange(u, t, range)) {
          if (u.cd <= 0) this.fire(u, t, def);
          return; // stand and fight
        }
        // chase
        if (!u.path || u.repathT <= 0) { u.path = this.findPath(u.q, u.r, t.q, t.r); u.repathT = 1.0; }
        this.moveAlong(u, def, grid, t);
        return;
      }
    }

    // Orders.
    if (u.order.type === 'move' || u.order.type === 'attack') {
      if (!u.path) u.path = this.findPath(u.q, u.r, u.order.q, u.order.r);
      if (u.path.length === 0 || (u.q === u.order.q && u.r === u.order.r)) {
        u.order = { type: 'idle', q: u.q, r: u.r }; u.path = null; return;
      }
      this.moveAlong(u, def, grid, null);
    } else {
      if (u.order.q === undefined) u.order = { type: 'idle', q: u.q, r: u.r };
      this.separate(u, grid, def);
    }
  }
  nearestHub(e) {
    let best = null, bd = Infinity;
    for (const s of this.ents.values()) if (s.kind === 'hub' && s.hp > 0 && this.players[s.owner].alive) {
      const d = this.pxDist(e, s); if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  moveAlong(u, def, grid, chaseTarget) {
    if (!u.path || !u.path.length) {
      if (chaseTarget) { // path exhausted but not in range: nudge straight at it
        this.nudge(u, def, chaseTarget.x, chaseTarget.y, grid);
      }
      return;
    }
    const wp = u.path[0];
    const p = hexToPixel(wp.q, wp.r);
    // If the next waypoint became blocked, repath.
    if (!this.isPassableHex(wp.q, wp.r)) { u.path = null; u.repathT = 0; return; }
    const d = Math.hypot(p.x - u.x, p.y - u.y);
    if (d < 6) { u.path.shift(); return; }
    this.nudge(u, def, p.x, p.y, grid);
  }
  nudge(u, def, tx, ty, grid) {
    let speed = def.speed * HEXW;
    if (u.owner === 0 && this.creep.has(key(u.q, u.r))) speed *= CREEP_SPEED;
    const d = Math.hypot(tx - u.x, ty - u.y) || 1;
    const stepLen = Math.min(d, speed * TICK);
    let nx = u.x + (tx - u.x) / d * stepLen, ny = u.y + (ty - u.y) / d * stepLen;
    // separation
    const sep = this.separationVec(u, grid, def);
    nx += sep.x; ny += sep.y;
    this.tryPlace(u, nx, ny);
  }
  separate(u, grid, def) {
    const sep = this.separationVec(u, grid, def);
    if (sep.x || sep.y) this.tryPlace(u, u.x + sep.x, u.y + sep.y);
  }
  separationVec(u, grid, def) {
    let sx = 0, sy = 0;
    for (const h of [{ q: u.q, r: u.r }, ...neighbors(u.q, u.r)]) {
      const arr = grid.get(key(h.q, h.r)); if (!arr) continue;
      for (const o of arr) {
        if (o === u) continue;
        const min = def.radius + UNITS[o.kind].radius;
        const dx = u.x - o.x, dy = u.y - o.y;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d < min) { const push = (min - d) * 0.35; sx += dx / d * push; sy += dy / d * push; }
      }
    }
    const m = Math.hypot(sx, sy);
    if (m > 4) { sx *= 4 / m; sy *= 4 / m; }
    return { x: sx, y: sy };
  }
  tryPlace(u, nx, ny) {
    const h = pixelToHex(nx, ny);
    const cur = this.tile(u.q, u.r);
    if (h.q !== u.q || h.r !== u.r) {
      const nt = this.tile(h.q, h.r);
      if (!nt || !canStep(cur, nt) || this.occ.has(key(h.q, h.r))) {
        // slide: try keeping one axis
        const hx = pixelToHex(nx, u.y), hy = pixelToHex(u.x, ny);
        if (this.okHex(cur, hx)) { u.x = nx; u.q = hx.q; u.r = hx.r; return; }
        if (this.okHex(cur, hy)) { u.y = ny; u.q = hy.q; u.r = hy.r; return; }
        return;
      }
      u.q = h.q; u.r = h.r;
    }
    u.x = nx; u.y = ny;
  }
  okHex(cur, h) {
    const t = this.tile(h.q, h.r);
    return t && canStep(cur, t) && !this.occ.has(key(h.q, h.r));
  }

  // ---------- players leaving ----------
  playerLeft(pid) {
    const p = this.players[pid];
    if (!p || !p.connected) return;
    p.connected = false;
    if (this.winner) return;
    if (p.side === 'swarm') { p.alive = false; this.winner = 'colony'; return; }
    const ally = this.allyOf(pid);
    const a = this.players[ally];
    if (a.alive && a.connected) {
      for (const e of this.ents.values()) if (e.owner === pid) e.owner = ally;
      a.m += LEAVER_REFUND + p.m; a.g += p.g;
      for (const k in p.research) a.research[k] = true;
      p.alive = false;
      this.events.push({ ev: 'msg', pid: -1, text: `${p.name} left. ${a.name} takes over their base (+${LEAVER_REFUND} minerals).` });
      this.recomputeCaps();
    } else {
      p.alive = false;
      if (!a.alive) this.winner = 'swarm';
    }
  }

  // ---------- snapshot ----------
  snapshot() {
    const ents = [];
    for (const e of this.ents.values()) {
      ents.push([
        e.id, e.kind, e.owner, Math.round(e.x), Math.round(e.y), Math.round(e.hp), e.maxhp,
        e.type === 'structure' ? (e.built ? 1 : +e.progress.toFixed(2)) : 1,
        e.kind === 'spawner' ? [e.spawnType, e.aggressive ? 1 : 0, e.rally, +e.spawnT.toFixed(1)] : e.kind === 'barracks' ? [e.queue, +e.trainT.toFixed(1), e.rally] : 0,
        e.q, e.r,
      ]);
    }
    return {
      tick: this.tick, time: +this.time.toFixed(1), winner: this.winner, surges: this.surges,
      rates: this.incomeRates(),
      players: this.players.map(p => ({
        id: p.id, side: p.side, name: p.name, m: Math.floor(p.m), g: Math.floor(p.g), energy: Math.floor(p.energy), energyCap: p.energyCap,
        supplyUsed: p.supplyUsed, supplyCap: p.supplyCap, research: p.research,
        researching: p.researching ? { key: p.researching.key, t: +p.researching.t.toFixed(1), total: p.researching.total } : null,
        connected: p.connected, alive: p.alive,
      })),
      creep: [...this.creep],
      ents, events: this.events,
    };
  }
}

export { UNITS, STRUCTURES, RESEARCH, HEXW };
