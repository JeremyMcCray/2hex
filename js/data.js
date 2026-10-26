// All balance data for NerdHex. Sides: 'swarm' (1 player) and 'colony' (2 players).
// Speeds are hexes per second, ranges in hexes, cooldowns in seconds.

export const TICK = 0.1;            // seconds per sim tick
export const SURGE_INTERVAL = 240;  // seconds between pressure-clock surges
export const SWARM_UNIT_CAP = 140;
export const SPAWNER_CAP = 8;
export const SPINE_CAP = 6;
export const LEAVER_REFUND = 300;

export const UNITS = {
  // ---- Swarm ----
  skitter:  { side: 'swarm', name: 'Skitter',  hp: 35,  dmg: 4,  range: 1, speed: 2.2, cd: 0.6, radius: 7,  interval: 6,  tier: 0, desc: 'Cheap, fast melee. Spawned quickly.' },
  striker:  { side: 'swarm', name: 'Striker',  hp: 65,  dmg: 12, range: 1, speed: 2.0, cd: 0.8, radius: 8,  interval: 6,  tier: 1, desc: 'Hard-hitting melee. Needs a Nest.' },
  lancer:   { side: 'swarm', name: 'Lancer',   hp: 70,  dmg: 10, range: 4, speed: 1.6, cd: 1.0, radius: 8,  interval: 8,  tier: 1, desc: 'Ranged acid spitter. Needs a Nest.' },
  behemoth: { side: 'swarm', name: 'Behemoth', hp: 520, dmg: 40, range: 1, speed: 1.2, cd: 1.5, radius: 14, interval: 25, tier: 2, bldMult: 3, desc: 'Siege beast, triple damage to structures. Needs Evolved Hive.' },
  spawner:  { side: 'swarm', name: 'Spawner',  hp: 420, dmg: 0,  range: 0, speed: 0.7, cd: 0,   radius: 13, cost: { m: 150 }, desc: 'Mobile breeding pod. Spawns units for free and boosts Extractor income.' },
  // ---- Colony ----
  trooper:  { side: 'colony', name: 'Trooper', hp: 45,  dmg: 6,  range: 4, speed: 1.8, cd: 0.7, radius: 7, energy: 1, cost: { m: 50 },         supply: 1, train: 8,  tier: 0, desc: 'Laser rifle infantry. 1 energy per shot.' },
  gunner:   { side: 'colony', name: 'Gunner',  hp: 120, dmg: 18, range: 5, speed: 1.4, cd: 1.0, radius: 9, energy: 3, cost: { m: 100, g: 50 }, supply: 2, train: 14, tier: 1, desc: 'Heavy laser. 3 energy per shot. Needs a Tech Lab.' },
};

export const STRUCTURES = {
  // ---- Swarm ----
  hive:      { side: 'swarm', name: 'Hive',      hp: 4500, armor: 3, footprint: 1, income: 80, desc: 'Lose it and the Swarm loses.' },
  extractor: { side: 'swarm', name: 'Extractor', hp: 500,  footprint: 0, cost: { m: 100 }, on: 'mineral', build: 15, desc: 'Mines a mineral vein. Income grows with every Spawner alive.' },
  nest:      { side: 'swarm', name: 'Nest',      hp: 900,  footprint: 0, cost: { m: 250 }, build: 30, onCreep: true, desc: 'Unlocks Strikers and Lancers.' },
  spine:     { side: 'swarm', name: 'Spine',     hp: 350,  footprint: 0, cost: { m: 150 }, build: 20, onCreep: true, dmg: 20, range: 5, cd: 1.2, desc: 'Static defense on creep.' },
  // ---- Colony ----
  hub:       { side: 'colony', name: 'Command Hub', hp: 3500, armor: 3, footprint: 1, income: 60, supply: 15, desc: 'Lose both Hubs and the Colony loses.' },
  barracks:  { side: 'colony', name: 'Barracks',    hp: 1000, footprint: 0, cost: { m: 150 }, build: 25, desc: 'Trains Troopers and Gunners.' },
  generator: { side: 'colony', name: 'Generator',   hp: 600,  footprint: 0, cost: { m: 100 }, build: 20, energyRate: 3, desc: '+3 energy per second.' },
  battery:   { side: 'colony', name: 'Battery',     hp: 400,  footprint: 0, cost: { m: 75 },  build: 12, capacity: 150, desc: '+150 energy storage.' },
  turret:    { side: 'colony', name: 'Laser Turret',hp: 500,  footprint: 0, cost: { m: 150 }, build: 20, dmg: 14, range: 5, cd: 0.8, energy: 2, desc: 'Static laser. 2 energy per shot.' },
  wall:      { side: 'colony', name: 'Wall',        hp: 450,  footprint: 0, cost: { m: 25 },  build: 6,  desc: 'Cheap blocker.' },
  refinery:  { side: 'colony', name: 'Refinery',    hp: 500,  footprint: 0, cost: { m: 100 }, build: 20, on: 'gas', gasRate: 30, desc: 'On a geyser. +30 gas per minute.' },
  rig:       { side: 'colony', name: 'Mining Rig',  hp: 500,  footprint: 0, cost: { m: 75 },  build: 15, on: 'mineral', income: 25, desc: 'On a mineral vein. +25 minerals per minute.' },
  techlab:   { side: 'colony', name: 'Tech Lab',    hp: 700,  footprint: 0, cost: { m: 150, g: 50 }, build: 25, desc: 'Unlocks Gunners and research.' },
  depot:     { side: 'colony', name: 'Supply Depot',hp: 400,  footprint: 0, cost: { m: 75 },  build: 12, supply: 8, desc: '+8 supply.' },
};

// Research. Colony techs are discounted 50% if the ally already has them.
export const RESEARCH = {
  // Swarm (bought at the Hive)
  claws1:    { side: 'swarm', name: 'Claws I',    cost: { m: 150 }, time: 40, req: [],            desc: '+15% unit damage.' },
  claws2:    { side: 'swarm', name: 'Claws II',   cost: { m: 250 }, time: 50, req: ['claws1'],    desc: '+15% unit damage.' },
  claws3:    { side: 'swarm', name: 'Claws III',  cost: { m: 350 }, time: 60, req: ['claws2'],    desc: '+15% unit damage.' },
  carapace1: { side: 'swarm', name: 'Carapace I', cost: { m: 150 }, time: 40, req: [],            desc: '+1 armor.' },
  carapace2: { side: 'swarm', name: 'Carapace II',cost: { m: 250 }, time: 50, req: ['carapace1'], desc: '+1 armor.' },
  carapace3: { side: 'swarm', name: 'Carapace III',cost:{ m: 350 }, time: 60, req: ['carapace2'], desc: '+1 armor.' },
  evolved:   { side: 'swarm', name: 'Evolved Hive',cost:{ m: 500 }, time: 60, req: [], needs: 'nest', desc: 'Unlocks Behemoths. Hive income +40/min.' },
  // Colony (bought at the Tech Lab)
  shatter:   { side: 'colony', name: 'Shattering Laser', cost: { m: 150, g: 100 }, time: 45, req: [], desc: 'Lasers deal double damage to structures.' },
  conserve:  { side: 'colony', name: 'Conservation',     cost: { m: 150, g: 100 }, time: 45, req: [], desc: 'Shots cost 40% less energy.' },
  lenses:    { side: 'colony', name: 'Focus Lenses',     cost: { m: 200, g: 100 }, time: 50, req: [], desc: '+1 range for all lasers.' },
};

export const START = {
  swarm:  { m: 300 },
  colony: { m: 250, g: 0 },
  energyBase: 100,
};
