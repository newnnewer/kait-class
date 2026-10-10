/* KAIT-PLAY — 인트로 (v0.13.0). 영상 파일 없이 화면 애니메이션으로 (약 4.5초 뒤 'PRESS ANY KEY').
 *   블록이 떨어짐 → 블록이 깨지며 KAIT-PLAY 로고 → 두 팀 캐릭터가 달려와 VS → PRESS ANY KEY
 *   CGIntro.play({ onPress: fn, onDone: fn })   아무 키 · 클릭이면 언제든 끝남 (애니메이션 중이어도 건너뜀)
 *   언제 띄울지는 부르는 쪽이 정한다 — 학생 화면: 페이지를 열 때마다(새로고침 포함, 방 · 게임으로 돌아갈 때만 빼고),
 *   교사 화면: 페이지를 열 때마다.
 *   CGIntro.active()   인트로가 떠 있는 동안 true
 * 브라우저는 키를 한 번 누르기 전에는 소리를 막으므로 애니메이션은 소리 없이 돌고,
 * onPress(키를 누른 순간 — 사용자 입력 안)에서 효과음 · 배경음을 시작한다.
 * 움직임 줄이기를 켠 컴퓨터도 전체를 보여 주되(학교 컴퓨터는 이 설정이 켜진 곳이 많음) 화면 흔들림은 빼고 번쩍임은 약하게. */
(function () {
  'use strict';
  var AV = window.CGAvatar;
  var root = null, done = null, pressCb = null, swallow = null;

  var TOKENS = ['print', 'for i', 'if', 'a = 1', 'def', 'x += 1', 'while', 'BOSS', 'input()', 'len', 'else:', 'range', 'True', 'int', '[ ]'];
  var LEFT = [['slime', '#FFD23F'], ['robot', '#45B1F5'], ['cat', '#FF8FB1'], ['ghost', '#F2F4FA']];
  var RIGHT = [['owl', '#FFB347'], ['dino', '#FF6B6B'], ['alien', '#C9A2FF'], ['frog', '#7EE0B5']];

  function h(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function build() {
    var o = h('div', 'kpi');
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-label', 'KAIT-PLAY 시작 화면 — 아무 키나 누르세요');
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) o.classList.add('calm');

    o.appendChild(h('div', 'kpi-floor'));
    var stage = h('div', 'kpi-stage');
    o.appendChild(stage);

    // ① 로고 자리: 블록 판 + 조각 + 로고
    var hero = h('div', 'kpi-hero');
    var grid = h('div', 'kpi-grid');
    var order = TOKENS.map(function (_, i) { return i; }).sort(function () { return Math.random() - 0.5; });
    TOKENS.forEach(function (t, i) {
      var b = h('div', 'kpi-block' + (t === 'BOSS' ? ' boss' : (i % 4 === 1 ? ' gold' : '')));
      b.textContent = t;
      b.style.setProperty('--d', (order[i] * 0.06).toFixed(2) + 's');
      var ang = Math.atan2(Math.floor(i / 5) - 1, (i % 5) - 2) || (Math.random() * 6.28);
      var dist = 40 + Math.random() * 30;
      b.style.setProperty('--bx', (Math.cos(ang) * dist).toFixed(1) + 'vw');
      b.style.setProperty('--by', (Math.sin(ang) * dist).toFixed(1) + 'vh');
      b.style.setProperty('--br', ((Math.random() - 0.5) * 540).toFixed(0) + 'deg');
      grid.appendChild(b);
    });
    hero.appendChild(grid);
    var shards = h('div', 'kpi-shards');
    var SH = ['#FFD23F', '#45B1F5', '#FF5C8A', '#9B5BF5', '#7EE0B5', '#fff'];
    for (var s = 0; s < 36; s++) {
      var p = h('i');
      var a = Math.random() * Math.PI * 2, r = 18 + Math.random() * 42;
      p.style.setProperty('--sx', (Math.cos(a) * r).toFixed(1) + 'vw');
      p.style.setProperty('--sy', (Math.sin(a) * r * 0.8).toFixed(1) + 'vh');
      p.style.setProperty('--sr', ((Math.random() - 0.5) * 720).toFixed(0) + 'deg');
      p.style.background = SH[s % SH.length];
      shards.appendChild(p);
    }
    hero.appendChild(shards);
    hero.appendChild(h('div', 'kpi-ring'));
    hero.appendChild(h('div', 'logo kpi-logo',
      '<svg class="lg-icon" aria-hidden="true"><use href="#kp-icon"/></svg><span class="lg-w">KAIT<i class="lg-dash"></i><span class="lg-p">PLAY</span></span>'));
    stage.appendChild(hero);
    stage.appendChild(h('div', 'kpi-tag', 'TEAM CODING BATTLE'));

    // ② 두 팀 + VS
    var vs = h('div', 'kpi-vs');
    function team(list, side) {
      var t = h('div', 'kpi-team ' + side);
      list.forEach(function (c, i) {
        var w = h('div', 'kpi-char');
        w.style.setProperty('--i', side === 'left' ? 3 - i : i); // 가운데 가까운 캐릭터가 먼저 도착
        var inner = h('div', 'kpi-bob', AV ? AV.svg(c[0], c[1]) : '');
        w.appendChild(inner);
        t.appendChild(w);
      });
      return t;
    }
    vs.appendChild(team(LEFT, 'left'));
    vs.appendChild(h('div', 'kpi-vs-mark', '<span>VS</span>'));
    vs.appendChild(team(RIGHT, 'right'));
    stage.appendChild(vs);

    // ③ PRESS ANY KEY
    stage.appendChild(h('div', 'kpi-press', '<b>PRESS ANY KEY</b><span>아무 키나 누르세요</span>'));

    o.appendChild(h('div', 'kpi-flash f1'));
    o.appendChild(h('div', 'kpi-flash f2'));
    return o;
  }

  function finish(ev) {
    if (!root) return;
    if (root.classList.contains('out')) { e.preventDefault(); e.stopPropagation(); return; } // 사라지는 0.4초 동안도 막음
    if (ev) {
      // 이 키가 아래 화면(입장하기 버튼 등)에 닿지 않게
      if (ev.cancelable) ev.preventDefault();
      ev.stopPropagation();
      if (ev.type === 'keydown') swallow = ev.code || ev.key;
    }
    root.classList.add('out');
    var cb = pressCb; pressCb = null;
    try { if (cb) cb(); } catch (e) { /* 소리는 없어도 된다 */ }
    var r = root;
    setTimeout(function () {
      if (r.parentNode) r.parentNode.removeChild(r);
      if (root === r) root = null;
      var d = done; done = null;
      if (d) d();
    }, 380);
  }

  function onKey(e) {
    if (!root) return;
    if (root.classList.contains('out')) { e.preventDefault(); e.stopPropagation(); return; } // 사라지는 0.4초 동안도 막음
    if (e.repeat) { e.preventDefault(); e.stopPropagation(); return; }
    finish(e);
  }
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', function (e) {
    if (swallow && (e.code || e.key) === swallow) { e.preventDefault(); e.stopPropagation(); swallow = null; }
  }, true);

  window.CGIntro = {
    active: function () { return !!root && !root.classList.contains('out'); },
    play: function (opt) {
      opt = opt || {};
      if (root) return;
      pressCb = opt.onPress || null;
      done = opt.onDone || null;
      root = build();
      root.addEventListener('click', finish);
      root.addEventListener('touchend', finish);
      document.body.appendChild(root);
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    },
    skip: function () { finish(); }
  };
})();
