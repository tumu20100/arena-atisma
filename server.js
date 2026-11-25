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
  constructor(code, mode) {
    this.code = code;
    this.mode = mode;
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
      lastHurt: 0, respawnAt: 0
    };
    if (this.mode === 'tdm') {
      let red = 0, blue = 0;
      for (const q of this.players.values()) q.team === 'red' ? red++ : blue++;
      p.team = red <= blue ? 'red' : 'blue';
    } else if (this.mode === 'coop') p.team = 'coop';
    this.players.set(p.id, p);
    conn.player = p;
    conn.room = this;
    conn.send({ t: 'welcome', id: p.id, room: this.code, mode: this.mode, team: p.team });
    this.spawn(p);
    this.sendRoster();
    return p;
  }

  remove(p) {
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
    const scored = S.SPAWNS.map((sp) => {
      let min = 1e9;
      for (const o of others) min = Math.min(min, Math.hypot(o.x - sp[0], o.z - sp[1]));
      return { sp, min: min + Math.random() * 6 };
    }).sort((a, b) => b.min - a.min);
    return scored[(Math.random() * 3) | 0].sp;
  }

  spawn(p) {
    const sp = this.pickSpawn();
    p.x = sp[0]; p.z = sp[1]; p.y = 0;
    p.hp = 100; p.alive = true; p.respawnAt = 0;
    p.seq++; p.lastState = Date.now();
    const yaw = Math.atan2(p.x, p.z);
    p.yaw = yaw; p.pitch = 0;
    p.conn.send({ t: 'spawn', x: p.x, y: p.y, z: p.z, yaw, seq: p.seq });
  }

  reset() {
    this.state = 'play';
    this.score = { red: 0, blue: 0 };
    this.bots = [];
    this.wave = 0;
    this.waveAt = 0;
    for (const p of this.players.values()) { p.kills = 0; p.deaths = 0; this.spawn(p); }
    this.broadcast({ t: 'reset' });
    this.sendRoster();
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
    p.lastFire[w.id] = now;
    p.wi = S.WEAPON_ORDER.indexOf(w.id);

    let dx = Number(m.dx), dy = Number(m.dy), dz = Number(m.dz);
    if (!isFinite(dx) || !isFinite(dy) || !isFinite(dz)) return;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return;
    dx /= len; dy /= len; dz /= len;

    const ox = p.x, oy = p.y + S.EYE, oz = p.z;
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

      let tMax = S.castWorld(ox, oy, oz, rx, ry, rz, w.range);
      let best = null, bestT = tMax;
      for (const e of targets) {
        const t = S.rayCyl(ox, oy, oz, rx, ry, rz, e.x, e.z, e.y, e.y + S.HEIGHT, 0.45);
        if (t !== null && t < bestT) { bestT = t; best = e; }
      }
      if (best) {
        const hy = oy + ry * bestT;
        const head = hy > best.y + 1.45;
        const half = w.range * 0.5;
        const fall = bestT <= half ? 1 : Math.max(0.6, 1 - 0.4 * ((bestT - half) / half));
        const dmg = w.dmg * fall * (head ? 2 : 1);
        const h = hits.get(best) || { dmg: 0, head: false };
        h.dmg += dmg; h.head = h.head || head;
        hits.set(best, h);
      }
      ends.push([r1(ox + rx * bestT), r1(oy + ry * bestT), r1(oz + rz * bestT)]);
    }
    this.broadcast({ t: 'shot', id: p.id, w: p.wi, o: [r2(ox), r2(oy), r2(oz)], e: ends });
    for (const [victim, h] of hits) this.damage(victim, p, h.dmg, h.head, w.id);
  }

  damage(victim, attacker, amount, head, wid) {
    if (!victim.alive) return;
    victim.hp -= amount;
    victim.lastHurt = Date.now();
    const dead = victim.hp <= 0;
    if (attacker.conn) attacker.conn.send({ t: 'hit', dmg: Math.round(amount), head, kill: dead, v: victim.id });
    if (victim.conn) victim.conn.send({ t: 'hurt', hp: Math.max(0, Math.round(victim.hp)), ax: attacker.x, az: attacker.z });
    if (dead) this.kill(victim, attacker, head, wid);
  }

  kill(victim, attacker, head, wid) {
    victim.alive = false;
    victim.hp = 0;
    victim.deaths++;
    if (attacker !== victim) attacker.kills++;
    if (this.mode === 'tdm' && attacker.team in this.score) this.score[attacker.team]++;
    this.broadcast({ t: 'kill', k: attacker.id, v: victim.id, w: wid, head: !!head });
    if (victim.bot) {
      this.bots = this.bots.filter((b) => b !== victim);
    } else {
      victim.respawnAt = this.mode === 'coop' ? 0 : Date.now() + RESPAWN_MS;
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
      for (const p of this.players.values()) if (!p.alive) this.spawn(p);
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
      yaw: 0, pitch: 0, hp: Math.min(100, 50 + this.wave * 8), alive: true, wi: 1,
      kills: 0, deaths: 0, nextShot: Date.now() + 1500 + Math.random() * 1500, strafe: Math.random() * 6
    };
    S.resolve(b);
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
      S.resolve(b);
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
        const wall = S.castWorld(ox, oy, oz, rdx, rdy, rdz, rl);
        if (wall >= rl - 0.01) {
          b.nextShot = now + 700 + Math.random() * 600;
          const chance = Math.max(0.15, 0.45 - dist * 0.008);
          const hit = Math.random() < chance;
          const ex = hit ? tx : tx + (Math.random() - 0.5) * 2.5;
          const ey = hit ? ty : ty + (Math.random() - 0.5) * 1.5;
          const ez = hit ? tz : tz + (Math.random() - 0.5) * 2.5;
          this.broadcast({ t: 'shot', id: b.id, w: 1, o: [r2(ox), r2(oy), r2(oz)], e: [[r1(ex), r1(ey), r1(ez)]] });
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
      for (const p of this.players.values()) {
        if (!p.alive && p.respawnAt && now >= p.respawnAt) this.spawn(p);
      }
    }
    for (const p of this.players.values()) {
      if (p.alive && p.hp < 100 && now - p.lastHurt > 5000) p.hp = Math.min(100, p.hp + 0.5);
    }
    if (this.rosterDirty) this.sendRoster();

    const arr = [];
    for (const p of this.players.values()) {
      arr.push([p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), r2(p.pitch), Math.round(p.hp), p.wi, p.alive ? 1 : 0]);
    }
    for (const b of this.bots) {
      arr.push([b.id, r2(b.x), r2(b.y), r2(b.z), r2(b.yaw), 0, Math.round(b.hp), 1, 3]);
    }
    this.broadcast({
      t: 'snap', p: arr,
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
      room = new Room(code, mode);
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
    if (!p.alive || m.seq !== p.seq) return;
    const now = Date.now();
    const dt = Math.min(0.5, Math.max(0.01, (now - p.lastState) / 1000));
    p.lastState = now;
    let x = Number(m.x), y = Number(m.y), z = Number(m.z);
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;
    const maxd = 8.5 * dt * 1.3 + 0.5;
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > maxd) { x = p.x + (x - p.x) / d * maxd; z = p.z + (z - p.z) / d * maxd; }
    p.x = S.clamp(x, -S.HALF + 0.4, S.HALF - 0.4);
    p.z = S.clamp(z, -S.HALF + 0.4, S.HALF - 0.4);
    p.y = S.clamp(y, 0, 6);
    const yaw = Number(m.yaw), pitch = Number(m.pitch);
    if (isFinite(yaw)) p.yaw = yaw;
    if (isFinite(pitch)) p.pitch = S.clamp(pitch, -1.6, 1.6);
    const wi = m.wi | 0;
    if (wi >= 0 && wi < S.WEAPON_ORDER.length) p.wi = wi;
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
