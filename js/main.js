import { HEX_SIZE, hexToPixel, pixelToHex, key, spiral, hexDist } from './hex.js';
import { buildMap, BASES } from './map.js';
import { Sim } from './sim.js';
import { Renderer, PLAYER_COLORS } from './render.js';
import { Host, Client, normalizeCode } from './net.js';
import { UNITS, STRUCTURES, RESEARCH, TICK, SURGE_INTERVAL, SWARM_UNIT_CAP, SPAWNER_CAP } from './data.js';

const $ = id => document.getElementById(id);
const ROLE_NAMES = ['Swarm', 'Colony A', 'Colony B'];

// ---------------------------------------------------------------- lobby
const net = { host: null, client: null, myPid: null, names: null };
const nameInput = $('name');
nameInput.value = localStorage.getItem('nerdhex-name') || '';
const myName = () => (nameInput.value.trim() || 'Commander').slice(0, 16);

function showRoom(code) {
  $('lobby-home').style.display = 'none'; $('lobby-room').style.display = 'block';
  $('roomcode').textContent = code;
  history.replaceState(null, '', '#' + code);
}
function renderLobby(st) {
  $('connstate').textContent = `${st.players.length}/3 players`;
  const myId = net.host ? 'host' : net.client?.myId;
  for (const el of document.querySelectorAll('.role')) {
    const role = +el.dataset.role;
    const p = st.players.find(p => p.role === role);
    el.classList.toggle('taken', !!p && p.id !== myId);
    el.classList.toggle('mine', !!p && p.id === myId);
    el.querySelector('.who').innerHTML = p ? `<b style="color:${PLAYER_COLORS[role]}">${esc(p.name)}</b>` : '<span style="color:var(--muted)">open</span>';
  }
  $('playerlist').innerHTML = 'In room: ' + st.players.map(p => `<b>${esc(p.name)}</b>${p.host ? ' (host)' : ''}${p.role !== null ? ' → ' + ROLE_NAMES[p.role] : ''}`).join(', ');
  if (net.host) {
    const ok = net.host.canStart();
    $('btn-start').disabled = !ok;
    $('room-err').textContent = ok ? '' : 'Need 3 players, each on a different side.';
  } else {
    $('btn-start').style.display = 'none';
    $('room-err').textContent = 'Waiting for the host to start…';
  }
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

$('btn-host').onclick = async () => {
  localStorage.setItem('nerdhex-name', myName());
  $('home-err').textContent = ''; $('btn-host').disabled = true;
  try {
    net.host = new Host({ onLobby: renderLobby, onLog: t => $('room-err').textContent = t });
    const code = await net.host.open(myName());
    showRoom(code); renderLobby(net.host.lobbyState());
  } catch (e) { $('home-err').textContent = 'Could not reach the signalling server: ' + (e.type || e.message); $('btn-host').disabled = false; }
};
$('btn-join').onclick = async () => {
  const code = normalizeCode($('code').value);
  if (code.length !== 4) { $('home-err').textContent = 'Enter the 4-letter code.'; return; }
  localStorage.setItem('nerdhex-name', myName());
  $('home-err').textContent = 'Connecting…'; $('btn-join').disabled = true;
  try {
    net.client = new Client({
      onLobby: renderLobby,
      onStart: msg => startGame(msg.names, msg.pid),
      onSnap: receiveSnap,
      onReject: r => { $('home-err').textContent = r; $('lobby-home').style.display = 'block'; $('lobby-room').style.display = 'none'; $('btn-join').disabled = false; },
      onClose: () => { if (game.running) endGame(null, 'Lost connection to the host.'); else { $('room-err').textContent = 'Host left the room.'; } },
      onLog: t => $('room-err').textContent = t,
    });
    await net.client.join(code, myName());
    showRoom(code); $('home-err').textContent = '';
  } catch (e) { $('home-err').textContent = e.message || String(e); $('btn-join').disabled = false; }
};
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-join').click(); });
$('code').addEventListener('input', () => { $('code').value = normalizeCode($('code').value); });
if (location.hash.length === 5) $('code').value = normalizeCode(location.hash.slice(1));
for (const el of document.querySelectorAll('.role')) {
  el.onclick = () => {
    const role = +el.dataset.role;
    if (net.host) { const mine = net.host.me.role === role; net.host.setRole(net.host.me, mine ? null : role); }
    else net.client?.send({ t: 'role', role: el.classList.contains('mine') ? null : role });
  };
}
$('btn-leave').onclick = () => location.reload();
$('btn-start').onclick = () => {
  if (!net.host?.canStart()) return;
  const names = net.host.start();
  startGame(names, net.host.me.role);
};

// ---------------------------------------------------------------- game state
const game = {
  running: false, map: null, renderer: null, sim: null, myPid: null,
  prev: null, cur: null, ents: new Map(), creep: new Set(), players: [], snap: null,
  selected: new Set(), hover: null, buildKind: null, attackMode: false, rallyMode: false,
  drag: null, keys: new Set(), lastMsgKey: '',
};
const canvas = $('view'), ctx = canvas.getContext('2d');
const mm = $('minimap'), mmctx = mm.getContext('2d');

function startGame(names, myPid) {
  net.myPid = myPid; game.myPid = myPid; net.names = names;
  $('lobby').classList.remove('active'); $('game').classList.add('active');
  game.map = buildMap();
  game.renderer = new Renderer(canvas, game.map);
  resize();
  // Camera starts on your base.
  const home = myPid === 0 ? { q: 0, r: 0 } : BASES[myPid - 1];
  const hp = hexToPixel(home.q, home.r); game.renderer.cam.x = hp.x; game.renderer.cam.y = hp.y; game.renderer.cam.zoom = 0.9;
  game.running = true;
  buildBuildPanel();
  if (net.host) {
    game.sim = new Sim(names);
    net.host.onCmd = cmd => game.sim.apply(cmd);
    net.host.onLeave = c => { if (c.pid !== undefined) game.sim.playerLeft(c.pid); };
    game.tickTimer = setInterval(hostTick, TICK * 1000);
    hostTick();
  }
  requestAnimationFrame(frame);
}
function hostTick() {
  game.sim.step();
  const s = game.sim.snapshot();
  net.host.broadcast({ t: 'snap', s });
  receiveSnap(s);
}
function sendCmd(cmd) {
  if (net.host) game.sim.apply({ ...cmd, pid: game.myPid });
  else net.client.send({ t: 'cmd', cmd });
}

function receiveSnap(s) {
  game.prev = game.cur; game.cur = { s, at: performance.now() };
  game.snap = s; game.players = s.players; game.creep = new Set(s.creep);
  game.renderer.addEffects(s.events);
  for (const ev of s.events) if (ev.ev === 'msg' && (ev.pid === -1 || ev.pid === game.myPid)) logMsg(ev.text, ev.pid === -1);
  // prune dead selections
  const ids = new Set(s.ents.map(e => e[0]));
  for (const id of [...game.selected]) if (!ids.has(id)) game.selected.delete(id);
  if (s.winner && game.running) {
    const mySide = game.myPid === 0 ? 'swarm' : 'colony';
    endGame(s.winner === mySide, s.winner === 'swarm' ? 'The Swarm consumed both Command Hubs.' : 'The Colonies burned out the Hive.');
  }
  updateHud();
}
function endGame(won, text) {
  game.running = false;
  if (game.tickTimer) clearInterval(game.tickTimer);
  $('endtitle').textContent = won === null ? 'Disconnected' : won ? 'Victory' : 'Defeat';
  $('endsub').textContent = text;
  $('endscreen').classList.add('show');
}
function logMsg(text, global) {
  const d = document.createElement('div'); d.textContent = text;
  if (global) d.style.borderLeftColor = '#ffc44d';
  $('log').appendChild(d);
  while ($('log').children.length > 6) $('log').removeChild($('log').firstChild);
  setTimeout(() => d.remove(), 8000);
}

// Build interpolated entity view from the last two snapshots.
function interpolate() {
  const cur = game.cur; if (!cur) return;
  const alpha = Math.min(1, (performance.now() - cur.at) / (TICK * 1000));
  const prevMap = new Map();
  if (game.prev) for (const e of game.prev.s.ents) prevMap.set(e[0], e);
  game.ents.clear();
  for (const e of cur.s.ents) {
    const p = prevMap.get(e[0]);
    const x = p ? p[3] + (e[3] - p[3]) * alpha : e[3];
    const y = p ? p[4] + (e[4] - p[4]) * alpha : e[4];
    game.ents.set(e[0], { id: e[0], kind: e[1], owner: e[2], x, y, hp: e[5], maxhp: e[6], progress: e[7], extra: e[8] || null, q: e[9], r: e[10] });
  }
}

// ---------------------------------------------------------------- HUD
function me() { return game.players[game.myPid]; }
function fmtTime(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }
function updateHud() {
  const s = game.snap; if (!s) return;
  const p = me(); const r = s.rates[game.myPid] || { m: 0, g: 0, e: 0 };
  let html = `<span>💎 <b>${p.m}</b> <small style="color:var(--muted)">+${Math.round(r.m)}/min</small></span>`;
  if (p.side === 'colony') {
    html += `<span>🟢 <b>${p.g}</b> <small style="color:var(--muted)">+${Math.round(r.g)}/min</small></span>`;
    html += `<span style="color:${p.energy < 10 ? 'var(--bad)' : 'inherit'}">⚡ <b>${p.energy}</b>/${p.energyCap} <small style="color:var(--muted)">+${r.e}/s</small></span>`;
    html += `<span>👥 <b>${p.supplyUsed}</b>/${p.supplyCap}</span>`;
  } else {
    const n = s.ents.filter(e => e[2] === 0 && UNITS[e[1]] && e[1] !== 'spawner').length;
    const sp = s.ents.filter(e => e[2] === 0 && e[1] === 'spawner').length;
    html += `<span>🐛 <b>${n}</b>/${SWARM_UNIT_CAP}</span><span>🥚 <b>${sp}</b>/${SPAWNER_CAP} spawners</span>`;
  }
  $('res').innerHTML = html;
  const next = SURGE_INTERVAL - (s.time % SURGE_INTERVAL);
  $('clock').textContent = `${fmtTime(s.time)} · surge in ${fmtTime(next)}`;
  $('plist').innerHTML = s.players.map(pl => `<span class="${pl.alive ? '' : 'dead'}" title="${pl.connected ? 'connected' : 'left'}"><i class="dot" style="background:${PLAYER_COLORS[pl.id]}"></i>${esc(pl.name)}${pl.connected ? '' : ' (left)'}</span>`).join('');
  renderSelPanel(); renderResearch(); refreshBuildAfford();
}

// Build panel
let buildButtons = [];
const HOTKEYS = {};
function buildBuildPanel() {
  const side = game.myPid === 0 ? 'swarm' : 'colony';
  const items = side === 'swarm'
    ? [['spawner', 'Q'], ['extractor', 'E'], ['nest', 'N'], ['spine', 'P']]
    : [['barracks', 'B'], ['generator', 'G'], ['battery', 'Y'], ['turret', 'T'], ['wall', 'W'], ['refinery', 'R'], ['rig', 'M'], ['techlab', 'L'], ['depot', 'D']];
  const el = $('buildpanel');
  el.innerHTML = `<h3>Build</h3><div class="actions" id="buildbtns"></div>`;
  const box = $('buildbtns');
  buildButtons = [];
  for (const [kind, hk] of items) {
    const def = STRUCTURES[kind] || UNITS[kind];
    const b = document.createElement('button');
    b.innerHTML = `${def.name}<span class="key">${hk}</span><small>${costStr(def.cost)}</small>`;
    b.title = def.desc;
    b.onclick = () => setBuild(kind);
    b.dataset.kind = kind;
    box.appendChild(b); buildButtons.push(b);
    HOTKEYS[hk] = () => setBuild(kind);
  }
}
function costStr(c) { if (!c) return ''; return `${c.m || 0}💎${c.g ? ' ' + c.g + '🟢' : ''}`; }
function refreshBuildAfford() {
  const p = me(); if (!p) return;
  for (const b of buildButtons) {
    const def = STRUCTURES[b.dataset.kind] || UNITS[b.dataset.kind];
    b.style.opacity = p.m >= (def.cost.m || 0) && p.g >= (def.cost.g || 0) ? 1 : .45;
    b.classList.toggle('on', game.buildKind === b.dataset.kind);
  }
}
function setBuild(kind) { game.buildKind = game.buildKind === kind ? null : kind; game.attackMode = false; game.rallyMode = false; refreshBuildAfford(); }

// Client-side placement check (host re-validates).
function occupiedHexes() {
  const occ = new Set();
  for (const e of game.ents.values()) {
    if (!STRUCTURES[e.kind] && e.kind !== 'rock') continue;
    const fp = e.kind === 'rock' ? 0 : STRUCTURES[e.kind].footprint;
    for (const h of spiral(e.q, e.r, fp)) occ.add(key(h.q, h.r));
  }
  return occ;
}
function buildValid(kind, q, r) {
  const t = game.map.tiles.get(key(q, r));
  if (!t || t.t === 'void') return false;
  const occ = occupiedHexes();
  const def = STRUCTURES[kind];
  const fp = def?.footprint || 0;
  for (const h of spiral(q, r, fp)) if (occ.has(key(h.q, h.r))) return false;
  if (kind === 'spawner') return game.creep.has(key(q, r));
  if (def.on && t.t !== def.on) return false;
  if (!def.on && (t.t === 'mineral' || t.t === 'gas')) return false;
  if (def.onCreep && !game.creep.has(key(q, r))) return false;
  if (def.side === 'colony' && !def.on) {
    let near = false;
    for (const e of game.ents.values()) if (e.owner === game.myPid && STRUCTURES[e.kind] && hexDist(e.q, e.r, q, r) <= 6) { near = true; break; }
    if (!near) return false;
  }
  return true;
}

// Selection panel
function selectedEnts() { return [...game.selected].map(id => game.ents.get(id)).filter(Boolean); }
function renderSelPanel() {
  const el = $('selpanel');
  const sel = selectedEnts();
  if (!sel.length) { el.innerHTML = `<h3>Nothing selected</h3><div class="desc">${game.myPid === 0 ? 'Build Extractors on the veins around your Hive, hatch Spawners on creep and send them toward the Colony bases. A Nest unlocks better breeds.' : 'Train Troopers at the Barracks, keep energy up with Generators and Batteries, and claim geysers with Refineries. Research at a Tech Lab.'}</div>`; return; }
  const mine = sel.every(e => e.owner === game.myPid);
  const kinds = {}; for (const e of sel) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  const title = sel.length === 1 ? (UNITS[sel[0].kind] || STRUCTURES[sel[0].kind] || { name: 'Rocks' }).name : Object.entries(kinds).map(([k, n]) => `${n}× ${(UNITS[k] || STRUCTURES[k] || { name: k }).name}`).join(', ');
  const one = sel.length === 1 ? sel[0] : null;
  let html = `<h3>${title} ${one ? `<span class="tag">${Math.ceil(one.hp)}/${one.maxhp} HP</span>` : ''} ${!mine && one ? `<span class="tag" style="color:${PLAYER_COLORS[one.owner] || '#aaa'}">${one.owner < 0 ? 'Neutral — order units to attack it' : esc(game.players[one.owner]?.name || '')}</span>` : ''}</h3>`;
  if (one) html += `<div class="desc">${(UNITS[one.kind] || STRUCTURES[one.kind] || { desc: 'Destructible rocks sealing a back entrance (3000 HP).' }).desc}</div>`;
  if (!mine) { el.innerHTML = html; return; }
  const acts = [];
  const spawners = sel.filter(e => e.kind === 'spawner');
  if (spawners.length) {
    const p = me(); const hasNest = [...game.ents.values()].some(e => e.kind === 'nest' && e.owner === 0 && e.progress >= 1);
    for (const u of ['skitter', 'striker', 'lancer', 'behemoth']) {
      const d = UNITS[u];
      const locked = (d.tier >= 1 && !hasNest) || (d.tier >= 2 && !p.research.evolved);
      const on = spawners.every(s => s.extra && s.extra[0] === u);
      acts.push(`<button data-act="spawnUnit" data-unit="${u}" class="${on ? 'on' : ''}" ${locked ? 'disabled' : ''} title="${d.desc}">${d.name}<small>every ${d.interval}s${locked ? ' · locked' : ''}</small></button>`);
    }
    const aggr = spawners.every(s => s.extra && s.extra[1]);
    acts.push(`<button data-act="aggr" class="${aggr ? 'on' : ''}" title="Spawned units attack-move toward the nearest Command Hub">Aggressive<small>${aggr ? 'on' : 'off'}</small></button>`);
    acts.push(`<button data-act="rally" class="${game.rallyMode ? 'on' : ''}">Set rally<small>click a hex</small></button>`);
    if (spawners.some(s => s.extra && s.extra[2])) acts.push(`<button data-act="clearrally">Clear rally</button>`);
  }
  const barracks = sel.filter(e => e.kind === 'barracks' && e.progress >= 1);
  if (barracks.length) {
    const p = me(); const hasLab = [...game.ents.values()].some(e => e.kind === 'techlab' && e.owner === game.myPid && e.progress >= 1);
    for (const u of ['trooper', 'gunner']) {
      const d = UNITS[u]; const locked = d.tier >= 1 && !hasLab;
      acts.push(`<button data-act="train" data-unit="${u}" ${locked ? 'disabled' : ''} title="${d.desc}">${d.name}<small>${costStr(d.cost)} · ${d.train}s${locked ? ' · needs Tech Lab' : ''}</small></button>`);
    }
    acts.push(`<button data-act="rally" class="${game.rallyMode ? 'on' : ''}">Set rally<small>click a hex</small></button>`);
    if (barracks.length === 1 && barracks[0].extra) {
      const [queue, t] = barracks[0].extra;
      if (queue.length) html += `<div class="desc">Queue: ${queue.map((k, i) => i === 0 ? `<b>${UNITS[k].name}</b> (${Math.max(0, UNITS[k].train - t).toFixed(0)}s)` : UNITS[k].name).join(', ')}</div>`;
    }
  }
  const units = sel.filter(e => UNITS[e.kind]);
  if (units.length) {
    acts.push(`<button data-act="attackmove" class="${game.attackMode ? 'on' : ''}">Attack-move<span class="key">A</span></button>`);
    acts.push(`<button data-act="stop">Stop<span class="key">S</span></button>`);
  }
  el.innerHTML = html + `<div class="actions">${acts.join('')}</div>`;
  for (const b of el.querySelectorAll('button[data-act]')) b.onclick = () => doAction(b.dataset.act, b.dataset.unit);
}
function doAction(act, unit) {
  const ids = [...game.selected];
  switch (act) {
    case 'spawnUnit': sendCmd({ t: 'spawnUnit', ids, unit }); break;
    case 'aggr': { const sp = selectedEnts().filter(e => e.kind === 'spawner'); const on = sp.every(s => s.extra && s.extra[1]); sendCmd({ t: 'spawnMode', ids, aggressive: !on }); break; }
    case 'rally': game.rallyMode = !game.rallyMode; game.buildKind = null; game.attackMode = false; renderSelPanel(); break;
    case 'clearrally': sendCmd({ t: 'rally', ids }); break;
    case 'train': { const b = selectedEnts().find(e => e.kind === 'barracks'); if (b) sendCmd({ t: 'train', id: b.id, unit }); break; }
    case 'attackmove': game.attackMode = !game.attackMode; game.buildKind = null; game.rallyMode = false; renderSelPanel(); break;
    case 'stop': sendCmd({ t: 'stop', ids }); break;
  }
}
function renderResearch() {
  const p = me(); if (!p) return;
  const side = p.side;
  const el = $('research');
  const keys = Object.keys(RESEARCH).filter(k => RESEARCH[k].side === side);
  const hasLab = side === 'swarm' || [...game.ents.values()].some(e => e.kind === 'techlab' && e.owner === game.myPid && e.progress >= 1);
  let html = `<h4>${side === 'swarm' ? 'Evolution' : 'Research'}${side === 'colony' && !hasLab ? ' · needs Tech Lab' : ''}</h4>`;
  if (p.researching) html += `<div style="margin-bottom:6px">⏳ ${RESEARCH[p.researching.key].name} ${Math.round(p.researching.t / p.researching.total * 100)}%</div>`;
  const ally = game.myPid === 1 ? 2 : game.myPid === 2 ? 1 : null;
  html += '<div class="actions">';
  for (const k of keys) {
    const d = RESEARCH[k];
    if (p.research[k]) continue;
    const reqOk = d.req.every(r => p.research[r]);
    if (!reqOk) continue;
    const disc = ally !== null && game.players[ally]?.research[k];
    const cost = { m: Math.round((d.cost.m || 0) * (disc ? .5 : 1)), g: Math.round((d.cost.g || 0) * (disc ? .5 : 1)) };
    html += `<button data-res="${k}" ${!hasLab || p.researching ? 'disabled' : ''} title="${d.desc}">${d.name}<small>${costStr(cost)}${disc ? ' (ally discount)' : ''} · ${d.time}s</small></button>`;
  }
  html += '</div>';
  const done = keys.filter(k => p.research[k]).map(k => RESEARCH[k].name);
  if (done.length) html += `<div style="color:var(--muted);margin-top:6px">Done: ${done.join(', ')}</div>`;
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; for (const b of el.querySelectorAll('button[data-res]')) b.onclick = () => sendCmd({ t: 'research', key: b.dataset.res }); }
}

// ---------------------------------------------------------------- input
function resize() { canvas.width = innerWidth; canvas.height = innerHeight; }
addEventListener('resize', resize);
function mouseWorld(e) { const r = canvas.getBoundingClientRect(); return game.renderer.screenToWorld(e.clientX - r.left, e.clientY - r.top); }
function entAt(wx, wy) {
  let best = null, bd = Infinity;
  for (const e of game.ents.values()) {
    const rad = UNITS[e.kind] ? UNITS[e.kind].radius + 4 : (STRUCTURES[e.kind]?.footprint ? HEX_SIZE * 2.4 : HEX_SIZE * 0.85);
    const d = Math.hypot(e.x - wx, e.y - wy);
    if (d < rad && d < bd) { bd = d; best = e; }
  }
  return best;
}
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => {
  if (!game.running) return;
  const w = mouseWorld(e); const h = pixelToHex(w.x, w.y);
  if (e.button === 1) { game.pan = { x: e.clientX, y: e.clientY }; e.preventDefault(); return; }
  if (e.button === 0) {
    if (game.buildKind) { sendCmd({ t: 'build', kind: game.buildKind, q: h.q, r: h.r }); if (!e.shiftKey) game.buildKind = null; refreshBuildAfford(); return; }
    if (game.rallyMode) { sendCmd({ t: 'rally', ids: [...game.selected], q: h.q, r: h.r }); game.rallyMode = false; renderSelPanel(); return; }
    if (game.attackMode) { const t = entAt(w.x, w.y); sendCmd({ t: 'move', ids: unitIds(), q: h.q, r: h.r, atk: true, tid: t && t.owner !== game.myPid ? t.id : undefined }); game.attackMode = false; renderSelPanel(); return; }
    game.drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, shift: e.shiftKey };
  }
  if (e.button === 2) {
    game.buildKind = null; game.attackMode = false; game.rallyMode = false; refreshBuildAfford();
    const ids = unitIds(); if (!ids.length) return;
    const t = entAt(w.x, w.y);
    if (t && t.owner !== game.myPid && !(t.owner > 0 && game.myPid > 0)) sendCmd({ t: 'move', ids, q: t.q, r: t.r, atk: true, tid: t.id });
    else sendCmd({ t: 'move', ids, q: h.q, r: h.r, atk: false });
  }
});
function unitIds() { return selectedEnts().filter(e => UNITS[e.kind] && e.owner === game.myPid).map(e => e.id); }
addEventListener('mousemove', e => {
  if (!game.running) return;
  if (game.pan) { game.renderer.cam.x -= (e.clientX - game.pan.x) / game.renderer.cam.zoom; game.renderer.cam.y -= (e.clientY - game.pan.y) / game.renderer.cam.zoom; game.pan = { x: e.clientX, y: e.clientY }; game.renderer.clampCam(); }
  if (game.drag) { game.drag.x1 = e.clientX; game.drag.y1 = e.clientY; }
  const w = mouseWorld(e); game.hover = pixelToHex(w.x, w.y);
});
addEventListener('mouseup', e => {
  if (e.button === 1) game.pan = null;
  if (e.button === 0 && game.drag) {
    const d = game.drag; game.drag = null;
    const small = Math.abs(d.x1 - d.x0) < 5 && Math.abs(d.y1 - d.y0) < 5;
    if (!d.shift) game.selected.clear();
    if (small) {
      const w = mouseWorld(e); const t = entAt(w.x, w.y);
      if (t) { if (d.shift && game.selected.has(t.id)) game.selected.delete(t.id); else game.selected.add(t.id); }
    } else {
      const a = game.renderer.screenToWorld(Math.min(d.x0, d.x1) - canvas.getBoundingClientRect().left, Math.min(d.y0, d.y1) - canvas.getBoundingClientRect().top);
      const b = game.renderer.screenToWorld(Math.max(d.x0, d.x1) - canvas.getBoundingClientRect().left, Math.max(d.y0, d.y1) - canvas.getBoundingClientRect().top);
      const inRect = e2 => e2.x >= a.x && e2.x <= b.x && e2.y >= a.y && e2.y <= b.y && e2.owner === game.myPid;
      const units = [...game.ents.values()].filter(e2 => UNITS[e2.kind] && inRect(e2));
      const pick = units.length ? units : [...game.ents.values()].filter(e2 => STRUCTURES[e2.kind] && inRect(e2));
      for (const u of pick) game.selected.add(u.id);
    }
    renderSelPanel();
  }
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const r = game.renderer; const before = mouseWorld(e);
  r.cam.zoom *= e.deltaY < 0 ? 1.12 : 1 / 1.12; r.clampCam();
  const after = mouseWorld(e);
  r.cam.x += before.x - after.x; r.cam.y += before.y - after.y; r.clampCam();
}, { passive: false });
addEventListener('keydown', e => {
  if (!game.running || e.target.tagName === 'INPUT') return;
  const k = e.key.toUpperCase();
  if (['ARROWUP', 'ARROWDOWN', 'ARROWLEFT', 'ARROWRIGHT'].includes(k)) { game.keys.add(k); e.preventDefault(); }
  if (k === 'ESCAPE') { game.buildKind = null; game.attackMode = false; game.rallyMode = false; game.selected.clear(); refreshBuildAfford(); renderSelPanel(); }
  else if (k === 'A' && unitIds().length) { game.attackMode = true; game.buildKind = null; renderSelPanel(); }
  else if (k === 'S' && unitIds().length) sendCmd({ t: 'stop', ids: unitIds() });
  else if (k === 'F1' || k === 'H') { const hb = game.myPid === 0 ? { q: 0, r: 0 } : BASES[game.myPid - 1]; const hp = hexToPixel(hb.q, hb.r); game.renderer.cam.x = hp.x; game.renderer.cam.y = hp.y; }
  else if (HOTKEYS[k] && !e.ctrlKey && !e.metaKey) HOTKEYS[k]();
});
addEventListener('keyup', e => game.keys.delete(e.key.toUpperCase()));
mm.addEventListener('mousedown', e => {
  const r = mm.getBoundingClientRect(); const p = game.renderer.minimapToWorld(e.clientX - r.left, e.clientY - r.top, 160);
  game.renderer.cam.x = p.x; game.renderer.cam.y = p.y; game.renderer.clampCam(); game.mmdrag = true;
});
addEventListener('mousemove', e => { if (game.mmdrag) { const r = mm.getBoundingClientRect(); const p = game.renderer.minimapToWorld(e.clientX - r.left, e.clientY - r.top, 160); game.renderer.cam.x = p.x; game.renderer.cam.y = p.y; game.renderer.clampCam(); } });
addEventListener('mouseup', () => game.mmdrag = false);

// ---------------------------------------------------------------- frame loop
let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now;
  const r = game.renderer; if (!r) return;
  const sp = 900 / r.cam.zoom * dt;
  if (game.keys.has('ARROWUP')) r.cam.y -= sp;
  if (game.keys.has('ARROWDOWN')) r.cam.y += sp;
  if (game.keys.has('ARROWLEFT')) r.cam.x -= sp;
  if (game.keys.has('ARROWRIGHT')) r.cam.x += sp;
  r.clampCam();
  interpolate();
  const state = {
    ents: game.ents, creep: game.creep, players: game.players, selected: game.selected, me: game.myPid,
    hover: game.hover, buildKind: game.buildKind,
    buildValid: game.buildKind && game.hover ? buildValid(game.buildKind, game.hover.q, game.hover.r) : false,
    dragRect: game.drag ? { x0: Math.min(game.drag.x0, game.drag.x1), y0: Math.min(game.drag.y0, game.drag.y1), x1: Math.max(game.drag.x0, game.drag.x1), y1: Math.max(game.drag.y0, game.drag.y1) } : null,
  };
  r.draw(state);
  r.drawMinimap(mmctx, 160, state);
  canvas.style.cursor = game.attackMode ? 'cell' : game.buildKind || game.rallyMode ? 'copy' : 'crosshair';
  if (game.running || game.cur) requestAnimationFrame(frame);
}

// Expose for debugging in the console.
window.nerdhex = { game, net, sendCmd };
