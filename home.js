/* ═══════════════════════════════════════════════
   home.js — 테마(아케이드 · 터미널) 첫 화면의 배경 움직임 (2.0.0)

   home_theme.php 가 '첫 화면 연출'을 켠 사이트에서만 불러온다 (운영 > 설정).
   <section id="thome"> 안의 <canvas> 에 그린다. 어느 그림인지는 <html data-theme> 로 정한다.

     아케이드  코드 기호가 적힌 블록이 천천히 떠오르고, KAIT-PLAY 캐릭터가 바닥을 지나간다
     터미널    초록 글자가 줄지어 흘러내리고, (영문 이름이면) 사이트 이름을 # 로 쌓아 그리고, 소개글을 한 글자씩 친다

   · 컴퓨터의 '움직임 줄이기' 설정과 상관없이 움직인다 (KAIT-PLAY 인트로와 같게 — 사용자 결정).
     멈추려면 운영 > 설정의 '첫 화면 연출'을 끈다.
   · 다른 탭에 있거나 화면 밖이면 그리지 않는다. 터미널은 초당 15번쯤만 그린다 (글자가 칸 단위로 움직여 충분).
   · 캐릭터 그림은 hero.js 와 같은 것 (play/public/js/avatar.js 의 PARTS). 모양을 바꾸면 세 곳 모두.
   ═══════════════════════════════════════════════ */
(function () {
  'use strict';
  var home = document.getElementById('thome');
  if (!home) return;
  var cv = home.querySelector('canvas');
  var ctx = cv && cv.getContext && cv.getContext('2d');
  var theme = document.documentElement.getAttribute('data-theme');
  var half = home.classList.contains('half');

  /* ── 공통: 캔버스 크기 맞추기 · 그리기 되풀이 ── */
  var S = { w: 0, h: 0 }, seen = true;
  function fit() {
    var r = cv.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.max(1, Math.round(r.width * d)); cv.height = Math.max(1, Math.round(r.height * d));
    ctx.setTransform(d, 0, 0, d, 0, 0); S.w = r.width; S.h = r.height;
  }
  function run(setup, draw, fps) {
    var last = performance.now(), gap = fps ? 1000 / fps : 0;
    function size() { fit(); setup(); draw(0, last / 1000); }
    function tick(now) {
      requestAnimationFrame(tick);
      if (document.hidden || !seen) { last = now; return; }
      if (now - last < gap) return;
      var dt = Math.min(.1, (now - last) / 1000); last = now;
      draw(dt, now / 1000);
    }
    size();
    var rz = 0; window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(size, 120); });
    if ('IntersectionObserver' in window) new IntersectionObserver(function (e) { seen = e[0].isIntersecting; }).observe(home);
    requestAnimationFrame(tick);
  }

  /* ════ 아케이드 ════ */
  function arcade() {
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
  function avatarSvg(kind, color) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="96" height="96">' +
      '<ellipse cx="16" cy="29.6" rx="9" ry="1.7" fill="#000" opacity=".25"/>' + PARTS[kind](color) + '</svg>';
  }
    function img(svg) { var im = new Image(); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); return im; }
    var AV = AV_KINDS.map(function (k, i) { return img(avatarSvg(k, AV_COLORS[i % AV_COLORS.length])); });
    var SYM = ['{ }', '< >', '( )', '#', '==', '+=', '[ ]', 'if', 'for', '"a"', '%', '//'];
    var COL = ['#FFD23F', '#8EE3B0', '#8ECBFF', '#FFB37A', '#D7B8FF', '#FF9FB0', '#A6F0EC'];
    var K = '#16163A', B = [], W = [];
    function rr(x, y, w, h, r) {
      ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
    run(function () {
      B = []; W = [];
      var narrow = S.w < 760, n = Math.round(S.w / (half ? 62 : 46));
      for (var i = 0; i < n; i++) {
        var u = Math.pow(Math.random(), .62);                    /* 오른쪽에 더 많이 — 왼쪽의 글을 덜 가리게 */
        B.push({ x: S.w * (narrow ? Math.random() : (half ? .66 : .50) + (half ? .38 : .54) * u), y: Math.random() * (S.h + 120),
                 s: 38 + Math.random() * 54, c: COL[i % COL.length], t: SYM[i % SYM.length],
                 v: 9 + Math.random() * 16, ph: Math.random() * 6.3, far: narrow || Math.random() < .4 });
      }
      B.sort(function (a, b) { return a.far === b.far ? 0 : a.far ? -1 : 1; });   /* 먼 것부터 그린다 */
      var m = Math.max(4, Math.round(S.w / 150));
      for (var j = 0; j < m; j++) W.push({ x: (S.w / m) * j + Math.random() * 40, k: j % AV.length, ph: Math.random() * 6.3, v: 34 + Math.random() * 14 });
    }, function (dt, t) {
      ctx.clearRect(0, 0, S.w, S.h);
      B.forEach(function (b) {
        b.y -= b.v * dt * (b.far ? .55 : 1); if (b.y < -b.s - 20) b.y = S.h + b.s;
        var s = b.s * (b.far ? .62 : 1), x = b.x + Math.sin(t * .5 + b.ph) * 10;
        ctx.save(); ctx.translate(x, b.y); ctx.rotate(Math.sin(t * .35 + b.ph) * .16); ctx.globalAlpha = b.far ? .45 : 1;
        rr(-s / 2 + 5, -s / 2 + 5, s, s, s * .2); ctx.fillStyle = K; ctx.fill();              /* 딱 떨어지는 그림자 */
        rr(-s / 2, -s / 2, s, s, s * .2); ctx.fillStyle = b.c; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = K; ctx.stroke();
        ctx.fillStyle = K; ctx.font = '700 ' + Math.round(s * .34) + 'px Consolas,"D2Coding",monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(b.t, 0, 1);
        ctx.restore();
      });
      /* 바닥과 그 위를 지나가는 캐릭터 */
      var gy = S.h - (half ? 62 : 84);
      ctx.fillStyle = K; ctx.fillRect(0, gy + 44, S.w, 4);
      ctx.fillStyle = '#FFD23F'; ctx.fillRect(0, gy + 48, S.w, S.h - gy - 48);
      ctx.fillStyle = 'rgba(22,22,58,.16)';
      for (var k = -40 + ((t * 30) % 40); k < S.w; k += 40) ctx.fillRect(k, gy + 56, 18, 6);
      W.forEach(function (w) {
        w.x += w.v * dt; if (w.x > S.w + 40) w.x = -60;
        var im = AV[w.k];
        if (im.complete && im.naturalWidth) ctx.drawImage(im, w.x, gy - 4 - Math.abs(Math.sin(t * 5 + w.ph)) * 9, 52, 52);
      });
    });
  }

  /* ════ 터미널 ════ */
  function terminal() {
    var CH = '01{}[]()<>=+-*/#$_;:ifelseforwhiledefprintinputrangeint'.split('');
    var drops = [], step = 17;
    /* 화면을 매번 새로 그린다 — 줄기마다 머리에서 꼬리로 갈수록 옅어지는 글자 줄.
       칸마다 글자가 정해져 있어 지나가는 동안 바뀌지 않는다(반짝이지 않는다). */
    run(function () {
      drops = [];
      for (var x = 0, i = 0; x < S.w; x += step, i++) for (var k = 0; k < 2; k++)
        drops.push({ x: x, i: i, y: Math.random() * (S.h + 500) - 250, v: 22 + Math.random() * 38, len: 12 + ((Math.random() * 16) | 0), a: i % 7 === 0 });
    }, function (dt) {
      ctx.fillStyle = '#0A0E0B'; ctx.fillRect(0, 0, S.w, S.h);
      ctx.font = '14px Consolas,"D2Coding",monospace'; ctx.textBaseline = 'top';
      drops.forEach(function (d) {
        d.y += d.v * dt; if (d.y - d.len * step > S.h) { d.y = -Math.random() * 200; d.v = 22 + Math.random() * 38; }
        var head = Math.floor(d.y / step);
        ctx.fillStyle = d.a ? '#F2B84B' : '#5BE37D';
        for (var n = 0; n < d.len; n++) {
          var row = head - n; if (row < 0 || row * step > S.h) continue;
          ctx.globalAlpha = n === 0 ? .78 : .5 * (1 - n / d.len);
          ctx.fillText(CH[(d.i * 13 + row * 7) % CH.length], d.x, row * step);
        }
      });
      ctx.globalAlpha = 1;
    }, 15);
  }
  /* 사이트 이름을 # 로 쌓아 만든 그림. 이름을 그려 보고 잉크가 묻은 칸만 채운다 — 한글 · 긴 이름도 된다 */
  function termLogo() {
    var pre = home.querySelector('pre.tlogo'), name = String(window.SITE_NAME || '');
    if (!pre || !name) return;
    /* 영문 · 숫자로 된 짧은 이름만 — 한글은 획이 많아 이 크기의 글자 그림으로는 알아볼 수 없다 (이름은 위쪽 메뉴에 있다) */
    if (!/^[\x20-\x7E]{1,14}$/.test(name)) return;
    var rows = 9, c = document.createElement('canvas'), g = c.getContext('2d'), fs = 40;
    var font = '900 ' + fs + 'px "Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';
    g.font = font; var w = Math.ceil(g.measureText(name).width) + 8;
    c.width = w; c.height = fs + 10; g.font = font; g.textBaseline = 'top'; g.fillText(name, 4, 4);
    var d = g.getImageData(0, 0, c.width, c.height).data, cell = c.height / rows, out = [], cols = 0;
    for (var r = 0; r < rows; r++) {
      var line = '';
      for (var x = 0; x < w / (cell * .5); x++) {
        var px = Math.floor(x * cell * .5 + cell * .25), py = Math.floor(r * cell + cell * .5);
        line += d[(py * c.width + px) * 4 + 3] > 110 ? '#' : ' ';
      }
      line = line.replace(/\s+$/, ''); cols = Math.max(cols, line.length); out.push(line);
    }
    while (out.length && !out[0]) out.shift();
    while (out.length && !out[out.length - 1]) out.pop();
    pre.textContent = out.join('\n');
    /* 긴 이름은 글자를 줄여 한 줄 폭에 맞춘다 (고정폭 글자 하나의 폭은 글자 크기의 절반 남짓) */
    var room = pre.parentNode.clientWidth - 40;
    if (cols) pre.style.fontSize = Math.max(5, Math.min(13, Math.floor(room / cols / .58))) + 'px';
  }
  /* 소개글을 한 글자씩 */
  function termType() {
    var el = home.querySelector('.tmsg-t'); if (!el) return;
    var s = el.textContent, i = 0; el.textContent = '';
    var id = setInterval(function () { el.textContent = s.slice(0, ++i); if (i >= s.length) clearInterval(id); }, 55);
  }

  if (theme === 'terminal') { termLogo(); termType(); }
  if (!ctx) return;
  if (theme === 'arcade') arcade();
  else if (theme === 'terminal') terminal();
})();
