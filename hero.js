/* ═══════════════════════════════════════════════
   hero.js — 첫 화면 제목판 (1.17.0 에서 새로 만듦)

   작은 픽토그램들이 화면 양 끝에서 달려 들어와 사이트 이름 모양으로 모인다.
   모양은 세 가지이고 들어올 때마다 무작위로 고른다 (바로 전과 같은 것은 나오지 않게).
     A 기호   — 코딩 기호(</> { } 키캡 ▶ …)에 KAIT-PLAY 캐릭터가 조금 섞임
     B 캐릭터 — KAIT-PLAY 캐릭터만으로, 통통 뛰며 행진해 옴
     C 블록   — 기호가 그려진 블록이 빙글 돌며 날아와 끼워짐
   마우스를 대면 A·B 는 비켜나고 C 는 블록이 뒤집힌다. 누르면 흩어졌다가 다시 모인다.

   · 이름은 캔버스에 한 번 그려 보고 잉크가 묻은 칸을 뽑는다 → 한글 · 영문 · 길이 상관없음
   · 외부 라이브러리 · 그림 파일을 쓰지 않는다 (그림은 SVG 문자열로 만들어 한 번만 굽는다)
   · 화면 밖 · 다른 탭이면 멈추고, 다 모여 가만히 있으면 그리기를 쉰다 (노트북 배터리)
   · 자바스크립트가 없으면 사이트 이름 글자가 그냥 보인다
   · '동작 줄이기'를 켠 사람에게는 다 모인 모습만 보인다
   ═══════════════════════════════════════════════ */
(function () {
  'use strict';
  var hero = document.getElementById('hero');
  if (!hero) return;
  var cv = hero.querySelector('canvas');
  var ctx = cv && cv.getContext && cv.getContext('2d');
  if (!ctx) return;

  var NAME = String(window.SITE_NAME || 'OJ');
  var small = hero.classList.contains('small');
  var calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── 모양 고르기: 무작위, 바로 전과 다르게 ──
     브라우저 저장소를 못 쓰면(사생활 보호 모드 등) 그냥 무작위 */
  var KINDS = ['A', 'B', 'C'], V, prev = null;
  try { prev = localStorage.getItem('kc.hero'); } catch (e) {}
  var pool = KINDS.filter(function (k) { return k !== prev; });
  V = pool[Math.floor(Math.random() * pool.length)];
  try { localStorage.setItem('kc.hero', V); } catch (e) {}
  hero.setAttribute('data-v', V);

  /* ── 픽토그램 (24×24 선 그림) ── */
  var ICONS = [
    '<path d="M8 7 L3 12 L8 17 M16 7 L21 12 L16 17 M13.5 4.5 L10.5 19.5"/>',                                   // </>
    '<path d="M9 4 C6 4 7.5 10 5 12 C7.5 14 6 20 9 20 M15 4 C18 4 16.5 10 19 12 C16.5 14 18 20 15 20"/>',       // { }
    '<rect x="4" y="5" width="16" height="14" rx="3"/><path d="M8.5 14.5 H15.5"/>',                              // 키캡
    '<path d="M7.5 5 L19 12 L7.5 19 Z" data-fill="1"/>',                                                         // 실행 ▶
    '<path d="M5 12.5 L10 17 L19.5 7"/>',                                                                        // 맞음 ✓
    '<path d="M12 3.5 L14.6 9 L20.5 9.6 L16 13.6 L17.3 19.5 L12 16.5 L6.7 19.5 L8 13.6 L3.5 9.6 L9.4 9 Z" data-fill="1"/>', // 별
    '<path d="M13.5 3 L5.5 13.5 H11.5 L10.5 21 L18.5 10.5 H12.5 Z" data-fill="1"/>',                             // 번개
    '<path d="M5 8 L10 12 L5 16 M12.5 17 H19"/>',                                                                // >_
    '<path d="M10 4 L8 20 M16 4 L14 20 M5 9.5 H20 M4 14.5 H19"/>',                                               // #
    '<path d="M5 6 H19 M5 12 H15 M5 18 H11"/>'                                                                   // 코드 줄
  ];
  var BLUES = ['#2F51A0', '#243F80', '#4266B4', '#6D8DCA', '#1B2F5E', '#5B5BF5'];
  var TILE  = ['#2F51A0', '#243F80', '#4266B4', '#1B2F5E'];
  var FLIP  = ['#E5484D', '#F06A3C'];      // 뒤집힌 블록 — 플립 배틀의 빨강

  /* ── KAIT-PLAY 캐릭터 8종 ──
     play/public/js/avatar.js 의 PARTS 를 그대로 옮겨 왔다.
     KAIT-PLAY 를 설치하지 않은 서버도 있으므로 그 파일을 불러 쓰지 않는다.
     캐릭터 모양을 바꾸면 여기도 같이 바꿀 것. */
  var INK = '#0B1030';
  var PARTS = {
    slime: function (c) {
      return '<path d="M5 28 C5 17 9 9 16 9 C23 9 27 17 27 28 Z" fill="' + c + '" stroke="' + INK + '" stroke-width="1.6" stroke-linejoin="round"/>' +
        '<path d="M10 15 C11 12.5 13 11.4 15 11.2" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".75"/>' +
        '<circle cx="12.5" cy="19.5" r="2.2" fill="' + INK + '"/><circle cx="19.5" cy="19.5" r="2.2" fill="' + INK + '"/>' +
        '<circle cx="13.2" cy="18.8" r=".7" fill="#fff"/><circle cx="20.2" cy="18.8" r=".7" fill="#fff"/>' +
        '<path d="M14 23.6 Q16 25.2 18 23.6" stroke="' + INK + '" stroke-width="1.4" fill="none" stroke-linecap="round"/>';
    },
    robot: function (c) {
      return '<line x1="16" y1="3.8" x2="16" y2="8" stroke="' + INK + '" stroke-width="1.6"/>' +
        '<circle cx="16" cy="3.6" r="1.9" fill="' + c + '" stroke="' + INK + '" stroke-width="1.2"/>' + // 안테나 끝도 고른 색 (v0.13.0)
        '<rect x="6" y="8" width="20" height="15" rx="3.5" fill="' + c + '" stroke="' + INK + '" stroke-width="1.6"/>' +
        '<rect x="9" y="12" width="14" height="6.5" rx="2" fill="' + INK + '"/>' +
        '<rect x="11" y="14.2" width="3.2" height="2.2" fill="#7CF5FF"/><rect x="17.8" y="14.2" width="3.2" height="2.2" fill="#7CF5FF"/>' +
        '<rect x="10" y="23" width="12" height="5.6" rx="1.6" fill="' + c + '" stroke="' + INK + '" stroke-width="1.6"/>';
    },
    cat: function (c) {
      return '<path d="M7.5 15 L8.5 4.8 L15 10.5 Z" fill="' + c + '" stroke="' + INK + '" stroke-width="1.6" stroke-linejoin="round"/>' +
        '<path d="M24.5 15 L23.5 4.8 L17 10.5 Z" fill="' + c + '" stroke="' + INK + '" stroke-width="1.6" stroke-linejoin="round"/>' +
        '<circle cx="16" cy="18.5" r="10" fill="' + c + '" stroke="' + INK + '" stroke-width="1.6"/>' +
        '<ellipse cx="12" cy="17.8" rx="1.6" ry="2.4" fill="' + INK + '"/><ellipse cx="20" cy="17.8" rx="1.6" ry="2.4" fill="' + INK + '"/>' +
        '<path d="M15 21.4 L17 21.4 L16 22.8 Z" fill="#FF5C8A"/>' +
        '<line x1="4" y1="20" x2="9.5" y2="21" stroke="' + INK + '" stroke-width="1"/><line x1="28" y1="20" x2="22.5" y2="21" stroke="' + INK + '" stroke-width="1"/>';
    },
    ghost: function (c) {
      return '<path d="M6 28.5 V15 A10 10 0 0 1 26 15 V28.5 L22.7 25.8 L19.3 28.5 L16 25.8 L12.7 28.5 L9.3 25.8 Z" fill="' + c + '" stroke="' + INK + '" stroke-width="1.6" stroke-linejoin="round"/>' +
        '<ellipse cx="12.5" cy="16" rx="2" ry="2.9" fill="' + INK + '"/><ellipse cx="19.5" cy="16" rx="2" ry="2.9" fill="' + INK + '"/>' +
        '<ellipse cx="10" cy="20.5" rx="1.6" ry="1" fill="#FF5C8A" opacity=".6"/><ellipse cx="22" cy="20.5" rx="1.6" ry="1" fill="#FF5C8A" opacity=".6"/>';
    },
    owl: function (c) {
      return '<path d="M8 11 L7 4 L12.5 8 Z" fill="' + c + '" stroke="' + INK + '" stroke-width="1.4" stroke-linejoin="round"/>' +
        '<path d="M24 11 L25 4 L19.5 8 Z" fill="' + c + '" stroke="' + INK + '" stroke-width="1.4" stroke-linejoin="round"/>' +
        '<ellipse cx="16" cy="18" rx="10.5" ry="11" fill="' + c + '" stroke="' + INK + '" stroke-width="1.6"/>' +
        '<ellipse cx="16" cy="24" rx="5.5" ry="3.8" fill="#fff" opacity=".35"/>' +
        '<circle cx="12" cy="15.5" r="4" fill="#fff" stroke="' + INK + '" stroke-width="1.2"/><circle cx="20" cy="15.5" r="4" fill="#fff" stroke="' + INK + '" stroke-width="1.2"/>' +
        '<circle cx="12.4" cy="15.8" r="1.9" fill="' + INK + '"/><circle cx="19.6" cy="15.8" r="1.9" fill="' + INK + '"/>' +
        '<path d="M14.6 19.4 L17.4 19.4 L16 22 Z" fill="#FFB347" stroke="' + INK + '" stroke-width="1" stroke-linejoin="round"/>';
    },
    dino: function (c) {
      return '<path d="M10 9 L11.6 4.6 L13.6 8.4 L15.6 4.2 L17.4 8.2 L19.2 4.8 L20.4 8.4" fill="#fff" stroke="' + INK + '" stroke-width="1.2" stroke-linejoin="round"/>' +
        '<path d="M6 28.5 V16 C6 11 10 8 15 8 H19.5 C24.5 8 27.5 11 27.5 15 V18.5 H22 V28.5 Z" fill="' + c + '" stroke="' + INK + '" stroke-width="1.6" stroke-linejoin="round"/>' +
        '<circle cx="21" cy="13" r="1.9" fill="' + INK + '"/><circle cx="21.6" cy="12.4" r=".6" fill="#fff"/>' +
        '<path d="M22.5 18.5 L23.5 20 L24.5 18.5 L25.5 20 L26.5 18.5" fill="none" stroke="' + INK + '" stroke-width="1" stroke-linejoin="round"/>' +
        '<ellipse cx="12" cy="22" rx="3.2" ry="4" fill="#fff" opacity=".3"/>';
    },
    // v0.13.0: 외계인 · 개구리
  alien: function (c) {
    return '<line x1="11" y1="9" x2="8.5" y2="3.8" stroke="' + INK + '" stroke-width="1.4"/><circle cx="8.2" cy="3.4" r="1.8" fill="' + c + '" stroke="' + INK + '" stroke-width="1.1"/>' +
      '<line x1="21" y1="9" x2="23.5" y2="3.8" stroke="' + INK + '" stroke-width="1.4"/><circle cx="23.8" cy="3.4" r="1.8" fill="' + c + '" stroke="' + INK + '" stroke-width="1.1"/>' +
      '<path d="M16 7.5 C24 7.5 27.5 12.5 27 18 C26.4 24.5 21 28.6 16 28.6 C11 28.6 5.6 24.5 5 18 C4.5 12.5 8 7.5 16 7.5 Z" fill="' + c + '" stroke="' + INK + '" stroke-width="1.6"/>' +
      '<path d="M8.6 16.2 C9.2 13.6 12.6 13.4 13.8 15.6 C14.6 17.4 13 19.6 11 19.4 C9.2 19.2 8.2 17.8 8.6 16.2 Z" fill="' + INK + '"/>' +
      '<path d="M23.4 16.2 C22.8 13.6 19.4 13.4 18.2 15.6 C17.4 17.4 19 19.6 21 19.4 C22.8 19.2 23.8 17.8 23.4 16.2 Z" fill="' + INK + '"/>' +
      '<circle cx="10.6" cy="15.6" r=".8" fill="#fff"/><circle cx="21.4" cy="15.6" r=".8" fill="#fff"/>' +
      '<path d="M14.2 23.4 Q16 24.6 17.8 23.4" stroke="' + INK + '" stroke-width="1.3" fill="none" stroke-linecap="round"/>';
  },
  frog: function (c) {
    return '<circle cx="10" cy="9.5" r="4.6" fill="' + c + '" stroke="' + INK + '" stroke-width="1.6"/><circle cx="22" cy="9.5" r="4.6" fill="' + c + '" stroke="' + INK + '" stroke-width="1.6"/>' +
      '<path d="M4.5 21 C4.5 13.5 9.5 11 16 11 C22.5 11 27.5 13.5 27.5 21 C27.5 26.5 22.5 28.6 16 28.6 C9.5 28.6 4.5 26.5 4.5 21 Z" fill="' + c + '" stroke="' + INK + '" stroke-width="1.6"/>' +
      '<circle cx="10" cy="9.5" r="3" fill="#fff"/><circle cx="22" cy="9.5" r="3" fill="#fff"/><circle cx="10.4" cy="9.8" r="1.6" fill="' + INK + '"/><circle cx="21.6" cy="9.8" r="1.6" fill="' + INK + '"/>' +
      '<path d="M10 19.5 Q16 24.5 22 19.5" stroke="' + INK + '" stroke-width="1.5" fill="none" stroke-linecap="round"/>' +
      '<ellipse cx="8" cy="18.6" rx="1.7" ry="1.1" fill="#FF5C8A" opacity=".55"/><ellipse cx="24" cy="18.6" rx="1.7" ry="1.1" fill="#FF5C8A" opacity=".55"/>';
  }
  };
  var AV_KINDS  = ['slime', 'robot', 'cat', 'ghost', 'owl', 'dino', 'alien', 'frog'];
  var AV_COLORS = ['#FFD23F', '#45B1F5', '#FF8FB1', '#7EE0B5', '#FFB347', '#C9A2FF', '#FF6B6B'];   // KAIT-PLAY 색 (하양은 바탕에 묻혀 뺌)

  function iconSvg(i, color) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="' + color +
      '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
      ICONS[i].replace(/data-fill="1"/g, 'fill="' + color + '"') + '</svg>';
  }
  function avatarSvg(kind, color) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="96" height="96">' +
      '<ellipse cx="16" cy="29.6" rx="9" ry="1.7" fill="#000" opacity=".25"/>' + PARTS[kind](color) + '</svg>';
  }
  function bake(svg) {
    return new Promise(function (res) {
      var im = new Image();
      im.onload = function () { res(im); };
      im.onerror = function () { res(null); };
      im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  /* 고른 모양에 필요한 그림만 굽는다 */
  var SPR = { icon: [], white: [], av: [] };
  function preload() {
    var jobs = [];
    if (V === 'A') ICONS.forEach(function (_, i) {
      SPR.icon[i] = [];
      BLUES.forEach(function (c, j) { jobs.push(bake(iconSvg(i, c)).then(function (im) { SPR.icon[i][j] = im; })); });
    });
    if (V === 'C') ICONS.forEach(function (_, i) {
      jobs.push(bake(iconSvg(i, '#ffffff')).then(function (im) { SPR.white[i] = im; }));
    });
    if (V !== 'C') AV_KINDS.forEach(function (k, i) {
      SPR.av[i] = [];
      AV_COLORS.forEach(function (c, j) { jobs.push(bake(avatarSvg(k, c)).then(function (im) { SPR.av[i][j] = im; })); });
    });
    return Promise.all(jobs);
  }

  /* ── 상태 ── */
  var W = 0, H = 0, DPR = 1, box = { x: 0, w: 0 }, step = 10;
  var P = [], t0 = 0, last = 0, raf = 0, visible = true, formed = false, idleSince = 0;
  var mx = -9999, my = -9999, hopTimer = 0;
  var FONT_FAMILY = getComputedStyle(document.body).fontFamily || 'sans-serif';

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function ri(n) { return Math.floor(Math.random() * n); }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function easeIO(t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function font(px) { return '700 ' + px + 'px ' + FONT_FAMILY; }

  function layout() {
    W = hero.clientWidth; H = hero.clientHeight;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    /* 이름이 놓일 자리는 본문 폭(--w)과 같게 — 바탕은 화면 끝까지, 이름은 본문 안에 */
    var inner = document.querySelector('.top-in') || document.querySelector('.wrap');
    var r = inner ? inner.getBoundingClientRect() : { left: 0, width: W };
    var hr = hero.getBoundingClientRect();
    box = { x: r.left - hr.left + 20, w: Math.max(100, r.width - 40) };
  }

  /* 이름을 그려 보고 잉크가 묻은 칸의 가운데를 모은다 */
  function sample() {
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var g = c.getContext('2d');
    var fs = H * (small ? .62 : .58);
    g.font = font(fs);
    var m = g.measureText(NAME), maxW = box.w * .92;
    if (m.width > maxW) { fs *= maxW / m.width; g.font = font(fs); m = g.measureText(NAME); }
    var asc = m.actualBoundingBoxAscent || fs * .72, desc = m.actualBoundingBoxDescent || 0;
    var tx = box.x + box.w / 2, ty = H / 2 + (asc - desc) / 2;
    g.textAlign = 'center'; g.fillStyle = '#000';
    g.fillText(NAME, tx, ty);
    var d = g.getImageData(0, 0, W, H).data, ink = 0;
    for (var i = 3; i < d.length; i += 16) if (d[i] > 128) ink++;
    ink *= 4;

    /* 픽토그램 개수 — 모양마다, 화면이 좁거나 로그인한 뒤면 줄인다 (약한 컴퓨터를 위해 넉넉히 적게) */
    var want = { A: 560, B: 220, C: 320 }[V];
    if (W < 760) want *= .55;
    if (small) want *= .55;
    var s = Math.max(small ? 5 : 7, Math.min(30, Math.sqrt(ink / want)));
    step = s;

    /* 얇은 획이 칸 사이로 빠지지 않게 칸 크기만큼 굵혀서 다시 그린다 */
    g.clearRect(0, 0, W, H);
    g.lineJoin = 'round'; g.lineWidth = s * .6; g.strokeStyle = '#000';
    g.fillText(NAME, tx, ty); g.strokeText(NAME, tx, ty);
    d = g.getImageData(0, 0, W, H).data;
    var pts = [];
    for (var y = s / 2; y < H; y += s) for (var x = s / 2; x < W; x += s) {
      if (d[((y | 0) * W + (x | 0)) * 4 + 3] > 128) pts.push({ x: x, y: y });
    }
    return pts;
  }

  function build(startFormed) {
    layout();
    var pts = sample(), mid = box.x + box.w / 2;
    P = pts.map(function (p) {
      var side = p.x < mid ? -1 : 1;
      var q = { tx: p.x, ty: p.y, vx: 0, vy: 0, side: side, st: 'wait',
                flip: 0, flipAt: 0, lift: 0, land: 0, spin: rnd(-6, 6), hop: rnd(3, 6) };
      if (V === 'A') {
        if (Math.random() < .07) { q.t = 'av'; q.k = ri(8); q.c = ri(AV_COLORS.length); q.sz = step * 1.7; }
        else { q.t = 'ic'; q.k = ri(ICONS.length); q.c = ri(BLUES.length); q.sz = step * 1.15; }
      } else if (V === 'B') { q.t = 'av'; q.k = ri(8); q.c = ri(AV_COLORS.length); q.sz = step * 1.3; }
      else { q.t = 'tile'; q.k = ri(ICONS.length); q.c = ri(TILE.length); q.sz = step * .92; }
      /* 가까운 쪽 화면 끝 바깥에서 출발 */
      q.sx = side < 0 ? -rnd(30, 260) : W + rnd(30, 260);
      q.sy = Math.max(10, Math.min(H - 10, p.y + rnd(-H * .35, H * .35)));
      q.dur = Math.abs(q.tx - q.sx) / (V === 'B' ? rnd(.55, .8) : rnd(.8, 1.25));
      q.delay = V === 'C' ? (box.w / 2 - Math.abs(p.x - mid)) * .55 + rnd(0, 350)
                          : rnd(0, 900) + (V === 'B' ? (box.w / 2 - Math.abs(p.x - mid)) * .4 : 0);
      if (startFormed) { q.st = 'home'; q.x = q.tx; q.y = q.ty; }
      else { q.x = q.sx; q.y = q.sy; }
      return q;
    });
    t0 = performance.now();
    formed = !!startFormed;
  }

  /* ── 움직임 ── */
  function update(now, dt) {
    var f = Math.min(dt / 16.67, 3), R = Math.max(70, step * 7), busy = false, all = true;
    for (var i = 0; i < P.length; i++) {
      var p = P[i];
      if (p.st === 'wait') {
        all = false; busy = true;
        if (now - t0 < p.delay) continue;
        p.st = 'run';
      }
      if (p.st === 'run') {
        busy = true;
        var t = (now - t0 - p.delay) / p.dur;
        if (t >= 1) { p.st = 'home'; p.x = p.tx; p.y = p.ty; p.vx = 0; p.vy = V === 'C' ? 0 : -1.5; p.land = now; continue; }
        all = false;
        var bob = Math.abs(Math.sin(t * Math.PI * p.hop)) * step * (V === 'B' ? 1.6 : 1.1) * (1 - t);
        p.x = p.sx + (p.tx - p.sx) * easeOut(t);
        p.y = p.sy + (p.ty - p.sy) * easeIO(t) - (V === 'C' ? 0 : bob);
        p.prog = t;
        continue;
      }
      /* 제자리: 용수철로 돌아오고, 마우스가 가까우면 비켜난다 (C 는 뒤집힌다) */
      var ax = (p.tx - p.x) * .055, ay = (p.ty - p.y) * .055;
      var dx = p.x - mx, dy = p.y - my, d = Math.sqrt(dx * dx + dy * dy);
      if (V === 'C') {
        var near = d < R * .55;
        if (near && now - p.flipAt > 500) { p.flip = 1 - p.flip; p.flipAt = now; }
        if (p.flip && now - p.flipAt > 2600) { p.flip = 0; p.flipAt = now; }
        p.lift += ((near ? 1 : 0) - p.lift) * .2 * f;
        if (p.lift > .01 || now - p.flipAt < 300 || p.flip) busy = true;
      } else if (d < R && d > .01) {
        var k = (1 - d / R) * (V === 'B' ? 1.4 : 2.2);
        ax += dx / d * k; ay += dy / d * k;
        if (V === 'B' && p.y > p.ty - 2 && Math.random() < .05) p.vy -= 3.5;
      }
      p.vx = (p.vx + ax * f) * Math.pow(.86, f);
      p.vy = (p.vy + ay * f) * Math.pow(.86, f);
      p.x += p.vx * f; p.y += p.vy * f;
      if (Math.abs(p.vx) + Math.abs(p.vy) > .03 || Math.abs(p.x - p.tx) + Math.abs(p.y - p.ty) > .3) busy = true;
      else { p.x = p.tx; p.y = p.ty; p.vx = p.vy = 0; }
      if (now - p.land < 300) busy = true;
    }
    if (all && !formed) { formed = true; hero.classList.add('formed'); }
    return busy;
  }

  function draw(now) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (var i = 0; i < P.length; i++) {
      var p = P[i];
      if (p.st === 'wait') continue;
      var s = p.sz, rot = 0, sx = 1, sy = 1;
      if (p.st === 'run') {
        if (V === 'C') rot = p.spin * (1 - p.prog);
        else { var ph = Math.sin(p.prog * Math.PI * p.hop * 2); sx = 1 + ph * .08; sy = 1 - ph * .08; rot = p.side * -.08; }
      } else if (p.land && now - p.land < 260) {
        var sq = Math.sin((now - p.land) / 260 * Math.PI) * .18;   // 내려앉을 때 살짝 찌그러짐
        sx = 1 + sq; sy = 1 - sq;
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      if (rot) ctx.rotate(rot);
      if (p.t === 'tile') {
        /* 뒤집히는 중이면 가로로 납작해졌다가 다른 색으로 펴진다 */
        var ft = Math.min(1, (now - p.flipAt) / 280);
        var fx = p.flipAt && ft < 1 ? Math.abs(Math.cos(ft * Math.PI)) : 1;
        var face = p.flipAt && ft < .5 ? !p.flip : p.flip;
        var sc = 1 + p.lift * .22;
        ctx.scale(Math.max(.02, sx * fx * sc), sy * sc);
        ctx.fillStyle = face ? FLIP[p.c % 2] : TILE[p.c];
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-s / 2, -s / 2, s, s, s * .2); else ctx.rect(-s / 2, -s / 2, s, s);
        ctx.fill();
        var wi = SPR.white[p.k];
        if (wi && s > 9) ctx.drawImage(wi, -s * .32, -s * .32, s * .64, s * .64);
      } else {
        ctx.scale(sx, sy);
        var img = p.t === 'av' ? SPR.av[p.k][p.c] : SPR.icon[p.k][p.c];
        if (img) ctx.drawImage(img, -s / 2, -s / 2, s, s);
      }
      ctx.restore();
    }
  }

  /* 움직이는 것이 있을 때만 그린다. 다 멈추면 쉬고, 마우스 · 클릭 · 캐릭터 폴짝이 다시 깨운다 */
  function loop(now) {
    raf = 0;
    if (!visible) return;
    var dt = last ? now - last : 16; last = now;
    var busy = update(now, dt);
    draw(now);
    if (busy || mx > -9000) raf = requestAnimationFrame(loop);
  }
  function kick() { if (!raf && visible && !calm) { last = 0; raf = requestAnimationFrame(loop); } }

  /* B: 다 모인 뒤에도 가끔 한 명씩 폴짝 */
  function hopLater() {
    clearTimeout(hopTimer);
    if (V !== 'B' || calm) return;
    hopTimer = setTimeout(function () {
      if (visible && formed && P.length) {
        for (var n = 0; n < 2; n++) { var p = P[ri(P.length)]; if (p.st === 'home') p.vy -= rnd(2.5, 4); }
        kick();
      }
      hopLater();
    }, rnd(700, 1600));
  }

  /* ── 상호작용 ── */
  function pos(e) { var r = hero.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; }
  hero.addEventListener('pointermove', function (e) { pos(e); kick(); });
  hero.addEventListener('pointerleave', function () { mx = my = -9999; });
  hero.addEventListener('click', function (e) {
    if (calm) return;
    pos(e);
    var maxd = Math.max(W, H);
    P.forEach(function (p) {
      if (p.st !== 'home') return;
      var dx = p.x - mx, dy = p.y - my, d = Math.sqrt(dx * dx + dy * dy) || 1;
      var m = (1 - d / maxd) * rnd(16, 30) + 3;
      p.vx += dx / d * m + rnd(-2, 2); p.vy += dy / d * m + rnd(-2, 2);
      if (V === 'C') { p.flip = 1 - p.flip; p.flipAt = performance.now() + rnd(0, 400); }
    });
    /* 터치 화면은 손을 떼면 마우스 위치가 남지 않게 */
    if (e.pointerType === 'touch' || (window.matchMedia && matchMedia('(pointer:coarse)').matches)) {
      setTimeout(function () { mx = my = -9999; }, 60);
    }
    kick();
  });

  /* 화면 밖 · 다른 탭이면 멈춘다 */
  document.addEventListener('visibilitychange', function () { visible = !document.hidden; kick(); });
  if (window.IntersectionObserver) new IntersectionObserver(function (es) {
    visible = es[0].isIntersecting && !document.hidden; kick();
  }, { threshold: .05 }).observe(hero);

  /* 창 크기가 바뀌면 다 모인 상태로 다시 짠다 */
  var rt = 0, lastW = 0;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () {
      if (hero.clientWidth === lastW && cv.height === Math.round(hero.clientHeight * DPR)) return;
      lastW = hero.clientWidth; build(true); hero.classList.add('formed'); draw(performance.now()); kick();
    }, 150);
  });

  /* 글꼴을 다 받은 뒤에 이름을 그려야 모양이 맞다 */
  var fontReady = document.fonts && document.fonts.load
    ? Promise.race([document.fonts.load(font(100), NAME).catch(function () {}),
                    new Promise(function (r) { setTimeout(r, 1500); })])
    : Promise.resolve();

  Promise.all([preload(), fontReady]).then(function () {
    lastW = hero.clientWidth;
    /* 로그인한 뒤에는 매일 보는 화면이라 이미 모인 상태로 시작한다 */
    build(small || calm);
    hero.classList.add('live');
    if (formed) hero.classList.add('formed');
    draw(performance.now());
    kick();
    hopLater();
  });
})();
