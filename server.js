'use strict';
/*
  Arena Atışma serveri. Heç bir xarici paket tələb etmir (Node.js 18+).
  Başlatmaq üçün:  node server.js
*/
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT) || 3000;
// Fayllar ya "public" qovluğundadır, ya da (GitHub-a qovluqsuz yüklənibsə) birbaşa kökdədir.
const PUBLIC = fs.existsSync(path.join(__dirname, 'public', 'shared.js')) ? path.join(__dirname, 'public') : __dirname;
const FLAT = PUBLIC === __dirname;
const FLAT_FILES = new Set(['index.html', 'client.js', 'shared.js']);
const S = require(path.join(PUBLIC, 'shared.js'));
const TICK = 50; // 20 Hz
const MAX_PLAYERS = 12;
const FFA_KILLS = 20;
const TDM_KILLS = 30;
const RESPAWN_MS = 3000;
const END_MS = 8000;
const MODES = ['ffa', 'tdm', 'coop'];
const LOOT_RESPAWN_MS = 45000;
const DROP_LIFE_MS = 90000;
const PICK_R = 1.4;
const RIFLE = S.WEAPON_ORDER.indexOf('rifle');
const SIDEARMS = ['pistol', 'deagle'];
const PRIMARIES = ['uzi', 'rifle', 'akm', 'dmr', 'lmg', 'shotgun', 'sniper', 'awm'];
const DEFAULT_LOADOUT = { side: 'pistol', p1: 'rifle', p2: 'shotgun' };
const PICK_WAIT_MS = 25000;
const CAR_MAX_SPEED = 34;
function cleanLoadout(m) {
  const side = SIDEARMS.includes(m.side) ? m.side : null;
  const p1 = PRIMARIES.includes(m.p1) ? m.p1 : null;
  const p2 = PRIMARIES.includes(m.p2) && m.p2 !== p1 ? m.p2 : null;
  if (!side || !p1 || !p2) return null;
  return { side, p1, p2 };
}
const NADE_FUSE = 3000, SMOKE_FUSE = 1400, SMOKE_MS = 15000, NADE_R = 8, NADE_DMG = 160;
const noWeapons = () => S.WEAPON_ORDER.map(() => false);
const allWeapons = () => S.WEAPON_ORDER.map(() => true);
function invOf(p) {
  return { own: p.own, hl: p.hl, hm: Math.round(p.helmet), al: p.al, am: Math.round(p.armor), gr: p.gr, sm: p.sm, sc: p.sc, su: p.su, hp: Math.round(p.hp) };
}

/* ---------------- HTTP (statik fayllar) ---------------- */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch (e) { res.writeHead(400); return res.end(); }
  if (p === '/health') { res.writeHead(200); return res.end('ok'); }
  if (p === '/') p = '/index.html';
  const file = path.join(PUBLIC, path.normalize(p));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  if (FLAT && (path.dirname(file) !== PUBLIC || !FLAT_FILES.has(path.basename(file)))) { res.writeHead(404); return res.end('404'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

/* ---------------- WebSocket (əl ilə yazılmış, asılılıqsız) ---------------- */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class Conn {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frag = [];
    this.player = null;
    this.room = null;
    this.onmessage = null;
    this.onclose = null;
    socket.setNoDelay(true);
    socket.on('data', (d) => {
      this.buf = Buffer.concat([this.buf, d]);
      if (this.buf.length > (1 << 20)) { socket.destroy(); return; }
      this.parse();
    });
    socket.on('close', () => { if (this.onclose) this.onclose(); });
    socket.on('error', () => {});
  }

  parse() {
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = !!(b[0] & 0x80);
      const op = b[0] & 0x0f;
      const masked = !!(b[1] & 0x80);
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        len = Number(b.readBigUInt64BE(2)); off = 10;
      }
      if (len > 65536) { this.socket.destroy(); return; }
      const mlen = masked ? 4 : 0;
      if (b.length < off + mlen + len) return;
      let payload = b.subarray(off + mlen, off + mlen + len);
      if (masked) {
        const mask = b.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      this.buf = b.subarray(off + mlen + len);
      if (op === 8) { this.socket.end(); return; }
      if (op === 9) { this.sendFrame(10, payload); continue; }
      if (op === 10) continue;
      if (op === 1 || op === 0) {
        if (op === 1) this.frag = [];
        this.frag.push(payload);
        if (fin) {
          const msg = Buffer.concat(this.frag).toString('utf8');
          this.frag = [];
          if (this.onmessage) this.onmessage(msg);
        }
      }
    }
  }

  sendFrame(op, payload) {
    if (this.socket.destroyed || !this.socket.writable) return;
    const len = payload.length;
    let header;
    if (len < 126) header = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | op; header[1] = 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x80 | op; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
    this.socket.write(Buffer.concat([header, payload]));
  }

  sendRaw(str) { this.sendFrame(1, Buffer.from(str)); }
  send(obj) { this.sendRaw(JSON.stringify(obj)); }
  ping() { this.sendFrame(9, Buffer.alloc(0)); }
}

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || req.url.split('?')[0] !== '/ws') { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const conn = new Conn(socket);
  conn.onmessage = (raw) => onMessage(conn, raw);
  conn.onclose = () => onClose(conn);
});

setInterval(() => {
  for (const room of rooms.values()) for (const p of room.players.values()) p.conn.ping();
}, 25000);

/* ---------------- Otaqlar ---------------- */
const rooms = new Map();

function sanitizeCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); }
function randomCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = ''; for (let i = 0; i < 4; i++) c += a[(Math.random() * a.length) | 0]; } while (rooms.has(c));
  return c;
}
const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;

class Room {
  constructor(code, mode, mapId) {
    this.code = code;
    this.mode = mode;
    this.map = S.MAPS[mapId] || S.MAPS.arena;
    if (mode === 'coop') this.map = S.MAPS.arena; // botlar yalnız arenada
    this.loot = [];
    this.nextLoot = 1;
    this.nades = [];
    this.nextNade = 1;
    this.cars = (this.map.cars || []).map((c, i) => ({ id: i + 1, x: c[0], z: c[1], yaw: c[2], sp: 0, driver: 0, lastAt: 0 }));
    if (this.map.loot) {
      for (const sp of this.map.lootSpots) {
        this.loot.push({ id: this.nextLoot++, ty: S.rollLoot(Math.random), x: sp[0], z: sp[1], alive: true, at: 0, temp: false });
      }
    }
    this.players = new Map();
    this.bots = [];
    this.nextId = 1;
    this.nextBotId = 1000;
    this.state = 'play';
    this.endAt = 0;
    this.score = { red: 0, blue: 0 };
    this.wave = 0;
    this.waveAt = 0;
    this.rosterDirty = false;
    this.timer = setInterval(() => this.tick(), TICK);
  }

  broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const p of this.players.values()) p.conn.sendRaw(s);
  }

  isEnemy(a, b) {
    if (a === b) return false;
    if (this.mode === 'ffa') return true;
    if (this.mode === 'tdm') return a.team !== b.team;
    return !!a.bot !== !!b.bot; // coop: insanlar bir tərəfdə, botlar digərində
  }

  add(conn, name) {
    const p = {
      id: this.nextId++, conn, name, bot: false, team: null,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: 100, alive: false,
      kills: 0, deaths: 0, wi: 0, seq: 0, lastFire: {}, lastState: Date.now(),
      lastHurt: 0, respawnAt: 0, crouch: false, helmet: 0, armor: 0, hl: 0, al: 0, gr: 0, sm: 0, sc: false, su: false, lastThrow: 0,
      own: allWeapons(), loadout: null, needsPick: false, ready: false, pickDeadline: 0, car: 0
    };
    if (this.mode === 'tdm') {
      let red = 0, blue = 0;
      for (const q of this.players.values()) q.team === 'red' ? red++ : blue++;
      p.team = red <= blue ? 'red' : 'blue';
    } else if (this.mode === 'coop') p.team = 'coop';
    this.players.set(p.id, p);
    conn.player = p;
    conn.room = this;
    conn.send({ t: 'welcome', id: p.id, room: this.code, mode: this.mode, team: p.team, map: this.map.id, pick: !this.map.loot, cars: this.cars.map((c) => c.id),
      loot: this.loot.filter((l) => l.alive).map((l) => [l.id, l.ty, r1(l.x), r1(l.z)]) });
    if (this.map.loot) this.spawn(p);
    else { p.needsPick = true; p.ready = false; p.pickDeadline = Date.now() + PICK_WAIT_MS; }
    this.sendRoster();
    return p;
  }

  remove(p) {
    this.freeCar(p);
    this.players.delete(p.id);
    if (this.players.size === 0) {
      clearInterval(this.timer);
      rooms.delete(this.code);
      return;
    }
    this.sendRoster();
    if (this.mode === 'coop' && this.state === 'play') this.checkCoopDefeat();
  }

  sendRoster() {
    this.rosterDirty = false;
    const list = [];
    for (const p of this.players.values()) list.push({ id: p.id, name: p.name, team: p.team, k: p.kills, d: p.deaths });
    this.broadcast({ t: 'roster', list });
  }

  entities() {
    const all = [];
    for (const p of this.players.values()) if (p.alive) all.push(p);
    for (const b of this.bots) if (b.alive) all.push(b);
    return all;
  }

  pickSpawn() {
    const others = this.entities();
    const scored = this.map.spawns.map((sp) => {
      let min = 1e9;
      for (const o of others) min = Math.min(min, Math.hypot(o.x - sp[0], o.z - sp[1]));
      return { sp, min: min + Math.random() * 6 };
    }).sort((a, b) => b.min - a.min);
    return scored[(Math.random() * 3) | 0].sp;
  }

  spawn(p) {
    const sp = this.pickSpawn();
    p.x = sp[0]; p.z = sp[1]; p.y = 0;
    p.hp = 100; p.alive = true; p.respawnAt = 0; p.needsPick = false; p.pickFromDeath = false; p.car = 0;
    if (this.map.loot) {
      p.hl = 0; p.al = 0; p.helmet = 0; p.armor = 0; p.own = noWeapons(); p.gr = 0; p.sm = 0; p.sc = false; p.su = false;
    } else {
      p.hl = 2; p.al = 2; p.helmet = S.HELMETS[2].hp; p.armor = S.ARMORS[2].hp; p.gr = 2; p.sm = 1; p.sc = false; p.su = false;
      p.own = noWeapons();
      const L = p.loadout || DEFAULT_LOADOUT;
      for (const id of [L.side, L.p1, L.p2]) p.own[S.WEAPON_ORDER.indexOf(id)] = true;
      p.wi = S.WEAPON_ORDER.indexOf(L.p1);
    }
    p.crouch = false;
    p.seq++; p.lastState = Date.now();
    const yaw = Math.atan2(p.x, p.z);
    p.yaw = yaw; p.pitch = 0;
    p.conn.send(Object.assign({ t: 'spawn', x: p.x, y: p.y, z: p.z, yaw, seq: p.seq }, invOf(p)));
  }

  reset() {
    this.state = 'play';
    this.score = { red: 0, blue: 0 };
    this.bots = [];
    this.wave = 0;
    this.waveAt = 0;
    this.resetLoot();
    for (const p of this.players.values()) { p.kills = 0; p.deaths = 0; this.spawn(p); }
    this.nades = [];
    this.broadcast({ t: 'reset' });
    this.sendRoster();
  }

  /* ---- loot ---- */
  resetLoot() {
    if (!this.map.loot) return;
    this.loot = [];
    for (const sp of this.map.lootSpots) {
      this.loot.push({ id: this.nextLoot++, ty: S.rollLoot(Math.random), x: sp[0], z: sp[1], alive: true, at: 0, temp: false });
    }
    this.broadcast({ t: 'lootall', loot: this.loot.map((l) => [l.id, l.ty, r1(l.x), r1(l.z)]) });
  }

  dropLoot(p) {
    if (!this.map.loot) return;
    const items = [];
    for (let i = S.WEAPON_ORDER.length - 1; i >= 0; i--) if (p.own[i]) items.push(S.WEAPON_ORDER[i]);
    if (p.helmet > 0 && p.hl > 0) items.push('helmet' + p.hl);
    if (p.armor > 0 && p.al > 0) items.push('armor' + p.al);
    if (p.sc) items.push('scope');
    if (p.su) items.push('supp');
    if (p.gr > 0) items.push('grenade');
    if (p.sm > 0) items.push('smoke');
    items.forEach((ty, k) => {
      const a = (k / Math.max(1, items.length)) * Math.PI * 2 + Math.random();
      const half = this.map.half;
      const l = { id: this.nextLoot++, ty, x: S.clamp(p.x + Math.cos(a) * 0.9, -half + 1, half - 1), z: S.clamp(p.z + Math.sin(a) * 0.9, -half + 1, half - 1), alive: true, at: Date.now() + DROP_LIFE_MS, temp: true };
      this.loot.push(l);
      this.broadcast({ t: 'loot', id: l.id, a: 1, ty: l.ty, x: r1(l.x), z: r1(l.z) });
    });
  }

  dropWeapon(p) {
    if (!this.map.loot || !p.alive || p.car || !p.own[p.wi]) return;
    const ty = S.WEAPON_ORDER[p.wi];
    p.own[p.wi] = false;
    const half = this.map.half, now = Date.now();
    const l = { id: this.nextLoot++, ty, x: S.clamp(p.x + Math.sin(p.yaw) * -1.8, -half + 1, half - 1), z: S.clamp(p.z + Math.cos(p.yaw) * -1.8, -half + 1, half - 1),
      alive: true, at: now + DROP_LIFE_MS, temp: true, noPick: p.id, noPickUntil: now + 2500 };
    this.loot.push(l);
    const nx = p.own.findIndex(Boolean);
    if (nx >= 0) p.wi = nx;
    this.broadcast({ t: 'loot', id: l.id, a: 1, ty: l.ty, x: r1(l.x), z: r1(l.z) });
    p.conn.send(Object.assign({ t: 'inv' }, invOf(p)));
  }

  updateLoot(now) {
    if (!this.map.loot) return;
    for (let i = this.loot.length - 1; i >= 0; i--) {
      const l = this.loot[i];
      if (!l.alive) {
        if (l.temp) { this.loot.splice(i, 1); continue; }
        if (now >= l.at) {
          l.alive = true; l.ty = S.rollLoot(Math.random);
          this.broadcast({ t: 'loot', id: l.id, a: 1, ty: l.ty, x: r1(l.x), z: r1(l.z) });
        }
      } else if (l.temp && now >= l.at) {
        this.loot.splice(i, 1);
        this.broadcast({ t: 'loot', id: l.id, a: 0 });
      }
    }
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      for (const l of this.loot) {
        if (!l.alive) continue;
        if (l.noPick === p.id && now < l.noPickUntil) continue;
        if (Math.abs(p.x - l.x) > PICK_R || Math.abs(p.z - l.z) > PICK_R || Math.hypot(p.x - l.x, p.z - l.z) > PICK_R) continue;
        if (this.tryPick(p, l)) {
          l.alive = false;
          l.at = now + LOOT_RESPAWN_MS;
          this.broadcast({ t: 'loot', id: l.id, a: 0 });
        }
      }
    }
  }

  tryPick(p, l) {
    const wi = S.WEAPON_ORDER.indexOf(l.ty);
    const m = /^(helmet|armor)([123])$/.exec(l.ty);
    if (wi >= 0) {
      if (p.own[wi] || p.own.filter(Boolean).length >= S.MAX_SLOTS) return false;
      p.own[wi] = true;
    } else if (m) {
      const lv = +m[2];
      if (m[1] === 'helmet') {
        const max = S.HELMETS[lv].hp;
        if (lv < p.hl || (lv === p.hl && p.helmet >= max)) return false;
        p.hl = lv; p.helmet = max;
      } else {
        const max = S.ARMORS[lv].hp;
        if (lv < p.al || (lv === p.al && p.armor >= max)) return false;
        p.al = lv; p.armor = max;
      }
    } else if (l.ty === 'medkit') {
      if (p.hp >= 100) return false;
      p.hp = 100;
    } else if (l.ty === 'bandage') {
      if (p.hp >= 100) return false;
      p.hp = Math.min(100, p.hp + 20);
    } else if (l.ty === 'grenade') {
      if (p.gr >= S.MAX_GRENADES) return false;
      p.gr = Math.min(S.MAX_GRENADES, p.gr + 2);
    } else if (l.ty === 'smoke') {
      if (p.sm >= S.MAX_SMOKES) return false;
      p.sm++;
    } else if (l.ty === 'scope') {
      if (p.sc) return false;
      p.sc = true;
    } else if (l.ty === 'supp') {
      if (p.su) return false;
      p.su = true;
    } else return false;
    p.conn.send(Object.assign({ t: 'pick', ty: l.ty }, invOf(p)));
    return true;
  }

  /* ---- maşınlar ---- */
  freeCar(p) {
    if (!p.car) return;
    const c = this.cars.find((q) => q.id === p.car);
    if (c) { c.driver = 0; c.sp = 0; }
    p.car = 0;
  }

  enterCar(p, id) {
    if (!p.alive || p.car || this.state !== 'play') return;
    const c = this.cars.find((q) => q.id === (id | 0));
    if (!c || c.driver) return;
    if (Math.hypot(c.x - p.x, c.z - p.z) > 5) return;
    c.driver = p.id; c.sp = 0; c.lastAt = Date.now();
    p.car = c.id; p.crouch = false;
    p.conn.send({ t: 'drive', car: c.id });
  }

  exitCar(p) {
    if (!p.car) return;
    const c = this.cars.find((q) => q.id === p.car);
    if (c) {
      const pos = { x: c.x + Math.cos(c.yaw) * 2.4, y: 0, z: c.z - Math.sin(c.yaw) * 2.4 };
      S.resolve(pos, this.map);
      p.x = pos.x; p.z = pos.z; p.y = 0;
      c.driver = 0; c.sp = 0;
    }
    p.car = 0;
    p.seq++; p.lastState = Date.now();
    p.conn.send({ t: 'exited', x: r1(p.x), z: r1(p.z), seq: p.seq });
  }

  carState(p, m) {
    const c = p.car && this.cars.find((q) => q.id === p.car);
    if (!c || c.driver !== p.id || !p.alive) return;
    const now = Date.now();
    const dt = Math.min(0.5, Math.max(0.02, (now - c.lastAt) / 1000));
    c.lastAt = now;
    let x = Number(m.x), z = Number(m.z), yaw = Number(m.yaw), sp = Number(m.sp);
    if (!isFinite(x) || !isFinite(z) || !isFinite(yaw) || !isFinite(sp)) return;
    const maxd = CAR_MAX_SPEED * dt * 1.4 + 1;
    const d = Math.hypot(x - c.x, z - c.z);
    if (d > maxd) { x = c.x + (x - c.x) / d * maxd; z = c.z + (z - c.z) / d * maxd; }
    const half = this.map.half;
    c.x = S.clamp(x, -half + 1, half - 1); c.z = S.clamp(z, -half + 1, half - 1);
    c.yaw = yaw; c.sp = S.clamp(sp, -12, CAR_MAX_SPEED);
    p.x = c.x; p.z = c.z; p.y = 0; p.yaw = yaw; p.lastState = now;
  }

  updateCars(now) {
    for (const c of this.cars) {
      if (!c.driver || Math.abs(c.sp) < 6) continue;
      const driver = this.players.get(c.driver);
      if (!driver || !driver.alive) continue;
      for (const e of this.entities()) {
        if (e === driver || !this.isEnemy(driver, e) || e.car) continue;
        if (e.hitByCar && now - e.hitByCar < 700) continue;
        if (Math.hypot(e.x - c.x, e.z - c.z) > 2.0) continue;
        e.hitByCar = now;
        this.damage(e, driver, Math.min(120, Math.abs(c.sp) * 4.5), false, 'car', false);
      }
    }
  }

  /* ---- qumbaralar ---- */
  handleThrow(p, m) {
    if (!p.alive || this.state !== 'play') return;
    const kind = m.k === 'smoke' ? 'smoke' : 'frag';
    if (kind === 'frag' ? p.gr <= 0 : p.sm <= 0) return;
    const now = Date.now();
    if (now - p.lastThrow < 900) return;
    let dx = Number(m.dx), dy = Number(m.dy), dz = Number(m.dz);
    if (!isFinite(dx) || !isFinite(dy) || !isFinite(dz)) return;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return;
    dx /= len; dy /= len; dz /= len;
    p.lastThrow = now;
    if (kind === 'frag') p.gr--; else p.sm--;
    const eye = p.y + (p.crouch ? S.CROUCH_EYE : S.EYE);
    let x = p.x + dx * 0.5, y = eye - 0.2 + dy * 0.5, z = p.z + dz * 0.5;
    if (S.castWorld(p.x, eye, p.z, dx, dy, dz, 0.55, this.map) < 0.55) { x = p.x; y = eye - 0.2; z = p.z; }
    this.nades.push({ id: this.nextNade++, k: kind, x, y, z, vx: dx * 15, vy: dy * 15 + 3, vz: dz * 15, owner: p, born: now, fuse: kind === 'frag' ? NADE_FUSE : SMOKE_FUSE });
    p.conn.send(Object.assign({ t: 'inv' }, invOf(p)));
  }

  updateNades(now) {
    if (!this.nades.length) return;
    const dt = TICK / 1000, R = 0.12, half = this.map.half, boxes = this.map.boxes;
    for (let i = this.nades.length - 1; i >= 0; i--) {
      const n = this.nades[i];
      for (let step = 0; step < 2; step++) {
        const h = dt / 2;
        n.vy -= 16 * h;
        n.x += n.vx * h; n.y += n.vy * h; n.z += n.vz * h;
        if (n.y < R) {
          n.y = R; n.vy = -n.vy * 0.35; n.vx *= 0.72; n.vz *= 0.72;
          if (Math.abs(n.vy) < 1) n.vy = 0;
        }
        const lim = half - 0.2;
        if (n.x > lim) { n.x = lim; n.vx *= -0.4; } else if (n.x < -lim) { n.x = -lim; n.vx *= -0.4; }
        if (n.z > lim) { n.z = lim; n.vz *= -0.4; } else if (n.z < -lim) { n.z = -lim; n.vz *= -0.4; }
        for (let k = 0; k < boxes.length; k++) {
          const b = boxes[k];
          if (n.x <= b.x0 - R || n.x >= b.x1 + R || n.z <= b.z0 - R || n.z >= b.z1 + R || n.y <= b.y0 - R || n.y >= b.y1 + R) continue;
          const ox = Math.min(n.x - (b.x0 - R), (b.x1 + R) - n.x);
          const oz = Math.min(n.z - (b.z0 - R), (b.z1 + R) - n.z);
          const oy = Math.min(n.y - (b.y0 - R), (b.y1 + R) - n.y);
          if (oy <= ox && oy <= oz) {
            if (n.y - b.y0 > b.y1 - n.y) n.y = b.y1 + R; else n.y = b.y0 - R;
            n.vy *= -0.35; n.vx *= 0.8; n.vz *= 0.8;
          } else if (ox <= oz) {
            n.x = (n.x - b.cx > 0) ? b.x1 + R : b.x0 - R; n.vx *= -0.4;
          } else {
            n.z = (n.z - b.cz > 0) ? b.z1 + R : b.z0 - R; n.vz *= -0.4;
          }
        }
      }
      if (now - n.born < n.fuse) continue;
      this.nades.splice(i, 1);
      if (n.k === 'smoke') {
        this.broadcast({ t: 'smoke', p: [r1(n.x), r1(n.y), r1(n.z)], ms: SMOKE_MS });
        continue;
      }
      this.broadcast({ t: 'boom', p: [r1(n.x), r1(n.y), r1(n.z)] });
      const owner = n.owner;
      for (const e of this.entities()) {
        if (!(e === owner || this.isEnemy(owner, e))) continue;
        const cy = e.y + 1.0;
        const d = Math.hypot(e.x - n.x, cy - n.y, e.z - n.z);
        if (d > NADE_R) continue;
        const ux = (e.x - n.x) / (d || 1), uy = (cy - n.y) / (d || 1), uz = (e.z - n.z) / (d || 1);
        if (d > 0.6 && S.castWorld(n.x, n.y + 0.1, n.z, ux, uy, uz, d, this.map) < d - 0.1) continue;
        let dmg = NADE_DMG * Math.pow(1 - d / NADE_R, 1.3);
        if (dmg < 1) continue;
        let helm = false;
        if (!e.bot && e.armor > 0 && e.al > 0) {
          const ab = Math.min(e.armor, dmg * S.ARMORS[e.al].abs);
          e.armor -= ab; dmg -= ab; helm = true;
        }
        this.damage(e, owner, dmg, false, 'grenade', helm);
      }
    }
  }

  end(text) {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.endAt = Date.now() + END_MS;
    this.waveAt = 0;
    this.broadcast({ t: 'end', text, ms: END_MS });
  }

  /* ---- atəş ---- */
  handleShoot(p, m) {
    if (!p.alive || this.state !== 'play') return;
    const w = S.WEAPONS[m.w];
    if (!w) return;
    const now = Date.now();
    if (now - (p.lastFire[w.id] || 0) < w.rate * 0.8) return;
    const widx = S.WEAPON_ORDER.indexOf(w.id);
    if (!p.own[widx]) return;
    p.lastFire[w.id] = now;
    p.wi = widx;

    let dx = Number(m.dx), dy = Number(m.dy), dz = Number(m.dz);
    if (!isFinite(dx) || !isFinite(dy) || !isFinite(dz)) return;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return;
    dx /= len; dy /= len; dz /= len;

    const ox = p.x, oy = p.y + (p.crouch ? S.CROUCH_EYE : S.EYE), oz = p.z;
    // sapma üçün perpendikulyar oxlar
    let ux, uy, uz;
    if (Math.abs(dy) < 0.99) { ux = dz; uy = 0; uz = -dx; } else { ux = 1; uy = 0; uz = 0; }
    const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;

    const targets = this.entities().filter((e) => this.isEnemy(p, e));
    const hits = new Map();
    const ends = [];
    for (let i = 0; i < w.pellets; i++) {
      const rr = w.spread * Math.sqrt(Math.random());
      const aa = Math.random() * Math.PI * 2;
      const a = Math.cos(aa) * rr, b = Math.sin(aa) * rr;
      let rx = dx + ux * a + vx * b, ry = dy + uy * a + vy * b, rz = dz + uz * a + vz * b;
      const rl = Math.hypot(rx, ry, rz); rx /= rl; ry /= rl; rz /= rl;

      let tMax = S.castWorld(ox, oy, oz, rx, ry, rz, w.range, this.map);
      let best = null, bestT = tMax;
      for (const e of targets) {
        const t = S.rayCyl(ox, oy, oz, rx, ry, rz, e.x, e.z, e.y, e.y + (e.crouch ? S.CROUCH_HEIGHT : S.HEIGHT), 0.45);
        if (t !== null && t < bestT) { bestT = t; best = e; }
      }
      if (best) {
        const hy = oy + ry * bestT;
        const headLine = best.y + (best.crouch ? S.CROUCH_HEIGHT - 0.35 : S.HEIGHT - 0.35);
        const head = hy > headLine;
        const half = w.range * 0.5;
        const fall = bestT <= half ? 1 : Math.max(0.6, 1 - 0.4 * ((bestT - half) / half));
        let dmg = w.dmg * fall * (head ? 2 : 1);
        const h = hits.get(best) || { dmg: 0, head: false, helm: false };
        if (head && !best.bot && best.helmet > 0 && best.hl > 0) {
          // kask zədənin bir hissəsini udur, dayanıqlığı bitənə qədər
          const absorbed = Math.min(best.helmet, dmg * S.HELMETS[best.hl].abs);
          best.helmet -= absorbed;
          dmg -= absorbed;
          h.helm = true;
        } else if (!head && !best.bot && best.armor > 0 && best.al > 0) {
          // bədənlik bədənə dəyən zədənin bir hissəsini udur
          const absorbed = Math.min(best.armor, dmg * S.ARMORS[best.al].abs);
          best.armor -= absorbed;
          dmg -= absorbed;
          h.helm = true;
        }
        h.dmg += dmg; h.head = h.head || head;
        hits.set(best, h);
      }
      ends.push([r1(ox + rx * bestT), r1(oy + ry * bestT), r1(oz + rz * bestT)]);
    }
    const shotMsg = { t: 'shot', id: p.id, w: p.wi, o: [r2(ox), r2(oy), r2(oz)], e: ends };
    if (p.su) {
      // susdurucu: atəşi yalnız yaxındakılar görür/eşidir
      shotMsg.s = 1;
      const s = JSON.stringify(shotMsg);
      for (const q of this.players.values()) if (q === p || Math.hypot(q.x - p.x, q.z - p.z) < 28) q.conn.sendRaw(s);
    } else this.broadcast(shotMsg);
    for (const [victim, h] of hits) this.damage(victim, p, h.dmg, h.head, w.id, h.helm);
  }

  damage(victim, attacker, amount, head, wid, helm) {
    if (!victim.alive) return;
    victim.hp -= amount;
    victim.lastHurt = Date.now();
    const dead = victim.hp <= 0;
    if (attacker.conn) attacker.conn.send({ t: 'hit', dmg: Math.round(amount), head, kill: dead, v: victim.id, helm: !!helm });
    if (victim.conn) victim.conn.send({ t: 'hurt', hp: Math.max(0, Math.round(victim.hp)), hm: Math.round(victim.helmet), am: Math.round(victim.armor), ax: attacker.x, az: attacker.z });
    if (dead) this.kill(victim, attacker, head, wid);
  }

  kill(victim, attacker, head, wid) {
    victim.alive = false;
    victim.hp = 0;
    if (!victim.bot) this.dropLoot(victim);
    victim.deaths++;
    if (attacker !== victim) attacker.kills++;
    if (this.mode === 'tdm' && attacker.team in this.score) this.score[attacker.team]++;
    this.broadcast({ t: 'kill', k: attacker.id, v: victim.id, w: wid, head: !!head });
    if (victim.bot) {
      this.bots = this.bots.filter((b) => b !== victim);
    } else {
      victim.respawnAt = this.mode === 'coop' ? 0 : Date.now() + RESPAWN_MS;
      if (!this.map.loot) { victim.needsPick = true; victim.pickFromDeath = true; victim.ready = false; victim.pickDeadline = Date.now() + RESPAWN_MS + PICK_WAIT_MS; }
      this.freeCar(victim);
    }
    this.rosterDirty = true;

    if (this.mode === 'ffa' && !attacker.bot && attacker.kills >= FFA_KILLS) this.end('Qalib: ' + attacker.name);
    else if (this.mode === 'tdm' && this.score.red >= TDM_KILLS) this.end('Qalib komanda: Qırmızı');
    else if (this.mode === 'tdm' && this.score.blue >= TDM_KILLS) this.end('Qalib komanda: Mavi');
    else if (this.mode === 'coop') this.checkCoopDefeat();
  }

  checkCoopDefeat() {
    if (this.state !== 'play') return;
    for (const p of this.players.values()) if (p.alive) return;
    this.end('Məğlub oldunuz. Çatdığınız dalğa: ' + this.wave);
  }

  /* ---- botlar (birgə rejim) ---- */
  coopLogic(now) {
    if (this.mode !== 'coop') return;
    if (this.bots.length === 0 && !this.waveAt) {
      this.waveAt = now + 5000;
      this.broadcast({ t: 'msg', text: 'Dalğa ' + (this.wave + 1) + ' 5 saniyəyə başlayır' });
    }
    if (this.waveAt && now >= this.waveAt) {
      this.waveAt = 0;
      this.wave++;
      for (const p of this.players.values()) { if (!p.alive) this.spawn(p); else { p.helmet = S.HELMETS[p.hl || 2].hp; p.armor = S.ARMORS[p.al || 2].hp; p.gr = Math.max(p.gr, 2); p.sm = Math.max(p.sm, 1); p.conn.send(Object.assign({ t: 'inv' }, invOf(p))); } }
      const count = Math.min(30, 3 + this.wave * 2);
      for (let i = 0; i < count; i++) this.spawnBot();
      this.broadcast({ t: 'wave', n: this.wave, bots: count });
    }
  }

  spawnBot() {
    const sp = this.pickSpawn();
    const b = {
      id: this.nextBotId++, bot: true, name: 'Bot', team: 'bot',
      x: sp[0] + (Math.random() - 0.5) * 3, y: 0, z: sp[1] + (Math.random() - 0.5) * 3,
      yaw: 0, pitch: 0, hp: Math.min(100, 50 + this.wave * 8), alive: true, wi: RIFLE,
      kills: 0, deaths: 0, nextShot: Date.now() + 1500 + Math.random() * 1500, strafe: Math.random() * 6
    };
    S.resolve(b, this.map);
    this.bots.push(b);
  }

  updateBots(now) {
    if (this.mode !== 'coop' || this.bots.length === 0) return;
    const humans = [...this.players.values()].filter((p) => p.alive);
    const dt = TICK / 1000;
    const speed = Math.min(5, 3.2 + this.wave * 0.12);
    for (const b of this.bots) {
      if (!humans.length) break;
      let target = null, best = 1e9;
      for (const h of humans) {
        const d = Math.hypot(h.x - b.x, h.z - b.z);
        if (d < best) { best = d; target = h; }
      }
      const dx = target.x - b.x, dz = target.z - b.z;
      const dist = Math.max(0.001, best);
      b.yaw = Math.atan2(-dx, -dz);
      const fx = dx / dist, fz = dz / dist;
      const sx = -fz, sz = fx;
      b.strafe += dt;
      let mx = 0, mz = 0;
      if (now < (b.detourUntil || 0)) {
        // maneəyə ilişibsə, yana doğru dolanır
        mx = sx * b.detourDir + fx * 0.3;
        mz = sz * b.detourDir + fz * 0.3;
      } else {
        if (dist > 8) { mx = fx; mz = fz; }
        else if (dist < 4) { mx = -fx * 0.6; mz = -fz * 0.6; }
        mx += sx * Math.sin(b.strafe * 1.3) * 0.5;
        mz += sz * Math.sin(b.strafe * 1.3) * 0.5;
      }
      const px = b.x, pz = b.z;
      b.x += mx * speed * dt;
      b.z += mz * speed * dt;
      for (const o of this.bots) {
        if (o === b) continue;
        const ddx = b.x - o.x, ddz = b.z - o.z, dd = Math.hypot(ddx, ddz);
        if (dd < 0.9 && dd > 0.001) { b.x += ddx / dd * 0.05; b.z += ddz / dd * 0.05; }
      }
      S.resolve(b, this.map);
      const intended = Math.hypot(mx, mz) * speed * dt;
      const moved = Math.hypot(b.x - px, b.z - pz);
      if (intended > 0.01 && moved < intended * 0.4) b.stuck = (b.stuck || 0) + dt;
      else b.stuck = Math.max(0, (b.stuck || 0) - dt);
      if (b.stuck > 0.4) {
        b.stuck = 0;
        b.detourUntil = now + 1500;
        b.detourDir = Math.random() < 0.5 ? -1 : 1;
      }

      if (now >= b.nextShot && dist < 32) {
        const ox = b.x, oy = 1.5, oz = b.z;
        const tx = target.x, ty = target.y + 1.2, tz = target.z;
        let rdx = tx - ox, rdy = ty - oy, rdz = tz - oz;
        const rl = Math.hypot(rdx, rdy, rdz);
        rdx /= rl; rdy /= rl; rdz /= rl;
        const wall = S.castWorld(ox, oy, oz, rdx, rdy, rdz, rl, this.map);
        if (wall >= rl - 0.01) {
          b.nextShot = now + 700 + Math.random() * 600;
          const chance = Math.max(0.15, 0.45 - dist * 0.008);
          const hit = Math.random() < chance;
          const ex = hit ? tx : tx + (Math.random() - 0.5) * 2.5;
          const ey = hit ? ty : ty + (Math.random() - 0.5) * 1.5;
          const ez = hit ? tz : tz + (Math.random() - 0.5) * 2.5;
          this.broadcast({ t: 'shot', id: b.id, w: RIFLE, o: [r2(ox), r2(oy), r2(oz)], e: [[r1(ex), r1(ey), r1(ez)]] });
          if (hit) this.damage(target, b, Math.min(18, 8 + this.wave), false, 'rifle');
        } else {
          b.nextShot = now + 250;
        }
      }
    }
  }

  /* ---- əsas dövr ---- */
  tick() {
    const now = Date.now();
    if (this.state === 'ended') {
      if (now >= this.endAt) this.reset();
    } else {
      this.coopLogic(now);
      this.updateBots(now);
      this.updateLoot(now);
      this.updateNades(now);
      this.updateCars(now);
      for (const p of this.players.values()) {
        if (p.alive) continue;
        if (p.needsPick) {
          if (this.mode === 'coop' && p.pickFromDeath) continue; // dalğa başlayanda doğulur
          if ((p.ready && now >= p.respawnAt) || now >= p.pickDeadline) this.spawn(p);
        } else if (p.respawnAt && now >= p.respawnAt) this.spawn(p);
      }
    }
    for (const p of this.players.values()) {
      if (p.alive && p.hp < 100 && now - p.lastHurt > 5000) p.hp = Math.min(100, p.hp + 0.5);
    }
    if (this.rosterDirty) this.sendRoster();

    const arr = [];
    for (const p of this.players.values()) {
      arr.push([p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), r2(p.pitch), Math.round(p.hp), p.wi, (p.alive ? 1 : 0) | (p.crouch ? 4 : 0) | (p.own.some(Boolean) ? 0 : 8) | (p.car ? 16 : 0), Math.round(p.helmet), Math.round(p.armor)]);
    }
    for (const b of this.bots) {
      arr.push([b.id, r2(b.x), r2(b.y), r2(b.z), r2(b.yaw), 0, Math.round(b.hp), RIFLE, 3]);
    }
    const gl = this.nades.map((n) => [n.id, n.k === 'frag' ? 0 : 1, r2(n.x), r2(n.y), r2(n.z)]);
    this.broadcast({
      t: 'snap', p: arr, g: gl, c: this.cars.map((c) => [c.id, r1(c.x), r1(c.z), r2(c.yaw), r1(c.sp), c.driver]),
      m: { s: this.state, r: this.score.red, b: this.score.blue, wv: this.wave, bots: this.bots.length }
    });
  }
}

/* ---------------- Mesaj emalı ---------------- */
function onMessage(conn, raw) {
  if (raw.length > 2000) return;
  let m;
  try { m = JSON.parse(raw); } catch (e) { return; }
  if (!m || typeof m.t !== 'string') return;

  if (m.t === 'join') {
    if (conn.player) return;
    const name = String(m.name || '').trim().slice(0, 14) || 'Oyunçu';
    let code = sanitizeCode(m.room);
    let room = code ? rooms.get(code) : null;
    if (!room) {
      if (!code) code = randomCode();
      const mode = MODES.includes(m.mode) ? m.mode : 'ffa';
      room = new Room(code, mode, String(m.map || 'arena'));
      rooms.set(code, room);
    }
    if (room.players.size >= MAX_PLAYERS) {
      conn.send({ t: 'error', text: 'Otaq doludur (maksimum ' + MAX_PLAYERS + ' oyunçu).' });
      return;
    }
    room.add(conn, name);
    return;
  }

  const p = conn.player;
  const room = conn.room;
  if (!p || !room) return;

  if (m.t === 'state') {
    if (!p.alive || m.seq !== p.seq || p.car) return;
    const now = Date.now();
    const dt = Math.min(0.5, Math.max(0.01, (now - p.lastState) / 1000));
    p.lastState = now;
    let x = Number(m.x), y = Number(m.y), z = Number(m.z);
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;
    const maxd = 8.5 * dt * 1.3 + 0.5;
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > maxd) { x = p.x + (x - p.x) / d * maxd; z = p.z + (z - p.z) / d * maxd; }
    const half = room.map.half;
    p.x = S.clamp(x, -half + 0.4, half - 0.4);
    p.z = S.clamp(z, -half + 0.4, half - 0.4);
    p.y = S.clamp(y, 0, 6);
    const yaw = Number(m.yaw), pitch = Number(m.pitch);
    if (isFinite(yaw)) p.yaw = yaw;
    if (isFinite(pitch)) p.pitch = S.clamp(pitch, -1.6, 1.6);
    const wi = m.wi | 0;
    if (wi >= 0 && wi < S.WEAPON_ORDER.length && p.own[wi]) p.wi = wi;
    p.crouch = m.c === 1;
  } else if (m.t === 'loadout') {
    const L = cleanLoadout(m);
    if (L) p.loadout = L;
    p.ready = true;
  } else if (m.t === 'drop') {
    room.dropWeapon(p);
  } else if (m.t === 'enter') {
    room.enterCar(p, m.car);
  } else if (m.t === 'exit') {
    room.exitCar(p);
  } else if (m.t === 'car') {
    room.carState(p, m);
  } else if (m.t === 'throw') {
    room.handleThrow(p, m);
  } else if (m.t === 'shoot') {
    room.handleShoot(p, m);
  } else if (m.t === 'chat') {
    const text = String(m.text || '').trim().slice(0, 80);
    if (text) room.broadcast({ t: 'chat', id: p.id, name: p.name, text });
  }
}

function onClose(conn) {
  if (conn.room && conn.player) conn.room.remove(conn.player);
  conn.room = null;
  conn.player = null;
}

/* ---------------- Başlat ---------------- */
server.listen(PORT, '0.0.0.0', () => {
  console.log('Arena Atışma serveri işləyir.\n');
  console.log('  Bu kompüterdə:   http://localhost:' + PORT);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) console.log('  Eyni Wi-Fi-da:   http://' + ni.address + ':' + PORT);
    }
  }
  console.log('\nİnternet üzərindən dostlarla oynamaq üçün README.md faylına baxın.');
});

module.exports = { server, rooms };
