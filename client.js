(function () {
  'use strict';
  var S = window.Shared, W = S.WEAPONS, ORDER = S.WEAPON_ORDER;
  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  var clamp = S.clamp;
  var BASE_FOV = 75;
  var MODE_NAMES = { ffa: 'Hamı hamıya qarşı', tdm: 'Komanda döyüşü', coop: 'Birgə: botlara qarşı' };
  var TEAM_NAMES = { red: 'Qırmızı', blue: 'Mavi' };

  if (typeof THREE === 'undefined') {
    $('err').textContent = '3D mühərriki (Three.js) yüklənmədi. İnternet bağlantısını yoxlayın.';
    return;
  }

  /* ======================= Səhnə ======================= */
  var canvas = $('c');
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fb8d8);
  scene.fog = new THREE.Fog(0x8fb8d8, 40, 120);

  var camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.05, 300);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  scene.add(new THREE.HemisphereLight(0xdfefff, 0x6b5a45, 0.9));
  var sun = new THREE.DirectionalLight(0xfff1d6, 0.8);
  sun.position.set(-25, 40, 15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 120;
  scene.add(sun);

  function canvasTex(size, draw) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  }
  function speckle(g, s, n, a) {
    for (var i = 0; i < n; i++) {
      g.fillStyle = 'rgba(0,0,0,' + (Math.random() * a) + ')';
      g.fillRect(Math.random() * s, Math.random() * s, 3, 3);
    }
  }
  var floorTex = canvasTex(256, function (g, s) {
    g.fillStyle = '#8a8f7a'; g.fillRect(0, 0, s, s);
    speckle(g, s, 500, 0.07);
    g.strokeStyle = 'rgba(0,0,0,.22)'; g.lineWidth = 3; g.strokeRect(0, 0, s, s);
  });
  floorTex.repeat.set(16, 16);
  var texes = {
    conc: canvasTex(128, function (g, s) {
      g.fillStyle = '#9aa3aa'; g.fillRect(0, 0, s, s); speckle(g, s, 200, 0.1);
      g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 3; g.strokeRect(0, 0, s, s);
    }),
    crate: canvasTex(128, function (g, s) {
      g.fillStyle = '#b8864b'; g.fillRect(0, 0, s, s);
      g.strokeStyle = '#6b4721'; g.lineWidth = 8; g.strokeRect(4, 4, s - 8, s - 8);
      g.lineWidth = 5; g.beginPath(); g.moveTo(8, 8); g.lineTo(s - 8, s - 8); g.moveTo(s - 8, 8); g.lineTo(8, s - 8); g.stroke();
    }),
    wall: canvasTex(128, function (g, s) {
      g.fillStyle = '#4a545c'; g.fillRect(0, 0, s, s); speckle(g, s, 200, 0.15);
      g.fillStyle = '#e0a526'; g.fillRect(0, s - 14, s, 8);
    })
  };

  var ground = new THREE.Mesh(new THREE.PlaneGeometry(S.HALF * 2 + 4, S.HALF * 2 + 4),
    new THREE.MeshLambertMaterial({ map: floorTex }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  S.BOXES.forEach(function (b) {
    var kind = b.wall ? 'wall' : (b.h <= 1.3 ? 'crate' : 'conc');
    var t = texes[kind].clone();
    t.needsUpdate = true;
    t.repeat.set(Math.max(1, Math.round(Math.max(b.w, b.d) / 2)), Math.max(1, Math.round(b.h / 2)));
    var m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), new THREE.MeshLambertMaterial({ map: t }));
    m.position.set(b.cx, b.h / 2, b.cz);
    m.castShadow = !b.wall; m.receiveShadow = true;
    scene.add(m);
  });

  /* ======================= Vəziyyət ======================= */
  var ws = null, joined = false, mode = 'ffa', myTeam = null, roomCode = '';
  var roster = new Map();
  var meta = { s: 'play', r: 0, b: 0, wv: 0, bots: 0 };
  var sens = 1;
  var keys = {};
  var boardHeld = false, ended = false;
  var me = {
    id: 0, alive: false, hp: 100, x: 0, y: 0, z: 0, vx: 0, vz: 0, vy: 0, yaw: 0, pitch: 0,
    onGround: true, seq: 0, wi: 1, ammo: [], reloading: false, reloadStart: 0, reloadEnd: 0,
    lastFire: 0, switchEnd: 0, fireHeld: false, fireFresh: false, ads: false, kick: 0, shake: 0, deadT: 0
  };
  function refill() { me.ammo = ORDER.map(function (id) { return W[id].mag; }); me.reloading = false; }
  refill();

  /* ======================= Səs ======================= */
  var actx = null, noiseBuf = null;
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
    shotgun: { f: 1200, d: 0.38, low: 70 }, sniper: { f: 1500, d: 0.6, low: 55 }
  };
  function shotSound(wid, vol) {
    var a = audio(); if (!a || vol < 0.01) return;
    var c = SHOT_SND[wid] || SHOT_SND.rifle, t = a.currentTime;
    var n = a.createBufferSource(); n.buffer = noise(a); n.playbackRate.value = 0.8 + Math.random() * 0.4;
    var lp = a.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(c.f, t); lp.frequency.exponentialRampToValueAtTime(200, t + c.d);
    var g = a.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + c.d);
    n.connect(lp); lp.connect(g); g.connect(a.destination);
    n.start(t, Math.random() * 0.5); n.stop(t + c.d + 0.05);
    var o = a.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(c.low * 2, t); o.frequency.exponentialRampToValueAtTime(c.low * 0.5, t + c.d);
    var og = a.createGain(); og.gain.setValueAtTime(vol * 0.8, t); og.gain.exponentialRampToValueAtTime(0.001, t + c.d);
    o.connect(og); og.connect(a.destination); o.start(t); o.stop(t + c.d + 0.05);
  }
  function tone(freq, dur, vol, type) {
    var a = audio(); if (!a) return;
    var t = a.currentTime, o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  function clickSound() { tone(900, 0.04, 0.12, 'square'); }

  /* ======================= Silah modelləri (birinci şəxs) ======================= */
  var M = {
    metal: new THREE.MeshLambertMaterial({ color: 0x2c3036 }),
    dark: new THREE.MeshLambertMaterial({ color: 0x1a1c20 }),
    wood: new THREE.MeshLambertMaterial({ color: 0x6b4a2b }),
    skin: new THREE.MeshLambertMaterial({ color: 0xd9a97f }),
    flash: new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.95 })
  };
  ['metal', 'dark', 'wood', 'skin', 'flash'].forEach(function (k) { M[k].depthTest = false; });
  var boxGeoCache = {};
  function part(grp, w, h, d, x, y, z, mat) {
    var key = w + ',' + h + ',' + d;
    var geo = boxGeoCache[key] || (boxGeoCache[key] = new THREE.BoxGeometry(w, h, d));
    var m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.renderOrder = 999;
    grp.add(m);
    return m;
  }
  function buildVM(id) {
    var g = new THREE.Group(), mz;
    if (id === 'pistol') {
      part(g, 0.06, 0.07, 0.28, 0, 0.02, -0.1, M.metal);
      part(g, 0.055, 0.14, 0.08, 0, -0.07, 0.03, M.dark);
      part(g, 0.075, 0.09, 0.1, 0, -0.08, 0.04, M.skin);
      mz = -0.26;
    } else if (id === 'rifle') {
      part(g, 0.07, 0.09, 0.5, 0, 0, -0.12, M.metal);
      part(g, 0.03, 0.03, 0.3, 0, 0.02, -0.52, M.dark);
      part(g, 0.05, 0.14, 0.08, 0, -0.1, -0.08, M.dark);
      part(g, 0.06, 0.1, 0.22, 0, -0.02, 0.26, M.wood);
      part(g, 0.08, 0.08, 0.12, 0, -0.06, -0.3, M.skin);
      mz = -0.7;
    } else if (id === 'shotgun') {
      part(g, 0.04, 0.04, 0.72, 0, 0.02, -0.3, M.dark);
      part(g, 0.07, 0.06, 0.2, 0, -0.02, -0.25, M.wood);
      part(g, 0.07, 0.1, 0.3, 0, -0.01, 0.1, M.metal);
      part(g, 0.06, 0.1, 0.25, 0, -0.04, 0.36, M.wood);
      part(g, 0.08, 0.08, 0.1, 0, -0.04, -0.25, M.skin);
      mz = -0.68;
    } else {
      part(g, 0.06, 0.08, 0.6, 0, 0, -0.1, M.metal);
      part(g, 0.025, 0.025, 0.5, 0, 0.01, -0.65, M.dark);
      part(g, 0.045, 0.045, 0.26, 0, 0.075, -0.1, M.dark);
      part(g, 0.06, 0.11, 0.3, 0, -0.03, 0.36, M.wood);
      part(g, 0.08, 0.08, 0.1, 0, -0.05, -0.2, M.skin);
      mz = -0.92;
    }
    var flash = part(g, 0.14, 0.14, 0.02, 0, 0.02, mz - 0.03, M.flash);
    flash.visible = false;
    var muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.02, mz);
    g.add(muzzle);
    g.visible = false;
    return { g: g, flash: flash, muzzle: muzzle };
  }
  var vmRoot = new THREE.Group();
  camera.add(vmRoot);
  var vms = ORDER.map(function (id) { var v = buildVM(id); vmRoot.add(v.g); return v; });
  var flashUntil = 0;

  /* ======================= Digər oyunçular ======================= */
  var remotes = new Map();
  var gSpark = new THREE.SphereGeometry(0.09, 6, 5);
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
    sp.position.y = 2.25;
    return sp;
  }
  function makeRemote(id, bot) {
    var color = entityColor(id, bot);
    var g = new THREE.Group();
    var bodyMat = new THREE.MeshLambertMaterial({ color: color });
    var dark = new THREE.MeshLambertMaterial({ color: 0x22252b });
    var skin = new THREE.MeshLambertMaterial({ color: bot ? 0x5a2020 : 0xe0b894 });
    function box(w, h, d, x, y, z, mat, parent) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z); m.castShadow = true;
      (parent || g).add(m);
      return m;
    }
    box(0.62, 0.8, 0.34, 0, 1.15, 0, bodyMat);
    var legL = new THREE.Group(), legR = new THREE.Group();
    legL.position.set(-0.17, 0.75, 0); legR.position.set(0.17, 0.75, 0);
    box(0.24, 0.75, 0.28, 0, -0.375, 0, dark, legL);
    box(0.24, 0.75, 0.28, 0, -0.375, 0, dark, legR);
    g.add(legL); g.add(legR);
    var aim = new THREE.Group();
    aim.position.set(0, 1.4, 0);
    box(0.3, 0.3, 0.3, 0, 0.28, 0, skin, aim);
    box(0.16, 0.16, 0.16, -0.4, -0.3, -0.05, bodyMat, aim);
    box(0.16, 0.16, 0.16, 0.4, -0.3, -0.05, bodyMat, aim);
    box(0.09, 0.12, 0.7, 0.28, -0.22, -0.4, dark, aim);
    g.add(aim);
    scene.add(g);
    var r = {
      id: id, bot: bot, group: g, bodyMat: bodyMat, aim: aim, legL: legL, legR: legR,
      tag: null, tagKey: '', buf: [], alive: true, diedAt: 0, dyingUntil: 0, seen: 0, walkT: 0, lx: 0, lz: 0, hp: 100
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
    if (!r.alive) {
      var p = clamp((now - r.diedAt) / 350, 0, 1);
      r.group.rotation.x = p * Math.PI / 2;
      if (r.tag) r.tag.visible = false;
      r.group.visible = now - r.diedAt < 1600;
    } else {
      r.group.rotation.x = 0;
      r.group.visible = true;
      if (r.tag) r.tag.visible = true;
    }
  }

  /* ======================= Effektlər ======================= */
  var fx = [];
  var gTracer = new THREE.BoxGeometry(1, 1, 1);
  var mTracer = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.85 });
  var mSpark = new THREE.MeshBasicMaterial({ color: 0xffb347 });
  function tracer(a, b, now) {
    var d = a.distanceTo(b);
    if (d < 0.5) return;
    var m = new THREE.Mesh(gTracer, mTracer);
    m.position.copy(a).lerp(b, 0.5);
    m.lookAt(b);
    m.scale.set(0.025, 0.025, d);
    scene.add(m);
    fx.push({ m: m, t0: now, life: 90, kind: 'tracer', s0: 0.025, len: d });
  }
  function spark(p, now, size) {
    var m = new THREE.Mesh(gSpark, mSpark);
    m.position.copy(p);
    m.scale.setScalar(size || 1);
    scene.add(m);
    fx.push({ m: m, t0: now, life: 140, kind: 'spark', s0: size || 1 });
  }
  function updateFx(now) {
    for (var i = fx.length - 1; i >= 0; i--) {
      var e = fx[i], p = (now - e.t0) / e.life;
      if (p >= 1) { scene.remove(e.m); fx.splice(i, 1); continue; }
      if (e.kind === 'tracer') e.m.scale.set(e.s0 * (1 - p), e.s0 * (1 - p), e.len);
      else e.m.scale.setScalar(e.s0 * (1 - p));
    }
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
    s.textContent = (i + 1) + ' ' + W[id].name;
    slotsEl.appendChild(s);
  });

  function updateHUD() {
    var w = W[ORDER[me.wi]];
    setText('wname', w.name);
    var ammo = me.ammo[me.wi];
    setHTML('ammo', me.reloading ? 'DOLDURULUR' : ammo + '<small> / ' + w.mag + '</small>');
    $('ammo').classList.toggle('low', !me.reloading && ammo <= Math.ceil(w.mag * 0.25));
    for (var i = 0; i < slotsEl.children.length; i++) slotsEl.children[i].classList.toggle('on', i === me.wi);
    var hp = Math.max(0, Math.round(me.hp));
    setHTML('hpnum', hp + '<small>CAN</small>');
    var fill = $('hpfill');
    fill.style.width = hp + '%';
    fill.style.background = hp > 60 ? 'var(--green)' : hp > 30 ? 'var(--amber)' : 'var(--red)';
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
    setText('rmode', (MODE_NAMES[mode] || '') + ' · dəvət üçün klik');
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
  function hitMarker(head, kill) {
    var h = $('hitm');
    h.className = 'on' + (kill ? ' kill' : head ? ' head' : '');
    clearTimeout(hitTimer);
    hitTimer = setTimeout(function () { h.className = ''; }, 140);
  }

  /* ======================= Şəbəkə ======================= */
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

  var handlers = {
    welcome: function (m) {
      joined = true;
      me.id = m.id; mode = m.mode; myTeam = m.team; roomCode = m.room;
      $('lobby').hidden = true;
      $('hud').hidden = false;
      document.body.classList.remove('ads', 'scoped');
      updateInfo();
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
      refill();
      me.wi = 1; me.switchEnd = 0;
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
          if (e[8] & 1) me.hp = e[6];
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
        r.buf.push({ t: now, x: e[1], y: e[2], z: e[3], yaw: e[4], pitch: e[5] });
        if (r.buf.length > 12) r.buf.shift();
      }
      remotes.forEach(function (r) {
        if (!seen[r.id] && now > r.dyingUntil) removeRemote(r);
      });
      updateScoreline();
    },
    shot: function (m) {
      var now = performance.now();
      var o = new THREE.Vector3(m.o[0], m.o[1], m.o[2]);
      var start = o.clone();
      var wid = ORDER[m.w] || 'rifle';
      if (m.id === me.id) {
        vms[me.wi].muzzle.getWorldPosition(start);
      } else {
        var r = remotes.get(m.id);
        if (r) {
          start.set(r.group.position.x - Math.sin(r.group.rotation.y) * 0.6, r.group.position.y + 1.3,
            r.group.position.z - Math.cos(r.group.rotation.y) * 0.6);
        }
        var dist = o.distanceTo(camera.position);
        shotSound(wid, clamp(1 - dist / 70, 0, 1) * 0.5);
        spark(start, now, 1.4);
      }
      for (var i = 0; i < m.e.length; i++) {
        var end = new THREE.Vector3(m.e[i][0], m.e[i][1], m.e[i][2]);
        tracer(start, end, now);
        spark(end, now, 0.8);
      }
    },
    hit: function (m) {
      hitMarker(m.head, m.kill);
      if (m.kill) { tone(660, 0.12, 0.2, 'triangle'); setTimeout(function () { tone(990, 0.18, 0.2, 'triangle'); }, 90); }
      else tone(m.head ? 1700 : 1200, 0.05, 0.18, 'square');
    },
    hurt: function (m) {
      me.hp = m.hp;
      me.shake = 0.25;
      flashVig();
      showDir(m.ax, m.az);
      tone(110, 0.18, 0.3, 'sawtooth');
    },
    kill: function (m) {
      var wname = (W[m.w] && W[m.w].name) || '';
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
        if (!ended) showMsg('Öldün', mode === 'coop' ? 'Növbəti dalğada canlanacaqsan' : 'Tezliklə canlanacaqsan');
      }
    },
    wave: function (m) {
      showMsg('Dalğa ' + m.n, m.bots + ' bot gəlir', 3000);
      tone(220, 0.4, 0.25, 'sawtooth');
    },
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

  function connect(name, room, modeSel) {
    var proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(proto + '://' + location.host + '/ws');
    ws.onopen = function () { send({ t: 'join', name: name, room: room, mode: modeSel }); };
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
    send({ t: 'state', x: +me.x.toFixed(3), y: +me.y.toFixed(3), z: +me.z.toFixed(3),
      yaw: +me.yaw.toFixed(3), pitch: +me.pitch.toFixed(3), wi: me.wi, seq: me.seq });
  }, 50);

  /* ======================= Giriş ======================= */
  function locked() { return document.pointerLockElement === canvas; }
  function chatting() { return document.activeElement === $('chat'); }
  function lockPointer() {
    try { var p = canvas.requestPointerLock(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
  }
  function updatePause() {
    $('pause').hidden = !(joined && !locked() && $('dc').hidden && !chatting());
  }
  document.addEventListener('pointerlockchange', updatePause);
  $('pause').addEventListener('click', function () { audio(); lockPointer(); });

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
    switchWeapon((me.wi + (e.deltaY > 0 ? 1 : ORDER.length - 1)) % ORDER.length);
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
    if (e.repeat && e.code !== 'Space') return;
    keys[e.code] = true;
    if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    if (e.code === 'Tab') { boardHeld = true; updateBoardVisibility(); }
    else if (e.code === 'KeyR') startReload(performance.now());
    else if (e.code === 'Enter') { openChat(); e.preventDefault(); }
    else if (e.code >= 'Digit1' && e.code <= 'Digit4') switchWeapon(+e.code.slice(5) - 1);
  });
  document.addEventListener('keyup', function (e) {
    keys[e.code] = false;
    if (e.code === 'Tab') { boardHeld = false; updateBoardVisibility(); }
  });
  window.addEventListener('blur', function () { keys = {}; me.fireHeld = false; });

  function openChat() { var c = $('chat'); c.hidden = false; c.value = ''; c.focus(); keys = {}; me.fireHeld = false; }
  function closeChat() { var c = $('chat'); c.hidden = true; c.blur(); updatePause(); }

  function switchWeapon(i) {
    if (!me.alive || i === me.wi || i < 0 || i >= ORDER.length) return;
    me.wi = i;
    me.reloading = false;
    me.switchEnd = performance.now() + 250;
    me.ads = false;
    document.body.classList.remove('ads', 'scoped');
  }
  function startReload(now) {
    var w = W[ORDER[me.wi]];
    if (!me.alive || me.reloading || me.ammo[me.wi] >= w.mag) return;
    me.reloading = true;
    me.reloadStart = now;
    me.reloadEnd = now + w.reload;
    clickSound();
  }
  function tryFire(now) {
    if (!me.alive || !locked() || chatting()) return;
    var w = W[ORDER[me.wi]];
    if (me.reloading || now < me.switchEnd || now < me.lastFire + w.rate) return;
    if (!w.auto && !me.fireFresh) return;
    if (me.ammo[me.wi] <= 0) { me.fireFresh = false; clickSound(); startReload(now); return; }
    me.fireFresh = false;
    me.lastFire = now;
    me.ammo[me.wi]--;
    var cp = Math.cos(me.pitch);
    send({ t: 'shoot', w: w.id, dx: -Math.sin(me.yaw) * cp, dy: Math.sin(me.pitch), dz: -Math.cos(me.yaw) * cp });
    shotSound(w.id, 0.45);
    me.pitch = clamp(me.pitch + w.recoil * (me.ads ? 0.5 : 1), -1.5, 1.5);
    me.yaw += (Math.random() - 0.5) * w.recoil * 0.6;
    me.kick = Math.min(0.12, me.kick + (w.id === 'shotgun' || w.id === 'sniper' ? 0.1 : 0.04));
    flashUntil = now + 50;
    if (me.ammo[me.wi] === 0) startReload(now);
  }

  /* ======================= Hərəkət ======================= */
  function move(dt) {
    var active = joined && me.alive && locked() && !chatting();
    var fw = 0, st = 0;
    if (active) {
      if (keys.KeyW) fw++; if (keys.KeyS) fw--; if (keys.KeyD) st++; if (keys.KeyA) st--;
    }
    var sprint = active && (keys.ShiftLeft || keys.ShiftRight) && fw > 0 && !me.ads;
    var speed = sprint ? 8 : 5.2;
    if (me.ads) speed *= 0.55;
    var sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
    var wx = -sy * fw + cy * st, wz = -cy * fw - sy * st;
    var l = Math.hypot(wx, wz);
    if (l > 0) { wx /= l; wz /= l; }
    var k = Math.min(1, dt * (me.onGround ? 14 : 3));
    me.vx += (wx * speed - me.vx) * k;
    me.vz += (wz * speed - me.vz) * k;
    if (active && keys.Space && me.onGround) { me.vy = 7.2; me.onGround = false; }
    me.vy -= 20 * dt;
    me.x += me.vx * dt;
    me.z += me.vz * dt;
    S.resolve(me);
    me.y += me.vy * dt;
    var g = S.groundAt(me.x, me.z, me.y);
    if (me.y <= g + 1e-4 && me.vy <= 0) { me.y = g; me.vy = 0; me.onGround = true; }
    else me.onGround = false;
  }

  /* ======================= Əsas dövr ======================= */
  var last = performance.now(), bobT = 0, curFov = BASE_FOV;
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (joined) {
      if (me.alive) {
        move(dt);
        if (me.reloading && now >= me.reloadEnd) { me.reloading = false; me.ammo[me.wi] = W[ORDER[me.wi]].mag; }
        if (me.fireHeld) tryFire(now);
      }
      var w = W[ORDER[me.wi]];
      var targetFov = me.ads && me.alive ? w.zoom : BASE_FOV;
      curFov += (targetFov - curFov) * Math.min(1, dt * 14);
      if (Math.abs(camera.fov - curFov) > 0.01) { camera.fov = curFov; camera.updateProjectionMatrix(); }
      var scoped = me.ads && me.alive && w.id === 'sniper' && curFov < 30;
      document.body.classList.toggle('scoped', scoped);

      var speedNow = Math.hypot(me.vx, me.vz);
      bobT += speedNow * dt * 1.8;
      var bob = me.onGround && me.alive ? Math.sin(bobT) * 0.025 * Math.min(1, speedNow / 5) : 0;
      me.shake = Math.max(0, me.shake - dt);
      var sh = me.shake > 0 ? (Math.random() - 0.5) * me.shake * 0.05 : 0;
      if (me.alive) {
        camera.position.set(me.x, me.y + S.EYE + bob, me.z);
        camera.rotation.set(me.pitch + sh, me.yaw, sh, 'YXZ');
      } else {
        var p = clamp((now - me.deadT) / 400, 0, 1);
        camera.position.set(me.x, me.y + S.EYE - p * 1.1, me.z);
        camera.rotation.set(me.pitch, me.yaw, p * 0.7, 'YXZ');
      }

      // birinci şəxs silahı
      me.kick = Math.max(0, me.kick - dt * 0.6);
      for (var i = 0; i < vms.length; i++) vms[i].g.visible = (i === me.wi) && me.alive && !scoped;
      var adsK = me.ads ? 1 : 0;
      var px = 0.24 * (1 - adsK), py = -0.24 + 0.07 * adsK, pz = -0.5 + 0.1 * adsK;
      var sway = Math.min(1, speedNow / 5) * (me.onGround ? 1 : 0.3);
      vmRoot.position.set(px + Math.cos(bobT) * 0.008 * sway, py + Math.abs(Math.sin(bobT)) * 0.01 * sway, pz + me.kick);
      var rotX = me.kick * 1.5, dropY = 0;
      if (me.reloading) {
        var rp = clamp((now - me.reloadStart) / (me.reloadEnd - me.reloadStart), 0, 1);
        var s = Math.sin(rp * Math.PI);
        rotX -= s * 0.9; dropY -= s * 0.12;
      }
      if (now < me.switchEnd) dropY -= ((me.switchEnd - now) / 250) * 0.25;
      vmRoot.position.y += dropY;
      vmRoot.rotation.x = rotX;
      vms[me.wi].flash.visible = now < flashUntil;

      // digər oyunçular
      var rt = now - 100;
      remotes.forEach(function (r) { updateRemote(r, rt, dt, now); });
      updateFx(now);
      updateHUD();
    } else {
      // lobbi arxa planı: arenanın üstündə dönən kamera
      var a = now * 0.00007;
      camera.position.set(Math.cos(a) * 20, 8.5, Math.sin(a) * 20);
      camera.lookAt(0, 1.5, 0);
      for (var j = 0; j < vms.length; j++) vms[j].g.visible = false;
    }
    renderer.render(scene, camera);
  }

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);

  /* ======================= Lobbi ======================= */
  $('name').value = store.get('arena-name', 'Oyunçu' + (100 + Math.floor(Math.random() * 900)));
  sens = parseFloat(store.get('arena-sens', '1')) || 1;
  $('sens').value = sens;
  $('sens').addEventListener('input', function () { sens = parseFloat($('sens').value) || 1; store.set('arena-sens', String(sens)); });
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
    lockPointer();
    connect(name, $('room').value, $('mode').value);
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
