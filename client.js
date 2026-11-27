(function () {
  'use strict';
  var S = window.Shared, W = S.WEAPONS, ORDER = S.WEAPON_ORDER;
  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  var clamp = S.clamp;
  var settings = { sound: true, volume: 0.8, shots: true, steps: true, hits: true, autorun: true, sens: 1 };
  (function loadSettings() {
    try {
      var raw = store.get('arena-settings', null);
      if (raw) {
        var sv = JSON.parse(raw);
        for (var k in settings) if (sv && k in sv && typeof sv[k] === typeof settings[k]) settings[k] = sv[k];
      } else {
        var old = parseFloat(store.get('arena-sens', ''));
        if (old) settings.sens = old;
      }
    } catch (e) {}
  })();
  function saveSettings() { store.set('arena-settings', JSON.stringify(settings)); }
  var BASE_FOV = 75;
  var IS_TOUCH = false;
  try { IS_TOUCH = (('ontouchstart' in window) || navigator.maxTouchPoints > 0) && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches; } catch (e) {}
  var MODE_NAMES = { ffa: 'Hamı hamıya qarşı', tdm: 'Komanda döyüşü', coop: 'Birgə: botlara qarşı' };
  var TEAM_NAMES = { red: 'Qırmızı', blue: 'Mavi' };

  if (typeof THREE === 'undefined') {
    $('err').textContent = '3D mühərriki (Three.js) yüklənmədi. İnternet bağlantısını yoxlayın.';
    return;
  }

  /* ======================= Renderer və səhnələr ======================= */
  var canvas = $('c');
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_TOUCH ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false; // iki keçid: dünya, sonra silah
  var maxAniso = 4;
  try { maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy()); } catch (e) {}

  var HORIZON = 0xcfdde8;
  var scene = new THREE.Scene();
  scene.background = new THREE.Color(HORIZON);
  scene.fog = new THREE.Fog(HORIZON, 55, 200);

  var camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.05, 300);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  // silah üçün ayrıca səhnə və kamera: divara girmir, öz işığı var
  var vmScene = new THREE.Scene();
  var vmCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
  vmScene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 0.95));
  var vmSun = new THREE.DirectionalLight(0xfff0d0, 0.8);
  vmSun.position.set(1, 1.2, 1);
  vmScene.add(vmSun);

  /* ---- işıq ---- */
  scene.add(new THREE.HemisphereLight(0xdbeaff, 0x8c7a62, 0.8));
  var SUN_POS = new THREE.Vector3(-25, 40, 15);
  var sun = new THREE.DirectionalLight(0xfff0d6, 0.95);
  sun.position.copy(SUN_POS);
  sun.castShadow = true;
  sun.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);
  sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(sun.target);
  // ağız alovu işığı: daimi, yalnız intensivliyi dəyişir (shader yenidən qurulmasın)
  var flashLight = new THREE.PointLight(0xffc870, 0, 14);
  scene.add(flashLight);
  var flashLightUntil = 0;

  /* ======================= Teksturlar ======================= */
  function rng(seed) { return function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
  function canvasTex(size, draw, noRepeat) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    var t = new THREE.CanvasTexture(c);
    if (!noRepeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    return t;
  }
  function dots(g, s, n, maxA, r, light) {
    for (var i = 0; i < n; i++) {
      g.fillStyle = (light ? 'rgba(255,255,255,' : 'rgba(0,0,0,') + (r() * maxA) + ')';
      g.fillRect(r() * s, r() * s, 1 + r() * 3, 1 + r() * 3);
    }
  }
  function stripes(g, x, y, w, h, step, thick) {
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.fillStyle = '#e8b81c'; g.fillRect(x, y, w, h);
    g.strokeStyle = '#1b1b1b'; g.lineWidth = thick;
    for (var k = -h; k < w + h; k += step) {
      g.beginPath(); g.moveTo(x + k, y + h); g.lineTo(x + k + h, y); g.stroke();
    }
    g.restore();
  }

  var tFloor = canvasTex(512, function (g, s) {
    var r = rng(11);
    for (var ty = 0; ty < 2; ty++) for (var tx = 0; tx < 2; tx++) {
      var l = (r() - 0.5) * 14;
      g.fillStyle = 'rgb(' + ((139 + l) | 0) + ',' + ((143 + l) | 0) + ',' + ((147 + l) | 0) + ')';
      g.fillRect(tx * 256, ty * 256, 256, 256);
    }
    dots(g, s, 2500, 0.10, r, false);
    dots(g, s, 1200, 0.08, r, true);
    for (var i = 0; i < 7; i++) {
      g.fillStyle = 'rgba(40,40,40,0.06)';
      g.beginPath(); g.ellipse(r() * s, r() * s, 20 + r() * 60, 10 + r() * 30, r() * 3, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = 'rgba(30,32,36,.55)'; g.lineWidth = 3;
    g.strokeRect(0, 0, s, s);
    g.beginPath(); g.moveTo(256, 0); g.lineTo(256, s); g.moveTo(0, 256); g.lineTo(s, 256); g.stroke();
  });
  tFloor.repeat.set(8, 8);

  var tGround = canvasTex(256, function (g, s) {
    var r = rng(5);
    g.fillStyle = '#6d7a52'; g.fillRect(0, 0, s, s);
    for (var i = 0; i < 40; i++) {
      g.fillStyle = 'rgba(' + (r() < 0.5 ? '130,140,95' : '90,95,60') + ',' + (0.1 + r() * 0.15) + ')';
      g.beginPath(); g.ellipse(r() * s, r() * s, 10 + r() * 30, 6 + r() * 18, r() * 3, 0, Math.PI * 2); g.fill();
    }
    dots(g, s, 1500, 0.2, r, false);
    dots(g, s, 700, 0.12, r, true);
  });
  tGround.repeat.set(70, 70);

  var tWood = canvasTex(256, function (g, s) {
    var r = rng(21);
    g.fillStyle = '#b88a52'; g.fillRect(0, 0, s, s);
    for (var i = 0; i < 4; i++) {
      var l = (r() - 0.5) * 30;
      g.fillStyle = 'rgb(' + ((184 + l) | 0) + ',' + ((138 + l) | 0) + ',' + ((82 + l) | 0) + ')';
      g.fillRect(i * 64 + 2, 0, 60, s);
      g.strokeStyle = 'rgba(60,35,10,.5)'; g.lineWidth = 2; g.strokeRect(i * 64 + 2, 0, 60, s);
      for (var j = 0; j < 14; j++) {
        g.strokeStyle = 'rgba(80,50,20,' + (0.08 + r() * 0.12) + ')';
        var x = i * 64 + 6 + r() * 52;
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (r() - 0.5) * 6, s); g.stroke();
      }
    }
    g.strokeStyle = '#6d4620'; g.lineWidth = 18; g.strokeRect(9, 9, s - 18, s - 18);
    g.lineWidth = 12; g.beginPath(); g.moveTo(14, 14); g.lineTo(s - 14, s - 14); g.moveTo(s - 14, 14); g.lineTo(14, s - 14); g.stroke();
    g.fillStyle = '#2a2a2a';
    [[16, 16], [s - 16, 16], [16, s - 16], [s - 16, s - 16]].forEach(function (p) { g.beginPath(); g.arc(p[0], p[1], 4, 0, 6.3); g.fill(); });
  });

  var tMil = canvasTex(256, function (g, s) {
    var r = rng(31);
    g.fillStyle = '#55633f'; g.fillRect(0, 0, s, s);
    dots(g, s, 1200, 0.18, r, false);
    g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 4;
    g.strokeRect(6, 6, s - 12, s - 12); g.strokeRect(24, 24, s - 48, s - 48);
    g.fillStyle = '#2b3220';
    [[34, 34], [s - 34, 34], [34, s - 34], [s - 34, s - 34]].forEach(function (p) { g.beginPath(); g.arc(p[0], p[1], 5, 0, 6.3); g.fill(); });
    g.fillStyle = 'rgba(235,230,200,.8)'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('AMMO', s / 2, s / 2 - 8);
    g.font = 'bold 20px sans-serif'; g.fillText('M-24 / 50', s / 2, s / 2 + 28);
    for (var i = 0; i < 8; i++) {
      g.strokeStyle = 'rgba(110,70,30,' + (0.1 + r() * 0.12) + ')'; g.lineWidth = 3;
      var x = 20 + r() * (s - 40); g.beginPath(); g.moveTo(x, 20); g.lineTo(x + (r() - 0.5) * 10, 40 + r() * 120); g.stroke();
    }
  });

  var tBunker = canvasTex(256, function (g, s) {
    var r = rng(41);
    g.fillStyle = '#8e9499'; g.fillRect(0, 0, s, s);
    dots(g, s, 2200, 0.12, r, false);
    dots(g, s, 1000, 0.09, r, true);
    g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 3;
    for (var y = 0; y <= s; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke(); }
    g.beginPath(); g.moveTo(128, 0); g.lineTo(128, s); g.stroke();
    g.fillStyle = 'rgba(0,0,0,.35)';
    for (var yy = 32; yy < s; yy += 64) for (var xx = 32; xx < s; xx += 96) { g.beginPath(); g.arc(xx, yy, 4, 0, 6.3); g.fill(); }
    for (var i = 0; i < 5; i++) { g.fillStyle = 'rgba(30,30,30,.07)'; g.fillRect(r() * s, 0, 8 + r() * 20, s); }
  });

  var tPillar = canvasTex(256, function (g, s) {
    var r = rng(51);
    g.fillStyle = '#8e9499'; g.fillRect(0, 0, s, s);
    dots(g, s, 1800, 0.12, r, false);
    stripes(g, 0, 0, s, 64, 40, 18);
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 64, s, 3);
  });

  function drawContainer(base, seed) {
    return canvasTex(256, function (g, s) {
      var r = rng(seed);
      g.fillStyle = base; g.fillRect(0, 0, s, s);
      for (var x = 0; x < s; x += 16) {
        g.fillStyle = 'rgba(0,0,0,.20)'; g.fillRect(x, 0, 6, s);
        g.fillStyle = 'rgba(255,255,255,.10)'; g.fillRect(x + 8, 0, 4, s);
      }
      g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 0, s, 14); g.fillRect(0, s - 14, s, 14);
      g.fillStyle = 'rgba(235,235,225,.8)'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center';
      g.fillText('EL-' + (1000 + ((seed * 37) % 8000)), s / 2, s / 2);
      for (var i = 0; i < 10; i++) {
        g.strokeStyle = 'rgba(90,50,20,' + (0.08 + r() * 0.14) + ')'; g.lineWidth = 3 + r() * 4;
        var x2 = r() * s; g.beginPath(); g.moveTo(x2, 14); g.lineTo(x2 + (r() - 0.5) * 12, 40 + r() * 160); g.stroke();
      }
      dots(g, s, 900, 0.14, r, false);
    });
  }
  var tCont = [drawContainer('#a8402f', 61), drawContainer('#2f5f8a', 62), drawContainer('#4a7a4a', 63)];

  var tWall = canvasTex(256, function (g, s) {
    var r = rng(71);
    g.fillStyle = '#4b545c'; g.fillRect(0, 0, s, s);
    dots(g, s, 1800, 0.14, r, false);
    dots(g, s, 700, 0.08, r, true);
    g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(128, 0); g.lineTo(128, s); g.moveTo(0, 128); g.lineTo(s, 128); g.stroke();
    g.strokeRect(0, 0, s, s);
    stripes(g, 0, s - 22, s, 22, 26, 10);
  });

  var tWindows = canvasTex(128, function (g, s) {
    var r = rng(81);
    g.fillStyle = '#4f5a66'; g.fillRect(0, 0, s, s);
    for (var y = 0; y < 8; y++) for (var x = 0; x < 8; x++) {
      g.fillStyle = r() < 0.28 ? '#ffe9a8' : '#222b35';
      g.fillRect(x * 16 + 3, y * 16 + 3, 10, 10);
    }
  });

  function lambert(tex) { return new THREE.MeshLambertMaterial({ map: tex }); }
  var matsByKind = {
    crate: lambert(tWood), mil: lambert(tMil), bunker: lambert(tBunker), pillar: lambert(tPillar),
    cont0: lambert(tCont[0]), cont1: lambert(tCont[1]), cont2: lambert(tCont[2]),
    wall: lambert(tWall), city: lambert(tWindows)
  };

  // UV-ləri üzün real ölçüsünə uyğunlaşdırır, tekstura uzanmır
  function scaledBox(w, h, d, tile) {
    var g = new THREE.BoxGeometry(w, h, d);
    var uv = g.attributes.uv;
    var dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (var f = 0; f < 6; f++) {
      for (var v = 0; v < 4; v++) {
        var i = f * 4 + v;
        uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
      }
    }
    uv.needsUpdate = true;
    return g;
  }

  /* ======================= Səma ======================= */
  var skyGroup = new THREE.Group();
  scene.add(skyGroup);
  (function buildSky() {
    var R = 220;
    var geo = new THREE.SphereGeometry(R, 32, 20);
    var pos = geo.attributes.position;
    var cols = new Float32Array(pos.count * 3);
    var cTop = new THREE.Color(0x2f6fb5), cMid = new THREE.Color(0x8fc0e6), cHor = new THREE.Color(HORIZON), cLow = new THREE.Color(0xaab7bf);
    var c = new THREE.Color();
    for (var i = 0; i < pos.count; i++) {
      var y = pos.getY(i) / R;
      if (y < 0) c.copy(cHor).lerp(cLow, Math.min(1, -y * 2));
      else if (y < 0.25) c.copy(cHor).lerp(cMid, y / 0.25);
      else c.copy(cMid).lerp(cTop, Math.min(1, (y - 0.25) / 0.75));
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    var dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    dome.renderOrder = -10;
    skyGroup.add(dome);
  })();
  function softTex(inner, outer) {
    return canvasTex(128, function (g, s) {
      var gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, inner); gr.addColorStop(1, outer);
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    }, true);
  }
  var sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softTex('rgba(255,246,220,1)', 'rgba(255,220,150,0)'), blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false, fog: false
  }));
  sunSprite.scale.set(110, 110, 1);
  sunSprite.position.copy(SUN_POS).normalize().multiplyScalar(200);
  skyGroup.add(sunSprite);

  var cloudGroup = new THREE.Group();
  skyGroup.add(cloudGroup);
  (function buildClouds() {
    var tex = canvasTex(128, function (g, s) {
      var r = rng(91);
      for (var i = 0; i < 14; i++) {
        var x = 30 + r() * 68, y = 50 + r() * 28, rad = 14 + r() * 20;
        var gr = g.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, s, s);
      }
    }, true);
    var r = rng(92);
    for (var i = 0; i < 12; i++) {
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.9, depthWrite: false, fog: false }));
      var a = r() * Math.PI * 2, rad = 150 + r() * 40, y = 35 + r() * 55;
      sp.position.set(Math.cos(a) * rad, y, Math.sin(a) * rad);
      var sc = 60 + r() * 60;
      sp.scale.set(sc * 1.8, sc * 0.7, 1);
      cloudGroup.add(sp);
    }
  })();

  /* ======================= Dünya (xəritəyə görə qurulur) ======================= */
  var world = null, curMapId = '';
  var FOG = { arena: [55, 200], island: [70, 300] };
  var railMat = new THREE.MeshLambertMaterial({ color: 0x2c3138 });
  var marksTex = null;

  // eyni materialı paylaşan çoxlu qutunu bir mesh-ə birləşdirir (daha az çəkiliş çağırışı)
  function Merger(mat) { this.mat = mat; this.p = []; this.n = []; this.u = []; this.i = []; }
  Merger.prototype.add = function (geo, x, y, z) {
    geo.translate(x, y, z);
    var base = this.p.length / 3;
    var pa = geo.attributes.position.array, na = geo.attributes.normal.array, ua = geo.attributes.uv.array, ia = geo.index.array, k;
    for (k = 0; k < pa.length; k++) this.p.push(pa[k]);
    for (k = 0; k < na.length; k++) this.n.push(na[k]);
    for (k = 0; k < ua.length; k++) this.u.push(ua[k]);
    for (k = 0; k < ia.length; k++) this.i.push(ia[k] + base);
    geo.dispose();
  };
  Merger.prototype.mesh = function (cast, recv) {
    if (!this.p.length) return null;
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setIndex(this.i);
    var m = new THREE.Mesh(g, this.mat);
    m.castShadow = cast; m.receiveShadow = recv;
    return m;
  };

  function wallBox(b, i, kind) {
    var hh = b.y1 - b.y0;
    var m = new THREE.Mesh(scaledBox(b.w, hh, b.d, b.wall ? 4 : 2), matsByKind[kind]);
    m.position.set(b.cx, b.y0 + hh / 2, b.cz);
    m.castShadow = !b.wall; m.receiveShadow = true;
    world.add(m);
    if (b.wall) {
      var rail = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.4, 0.35, b.d + 0.4), railMat);
      rail.position.set(b.cx, b.h + 0.17, b.cz);
      world.add(rail);
    } else if (kind === 'bunker') {
      var roof = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.3, 0.2, b.d + 0.3), railMat);
      roof.position.set(b.cx, b.h + 0.1, b.cz);
      roof.castShadow = true;
      world.add(roof);
    }
  }

  function kindOf(b, i) {
    if (b.wall) return 'wall';
    if (b.h === 2.5) return 'cont' + (i % 3);
    if (b.h === 4) return 'pillar';
    if (b.h === 3) return 'bunker';
    if (b.h === 2) return 'mil';
    return 'crate';
  }

  function makeMarksTex(map) {
    var size = map.half * 2 + 4, K = 1024 / size, hs = size / 2;
    function X(v) { return (v + hs) * K; }
    return canvasTex(1024, function (g, s) {
      g.lineWidth = 6; g.strokeStyle = 'rgba(240,236,220,.55)';
      g.beginPath(); g.arc(X(0), X(0), map.half * 0.33 * K, 0, Math.PI * 2); g.stroke();
      g.setLineDash([24, 18]); g.lineWidth = 4; g.strokeStyle = 'rgba(240,236,220,.35)';
      var e = map.half - 1;
      g.beginPath(); g.moveTo(X(-e), X(0)); g.lineTo(X(e), X(0)); g.moveTo(X(0), X(-e)); g.lineTo(X(0), X(e)); g.stroke();
      g.setLineDash([]);
      g.save();
      g.beginPath(); g.rect(X(-5.4), X(-5.4), 10.8 * K, 10.8 * K); g.rect(X(-4.4), X(-4.4), 8.8 * K, 8.8 * K);
      g.clip('evenodd');
      stripes(g, X(-5.4), X(-5.4), 10.8 * K, 10.8 * K, 36, 14);
      g.restore();
      g.strokeStyle = 'rgba(255,183,3,.85)'; g.lineWidth = 5;
      map.spawns.forEach(function (p) {
        var cx = X(p[0]), cz = X(p[1]), h = 2.2 * K, L = 0.9 * K;
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (c) {
          var px = cx + c[0] * h, pz = cz + c[1] * h;
          g.beginPath(); g.moveTo(px - c[0] * L, pz); g.lineTo(px, pz); g.lineTo(px, pz - c[1] * L); g.stroke();
        });
      });
    }, true);
  }

  function buildArena(map) {
    var size = map.half * 2 + 4;
    var outer = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshLambertMaterial({ map: tGround }));
    outer.rotation.x = -Math.PI / 2; outer.position.y = -0.06; outer.receiveShadow = true;
    world.add(outer);
    tFloor.repeat.set(size / 8, size / 8);
    var slab = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ map: tFloor }));
    slab.rotation.x = -Math.PI / 2; slab.receiveShadow = true;
    world.add(slab);
    if (marksTex) marksTex.dispose();
    marksTex = makeMarksTex(map);
    var marks = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({
      map: marksTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    }));
    marks.rotation.x = -Math.PI / 2; marks.position.y = 0.01; marks.receiveShadow = true;
    world.add(marks);
    map.boxes.forEach(function (b, i) { wallBox(b, i, kindOf(b, i)); });

    // projektor qüllələri
    var pole = new THREE.MeshLambertMaterial({ color: 0x3a4047 });
    var lamp = new THREE.MeshBasicMaterial({ color: 0xfff2c4 });
    var tp = map.half + 7;
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (c) {
      var x = c[0] * tp, z = c[1] * tp;
      var p = new THREE.Mesh(new THREE.BoxGeometry(0.7, 16, 0.7), pole);
      p.position.set(x, 8, z); world.add(p);
      var head = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 1.4), pole);
      head.position.set(x, 16.4, z); head.rotation.y = Math.atan2(x, z); world.add(head);
      var l = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 0.2), lamp);
      l.position.set(x - c[0] * 0.15, 16.4, z - c[1] * 0.8); l.rotation.y = Math.atan2(x, z); world.add(l);
    });

    // uzaq şəhər və dağlar
    var r = rng(101), n = 46;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.12;
      var rad = 100 + r() * 26;
      var w = 8 + r() * 9, d = 8 + r() * 9, h = 14 + r() * 40;
      var m = new THREE.Mesh(scaledBox(w, h, d, 6), matsByKind.city);
      m.position.set(Math.cos(a) * rad, h / 2 - 0.06, Math.sin(a) * rad);
      m.rotation.y = r() * 3;
      world.add(m);
    }
    mountains(rng(102), 20, 150, 30, 40);
  }

  function mountains(r, count, baseRad, minR, minH) {
    var mtn = new THREE.MeshLambertMaterial({ color: 0x7e8fa1 });
    for (var j = 0; j < count; j++) {
      var a2 = (j / count) * Math.PI * 2 + (r() - 0.5) * 0.2;
      var rad2 = baseRad + r() * 30;
      var rr = minR + r() * 25, hh = minH + r() * 40;
      var c = new THREE.Mesh(new THREE.ConeGeometry(rr, hh, 6), mtn);
      c.position.set(Math.cos(a2) * rad2, hh / 2 - 0.06, Math.sin(a2) * rad2);
      c.rotation.y = r() * 3;
      world.add(c);
    }
  }

  var islandT = null;
  function islandTex() {
    if (islandT) return islandT;
    function wallTex(base, kind, seed) {
      return canvasTex(256, function (g, s) {
        var r = rng(seed);
        g.fillStyle = base; g.fillRect(0, 0, s, s);
        if (kind === 'brick') {
          g.strokeStyle = 'rgba(40,20,10,.5)'; g.lineWidth = 3;
          for (var y = 0; y < s; y += 32) {
            g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke();
            for (var x = (y / 32) % 2 ? 0 : 32; x < s; x += 64) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 32); g.stroke(); }
          }
        } else if (kind === 'siding') {
          g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 3;
          for (var y2 = 0; y2 < s; y2 += 28) { g.beginPath(); g.moveTo(0, y2); g.lineTo(s, y2); g.stroke(); }
        }
        dots(g, s, 1500, 0.12, r, false);
        dots(g, s, 600, 0.08, r, true);
        g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, s - 14, s, 14);
      });
    }
    function roofTex(base, seed) {
      return canvasTex(256, function (g, s) {
        var r = rng(seed);
        g.fillStyle = base; g.fillRect(0, 0, s, s);
        g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 3;
        for (var y = 0; y < s; y += 24) {
          g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke();
          for (var x = (y / 24) % 2 ? 0 : 16; x < s; x += 32) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 24); g.stroke(); }
        }
        dots(g, s, 1400, 0.16, r, false);
      });
    }
    var T = {};
    T.plaster = [lambert(wallTex('#d9cfae', 'plaster', 301)), lambert(wallTex('#a8573f', 'brick', 302)), lambert(wallTex('#8497a8', 'siding', 303))];
    T.roof = [lambert(roofTex('#8a3b2e', 311)), lambert(roofTex('#4d4f57', 312)), lambert(roofTex('#6e4c2f', 313))];
    T.rock = lambert(canvasTex(256, function (g, s) {
      var r = rng(321);
      g.fillStyle = '#7d7b74'; g.fillRect(0, 0, s, s);
      for (var i = 0; i < 40; i++) {
        g.fillStyle = 'rgba(' + (r() < 0.5 ? '255,255,255' : '0,0,0') + ',' + (0.05 + r() * 0.1) + ')';
        g.beginPath(); g.ellipse(r() * s, r() * s, 10 + r() * 40, 8 + r() * 25, r() * 3, 0, 6.3); g.fill();
      }
      dots(g, s, 2000, 0.2, r, false);
    }));
    T.bark = lambert(canvasTex(128, function (g, s) {
      var r = rng(331);
      g.fillStyle = '#5b4231'; g.fillRect(0, 0, s, s);
      for (var i = 0; i < 24; i++) { g.fillStyle = 'rgba(0,0,0,' + (0.1 + r() * 0.2) + ')'; g.fillRect(r() * s, 0, 2 + r() * 4, s); }
    }));
    T.dirt = lambert(canvasTex(256, function (g, s) {
      var r = rng(341);
      g.fillStyle = '#8d7650'; g.fillRect(0, 0, s, s);
      dots(g, s, 2500, 0.2, r, false); dots(g, s, 1200, 0.12, r, true);
    }));
    T.grass = canvasTex(256, function (g, s) {
      var r = rng(351);
      g.fillStyle = '#5f7f3d'; g.fillRect(0, 0, s, s);
      for (var i = 0; i < 50; i++) {
        g.fillStyle = 'rgba(' + (r() < 0.5 ? '120,150,70' : '55,85,35') + ',' + (0.12 + r() * 0.16) + ')';
        g.beginPath(); g.ellipse(r() * s, r() * s, 10 + r() * 30, 6 + r() * 18, r() * 3, 0, 6.3); g.fill();
      }
      for (var j = 0; j < 900; j++) {
        g.strokeStyle = 'rgba(' + (r() < 0.5 ? '170,200,100' : '40,70,30') + ',' + (0.2 + r() * 0.3) + ')'; g.lineWidth = 1;
        var x = r() * s, y = r() * s; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 4, y - 3 - r() * 5); g.stroke();
      }
    });
    T.leaf = [0x2f5d2a, 0x3b6b2c, 0x264f26].map(function (c) { return new THREE.MeshLambertMaterial({ color: c }); });
    islandT = T;
    return T;
  }

  function buildIsland(map) {
    var T = islandTex();
    T.grass.repeat.set(150, 150);
    var gnd = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshLambertMaterial({ map: T.grass }));
    gnd.rotation.x = -Math.PI / 2; gnd.receiveShadow = true;
    world.add(gnd);

    // eyni materialı paylaşan qutular 110 m-lik hissələrə birləşdirilir (görünməyən hissələr çəkilmir)
    var CH = {};
    function mg(key, mat, x, z, cast, recv) {
      var k = key + '@' + Math.floor(x / 110) + ',' + Math.floor(z / 110);
      var o = CH[k];
      if (!o) { o = CH[k] = new Merger(mat); o.cast = cast; o.recv = recv; }
      return o;
    }
    map.boxes.forEach(function (b, i) {
      var hh = b.y1 - b.y0, cy = (b.y0 + b.y1) / 2;
      if (b.wall) { wallBox(b, i, 'wall'); return; }
      if (b.kind === 'hwall') mg('hw' + b.c, T.plaster[b.c], b.cx, b.cz, true, true).add(scaledBox(b.w, hh, b.d, 3), b.cx, cy, b.cz);
      else if (b.kind === 'roof') mg('rf' + b.c, T.roof[b.c], b.cx, b.cz, true, true).add(scaledBox(b.w, hh, b.d, 3), b.cx, cy, b.cz);
      else if (b.kind === 'crate') mg('cr', matsByKind.crate, b.cx, b.cz, true, true).add(scaledBox(b.w, hh, b.d, 2), b.cx, cy, b.cz);
      else if (b.kind === 'rock') mg('rk', T.rock, b.cx, b.cz, true, true).add(scaledBox(b.w, hh, b.d, 3), b.cx, cy, b.cz);
      else if (b.kind === 'tree') {
        var s = 0.85 + b.c * 0.15;
        mg('bk', T.bark, b.cx, b.cz, true, false).add(new THREE.BoxGeometry(0.5, 3.2, 0.5), b.cx, 1.6, b.cz);
        var L = mg('lf' + b.c, T.leaf[b.c], b.cx, b.cz, true, false);
        L.add(new THREE.ConeGeometry(2.1 * s, 2.8 * s, 7), b.cx, 3.6 * s, b.cz);
        L.add(new THREE.ConeGeometry(1.6 * s, 2.4 * s, 7), b.cx, 4.9 * s, b.cz);
        L.add(new THREE.ConeGeometry(1.05 * s, 2.2 * s, 7), b.cx, 6.1 * s, b.cz);
      }
    });
    map.houses.forEach(function (h) {
      mg('fl', matsByKind.crate, h.cx, h.cz, false, true).add(scaledBox(h.w, 0.06, h.d, 2), h.cx, 0.03, h.cz);
      mg('pd', T.dirt, h.cx, h.cz, false, true).add(scaledBox(h.w + 4, 0.03, h.d + 4, 4), h.cx, 0.015, h.cz);
    });
    Object.keys(CH).forEach(function (k) {
      var o = CH[k], m = o.mesh(o.cast, o.recv);
      if (m) world.add(m);
    });
  }

  function buildWorld(id) {
    if (world) {
      scene.remove(world);
      world.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
    }
    var map = S.setMap(id);
    curMapId = id;
    world = new THREE.Group();
    scene.add(world);
    scene.fog.near = FOG[id] ? FOG[id][0] : 55;
    scene.fog.far = FOG[id] ? FOG[id][1] : 200;
    camera.far = id === 'island' ? 520 : 300;
    camera.updateProjectionMatrix();
    document.body.classList.toggle('lootmap', !!map.loot);
    if (id === 'island') buildIsland(map); else buildArena(map);
  }
  buildWorld('arena');

  /* ======================= Vəziyyət ======================= */
  var ws = null, joined = false, mode = 'ffa', myTeam = null, roomCode = '';
  var roster = new Map();
  var meta = { s: 'play', r: 0, b: 0, wv: 0, bots: 0 };
  var sens = settings.sens;
  var keys = {};
  var boardHeld = false, ended = false;
  var tc = { move: { x: 0, y: 0 }, jump: false, crouch: false, sprint: false };
  var auto = { fwdT: 0, on: false, blockT: 0 };
  var editMode = false;
  var me = {
    id: 0, alive: false, hp: 100, helmet: 0, armor: 0, hl: 0, al: 0, gr: 0, sm: 0, sc: false, su: false, lastThrow: -1e9, x: 0, y: 0, z: 0, vx: 0, vz: 0, vy: 0, yaw: 0, pitch: 0,
    onGround: true, seq: 0, wi: 1, own: ORDER.map(function () { return true; }), ammo: [], reloading: false, reloadStart: 0, reloadEnd: 0,
    lastFire: 0, switchEnd: 0, fireHeld: false, fireFresh: false, ads: false, kick: 0, shake: 0, deadT: 0,
    eye: S.EYE, crouch: false, sprint: false, stepAcc: 0
  };
  var RIFLE = ORDER.indexOf('rifle');
  function anyOwn() { return me.own.some(function (v) { return v; }); }
  function applyInv(m) {
    if (m.own) me.own = m.own;
    me.hl = m.hl | 0; me.helmet = m.hm || 0; me.al = m.al | 0; me.armor = m.am || 0;
    me.gr = m.gr | 0; me.sm = m.sm | 0; me.sc = !!m.sc; me.su = !!m.su;
    if (m.hp != null) me.hp = m.hp;
  }
  function refill() { me.ammo = ORDER.map(function (id) { return W[id].mag; }); me.reloading = false; }
  refill();

  /* ======================= Səs ======================= */
  var actx = null, noiseBuf = null, master = null;
  function dest(a) {
    if (!master) { master = a.createGain(); master.connect(a.destination); }
    master.gain.value = settings.sound ? settings.volume : 0;
    return master;
  }
  function applyAudio() { if (master) master.gain.value = settings.sound ? settings.volume : 0; }
  function audio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }
  function noise(a) {
    if (!noiseBuf) {
      noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }
  var SHOT_SND = {
    pistol: { f: 2400, d: 0.16, low: 140 }, rifle: { f: 1900, d: 0.14, low: 110 },
    shotgun: { f: 1200, d: 0.38, low: 70 }, sniper: { f: 1500, d: 0.6, low: 55 },
    deagle: { f: 1800, d: 0.28, low: 90 }, uzi: { f: 2600, d: 0.1, low: 150 }, akm: { f: 1500, d: 0.17, low: 95 },
    dmr: { f: 1400, d: 0.3, low: 75 }, lmg: { f: 1300, d: 0.16, low: 85 }, awm: { f: 1300, d: 0.8, low: 48 },
    boom: { f: 700, d: 1.0, low: 42 }
  };
  function shotSound(wid, vol) {
    if (!settings.sound || !settings.shots) return;
    var a = audio(); if (!a || vol < 0.01) return;
    var c = SHOT_SND[wid] || SHOT_SND.rifle, t = a.currentTime;
    var n = a.createBufferSource(); n.buffer = noise(a); n.playbackRate.value = 0.8 + Math.random() * 0.4;
    var lp = a.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(c.f, t); lp.frequency.exponentialRampToValueAtTime(200, t + c.d);
    var g = a.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + c.d);
    n.connect(lp); lp.connect(g); g.connect(dest(a));
    n.start(t, Math.random() * 0.5); n.stop(t + c.d + 0.05);
    var o = a.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(c.low * 2, t); o.frequency.exponentialRampToValueAtTime(c.low * 0.5, t + c.d);
    var og = a.createGain(); og.gain.setValueAtTime(vol * 0.8, t); og.gain.exponentialRampToValueAtTime(0.001, t + c.d);
    o.connect(og); og.connect(dest(a)); o.start(t); o.stop(t + c.d + 0.05);
  }
  function tone(freq, dur, vol, type) {
    if (!settings.sound || !settings.hits) return;
    var a = audio(); if (!a) return;
    var t = a.currentTime, o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(dest(a)); o.start(t); o.stop(t + dur + 0.02);
  }
  function stepSound(vol) {
    if (!settings.sound || !settings.steps) return;
    var a = audio(); if (!a) return;
    var t = a.currentTime;
    var n = a.createBufferSource(); n.buffer = noise(a);
    var lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500 + Math.random() * 300;
    var g = a.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    n.connect(lp); lp.connect(g); g.connect(dest(a));
    n.start(t, Math.random() * 0.6); n.stop(t + 0.09);
  }
  function clickSound() { tone(900, 0.04, 0.12, 'square'); }

  /* ======================= Silah modelləri (birinci şəxs) ======================= */
  var VM = {
    metal: new THREE.MeshLambertMaterial({ color: 0x30343a }),
    dark: new THREE.MeshLambertMaterial({ color: 0x1c1e22 }),
    poly: new THREE.MeshLambertMaterial({ color: 0x26282c }),
    steel: new THREE.MeshLambertMaterial({ color: 0x70767e }),
    wood: new THREE.MeshLambertMaterial({ color: 0x7a5230 }),
    skin: new THREE.MeshLambertMaterial({ color: 0xd9a97f }),
    sleeve: new THREE.MeshLambertMaterial({ color: 0x3f4636 }),
    glass: new THREE.MeshBasicMaterial({ color: 0x5ab0ff }),
    flash: new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  };
  var geoCache = {};
  function boxGeo(w, h, d) { var k = w + ',' + h + ',' + d; return geoCache[k] || (geoCache[k] = new THREE.BoxGeometry(w, h, d)); }
  function part(grp, w, h, d, x, y, z, mat, rx) {
    var m = new THREE.Mesh(boxGeo(w, h, d), mat);
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    grp.add(m);
    return m;
  }
  function cyl(grp, r, len, x, y, z, mat) {
    var k = 'c' + r + ',' + len;
    var geo = geoCache[k] || (geoCache[k] = new THREE.CylinderGeometry(r, r, len, 12));
    var m = new THREE.Mesh(geo, mat);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, y, z);
    grp.add(m);
    return m;
  }
  // əl və qol: qol kameradan kənara doğru uzanır
  function hand(grp, x, y, z, sx, big) {
    part(grp, big ? 0.085 : 0.075, 0.085, 0.11, x, y, z, VM.skin);
    var dx = sx * 0.3, dy = -0.5, dz = 1, l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var s = part(grp, 0.095, 0.095, 0.55, x + dx / l * 0.3, y + dy / l * 0.3, z + dz / l * 0.3 + 0.04, VM.sleeve);
    s.rotation.order = 'YXZ';
    s.rotation.y = Math.atan2(dx, dz);
    s.rotation.x = -Math.asin(dy / l);
  }
  var VMOD = {
    pistol: { m: 'pistol', s: [1, 1, 1] }, deagle: { m: 'pistol', s: [1.2, 1.25, 1.2] },
    uzi: { m: 'rifle', s: [0.9, 0.9, 0.62] }, rifle: { m: 'rifle', s: [1, 1, 1] }, akm: { m: 'rifle', s: [1.05, 1.05, 1.08] },
    dmr: { m: 'rifle', s: [1, 1, 1.25] }, lmg: { m: 'rifle', s: [1.25, 1.3, 1.1] }, shotgun: { m: 'shotgun', s: [1, 1, 1] },
    sniper: { m: 'sniper', s: [1, 1, 1] }, awm: { m: 'sniper', s: [1.15, 1.15, 1.2] }
  };
  function buildVM(id) {
    var g = new THREE.Group(), mz;
    var spec = VMOD[id] || VMOD.rifle, model = spec.m;
    if (model === 'pistol') {
      part(g, 0.058, 0.065, 0.3, 0, 0.03, -0.1, VM.metal);
      part(g, 0.05, 0.04, 0.26, 0, -0.015, -0.08, VM.dark);
      cyl(g, 0.014, 0.05, 0, 0.03, -0.26, VM.steel);
      part(g, 0.05, 0.13, 0.07, 0, -0.095, 0.03, VM.poly, 0.2);
      part(g, 0.012, 0.04, 0.07, 0, -0.045, -0.03, VM.dark);
      part(g, 0.012, 0.018, 0.02, 0, 0.07, -0.23, VM.dark);
      part(g, 0.03, 0.018, 0.02, 0, 0.07, 0.04, VM.dark);
      hand(g, 0.0, -0.09, 0.04, 1);
      hand(g, -0.05, -0.085, 0.045, -1);
      mz = -0.3;
    } else if (model === 'rifle') {
      part(g, 0.07, 0.095, 0.34, 0, 0, -0.02, VM.metal);
      part(g, 0.075, 0.08, 0.3, 0, -0.005, -0.33, VM.poly);
      part(g, 0.03, 0.015, 0.34, 0, 0.052, -0.2, VM.dark);
      cyl(g, 0.013, 0.3, 0, 0.012, -0.6, VM.steel);
      cyl(g, 0.02, 0.07, 0, 0.012, -0.73, VM.dark);
      part(g, 0.01, 0.04, 0.012, 0, 0.05, -0.62, VM.dark);
      part(g, 0.02, 0.03, 0.02, 0, 0.065, 0.07, VM.dark);
      part(g, 0.045, 0.15, 0.08, 0, -0.12, -0.04, VM.dark, -0.15);
      part(g, 0.05, 0.11, 0.06, 0, -0.1, 0.1, VM.poly, 0.3);
      part(g, 0.06, 0.11, 0.26, 0, -0.02, 0.3, VM.poly);
      hand(g, 0.0, -0.11, 0.1, 1);
      hand(g, 0.0, -0.07, -0.34, -1, true);
      mz = -0.78;
    } else if (model === 'shotgun') {
      cyl(g, 0.02, 0.72, 0, 0.025, -0.3, VM.dark);
      cyl(g, 0.017, 0.5, 0, -0.012, -0.25, VM.steel);
      part(g, 0.075, 0.065, 0.2, 0, -0.025, -0.27, VM.wood);
      part(g, 0.07, 0.1, 0.3, 0, -0.005, 0.08, VM.metal);
      part(g, 0.01, 0.025, 0.02, 0, 0.06, -0.6, VM.dark);
      part(g, 0.06, 0.1, 0.27, 0, -0.04, 0.36, VM.wood);
      part(g, 0.045, 0.1, 0.06, 0, -0.1, 0.12, VM.poly, 0.3);
      hand(g, 0.0, -0.1, 0.12, 1);
      hand(g, 0.0, -0.06, -0.27, -1, true);
      mz = -0.68;
    } else {
      part(g, 0.06, 0.08, 0.6, 0, 0, -0.1, VM.metal);
      cyl(g, 0.014, 0.5, 0, 0.012, -0.65, VM.steel);
      cyl(g, 0.026, 0.3, 0, 0.09, -0.1, VM.dark);
      cyl(g, 0.03, 0.03, 0, 0.09, -0.26, VM.dark);
      cyl(g, 0.022, 0.012, 0, 0.09, -0.275, VM.glass);
      part(g, 0.02, 0.04, 0.03, 0, 0.055, -0.1, VM.dark);
      part(g, 0.06, 0.11, 0.3, 0, -0.03, 0.36, VM.poly);
      part(g, 0.04, 0.12, 0.07, 0, -0.1, 0.12, VM.dark, 0.25);
      part(g, 0.045, 0.1, 0.07, 0, -0.08, -0.05, VM.dark, -0.1);
      hand(g, 0.0, -0.11, 0.12, 1);
      hand(g, 0.0, -0.06, -0.22, -1, true);
      mz = -0.92;
    }
    var flash = new THREE.Group();
    var f1 = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), VM.flash);
    var f2 = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), VM.flash);
    f2.rotation.z = Math.PI / 4;
    var f3 = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), VM.flash);
    f3.rotation.y = Math.PI / 2;
    flash.add(f1); flash.add(f2); flash.add(f3);
    flash.position.set(0, 0.02, mz - 0.06);
    flash.visible = false;
    g.add(flash);
    var muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.02, mz);
    g.add(muzzle);
    g.scale.set(spec.s[0], spec.s[1], spec.s[2]);
    g.visible = false;
    return { g: g, flash: flash, muzzle: muzzle };
  }
  var vmRoot = new THREE.Group();
  vmScene.add(vmRoot);
  var vms = ORDER.map(function (id) { var v = buildVM(id); vmRoot.add(v.g); return v; });
  var flashUntil = 0;

  /* ======================= Digər oyunçular (əsgər modeli) ======================= */
  var remotes = new Map();
  var AV = {
    leg: new THREE.BoxGeometry(0.24, 0.66, 0.28),
    boot: new THREE.BoxGeometry(0.26, 0.14, 0.36),
    vest: new THREE.BoxGeometry(0.62, 0.5, 0.38),
    shirt: new THREE.BoxGeometry(0.54, 0.62, 0.3),
    belt: new THREE.BoxGeometry(0.58, 0.1, 0.34),
    head: new THREE.BoxGeometry(0.26, 0.28, 0.26),
    helmet: new THREE.SphereGeometry(0.19, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    visor: new THREE.BoxGeometry(0.28, 0.08, 0.06),
    arm: new THREE.BoxGeometry(0.13, 0.13, 0.5),
    hand: new THREE.BoxGeometry(0.1, 0.1, 0.1),
    gunBody: new THREE.BoxGeometry(0.07, 0.1, 0.55),
    gunBarrel: new THREE.BoxGeometry(0.03, 0.03, 0.4)
  };
  var AVM = {
    pants: new THREE.MeshLambertMaterial({ color: 0x3d4a35 }),
    boots: new THREE.MeshLambertMaterial({ color: 0x1b1b1d }),
    shirt: new THREE.MeshLambertMaterial({ color: 0x3a4033 }),
    gear: new THREE.MeshLambertMaterial({ color: 0x24262a }),
    skin: new THREE.MeshLambertMaterial({ color: 0xe0b894 }),
    skinBot: new THREE.MeshLambertMaterial({ color: 0x4a1c1c }),
    helmet: new THREE.MeshLambertMaterial({ color: 0x3b4632 }),
    helmetBot: new THREE.MeshLambertMaterial({ color: 0x2a2a2e }),
    visor: new THREE.MeshBasicMaterial({ color: 0x0a0e12 }),
    visorBot: new THREE.MeshBasicMaterial({ color: 0xff2a2a })
  };
  function hueColor(id) { return new THREE.Color().setHSL((id * 0.137) % 1, 0.65, 0.5); }
  function entityColor(id, bot) {
    if (bot) return new THREE.Color(0x7a1f1f);
    if (mode === 'tdm') {
      var r = roster.get(id), t = r && r.team;
      return new THREE.Color(t === 'red' ? 0xd9434a : t === 'blue' ? 0x3f7be0 : 0x888888);
    }
    return hueColor(id);
  }
  function nameOf(id) {
    var r = roster.get(id);
    if (r) return r.name;
    return id >= 1000 ? 'Bot' : '?';
  }
  function makeTag(text, color) {
    var c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    var g = c.getContext('2d');
    g.font = '700 34px Rajdhani, Segoe UI, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.75)'; g.strokeText(text, 128, 34);
    g.fillStyle = color; g.fillText(text, 128, 34);
    var tex = new THREE.CanvasTexture(c);
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(1.6, 0.4, 1);
    sp.position.y = 2.3;
    return sp;
  }
  function makeRemote(id, bot) {
    var g = new THREE.Group();
    var bodyMat = new THREE.MeshLambertMaterial({ color: entityColor(id, bot) });
    var cast = !bot;
    function add(geo, mat, x, y, z, parent) {
      var m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); m.castShadow = cast;
      (parent || g).add(m);
      return m;
    }
    // ayaqlar (omba nöqtəsindən yellənir)
    var legL = new THREE.Group(), legR = new THREE.Group();
    legL.position.set(-0.17, 0.78, 0); legR.position.set(0.17, 0.78, 0);
    add(AV.leg, AVM.pants, 0, -0.33, 0, legL);
    add(AV.leg, AVM.pants, 0, -0.33, 0, legR);
    if (!bot) { add(AV.boot, AVM.boots, 0, -0.7, -0.04, legL); add(AV.boot, AVM.boots, 0, -0.7, -0.04, legR); }
    g.add(legL); g.add(legR);
    // gövdə
    add(AV.vest, bodyMat, 0, 1.13, 0);
    if (!bot) { add(AV.shirt, AVM.shirt, 0, 1.07, 0); add(AV.belt, AVM.gear, 0, 0.82, 0); }
    // baş və qollar (yuxarı-aşağı baxışla birgə fırlanır)
    var aim = new THREE.Group();
    aim.position.set(0, 1.4, 0);
    add(AV.head, bot ? AVM.skinBot : AVM.skin, 0, 0.2, 0, aim);
    var helmet = add(AV.helmet, bot ? AVM.helmetBot : AVM.helmet, 0, 0.3, 0, aim);
    helmet.scale.set(1.15, 1, 1.2);
    add(AV.visor, bot ? AVM.visorBot : AVM.visor, 0, 0.22, -0.13, aim);
    add(AV.arm, AVM.shirt, 0.2, -0.12, -0.25, aim);
    var lArm = add(AV.arm, AVM.shirt, -0.17, -0.15, -0.3, aim);
    lArm.rotation.y = -0.2;
    if (!bot) { add(AV.hand, AVM.skin, 0.2, -0.12, -0.52, aim); add(AV.hand, AVM.skin, -0.2, -0.15, -0.55, aim); }
    var gun = new THREE.Group();
    gun.position.set(0.12, -0.14, -0.42);
    add(AV.gunBody, AVM.gear, 0, 0, 0, gun);
    add(AV.gunBarrel, AVM.gear, 0, 0.01, -0.42, gun);
    aim.add(gun);
    g.add(aim);
    scene.add(g);
    var r = {
      id: id, bot: bot, group: g, bodyMat: bodyMat, aim: aim, legL: legL, legR: legR, gun: gun, helmet: helmet,
      tag: null, tagKey: '', buf: [], alive: true, diedAt: 0, dyingUntil: 0, seen: 0, walkT: 0, lx: 0, lz: 0, hp: 100,
      crouch: false, cr: 0, hm: 50, wi: RIFLE
    };
    refreshLook(r);
    return r;
  }
  function refreshLook(r) {
    r.bodyMat.color.copy(entityColor(r.id, r.bot));
    var name = r.bot ? 'Bot' : nameOf(r.id);
    var col = '#ffffff';
    if (mode === 'tdm' && !r.bot) { var ro = roster.get(r.id); col = ro && ro.team === 'red' ? '#ff8d92' : '#8db5ff'; }
    var key = name + col;
    if (key === r.tagKey) return;
    if (r.tag) { r.group.remove(r.tag); r.tag.material.map.dispose(); r.tag.material.dispose(); }
    r.tag = makeTag(name, col);
    r.group.add(r.tag);
    r.tagKey = key;
  }
  function removeRemote(r) {
    scene.remove(r.group);
    if (r.tag) { r.tag.material.map.dispose(); r.tag.material.dispose(); }
    r.bodyMat.dispose();
    remotes.delete(r.id);
  }
  function angDiff(a, b) {
    var d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  function updateRemote(r, rt, dt, now) {
    var b = r.buf;
    if (!b.length) return;
    var i = 0;
    while (i < b.length && b[i].t < rt) i++;
    var a, c, f = 0;
    if (i === 0) { a = c = b[0]; }
    else if (i >= b.length) { a = c = b[b.length - 1]; }
    else { a = b[i - 1]; c = b[i]; f = (rt - a.t) / Math.max(1, c.t - a.t); }
    while (b.length > 2 && b[1].t < rt) b.shift();
    var x = a.x + (c.x - a.x) * f, y = a.y + (c.y - a.y) * f, z = a.z + (c.z - a.z) * f;
    var speed = Math.hypot(x - r.lx, z - r.lz) / Math.max(dt, 0.001);
    r.lx = x; r.lz = z;
    r.group.position.set(x, y, z);
    r.group.rotation.y = a.yaw + angDiff(a.yaw, c.yaw) * f;
    r.aim.rotation.x = a.pitch + (c.pitch - a.pitch) * f;
    r.walkT += speed * dt * 1.6;
    var amp = Math.min(0.9, speed * 0.15);
    r.legL.rotation.x = Math.sin(r.walkT) * amp;
    r.legR.rotation.x = -Math.sin(r.walkT) * amp;
    // əyilmə: gövdə alçalır
    r.cr += ((r.crouch ? 1 : 0) - r.cr) * Math.min(1, dt * 10);
    r.group.scale.y = 1 - r.cr * 0.3;
    r.gun.scale.z = (W[ORDER[r.wi]] || { len: 1 }).len;
    r.gun.visible = r.armed !== false;
    r.helmet.visible = r.bot || r.hm > 0;
    if (r.tag) r.tag.scale.set(1.6, 0.4 / r.group.scale.y, 1);
    if (!r.alive) {
      var p = clamp((now - r.diedAt) / 350, 0, 1);
      r.group.rotation.x = p * Math.PI / 2;
      if (r.tag) r.tag.visible = false;
      r.group.visible = now - r.diedAt < 1600;
    } else {
      r.group.rotation.x = 0;
      r.group.visible = !r.inCar;
      if (r.tag) r.tag.visible = !r.inCar;
    }
  }

  /* ======================= Effektlər ======================= */
  var fx = [];
  var gSpark = new THREE.SphereGeometry(0.09, 6, 5);
  var gTracer = new THREE.BoxGeometry(1, 1, 1);
  var mTracer = new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9 });
  var mSpark = new THREE.MeshBasicMaterial({ color: 0xffb347 });
  var puffTex = softTex('rgba(210,200,185,.9)', 'rgba(210,200,185,0)');
  function tracer(a, b, now) {
    var d = a.distanceTo(b);
    if (d < 0.5 || fx.length > 220) return;
    var m = new THREE.Mesh(gTracer, mTracer);
    m.position.copy(a).lerp(b, 0.5);
    m.lookAt(b);
    m.scale.set(0.03, 0.03, d);
    scene.add(m);
    fx.push({ m: m, t0: now, life: 110, kind: 'tracer', s0: 0.03, len: d });
  }
  function spark(p, now, size) {
    if (fx.length > 220) return;
    var m = new THREE.Mesh(gSpark, mSpark);
    m.position.copy(p);
    m.scale.setScalar(size || 1);
    scene.add(m);
    fx.push({ m: m, t0: now, life: 140, kind: 'spark', s0: size || 1 });
  }
  function puff(p, now) {
    if (fx.length > 160) return;
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, opacity: 0.7, depthWrite: false }));
    sp.position.copy(p);
    sp.scale.set(0.3, 0.3, 1);
    scene.add(sp);
    fx.push({ m: sp, t0: now, life: 420, kind: 'puff', y0: p.y });
  }
  function updateFx(now) {
    for (var i = fx.length - 1; i >= 0; i--) {
      var e = fx[i], p = (now - e.t0) / e.life;
      if (p >= 1) {
        scene.remove(e.m);
        if (e.kind === 'puff') e.m.material.dispose();
        fx.splice(i, 1);
        continue;
      }
      if (e.kind === 'tracer') e.m.scale.set(e.s0 * (1 - p), e.s0 * (1 - p), e.len);
      else if (e.kind === 'puff') {
        var sc = 0.3 + p * 1.1;
        e.m.scale.set(sc, sc, 1);
        e.m.material.opacity = 0.7 * (1 - p);
        e.m.position.y = e.y0 + p * 0.5;
      } else e.m.scale.setScalar(e.s0 * (1 - p));
    }
    flashLight.intensity = now < flashLightUntil ? 2.4 : 0;
  }

  /* ======================= HUD ======================= */
  var cache = {};
  function setText(id, v) {
    if (cache[id] === v) return;
    cache[id] = v;
    $(id).textContent = v;
  }
  function setHTML(id, v) {
    if (cache['h' + id] === v) return;
    cache['h' + id] = v;
    $(id).innerHTML = v;
  }
  var feedEl = $('feed');
  function addFeed(text, cls) {
    var d = document.createElement('div');
    d.textContent = text;
    if (cls) d.className = cls;
    feedEl.appendChild(d);
    while (feedEl.children.length > 7) feedEl.removeChild(feedEl.firstChild);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 7000);
  }
  var msgTimer = 0;
  function showMsg(main, small, ms) {
    var el = $('msg');
    el.textContent = main;
    if (small) { var s = document.createElement('small'); s.textContent = small; el.appendChild(s); }
    clearTimeout(msgTimer);
    if (ms) msgTimer = setTimeout(function () { el.textContent = ''; }, ms);
  }
  function clearMsg() { clearTimeout(msgTimer); $('msg').textContent = ''; }

  var slotsEl = $('slots');
  ORDER.forEach(function (id, i) {
    var s = document.createElement('span');
    s.textContent = String((i + 1) % 10);
    s.title = W[id].name;
    slotsEl.appendChild(s);
  });

  function updateHUD() {
    var w = W[ORDER[me.wi]];
    var armed = !!me.own[me.wi];
    var isLoot = !!(S.map && S.map.loot), nOwn = me.own.filter(Boolean).length;
    setText('wname', armed ? w.name + (isLoot ? '  ·  ' + nOwn + '/' + S.MAX_SLOTS + '  ·  Q: at' : '') : 'SİLAHSIZ');
    var ammo = me.ammo[me.wi];
    setHTML('ammo', !armed ? '<small>Evlərdən silah tap</small>' : me.reloading ? 'DOLDURULUR' : ammo + '<small> / ' + w.mag + '</small>');
    $('ammo').classList.toggle('low', armed && !me.reloading && ammo <= Math.ceil(w.mag * 0.25));
    for (var i = 0; i < slotsEl.children.length; i++) {
      slotsEl.children[i].classList.toggle('on', armed && i === me.wi);
      slotsEl.children[i].classList.toggle('off', !me.own[i]);
    }
    var hp = Math.max(0, Math.round(me.hp));
    setHTML('hpnum', hp + '<small>CAN</small>');
    var fill = $('hpfill');
    fill.style.width = hp + '%';
    fill.style.background = hp > 60 ? 'var(--green)' : hp > 30 ? 'var(--amber)' : 'var(--red)';
    var hm = Math.max(0, Math.round(me.helmet));
    setText('helmtxt', hm > 0 ? 'KASK ' + me.hl + ' · ' + hm : 'KASK YOXDUR');
    $('helmfill').style.width = (hm / (S.HELMETS[me.hl || 1].hp) * 100) + '%';
    $('helmbar').classList.toggle('gone', hm <= 0);
    var am = Math.max(0, Math.round(me.armor));
    setText('armtxt', am > 0 ? 'BƏDƏNLİK ' + me.al + ' · ' + am : 'BƏDƏNLİK YOXDUR');
    $('armfill').style.width = (am / (S.ARMORS[me.al || 1].hp) * 100) + '%';
    $('armbar').classList.toggle('gone', am <= 0);
    var inv = [];
    inv.push((IS_TOUCH ? '' : 'G ') + 'Qumbara ' + me.gr);
    inv.push((IS_TOUCH ? '' : 'H ') + 'Tüstü ' + me.sm);
    if (me.sc) inv.push('Durbin');
    if (me.su) inv.push('Susdurucu');
    setText('inv', inv.join(' · '));
    if (IS_TOUCH) $('ta').classList.toggle('active', me.ads);
    setText('stance', !me.alive ? '' : me.crouch ? 'ƏYİLİB' : me.sprint ? (auto.on ? 'QAÇIR (AVTO)' : 'QAÇIR') : '');
  }

  function updateScoreline() {
    if (mode === 'tdm') {
      setHTML('scoreline', '<span class="r">QIRMIZI ' + (meta.r | 0) + '</span> &nbsp;·&nbsp; <span class="b">' + (meta.b | 0) + ' MAVİ</span>');
      setText('subline', 'Komandan: ' + (TEAM_NAMES[myTeam] || '') + ' · hədəf 30');
    } else if (mode === 'coop') {
      setText('scoreline', 'DALĞA ' + meta.wv);
      setText('subline', meta.bots > 0 ? 'Qalan botlar: ' + meta.bots : 'Növbəti dalğa gəlir');
    } else {
      var best = null;
      roster.forEach(function (r) { if (!best || r.k > best.k) best = r; });
      setText('scoreline', best ? best.name + '  ' + best.k : '');
      var mine = roster.get(me.id);
      setText('subline', 'Sənin öldürmələrin: ' + (mine ? mine.k : 0) + ' · hədəf 20');
    }
  }

  function updateInfo() {
    setText('rcode', 'OTAQ ' + roomCode);
    setText('rmode', (MODE_NAMES[mode] || '') + ' · ' + (S.map ? S.map.name : '') + ' · dəvət üçün klik');
    setText('rcount', roster.size + ' oyunçu');
  }

  function renderBoard() {
    var rows = $('rows');
    while (rows.firstChild) rows.removeChild(rows.firstChild);
    var list = [];
    roster.forEach(function (r) { list.push(r); });
    list.sort(function (a, b) { return b.k - a.k || a.d - b.d; });
    $('boardtitle').textContent = (MODE_NAMES[mode] || '') + ' · otaq ' + roomCode;
    list.forEach(function (r) {
      var tr = document.createElement('tr');
      if (r.id === me.id) tr.className = 'me';
      var td = document.createElement('td');
      var dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = '#' + entityColor(r.id, false).getHexString();
      td.appendChild(dot);
      td.appendChild(document.createTextNode(r.name));
      var tt = document.createElement('td');
      tt.textContent = mode === 'tdm' ? (TEAM_NAMES[r.team] || '') : '';
      var tk = document.createElement('td'); tk.textContent = r.k;
      var tdd = document.createElement('td'); tdd.textContent = r.d;
      tr.appendChild(td); tr.appendChild(tt); tr.appendChild(tk); tr.appendChild(tdd);
      rows.appendChild(tr);
    });
  }
  function updateBoardVisibility() {
    var show = boardHeld || ended;
    $('board').hidden = !show;
    if (show) renderBoard();
  }

  var vigTimer = 0, hitTimer = 0;
  function flashVig() {
    var v = $('vig');
    v.classList.add('on');
    clearTimeout(vigTimer);
    vigTimer = setTimeout(function () { v.classList.remove('on'); }, 120);
  }
  function showDir(ax, az) {
    var dx = ax - me.x, dz = az - me.z;
    var fx_ = -Math.sin(me.yaw), fz_ = -Math.cos(me.yaw);
    var rx = Math.cos(me.yaw), rz = -Math.sin(me.yaw);
    var ang = Math.atan2(rx * dx + rz * dz, fx_ * dx + fz_ * dz);
    var d = $('dir');
    d.style.transform = 'rotate(' + ang + 'rad)';
    d.classList.add('on');
    clearTimeout(d._t);
    d._t = setTimeout(function () { d.classList.remove('on'); }, 150);
  }
  function hitMarker(head, kill, helm) {
    var h = $('hitm');
    h.className = 'on' + (kill ? ' kill' : helm ? ' helm' : head ? ' head' : '');
    clearTimeout(hitTimer);
    hitTimer = setTimeout(function () { h.className = ''; }, 140);
  }


  /* ======================= Loot (yerdəki əşyalar) ======================= */
  var LOOT_COL = {
    pistol: 0xc9ced4, deagle: 0xe8d27a, uzi: 0xd0a060, rifle: 0x8fb35a, akm: 0xc58b4a, dmr: 0x66b8d8, lmg: 0xd96a5a,
    shotgun: 0xe0a255, sniper: 0x4fc3bd, awm: 0xc07cf0, helmet1: 0xa4c85a, helmet2: 0x4f9fe8, helmet3: 0xe8a23a,
    armor1: 0xa4c85a, armor2: 0x4f9fe8, armor3: 0xe8a23a, medkit: 0xff5a5a, bandage: 0xffd0d0, grenade: 0x7fbf5a,
    smoke: 0xcfd6dc, scope: 0x5ad0ff, supp: 0xb0b0ff
  };
  var LOOT_LABEL = { medkit: 'Tibbi çanta', bandage: 'Bandaj', grenade: 'Qumbara', smoke: 'Tüstü qumbarası', scope: 'Durbin', supp: 'Susdurucu' };
  function lootName(ty) {
    if (W[ty]) return W[ty].name;
    var m = /^(helmet|armor)([123])$/.exec(ty);
    if (m) return (m[1] === 'helmet' ? 'Kask' : 'Bədənlik') + ' ' + m[2] + '-ci səviyyə';
    return LOOT_LABEL[ty] || ty;
  }
  var lootGroup = new THREE.Group();
  scene.add(lootGroup);
  var lootItems = new Map();
  var LG = {
    disc: new THREE.CircleGeometry(0.6, 20),
    beam: new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6, 1, true),
    body: new THREE.BoxGeometry(0.1, 0.16, 0.7),
    barrel: new THREE.BoxGeometry(0.04, 0.04, 0.5),
    grip: new THREE.BoxGeometry(0.08, 0.2, 0.1),
    vest: new THREE.BoxGeometry(0.5, 0.56, 0.2),
    strap: new THREE.BoxGeometry(0.1, 0.58, 0.22),
    kit: new THREE.BoxGeometry(0.46, 0.3, 0.3),
    crossA: new THREE.BoxGeometry(0.28, 0.07, 0.31),
    crossB: new THREE.BoxGeometry(0.07, 0.28, 0.31),
    ball: new THREE.SphereGeometry(0.13, 10, 8),
    can: new THREE.CylinderGeometry(0.1, 0.1, 0.34, 10),
    tube: new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8),
    lens: new THREE.CylinderGeometry(0.075, 0.075, 0.3, 10),
    roll: new THREE.CylinderGeometry(0.1, 0.1, 0.18, 10)
  };
  var LM = {};
  function lootMat(c) {
    if (!LM[c]) LM[c] = new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.4 });
    return LM[c];
  }
  var lootDark = new THREE.MeshLambertMaterial({ color: 0x2a2d31, emissive: 0x15171a });
  var lootGlow = {};
  function glowMat(c, o) {
    var k = c + '_' + o;
    if (!lootGlow[k]) lootGlow[k] = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    return lootGlow[k];
  }
  function makeLoot(ty, x, z) {
    var col = LOOT_COL[ty] || 0xffffff;
    var g = new THREE.Group();
    var item = new THREE.Group();
    var wi = ORDER.indexOf(ty);
    function part(geo, mat, px, py, pz) { var m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); item.add(m); return m; }
    var lv = 0, base = ty;
    var mm = /^(helmet|armor)([123])$/.exec(ty);
    if (mm) { base = mm[1]; lv = +mm[2]; }
    if (wi >= 0) {
      var len = W[ty].len;
      var body = part(LG.body, lootMat(col), 0, 0, 0); body.scale.z = len;
      part(LG.barrel, lootDark, 0, 0.02, -0.45 * len).scale.z = len;
      part(LG.grip, lootDark, 0, -0.14, 0.18 * len);
    } else if (base === 'helmet') {
      var hm = part(AV.helmet, lootMat(col), 0, -0.05, 0); hm.scale.set(1.9, 1.9, 1.9);
      for (var k = 0; k < lv; k++) part(LG.crossA, lootDark, 0, 0.18 + k * 0.04, 0).scale.set(0.35, 0.3, 0.8);
    } else if (base === 'armor') {
      part(LG.vest, lootMat(col), 0, 0, 0);
      part(LG.strap, lootDark, -0.17, 0, 0); part(LG.strap, lootDark, 0.17, 0, 0);
      for (var k2 = 0; k2 < lv; k2++) part(LG.crossA, lootDark, 0, 0.32 + k2 * 0.06, 0).scale.set(0.5, 0.4, 0.7);
    } else if (ty === 'medkit') {
      part(LG.kit, lootMat(0xf4f4f4), 0, 0, 0);
      part(LG.crossA, lootMat(0xff3b3b), 0, 0, 0); part(LG.crossB, lootMat(0xff3b3b), 0, 0, 0);
    } else if (ty === 'bandage') {
      part(LG.roll, lootMat(0xf4f4f4), 0, 0, 0).rotation.x = Math.PI / 2;
      part(LG.roll, lootMat(0xff3b3b), 0, 0, 0).scale.set(1.02, 0.35, 1.02);
    } else if (ty === 'grenade') {
      part(LG.ball, lootMat(0x4b5a36), 0, 0, 0);
      part(LG.grip, lootDark, 0, 0.14, 0).scale.set(0.5, 0.35, 0.8);
    } else if (ty === 'smoke') {
      part(LG.can, lootMat(0xb9c0c6), 0, 0, 0);
      part(LG.grip, lootDark, 0, 0.2, 0).scale.set(0.5, 0.3, 0.8);
    } else if (ty === 'scope') {
      part(LG.lens, lootDark, 0, 0, 0).rotation.x = Math.PI / 2;
      part(LG.lens, lootMat(0x5ad0ff), 0, 0, -0.16).scale.set(0.8, 0.05, 0.8);
    } else if (ty === 'supp') {
      part(LG.tube, lootDark, 0, 0, 0).rotation.x = Math.PI / 2;
      part(LG.tube, lootMat(0x8080c0), 0, 0, 0.1).scale.set(1.2, 0.15, 1.2);
    }
    item.scale.set(1.3, 1.3, 1.3);
    g.add(item);
    var disc = new THREE.Mesh(LG.disc, glowMat(col, 0.35));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.06;
    g.add(disc);
    var beam = new THREE.Mesh(LG.beam, glowMat(col, 0.18));
    beam.position.y = 1.2;
    g.add(beam);
    g.position.set(x, 0, z);
    lootGroup.add(g);
    return { g: g, item: item, ty: ty, ph: Math.random() * 6 };
  }
  var lootData = new Map(), LOOT_VIS = 85, lootStreamT = 0;
  function lootNear(x, z, r) {
    var cx = joined ? me.x : 0, cz = joined ? me.z : 0;
    return (x - cx) * (x - cx) + (z - cz) * (z - cz) < r * r;
  }
  function removeLootMesh(id) {
    var it = lootItems.get(id);
    if (it) { lootGroup.remove(it.g); lootItems.delete(id); }
  }
  function addLoot(id, ty, x, z) {
    lootData.set(id, { ty: ty, x: x, z: z });
    removeLootMesh(id);
    if (lootNear(x, z, LOOT_VIS)) lootItems.set(id, makeLoot(ty, x, z));
  }
  function removeLoot(id) { lootData.delete(id); removeLootMesh(id); }
  function clearLoot() { lootItems.forEach(function (it) { lootGroup.remove(it.g); }); lootItems.clear(); lootData.clear(); }
  function streamLoot(now) {
    if (now - lootStreamT < 350) return;
    lootStreamT = now;
    lootData.forEach(function (d, id) {
      var vis = lootItems.has(id), near = lootNear(d.x, d.z, vis ? LOOT_VIS + 15 : LOOT_VIS);
      if (near && !vis) lootItems.set(id, makeLoot(d.ty, d.x, d.z));
      else if (!near && vis) removeLootMesh(id);
    });
  }
  function updateLoot(now, dt) {
    streamLoot(now);
    var t = now / 1000;
    lootItems.forEach(function (it) {
      it.item.rotation.y += dt * 1.6;
      it.item.position.y = 0.95 + Math.sin(t * 2.2 + it.ph) * 0.08;
    });
  }


  /* ======================= Qumbaralar, partlayış, tüstü ======================= */
  var nadeMeshes = new Map();
  var gNade = new THREE.SphereGeometry(0.1, 8, 6);
  var mFrag = new THREE.MeshLambertMaterial({ color: 0x4b5a36 });
  var mSmokeG = new THREE.MeshLambertMaterial({ color: 0xb9c0c6 });
  function syncNades(list) {
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var n = list[i], id = n[0];
      seen[id] = true;
      var o = nadeMeshes.get(id);
      if (!o) {
        var m = new THREE.Mesh(gNade, n[1] === 0 ? mFrag : mSmokeG);
        m.position.set(n[2], n[3], n[4]);
        m.castShadow = true;
        scene.add(m);
        o = { m: m, x: n[2], y: n[3], z: n[4] };
        nadeMeshes.set(id, o);
      }
      o.x = n[2]; o.y = n[3]; o.z = n[4];
    }
    nadeMeshes.forEach(function (o, id) {
      if (!seen[id]) { scene.remove(o.m); nadeMeshes.delete(id); }
    });
  }
  function updateNadeMeshes() {
    nadeMeshes.forEach(function (o) {
      o.m.position.x += (o.x - o.m.position.x) * 0.45;
      o.m.position.y += (o.y - o.m.position.y) * 0.45;
      o.m.position.z += (o.z - o.m.position.z) * 0.45;
    });
  }

  var booms = [], smokes = [];
  var gBoom = new THREE.SphereGeometry(1, 14, 10);
  var smokeTex = softTex('rgba(205,210,214,1)', 'rgba(205,210,214,0)');
  function throwNade(kind) {
    if (!joined || !me.alive || car.id || !locked() || chatting()) return;
    if (kind === 'frag' ? me.gr <= 0 : me.sm <= 0) return;
    var now = performance.now();
    if (now - me.lastThrow < 900) return;
    me.lastThrow = now;
    var cp = Math.cos(me.pitch);
    send({ t: 'throw', k: kind, dx: -Math.sin(me.yaw) * cp, dy: Math.sin(me.pitch), dz: -Math.cos(me.yaw) * cp });
    tone(260, 0.14, 0.15, 'sine');
  }
  function addBoom(p, now) {
    var mat = new THREE.MeshBasicMaterial({ color: 0xffa640, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    var m = new THREE.Mesh(gBoom, mat);
    m.position.set(p[0], p[1] + 0.4, p[2]);
    scene.add(m);
    booms.push({ m: m, mat: mat, t0: now });
    flashLight.position.set(p[0], p[1] + 1.2, p[2]);
    flashLightUntil = now + 160;
    for (var i = 0; i < 5; i++) puff(new THREE.Vector3(p[0] + (Math.random() - 0.5) * 3, p[1] + 0.3 + Math.random() * 1.5, p[2] + (Math.random() - 0.5) * 3), now);
    var d = Math.hypot(p[0] - me.x, p[2] - me.z);
    shotSound('boom', clamp(1 - d / 110, 0, 1) * 0.9);
    if (d < 14 && me.alive) me.shake = Math.max(me.shake, 0.5 * (1 - d / 14));
  }
  function addSmoke(p, ms, now) {
    var mat = new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0.93, depthWrite: false });
    var sprites = [];
    for (var i = 0; i < 16; i++) {
      var sp = new THREE.Sprite(mat);
      sp.position.set(p[0] + (Math.random() - 0.5) * 3.6, p[1] + 0.6 + Math.random() * 2.6, p[2] + (Math.random() - 0.5) * 3.6);
      sp.scale.set(0.5, 0.5, 1);
      scene.add(sp);
      sprites.push({ sp: sp, size: 4 + Math.random() * 3 });
    }
    smokes.push({ mat: mat, sprites: sprites, t0: now, ms: ms });
    shotSound('pistol', 0.12);
  }
  function updateEffects2(now) {
    for (var i = booms.length - 1; i >= 0; i--) {
      var b = booms[i], p = (now - b.t0) / 450;
      if (p >= 1) { scene.remove(b.m); b.mat.dispose(); booms.splice(i, 1); continue; }
      var sc = 1 + p * 6.5;
      b.m.scale.set(sc, sc, sc);
      b.mat.opacity = 0.9 * (1 - p);
    }
    for (var j = smokes.length - 1; j >= 0; j--) {
      var sm = smokes[j], age = now - sm.t0;
      if (age >= sm.ms) {
        sm.sprites.forEach(function (o) { scene.remove(o.sp); });
        sm.mat.dispose(); smokes.splice(j, 1); continue;
      }
      var grow = Math.min(1, age / 1800);
      sm.sprites.forEach(function (o) { var k = o.size * (0.2 + 0.8 * grow); o.sp.scale.set(k, k, 1); });
      sm.mat.opacity = 0.93 * Math.min(1, (sm.ms - age) / 3500);
    }
  }


  /* ======================= Maşın ======================= */
  var cars = new Map();
  var car = { id: 0, x: 0, z: 0, yaw: 0, sp: 0, camYaw: 0, hit: 0 };
  var nearCarId = 0, engine = null;
  var carMats = {
    body: new THREE.MeshLambertMaterial({ color: 0xc0392b }),
    glass: new THREE.MeshLambertMaterial({ color: 0x24384c }),
    dark: new THREE.MeshLambertMaterial({ color: 0x1b1d20 }),
    head: new THREE.MeshBasicMaterial({ color: 0xfff1b0 }),
    tail: new THREE.MeshBasicMaterial({ color: 0xff3030 })
  };
  var carGeo = {
    body: new THREE.BoxGeometry(1.9, 0.55, 4.2), cabin: new THREE.BoxGeometry(1.6, 0.55, 2.1),
    bump: new THREE.BoxGeometry(1.95, 0.25, 0.2), wheel: new THREE.CylinderGeometry(0.38, 0.38, 0.3, 14),
    lamp: new THREE.BoxGeometry(0.4, 0.15, 0.06)
  };
  function makeCarMesh() {
    var g = new THREE.Group();
    function add(geo, mat, x, y, z, rz) {
      var m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (rz) m.rotation.z = rz;
      m.castShadow = true;
      g.add(m);
      return m;
    }
    add(carGeo.body, carMats.body, 0, 0.65, 0);
    add(carGeo.cabin, carMats.glass, 0, 1.2, 0.35);
    add(carGeo.bump, carMats.dark, 0, 0.45, -2.1);
    add(carGeo.bump, carMats.dark, 0, 0.45, 2.1);
    [[-1, -1.35], [1, -1.35], [-1, 1.35], [1, 1.35]].forEach(function (w) { add(carGeo.wheel, carMats.dark, w[0] * 0.98, 0.38, w[1], Math.PI / 2); });
    add(carGeo.lamp, carMats.head, -0.6, 0.72, -2.12); add(carGeo.lamp, carMats.head, 0.6, 0.72, -2.12);
    add(carGeo.lamp, carMats.tail, -0.6, 0.72, 2.12); add(carGeo.lamp, carMats.tail, 0.6, 0.72, 2.12);
    return g;
  }
  function clearCars() { cars.forEach(function (o) { scene.remove(o.m); }); cars.clear(); car.id = 0; }
  function syncCars(list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i], o = cars.get(c[0]);
      if (!o) {
        o = { m: makeCarMesh(), x: c[1], z: c[2], yaw: c[3], tx: c[1], tz: c[2], tyaw: c[3], sp: 0, driver: 0 };
        o.m.position.set(o.x, 0, o.z); o.m.rotation.y = o.yaw;
        scene.add(o.m);
        cars.set(c[0], o);
      }
      o.tx = c[1]; o.tz = c[2]; o.tyaw = c[3]; o.sp = c[4]; o.driver = c[5];
    }
  }
  function updateCars(dt) {
    cars.forEach(function (o, id) {
      if (id === car.id) { o.x = car.x; o.z = car.z; o.yaw = car.yaw; }
      else {
        var k = Math.min(1, dt * 9);
        o.x += (o.tx - o.x) * k; o.z += (o.tz - o.z) * k;
        o.yaw += angDiff(o.yaw, o.tyaw) * k;
      }
      o.m.position.set(o.x, 0, o.z);
      o.m.rotation.y = o.yaw;
    });
    // yaxındakı boş maşın
    nearCarId = 0;
    if (joined && me.alive && !car.id) {
      var best = 4.2 * 4.2;
      cars.forEach(function (o, id) {
        if (o.driver) return;
        var d = (o.x - me.x) * (o.x - me.x) + (o.z - me.z) * (o.z - me.z);
        if (d < best) { best = d; nearCarId = id; }
      });
    }
    var showTip = !!(nearCarId || car.id);
    document.body.classList.toggle('cartip', showTip && joined && me.alive);
    setText('hint', !joined || !me.alive ? '' : car.id ? (IS_TOUCH ? '' : 'E: maşından düş') : nearCarId ? (IS_TOUCH ? '' : 'E: maşına min') : '');
    setText('te', car.id ? 'DÜŞ' : 'MİN');
    setText('spd', car.id ? Math.round(Math.abs(car.sp) * 3.6) + ' km/s' : '');
  }
  function interact() {
    if (!joined || !me.alive || !locked() || chatting()) return;
    if (car.id) send({ t: 'exit' });
    else if (nearCarId) send({ t: 'enter', car: nearCarId });
  }
  function driveCar(dt) {
    var active = joined && me.alive && locked() && !chatting();
    var thr = 0, steer = 0, brake = false;
    if (active) {
      if (keys.KeyW) thr++; if (keys.KeyS) thr--; if (keys.KeyD) steer++; if (keys.KeyA) steer--;
      if (keys.Space) brake = true;
      if (IS_TOUCH && Math.hypot(tc.move.x, tc.move.y) > 0.15) { steer += tc.move.x; thr -= tc.move.y; }
    }
    thr = clamp(thr, -1, 1); steer = clamp(steer, -1, 1);
    var sp = car.sp;
    if (thr > 0) sp += thr * 14 * Math.max(0.12, 1 - sp / 34) * dt;
    else if (thr < 0) { if (sp > 0.5) sp -= 28 * dt; else sp = Math.max(-9, sp - 8 * dt); }
    else sp -= Math.sign(sp) * Math.min(Math.abs(sp), 5 * dt);
    if (brake) sp *= Math.max(0, 1 - 3 * dt);
    var turn = steer * 1.9 * clamp(Math.abs(sp) / 6, 0, 1) / (1 + Math.abs(sp) / 22);
    car.yaw -= turn * (sp >= 0 ? 1 : -1) * dt;
    var fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw);
    car.x += fx * sp * dt; car.z += fz * sp * dt;
    // toqquşma: ön və arxa iki dairə
    var p1 = { x: car.x + fx * 1.2, y: 0, z: car.z + fz * 1.2 }, p2 = { x: car.x - fx * 1.2, y: 0, z: car.z - fz * 1.2 };
    var a1 = p1.x, b1 = p1.z, a2 = p2.x, b2 = p2.z;
    S.resolve(p1, undefined, 1.0); S.resolve(p2, undefined, 1.0);
    var sx = ((p1.x - a1) + (p2.x - a2)) / 2, sz = ((p1.z - b1) + (p2.z - b2)) / 2;
    if (Math.hypot(sx, sz) > 0.01) {
      car.x += sx; car.z += sz;
      if (Math.abs(sp) > 4) { me.shake = Math.max(me.shake, 0.25); tone(90, 0.15, 0.25, 'square'); }
      sp *= 0.6;
    }
    car.sp = sp;
    me.x = car.x; me.z = car.z; me.y = 0; me.vx = me.vz = 0;
    me.sprint = false;
  }
  function chaseCam(dt) {
    car.camYaw += angDiff(car.camYaw, car.yaw) * Math.min(1, dt * 4);
    var fx = -Math.sin(car.camYaw), fz = -Math.cos(car.camYaw);
    camera.position.set(car.x - fx * 7.2, 3.4, car.z - fz * 7.2);
    camera.lookAt(car.x + fx * 3, 1.3, car.z + fz * 3);
  }
  function engineUpdate() {
    var on = !!car.id && me.alive;
    if (!on && !engine) return;
    var a = audio();
    if (!a) return;
    if (on && !engine) {
      var o = a.createOscillator(), g = a.createGain();
      o.type = 'sawtooth'; o.frequency.value = 50; g.gain.value = 0;
      o.connect(g); g.connect(dest(a)); o.start();
      engine = { o: o, g: g };
    }
    if (engine) {
      engine.g.gain.value = on && settings.sound && settings.steps ? 0.035 + Math.min(1, Math.abs(car.sp) / 34) * 0.04 : 0;
      engine.o.frequency.value = 45 + Math.abs(car.sp) * 5.5;
    }
  }

  /* ======================= Şəbəkə ======================= */
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

  var handlers = {
    welcome: function (m) {
      if (m.map && m.map !== curMapId) buildWorld(m.map);
      clearLoot();
      clearCars();
      (m.loot || []).forEach(function (l) { addLoot(l[0], l[1], l[2], l[3]); });
      joined = true;
      me.id = m.id; mode = m.mode; myTeam = m.team; roomCode = m.room;
      $('lobby').hidden = true;
      $('hud').hidden = false;
      document.body.classList.add('ingame');
      if (IS_TOUCH) { $('tc').hidden = false; applyLayout(); }
      document.body.classList.remove('ads', 'scoped');
      updateInfo();
      if (m.pick) openLoadout();
      updatePause();
      $('invlink').textContent = location.origin + '/?room=' + roomCode;
      try { history.replaceState(null, '', '?room=' + roomCode); } catch (e) {}
    },
    error: function (m) {
      $('err').textContent = m.text || 'Xəta';
      $('go').disabled = false;
      try { document.exitPointerLock(); } catch (e) {}
    },
    spawn: function (m) {
      me.x = m.x; me.y = m.y; me.z = m.z; me.yaw = m.yaw; me.pitch = 0;
      me.vx = me.vz = me.vy = 0; me.onGround = true;
      me.seq = m.seq; me.hp = 100; me.alive = true;
      applyInv(m);
      closeLoadout();
      me.crouch = false; me.eye = S.EYE;
      tc.crouch = false; tc.sprint = false;
      auto.on = false; auto.fwdT = 0; auto.blockT = 0;
      if (IS_TOUCH) { $('tcr').classList.remove('active'); $('ts').classList.remove('active'); }
      refill();
      me.wi = me.own[RIFLE] ? RIFLE : Math.max(0, me.own.indexOf(true));
      me.switchEnd = 0;
      clearMsg();
      if (!ended) $('board').hidden = !boardHeld;
    },
    roster: function (m) {
      roster.clear();
      m.list.forEach(function (r) { roster.set(r.id, r); });
      remotes.forEach(refreshLook);
      updateInfo();
      updateScoreline();
      if (!$('board').hidden) renderBoard();
    },
    snap: function (m) {
      var now = performance.now();
      meta = m.m;
      var seen = {};
      for (var i = 0; i < m.p.length; i++) {
        var e = m.p[i], id = e[0];
        if (id === me.id) {
          if (e[8] & 1) { me.hp = e[6]; if (e[9] != null) me.helmet = e[9]; if (e[10] != null) me.armor = e[10]; }
          continue;
        }
        var bot = !!(e[8] & 2), alive = !!(e[8] & 1);
        seen[id] = true;
        var r = remotes.get(id);
        if (!r) { r = makeRemote(id, bot); remotes.set(id, r); }
        r.seen = now;
        if (r.alive && !alive) r.diedAt = now;
        if (!r.alive && alive) r.diedAt = 0;
        r.alive = alive; r.hp = e[6];
        r.crouch = !!(e[8] & 4);
        r.wi = e[7] | 0;
        r.armed = !(e[8] & 8);
        r.inCar = !!(e[8] & 16);
        if (e[9] != null) r.hm = e[9];
        r.buf.push({ t: now, x: e[1], y: e[2], z: e[3], yaw: e[4], pitch: e[5] });
        if (r.buf.length > 12) r.buf.shift();
      }
      remotes.forEach(function (r) {
        if (!seen[r.id] && now > r.dyingUntil) removeRemote(r);
      });
      syncNades(m.g || []);
      if (m.c) syncCars(m.c);
      updateScoreline();
    },
    shot: function (m) {
      var now = performance.now();
      var o = new THREE.Vector3(m.o[0], m.o[1], m.o[2]);
      var start = o.clone();
      var wid = ORDER[m.w] || 'rifle';
      if (m.id === me.id) {
        vms[me.wi].muzzle.getWorldPosition(start);
        camera.localToWorld(start);
      } else {
        var r = remotes.get(m.id);
        if (r) {
          start.set(r.group.position.x - Math.sin(r.group.rotation.y) * 0.6, r.group.position.y + 1.3,
            r.group.position.z - Math.cos(r.group.rotation.y) * 0.6);
        }
        var dist = o.distanceTo(camera.position);
        shotSound(wid, clamp(1 - dist / (m.s ? 25 : 70), 0, 1) * (m.s ? 0.2 : 0.5));
        if (!m.s) spark(start, now, 1.4);
      }
      if (!m.s && !(m.id === me.id && me.su)) { flashLight.position.copy(start); flashLightUntil = now + 55; }
      for (var i = 0; i < m.e.length; i++) {
        var end = new THREE.Vector3(m.e[i][0], m.e[i][1], m.e[i][2]);
        tracer(start, end, now);
        spark(end, now, 0.8);
        if (end.y < 3.5 && Math.abs(end.x) < 32 && Math.abs(end.z) < 32) puff(end, now);
      }
    },
    hit: function (m) {
      hitMarker(m.head, m.kill, m.helm);
      if (m.kill) { tone(660, 0.12, 0.2, 'triangle'); setTimeout(function () { tone(990, 0.18, 0.2, 'triangle'); }, 90); }
      else if (m.helm) tone(2600, 0.07, 0.16, 'triangle');
      else tone(m.head ? 1700 : 1200, 0.05, 0.18, 'square');
    },
    hurt: function (m) {
      me.hp = m.hp;
      if (m.hm != null) me.helmet = m.hm;
      if (m.am != null) me.armor = m.am;
      me.shake = 0.25;
      flashVig();
      showDir(m.ax, m.az);
      tone(110, 0.18, 0.3, 'sawtooth');
    },
    kill: function (m) {
      var wname = (W[m.w] && W[m.w].name) || (m.w === 'grenade' ? 'Qumbara' : m.w === 'car' ? 'Maşın' : '');
      var text = nameOf(m.k) + '  [' + wname + (m.head ? ' ◎' : '') + ']  ' + nameOf(m.v);
      addFeed(text, (m.k === me.id || m.v === me.id) ? 'me' : '');
      var r = remotes.get(m.v);
      if (r) {
        var tn = performance.now();
        r.dyingUntil = tn + 1700;
        if (r.alive) { r.alive = false; r.diedAt = tn; }
      }
      if (m.v === me.id) {
        me.alive = false; me.hp = 0; me.deadT = performance.now();
        me.fireHeld = false; me.ads = false;
        document.body.classList.remove('ads', 'scoped');
        car.id = 0;
        if (!ended) showMsg('Öldün', mode === 'coop' ? 'Növbəti dalğada canlanacaqsan' : 'Tezliklə canlanacaqsan');
        setTimeout(openLoadout, 1300);
      }
    },
    wave: function (m) {
      showMsg('Dalğa ' + m.n, m.bots + ' bot gəlir', 3000);
      tone(220, 0.4, 0.25, 'sawtooth');
    },
    loot: function (m) { if (m.a) addLoot(m.id, m.ty, m.x, m.z); else removeLoot(m.id); },
    lootall: function (m) { clearLoot(); m.loot.forEach(function (l) { addLoot(l[0], l[1], l[2], l[3]); }); },
    pick: function (m) {
      var wi = ORDER.indexOf(m.ty), wasArmed = anyOwn();
      applyInv(m);
      if (wi >= 0) {
        me.ammo[wi] = W[m.ty].mag;
        if (!wasArmed) { me.wi = wi; me.reloading = false; me.switchEnd = performance.now() + 250; }
      }
      showMsg(lootName(m.ty) + ' götürüldü', '', 1400);
      tone(660, 0.08, 0.2, 'triangle');
      tone(990, 0.12, 0.2, 'triangle');
    },
    inv: function (m) {
      applyInv(m);
      if (!me.own[me.wi]) { var nx = me.own.indexOf(true); if (nx >= 0) { me.wi = nx; me.reloading = false; me.ads = false; document.body.classList.remove('ads', 'scoped'); } }
    },
    drive: function (m) {
      var o = cars.get(m.car);
      if (!o) return;
      car.id = m.car; car.x = o.x; car.z = o.z; car.yaw = o.yaw; car.camYaw = o.yaw; car.sp = 0;
      me.fireHeld = false; me.ads = false; auto.on = false; auto.fwdT = 0;
      document.body.classList.remove('ads', 'scoped');
      showMsg('Maşındasan', IS_TOUCH ? 'Joystik: sür, DÜŞ: çıx' : 'W/S/A/D sür, Space əl əyləci, E düş', 2200);
    },
    exited: function (m) {
      car.id = 0; car.sp = 0;
      me.x = m.x; me.z = m.z; me.y = 0; me.seq = m.seq; me.vx = me.vz = 0; me.yaw = car.yaw;
    },
    boom: function (m) { addBoom(m.p, performance.now()); },
    smoke: function (m) { addSmoke(m.p, m.ms, performance.now()); },
    msg: function (m) { showMsg(m.text, '', 3500); },
    end: function (m) {
      ended = true;
      showMsg(m.text, 'Yeni oyun ' + Math.round(m.ms / 1000) + ' saniyəyə başlayır');
      updateBoardVisibility();
    },
    reset: function () {
      ended = false;
      clearMsg();
      updateBoardVisibility();
      addFeed('Yeni oyun başladı');
    },
    chat: function (m) { addFeed(m.name + ': ' + m.text, 'chat'); }
  };

  function connect(name, room, modeSel, mapSel) {
    var proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(proto + '://' + location.host + '/ws');
    ws.onopen = function () { send({ t: 'join', name: name, room: room, mode: modeSel, map: mapSel }); };
    ws.onmessage = function (e) {
      var m;
      try { m = JSON.parse(e.data); } catch (_) { return; }
      if (handlers[m.t]) handlers[m.t](m);
    };
    ws.onclose = function () {
      if (joined) { $('dc').hidden = false; $('pause').hidden = true; try { document.exitPointerLock(); } catch (e) {} }
      else { $('err').textContent = $('err').textContent || 'Serverə qoşulmaq alınmadı.'; $('go').disabled = false; }
    };
  }

  setInterval(function () {
    if (!joined || !me.alive) return;
    if (car.id) { send({ t: 'car', x: +car.x.toFixed(2), z: +car.z.toFixed(2), yaw: +car.yaw.toFixed(3), sp: +car.sp.toFixed(2) }); return; }
    send({ t: 'state', x: +me.x.toFixed(3), y: +me.y.toFixed(3), z: +me.z.toFixed(3),
      yaw: +me.yaw.toFixed(3), pitch: +me.pitch.toFixed(3), wi: me.wi, c: me.crouch ? 1 : 0, seq: me.seq });
  }, 50);

  $('mode').addEventListener('change', function () {
    var coop = $('mode').value === 'coop';
    if (coop) $('map').value = 'arena';
    $('map').disabled = coop;
  });


  /* ======================= Silah seçimi (arena) ======================= */
  var LO_KEY = 'arena-loadout';
  var SIDE_IDS = ['pistol', 'deagle'], MAIN_IDS = ['uzi', 'rifle', 'akm', 'dmr', 'lmg', 'shotgun', 'sniper', 'awm'];
  var WTYPE = { pistol: 'Tapança', deagle: 'Güclü tapança', uzi: 'Avtomat pistolet', rifle: 'Avtomat', akm: 'Avtomat', dmr: 'Yarımavtomat snayper', lmg: 'Pulemyot', shotgun: 'Pompalı', sniper: 'Snayper', awm: 'Ağır snayper' };
  var lo = { side: 'pistol', main: ['rifle', 'shotgun'] };
  try {
    var svl = JSON.parse(localStorage.getItem(LO_KEY) || 'null');
    if (svl && SIDE_IDS.indexOf(svl.side) >= 0 && svl.main && svl.main.length === 2 && MAIN_IDS.indexOf(svl.main[0]) >= 0 && MAIN_IDS.indexOf(svl.main[1]) >= 0 && svl.main[0] !== svl.main[1]) lo = svl;
  } catch (e) {}
  function statBar(label, v) {
    return '<div class="st"><em>' + label + '</em><i style="width:' + Math.round(clamp(v, 0.04, 1) * 100) + '%"></i></div>';
  }
  function buildLoadoutCards() {
    function mk(id, host) {
      var w = W[id], el = document.createElement('div');
      el.className = 'wc'; el.setAttribute('data-id', id);
      var dmg = w.dmg * (w.pellets > 1 ? w.pellets * 0.6 : 1);
      el.innerHTML = '<b>' + w.name + '</b><span class="wt">' + WTYPE[id] + '</span>' +
        statBar('Zədə', dmg / 110) + statBar('Sürət', 1000 / w.rate / 16) + statBar('Məsafə', w.range / 250) +
        '<small>Dolu: ' + w.mag + '</small>';
      el.addEventListener('click', function () { pickLo(id); });
      host.appendChild(el);
    }
    SIDE_IDS.forEach(function (id) { mk(id, $('lo-side')); });
    MAIN_IDS.forEach(function (id) { mk(id, $('lo-main')); });
  }
  function pickLo(id) {
    if (SIDE_IDS.indexOf(id) >= 0) lo.side = id;
    else {
      var i = lo.main.indexOf(id);
      if (i >= 0) lo.main.splice(i, 1);
      else { lo.main.push(id); if (lo.main.length > 2) lo.main.shift(); }
    }
    renderLoadout();
  }
  function renderLoadout() {
    var cards = document.querySelectorAll('#loadout .wc');
    for (var i = 0; i < cards.length; i++) {
      var id = cards[i].getAttribute('data-id');
      cards[i].classList.toggle('sel', id === lo.side || lo.main.indexOf(id) >= 0);
    }
    var ok = lo.main.length === 2;
    $('lo-go').disabled = !ok;
    setText('lo-note', ok ? W[lo.side].name + ' + ' + W[lo.main[0]].name + ' + ' + W[lo.main[1]].name : 'İki əsas silah seçin (' + lo.main.length + '/2)');
  }
  function openLoadout() {
    if (!joined || (S.map && S.map.loot)) return;
    renderLoadout();
    $('loadout').hidden = false;
    $('loadout').scrollTop = 0;
    try { document.exitPointerLock(); } catch (e) {}
    updatePause();
  }
  function closeLoadout() { $('loadout').hidden = true; }
  buildLoadoutCards();
  renderLoadout();
  $('lo-go').addEventListener('click', function () {
    if (lo.main.length !== 2) return;
    audio();
    send({ t: 'loadout', side: lo.side, p1: lo.main[0], p2: lo.main[1] });
    try { localStorage.setItem(LO_KEY, JSON.stringify(lo)); } catch (e) {}
    closeLoadout();
    goFullscreen();
    lockPointer();
    if (!me.alive) showMsg('Hazırsan', 'Doğulmaq üçün gözləyin...', 1500);
    updatePause();
  });

  /* ======================= Giriş ======================= */
  function locked() { return IS_TOUCH ? joined : document.pointerLockElement === canvas; }
  function chatting() { return document.activeElement === $('chat'); }
  function lockPointer() {
    if (IS_TOUCH) return;
    try { var p = canvas.requestPointerLock(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
  }
  // tam ekran: Ctrl+W kimi brauzer qısayollarını klaviatura kilidi ilə tutmaq üçün
  function goFullscreen() {
    if (!$('fs').checked || document.fullscreenElement) return;
    try {
      var el = document.documentElement;
      var p = el.requestFullscreen && el.requestFullscreen();
      if (p && p.then) {
        p.then(function () {
          if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock().catch(function () {});
          if (IS_TOUCH && screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {});
        }).catch(function () {});
      }
    } catch (e) {}
  }
  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) { document.exitFullscreen(); return; }
      var el = document.documentElement;
      var p = el.requestFullscreen && el.requestFullscreen();
      if (p && p.then) {
        p.then(function () {
          if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock().catch(function () {});
          if (IS_TOUCH && screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {});
        }).catch(function () {});
      }
    } catch (e) {}
  }
  if (!document.documentElement.requestFullscreen) $('fsbtn').hidden = true;
  $('fsbtn').addEventListener('click', function (e) { e.stopPropagation(); toggleFullscreen(); });
  document.addEventListener('fullscreenchange', function () {
    $('fsbtn').textContent = document.fullscreenElement ? '✕' : '⛶';
    $('fsbtn').title = document.fullscreenElement ? 'Tam ekrandan çıx' : 'Tam ekran';
  });
  function updatePause() {
    $('pause').hidden = IS_TOUCH || !(joined && !locked() && $('dc').hidden && !chatting() && $('loadout').hidden);
  }
  document.addEventListener('pointerlockchange', updatePause);
  $('pause').addEventListener('click', function () { audio(); goFullscreen(); lockPointer(); });

  document.addEventListener('mousemove', function (e) {
    if (!joined || !locked()) return;
    var k = 0.0022 * sens * (camera.fov / BASE_FOV);
    me.yaw -= e.movementX * k;
    me.pitch = clamp(me.pitch - e.movementY * k, -1.5, 1.5);
  });
  document.addEventListener('mousedown', function (e) {
    if (!joined || !locked()) return;
    audio();
    if (e.button === 0) { me.fireHeld = true; me.fireFresh = true; }
    else if (e.button === 2) { me.ads = true; document.body.classList.add('ads'); }
  });
  document.addEventListener('mouseup', function (e) {
    if (e.button === 0) me.fireHeld = false;
    else if (e.button === 2) { me.ads = false; document.body.classList.remove('ads'); }
  });
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('wheel', function (e) {
    if (!joined || !locked()) return;
    for (var k = 1; k <= ORDER.length; k++) {
      var ni = (me.wi + (e.deltaY > 0 ? k : -k) + ORDER.length * 2) % ORDER.length;
      if (me.own[ni]) { switchWeapon(ni); break; }
    }
  }, { passive: true });

  document.addEventListener('keydown', function (e) {
    if (!joined) return;
    if (chatting()) {
      if (e.code === 'Enter') {
        var text = $('chat').value.trim();
        if (text) send({ t: 'chat', text: text });
        closeChat();
      } else if (e.code === 'Escape') closeChat();
      return;
    }
    // Ctrl ilə birlikdə basılan düymələr brauzer əmri kimi işləməsin
    if (e.ctrlKey && (e.code.indexOf('Key') === 0 || e.code.indexOf('Digit') === 0)) e.preventDefault();
    if (e.repeat && e.code !== 'Space') return;
    keys[e.code] = true;
    if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    if (e.code === 'Tab') { boardHeld = true; updateBoardVisibility(); }
    else if (e.code === 'KeyR') startReload(performance.now());
    else if (e.code === 'Enter') { openChat(); e.preventDefault(); }
    else if (e.code === 'KeyF') toggleFullscreen();
    else if (e.code === 'KeyE') interact();
    else if (e.code === 'KeyQ') dropWeapon();
    else if (e.code === 'KeyG') throwNade('frag');
    else if (e.code === 'KeyH') throwNade('smoke');
    else if (/^Digit[0-9]$/.test(e.code)) switchWeapon((+e.code.slice(5) + 9) % 10);
  });
  document.addEventListener('keyup', function (e) {
    keys[e.code] = false;
    if (e.code === 'Tab') { boardHeld = false; updateBoardVisibility(); }
  });
  window.addEventListener('blur', function () { keys = {}; me.fireHeld = false; });

  function openChat() { var c = $('chat'); c.hidden = false; c.value = ''; c.focus(); keys = {}; me.fireHeld = false; }
  function closeChat() { var c = $('chat'); c.hidden = true; c.blur(); updatePause(); }

  function dropWeapon() {
    if (!joined || !me.alive || car.id || !S.map || !S.map.loot || !me.own[me.wi]) return;
    send({ t: 'drop' });
  }
  function switchWeapon(i) {
    if (!me.alive || i === me.wi || i < 0 || i >= ORDER.length || !me.own[i]) return;
    me.wi = i;
    me.reloading = false;
    me.switchEnd = performance.now() + 250;
    me.ads = false;
    document.body.classList.remove('ads', 'scoped');
  }
  function startReload(now) {
    var w = W[ORDER[me.wi]];
    if (!me.alive || !me.own[me.wi] || me.reloading || me.ammo[me.wi] >= w.mag) return;
    me.reloading = true;
    me.reloadStart = now;
    me.reloadEnd = now + w.reload;
    clickSound();
  }
  function tryFire(now) {
    if (!me.alive || car.id || !locked() || chatting() || !me.own[me.wi]) return;
    var w = W[ORDER[me.wi]];
    if (me.reloading || now < me.switchEnd || now < me.lastFire + w.rate) return;
    if (!w.auto && !me.fireFresh) return;
    if (me.ammo[me.wi] <= 0) { me.fireFresh = false; clickSound(); startReload(now); return; }
    me.fireFresh = false;
    me.lastFire = now;
    me.ammo[me.wi]--;
    var cp = Math.cos(me.pitch);
    send({ t: 'shoot', w: w.id, dx: -Math.sin(me.yaw) * cp, dy: Math.sin(me.pitch), dz: -Math.cos(me.yaw) * cp });
    shotSound(w.id, me.su ? 0.12 : 0.45);
    me.pitch = clamp(me.pitch + w.recoil * (me.ads ? 0.5 : 1), -1.5, 1.5);
    me.yaw += (Math.random() - 0.5) * w.recoil * 0.6;
    me.kick = Math.min(0.12, me.kick + (w.recoil > 0.05 ? 0.1 : 0.04));
    flashUntil = now + (me.su ? 0 : 50);
    if (me.ammo[me.wi] === 0) startReload(now);
  }

  /* ======================= Hərəkət ======================= */
  function move(dt) {
    var active = joined && me.alive && locked() && !chatting();
    var fw = 0, st = 0;
    if (active) {
      if (keys.KeyW) fw++; if (keys.KeyS) fw--; if (keys.KeyD) st++; if (keys.KeyA) st--;
      if (IS_TOUCH && Math.hypot(tc.move.x, tc.move.y) > 0.15) { st += tc.move.x; fw -= tc.move.y; }
    }
    // Shift: əyilmə, Ctrl: sürətli qaçış (əyilmə üstündür)
    me.crouch = active && (!!(keys.ShiftLeft || keys.ShiftRight) || tc.crouch);
    // avtomatik qaçış: 2 san. fasiləsiz irəli getdikdən sonra başlayır və düyməni buraxsan da davam edir.
    // Geri getmək, əyilmək və ya nişan almaq normal yerişə qaytarır.
    if (!active || !settings.autorun || me.crouch || me.ads || fw < -0.2) { auto.on = false; auto.fwdT = 0; auto.blockT = 0; }
    else if (!auto.on) {
      if (fw > 0.5) { auto.fwdT += dt; if (auto.fwdT >= 2) { auto.on = true; auto.blockT = 0; } }
      else auto.fwdT = 0;
    }
    if (auto.on && fw < 0.2) fw = 1; // əl boşdur, qaçış davam edir
    me.sprint = active && !me.crouch && (!!(keys.ControlLeft || keys.ControlRight) || tc.sprint || auto.on) && fw > 0.2 && !me.ads;
    var speed = me.sprint ? 8 : 5.2;
    if (me.crouch) speed = 2.6;
    if (me.ads) speed *= 0.55;
    var sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
    var wx = -sy * fw + cy * st, wz = -cy * fw - sy * st;
    var l = Math.hypot(wx, wz);
    var mag = Math.min(1, l);
    if (l > 0) { wx /= l; wz /= l; }
    var k = Math.min(1, dt * (me.onGround ? 14 : 3));
    me.vx += (wx * speed * mag - me.vx) * k;
    me.vz += (wz * speed * mag - me.vz) * k;
    if (active && (keys.Space || tc.jump) && me.onGround && !me.crouch) { me.vy = 7.2; me.onGround = false; }
    tc.jump = false;
    me.vy -= 20 * dt;
    me.x += me.vx * dt;
    me.z += me.vz * dt;
    S.resolve(me);
    me.y += me.vy * dt;
    var g = S.groundAt(me.x, me.z, me.y);
    if (me.y <= g + 1e-4 && me.vy <= 0) { me.y = g; me.vy = 0; me.onGround = true; }
    else me.onGround = false;
    // göz hündürlüyü hamar dəyişir
    var eyeT = me.crouch ? S.CROUCH_EYE : S.EYE;
    me.eye += (eyeT - me.eye) * Math.min(1, dt * 12);
    // addım səsi
    var sp = Math.hypot(me.vx, me.vz);
    if (auto.on) { auto.blockT = sp < 2 ? auto.blockT + dt : 0; if (auto.blockT > 0.4) { auto.on = false; auto.fwdT = 0; } }
    if (me.onGround && sp > 1.2 && me.alive) {
      me.stepAcc += sp * dt;
      var stride = me.sprint ? 2.6 : 2.0;
      if (me.stepAcc > stride) {
        me.stepAcc = 0;
        stepSound(me.crouch ? 0.03 : me.sprint ? 0.16 : 0.1);
      }
    }
  }

  /* ======================= Əsas dövr ======================= */
  var last = performance.now(), bobT = 0, curFov = BASE_FOV;
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    var drawVM = false;

    if (joined) {
      if (me.alive) {
        if (car.id) driveCar(dt); else move(dt);
        if (me.reloading && now >= me.reloadEnd) { me.reloading = false; me.ammo[me.wi] = W[ORDER[me.wi]].mag; }
        if (me.fireHeld) tryFire(now);
      }
      var w = W[ORDER[me.wi]];
      if (me.ads && !me.own[me.wi]) { me.ads = false; document.body.classList.remove('ads'); }
      var targetFov = me.ads && me.alive ? (me.sc ? Math.max(10, w.zoom * 0.55) : w.zoom) : (me.sprint ? BASE_FOV + 6 : BASE_FOV);
      curFov += (targetFov - curFov) * Math.min(1, dt * 14);
      if (Math.abs(camera.fov - curFov) > 0.01) { camera.fov = curFov; camera.updateProjectionMatrix(); }
      var scoped = me.ads && me.alive && curFov < 24;
      document.body.classList.toggle('scoped', scoped);

      var speedNow = Math.hypot(me.vx, me.vz);
      bobT += speedNow * dt * (me.sprint ? 1.5 : 1.8);
      var bob = me.onGround && me.alive ? Math.sin(bobT) * (me.sprint ? 0.04 : 0.025) * Math.min(1, speedNow / 5) : 0;
      me.shake = Math.max(0, me.shake - dt);
      var sh = me.shake > 0 ? (Math.random() - 0.5) * me.shake * 0.05 : 0;
      if (me.alive && car.id) {
        chaseCam(dt);
      } else if (me.alive) {
        camera.position.set(me.x, me.y + me.eye + bob, me.z);
        camera.rotation.set(me.pitch + sh, me.yaw, sh, 'YXZ');
      } else {
        var p = clamp((now - me.deadT) / 400, 0, 1);
        camera.position.set(me.x, me.y + S.EYE - p * 1.1, me.z);
        camera.rotation.set(me.pitch, me.yaw, p * 0.7, 'YXZ');
      }

      // birinci şəxs silahı
      me.kick = Math.max(0, me.kick - dt * 0.6);
      for (var i = 0; i < vms.length; i++) vms[i].g.visible = (i === me.wi);
      drawVM = me.alive && !scoped && !!me.own[me.wi] && !car.id;
      var adsK = me.ads ? 1 : 0;
      var px = 0.24 * (1 - adsK), py = -0.24 + 0.07 * adsK, pz = -0.5 + 0.1 * adsK;
      var sway = Math.min(1, speedNow / 5) * (me.onGround ? 1 : 0.3);
      vmRoot.position.set(px + Math.cos(bobT) * 0.008 * sway, py + Math.abs(Math.sin(bobT)) * 0.01 * sway, pz + me.kick);
      var rotX = me.kick * 1.5, rotY = 0, dropY = 0;
      if (me.sprint) { rotX += 0.25; rotY = 0.35; dropY -= 0.05; }
      if (me.reloading) {
        var rp = clamp((now - me.reloadStart) / (me.reloadEnd - me.reloadStart), 0, 1);
        var s = Math.sin(rp * Math.PI);
        rotX -= s * 0.9; dropY -= s * 0.12;
      }
      if (now < me.switchEnd) dropY -= ((me.switchEnd - now) / 250) * 0.25;
      vmRoot.position.y += dropY;
      vmRoot.rotation.x = rotX;
      vmRoot.rotation.y = rotY;
      vms[me.wi].flash.visible = now < flashUntil;

      // digər oyunçular
      var rt = now - 100;
      remotes.forEach(function (r) { updateRemote(r, rt, dt, now); });
      updateFx(now);
      updateLoot(now, dt);
      updateNadeMeshes();
      updateCars(dt);
      engineUpdate();
      updateEffects2(now);
      updateHUD();
    } else {
      // lobbi arxa planı: arenanın üstündə dönən kamera
      var a = now * 0.00007;
      camera.position.set(Math.cos(a) * 20, 8.5, Math.sin(a) * 20);
      camera.lookAt(0, 1.5, 0);
      for (var j = 0; j < vms.length; j++) vms[j].g.visible = false;
    }

    // günəşin kölgə qutusu oyunçunu izləyir (böyük xəritələr üçün)
    var sx = Math.round(camera.position.x / 2) * 2, sz = Math.round(camera.position.z / 2) * 2;
    sun.target.position.set(sx, 0, sz);
    sun.position.set(sx + SUN_POS.x, SUN_POS.y, sz + SUN_POS.z);
    sun.target.updateMatrixWorld();

    // səma kameranı izləyir və buludlar yavaş sürüşür
    skyGroup.position.copy(camera.position);
    cloudGroup.rotation.y += dt * 0.002;

    renderer.clear();
    renderer.render(scene, camera);
    if (drawVM) {
      renderer.clearDepth();
      renderer.render(vmScene, vmCamera);
    }
  }

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    var asp = window.innerWidth / Math.max(1, window.innerHeight);
    camera.aspect = asp;
    camera.updateProjectionMatrix();
    vmCamera.aspect = asp;
    vmCamera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);

  /* ======================= Telefon idarəetməsi ======================= */
  function initTouch() {
    if (!IS_TOUCH) return;
    document.body.classList.add('touch');
    var js = $('js'), jk = $('jk'), look = $('look');
    var joyId = null, lookId = null, lx = 0, ly = 0;

    function joy(t) {
      var r = js.getBoundingClientRect();
      var R = r.width / 2;
      var dx = t.clientX - (r.left + R), dy = t.clientY - (r.top + R);
      var len = Math.hypot(dx, dy);
      if (len > R) { dx = dx / len * R; dy = dy / len * R; }
      tc.move.x = dx / R; tc.move.y = dy / R;
      jk.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    }
    function joyEnd() { joyId = null; tc.move.x = 0; tc.move.y = 0; jk.style.transform = 'translate(0,0)'; }
    function findTouch(e, id) {
      for (var i = 0; i < e.changedTouches.length; i++) if (e.changedTouches[i].identifier === id) return e.changedTouches[i];
      return null;
    }
    js.addEventListener('touchstart', function (e) { e.preventDefault(); if (editMode) return; audio(); var t = e.changedTouches[0]; joyId = t.identifier; joy(t); }, { passive: false });
    js.addEventListener('touchmove', function (e) { e.preventDefault(); if (editMode) return; var t = findTouch(e, joyId); if (t) joy(t); }, { passive: false });
    js.addEventListener('touchend', function (e) { if (findTouch(e, joyId)) joyEnd(); });
    js.addEventListener('touchcancel', function (e) { if (findTouch(e, joyId)) joyEnd(); });

    look.addEventListener('touchstart', function (e) { e.preventDefault(); if (editMode) return; var t = e.changedTouches[0]; lookId = t.identifier; lx = t.clientX; ly = t.clientY; }, { passive: false });
    look.addEventListener('touchmove', function (e) {
      e.preventDefault();
      var t = findTouch(e, lookId);
      if (editMode || !t || !me.alive) return;
      var k = 0.0042 * sens * (camera.fov / BASE_FOV);
      me.yaw -= (t.clientX - lx) * k;
      me.pitch = clamp(me.pitch - (t.clientY - ly) * k, -1.5, 1.5);
      lx = t.clientX; ly = t.clientY;
    }, { passive: false });
    look.addEventListener('touchend', function (e) { if (findTouch(e, lookId)) lookId = null; });
    look.addEventListener('touchcancel', function (e) { if (findTouch(e, lookId)) lookId = null; });

    function btn(id, down, up) {
      var el = $(id);
      el.addEventListener('touchstart', function (e) { e.preventDefault(); if (editMode) return; audio(); el.classList.add('on'); if (down) down(); }, { passive: false });
      var end = function (e) { e.preventDefault(); el.classList.remove('on'); if (!editMode && up) up(); };
      el.addEventListener('touchend', end, { passive: false });
      el.addEventListener('touchcancel', end, { passive: false });
    }
    btn('tf', function () { me.fireHeld = true; me.fireFresh = true; }, function () { me.fireHeld = false; });
    btn('tj', function () { tc.jump = true; });
    btn('te', function () { interact(); });
    btn('tq', function () { dropWeapon(); });
    btn('tg', function () { throwNade('frag'); });
    btn('th', function () { throwNade('smoke'); });
    btn('tr', function () { startReload(performance.now()); });
    btn('tb', function () { boardHeld = true; updateBoardVisibility(); }, function () { boardHeld = false; updateBoardVisibility(); });
    function toggle(id, get, set) {
      btn(id, function () { var v = !get(); set(v); $(id).classList.toggle('active', v); });
    }
    toggle('tcr', function () { return tc.crouch; }, function (v) { tc.crouch = v; if (v) { tc.sprint = false; $('ts').classList.remove('active'); } });
    toggle('ts', function () { return tc.sprint; }, function (v) { tc.sprint = v; if (v) { tc.crouch = false; $('tcr').classList.remove('active'); } });
    toggle('ta', function () { return me.ads; }, function (v) {
      me.ads = v && me.alive;
      document.body.classList.toggle('ads', me.ads);
    });
    // silah sətirinə toxunaraq dəyişmək
    for (var i = 0; i < slotsEl.children.length; i++) {
      (function (idx) {
        slotsEl.children[idx].addEventListener('touchstart', function (e) { e.preventDefault(); if (!editMode) switchWeapon(idx); }, { passive: false });
      })(i);
    }
    document.addEventListener('touchmove', function (e) {
      if (joined && !(e.target && e.target.closest && e.target.closest('.screen'))) e.preventDefault();
    }, { passive: false });
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  }
  initTouch();

  /* ======================= Ayarlar və düymə düzənləyicisi ======================= */
  var CTL_IDS = ['js', 'tf', 'tj', 'ta', 'tr', 'tcr', 'ts', 'tb', 'tg', 'th', 'te', 'tq'];
  var CTL_NAMES = { js: 'Joystik', tf: 'Atəş', tj: 'Tullan', ta: 'Nişan', tr: 'Doldur', tcr: 'Əyil', ts: 'Qaç', tb: 'Cədvəl', tg: 'Qumbara', th: 'Tüstü', te: 'Maşın', tq: 'Silah at' };
  var layout = {};
  try {
    var lraw = JSON.parse(store.get('arena-layout', '{}'));
    CTL_IDS.forEach(function (id) {
      var v = lraw && lraw[id];
      if (v && isFinite(v.x) && isFinite(v.y) && isFinite(v.s)) layout[id] = { x: clamp(v.x, 0.04, 0.96), y: clamp(v.y, 0.04, 0.96), s: clamp(v.s, 0.6, 1.8) };
    });
  } catch (e) {}
  function saveLayout() { store.set('arena-layout', JSON.stringify(layout)); }
  function applyCtl(id) {
    var cfg = layout[id], el = $(id);
    if (!cfg || !el) return;
    el.style.setProperty('--s', cfg.s);
    el.style.right = 'auto'; el.style.bottom = 'auto';
    var w = el.offsetWidth, h = el.offsetHeight;
    if (!w) return; // gizlidir: görünəndə yenidən tətbiq olunur
    el.style.left = (cfg.x * window.innerWidth - w / 2) + 'px';
    el.style.top = (cfg.y * window.innerHeight - h / 2) + 'px';
  }
  function applyLayout() { CTL_IDS.forEach(applyCtl); }
  function resetLayout() {
    layout = {};
    saveLayout();
    CTL_IDS.forEach(function (id) {
      var el = $(id);
      ['left', 'top', 'right', 'bottom'].forEach(function (k) { el.style[k] = ''; });
      el.style.removeProperty('--s');
    });
    selCtl = null;
    $('edsize').disabled = true; $('edsize').value = 1;
    $('edname').textContent = 'Düyməni seçin';
    CTL_IDS.forEach(function (id) { $(id).classList.remove('sel'); });
  }
  window.addEventListener('resize', applyLayout);
  window.addEventListener('orientationchange', function () { setTimeout(applyLayout, 200); });

  var selCtl = null, drag = null;
  function ensureCtl(id) {
    if (!layout[id]) {
      var r = $(id).getBoundingClientRect();
      layout[id] = { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight, s: 1 };
    }
    return layout[id];
  }
  function selectCtl(id) {
    selCtl = id;
    CTL_IDS.forEach(function (k) { $(k).classList.toggle('sel', k === id); });
    $('edname').textContent = CTL_NAMES[id];
    $('edsize').disabled = false;
    $('edsize').value = ensureCtl(id).s;
  }
  function setEdit(on) {
    editMode = on;
    document.body.classList.toggle('editing', on);
    $('editbar').hidden = !on;
    drag = null;
    if (on) { $('edsize').disabled = true; $('edname').textContent = 'Düyməni seçin'; }
    else { selCtl = null; CTL_IDS.forEach(function (id) { $(id).classList.remove('sel'); }); }
  }
  CTL_IDS.forEach(function (id) {
    var el = $(id);
    el.addEventListener('pointerdown', function (e) {
      if (!editMode) return;
      e.preventDefault();
      var cfg = ensureCtl(id);
      selectCtl(id);
      var r = el.getBoundingClientRect();
      drag = { id: id, dx: e.clientX - (r.left + r.width / 2), dy: e.clientY - (r.top + r.height / 2) };
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      void cfg;
    });
    el.addEventListener('pointermove', function (e) {
      if (!editMode || !drag || drag.id !== id) return;
      var cfg = layout[id];
      cfg.x = clamp((e.clientX - drag.dx) / window.innerWidth, 0.04, 0.96);
      cfg.y = clamp((e.clientY - drag.dy) / window.innerHeight, 0.04, 0.96);
      applyCtl(id);
    });
    var endDrag = function () { if (drag && drag.id === id) { drag = null; saveLayout(); } };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
  });
  $('edsize').addEventListener('input', function () {
    if (!selCtl) return;
    ensureCtl(selCtl).s = parseFloat($('edsize').value) || 1;
    applyCtl(selCtl);
    saveLayout();
  });
  $('edreset').addEventListener('click', resetLayout);
  $('eddone').addEventListener('click', function () { setEdit(false); });

  /* ---- ayarlar pəncərəsi ---- */
  function syncSettingsUI() {
    $('s-sound').checked = settings.sound;
    $('s-vol').value = settings.volume;
    $('s-shots').checked = settings.shots;
    $('s-steps').checked = settings.steps;
    $('s-hits').checked = settings.hits;
    $('s-autorun').checked = settings.autorun;
    $('s-sens').value = settings.sens;
    $('s-edit').disabled = !joined;
    $('s-edit-hint').textContent = joined ? 'Düyməni sürüşdürüb yerini, sürgü ilə ölçüsünü dəyişin.' : 'Oyuna qoşulandan sonra mümkündür.';
  }
  function openSettings() { syncSettingsUI(); $('settings').hidden = false; }
  function closeSettings() { $('settings').hidden = true; }
  [['s-sound', 'sound'], ['s-shots', 'shots'], ['s-steps', 'steps'], ['s-hits', 'hits'], ['s-autorun', 'autorun']].forEach(function (pair) {
    $(pair[0]).addEventListener('change', function () {
      settings[pair[1]] = $(pair[0]).checked;
      if (pair[1] === 'autorun' && !settings.autorun) { auto.on = false; auto.fwdT = 0; }
      applyAudio();
      saveSettings();
    });
  });
  $('s-vol').addEventListener('input', function () { settings.volume = parseFloat($('s-vol').value); applyAudio(); saveSettings(); });
  function setSens(v) {
    settings.sens = sens = v;
    $('s-sens').value = v; $('sens').value = v;
    saveSettings();
  }
  $('s-sens').addEventListener('input', function () { setSens(parseFloat($('s-sens').value) || 1); });
  $('s-test').addEventListener('click', function () { audio(); applyAudio(); shotSound('rifle', 0.45); setTimeout(function () { tone(1200, 0.05, 0.18, 'square'); }, 250); });
  $('s-edit').addEventListener('click', function () { if (!joined) return; closeSettings(); setEdit(true); });
  $('s-close').addEventListener('click', closeSettings);
  $('open-settings').addEventListener('click', openSettings);
  $('pause-settings').addEventListener('click', function (e) { e.stopPropagation(); openSettings(); });
  $('gear').addEventListener('click', openSettings);
  $('gear').addEventListener('touchstart', function (e) { e.preventDefault(); e.stopPropagation(); openSettings(); }, { passive: false });
  document.addEventListener('keydown', function (e) { if (e.code === 'Escape' && !$('settings').hidden) closeSettings(); });

  /* ======================= Lobbi ======================= */
  $('name').value = store.get('arena-name', 'Oyunçu' + (100 + Math.floor(Math.random() * 900)));
  $('sens').value = sens;
  $('fs').checked = store.get('arena-fs', '1') === '1';
  $('fs').addEventListener('change', function () { store.set('arena-fs', $('fs').checked ? '1' : '0'); });
  $('sens').addEventListener('input', function () { setSens(parseFloat($('sens').value) || 1); });
  try {
    var q = new URLSearchParams(location.search).get('room');
    if (q) $('room').value = q.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  } catch (e) {}
  $('room').addEventListener('input', function () {
    this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });
  $('form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('name').value.trim() || 'Oyunçu';
    store.set('arena-name', name);
    $('err').textContent = '';
    $('go').disabled = true;
    audio();
    goFullscreen();
    lockPointer();
    connect(name, $('room').value, $('mode').value, $('map').value);
  });
  $('reload').addEventListener('click', function () { location.reload(); });
  function copyInvite(e) {
    if (e) e.stopPropagation();
    var link = location.origin + '/?room=' + roomCode;
    var done = function () { addFeed('Dəvət linki kopyalandı'); $('invlink').textContent = 'Kopyalandı: ' + link; };
    var manual = function () { $('invlink').textContent = 'Linki əl ilə kopyalayın: ' + link; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, manual);
    else manual();
  }
  $('info').addEventListener('click', copyInvite);
  $('invite').addEventListener('click', copyInvite);
})();
