/* KAIT-PLAY — 전광판 (프로젝터용). 교사가 로그인한 브라우저에서만 열린다. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var AV = window.CGAvatar;
  var BASE = location.pathname.replace(/\/board\/?$/, '');
  var CODE = (new URLSearchParams(location.search).get('code') || '').replace(/[^0-9]/g, '');
  var ADDR = location.origin + BASE + '/';
  var key = null;
  try { key = localStorage.getItem('kp.admin'); } catch (e) { key = null; }

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function av(p) { var s = el('span', 'av' + (p.bot ? ' bot' : '')); s.innerHTML = AV.svg(p.kind, p.color); s.title = p.nick; return s; }
  function mmss(ms) { var t = Math.max(0, Math.ceil(ms / 1000)), m = Math.floor(t / 60), s = t % 60; return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s; }
  function msg(title, text) { $('sb-msg-title').textContent = title; $('sb-msg-text').textContent = text; $('sb-msg').hidden = false; }

  // ── 무대 크기: 1920×1080 을 창에 맞춘다 ──
  function fit() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    var st = $('stage');
    st.style.transform = 'scale(' + s + ')';
    st.style.left = ((window.innerWidth - 1920 * s) / 2) + 'px';
    st.style.top = ((window.innerHeight - 1080 * s) / 2) + 'px';
  }
  window.addEventListener('resize', function () { fit(); sizeMinis(); });
  fit();

  if (!CODE) { msg('전광판', '교사 화면의 "전광판 열기" 버튼으로 열어 주세요.'); return; }
  if (!key) { msg('로그인이 필요해요', '이 브라우저에서 먼저 교사 화면에 로그인한 뒤 "전광판 열기"를 눌러 주세요.'); return; }

  var socket = io({ path: BASE + '/socket.io', transports: ['polling', 'websocket'] });
  var B = null, gotAt = 0;

  // ── 소리 (6-2): 브라우저는 한 번 누르기 전에는 소리를 못 낸다 → '소리 켜기' 버튼 ──
  var SND = window.CGSound, soundOn = false, lastTick = 0;
  SND.setVolume(1.2); // 교실 스피커용 (v0.12.0: 0.6 → 1.2)
  function renderSound() {
    var b = $('sb-sound');
    b.textContent = soundOn ? '🔊 소리 켜짐' : '🔈 소리 켜기';
    b.setAttribute('aria-pressed', String(soundOn));
  }
  $('sb-sound').onclick = function () {
    soundOn = !soundOn;
    SND.unlock();
    renderSound();
    if (soundOn) SND.play('start');
    syncBgm();
    this.blur();
  };
  function play(name) { if (soundOn) SND.play(name); }
  // 배경음: 게임 중 · 멈추지 않았을 때 · 교사가 켜 둔 경우만. 마지막 30초는 빠르게
  function syncBgm() {
    if (!B) return;
    var left = B.remainMs - (Date.now() - gotAt);
    SND.bgm(soundOn && B.bgm && B.phase === 'playing' && !B.paused, left < 30000);
  }
  setInterval(syncBgm, 1000);

  socket.on('connect', function () {
    $('sb-msg').hidden = true;
    socket.emit('admin:hello', { key: key }, function (res) {
      if (!res || !res.ok) { msg('로그인이 풀렸어요', '교사 화면에서 다시 로그인한 뒤 "전광판 열기"를 눌러 주세요.'); return; }
      socket.emit('board:watch', { code: CODE }, function (r) {
        if (!r || !r.ok) { msg('수업 게임이 없어요', (r && r.error) || '코드를 확인해 주세요'); return; }
        update(r.board);
      });
    });
  });
  socket.on('disconnect', function () { setTimeout(function () { if (!socket.connected) msg('서버와 연결이 끊겼어요', '다시 연결하는 중…'); }, 2000); });
  socket.on('board', update);
  socket.on('teach:closed', function () { msg('수업이 끝났어요', '선생님이 수업 게임을 끝냈어요. 이 창을 닫아도 돼요.'); });

  // ── 소식 줄 · 공격 띠 ──
  var feed = [];
  function addFeed(f) {
    feed.unshift(f);
    feed = feed.slice(0, 8);
    var box = $('sb-feed');
    box.innerHTML = '';
    feed.forEach(function (x) { box.appendChild(el('span', x.kind || '', x.text)); });
  }
  socket.on('board:feed', addFeed);

  var bandTimer = null;
  function band(kind, label, main, sub, ms) {
    var b = $('sb-band');
    b.className = 'sb-band ' + (kind || '');
    $('sb-band-kind').textContent = label;
    $('sb-band-main').textContent = main;
    $('sb-band-sub').textContent = sub || '';
    clearTimeout(bandTimer);
    if (ms) bandTimer = setTimeout(function () { band('', 'BATTLE', '보스를 잡아 아이템을 얻으세요!', ''); }, ms);
  }
  socket.on('board:attack', function (a) {
    play(a.blocked ? 'shield' : 'hit');
    if (a.blocked) {
      band('blocked', 'SHIELD', a.from + '조 ' + a.name + ' → ' + a.to + '조 방패로 막음!', '', 4000);
      addFeed({ text: a.from + '조 → ' + a.to + '조 ' + a.name + ' (막힘)', kind: 'info' });
    } else {
      band('attack', 'ATTACK', a.from + '조 → ' + a.to + '조 ' + a.name + '!', a.to + '조 ' + a.desc, 4500);
      addFeed({ text: a.from + '조 → ' + a.to + '조 ' + a.name + '!', kind: 'attack' });
    }
  });
  socket.on('board:feed', function (f) {
    if (f.kind === 'clear') { band('clear', 'CLEAR', f.text, '', 4500); play('clear'); }
  });

  // ── 화면 그리기 ──
  function update(b) {
    var before = B && B.phase;
    B = b; gotAt = Date.now();
    if (before && before !== b.phase) play(b.phase === 'playing' ? 'start' : 'end');
    // v0.12.0: 새 판이 시작되면 지난 판의 전장 소식을 비운다
    if (b.phase === 'playing' && before !== 'playing') { feed = []; $('sb-feed').innerHTML = ''; }
    syncBgm();
    $('sb-join').innerHTML = '';
    $('sb-join').appendChild(document.createTextNode('접속 '));
    $('sb-join').appendChild(el('b', null, ADDR.replace(/^https?:\/\//, '')));
    $('sb-join').appendChild(document.createTextNode(' · 수업 게임 코드 '));
    $('sb-join').appendChild(el('b', 'code', b.code));
    var at = $('sb-attacks');
    at.textContent = '방해 아이템 ' + (b.attacks ? 'ON' : 'OFF');
    at.classList.toggle('off', !b.attacks);
    $('sb-paused').hidden = !b.paused;
    var playing = b.phase === 'playing';
    $('sb-wait').hidden = playing;
    $('sb-play').hidden = !playing;
    if (playing) renderPlay(b); else renderWait(b);
    tick();
  }

  function renderWait(b) {
    $('sb-addr').textContent = ADDR.replace(/^https?:\/\//, '');
    $('sb-code').textContent = b.code;
    $('sb-time-label').textContent = '제한 시간';
    var list = $('sb-teamlist');
    list.innerHTML = '';
    b.teams.forEach(function (t) {
      var c = el('div', 'sb-tl');
      var h = el('div', 'sb-tl-head');
      h.appendChild(el('b', null, t.no + '조'));
      var nb = t.members.filter(function (p) { return p.bot; }).length;
      h.appendChild(el('span', null, t.members.length + '명' + (nb ? ' (봇 ' + nb + ')' : '')));
      c.appendChild(h);
      var a = el('div', 'sb-avs');
      t.members.forEach(function (p) { a.appendChild(av(p)); });
      c.appendChild(a);
      list.appendChild(c);
    });
    list.style.gridTemplateColumns = 'repeat(' + (b.teams.length > 4 ? 2 : Math.min(2, b.teams.length)) + ', minmax(0, 1fr))';
    var r = b.result;
    $('sb-result').hidden = !r;
    if (r) {
      $('sb-result-title').textContent = '지난 판 결과';
      var ol = $('sb-result-list');
      ol.innerHTML = '';
      r.teams.forEach(function (t) {
        var li = el('li', t.rank === 1 ? 'first' : '');
        li.appendChild(el('span', 'rk', t.rank + '위'));
        li.appendChild(el('b', null, t.no + '조'));
        li.appendChild(el('span', null, t.clear ? '완성 ' + mmss(t.ms) : '해결률 ' + t.pct + '%'));
        ol.appendChild(li);
      });
    }
  }

  // ── 보기 방식 (v0.12.0): 판 모양(기본) / 막대그래프 — 이 브라우저에 기억 ──
  var view = 'grid';
  try { if (localStorage.getItem('kp.boardView') === 'bars') view = 'bars'; } catch (e) { /* 저장 못 해도 됨 */ }
  function setView(v) {
    view = v;
    try { localStorage.setItem('kp.boardView', v); } catch (e) { /* 저장 못 해도 됨 */ }
    $('sb-view').textContent = v === 'bars' ? '🧩 판으로 보기' : '📊 막대그래프로 보기';
    if (B && B.phase === 'playing') renderPlay(B);
  }
  $('sb-view').onclick = function () { setView(view === 'bars' ? 'grid' : 'bars'); this.blur(); };
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'b' || e.key === 'B') && !e.ctrlKey && !e.metaKey && !e.altKey) setView(view === 'bars' ? 'grid' : 'bars');
  });
  setView(view);

  var bars = {}; // 조 번호 → 막대 한 줄
  function renderBars(teams) {
    var box = $('sb-bars');
    var seen = {};
    teams.forEach(function (t, k) {
      seen[t.no] = 1;
      var r = bars[t.no];
      if (!r) {
        r = bars[t.no] = el('div', 'sb-brow');
        r.setAttribute('role', 'listitem');
        r.innerHTML = '<span class="sb-rank"></span><b class="sb-bname"></b><div class="sb-btrack"><i class="sb-bfill"></i></div>' +
          '<span class="sb-bval"></span><div class="sb-bmeta"><span class="sb-bchips"></span><span class="sb-bcount"></span></div>';
        box.appendChild(r);
      }
      r.style.order = k;
      r.classList.toggle('first', k === 0);
      r.classList.toggle('done', !!t.rank);
      r.querySelector('.sb-rank').textContent = t.rank ? t.rank : k + 1;
      r.querySelector('.sb-bname').textContent = t.no + '조';
      r.querySelector('.sb-bfill').style.width = Math.max(t.pct, 0.5) + '%';
      r.querySelector('.sb-bval').textContent = t.rank ? 'CLEAR ' + mmss(t.ms) : t.pct + '%';
      var fx = t.fx || {}, chips = [];
      if (t.cells && t.cells.indexOf('B') >= 0) chips.push(['c-boss', '보스']);
      if (fx.freeze > 0) chips.push(['c-ice', '얼음 ' + Math.ceil(fx.freeze / 1000)]);
      if (fx.cloud > 0) chips.push(['c-cloud', '먹구름 ' + Math.ceil(fx.cloud / 1000)]);
      if (fx.confuse > 0) chips.push(['c-flip', '방향 반전 ' + Math.ceil(fx.confuse / 1000)]);
      if (t.shields) chips.push(['c-shield', '방패 ×' + t.shields]);
      var cb = r.querySelector('.sb-bchips');
      cb.innerHTML = '';
      chips.forEach(function (c) { cb.appendChild(el('span', c[0], c[1])); });
      r.querySelector('.sb-bcount').textContent = t.solved + ' / ' + t.total + '블록 · ' + t.members.length + '명';
    });
    Object.keys(bars).forEach(function (no) { if (!seen[no]) { bars[no].remove(); delete bars[no]; } });
    box.style.setProperty('--rows', Math.max(1, teams.length));
  }

  var cards = {}; // 조 번호 → { el, mini, cells }
  function renderPlay(b) {
    $('sb-time-label').textContent = '남은 시간';
    var teams = b.teams.filter(function (t) { return t.cells; });
    teams.sort(function (a, c) {
      if (a.rank && c.rank) return a.rank - c.rank;
      if (a.rank) return -1;
      if (c.rank) return 1;
      return c.pct - a.pct || c.solved - a.solved || a.no - c.no;
    });
    var asBars = view === 'bars';
    $('sb-bars').hidden = !asBars;
    $('sb-grid').hidden = asBars;
    if (asBars) { renderBars(teams); return; }
    var grid = $('sb-grid');
    var n = teams.length, cols = n <= 4 ? Math.max(1, n) : Math.ceil(n / 2), rows = n <= 4 ? 1 : 2;
    grid.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';
    grid.style.gridTemplateRows = 'repeat(' + rows + ', minmax(0, 1fr))';
    var seen = {};
    teams.forEach(function (t, k) {
      seen[t.no] = 1;
      var c = cards[t.no];
      if (!c) { c = cards[t.no] = makeCard(); grid.appendChild(c.el); }
      c.el.style.order = k;
      fillCard(c, t, k);
    });
    Object.keys(cards).forEach(function (no) { if (!seen[no]) { cards[no].el.remove(); delete cards[no]; } });
    sizeMinis();
  }

  function makeCard() {
    var e = el('section', 'sb-card');
    e.innerHTML = '<div class="sb-card-head"><span class="sb-rank"></span><span class="sb-name"></span><span class="sb-pct"></span></div>' +
      '<div class="sb-bar"><b></b></div><div class="sb-mini-wrap"><div class="sb-mini"></div><div class="sb-over" hidden><b></b><span></span></div></div>' +
      '<div class="sb-card-foot"></div><div class="sb-chips"></div>';
    return { el: e, mini: e.querySelector('.sb-mini'), wrap: e.querySelector('.sb-mini-wrap'), over: e.querySelector('.sb-over'), cells: '' };
  }

  function fillCard(c, t, k) {
    var e = c.el;
    e.classList.toggle('first', k === 0);
    e.querySelector('.sb-rank').textContent = t.rank ? t.rank : k + 1;
    e.querySelector('.sb-name').textContent = t.no + '조';
    var pct = e.querySelector('.sb-pct');
    pct.textContent = t.pct + '%';
    pct.classList.toggle('done', !!t.rank);
    var bar = e.querySelector('.sb-bar b');
    bar.style.width = t.pct + '%';
    bar.classList.toggle('done', !!t.rank);
    // 작은 판: 바뀐 칸만 고친다
    if (c.mini.children.length !== t.cells.length) {
      c.mini.innerHTML = '';
      for (var i = 0; i < t.cells.length; i++) c.mini.appendChild(document.createElement('i'));
      c.cells = '';
      c.rows = Math.ceil(t.cells.length / 12);
    }
    for (var j = 0; j < t.cells.length; j++) {
      if (c.cells[j] !== t.cells[j]) c.mini.children[j].className = t.cells[j] === '0' ? '' : 's' + t.cells[j];
    }
    c.cells = t.cells;
    // 가림막: 완성 > 얼음 > 먹구름 > (시간이 끝나 멈춘 조)
    var fx = t.fx || {};
    var over = null;
    if (t.rank) over = ['clear', 'CLEAR!', '기록 ' + mmss(t.ms)];
    else if (t.done) over = ['over', '끝', '해결률 ' + t.pct + '%'];
    else if (fx.freeze > 0) over = ['ice', '얼음!', Math.ceil(fx.freeze / 1000) + '초'];
    else if (fx.cloud > 0) over = ['cloud', '먹구름', Math.ceil(fx.cloud / 1000) + '초'];
    c.over.hidden = !over;
    if (over) { c.over.className = 'sb-over ' + over[0]; c.over.querySelector('b').textContent = over[1]; c.over.querySelector('span').textContent = over[2]; }
    // 조원
    var foot = e.querySelector('.sb-card-foot');
    foot.innerHTML = '';
    t.members.slice(0, 10).forEach(function (p) { foot.appendChild(av(p)); });
    foot.appendChild(el('span', 'muted', t.members.length + '명 · ' + t.total + '블록'));
    // 효과 표시
    var chips = e.querySelector('.sb-chips');
    chips.innerHTML = '';
    function chip(cls, text) { chips.appendChild(el('span', cls, text)); }
    if (t.rank) chip('c-good', t.rank + '위 확정');
    if (t.cells.indexOf('B') >= 0) chip('c-boss', '보스 출현');
    if (fx.freeze > 0) chip('c-ice', '얼음 ' + Math.ceil(fx.freeze / 1000) + '초');
    if (fx.cloud > 0) chip('c-cloud', '먹구름 ' + Math.ceil(fx.cloud / 1000) + '초');
    if (fx.confuse > 0) chip('c-flip', '방향 반전 ' + Math.ceil(fx.confuse / 1000) + '초');
    if (fx.auto > 0) chip('c-good', '자동완성 ' + Math.ceil(fx.auto / 1000) + '초');
    if (t.shields) chip('c-shield', '방패 ×' + t.shields);
  }

  // 작은 판 칸 크기: 카드 안 빈 공간에 꼭 맞게
  function sizeMinis() {
    Object.keys(cards).forEach(function (no) {
      var c = cards[no];
      var w = c.wrap.clientWidth, h = c.wrap.clientHeight, rows = c.rows || 8, g = 3;
      if (!w || !h) return;
      var cw = Math.floor((w - 11 * g) / 12);
      var ch = Math.floor((h - (rows - 1) * g) / rows);
      cw = Math.max(6, Math.min(cw, Math.floor(ch * 1.6)));
      ch = Math.max(5, Math.min(ch, Math.floor(cw * 0.9)));
      c.mini.style.setProperty('--mc', cw + 'px');
      c.mini.style.setProperty('--mh', ch + 'px');
    });
  }

  function tick() {
    if (!B) return;
    var left = B.phase === 'playing' ? (B.paused ? B.remainMs : B.remainMs - (Date.now() - gotAt)) : B.limitMs;
    var t = $('sb-time');
    t.textContent = B.paused ? '멈춤' : mmss(left);
    // 시작 카운트다운 (v0.7.6): 시계 자리에 '준비 5'
    if (B.phase === 'playing' && B.countdownMs > 0) {
      var cdl = B.countdownMs - (Date.now() - gotAt);
      if (cdl > 0) { t.textContent = '준비 ' + Math.ceil(cdl / 1000); left = B.limitMs; }
    }
    t.classList.toggle('low', B.phase === 'playing' && !B.paused && left < 30000);
    t.classList.toggle('paused', !!B.paused);
    // 마지막 10초 카운트다운
    var sec = Math.ceil(left / 1000);
    if (B.phase === 'playing' && !B.paused && sec >= 1 && sec <= 10 && sec !== lastTick) { lastTick = sec; play(sec <= 3 ? 'tickLast' : 'tick'); }
  }
  setInterval(tick, 250);
})();
