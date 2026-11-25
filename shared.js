/* Həm server, həm brauzer istifadə edir: silahlar, xəritə, toqquşma və şüa hesablamaları. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HALF = 30;          // arenanın yarım ölçüsü (metr)
  var EYE = 1.6;          // göz hündürlüyü
  var HEIGHT = 1.8;       // oyunçu hündürlüyü
  var RADIUS = 0.4;       // oyunçu dairəsinin radiusu
  var CROUCH_EYE = 1.05;  // əyiləndə göz hündürlüyü
  var CROUCH_HEIGHT = 1.25; // əyiləndə bədən hündürlüyü
  var HELMET_HP = 50;     // kaskın dayanıqlığı
  var ARMOR_HP = 60;      // bədənliyin dayanıqlığı
  var STEP = 0.5;         // pilləkən kimi çıxıla bilən maksimum hündürlük

  var WEAPONS = {
    pistol:  { id: 'pistol',  name: 'Tapança', dmg: 22, rate: 280,  mag: 12, reload: 1300, spread: 0.006,  pellets: 1, range: 80,  auto: false, recoil: 0.022, zoom: 55 },
    rifle:   { id: 'rifle',   name: 'Avtomat', dmg: 14, rate: 95,   mag: 30, reload: 1900, spread: 0.018,  pellets: 1, range: 100, auto: true,  recoil: 0.012, zoom: 50 },
    shotgun: { id: 'shotgun', name: 'Pompalı', dmg: 11, rate: 850,  mag: 6,  reload: 2400, spread: 0.07,   pellets: 8, range: 35,  auto: false, recoil: 0.07,  zoom: 60 },
    sniper:  { id: 'sniper',  name: 'Snayper', dmg: 85, rate: 1300, mag: 5,  reload: 2600, spread: 0.0008, pellets: 1, range: 200, auto: false, recoil: 0.06,  zoom: 18 }
  };
  var WEAPON_ORDER = ['pistol', 'rifle', 'shotgun', 'sniper'];

  var BOXES = [];
  function addBox(cx, cz, w, d, h, wall) {
    BOXES.push({ cx: cx, cz: cz, w: w, d: d, h: h, wall: !!wall,
      x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, y0: 0, y1: h });
  }
  function sym(cx, cz, w, d, h) {
    var xs = cx === 0 ? [0] : [-cx, cx];
    var zs = cz === 0 ? [0] : [-cz, cz];
    for (var i = 0; i < xs.length; i++) for (var j = 0; j < zs.length; j++) addBox(xs[i], zs[j], w, d, h);
  }

  // xarici divarlar
  addBox(0, -(HALF + 1), 2 * HALF + 4, 2, 8, true);
  addBox(0, HALF + 1, 2 * HALF + 4, 2, 8, true);
  addBox(-(HALF + 1), 0, 2, 2 * HALF + 4, 8, true);
  addBox(HALF + 1, 0, 2, 2 * HALF + 4, 8, true);
  // maneələr
  addBox(0, 0, 6, 6, 3);
  sym(12, 12, 4, 4, 2);
  sym(13, 0, 2, 10, 2.5);
  sym(0, 15, 10, 2, 2.5);
  sym(6, 8, 2, 2, 1);
  sym(20, 6, 3, 3, 1);
  sym(8, 22, 3, 3, 1);
  sym(22, 18, 4, 2, 1.2);
  sym(24, 5, 1.5, 1.5, 4);
  sym(18, 12, 1.5, 1.5, 4);

  var SPAWNS = [[-26, -26], [26, -26], [-26, 26], [26, 26], [0, -27], [0, 27], [-27, 0], [27, 0]];

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // Oyunçunu (pos: {x,y,z}, y = ayaq səviyyəsi) maneələrdən kənara itələyir.
  function resolve(pos) {
    for (var it = 0; it < 3; it++) {
      for (var i = 0; i < BOXES.length; i++) {
        var b = BOXES[i];
        if (b.y1 <= pos.y + STEP) continue;
        var cx = clamp(pos.x, b.x0, b.x1), cz = clamp(pos.z, b.z0, b.z1);
        var dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
        if (d2 >= RADIUS * RADIUS) continue;
        if (d2 > 1e-8) {
          var d = Math.sqrt(d2), push = RADIUS - d;
          pos.x += dx / d * push;
          pos.z += dz / d * push;
        } else {
          var l = pos.x - b.x0, r = b.x1 - pos.x, t = pos.z - b.z0, bt = b.z1 - pos.z;
          var m = Math.min(l, r, t, bt);
          if (m === l) pos.x = b.x0 - RADIUS;
          else if (m === r) pos.x = b.x1 + RADIUS;
          else if (m === t) pos.z = b.z0 - RADIUS;
          else pos.z = b.z1 + RADIUS;
        }
      }
    }
    var lim = HALF - RADIUS;
    pos.x = clamp(pos.x, -lim, lim);
    pos.z = clamp(pos.z, -lim, lim);
  }

  // Verilən nöqtənin altındakı ən hündür dayanıla bilən səth.
  function groundAt(x, z, feetY) {
    var g = 0;
    for (var i = 0; i < BOXES.length; i++) {
      var b = BOXES[i];
      if (x + RADIUS > b.x0 && x - RADIUS < b.x1 && z + RADIUS > b.z0 && z - RADIUS < b.z1 &&
          b.y1 <= feetY + STEP && b.y1 > g) g = b.y1;
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
  function castWorld(ox, oy, oz, dx, dy, dz, max) {
    var t = max;
    for (var i = 0; i < BOXES.length; i++) {
      var h = rayBox(ox, oy, oz, dx, dy, dz, BOXES[i]);
      if (h !== null && h < t) t = h;
    }
    if (dy < 0) {
      var tf = -oy / dy;
      if (tf >= 0 && tf < t) t = tf;
    }
    return t;
  }

  return {
    HALF: HALF, EYE: EYE, HEIGHT: HEIGHT, RADIUS: RADIUS, STEP: STEP,
    CROUCH_EYE: CROUCH_EYE, CROUCH_HEIGHT: CROUCH_HEIGHT, HELMET_HP: HELMET_HP, ARMOR_HP: ARMOR_HP,
    WEAPONS: WEAPONS, WEAPON_ORDER: WEAPON_ORDER, BOXES: BOXES, SPAWNS: SPAWNS,
    resolve: resolve, groundAt: groundAt, rayBox: rayBox, rayCyl: rayCyl, castWorld: castWorld, clamp: clamp
  };
});
