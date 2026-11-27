/* Həm server, həm brauzer istifadə edir: silahlar, xəritə, toqquşma və şüa hesablamaları. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EYE = 1.6;          // göz hündürlüyü
  var HEIGHT = 1.8;       // oyunçu hündürlüyü
  var RADIUS = 0.4;       // oyunçu dairəsinin radiusu
  var CROUCH_EYE = 1.05;  // əyiləndə göz hündürlüyü
  var CROUCH_HEIGHT = 1.25; // əyiləndə bədən hündürlüyü
  var STEP = 0.5;         // pilləkən kimi çıxıla bilən maksimum hündürlük

  // kask və bədənlik səviyyələri: dayanıqlıq və udduğu zədə payı
  var HELMETS = [null, { hp: 50, abs: 0.45 }, { hp: 90, abs: 0.6 }, { hp: 130, abs: 0.75 }];
  var ARMORS = [null, { hp: 60, abs: 0.35 }, { hp: 100, abs: 0.5 }, { hp: 150, abs: 0.65 }];

  var WEAPONS = {
    pistol:  { id: 'pistol',  name: 'P92',     dmg: 22,  rate: 280,  mag: 12, reload: 1300, spread: 0.006,  pellets: 1, range: 80,  auto: false, recoil: 0.022, zoom: 55, len: 0.7 },
    deagle:  { id: 'deagle',  name: 'Deagle',  dmg: 46,  rate: 520,  mag: 7,  reload: 1800, spread: 0.007,  pellets: 1, range: 90,  auto: false, recoil: 0.055, zoom: 55, len: 0.8 },
    uzi:     { id: 'uzi',     name: 'UZI',     dmg: 10,  rate: 62,   mag: 30, reload: 1700, spread: 0.034,  pellets: 1, range: 50,  auto: true,  recoil: 0.007, zoom: 55, len: 0.85 },
    rifle:   { id: 'rifle',   name: 'M416',    dmg: 14,  rate: 95,   mag: 30, reload: 1900, spread: 0.018,  pellets: 1, range: 100, auto: true,  recoil: 0.012, zoom: 50, len: 1 },
    akm:     { id: 'akm',     name: 'AKM',     dmg: 19,  rate: 115,  mag: 30, reload: 2100, spread: 0.022,  pellets: 1, range: 100, auto: true,  recoil: 0.02,  zoom: 50, len: 1.05 },
    dmr:     { id: 'dmr',     name: 'SKS',     dmg: 36,  rate: 230,  mag: 10, reload: 2300, spread: 0.005,  pellets: 1, range: 150, auto: false, recoil: 0.04,  zoom: 35, len: 1.15 },
    lmg:     { id: 'lmg',     name: 'M249',    dmg: 13,  rate: 80,   mag: 75, reload: 4200, spread: 0.026,  pellets: 1, range: 110, auto: true,  recoil: 0.014, zoom: 50, len: 1.2 },
    shotgun: { id: 'shotgun', name: 'S12K',    dmg: 11,  rate: 850,  mag: 6,  reload: 2400, spread: 0.07,   pellets: 8, range: 35,  auto: false, recoil: 0.07,  zoom: 60, len: 1.05 },
    sniper:  { id: 'sniper',  name: 'Kar98k',  dmg: 85,  rate: 1300, mag: 5,  reload: 2600, spread: 0.0008, pellets: 1, range: 200, auto: false, recoil: 0.06,  zoom: 18, len: 1.3 },
    awm:     { id: 'awm',     name: 'AWM',     dmg: 110, rate: 1700, mag: 5,  reload: 3200, spread: 0.0006, pellets: 1, range: 250, auto: false, recoil: 0.075, zoom: 14, len: 1.4 }
  };
  var WEAPON_ORDER = ['pistol', 'deagle', 'uzi', 'rifle', 'akm', 'dmr', 'lmg', 'shotgun', 'sniper', 'awm'];
  var MAX_GRENADES = 5, MAX_SMOKES = 3;

  /* ---------------- Xəritələr ---------------- */
  var T = 0.4; // ev divarının qalınlığı

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function newMap(id, half, name) {
    return { id: id, name: name, half: half, boxes: [], spawns: [], houses: [], lootSpots: [], loot: false };
  }
  function addBox(m, cx, cz, w, d, y1, o) {
    o = o || {};
    var y0 = o.y0 || 0;
    m.boxes.push({ cx: cx, cz: cz, w: w, d: d, h: y1, wall: !!o.wall, kind: o.kind || null, c: o.c || 0,
      x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, y0: y0, y1: y1 });
  }
  function sym(m, cx, cz, w, d, h) {
    var xs = cx === 0 ? [0] : [-cx, cx];
    var zs = cz === 0 ? [0] : [-cz, cz];
    for (var i = 0; i < xs.length; i++) for (var j = 0; j < zs.length; j++) addBox(m, xs[i], zs[j], w, d, h);
  }
  function outerWalls(m) {
    var H = m.half;
    addBox(m, 0, -(H + 1), 2 * H + 4, 2, 8, { wall: true });
    addBox(m, 0, H + 1, 2 * H + 4, 2, 8, { wall: true });
    addBox(m, -(H + 1), 0, 2, 2 * H + 4, 8, { wall: true });
    addBox(m, H + 1, 0, 2, 2 * H + 4, 8, { wall: true });
  }

  /* --- 1. Arena (beton meydança, böyüdülmüş) --- */
  var ARENA = newMap('arena', 45, 'Arena');
  (function () {
    var m = ARENA;
    outerWalls(m);
    addBox(m, 0, 0, 8, 8, 3);
    sym(m, 18, 18, 5, 5, 2);
    sym(m, 20, 0, 2.5, 14, 2.5);
    sym(m, 0, 22, 14, 2.5, 2.5);
    sym(m, 9, 12, 2, 2, 1);
    sym(m, 30, 9, 3, 3, 1);
    sym(m, 12, 33, 3, 3, 1);
    sym(m, 33, 27, 4, 2, 1.2);
    sym(m, 36, 8, 1.5, 1.5, 4);
    sym(m, 27, 18, 1.5, 1.5, 4);
    sym(m, 8, 38, 2, 2, 1);
    sym(m, 38, 20, 2, 2, 1);
    sym(m, 26, 36, 6, 2, 2.5);
    sym(m, 0, 9, 3, 3, 1.2);
    m.spawns = [[-40, -40], [40, -40], [-40, 40], [40, 40], [0, -41], [0, 41], [-41, 0], [41, 0]];
  })();

  /* --- 2. Açıq dünya: kəndlər, tək evlər, meşələr, maşınlar (700x700 m) --- */
  var ISLAND = newMap('island', 350, 'Açıq dünya');
  ISLAND.loot = true;
  ISLAND.cars = [];
  (function () {
    var m = ISLAND, r = rng(7), HALF_I = m.half;
    outerWalls(m);

    function seg(ax, fixed, a, b, y0, y1, c) {
      if (b - a < 0.05) return;
      var mid = (a + b) / 2, len = b - a;
      if (ax === 'x') addBox(m, mid, fixed, len, T, y1, { y0: y0, kind: 'hwall', c: c });
      else addBox(m, fixed, mid, T, len, y1, { y0: y0, kind: 'hwall', c: c });
    }
    function wall(ax, fixed, a0, a1, ops, c) {
      ops.sort(function (p, q) { return p.at - q.at; });
      var cur = a0;
      ops.forEach(function (o) {
        var o0 = o.at - o.w / 2, o1 = o.at + o.w / 2;
        seg(ax, fixed, cur, o0, 0, 3, c);
        if (o.type === 'door') seg(ax, fixed, o0, o1, 2.2, 3, c);
        else { seg(ax, fixed, o0, o1, 0, 1.0, c); seg(ax, fixed, o0, o1, 2.0, 3, c); }
        cur = o1;
      });
      seg(ax, fixed, cur, a1, 0, 3, c);
    }

    /* evlərin yerləşdirilməsi */
    var H = [];
    var SIZES_W = [7, 8, 8, 9, 10, 12], SIZES_D = [6, 7, 7, 8, 9];
    function houseFree(cx, cz, w, d, gap) {
      if (Math.abs(cx) > HALF_I - 22 || Math.abs(cz) > HALF_I - 22) return false;
      for (var i = 0; i < H.length; i++) {
        var h = H[i];
        if (Math.abs(cx - h[0]) < (w + h[2]) / 2 + gap && Math.abs(cz - h[1]) < (d + h[3]) / 2 + gap) return false;
      }
      return true;
    }
    function tryHouse(cx, cz, gap) {
      var w = SIZES_W[(r() * SIZES_W.length) | 0], d = SIZES_D[(r() * SIZES_D.length) | 0];
      if (!houseFree(cx, cz, w, d, gap)) return false;
      H.push([Math.round(cx), Math.round(cz), w, d]);
      return true;
    }
    var villages = [];
    for (var vt = 0; vt < 600 && villages.length < 16; vt++) {
      var vx = (r() * 2 - 1) * (HALF_I - 70), vz = (r() * 2 - 1) * (HALF_I - 70), okv = true;
      for (var vi = 0; vi < villages.length; vi++) if (Math.hypot(villages[vi][0] - vx, villages[vi][1] - vz) < 110) okv = false;
      if (okv) villages.push([vx, vz]);
    }
    villages.forEach(function (v) {
      var n = 8 + ((r() * 6) | 0), placed = 0;
      for (var k = 0; k < 120 && placed < n; k++) {
        var ang = r() * Math.PI * 2, rad = 8 + Math.sqrt(r()) * 50;
        if (tryHouse(v[0] + Math.cos(ang) * rad, v[1] + Math.sin(ang) * rad, 8)) placed++;
      }
    });
    for (var lt = 0, lone = 0; lt < 800 && lone < 60; lt++) {
      if (tryHouse((r() * 2 - 1) * (HALF_I - 30), (r() * 2 - 1) * (HALF_I - 30), 16)) lone++;
    }

    H.forEach(function (h, i) {
      var cx = h[0], cz = h[1], w = h[2], d = h[3], c = i % 3;
      var big = w >= 11 || d >= 9;
      var side = Math.abs(cx) > Math.abs(cz) ? (cx > 0 ? 3 : 2) : (cz > 0 ? 1 : 0);
      if (r() < 0.35) side = (r() * 4) | 0; // hər ev mərkəzə baxmır
      m.houses.push({ cx: cx, cz: cz, w: w, d: d, c: c, side: side });
      var sgn = r() < 0.5 ? -1 : 1;
      var xs = [cx - w / 2, cx + w / 2], zs = [cz - d / 2, cz + d / 2];
      [[1, zs[0]], [0, zs[1]]].forEach(function (p) {
        var ops = [];
        if (side === p[0]) {
          ops.push({ at: cx + (big ? sgn * w / 4 : 0), w: 1.8, type: 'door' });
          if (big) ops.push({ at: cx - sgn * w / 4, w: 1.4, type: 'window' });
        } else if (side === (p[0] ^ 1) && side < 2) {
          if (big) ops.push({ at: cx - sgn * w / 4, w: 1.8, type: 'door' });
          else ops.push({ at: cx, w: 1.4, type: 'window' });
        } else ops.push({ at: cx, w: 1.4, type: 'window' });
        wall('x', p[1], xs[0] - T / 2, xs[1] + T / 2, ops, c);
      });
      [[3, xs[0]], [2, xs[1]]].forEach(function (p) {
        var ops = [];
        if (side === p[0]) {
          ops.push({ at: cz + (big ? sgn * d / 4 : 0), w: 1.8, type: 'door' });
          if (big) ops.push({ at: cz - sgn * d / 4, w: 1.4, type: 'window' });
        } else if (side === (p[0] ^ 1) && side >= 2) {
          if (big) ops.push({ at: cz - sgn * d / 4, w: 1.8, type: 'door' });
          else ops.push({ at: cz, w: 1.4, type: 'window' });
        } else ops.push({ at: cz, w: 1.4, type: 'window' });
        wall('z', p[1], zs[0] + T / 2, zs[1] - T / 2, ops, c);
      });
      if (big) {
        if (side < 2) wall('z', cx, zs[0] + T / 2, zs[1] - T / 2, [{ at: cz + 0.5, w: 1.6, type: 'door' }], c);
        else wall('x', cz, xs[0] + T / 2, xs[1] - T / 2, [{ at: cx + 0.5, w: 1.6, type: 'door' }], c);
      }
      addBox(m, cx, cz, w + 0.8, d + 0.8, 3.25, { y0: 3.0, kind: 'roof', c: c });
      var q = [[-0.25, -0.22], [0.25, 0.22]];
      if (big) q = [[-0.27, -0.25], [0.27, -0.25], [-0.27, 0.25], [0.27, 0.25]];
      q.forEach(function (o) { m.lootSpots.push([cx + o[0] * w, cz + o[1] * d]); });
    });

    function nearHouse(x, z, pad) {
      for (var i = 0; i < H.length; i++) {
        var h = H[i];
        if (Math.abs(x - h[0]) < h[2] / 2 + pad && Math.abs(z - h[1]) < h[3] / 2 + pad) return true;
      }
      return false;
    }
    var E = HALF_I - 6, Q = HALF_I / 2;
    m.spawns = [[-E, -E], [E, -E], [-E, E], [E, E], [0, -E], [0, E], [-E, 0], [E, 0],
      [-Q, -E], [Q, -E], [-Q, E], [Q, E], [-E, -Q], [E, -Q], [-E, Q], [E, Q]];
    function nearSpawn(x, z, d) {
      for (var i = 0; i < m.spawns.length; i++) if (Math.hypot(x - m.spawns[i][0], z - m.spawns[i][1]) < d) return true;
      return false;
    }
    var obst = []; // [x, z, radius]
    function obstFree(x, z, rad) {
      for (var i = 0; i < obst.length; i++) if (Math.hypot(obst[i][0] - x, obst[i][1] - z) < obst[i][2] + rad) return false;
      return true;
    }

    // maşınlar
    for (var ct = 0; ct < 800 && m.cars.length < 8; ct++) {
      var cx2 = (r() * 2 - 1) * (HALF_I - 40), cz2 = (r() * 2 - 1) * (HALF_I - 40);
      if (nearHouse(cx2, cz2, 8) || nearSpawn(cx2, cz2, 25) || !obstFree(cx2, cz2, 40)) continue;
      m.cars.push([Math.round(cx2), Math.round(cz2), r() * Math.PI * 2]);
      obst.push([cx2, cz2, 6]);
    }
    // açıq havada qutular və loot
    var crates = 0;
    for (var tries = 0; tries < 2000 && crates < 70; tries++) {
      var x = (r() * 2 - 1) * (HALF_I - 20), z = (r() * 2 - 1) * (HALF_I - 20);
      if (nearHouse(x, z, 5) || nearSpawn(x, z, 12) || !obstFree(x, z, 4)) continue;
      addBox(m, x + 1.3, z, 1.2, 1.2, 1.0, { kind: 'crate' });
      addBox(m, x + 1.4, z + 1.2, 1.2, 1.2, 1.0, { kind: 'crate' });
      m.lootSpots.push([x, z]);
      obst.push([x, z, 3]);
      crates++;
    }
    // daşlar
    for (var t2 = 0, rocks = 0; t2 < 2000 && rocks < 140; t2++) {
      var rx = (r() * 2 - 1) * (HALF_I - 10), rz = (r() * 2 - 1) * (HALF_I - 10);
      if (nearHouse(rx, rz, 4) || nearSpawn(rx, rz, 8) || !obstFree(rx, rz, 3)) continue;
      var rs = 1.6 + r() * 1.8;
      addBox(m, rx, rz, rs, rs * (0.8 + r() * 0.5), 1.0 + r() * 1.0, { kind: 'rock' });
      obst.push([rx, rz, 2]);
      rocks++;
    }
    // ağaclar: meşə kütlələri + tək ağaclar
    var forests = [];
    for (var ft = 0; ft < 40; ft++) forests.push([(r() * 2 - 1) * (HALF_I - 30), (r() * 2 - 1) * (HALF_I - 30), 20 + r() * 35]);
    var trees = 0, grid = {};
    function treeFree(x, z) {
      var gx = Math.floor(x / 4), gz = Math.floor(z / 4);
      for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) if (grid[(gx + a) + ',' + (gz + b)]) return false;
      return true;
    }
    for (var t3 = 0; t3 < 14000 && trees < 1700; t3++) {
      var tx, tz;
      if (r() < 0.7) {
        var f = forests[(r() * forests.length) | 0], ang2 = r() * Math.PI * 2, rr = Math.sqrt(r()) * f[2];
        tx = f[0] + Math.cos(ang2) * rr; tz = f[1] + Math.sin(ang2) * rr;
      } else { tx = (r() * 2 - 1) * (HALF_I - 8); tz = (r() * 2 - 1) * (HALF_I - 8); }
      if (Math.abs(tx) > HALF_I - 4 || Math.abs(tz) > HALF_I - 4) continue;
      if (nearHouse(tx, tz, 3.5) || nearSpawn(tx, tz, 5) || !obstFree(tx, tz, 1.5) || !treeFree(tx, tz)) continue;
      grid[Math.floor(tx / 4) + ',' + Math.floor(tz / 4)] = 1;
      addBox(m, tx, tz, 0.7, 0.7, 7, { kind: 'tree', c: (r() * 3) | 0 });
      trees++;
    }
  })();

  var MAPS = { arena: ARENA, island: ISLAND };
  var cur = ARENA;

  /* ---------------- Loot ---------------- */
  var LOOT_TYPES = ['pistol', 'deagle', 'uzi', 'rifle', 'akm', 'dmr', 'lmg', 'shotgun', 'sniper', 'awm',
    'helmet1', 'helmet2', 'helmet3', 'armor1', 'armor2', 'armor3', 'medkit', 'bandage', 'grenade', 'smoke', 'scope', 'supp'];
  var LOOT_WEIGHTS = [10, 5, 8, 8, 7, 4, 3, 8, 4, 1.5, 9, 5, 1.5, 9, 5, 1.5, 6, 10, 9, 6, 4, 4];
  function rollLoot(rand) {
    var tot = 0, i;
    for (i = 0; i < LOOT_WEIGHTS.length; i++) tot += LOOT_WEIGHTS[i];
    var v = rand() * tot;
    for (i = 0; i < LOOT_WEIGHTS.length; i++) { v -= LOOT_WEIGHTS[i]; if (v < 0) return LOOT_TYPES[i]; }
    return 'pistol';
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // Oyunçunu (pos: {x,y,z}, y = ayaq səviyyəsi) maneələrdən kənara itələyir.
  function resolve(pos, map, rad) {
    map = map || cur;
    var RAD = rad || RADIUS;
    var boxes = map.boxes;
    for (var it = 0; it < 3; it++) {
      for (var i = 0; i < boxes.length; i++) {
        var b = boxes[i];
        if (b.y1 <= pos.y + STEP) continue;
        if (b.y0 >= pos.y + HEIGHT) continue;
        var cx = clamp(pos.x, b.x0, b.x1), cz = clamp(pos.z, b.z0, b.z1);
        var dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
        if (d2 >= RAD * RAD) continue;
        if (d2 > 1e-8) {
          var d = Math.sqrt(d2), push = RAD - d;
          pos.x += dx / d * push;
          pos.z += dz / d * push;
        } else {
          var l = pos.x - b.x0, r = b.x1 - pos.x, t = pos.z - b.z0, bt = b.z1 - pos.z;
          var mn = Math.min(l, r, t, bt);
          if (mn === l) pos.x = b.x0 - RAD;
          else if (mn === r) pos.x = b.x1 + RAD;
          else if (mn === t) pos.z = b.z0 - RAD;
          else pos.z = b.z1 + RAD;
        }
      }
    }
    var lim = map.half - RAD;
    pos.x = clamp(pos.x, -lim, lim);
    pos.z = clamp(pos.z, -lim, lim);
  }

  // Verilən nöqtənin altındakı ən hündür dayanıla bilən səth.
  function groundAt(x, z, feetY, map) {
    map = map || cur;
    var g = 0, boxes = map.boxes;
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      if (x + RADIUS > b.x0 && x - RADIUS < b.x1 && z + RADIUS > b.z0 && z - RADIUS < b.z1 &&
          b.y0 <= feetY + 0.1 && b.y1 <= feetY + STEP && b.y1 > g) g = b.y1;
    }
    return g;
  }

  // Şüa ilə qutu kəsişməsi. Kəsişmə məsafəsini qaytarır, yoxdursa null.
  function rayBox(ox, oy, oz, dx, dy, dz, b) {
    var tmin = 0, tmax = Infinity;
    var o = [ox, oy, oz], d = [dx, dy, dz];
    var mn = [b.x0, b.y0, b.z0], mx = [b.x1, b.y1, b.z1];
    for (var i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) {
        if (o[i] < mn[i] || o[i] > mx[i]) return null;
      } else {
        var t1 = (mn[i] - o[i]) / d[i], t2 = (mx[i] - o[i]) / d[i];
        if (t1 > t2) { var tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return null;
      }
    }
    return tmin;
  }

  // Şaquli silindrlə şüa kəsişməsi (oyunçu bədəni üçün).
  function rayCyl(ox, oy, oz, dx, dy, dz, cx, cz, y0, y1, r) {
    var fx = ox - cx, fz = oz - cz;
    var a = dx * dx + dz * dz;
    if (a < 1e-9) return null;
    var b = 2 * (fx * dx + fz * dz);
    var c = fx * fx + fz * fz - r * r;
    var disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    var s = Math.sqrt(disc);
    var t = (-b - s) / (2 * a);
    if (t < 0) t = (-b + s) / (2 * a);
    if (t < 0) return null;
    var y = oy + dy * t;
    if (y < y0 || y > y1) return null;
    return t;
  }

  // Şüanın divar və ya yerə dəyənə qədər məsafəsi.
  function castWorld(ox, oy, oz, dx, dy, dz, max, map) {
    map = map || cur;
    var t = max, boxes = map.boxes;
    for (var i = 0; i < boxes.length; i++) {
      var h = rayBox(ox, oy, oz, dx, dy, dz, boxes[i]);
      if (h !== null && h < t) t = h;
    }
    if (dy < 0) {
      var tf = -oy / dy;
      if (tf >= 0 && tf < t) t = tf;
    }
    return t;
  }

  var api = {
    EYE: EYE, HEIGHT: HEIGHT, RADIUS: RADIUS, STEP: STEP,
    CROUCH_EYE: CROUCH_EYE, CROUCH_HEIGHT: CROUCH_HEIGHT, HELMETS: HELMETS, ARMORS: ARMORS, MAX_GRENADES: MAX_GRENADES, MAX_SMOKES: MAX_SMOKES,
    WEAPONS: WEAPONS, WEAPON_ORDER: WEAPON_ORDER, MAPS: MAPS, LOOT_TYPES: LOOT_TYPES, rollLoot: rollLoot, rng: rng,
    resolve: resolve, groundAt: groundAt, rayBox: rayBox, rayCyl: rayCyl, castWorld: castWorld, clamp: clamp,
    setMap: function (id) {
      cur = MAPS[id] || ARENA;
      api.map = cur; api.HALF = cur.half; api.BOXES = cur.boxes; api.SPAWNS = cur.spawns;
      return cur;
    }
  };
  api.setMap('arena');
  return api;
});
