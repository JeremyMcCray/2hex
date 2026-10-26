// Peer-to-peer networking over PeerJS. The host owns the room; its peer id is derived from the 4-letter code.
// Messages are plain JSON objects with a `t` field.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, to avoid confusion with 1 and 0
const PREFIX = 'nerdhex-v1-';

export function makeCode() {
  let s = '';
  const arr = new Uint32Array(4); crypto.getRandomValues(arr);
  for (let i = 0; i < 4; i++) s += ALPHABET[arr[i] % ALPHABET.length];
  return s;
}
export function normalizeCode(s) { return (s || '').toUpperCase().replace(/[^A-Z]/g, '').replace(/I/g, '1').replace(/O/g, '0').slice(0, 4); }

// Signalling server. Defaults to the free public PeerJS broker; it only brokers the handshake,
// game data then flows peer to peer over WebRTC. Override with ?signal=host:port[:path] (add &insecure=1 for ws://)
// if you run your own PeerServer.
function peerOptions() {
  const params = new URLSearchParams(location.search);
  const opts = { debug: 1 };
  const sig = params.get('signal');
  if (sig) {
    const [host, port, path] = sig.split(':');
    Object.assign(opts, { host, port: port ? +port : 443, path: path ? '/' + path : '/', secure: !params.get('insecure') });
  }
  return opts;
}
function newPeer(id) { return id ? new Peer(id, peerOptions()) : new Peer(peerOptions()); }

export class Host {
  constructor({ onLobby, onLog }) {
    this.conns = new Map(); // peerId -> { conn, name, role }
    this.onLobby = onLobby; this.onLog = onLog || (() => {});
    this.onCmd = null; this.onLeave = null;
    this.code = null; this.peer = null; this.me = { name: 'Host', role: null };
    this.started = false;
  }
  open(name) {
    this.me.name = name;
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const tryOpen = () => {
        const code = makeCode();
        const peer = newPeer(PREFIX + code);
        peer.on('open', () => { this.code = code; this.peer = peer; this.wire(); resolve(code); });
        peer.on('error', err => {
          if (err.type === 'unavailable-id' && attempts++ < 5) { peer.destroy(); tryOpen(); }
          else if (!this.peer) reject(err);
          else this.onLog('Network error: ' + err.type);
        });
      };
      tryOpen();
    });
  }
  wire() {
    this.peer.on('connection', conn => {
      conn.on('open', () => {
        if (this.started || this.conns.size >= 2) { conn.send({ t: 'reject', reason: this.started ? 'Match already started' : 'Room is full' }); setTimeout(() => conn.close(), 500); return; }
        this.conns.set(conn.peer, { conn, name: 'Player', role: null, seen: Date.now() });
        this.broadcastLobby();
      });
      conn.on('data', msg => this.handle(conn, msg));
      const bye = () => {
        const c = this.conns.get(conn.peer);
        if (!c) return;
        this.conns.delete(conn.peer);
        if (this.started) this.onLeave?.(c);
        else this.broadcastLobby();
      };
      conn.on('close', bye); conn.on('error', bye);
    });
    this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch (e) {} });
    // Heartbeat: drop peers that have gone silent (WebRTC close events can take a long time).
    this.hb = setInterval(() => {
      for (const [id, c] of this.conns) if (Date.now() - c.seen > 8000) { this.conns.delete(id); try { c.conn.close(); } catch (e) {} if (this.started) this.onLeave?.(c); else this.broadcastLobby(); }
    }, 1000);
  }
  handle(conn, msg) {
    const c = this.conns.get(conn.peer);
    if (!c) return;
    c.seen = Date.now();
    switch (msg.t) {
      case 'ping': conn.send({ t: 'pong' }); break;
      case 'hello': c.name = String(msg.name || 'Player').slice(0, 16); this.broadcastLobby(); break;
      case 'role': if (!this.started) { this.setRole(c, msg.role); } break;
      case 'cmd': if (this.started && c.pid !== undefined) this.onCmd?.({ ...msg.cmd, pid: c.pid }); break;
    }
  }
  roleTaken(role, except) {
    if (this.me !== except && this.me.role === role) return true;
    for (const c of this.conns.values()) if (c !== except && c.role === role) return true;
    return false;
  }
  setRole(who, role) {
    if (role !== null && ![0, 1, 2].includes(role)) return;
    if (role !== null && this.roleTaken(role, who)) return;
    who.role = role; this.broadcastLobby();
  }
  lobbyState() {
    const players = [{ name: this.me.name, role: this.me.role, host: true, id: 'host' }];
    for (const [id, c] of this.conns) players.push({ name: c.name, role: c.role, host: false, id });
    return { code: this.code, players };
  }
  broadcastLobby() {
    const st = this.lobbyState();
    this.onLobby(st);
    for (const [id, c] of this.conns) c.conn.send({ t: 'lobby', ...st, you: id });
  }
  canStart() {
    const roles = [this.me.role, ...[...this.conns.values()].map(c => c.role)];
    return roles.length === 3 && new Set(roles).size === 3 && roles.every(r => r !== null);
  }
  start() {
    this.started = true;
    const names = [];
    names[this.me.role] = this.me.name;
    for (const c of this.conns.values()) { c.pid = c.role; names[c.role] = c.name; }
    for (const c of this.conns.values()) c.conn.send({ t: 'start', names, pid: c.pid });
    return names;
  }
  broadcast(msg) { for (const c of this.conns.values()) if (c.conn.open) c.conn.send(msg); }
  destroy() { clearInterval(this.hb); this.peer?.destroy(); }
}

export class Client {
  constructor({ onLobby, onStart, onSnap, onReject, onClose, onLog }) {
    Object.assign(this, { onLobby, onStart, onSnap, onReject, onClose, onLog: onLog || (() => {}) });
    this.conn = null; this.peer = null; this.myId = null;
  }
  join(code, name) {
    return new Promise((resolve, reject) => {
      const peer = newPeer();
      this.peer = peer;
      let settled = false;
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        this.conn = conn;
        const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('No room with that code (or the host is offline).')); peer.destroy(); } }, 8000);
        conn.on('open', () => {
          settled = true; clearTimeout(timer); conn.send({ t: 'hello', name }); resolve();
          this.lastSeen = Date.now();
          this.hb = setInterval(() => {
            if (conn.open) conn.send({ t: 'ping' });
            if (Date.now() - this.lastSeen > 10000) { clearInterval(this.hb); this.onClose?.(); try { conn.close(); } catch (e) {} }
          }, 2000);
        });
        conn.on('data', msg => this.handle(msg));
        conn.on('close', () => this.onClose?.());
        conn.on('error', e => { if (!settled) { settled = true; clearTimeout(timer); reject(e); } });
      });
      peer.on('error', err => {
        if (!settled) { settled = true; reject(new Error(err.type === 'peer-unavailable' ? 'No room with that code.' : 'Network error: ' + err.type)); }
        else this.onLog('Network error: ' + err.type);
      });
    });
  }
  handle(msg) {
    this.lastSeen = Date.now();
    switch (msg.t) {
      case 'lobby': this.myId = msg.you; this.onLobby(msg); break;
      case 'start': this.onStart(msg); break;
      case 'snap': this.onSnap(msg.s); break;
      case 'reject': this.onReject?.(msg.reason); break;
    }
  }
  send(msg) { if (this.conn?.open) this.conn.send(msg); }
  destroy() { clearInterval(this.hb); this.peer?.destroy(); }
}
