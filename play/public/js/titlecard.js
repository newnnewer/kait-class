/* KAIT-PLAY 1.1.0 — 게임마다 얼굴 · 로비 포스터의 작은 맵 · 게임 시작 장면 (css/titlecard.css 와 짝)
 *   CGTitle.icon(game)              3 × 3 블록 아이콘 <span class="gicon rush|flip"> (같은 무늬, 색만 다름)
 *   CGTitle.pill(el, game, text)    게임 이름표 (아이콘 + 글자) — 대기실 · 게임 위쪽 · 공식전 팀 고르기 · 전광판
 *   CGTitle.mini(box, game, isOn)   로비 포스터의 움직이는 작은 맵 (isOn() 이 false 면 쉰다 — 로비가 안 보일 때)
 *   CGTitle.play(game, opt)         시작 장면 약 2초 (opt.names: [빨강, 파랑] — 플립 배틀 VS · opt.onDone)
 *                                   아무 키 · 클릭이면 바로 넘어감 (그 키는 아래 화면에 닿지 않음). CGTitle.active() 떠 있는 동안 true
 * 시작 장면은 게임 시작 카운트다운(5초)의 앞부분 위에 뜬다 — 게임이 시작되는 시각은 그대로. */
(function () {
  'use strict';
  var PAT = ['a', 'a', 'b', 'b', 'a', 'b', 'a', 'b', 'a'];
  var WIN = { rush: '맵을 먼저 다 깨는 팀이 이겨요!', flip: '끝났을 때 우리 색 블록이 많은 팀이 이겨요!' };
  var NAME = { rush: '블록 러시', flip: '플립 배틀' };

  function h(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function g(game) { return game === 'flip' ? 'flip' : 'rush'; }

  function icon(game) {
    var s = h('span', 'gicon ' + g(game));
    s.setAttribute('aria-hidden', 'true');
    PAT.forEach(function (k) { s.appendChild(h('i', k)); });
    return s;
  }

  function pill(el, game, text) {
    if (!el) return;
    el.classList.remove('rush', 'flip', 'green', 'blue');
    el.classList.add('gpill', g(game));
    el.innerHTML = '';
    el.appendChild(icon(game));
    el.appendChild(document.createTextNode(text));
  }

  // ── 로비 포스터의 작은 맵 ──
  function mini(box, game, isOn) {
    if (!box || box._mini) return;
    box._mini = true;
    isOn = isOn || function () { return true; };
    if (g(game) === 'rush') {
      var stamp = h('span', 'stamp', 'CLEAR!'), cells = [];
      for (var k = 0; k < 21; k++) { var c = h('i'); box.appendChild(c); cells.push(c); }
      box.appendChild(stamp);
      var left = [], hold = 0;
      var reset = function () { cells.forEach(function (x) { x.className = ''; }); stamp.classList.remove('on'); left = cells.slice(); };
      reset();
      setInterval(function () {
        if (!isOn()) return;
        if (hold) { hold -= 1; if (!hold) reset(); return; }
        if (!left.length) { stamp.classList.add('on'); hold = 9; return; } // CLEAR! 를 1.5초쯤 보여 주고 처음부터
        left.splice(Math.floor(Math.random() * left.length), 1)[0].className = 'x';
      }, 170);
      return;
    }
    var fc = [];
    for (var j = 0; j < 24; j++) { var d = h('i', j < 12 ? 'r' : 'b'); fc.push(d); }
    fc.sort(function () { return Math.random() - 0.5; }).forEach(function (x) { box.appendChild(x); });
    var tick = 0;
    setInterval(function () {
      if (!isOn()) return;
      tick += 1;
      var c = fc[Math.floor(Math.random() * fc.length)];
      if (!c.classList.contains('g')) {
        var toR = Math.sin(tick / 12) > 0 ? Math.random() < 0.65 : Math.random() < 0.35; // 밀고 밀리기
        c.className = (toR ? 'r' : 'b') + ' f';
      }
      if (tick % 23 === 0) { // 가끔 🎁
        var gi = fc[Math.floor(Math.random() * fc.length)];
        gi.className = 'g f';
        setTimeout(function () { gi.className = (Math.random() < 0.5 ? 'r' : 'b') + ' f'; }, 1600);
      }
    }, 140);
  }

  // ── 시작 장면 ──
  var root = null, timers = [], doneCb = null;
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function active() { return !!root; }
  function finish() {
    timers.forEach(clearTimeout); timers = [];
    if (root) { root.remove(); root = null; }
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onKey, true);
    var cb = doneCb; doneCb = null;
    if (cb) cb();
  }
  function onKey(e) { e.preventDefault(); e.stopPropagation(); finish(); }

  function letters(word, cls) {
    var row = h('div', 'letters'), spans = [];
    for (var i = 0; i < word.length; i++) {
      var ch = word[i], s = h('span', ch === ' ' ? 'sp' : (cls ? cls(i) : ''), ch === ' ' ? '' : ch);
      row.appendChild(s);
      if (ch !== ' ') spans.push(s);
    }
    return { row: row, spans: spans };
  }

  function shards(box, el, blue) {
    var r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
    for (var k = 0; k < 5; k++) {
      var s = h('i', 'shard' + (blue && k % 2 ? ' b' : ''));
      s.style.left = (r.left - b.left + r.width / 2) + 'px';
      s.style.top = (r.top - b.top + r.height / 2) + 'px';
      s.style.setProperty('--dx', (Math.random() * 200 - 100) + 'px');
      s.style.setProperty('--dy', (Math.random() * 200 - 130) + 'px');
      box.appendChild(s);
    }
  }

  function play(game, opt) {
    opt = opt || {};
    if (root) finish();
    game = g(game);
    doneCb = opt.onDone || null;
    root = h('div', 'gtc ' + game);
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) root.classList.add('calm');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', NAME[game] + ' 시작');
    var center = h('div', 'center'), ko = h('div', 'ko', NAME[game]), win = h('div', 'win', WIN[game]);
    if (game === 'rush') {
      // 파랑 글자 블록이 차례로 떨어진다 → 쿵 → 하나씩 깨지며 노란 글자
      var L = letters('BLOCK RUSH');
      center.appendChild(L.row); center.appendChild(ko); center.appendChild(win);
      root.appendChild(center);
      L.spans.forEach(function (s, i) { later(function () { s.classList.add('drop'); }, 40 + i * 45); });
      later(function () { root.classList.add('shake'); }, 40 + L.spans.length * 45 + 380);
      L.spans.forEach(function (s, i) {
        later(function () { shards(root, s, true); s.classList.add('open'); }, 900 + i * 50);
      });
      later(function () { ko.classList.add('on'); }, 1250);
      later(function () { win.classList.add('on'); }, 1400);
    } else {
      var r = h('div', 'half r'), b = h('div', 'half b'), fl = h('div', 'flash');
      root.appendChild(r); root.appendChild(b); root.appendChild(fl);
      later(function () { r.classList.add('go'); b.classList.add('go'); }, 60);
      later(function () { fl.classList.add('on'); root.classList.add('shake'); }, 420);
      var F = letters('FLIP BATTLE', function (i) { return i < 4 ? 'r' : 'b'; });
      var names = opt.names || [];
      var vs = h('div', 'vs');
      vs.appendChild(h('b', null)); vs.appendChild(h('span', 'v', 'VS')); vs.appendChild(h('b', null));
      vs.children[0].textContent = names[0] || '빨강';
      vs.children[2].textContent = names[1] || '파랑';
      center.appendChild(F.row); center.appendChild(vs); center.appendChild(win);
      root.appendChild(center);
      F.spans.forEach(function (s, i) { later(function () { s.classList.add('on'); }, 520 + i * 55); });
      later(function () { vs.classList.add('on'); }, 1150);
      later(function () { win.classList.add('on'); }, 1350);
    }
    root.appendChild(h('div', 'hint', '아무 키나 누르면 넘어가요'));
    document.body.appendChild(root);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onKey, true);
    later(function () { if (root) root.classList.add('out'); }, 2150);
    later(finish, 2500);
  }

  window.CGTitle = { icon: icon, pill: pill, mini: mini, play: play, active: active, NAME: NAME, WIN: WIN };
})();
