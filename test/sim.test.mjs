import { Sim } from '../js/sim.js';
import { BASES } from '../js/map.js';
import { key } from '../js/hex.js';

const sim = new Sim(['S', 'A', 'B']);
const counts = {};
for (const t of sim.map.tiles.values()) counts[t.t] = (counts[t.t] || 0) + 1;
console.log('tiles', counts, 'rocks', sim.map.rocks.length, 'ents', sim.ents.size);
console.log('creep', sim.creep.size);

// Swarm: place extractors on all minerals on plateau, a nest, spawners.
let placed = 0;
for (const t of sim.map.tiles.values()) if (t.t === 'mineral' && t.elev === 1) { sim.apply({ pid: 0, t: 'build', kind: 'extractor', q: t.q, r: t.r }); placed++; }
// nest on a creep plateau tile not occupied
let nestDone = false;
for (const k of sim.creep) { const t = sim.map.tiles.get(k); if (t.t === 'plateau' && !sim.occ.has(k) && !nestDone) { sim.apply({ pid: 0, t: 'build', kind: 'nest', q: t.q, r: t.r }); nestDone = true; } }
for (let i = 0; i < 3; i++) for (const k of sim.creep) { const t = sim.map.tiles.get(k); if (t.t === 'ramp' && !sim.occ.has(k)) { sim.apply({ pid: 0, t: 'build', kind: 'spawner', q: t.q, r: t.r }); break; } }
console.log('swarm ents after build', [...sim.ents.values()].filter(e => e.owner === 0).map(e => e.kind));
console.log('events', sim.events);
// make spawners aggressive
const spawners = [...sim.ents.values()].filter(e => e.kind === 'spawner').map(e => e.id);
sim.apply({ pid: 0, t: 'spawnMode', ids: spawners, aggressive: true });

// Colony A trains troopers and researches; B builds turret.
const barrA = [...sim.ents.values()].find(e => e.kind === 'barracks' && e.owner === 1);
for (let i = 0; i < 4; i++) sim.apply({ pid: 1, t: 'train', id: barrA.id, unit: 'trooper' });
// path test: send A troopers to the hive
const troopersA = [...sim.ents.values()].filter(e => e.kind === 'trooper' && e.owner === 1).map(e => e.id);
const path = sim.findPath(BASES[0].q-3, BASES[0].r, 0, 0);
console.log('path base->hive length', path.length, 'last', path[path.length - 1]);
const pathBB = sim.findPath(BASES[0].q-3, BASES[0].r, BASES[1].q+3, BASES[1].r);
console.log('path base->base length', pathBB.length);

const t0 = Date.now();
for (let i = 0; i < 9000; i++) { // 15 minutes
  sim.step();
  if (i % 20 === 0) {
    // swarm script: spawners first (aggressive), then extractors, then nest
    if (sim.count(0,'spawner') < 4 && sim.players[0].m >= 150) { for (const k of sim.creep) { const t = sim.map.tiles.get(k); if (t.t === 'ramp' && !sim.occ.has(k)) { sim.apply({ pid: 0, t: 'build', kind: 'spawner', q: t.q, r: t.r }); break; } } sim.apply({ pid: 0, t: 'spawnMode', ids: [...sim.ents.values()].filter(e => e.kind === 'spawner').map(e => e.id), aggressive: true }); }
    else if (sim.count(0,'extractor',false) < 6 && sim.players[0].m >= 100) { for (const t of sim.map.tiles.values()) if (t.t === 'mineral' && t.elev === 1 && !sim.occ.has(key(t.q,t.r))) { sim.apply({ pid: 0, t: 'build', kind: 'extractor', q: t.q, r: t.r }); break; } }
    // colony script: both train troopers whenever affordable, add generator at 2min
    for (const pid of [1,2]) { const b = [...sim.ents.values()].find(e => e.kind === 'barracks' && e.owner === pid); if (b && b.queue.length < 2 && sim.players[pid].m >= 50) sim.apply({ pid, t: 'train', id: b.id, unit: 'trooper' }); }
  }
  if (i % 600 === 0) {
    const n = {}; for (const e of sim.ents.values()) n[e.owner + ':' + e.kind] = (n[e.owner + ':' + e.kind] || 0) + 1;
    console.log(`t=${sim.time.toFixed(0)}s m0=${sim.players[0].m.toFixed(0)} m1=${sim.players[1].m.toFixed(0)} e1=${sim.players[1].energy.toFixed(0)} rates`, JSON.stringify(sim.incomeRates()), JSON.stringify(n));
  }
  for (const ev of sim.events) if (ev.ev === 'msg') console.log('  msg', ev.text);
  if (sim.winner) { console.log('winner', sim.winner, 'at', sim.time); break; }
}
console.log('6000 ticks in', Date.now() - t0, 'ms; snapshot bytes', JSON.stringify(sim.snapshot()).length);
const hubs = [...sim.ents.values()].filter(e => e.kind === 'hub').map(e => [e.owner, e.hp]);
console.log('hubs', hubs, 'hive', [...sim.ents.values()].find(e => e.kind === 'hive')?.hp);
sim.playerLeft(2);
console.log('after B leaves: A minerals', sim.players[1].m.toFixed(0), 'B alive', sim.players[2].alive, 'A owns hubs', sim.count(1, 'hub'));
