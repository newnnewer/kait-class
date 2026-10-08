/* KAIT-PLAY — 브라우저 쪽 (입장 · 로비 · 방 만들기 · 대기실 · 수업 게임 조 선택 · 게임 · 결과) */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var AV = window.CGAvatar;
  var MOVE = window.CGMove;
  var SND = window.CGSound;

  // ── 소리 (6-2): 내 설정(켜기/끄기, 타자음) + 수업 게임은 교사 스위치 ──
  var sound = {
    on: (function () { try { return localStorage.getItem('kp.sfx') !== '0'; } catch (e) { return true; } })(),
    typing: (function () { try { return localStorage.getItem('kp.typesnd') !== '0'; } catch (e) { return true; } })()
  };
  SND.setVolume(1.2); // v0.12.0: 전광판과 같은 크기 (예전 0.22)
  function sfx(name) {
    if (!sound.on) return;
    if (game && game.cls && cls && cls.sfx === false) return; // 선생님이 학생 효과음을 껐다
    SND.play(name);
  }

  // ── 브라우저 저장소 (같은 주소의 KAIT-CLASS 와 섞이지 않게 kp. 로 시작 — v0.9.0 에서 cg. → kp., 예전 값은 avatar.js 가 한 번 옮김) ──
  var store = {
    get: function (k) { try { return localStorage.getItem('kp.' + k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem('kp.' + k, v); } catch (e) { /* 저장 못 해도 게임은 된다 */ } }
  };

  // 이 브라우저의 열쇠 — 새로고침해도 같은 사람으로 돌아오게
  function makeToken() {
    var a = new Uint8Array(18);
    (window.crypto || window.msCrypto).getRandomValues(a); // http 에서도 동작 (randomUUID 는 https 전용)
    var s = '';
    for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  var token = store.get('token');
  if (!token || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) { token = makeToken(); store.set('token', token); }
  var memToken = token; // 저장이 막힌 브라우저에서도 이 탭 안에서는 유지

  // 주소 앞부분: /play/ 에서 열면 /play, 도메인 맨 앞이면 ''
  var BASE = location.pathname.replace(/\/[^\/]*$/, '');

  // ── 화면 전환 ──
  var screens = ['loading', 'enter', 'lobby', 'create', 'wait', 'team', 'game'];
  var current = 'loading';
  function show(name) {
    current = name;
    screens.forEach(function (s) { $('screen-' + s).hidden = s !== name; });
    document.body.classList.toggle('in-game', name === 'game');
    if (name !== 'game') { $('idle').hidden = true; }
    if (name === 'game') { if (document.activeElement) document.activeElement.blur(); layout(); }
  }

  // ── 연결 ──
  var socket = io({ path: BASE + '/socket.io', transports: ['polling', 'websocket'] });
  var CHARS = ['slime', 'robot', 'cat', 'ghost', 'owl', 'dino'];
  var COLORS = ['#FFD23F', '#45B1F5', '#FF8FB1', '#7EE0B5', '#FFB347', '#C9A2FF'];
  var offlineTimer = null;
  var OPTIONS = null, BANK_TAGS = { normal: [], boss: [] };
  var ME = null; // { id, nick, kind, color }

  function setConn(kind) {
    var el = $('conn');
    el.className = 'conn ' + kind;
    el.querySelector('span').textContent =
      kind === 'ws' ? '실시간 연결 (WebSocket)' :
      kind === 'poll' ? '대체 연결 (폴링)' : '연결 끊김';
    el.title = kind === 'poll' ? '학교망이 WebSocket 을 막고 있을 수 있어요. 게임은 조금 느리게 동작해요.' : '서버와 연결된 방식';
  }

  socket.on('connect', function () {
    clearTimeout(offlineTimer);
    $('overlay-offline').hidden = true;
    var eng = socket.io.engine;
    setConn(eng.transport.name === 'websocket' ? 'ws' : 'poll');
    eng.once('upgrade', function (t) { setConn(t.name === 'websocket' ? 'ws' : 'poll'); });
    socket.emit('hello', { token: memToken }, function (res) {
      if (!res || !res.ok) return;
      if (res.chars) CHARS = res.chars;
      if (res.colors) COLORS = res.colors;
      if (res.options) OPTIONS = res.options;
      if (res.bankTags) BANK_TAGS = res.bankTags;
      if ($('demo-pill')) $('demo-pill').hidden = !res.demo;   // 체험 서버 표시 (v0.10.0)
      if (res.me) { ME = res.me; enter.nick = res.me.nick; return; } // 서버가 로비·대기실·게임을 보내 준다
      enter.nick = res.nick;
      showEnter();
    });
  });

  socket.on('disconnect', function () {
    setConn('off');
    clearTimeout(offlineTimer);
    offlineTimer = setTimeout(function () { if (!socket.connected) $('overlay-offline').hidden = false; }, 1500);
  });

  socket.on('kicked', function () {
    socket.io.opts.reconnection = false;
    socket.disconnect();
    $('overlay-kicked').hidden = false;
  });

  // ── 입장 화면 ──
  var enter = {
    nick: '',
    kind: CHARS.indexOf(store.get('kind')) >= 0 ? store.get('kind') : CHARS[Math.floor(Math.random() * CHARS.length)],
    color: COLORS.indexOf(store.get('color')) >= 0 ? store.get('color') : COLORS[Math.floor(Math.random() * COLORS.length)]
  };

  function renderEnter() {
    $('enter-nick').textContent = enter.nick;
    $('enter-nick-big').textContent = enter.nick;
    $('enter-avatar').innerHTML = AV.svg(enter.kind, enter.color);

    var chars = $('enter-chars');
    chars.innerHTML = '';
    CHARS.forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'char-btn';
      b.setAttribute('aria-pressed', String(k === enter.kind));
      b.innerHTML = '<span class="av">' + AV.svg(k, enter.color) + '</span><span></span>';
      b.lastChild.textContent = AV.NAMES[k] || k;
      b.onclick = function () { enter.kind = k; store.set('kind', k); renderEnter(); };
      chars.appendChild(b);
    });

    var colors = $('enter-colors');
    Array.prototype.slice.call(colors.querySelectorAll('.color-btn')).forEach(function (x) { x.remove(); });
    COLORS.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'color-btn';
      b.style.background = c;
      b.setAttribute('aria-label', AV.COLOR_NAMES[c] || c);
      b.setAttribute('aria-pressed', String(c === enter.color));
      b.onclick = function () { enter.color = c; store.set('color', c); renderEnter(); };
      colors.appendChild(b);
    });
  }

  function showEnter() {
    $('enter-error').textContent = '';
    $('btn-join').disabled = false;
    renderEnter();
    show('enter');
  }

  function pageToast(text, kind) {
    var el = $('page-toast');
    el.textContent = text;
    el.className = 'toast page-toast show ' + (kind || '');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.className = 'toast page-toast'; }, 3000);
  }

  $('btn-reroll').onclick = function () {
    socket.emit('nick:roll', {}, function (res) { if (res && res.nick) { enter.nick = res.nick; renderEnter(); } });
  };

  $('btn-join').onclick = function () {
    $('btn-join').disabled = true;
    socket.emit('join', { kind: enter.kind, color: enter.color }, function (res) {
      if (!res || !res.ok) {
        $('btn-join').disabled = false;
        $('enter-error').textContent = (res && res.error) || '입장하지 못했어요. 다시 눌러 주세요.';
        return;
      }
      ME = res.me;
      // 성공하면 서버가 'lobby' 를 보낸다
    });
  };

  // ── 로비 ──
  var lobby = { rooms: [], filter: 'all', allowRooms: true };
  var TAG_ORDER = ['출력', '입력', '변수', '연산자', '조건문', '반복문', '리스트', '함수'];

  function avatarSpan(kind, color, cls) {
    var s = document.createElement('span');
    s.className = cls || 'av';
    s.innerHTML = AV.svg(kind, color);
    return s;
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  socket.on('lobby', function (m) {
    lobby.rooms = m.rooms || [];
    lobby.allowRooms = m.allowRooms !== false;
    game = null;
    cls = null;
    closeResult(false);
    if (current !== 'create' || !lobby.allowRooms) { room = null; show('lobby'); }
    renderLobby();
  });

  function renderLobby() {
    if (ME) {
      $('lobby-avatar').innerHTML = AV.svg(ME.kind, ME.color);
      $('lobby-nick').textContent = ME.nick;
    }
    $('btn-create').disabled = !lobby.allowRooms;
    $('rooms-off').hidden = lobby.allowRooms;
    var open = lobby.rooms.filter(function (r) { return r.phase === 'waiting'; }).length;
    $('lobby-count').textContent = '모집 중 ' + open + ' · 진행 중 ' + (lobby.rooms.length - open);
    var fl = $('lobby-filter');
    fl.innerHTML = '';
    [['all', '전체'], ['open', '팀원 모집 중'], ['playing', '진행 중']].forEach(function (x) {
      var b = el('button', null, x[1]);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(lobby.filter === x[0]));
      b.onclick = function () { lobby.filter = x[0]; renderLobby(); };
      fl.appendChild(b);
    });
    var list = lobby.rooms.filter(function (r) {
      return lobby.filter === 'all' || (lobby.filter === 'open' ? r.phase === 'waiting' : r.phase !== 'waiting');
    });
    // 모집 중인 방을 앞에
    list.sort(function (a, b) { return (a.phase === 'waiting' ? 0 : 1) - (b.phase === 'waiting' ? 0 : 1); });
    var box = $('lobby-rooms');
    box.innerHTML = '';
    if (!list.length) {
      var e = el('div', 'empty');
      e.appendChild(el('b', null, lobby.rooms.length ? '이 조건에 맞는 방이 없어요' : '아직 열린 방이 없어요'));
      e.appendChild(el('span', null, lobby.allowRooms ? '방 만들기를 눌러 첫 방을 열어 보세요' : '수업 게임 코드를 넣어 들어가세요'));
      box.appendChild(e);
      return;
    }
    list.forEach(function (r) {
      var playing = r.phase !== 'waiting';
      var card = el('article', 'room-card' + (playing ? ' playing' : ''));
      var top = el('div', 'rc-top');
      top.appendChild(el('span', 'badge' + (playing ? ' play' : ''), playing ? '진행 중' : '팀원 모집 중'));
      top.appendChild(el('span', 'grow'));
      top.appendChild(el('span', 'muted', '제한 ' + r.limitMin + '분'));
      card.appendChild(top);
      card.appendChild(el('h2', null, r.name));
      var tl = el('div', 'tagline');
      r.tags.forEach(function (t) { tl.appendChild(el('span', null, '#' + t)); });
      card.appendChild(tl);
      var bot = el('div', 'rc-bottom');
      r.members.slice(0, 6).forEach(function (m) { bot.appendChild(avatarSpan(m.kind, m.color)); });
      bot.appendChild(el('span', 'pixel', r.count + '/' + r.max));
      bot.appendChild(el('span', 'grow'));
      if (playing) {
        var pg = el('div', 'rc-progress');
        pg.appendChild(el('span', null, '진행 ' + r.pct + '% · 입장 불가'));
        var bar = el('i'); var fill = el('b'); fill.style.width = r.pct + '%'; bar.appendChild(fill); pg.appendChild(bar);
        bot.appendChild(pg);
      } else {
        var jb = el('button', 'join-btn', r.count >= r.max ? '꽉 참' : '들어가기');
        jb.type = 'button';
        jb.disabled = r.count >= r.max;
        jb.setAttribute('aria-label', r.name + ' 들어가기');
        jb.onclick = function () {
          jb.disabled = true;
          socket.emit('room:join', { id: r.id }, function (res) {
            if (!res || !res.ok) { jb.disabled = false; pageToast((res && res.error) || '들어가지 못했어요', 'warn'); return; }
            openWait(res.room);
          });
        };
        bot.appendChild(jb);
      }
      card.appendChild(bot);
      box.appendChild(card);
    });
  }

  $('btn-profile').onclick = function () {
    // 캐릭터·닉네임 바꾸기: 입장 화면으로 (다시 '입장하기'를 누르면 로비로)
    if (ME) { enter.nick = ME.nick; enter.kind = ME.kind; enter.color = ME.color; }
    showEnter();
  };
  $('btn-create').onclick = function () { openCreate(); };

  socket.on('closed', function (m) {
    var why = {
      timeout: '10분 동안 시작하지 않아 방이 닫혔어요', idle: '아무도 입력하지 않아 방이 끝났어요', empty: '방이 닫혔어요',
      kicked: '선생님이 수업 게임에서 내보냈어요', 'class': '선생님이 수업 게임을 끝냈어요', 'class-idle': '오랫동안 쓰지 않아 수업 게임이 닫혔어요'
    }[m.reason] || '방이 닫혔어요';
    closeBubble(); closeBossBubble();
    pageToast(why, 'warn');
  });

  // ── 수업 게임: 코드로 들어가기 · 조 선택 ──
  var cls = null; // 서버가 보낸 수업 게임 정보

  $('class-code').addEventListener('input', function () {
    var v = this.value.replace(/[^0-9]/g, '').slice(0, 4);
    if (v !== this.value) this.value = v;
    $('class-error').textContent = '';
  });
  $('class-join').onsubmit = function (e) {
    e.preventDefault();
    var code = $('class-code').value.trim();
    if (!/^[0-9]{4}$/.test(code)) { $('class-error').textContent = '숫자 4자리를 넣어 주세요'; return; }
    $('btn-class-join').disabled = true;
    socket.emit('class:join', { code: code }, function (res) {
      $('btn-class-join').disabled = false;
      if (!res || !res.ok) { $('class-error').textContent = (res && res.error) || '들어가지 못했어요'; return; }
      $('class-code').value = '';
      cls = res.cls;
      show('team');
      renderTeam();
    });
  };

  function myTeam() {
    if (!cls || !ME) return 0;
    for (var k = 0; k < cls.teams.length; k++) {
      if (cls.teams[k].members.some(function (p) { return p.id === ME.id; })) return cls.teams[k].no;
    }
    return 0;
  }

  socket.on('class', function (d) {
    cls = d;
    // 게임 중이면 화면은 그대로 (조별 상황판은 'standings' 로 온다)
    if (current === 'game' && game) { renderSoundBtns(); return; }
    if (current !== 'team') show('team');
    renderTeam();
  });

  // 게임 중에 선생님이 '조 미선택'으로 옮겼다
  socket.on('class:bench', function () {
    closeBubble(); closeBossBubble();
    game = null;
    show('team');
    renderTeam();
    pageToast('선생님이 조를 다시 정하고 있어요. 조를 골라 주세요', 'warn');
  });

  function renderTeam() {
    if (!cls) return;
    var mine = myTeam();
    $('t-code').textContent = cls.code;
    if (ME) { $('t-avatar').innerHTML = AV.svg(ME.kind, ME.color); $('t-nick').textContent = ME.nick; }
    $('t-picked').textContent = mine ? mine + '조 선택' : '조를 골라 주세요';
    $('t-picked').classList.toggle('none', !mine);
    $('t-teaminfo').textContent = cls.teamLock ? '🔒 선생님이 조 선택을 잠갔어요 — 정해진 조로 참여해요' : '조마다 들어온 사람 수가 보여요 · 선생님이 조를 옮길 수도 있어요';
    $('t-teaminfo').classList.toggle('locked', !!cls.teamLock);
    var box = $('t-teams');
    box.innerHTML = '';
    cls.teams.forEach(function (t) {
      var b = el('button', 'team-btn');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(t.no === mine));
      if (cls.teamLock && t.no !== mine) b.classList.add('locked');
      b.appendChild(el('b', null, t.no + '조'));
      var av = el('span', 'team-avs');
      t.members.slice(0, 6).forEach(function (p) { av.appendChild(avatarSpan(p.kind, p.color, p.bot ? 'av bot-av' : 'av')); });
      if (t.members.length > 6) av.appendChild(el('em', null, '+' + (t.members.length - 6)));
      b.appendChild(av);
      b.appendChild(el('span', 'team-count', t.members.length + '명'));
      b.onclick = function () {
        if (t.no === myTeam()) return;
        if (cls.teamLock) { pageToast('선생님이 조 선택을 잠갔어요', 'warn'); return; }
        b.disabled = true;
        socket.emit('class:team', { no: t.no }, function (res) {
          b.disabled = false;
          if (!res || !res.ok) pageToast((res && res.error) || '조를 고르지 못했어요', 'warn');
        });
      };
      box.appendChild(b);
    });
    var st = $('t-status'), txt = st.querySelector('span');
    st.classList.toggle('playing', cls.phase === 'playing');
    if (cls.phase === 'playing') txt.textContent = cls.paused ? '게임이 잠시 멈춰 있어요 — 조를 고르면 바로 참여해요' : '게임 진행 중 — 조를 고르면 바로 참여해요!';
    else txt.textContent = mine ? '선생님이 게임을 시작하기를 기다리는 중' : '먼저 조를 골라 주세요';
    renderChat();
    renderSoundBtns();
  }

  $('btn-team-leave').onclick = function () {
    socket.emit('room:leave', {}, function () {});
  };

  // 조별 상황판 (게임 화면 왼쪽)
  var standings = [];
  socket.on('standings', function (st) { standings = st || []; renderStand(); });
  function renderStand() {
    if (!game || !game.cls) return;
    var list = standings.filter(function (x) { return x.count > 0 || x.solved > 0 || x.done; }).slice();
    // 완성한 조는 순위대로 위에, 나머지는 해결률 순
    list.sort(function (a, b) {
      if (a.rank && b.rank) return a.rank - b.rank;
      if (a.rank) return -1;
      if (b.rank) return 1;
      return b.pct - a.pct || a.no - b.no;
    });
    var ol = $('g-stand');
    ol.innerHTML = '';
    list.forEach(function (x, k) {
      var li = el('li', x.no === game.team ? 'us' : '');
      li.appendChild(el('span', 'st-rank' + (k === 0 ? ' first' : ''), x.rank ? x.rank + '위' : String(k + 1)));
      var mid = el('div', 'st-mid');
      var top = el('div', 'st-top');
      var name = el('b', null, x.no + '조');
      if (x.no === game.team) name.appendChild(el('small', null, '우리 조'));
      top.appendChild(name);
      top.appendChild(el('span', 'st-pct', x.rank ? '완성' : x.pct + '%'));
      mid.appendChild(top);
      var bar = el('i'); var fill = el('b'); fill.style.width = x.pct + '%'; bar.appendChild(fill); mid.appendChild(bar);
      li.appendChild(mid);
      ol.appendChild(li);
    });
  }

  // 우리 조가 판을 완성했다 → 다른 조를 기다린다
  socket.on('team:done', function (m) {
    if (!game) return;
    game.ended = true;
    closeBubble(); closeBossBubble();
    $('done-rank').textContent = m.rank ? m.rank + '위' : '끝';
    $('done-sub').textContent = '걸린 시간 ' + mmss(m.ms) + ' · 다른 조가 끝나기를 기다리는 중';
    $('done').hidden = false;
    renderKeys();
    sfx(m.rank === 1 ? 'win' : 'clear');
  });

  socket.on('class:feed', function (f) { if (game) addFeed(f); });

  // 일시정지 (선생님) — 모든 시계를 멈췄다가 멈춘 만큼 뒤로 민다
  socket.on('pause', function (m) { setPaused(!!m.on, m.endMs); });

  function freezeBar(bar) {
    var w = bar.getBoundingClientRect().width, pw = bar.parentNode.getBoundingClientRect().width;
    bar.style.transition = 'none';
    bar.style.width = (pw ? w / pw * 100 : 0) + '%';
  }
  function resumeBar(bar, ms) {
    void bar.offsetWidth;
    bar.style.transition = 'width ' + Math.max(0, ms) + 'ms linear';
    bar.style.width = '0%';
  }
  function setPaused(on, endMs) {
    if (!game) return;
    var t = now();
    if (on && !game.paused) {
      game.paused = true;
      game.pauseAt = t;
      freezeBar(bubble.bar); freezeBar(bossBubble.bar);
    } else if (!on && game.paused) {
      var d = t - game.pauseAt;
      game.paused = false;
      game.endAt = endMs != null ? t + endMs : game.endAt + d;
      if (game.boss) game.boss.until += d;
      if (game.radar) game.radar.until += d;
      (game.incoming || []).forEach(function (x) { x.until += d; });
      ['auto', 'freeze', 'confuse', 'cloud'].forEach(function (k) { if (game.fx[k] > game.pauseAt) game.fx[k] += d; });
      if (game.occUntil) { game.occUntil += d; if (!bubble.el.hidden) resumeBar(bubble.bar, game.occUntil - t); }
      if (game.bossUntil) { game.bossUntil += d; if (!bossBubble.el.hidden) resumeBar(bossBubble.bar, game.bossUntil - t); }
    }
    // 카운트다운이 끝나 풀리면 "시작!" (일시정지 가림막은 카운트다운 때는 안 보임)
    if (!on && game.countdownUntil) {
      game.countdownUntil = 0;
      var cd = $('countdown');
      cd.hidden = false;
      cd.querySelector('.cd-label').textContent = '';
      cd.querySelector('.cd-num').textContent = '시작!';
      cd.classList.add('go');
      setTimeout(function () { cd.hidden = true; cd.classList.remove('go'); }, 700);
      sfx('start');
    }
    $('paused').hidden = !game.paused || !!game.countdownUntil;
    tickFx(); tickClocks();
  }

  function tickCountdown() {
    var cd = $('countdown');
    if (!game || !game.countdownUntil) { if (!cd.classList.contains('go')) cd.hidden = true; return; }
    var left = Math.max(1, Math.ceil((game.countdownUntil - now()) / 1000));
    cd.hidden = false;
    cd.querySelector('.cd-label').textContent = '준비!';
    var num = cd.querySelector('.cd-num');
    if (num.textContent !== String(left)) {
      num.textContent = left;
      num.classList.remove('pop'); void num.offsetWidth; num.classList.add('pop');
      if (game.lastCd !== left) { game.lastCd = left; sfx('tick'); }
    }
  }
  setInterval(tickCountdown, 100);

  // ── 방 만들기 ──
  var cr = null;
  var BOT_SPEED = { slow: '느림 (20초)', normal: '보통 (12초)', fast: '빠름 (7초)' };
  var BOT_SPEED_SHORT = { slow: '느림', normal: '보통', fast: '빠름' };
  function optDefault(k) { return OPTIONS && OPTIONS[k] ? OPTIONS[k].def : null; }

  function openCreate() {
    cr = cr || {
      tags: [], max: optDefault('max') || 4, limitMin: optDefault('limitMin') || 5, occSec: optDefault('occSec') || 20,
      botSpeed: optDefault('botSpeed') || 'normal',
      bossLimitSec: optDefault('bossLimitSec') || 30, bossEverySec: optDefault('bossEverySec') || 15, bossWaitSec: optDefault('bossWaitSec') || 8,
      penalty: true, auto: true, blocks: 72
    };
    $('cr-error').textContent = '';
    $('btn-open').disabled = false;
    show('create');
    renderCreate();
  }
  $('btn-create-back').onclick = function () { show('lobby'); renderLobby(); };

  // 고른 태그 중 하나라도 붙은 문제 수 (합집합)
  function countFor(tags) {
    function n(list) { return list.filter(function (ts) { return ts.some(function (t) { return tags.indexOf(t) >= 0; }); }).length; }
    return { normal: n(BANK_TAGS.normal), boss: n(BANK_TAGS.boss) };
  }

  function segButtons(id, list, cur, unit, onPick) {
    var box = $(id);
    box.innerHTML = '';
    list.forEach(function (v) {
      var b = el('button', 'seg-btn', v + unit);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(v === cur));
      b.onclick = function () { onPick(v); renderCreate(); };
      box.appendChild(b);
    });
  }

  function renderCreate() {
    var o = OPTIONS || {};
    var tl = $('cr-tags');
    tl.innerHTML = '';
    TAG_ORDER.forEach(function (t) {
      var c = countFor([t]);
      var b = el('button', 'tag-btn', t);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(cr.tags.indexOf(t) >= 0));
      b.appendChild(el('small', null, c.normal + '·' + c.boss));
      b.onclick = function () {
        var k = cr.tags.indexOf(t);
        if (k >= 0) cr.tags.splice(k, 1); else cr.tags.push(t);
        cr.tags.sort(function (a, b2) { return TAG_ORDER.indexOf(a) - TAG_ORDER.indexOf(b2); });
        renderCreate();
      };
      tl.appendChild(b);
    });
    var cnt = countFor(cr.tags);
    var info = $('cr-taginfo');
    info.className = 'tag-info' + (cr.tags.length && cnt.boss ? '' : ' warn');
    info.textContent = !cr.tags.length ? '태그를 하나 이상 고르세요' :
      '일반 ' + cnt.normal + '문제 · 보스 ' + cnt.boss + '문제 출제' + (cnt.boss ? '' : ' — 보스 문제가 없어 보스가 나오지 않아요');

    $('cr-ppl').textContent = cr.max;
    $('cr-ppl-down').disabled = cr.max <= 2;
    $('cr-ppl-up').disabled = cr.max >= 16;
    var lim = (o.limitMin || {}), limMin = lim.min || 1, limMax = lim.max || 30;
    if (document.activeElement !== $('cr-lim')) $('cr-lim').value = cr.limitMin;
    $('cr-lim-down').disabled = cr.limitMin <= limMin;
    $('cr-lim-up').disabled = cr.limitMin >= limMax;
    segButtons('cr-occ', (o.occSec || {}).list || [10, 15, 20, 30], cr.occSec, '초', function (v) { cr.occSec = v; });
    segButtons('cr-bosslimit', (o.bossLimitSec || {}).list || [20, 30, 45, 60], cr.bossLimitSec, '초', function (v) { cr.bossLimitSec = v; });
    segButtons('cr-bossevery', (o.bossEverySec || {}).list || [10, 15, 30, 60], cr.bossEverySec, '초', function (v) { cr.bossEverySec = v; });
    segButtons('cr-bosswait', (o.bossWaitSec || {}).list || [5, 8, 12, 20], cr.bossWaitSec, '초', function (v) { cr.bossWaitSec = v; });
    var sb = $('cr-botspeed');
    sb.innerHTML = '';
    ((o.botSpeed || {}).list || ['slow', 'normal', 'fast']).forEach(function (v) {
      var b = el('button', 'seg-btn', BOT_SPEED[v] || v);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(v === cr.botSpeed));
      b.onclick = function () { cr.botSpeed = v; renderCreate(); };
      sb.appendChild(b);
    });
    $('cr-pen').setAttribute('aria-pressed', String(cr.penalty));
    $('cr-pentext').textContent = cr.penalty ? '보스 보상의 15%가 페널티' : '페널티 없이 좋은 아이템만';
    $('cr-auto').setAttribute('aria-pressed', String(cr.auto));
    $('cr-blk').textContent = cr.auto ? '자동' : String(cr.blocks);
    $('cr-blk-down').disabled = cr.auto || cr.blocks <= 24;
    $('cr-blk-up').disabled = cr.auto || cr.blocks >= 144;
    $('cr-blkhelp').textContent = cr.auto ? '시작할 때 인원 × 24칸 (최대 96칸)' : '24 ~ 144칸, 12칸씩 (' + (cr.blocks / 12) + '줄)';

    if (ME) { $('cr-avatar').innerHTML = AV.svg(ME.kind, ME.color); $('cr-name').textContent = ME.nick + '의 방'; }
    var sum = [
      ['태그', cr.tags.length ? cr.tags.join(' · ') : '없음'], ['최대 인원', cr.max + '명'], ['제한 시간', cr.limitMin + '분'],
      ['블록 수', cr.auto ? '자동' : cr.blocks + '칸'], ['블록 점유', cr.occSec + '초'],
      ['보스 간격 · 잔류', cr.bossEverySec + '초 · ' + cr.bossWaitSec + '초'], ['보스 풀이', cr.bossLimitSec + '초'],
      ['봇 속도', BOT_SPEED_SHORT[cr.botSpeed] || '보통'], ['페널티', cr.penalty ? '있음' : '없음']
    ];
    fillSummary($('cr-summary'), sum);
    $('btn-open').disabled = !cr.tags.length;
  }

  function fillSummary(dl, rows) {
    dl.innerHTML = '';
    rows.forEach(function (r) { dl.appendChild(el('dt', null, r[0])); dl.appendChild(el('dd', null, r[1])); });
  }

  $('cr-ppl-down').onclick = function () { cr.max = Math.max(2, cr.max - 1); renderCreate(); };
  // 제한 시간: − / + 또는 숫자 직접 입력 (1 ~ 30분)
  function limRange() { var o = (OPTIONS && OPTIONS.limitMin) || {}; return [o.min || 1, o.max || 30]; }
  function setLimit(v) {
    var r = limRange(), empty = String(v).trim() === ''; // 빈칸이면 이전 값 그대로
    v = Math.round(Number(v));
    if (!empty && Number.isFinite(v)) cr.limitMin = Math.max(r[0], Math.min(r[1], v));
    $('cr-lim').value = cr.limitMin;
    renderCreate();
  }
  $('cr-lim-down').onclick = function () { setLimit(cr.limitMin - 1); };
  $('cr-lim-up').onclick = function () { setLimit(cr.limitMin + 1); };
  $('cr-lim').addEventListener('input', function () { this.value = this.value.replace(/[^0-9]/g, ''); });
  $('cr-lim').addEventListener('change', function () { setLimit(this.value); });
  $('cr-lim').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); this.blur(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setLimit(cr.limitMin + 1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setLimit(cr.limitMin - 1); }
  });
  $('cr-ppl-up').onclick = function () { cr.max = Math.min(16, cr.max + 1); renderCreate(); };
  $('cr-pen').onclick = function () { cr.penalty = !cr.penalty; renderCreate(); };
  $('cr-auto').onclick = function () { cr.auto = !cr.auto; renderCreate(); };
  $('cr-blk-down').onclick = function () { cr.blocks = Math.max(24, cr.blocks - 12); renderCreate(); };
  $('cr-blk-up').onclick = function () { cr.blocks = Math.min(144, cr.blocks + 12); renderCreate(); };

  $('btn-open').onclick = function () {
    if (!cr.tags.length) return;
    $('btn-open').disabled = true;
    var settings = {
      tags: cr.tags, max: cr.max, limitMin: cr.limitMin, occSec: cr.occSec, bossLimitSec: cr.bossLimitSec,
      bossEverySec: cr.bossEverySec, bossWaitSec: cr.bossWaitSec, penalty: cr.penalty, blocks: cr.auto ? 0 : cr.blocks,
      botSpeed: cr.botSpeed
    };
    socket.emit('room:create', { settings: settings }, function (res) {
      if (!res || !res.ok) { $('btn-open').disabled = false; $('cr-error').textContent = (res && res.error) || '방을 열지 못했어요'; return; }
      openWait(res.room);
    });
  };

  // ── 대기실 ──
  var room = null; // 서버가 보낸 방 정보 + closeAt

  function openWait(r) {
    room = r;
    room.closeAt = Date.now() + r.closeMs;
    if (current !== 'game') show('wait');
    renderWait();
  }

  socket.on('room', function (r) {
    var wasPlaying = room && room.phase === 'playing';
    // v0.11.0: 대기실에 사람이 새로 들어오면 방장에게 '딩동' (봇 · 나 자신은 빼고)
    if (room && room.id === r.id && r.phase === 'waiting' && ME && r.hostId === ME.id) {
      var before = {};
      (room.members || []).forEach(function (p) { before[p.id] = 1; });
      var someone = (r.members || []).some(function (p) { return !before[p.id] && !p.bot && p.id !== ME.id; });
      if (someone) sfx('join');
    }
    room = r;
    room.closeAt = Date.now() + r.closeMs;
    // 게임 중에는 대기실 화면으로 바꾸지 않는다 ('state' 로 게임 화면이 온다)
    if (r.phase === 'waiting' && current !== 'game') { show('wait'); renderWait(); }
    else if (r.phase === 'waiting' && current === 'game' && !wasPlaying) { /* 결과가 곧 온다 */ }
    if (current === 'wait') renderWait();
  });

  function renderWait() {
    if (!room) return;
    var s = room.settings, meId = ME && ME.id;
    $('w-name').textContent = room.name;
    $('w-count').textContent = room.members.length + '/' + s.max;
    var slots = $('w-slots');
    slots.innerHTML = '';
    slots.classList.toggle('many', s.max > 8);
    var amHost = room.hostId === meId, botBtnShown = false;
    for (var i = 0; i < s.max; i++) {
      var p = room.members[i];
      if (!p) {
        // 방장에게는 첫 빈자리에 '봇 넣기' (v0.6.4)
        if (amHost && !botBtnShown) {
          botBtnShown = true;
          var ab = el('button', 'slot empty add-bot');
          ab.type = 'button';
          ab.appendChild(el('i', null, '+'));
          ab.appendChild(el('span', null, '봇 넣기'));
          ab.appendChild(el('small', null, '봇 속도: ' + (BOT_SPEED_SHORT[s.botSpeed] || '보통')));
          ab.onclick = function () { roomBot({ op: 'add' }); };
          slots.appendChild(ab);
          continue;
        }
        var e = el('div', 'slot empty'); e.appendChild(el('i', null, '?')); e.appendChild(el('span', null, '친구를 기다리는 중')); slots.appendChild(e); continue;
      }
      var d = el('div', 'slot' + (p.id === meId ? ' me' : '') + (p.bot ? ' bot' : '') + (p.online ? '' : ' off'));
      d.setAttribute('data-pid', p.id);
      var said = chat.say[p.id];
      if (said && said.until > Date.now()) d.appendChild(el('span', 'say', said.text));
      if (p.id === room.hostId) d.appendChild(el('span', 'host-badge', '방장'));
      if (p.bot) d.appendChild(el('span', 'bot-badge big', '🤖 봇'));
      d.appendChild(avatarSpan(p.kind, p.color, p.bot ? 'av bot-av' : 'av'));
      d.appendChild(el('b', null, (p.bot ? '🤖 ' : '') + p.nick));
      d.appendChild(el('small', null, p.bot ? '봇 · ' + (BOT_SPEED_SHORT[s.botSpeed] || '보통') : p.id === meId ? '나' : (p.online ? '준비 완료' : '연결 끊김')));
      if (p.bot && amHost) {
        var rb = el('button', 'btn small ghost-btn bot-out', '빼기');
        rb.type = 'button';
        rb.onclick = (function (id) { return function () { roomBot({ op: 'remove', id: id }); }; })(p.id);
        d.appendChild(rb);
      }
      slots.appendChild(d);
    }
    fillSummary($('w-summary'), [
      ['태그', s.tags.join(' · ')], ['최대 인원', s.max + '명'], ['제한 시간', s.limitMin + '분'],
      ['블록 수', s.blocks ? s.blocks + '칸' : '자동 (인원 × 24)'], ['블록 점유', s.occSec + '초'],
      ['보스 간격 · 잔류', s.bossEverySec + '초 · ' + s.bossWaitSec + '초'], ['보스 풀이', s.bossLimitSec + '초'],
      ['봇 속도', BOT_SPEED_SHORT[s.botSpeed] || '보통'], ['페널티', s.penalty ? '있음' : '없음']
    ]);
    var host = room.hostId === meId;
    $('w-host').hidden = !host;
    $('w-guest').hidden = host;
    $('w-startinfo').innerHTML = '';
    $('w-startinfo').appendChild(document.createTextNode('지금 시작하면 '));
    $('w-startinfo').appendChild(el('b', null, room.members.length + '명 · ' + room.blocksNow + '칸'));
    $('w-startinfo').appendChild(document.createTextNode('으로 정해져요'));
    tickClocks();
    renderChat();
    renderSoundBtns();
  }

  // ── 대기실 · 조 선택 화면 채팅 (v0.7.3): 정해 둔 문구만 · 게임 중에는 없음 ──
  var CH = window.CGChat;
  var chat = { tab: 'reply', until: 0, say: {} }; // say: 사람 id → { text, until } (대기실 카드 위 말풍선 3초)
  function chatCtx() {
    if (current === 'wait' && room) return { box: $('w-chat'), mode: 'room', log: room.chat || (room.chat = []) };
    if (current === 'team' && cls) return { box: $('t-chat'), mode: 'class', log: cls.chat || (cls.chat = []) };
    return null;
  }
  function renderChat() {
    var c = chatCtx();
    if (!c || !CH) return;
    var tabs = c.box.querySelector('.chat-tabs'), btns = c.box.querySelector('.chat-btns'), log = c.box.querySelector('.chat-log');
    tabs.innerHTML = '';
    CH.TABS.forEach(function (t) {
      var b = el('button', 'chat-tab', t.name);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(t.id === chat.tab));
      b.tabIndex = -1;
      b.onclick = function () { chat.tab = t.id; renderChat(); };
      tabs.appendChild(b);
    });
    btns.innerHTML = '';
    var cool = chat.until > Date.now();
    CH.listFor(chat.tab, c.mode).forEach(function (x, k) {
      var b = el('button', 'chat-btn');
      b.type = 'button';
      b.tabIndex = -1;
      b.disabled = cool;
      b.appendChild(el('kbd', null, String(k + 1)));
      b.appendChild(document.createTextNode(x.text));
      b.onclick = function () { sendChat(x.id); };
      btns.appendChild(b);
    });
    log.innerHTML = '';
    c.log.slice(-5).forEach(function (m) {
      var li = el('li', ME && m.pid === ME.id ? 'me' : '');
      li.appendChild(avatarSpan(m.kind, m.color));
      li.appendChild(el('b', null, m.nick));
      li.appendChild(el('span', null, m.text));
      log.appendChild(li);
    });
    if (!c.log.length) log.appendChild(el('li', 'empty', '아직 아무도 말하지 않았어요'));
  }
  function sendChat(id) {
    if (chat.until > Date.now()) return;
    chat.until = Date.now() + CH.GAP_MS; // 2초에 한 번 (서버도 똑같이 막는다)
    renderChat();
    setTimeout(renderChat, CH.GAP_MS + 30);
    socket.emit('chat', { id: id }, function (res) {
      if (res && !res.ok && res.why === 'fast') { chat.until = Date.now() + (res.ms || 500); renderChat(); setTimeout(renderChat, (res.ms || 500) + 30); }
    });
  }
  socket.on('chat', function (m) {
    var c = chatCtx();
    if (!c) return; // 게임 중에는 보이지 않는다
    c.log.push(m);
    if (c.log.length > 8) c.log.shift();
    chat.say[m.pid] = { text: m.text, until: Date.now() + 3000 };
    if (current === 'wait') {
      var slot = document.querySelector('#w-slots [data-pid="' + m.pid + '"]');
      if (slot) {
        var old = slot.querySelector('.say'); if (old) old.remove();
        slot.appendChild(el('span', 'say', m.text));
        // 3초 뒤 지운다 — 그 사이 대기실이 다시 그려져도 사람 id 로 찾아서
        setTimeout(function () {
          document.querySelectorAll('#w-slots .say').forEach(function (x) {
            var said = chat.say[x.parentNode.getAttribute('data-pid')];
            if (!said || said.until <= Date.now() + 50) x.remove();
          });
        }, 3050);
      }
    }
    renderChat();
    if (!ME || m.pid !== ME.id) sfx('chat');
  });
  // 키보드: 숫자 1~6 보내기 · ← → 묶음 바꾸기 (대기실 · 조 선택 화면에서만, 글 칸에 있을 때는 안 함)
  window.addEventListener('keydown', function (e) {
    if (current !== 'wait' && current !== 'team') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    var c = chatCtx();
    if (!c) return;
    var m = /^(Digit|Numpad)([1-9])$/.exec(e.code || '');
    if (m) {
      var list = CH.listFor(chat.tab, c.mode), x = list[Number(m[2]) - 1];
      if (x) { e.preventDefault(); if (!e.repeat) sendChat(x.id); }
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      var ids = CH.TABS.map(function (x) { return x.id; }), k = ids.indexOf(chat.tab);
      chat.tab = ids[(k + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
      renderChat();
    }
  });

  function roomBot(msg) {
    $('w-error').textContent = '';
    socket.emit('room:bot', msg, function (res) {
      if (!res || !res.ok) $('w-error').textContent = (res && res.error) || '봇을 넣지 못했어요';
    });
  }

  $('btn-wait-leave').onclick = function () {
    socket.emit('room:leave', {}, function () {});
  };
  $('btn-start').onclick = function () {
    $('btn-start').disabled = true;
    $('w-error').textContent = '';
    socket.emit('room:start', {}, function (res) {
      $('btn-start').disabled = false;
      if (!res || !res.ok) $('w-error').textContent = (res && res.error) || '시작하지 못했어요';
    });
  };

  // ── 결과 ──
  var REASON = { clear: '판 완성!', time: '시간 초과', idle: '방치로 끝남', empty: '모두 나감' };
  socket.on('result', function (r) {
    closeBubble(); closeBossBubble();
    game = null;
    $('rs-teams').hidden = true;
    $('rs-players').hidden = false;
    $('btn-result-ok').textContent = '대기실로';
    var box = document.querySelector('#overlay-result .result');
    box.classList.toggle('fail', !r.success);
    $('rs-kind').textContent = r.success ? '성공' : '아쉬워요';
    sfx(r.success ? 'win' : 'end');
    $('rs-title').textContent = REASON[r.reason] || '끝';
    var stats = $('rs-stats');
    stats.innerHTML = '';
    [['걸린 시간', mmss(r.ms)], ['해결한 블록', r.solved + ' / ' + r.total], ['보스 격파', r.bosses + '마리']].forEach(function (x) {
      var d = el('div'); d.appendChild(el('span', null, x[0])); d.appendChild(el('b', null, x[1])); stats.appendChild(d);
    });
    var ol = $('rs-players');
    ol.innerHTML = '';
    r.players.forEach(function (p) {
      var li = el('li', ME && p.id === ME.id ? 'me' : '');
      li.appendChild(avatarSpan(p.kind, p.color));
      li.appendChild(el('b', null, p.nick + (p.bot ? ' (봇)' : '')));
      li.appendChild(el('em', null, '블록 ' + p.solved + (p.bot ? '' : ' · 보스 ' + p.bosses)));
      ol.appendChild(li);
    });
    $('overlay-result').hidden = false;
    show('wait');
    renderWait();
    setTimeout(function () { $('btn-result-ok').focus(); }, 50);
  });
  function closeResult(focusWait) { $('overlay-result').hidden = true; }

  // 수업 게임 한 판 결과 — 조별 순위
  var CLASS_REASON = { clear: '모든 조가 판 완성!', time: '시간 종료', stop: '선생님이 게임을 끝냈어요' };
  socket.on('class:result', function (r) {
    var mine = game && game.team ? game.team : myTeam();
    closeBubble(); closeBossBubble();
    game = null;
    var my = r.teams.filter(function (t) { return t.no === mine; })[0];
    if (sound.on && !(cls && cls.sfx === false)) SND.play(my && my.rank === 1 ? 'win' : 'end');
    var box = document.querySelector('#overlay-result .result');
    box.classList.toggle('fail', !(my && my.rank === 1));
    $('rs-kind').textContent = CLASS_REASON[r.reason] || '게임 끝';
    $('rs-title').textContent = my ? my.no + '조 ' + my.rank + '위' : '게임 끝';
    var stats = $('rs-stats');
    stats.innerHTML = '';
    var mineRows = [['걸린 시간', mmss(my ? my.ms : r.ms)], ['해결한 블록', my ? my.solved + ' / ' + my.total : '-'], ['보스 격파', (my ? my.bosses : 0) + '마리']];
    mineRows.forEach(function (x) { var d = el('div'); d.appendChild(el('span', null, x[0])); d.appendChild(el('b', null, x[1])); stats.appendChild(d); });
    var ol = $('rs-teams');
    ol.innerHTML = '';
    r.teams.forEach(function (t) {
      var li = el('li', t.no === mine ? 'me' : '');
      li.appendChild(el('span', 'rt-rank', t.rank + '위'));
      li.appendChild(el('b', null, t.no + '조'));
      li.appendChild(el('em', null, t.clear ? '완성 · ' + mmss(t.ms) : '해결률 ' + t.pct + '%'));
      ol.appendChild(li);
    });
    ol.hidden = false;
    // 우리 조원 기록
    var pl = $('rs-players');
    pl.innerHTML = '';
    (my ? my.members : []).forEach(function (p) {
      var li = el('li', ME && p.nick === ME.nick ? 'me' : '');
      li.appendChild(avatarSpan(p.kind, p.color));
      li.appendChild(el('b', null, p.nick + (p.bot ? ' (봇)' : '')));
      li.appendChild(el('em', null, '블록 ' + p.solved + (p.bot ? '' : ' · 보스 ' + p.bosses)));
      pl.appendChild(li);
    });
    pl.hidden = !(my && my.members.length);
    $('btn-result-ok').textContent = '조 선택으로';
    $('overlay-result').hidden = false;
    show('team');
    renderTeam();
    setTimeout(function () { $('btn-result-ok').focus(); }, 50);
  });
  $('btn-result-ok').onclick = function () { closeResult(true); };

  function mmss(ms) {
    var t = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(t / 60), sec = t % 60;
    return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  // 대기실 닫힘 · 게임 제한 시간 · 방치 경고 초 세기
  function tickClocks() {
    var t = Date.now();
    if (room && current === 'wait') $('w-close').textContent = mmss(room.closeAt - t);
    if (game && current === 'game') {
      var left = game.endAt - (game.paused ? game.pauseAt : t);
      var tm = $('g-timer');
      tm.textContent = mmss(left);
      tm.classList.toggle('low', left < 30000);
      // 마지막 10초: 1초마다 틱
      var secLeft = Math.ceil(left / 1000);
      if (!game.paused && !game.ended && secLeft <= 10 && secLeft >= 1 && secLeft !== game.lastTick) {
        game.lastTick = secLeft;
        sfx(secLeft <= 3 ? 'tickLast' : 'tick');
      }
      if (game.idleUntil) $('idle-sec').textContent = Math.max(0, Math.ceil((game.idleUntil - t) / 1000));
    }
  }
  setInterval(tickClocks, 250);

  // 게임 중 '나가기': 한 번 더 눌러야 나간다 (실수 방지)
  var leaveArm = 0;
  $('btn-leave').onclick = function () {
    var b = $('btn-leave');
    if (Date.now() - leaveArm > 3000) {
      leaveArm = Date.now();
      b.textContent = '한 번 더 누르면 나가요';
      setTimeout(function () { b.textContent = '나가기'; }, 3000);
      return;
    }
    b.textContent = '나가기';
    closeBubble(); closeBossBubble();
    game = null;
    socket.emit('room:leave', {}, function () {});
  };

  // ── 게임 ──
  // game = { board, players: {id: p}, meId, me: {r,c}, seq, occ: {칸: id}, boss, fx, limits, mode: 'move'|'occupy'|'boss' }
  var game = null;
  var cellEls = [];
  var HANGUL = /[ㄱ-ㆎ가-힣]/g;
  var now = function () { return Date.now(); };

  // 이동 규칙에 넘길 판 정보 (서버와 같은 규칙으로 미리 움직여 본다)
  function boardView() {
    var b = game.board, boss = game.boss;
    return {
      cols: b.cols, rows: b.rows,
      solved: function (i) { return b.cells[i].solved; },
      blocked: function (i) { return !!boss && boss.i === i; }
    };
  }

  function nickOf(id) { var p = game && game.players[id]; return p ? p.nick : '누군가'; }

  socket.on('state', function (st) {
    var wasGame = current === 'game' && !!game;
    var players = {};
    st.players.forEach(function (p) { players[p.id] = p; });
    var mine = players[st.meId];
    var occ = {};
    (st.occ || []).forEach(function (o) { occ[o.i] = o.by; });
    closeBubble(); closeBossBubble();
    var t = now(), fx = st.fx || {};
    $('overlay-result').hidden = true;
    var isClass = st.room.mode === 'class';
    game = {
      board: st.board, players: players, meId: st.meId,
      cls: isClass, team: isClass ? st.room.team : 0, ended: !!st.ended, paused: false, pauseAt: 0, occUntil: 0, bossUntil: 0,
      me: { r: mine.r, c: mine.c }, seq: 0, title: st.room.name,
      endAt: t + (st.endMs || 0), idleUntil: st.idle ? t + st.idle.ms : 0,
      occ: occ, mode: 'move', myOcc: -1, pending: false,
      limits: st.limits || { occ: 30000, boss: 30000, bossWait: 8000 },
      boss: st.boss ? { i: st.boss.i, phase: st.boss.phase, by: st.boss.by, until: t + st.boss.ms, got: st.boss.got || 0, need: st.boss.need || 0, ids: st.boss.ids || [] } : null,
      deck: st.deck || { slots: [], shields: 0 },
      incoming: (st.incoming || []).map(function (x) { x.until = t + x.ms; return x; }),
      fx: { auto: t + (fx.auto || 0), freeze: t + (fx.freeze || 0), confuse: t + (fx.confuse || 0), cloud: t + (fx.cloud || 0) },
      shields: st.shields || 0,
      radar: null
    };
    // 시작 카운트다운 (v0.7.6): 판은 보이지만 그동안 모든 시간 · 입력이 멈춰 있다
    game.countdownUntil = st.countdownMs > 0 ? t + st.countdownMs : 0;
    if (game.countdownUntil) { game.paused = true; game.pauseAt = t; game.lastCd = 0; }
    buildBoard();
    $('g-feed').innerHTML = '';
    $('g-room').textContent = st.room.name || '학생 방';
    $('g-mode').textContent = isClass ? '수업 게임 · ' + st.room.name : '자유 대전';
    $('g-stand-card').hidden = !isClass;
    $('g-progress-card').hidden = isClass;
    $('g-team-title').textContent = isClass ? '우리 조원' : '우리 팀';
    $('done').hidden = true;
    $('aim').hidden = true; clearTimeout(aimTimer);
    $('paused').hidden = true;
    if (st.paused) setPaused(true);
    var tg = $('g-tags');
    tg.innerHTML = '';
    (st.room.tags || []).forEach(function (x) { tg.appendChild(el('span', null, '#' + x)); });
    $('btn-leave').textContent = '나가기';
    $('idle').hidden = !game.idleUntil;
    show('game');
    renderAll();
    renderStand();
    renderDeck(); renderIncoming();
    if (!wasGame && !st.paused && !st.ended && !game.countdownUntil) sfx('start');
    tickCountdown();
  });

  // 방치 경고: 1분 동안 아무도 입력하지 않으면 15초 카운트다운
  socket.on('idle', function (m) {
    if (!game) return;
    game.idleUntil = m.warn ? now() + m.ms : 0;
    $('idle').hidden = !m.warn;
    tickClocks();
  });

  // 누가 블록을 풀었다 → 우리 팀 막대
  socket.on('stat', function (m) {
    if (!game || !game.players[m.id]) return;
    game.players[m.id].solved = m.solved;
    renderMembers();
  });

  socket.on('player:join', function (p) {
    if (!game) return;
    game.players[p.id] = p;
    renderAvatars(); renderMembers();
  });
  socket.on('player:leave', function (m) {
    if (!game) return;
    delete game.players[m.id];
    renderAvatars(); renderMembers();
  });
  socket.on('player:online', function (m) {
    if (!game || !game.players[m.id]) return;
    game.players[m.id].online = m.online;
    renderAvatars(); renderMembers();
  });

  socket.on('pos', function (m) {
    if (!game || !game.players[m.id]) return;
    var p = game.players[m.id];
    p.r = m.r; p.c = m.c;
    if (m.id === game.meId) {
      // 가장 최근에 보낸 이동의 답이면 서버 위치로 맞춘다 (보통은 이미 같은 자리)
      if (m.seq === game.seq || m.seq < 0) game.me = { r: m.r, c: m.c };
    }
    renderAvatars();
  });

  socket.on('cell', function (m) {
    if (!game) return;
    var cell = game.board.cells[m.i];
    if (!cell) return;
    cell.solved = m.solved;
    cell.boss = m.solved ? (m.boss || null) : null;
    renderCell(m.i);
    pop(m.i, m.solved ? (m.via || '') : 'revive');
    renderProgress();
  });

  // 쉬운 길: 블록 코드가 바뀌었다
  socket.on('code', function (m) {
    if (!game || !game.board.cells[m.i]) return;
    game.board.cells[m.i].code = m.code;
    var el = cellEls[m.i];
    el.querySelector('code').textContent = m.code;
    el.classList.toggle('long', m.code.length > 16);
    pop(m.i, 'easy');
  });

  // 누가 칸을 점유했다 / 풀었다
  socket.on('occ', function (m) {
    if (!game) return;
    if (m.by) game.occ[m.i] = m.by; else delete game.occ[m.i];
    renderCell(m.i);
    renderMembers();
    if (!m.by && m.i === game.myOcc && m.why !== 'wrong') closeBubble();
  });

  // 서버가 내 점유를 풀었다 (제한 시간)
  // 서버가 내 점유를 풀었다: 시간 초과 / 아이템(폭탄·레이저)이 대신 해결 / 뒤섞기로 옮겨짐
  var VIA_NAME = { bomb: '폭탄', laser: '가로 레이저', vlaser: '세로 레이저' };
  socket.on('released', function (m) {
    if (!game || m.i !== game.myOcc) return;
    closeBubble();
    if (m.why === 'item') toast((VIA_NAME[m.via] || '아이템') + '으로 해결됐어요! 다른 블록으로', 'good', 2200);
    else if (m.why === 'shuffle') toast('뒤섞기! 모두 한 칸으로 모였어요 — 흩어져서 다시 점유하세요', 'warn', 2600);
    else { wrong(m.i, '시간 초과'); sfx('wrong'); }
  });

  socket.on('clear', function () { toast('판을 모두 해결했어요! 곧 새 판이 나와요', 'good', 3000); });

  // ── 보스 ──
  socket.on('boss', function (m) {
    if (!game) return;
    var old = game.boss;
    if (m.i >= 0) {
      game.boss = { i: m.i, phase: m.phase, by: m.by || null, until: now() + m.ms, got: m.got || 0, need: m.need || 0, ids: m.ids || [] };
      if (m.phase === 'wait') { game.radar = null; toast('보스 등장! 옆 칸에서 Delete · Backspace', 'boss', 2200); sfx('bossAppear'); }
      if (m.phase === 'gather') { toast('집결 보스! 보스 옆에서 Delete · Backspace — 모두가 잡아야 성공!', 'boss', 3000); sfx('gather'); }
    } else {
      game.boss = null;
      var at = m.at;
      if (game.mode === 'boss' && m.by === game.meId) closeBossBubble();
      if (m.end === 'win') sfx('bossWin');
      if (m.end === 'wrong') { wrong(at, '오답'); if (m.by === game.meId) sfx('wrong'); }
      else if (m.end === 'timeout') { wrong(at, '시간 초과'); if (m.by === game.meId) sfx('wrong'); }
      else if (m.end === 'escaped' || m.end === 'scattered') pop(at, 'escape');
      if (m.end === 'gather') sfx('clear');
      if (m.end === 'scattered') toast('집결 실패 — 시간 안에 모두 잡지 못했어요', 'warn', 2200);
    }
    // 보스 칸과 양옆 칸 (집결 보스는 양옆이 모이는 자리)
    [old, game.boss].forEach(function (b) { if (b && b.i >= 0) { renderCell(b.i); renderCell(b.i - 1); renderCell(b.i + 1); } });
    renderKeys(); renderMembers();
  });

  // 집결 보스: 모인 사람 수
  socket.on('gather', function (m) {
    if (!game || !game.boss || game.boss.phase !== 'gather') return;
    game.boss.got = m.got; game.boss.need = m.need; game.boss.ids = m.ids || [];
    var b = game.boss.i;
    renderCell(b); renderCell(b - 1); renderCell(b + 1);
    renderKeys(); renderMembers();
  });

  socket.on('radar', function (m) {
    if (!game) return;
    game.radar = { i: m.i, until: now() + m.ms + 500 };
    renderCell(m.i);
    toast('레이더: 다음 보스 위치!', 'boss');
  });

  // ── 아이템 ──
  // 입력 중 · 보스 공략 중에는 큰 알림을 작게 · 반투명하게, 말풍선과 먼 쪽(판 위 또는 아래 끝)으로 (v0.7.1)
  // 알림이 뜬 뒤에 블록을 잡아도(말풍선이 열려도) 다시 맞춘다 (v0.7.2)
  function fitBanner() {
    var el = $('banner');
    if (!el.classList.contains('show')) return;
    var compact = !!(game && (game.mode === 'occupy' || game.mode === 'boss'));
    var low = false;
    if (compact) {
      var bb = (game.mode === 'boss' ? bossBubble.el : bubble.el).getBoundingClientRect(), wr = $('board-wrap').getBoundingClientRect();
      low = (bb.top + bb.bottom) / 2 < wr.top + wr.height / 2;
    }
    el.classList.toggle('compact', compact);
    el.classList.toggle('low', compact && low);
  }

  socket.on('item', function (m) {
    var el = $('banner');
    // 입력 중 · 보스 공략 중에는 말풍선을 가리지 않게 판 맨 위에 작게 · 반투명으로 (v0.7.1)
    // good 아이템 · bad 페널티 · attack 우리가 쏜 방해 · hit 다른 조의 공격을 맞음 · blocked 방패로 막음
    // v0.7.0: get 보스 보상이 덱으로 · gather 집결 보스 성공 보상
    var KIND = { good: ['good', '아이템'], bad: ['bad', '페널티'], attack: ['attack', '공격 발사!'], hit: ['bad', '공격 받음!'], blocked: ['shielded', '방패!'],
      get: [m.lost ? 'bad' : 'good', m.lost ? '덱이 가득 참' : '아이템 획득!'], gather: [m.lost ? 'bad' : 'good', '모두 잡았다!'] }[m.kind] || ['good', '아이템'];
    el.className = 'banner show ' + KIND[0];
    fitBanner();
    el.querySelector('.bn-kind').textContent = KIND[1];
    el.querySelector('.bn-name').textContent = m.kind === 'attack' ? m.to + '조에 ' + m.name : m.name;
    el.querySelector('.bn-desc').textContent = m.desc + ' · ' + m.by;
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.className = 'banner'; }, 2600);
    // 아이템마다 소리 (보스 격파 팡파르 바로 뒤에)
    var snd = m.kind === 'bad' ? 'bad' : m.kind === 'hit' ? 'hit' : m.kind === 'attack' ? 'attackSend' : m.kind === 'blocked' ? 'shield'
      : (m.kind === 'get' || m.kind === 'gather') ? (m.lost ? 'wrong' : 'good')
      : m.id === 'bomb' ? 'bomb' : (m.id === 'laser' || m.id === 'vlaser') ? 'laser' : m.id === 'shield' ? 'shield' : 'good';
    setTimeout(function () { sfx(snd); }, 350);
  });

  // ── 개인 덱 (v0.7.0): Ctrl+Shift+1~5 쓰기 · Ctrl+Shift+9 방패로 막기 ──
  var ITEM_ICON = { bomb: '💣', laser: '↔', vlaser: '↕', auto: '⚡', radar: '📡', easy: '🍃', shield: '🛡', ice: '🧊', cloud: '☁', revive: '♻', shuffle: '🔀', flip: '🔄' };
  socket.on('deck', function (m) {
    if (!game) return;
    var before = (game.deck.slots || []).map(function (x) { return x ? x.id : ''; });
    game.deck = m;
    renderDeck(before);
    renderIncoming(); renderKeys();
  });
  socket.on('deck:full', function (m) {
    toast((m.shield ? '방패는 2개까지 — ' : '덱이 가득 차서 ') + m.name + '이(가) 사라졌어요. 아이템을 쓰고 비워 두세요!', 'warn', 2600);
  });
  function renderDeck(before) {
    var box = $('deck');
    if (!game) { box.innerHTML = ''; return; }
    var d = game.deck || { slots: [], shields: 0 };
    box.innerHTML = '';
    box.appendChild(el('span', 'dk-label', '내 아이템'));
    for (var k = 0; k < 5; k++) {
      var it = d.slots[k];
      var s = el('div', 'dk-slot' + (it ? ' ' + (it.kind === 'attack' ? 'atk' : 'help') : ' empty') + (it && it.off ? ' off' : ''));
      s.appendChild(el('kbd', null, 'Ctrl+Shift+' + (k + 1)));
      if (it) {
        s.appendChild(el('i', null, ITEM_ICON[it.id] || '★'));
        s.appendChild(el('b', null, it.name));
        s.title = it.desc + (it.off ? ' (선생님이 방해 아이템을 껐어요)' : '');
        if (before && before[k] !== it.id) s.classList.add('new');
      }
      box.appendChild(s);
    }
    // 방패 칸: 수업 게임에서만 (학생 방이라도 가진 게 있으면)
    if (game.cls || d.shields) {
      var sh = el('div', 'dk-slot shield' + (d.shields ? '' : ' empty'));
      sh.appendChild(el('kbd', null, 'Ctrl+Shift+9'));
      sh.appendChild(el('i', null, '🛡'));
      sh.appendChild(el('b', null, '방패 ×' + d.shields));
      sh.title = '공격이 들어올 때 2초 안에 눌러 막아요 (최대 2개)';
      box.appendChild(sh);
    }
  }
  function flashSlot(n) {
    var sl = $('deck').querySelectorAll('.dk-slot')[n - 1];
    if (!sl) return;
    sl.classList.remove('used'); void sl.offsetWidth; sl.classList.add('used');
  }
  var USE_WHY = { empty: '칸이 비어 있어요', 'attacks-off': '선생님이 방해 아이템을 껐어요', 'no-target': '공격할 조가 없어요 — 아이템은 그대로 있어요',
    'bad-target': '그 조는 공격할 수 없어요 — 아이템은 그대로 있어요',
    frozen: '얼음 중에는 아이템을 쓸 수 없어요', paused: '일시정지 중이에요', ended: '게임이 끝났어요' };
  // ── 방해 아이템 대상 고르기 (v0.12.0): Ctrl+Shift+번호 → 숫자 키로 조 번호 (3초 안에 안 고르면 바로 위 순위 조) ──
  var AIM_MS = 3000, aimTimer = null;
  /** 공격할 수 있는 조 (우리 조 · 끝난 조 · 아무도 없는 조 빼고) */
  function aimTargets() {
    return standings.filter(function (x) { return x.no !== game.team && !x.done && (x.count > 0 || x.solved > 0); });
  }
  /** 기본 대상: 바로 위 순위 조 (1등이면 2등) — 서버와 같은 순서 */
  function aimDefault() {
    var live = standings.filter(function (x) { return !x.done && (x.count > 0 || x.solved > 0 || x.no === game.team); }).slice();
    live.sort(function (a, b) { return (b.total ? b.solved / b.total : 0) - (a.total ? a.solved / a.total : 0) || b.solved - a.solved || a.no - b.no; });
    var k = -1;
    live.forEach(function (x, n) { if (x.no === game.team) k = n; });
    if (k < 0 || live.length < 2) return 0;
    return live[k === 0 ? 1 : k - 1].no;
  }
  function startAim(n, it) {
    var ts = aimTargets();
    if (ts.length <= 1) { fireSlot(n, 0); return; } // 고를 게 없으면 바로
    stopAim();
    game.aim = { slot: n, item: it, until: now() + AIM_MS };
    aimTimer = setTimeout(function () { if (game && game.aim) fireSlot(game.aim.slot, 0); }, AIM_MS);
    renderAim();
    renderKeys();
    sfx('occupy');
  }
  function stopAim() {
    clearTimeout(aimTimer); aimTimer = null;
    if (game) game.aim = null;
    $('aim').hidden = true;
    if (game) renderKeys();
  }
  function renderAim() {
    var box = $('aim');
    if (!game || !game.aim) { box.hidden = true; return; }
    var a = game.aim, def = aimDefault();
    box.querySelector('.aim-title').textContent = '🎯 ' + a.item.name + ' — 몇 조를 공격할까요?';
    var list = box.querySelector('.aim-teams');
    list.innerHTML = '';
    aimTargets().forEach(function (x) {
      var b = el('button', 'aim-team' + (x.no === def ? ' def' : ''));
      b.type = 'button';
      b.appendChild(el('kbd', null, String(x.no)));
      b.appendChild(el('b', null, x.no + '조'));
      b.appendChild(el('span', null, x.pct + '%' + (x.no === def ? ' · 기본' : '')));
      b.onmousedown = function (e) { e.preventDefault(); };
      b.onclick = function () { if (game && game.aim) fireSlot(game.aim.slot, x.no); };
      list.appendChild(b);
    });
    var bar = box.querySelector('em');
    bar.style.transition = 'none'; bar.style.width = '100%'; void bar.offsetWidth;
    bar.style.transition = 'width ' + AIM_MS + 'ms linear'; bar.style.width = '0%';
    box.hidden = false;
  }
  function aimKey(e) {
    if (!game || !game.aim) return false;
    var m = /^(Digit|Numpad)([1-8])$/.exec(e.code || '');
    if (m) {
      e.preventDefault();
      if (e.repeat) return true;
      var to = Number(m[2]);
      if (!aimTargets().some(function (x) { return x.no === to; })) { toast(to === game.team ? '우리 조는 공격할 수 없어요' : to + '조는 공격할 수 없어요', 'warn', 1400); return true; }
      fireSlot(game.aim.slot, to);
      return true;
    }
    if (e.key === 'Escape') { e.preventDefault(); stopAim(); toast('공격을 취소했어요 — 아이템은 그대로 있어요', 'info', 1400); return true; }
    if (e.key === 'Enter') { e.preventDefault(); if (!e.repeat) fireSlot(game.aim.slot, 0); return true; }
    return false;
  }
  function useSlot(n) {
    if (!game) return;
    var it = game.deck && game.deck.slots ? game.deck.slots[n - 1] : null;
    if (it && it.kind === 'attack' && game.cls && !it.off) {
      if (game.aim && game.aim.slot === n) fireSlot(n, 0); // 같은 단축키를 한 번 더 = 기본 대상
      else startAim(n, it);
      return;
    }
    fireSlot(n, 0);
  }
  function fireSlot(n, to) {
    if (!game) return;
    stopAim();
    socket.emit('item:use', { slot: n, to: to || 0 }, function (res) {
      if (!res) return;
      if (res.ok) { flashSlot(n); return; }
      toast((res.why === 'empty' ? n + '번 ' : '') + (USE_WHY[res.why] || '쓸 수 없어요'), 'warn', 1800);
    });
  }
  function defend() {
    if (!game) return;
    socket.emit('defend', {}, function (res) {
      if (!res) return;
      if (!res.ok) toast(res.why === 'no-shield' ? '방패가 없어요' : res.why === 'nothing' ? '막을 공격이 없어요' : '막지 못했어요', 'warn', 1500);
    });
  }

  // 들어오는 공격 (2초 안에 방패로 막기)
  socket.on('incoming', function (m) {
    if (!game) return;
    m.until = now() + m.ms;
    game.incoming.push(m);
    renderIncoming(); renderKeys();
    sfx('alarm');
  });
  socket.on('incoming:end', function (m) {
    if (!game) return;
    game.incoming = game.incoming.filter(function (x) { return x.id !== m.id; });
    renderIncoming(); renderKeys();
  });
  function renderIncoming() {
    var box = $('incoming');
    if (!game) { box.hidden = true; return; }
    var x = game.incoming[0];
    box.hidden = !x;
    if (!x) return;
    var mine = (game.deck && game.deck.shields) || 0;
    box.classList.toggle('can', mine > 0);
    box.querySelector('.in-title').textContent = '⚠ ' + x.from + '조의 ' + x.name + ' 공격!' + (game.incoming.length > 1 ? ' (+' + (game.incoming.length - 1) + ')' : '');
    box.querySelector('.in-help').textContent = mine > 0 ? '지금 Ctrl+Shift+9 로 막기! (내 방패 ' + mine + ')'
      : (x.holders && x.holders.length ? '방패: ' + x.holders.join(', ') + ' — Ctrl+Shift+9' : '우리 조에 방패가 없어요');
    tickIncoming();
  }
  function tickIncoming() {
    if (!game || !game.incoming.length) return;
    var x = game.incoming[0], t = game.paused ? game.pauseAt : now();
    var left = Math.max(0, x.until - t);
    var box = $('incoming');
    box.querySelector('.in-sec').textContent = (left / 1000).toFixed(1);
    box.querySelector('em').style.width = Math.min(100, left / 2000 * 100) + '%';
  }
  setInterval(tickIncoming, 100);

  socket.on('shield', function (m) {
    if (!game) return;
    game.shields = m.n;
    tickFx();
  });

  socket.on('effect', function (m) {
    if (!game) return;
    game.fx[m.type] = now() + m.ms;
    game.fxDur = game.fxDur || {};
    game.fxDur[m.type] = m.ms;
    tickFx(); renderKeys();
    if (m.type === 'freeze') setTimeout(function () { sfx('ice'); }, 500);
    if (m.type === 'cloud') setTimeout(function () { sfx('cloud'); }, 500);
  });

  socket.on('feed', addFeed);
  function addFeed(f) {
    var ul = $('g-feed');
    var li = document.createElement('li');
    li.className = f.kind || '';
    li.textContent = f.text;
    ul.insertBefore(li, ul.firstChild);
    while (ul.children.length > 30) ul.removeChild(ul.lastChild);
  }

  function pop(i, kind) {
    var el = cellEls[i];
    if (!el) return;
    el.classList.remove('pop', 'fx-bomb', 'fx-laser', 'fx-vlaser', 'fx-easy', 'fx-revive', 'fx-escape');
    void el.offsetWidth;
    el.classList.add('pop');
    if (kind) el.classList.add('fx-' + kind);
  }

  var CROWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18 L5 7 L10 12 L12 5 L14 12 L19 7 L21 18 Z" fill="#B57BFF" stroke="#4B1C8C" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  var BOSS_FACE = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 12 L9 4 L13 10 L16 3 L19 10 L23 4 L26 12 Z" fill="#FFD23F" stroke="#2A0B4F" stroke-width="1.4" stroke-linejoin="round"/><rect x="6" y="12" width="20" height="16" rx="5" fill="#fff" opacity=".18"/><circle cx="12" cy="19" r="2.6" fill="#fff"/><circle cx="20" cy="19" r="2.6" fill="#fff"/><circle cx="12.6" cy="19.4" r="1.2" fill="#2A0B4F"/><circle cx="20.6" cy="19.4" r="1.2" fill="#2A0B4F"/><path d="M11 24.5 L13 23.2 L15 24.5 L17 23.2 L19 24.5 L21 23.2" fill="none" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';

  function buildBoard() {
    var el = $('board');
    el.innerHTML = '';
    cellEls = game.board.cells.map(function (c) {
      var d = document.createElement('div');
      d.className = 'cell' + (c.code.length > 16 ? ' long' : '');
      d.innerHTML = '<code></code><span class="occ-tag"></span><span class="boss-face">' + BOSS_FACE + '<b class="boss-sec"></b></span><span class="crown">' + CROWN + '</span>';
      d.querySelector('code').textContent = c.code;
      el.appendChild(d);
      return d;
    });
    var cur = document.createElement('div');
    cur.className = 'cursor'; cur.id = 'cursor';
    el.appendChild(cur);
    var layer = document.createElement('div');
    layer.className = 'avatars'; layer.id = 'avatars';
    el.appendChild(layer);
    el.appendChild(bubble.el);     // 말풍선은 판 안에 둔다
    el.appendChild(bossBubble.el);
    avatarEls = {};
    renderCells();
  }

  // 칸 모양: 미해결 / 해결 / 보스 해결 / 내가 점유 / 남이 점유 / 보스
  function renderCell(i) {
    var el = cellEls[i];
    if (!el) return;
    var cell = game.board.cells[i];
    var by = game.occ[i];
    var mine = by && by === game.meId;
    var other = by && !mine;
    var boss = game.boss && game.boss.i === i ? game.boss : null;
    el.classList.toggle('solved', !!cell.solved);
    el.classList.toggle('boss-won', !!(cell.solved && cell.boss));
    el.classList.toggle('occ-mine', !!mine);
    el.classList.toggle('occ-other', !!other);
    el.classList.toggle('boss', !!boss);
    el.classList.toggle('boss-fight', !!(boss && boss.phase === 'fight'));
    // 집결 보스 (v0.7.0): 보스 칸은 주황, 양옆 칸은 모이는 자리
    var gb = game.boss && game.boss.phase === 'gather' && !iGrabbed() ? game.boss : null;
    el.classList.toggle('gather', !!(boss && boss.phase === 'gather'));
    el.classList.toggle('gather-spot', !!(gb && Math.abs(i - gb.i) === 1 && Math.floor(i / game.board.cols) === Math.floor(gb.i / game.board.cols)));
    el.classList.toggle('radar', !!(game.radar && game.radar.i === i && !boss));
    var tag = el.querySelector('.occ-tag');
    if (other) {
      var p = game.players[by];
      el.style.setProperty('--occ', p ? p.color : '#FFD23F');
      tag.textContent = nickOf(by) + ' 점유';
    } else if (boss && boss.phase === 'fight') {
      tag.textContent = (boss.by === game.meId ? '내가' : nickOf(boss.by)) + ' 공략 중';
    } else if (boss && boss.phase === 'gather') {
      tag.textContent = '잡아라 ' + (boss.got || 0) + '/' + (boss.need || 0);
    } else if (cell.solved && cell.boss) {
      tag.textContent = cell.boss;
    } else {
      el.style.removeProperty('--occ');
      tag.textContent = '';
    }
  }
  function renderCells() { for (var i = 0; i < cellEls.length; i++) renderCell(i); }

  // 화면 크기에 맞춰 칸 크기를 정한다
  var cellW = 82, cellH = 78, gap = 8;
  function layout() {
    if (!game || current !== 'game') return;
    var wrap = $('board-wrap');
    var rows = game.board.rows, cols = game.board.cols;
    gap = wrap.clientWidth < 800 ? 5 : 8;
    cellW = Math.max(40, Math.min(82, Math.floor((wrap.clientWidth - (cols - 1) * gap) / cols)));
    cellH = Math.max(34, Math.min(78, Math.floor((wrap.clientHeight - 24 - (rows - 1) * gap) / rows)));
    var fs = Math.max(9, Math.min(14, Math.floor(Math.min(cellW / 6.2, cellH / 4.6))));
    var root = document.documentElement.style;
    root.setProperty('--cw', cellW + 'px');
    root.setProperty('--ch', cellH + 'px');
    root.setProperty('--gap', gap + 'px');
    root.setProperty('--fs', fs + 'px');
    renderAvatars();
    placeBubble();
    placeBossBubble();
  }
  window.addEventListener('resize', layout);

  function xy(r, c) { return { x: c * (cellW + gap), y: r * (cellH + gap) }; }
  function boardSize() {
    var b = game.board;
    return { w: b.cols * cellW + (b.cols - 1) * gap, h: b.rows * cellH + (b.rows - 1) * gap };
  }

  function renderAll() { layout(); renderMembers(); renderProgress(); renderKeys(); tickFx(); renderSoundBtns(); }

  // 선생님이 수업 게임의 학생 소리를 껐는지 (조 선택 화면 · 수업 게임 중)
  function teacherMuted() { return !!(cls && cls.sfx === false && (current === 'team' || (game && game.cls))); }
  function renderSoundBtns() {
    var teacherOff = teacherMuted();
    ['btn-sfx', 'w-sfx', 't-sfx'].forEach(function (id) {
      var b = $(id);
      if (!b) return;
      b.textContent = teacherOff ? '소리 꺼짐(선생님)' : (sound.on ? '소리 켬' : '소리 끔') + (id === 'btn-sfx' ? '' : ' · Ctrl+S');
      b.setAttribute('aria-pressed', String(sound.on && !teacherOff));
      b.disabled = teacherOff;
    });
    var t = $('btn-typesnd');
    t.textContent = '타자음 ' + (sound.typing ? '켬' : '끔');
    t.setAttribute('aria-pressed', String(sound.typing));
    t.hidden = !sound.on || teacherOff;
  }
  // 소리 켜기/끄기 — 배경음 · 효과음 함께 (버튼 · Ctrl+S, v0.11.0)
  function toggleSound() {
    if (teacherMuted()) { if (current === 'game') toast('선생님이 소리를 꺼 두었어요', 'warn'); else pageToast('선생님이 소리를 꺼 두었어요', 'warn'); return; }
    sound.on = !sound.on;
    try { localStorage.setItem('kp.sfx', sound.on ? '1' : '0'); } catch (e) { /* 저장 못 해도 이 탭에서는 됨 */ }
    renderSoundBtns();
    updateBgm();
    if (sound.on) sfx('occupy');
  }
  ['btn-sfx', 'w-sfx', 't-sfx'].forEach(function (id) {
    $(id).onclick = function () { SND.unlock(); toggleSound(); this.blur(); };
  });

  // ── 배경음 (v0.11.0): 대기실 · 조 선택 화면은 잔잔한 곡, 게임 중은 게임 곡 (마지막 30초 빠르게) ──
  function updateBgm() {
    var tune = null, fast = false;
    if (!$('overlay-result').hidden) tune = null; // 결과 화면에서는 쉰다
    else if (current === 'game' && game) {
      if (!game.paused && !game.ended) { tune = 'game'; fast = game.endAt - Date.now() < 30000; }
    } else if (current === 'wait' || current === 'team') tune = 'lobby';
    SND.bgm(!!tune && sound.on && !teacherMuted(), fast, tune || 'game');
  }
  setInterval(updateBgm, 250);

  // 단축키 (v0.11.0) — Ctrl+S: 소리 켜기/끄기 (대기실 · 조 선택 · 게임 중, 코드 입력 중에도)
  //   Ctrl+Enter: 방장이 게임 시작 (대기실). 한글 입력 상태에서도 되게 키 자리(e.code)로 본다
  window.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    if (e.code === 'KeyS') {
      if (current !== 'wait' && current !== 'team' && current !== 'game') return;
      e.preventDefault();
      if (!e.repeat) toggleSound();
      return;
    }
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && current === 'wait') {
      e.preventDefault();
      var b = $('btn-start');
      if (!e.repeat && room && ME && room.hostId === ME.id && !b.disabled) b.click();
    }
  }, true);
  $('btn-typesnd').onclick = function () {
    sound.typing = !sound.typing;
    try { localStorage.setItem('kp.typesnd', sound.typing ? '1' : '0'); } catch (e) { /* 저장 못 해도 됨 */ }
    renderSoundBtns();
    this.blur();
  };

  var avatarEls = {};
  function renderAvatars() {
    if (!game) return;
    var layer = $('avatars');
    if (!layer) return;
    // 내 칸 표시
    var mp = xy(game.me.r, game.me.c);
    $('cursor').style.transform = 'translate(' + mp.x + 'px,' + mp.y + 'px)';

    // 같은 칸에 여러 명이면 옆으로 조금씩 비켜 선다
    var slot = {};
    var ids = Object.keys(game.players).sort(function (a, b) { return a === game.meId ? 1 : b === game.meId ? -1 : 0; });
    var size = cellH * 0.42;
    ids.forEach(function (id) {
      var p = game.players[id];
      var pos = id === game.meId ? game.me : p;
      var key = pos.r + ',' + pos.c;
      var k = slot[key] = (slot[key] || 0) + 1;
      var el = avatarEls[id];
      if (!el || !el.isConnected) {
        el = document.createElement('div');
        el.className = 'avatar' + (id === game.meId ? ' mine' : '') + (p.bot ? ' bot' : '');
        el.innerHTML = AV.svg(p.kind, p.color);
        el.title = p.bot ? '🤖 ' + p.nick + ' (봇)' : p.nick;
        layer.appendChild(el);
        avatarEls[id] = el;
      }
      el.classList.toggle('off', !p.online && id !== game.meId);
      var q = xy(pos.r, pos.c);
      var dx = id === game.meId ? -size * 0.3 : -size * 0.25 + (k - 1) * size * 0.55;
      el.style.transform = 'translate(' + (q.x + dx) + 'px,' + (q.y - size * 0.45) + 'px)';
    });
    // 나간 사람 지우기
    Object.keys(avatarEls).forEach(function (id) {
      if (!game.players[id]) { avatarEls[id].remove(); delete avatarEls[id]; }
    });
    renderKeys();
  }

  function stateOf(id) {
    if (game.boss && game.boss.phase === 'fight' && game.boss.by === id) return '보스 공략 중';
    for (var i in game.occ) if (game.occ[i] === id) return '입력 중';
    return '이동 중';
  }

  function renderMembers() {
    if (!game) return;
    var ul = $('g-members');
    ul.innerHTML = '';
    var list = Object.keys(game.players).map(function (id) { return game.players[id]; });
    list.sort(function (a, b) { return a.id === game.meId ? -1 : b.id === game.meId ? 1 : a.nick.localeCompare(b.nick, 'ko'); });
    var top = list.reduce(function (m, p) { return Math.max(m, p.solved || 0); }, 0);
    list.forEach(function (p) {
      var li = document.createElement('li');
      if (!p.online && p.id !== game.meId) li.className = 'off';
      if (p.bot) li.classList.add('bot');
      // 해결한 블록 수 막대 (v0.7.4) — 조원 중 가장 많이 푼 사람을 꽉 찬 막대로
      li.innerHTML = '<span class="av">' + AV.svg(p.kind, p.color) + '</span><span class="who"><b></b><span class="mbar"><i></i></span></span><em class="mnum"></em>';
      var gb = game.boss && game.boss.phase === 'gather' ? game.boss : null;
      if (gb && !p.bot) li.classList.add((gb.ids || []).indexOf(p.id) >= 0 ? 'grabbed' : 'ungrabbed');
      li.querySelector('b').textContent = (gb && !p.bot ? ((gb.ids || []).indexOf(p.id) >= 0 ? '✅ ' : '⏳ ') : '') + (p.bot ? '🤖 ' : '') + p.nick + (p.id === game.meId ? ' (나)' : p.bot ? ' (봇)' : '') + (!p.online && p.id !== game.meId ? ' · 연결 끊김' : '');
      var n = p.solved || 0;
      li.querySelector('.mbar i').style.width = (top ? Math.round(n / top * 100) : 0) + '%';
      li.querySelector('.mbar i').style.background = p.color || '';
      li.querySelector('.mnum').textContent = n;
      ul.appendChild(li);
    });
    $('g-count').textContent = list.length;
  }

  function renderProgress() {
    if (!game) return;
    var cells = game.board.cells, n = cells.length, s = 0;
    for (var i = 0; i < n; i++) if (cells[i].solved) s++;
    var pct = Math.round(s / n * 100);
    $('g-pct').textContent = pct + '%';
    $('g-left').textContent = '남은 블록 ' + (n - s);
    $('g-bar').style.width = pct + '%';
  }

  // ── 알림 (판 위에 잠깐 뜨는 글) ──
  var toastTimer = null;
  function toast(text, kind, ms) {
    var el = $('toast');
    el.textContent = text;
    el.className = 'toast show ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, ms || 1800);
  }
  var lastHint = 0;
  function hintOnce(text) {
    var t = now();
    if (t - lastHint < 2500) return;
    lastHint = t;
    toast(text, 'info');
  }
  function warnHangul() { toast('한글이 입력됐어요. 한/영 키를 눌러 영문으로 바꾸세요', 'warn', 2500); }

  // ── 효과 표시 (얼음 · 혼란 · 자동완성) + 보스 초 세기 — 0.2초마다 ──
  function tickFx() {
    if (!game) return;
    var t = game.paused ? game.pauseAt : now(), fx = game.fx, box = $('fx');
    var parts = [];
    function sec(u) { return Math.ceil((u - t) / 1000); }
    if (fx.freeze > t) parts.push('<span class="fx-chip fx-ice">얼음 ' + sec(fx.freeze) + '</span>');
    if (fx.confuse > t) parts.push('<span class="fx-chip fx-confuse">방향 반전 ' + sec(fx.confuse) + '</span>');
    if (fx.auto > t) parts.push('<span class="fx-chip fx-auto">자동완성 Tab ' + sec(fx.auto) + '</span>');
    // 자동완성 중: 판 둘레가 초록으로 빛나고, 판 위에 남은 시간 막대 · 내 캐릭터가 빛남
    var autoing = fx.auto > t, ab = $('auto-bar');
    $('board-wrap').classList.toggle('auto-on', autoing);
    ab.hidden = !autoing;
    if (autoing) {
      var bd = $('board'), dur = (game.fxDur && game.fxDur.auto) || 10000;
      ab.style.left = bd.offsetLeft + 'px';
      ab.style.width = bd.offsetWidth + 'px';
      ab.style.top = (bd.offsetTop - 36) + 'px'; // 판 바로 위 한 줄 (위쪽 막대와 판 사이)
      ab.querySelector('b').textContent = sec(fx.auto);
      ab.querySelector('em').style.width = Math.max(0, Math.min(100, (fx.auto - t) / dur * 100)) + '%';
      ab.querySelector('.ab-text').textContent = game.mode === 'occupy' ? '앞부분을 치고 Tab!' : '블록을 점유하고 앞부분 + Tab';
    }
    updateGhost();
    renderKeys();
    if (fx.cloud > t) parts.push('<span class="fx-chip fx-cloud">먹구름 ' + sec(fx.cloud) + '</span>');
    if (game.shields) parts.push('<span class="fx-chip fx-shield">조 방패 ×' + game.shields + '</span>');
    // 먹구름: 판 · 말풍선의 코드를 가린다
    var cloudy = fx.cloud > t;
    $('board-wrap').classList.toggle('cloudy', cloudy);
    $('cloud').hidden = !cloudy;
    if (cloudy) $('cloud').querySelector('b').textContent = sec(fx.cloud);
    box.innerHTML = parts.join('');
    var frozen = fx.freeze > t;
    $('ice').hidden = !frozen;
    if (frozen) $('ice').querySelector('b').textContent = sec(fx.freeze);
    input.readOnly = frozen || game.paused;
    bossInputs().forEach(function (x) { x.readOnly = frozen || game.paused; });
    // 보스 칸 초
    var b = game.boss;
    if (b && cellEls[b.i]) {
      var left = Math.max(0, Math.ceil((b.until - t) / 1000));
      cellEls[b.i].querySelector('.boss-sec').textContent = b.phase === 'wait' || b.phase === 'gather' ? left : '';
    }
    if (game.radar && game.radar.until < t) { var ri = game.radar.i; game.radar = null; renderCell(ri); }
  }
  setInterval(tickFx, 200);

  // ── 아래쪽 키 안내 (지금 상태에 맞게) ──
  /** 집결 보스를 내가 이미 잡았나 (v0.12.0) */
  function iGrabbed() {
    var b = game && game.boss;
    return !!(b && b.phase === 'gather' && (b.ids || []).indexOf(game.meId) >= 0);
  }
  function nextToBoss() {
    var b = game && game.boss;
    if (!b || (b.phase !== 'wait' && b.phase !== 'gather')) return '';
    var i = game.me.r * game.board.cols + game.me.c;
    var sameRow = Math.floor(b.i / game.board.cols) === game.me.r;
    if (sameRow && b.i === i + 1) return 'Delete';
    if (sameRow && b.i === i - 1) return 'Backspace';
    return '';
  }
  function renderKeys() {
    var el = $('keys');
    if (!game) return;
    var list, label, cls = '';
    if (game.ended) {
      label = '완성'; list = [['', '다른 조가 끝나기를 기다리는 중']];
    } else if (game.mode === 'occupy') {
      label = '입력 중'; cls = ' typing';
      list = [['', '흐린 글씨를 따라 치기 (띄어쓰기는 무시)'], ['Backspace', '지우기'], ['Enter', '제출'], ['Esc', '점유 풀기']];
      if (game.fx.auto > now()) list.push(['Tab', '자동완성']);
    } else if (game.mode === 'boss') {
      label = '보스 공략'; cls = ' boss';
      list = [['← →', '커서'], ['Enter', '제출'], ['Esc', '포기']];
    } else {
      label = '이동';
      list = [['← ↑ → ↓ · Tab · Shift+Tab', '한 칸'], ['Home / End', '줄 처음 · 끝'], ['Ctrl + Home / End', '판 처음 · 끝'], ['Ctrl + 방향키', '점프'], ['Enter', '블록 점유']];
      var nb = nextToBoss();
      var gat = game.boss && game.boss.phase === 'gather';
      if (gat && iGrabbed()) list.unshift(['', '✅ 잡았어요 — 다른 조원을 기다리는 중 (움직여도 돼요)']);
      else if (gat && nb) list.unshift([nb, '집결 보스 잡기!']);
      else if (gat) list.unshift(['↑ ↓ + Home / End', '집결 보스 옆으로!']);
      else if (nb) list.unshift([nb, '보스 공략!']);
      if (game.fx.auto > now()) list.push(['Tab', '⚡ 자동완성 (블록 안에서)']);
      else if (game.boss && game.boss.phase === 'wait') list.push(['Delete / Backspace', '보스 왼쪽 / 오른쪽에서']);
    }
    if (game.aim) list = [['숫자', '공격할 조'], ['Enter', '기본 (바로 위 순위 조)'], ['Esc', '취소']];
    if (game.incoming && game.incoming.length && game.deck && game.deck.shields) list.unshift(['Ctrl+Shift+9', '막기!']);
    if (game.deck && game.deck.slots && game.deck.slots.some(Boolean)) list.push(['Ctrl+Shift+1~5', '아이템']);
    var key = label + '|' + list.map(function (k) { return k.join(); }).join('|');
    if (el._key === key) return;
    el._key = key;
    el.innerHTML = '<span class="mode' + cls + '">' + label + '</span>';
    list.forEach(function (k, n) {
      var s = document.createElement('span');
      if (k[1] === '보스 공략!' || k[1] === '집결 보스 옆으로!' || k[1] === '집결 보스 잡기!' || k[1] === '막기!') s.className = 'hot';
      s.innerHTML = k[0] ? '<kbd></kbd> ' : '';
      if (k[0]) s.firstChild.textContent = k[0];
      s.appendChild(document.createTextNode(k[1]));
      el.appendChild(s);
    });
  }

  // ── 입력칸 공통: 한글 막기 · 붙여넣기 막기 ──
  function guardInput(el) {
    el.addEventListener('compositionstart', warnHangul);
    el.addEventListener('compositionend', function () { el.value = el.value.replace(HANGUL, ''); });
    el.addEventListener('input', function (e) {
      if (sound.typing && e.inputType && e.inputType.indexOf('insert') === 0) sfx('type');
      if (!e.isComposing && HANGUL.test(el.value)) {
        el.value = el.value.replace(HANGUL, '');
        warnHangul();
      }
      HANGUL.lastIndex = 0;
    });
    ['paste', 'drop', 'dragover', 'contextmenu', 'cut', 'copy'].forEach(function (ev) {
      el.addEventListener(ev, function (e) {
        e.preventDefault();
        if (ev === 'paste' || ev === 'drop') toast('붙여넣기는 쓸 수 없어요. 직접 입력하세요', 'warn');
      });
    });
    el.addEventListener('keydown', function (e) {
      var k = e.key, ctrl = e.ctrlKey || e.metaKey;
      if (e.isComposing || k === 'Process') { warnHangul(); return; }
      if ((ctrl && (k === 'v' || k === 'V')) || (e.shiftKey && k === 'Insert')) { e.preventDefault(); toast('붙여넣기는 쓸 수 없어요. 직접 입력하세요', 'warn'); }
    });
  }

  function barRun(bar, ms) {
    bar.style.transition = 'none';
    bar.style.width = '100%';
    void bar.offsetWidth;
    bar.style.transition = 'width ' + ms + 'ms linear';
    bar.style.width = '0%';
  }

  // ── 일반 블록 말풍선 ──
  var bubble = (function () {
    var el = document.createElement('div');
    el.className = 'bubble';
    el.hidden = true;
    el.innerHTML =
      '<i class="tail"></i>' +
      '<div class="b-code"></div>' +
      '<div class="b-field">' +
        '<div class="b-ghost show" aria-hidden="true"><span class="g-done"></span><span class="g-bad"></span><i class="g-caret"></i><span class="g-rest"></span><span class="g-tab">Tab</span></div>' +
        '<input class="b-input" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" lang="en" maxlength="200" aria-label="코드 입력">' +
      '</div>' +
      '<span class="b-spark" aria-hidden="true">⚡ 자동완성!</span>' +
      '<div class="b-bar"><div></div></div>' +
      '<span class="b-hint">Enter 제출 · Esc 풀기 · 띄어쓰기는 무시해요</span>';
    return { el: el, code: el.querySelector('.b-code'), input: el.querySelector('.b-input'), bar: el.querySelector('.b-bar div'), tail: el.querySelector('.tail'),
      ghost: el.querySelector('.b-ghost'), gDone: el.querySelector('.g-done'), gBad: el.querySelector('.g-bad'), gCaret: el.querySelector('.g-caret'),
      gRest: el.querySelector('.g-rest'), gTab: el.querySelector('.g-tab'), spark: el.querySelector('.b-spark') };
  })();
  var input = bubble.input;
  guardInput(input);

  function openBubble(i, ms) {
    game.mode = 'occupy';
    game.myOcc = i;
    game.occ[i] = game.meId;
    renderCell(i);
    bubble.code.textContent = game.board.cells[i].code;
    input.value = '';
    bubble.el.hidden = false;
    placeBubble();
    fitBanner();
    game.occUntil = now() + (ms || game.limits.occ);
    barRun(bubble.bar, ms || game.limits.occ);
    renderKeys(); renderMembers();
    input.focus();
    updateGhost();
  }

  function closeBubble() {
    bubble.el.hidden = true;
    input.value = '';
    input.blur();
    if (!game || game.mode !== 'occupy') return;
    var i = game.myOcc;
    game.mode = 'move';
    game.myOcc = -1;
    if (i >= 0 && game.occ[i] === game.meId) delete game.occ[i];
    if (i >= 0) renderCell(i);
    renderKeys(); renderMembers();
  }

  // 기본은 블록 아래, 판 아래쪽 절반에서는 위로 연다
  function placeBubble() {
    if (!game || bubble.el.hidden || game.myOcc < 0) return;
    var i = game.myOcc, cols = game.board.cols, rows = game.board.rows;
    var r = Math.floor(i / cols), c = i % cols;
    var q = xy(r, c);
    var bw = boardSize().w;
    var code = game.board.cells[i].code;
    var w = Math.max(300, Math.min(bw, code.length * 14 + 80));
    bubble.el.style.width = w + 'px';
    var left = Math.max(0, Math.min(bw - w, q.x + cellW / 2 - w / 2));
    var below = r < rows / 2;
    var h = bubble.el.offsetHeight;
    bubble.el.style.left = left + 'px';
    bubble.el.style.top = (below ? q.y + cellH + 16 : q.y - h - 16) + 'px';
    bubble.el.classList.toggle('above', !below);
    bubble.tail.style.left = (q.x + cellW / 2 - left - 9) + 'px';
  }

  function submit() {
    if (!game || game.mode !== 'occupy' || game.pending) return;
    var i = game.myOcc;
    game.pending = true;
    socket.emit('submit', { text: input.value }, function (res) {
      if (!game) return;
      game.pending = false;
      if (res && (res.why === 'frozen' || res.why === 'paused')) return; // 얼음 · 일시정지 중에는 제출이 안 된다 — 점유는 그대로
      closeBubble();
      if (res && res.ok && !res.correct) { wrong(i, '오답'); sfx('wrong'); }
      else if (res && res.ok && res.correct) sfx('correct');
    });
  }

  function wrong(i, label) {
    var el = cellEls[i];
    if (!el) return;
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
    // 칸 밖에 띄운다 (칸 안에 두면 맨 윗줄에서 잘린다)
    var badge = document.createElement('span');
    badge.className = 'wrong-badge';
    badge.textContent = label || '오답';
    var q = xy(Math.floor(i / game.board.cols), i % game.board.cols);
    badge.style.left = (q.x + cellW / 2) + 'px';
    badge.style.top = (q.y - 14) + 'px';
    $('board').appendChild(badge);
    setTimeout(function () { badge.remove(); el.classList.remove('shake'); }, 1000);
  }

  function tryOccupy() {
    if (game.pending) return;
    var i = game.me.r * game.board.cols + game.me.c;
    var cell = game.board.cells[i];
    if (!cell || cell.solved) return;
    var by = game.occ[i];
    if (by && by !== game.meId) { hintOnce(nickOf(by) + ' 님이 점유 중이에요'); return; }
    game.pending = true;
    socket.emit('occupy', {}, function (res) {
      if (!game) return;
      game.pending = false;
      if (!res) return;
      if (res.ok) { openBubble(res.i, res.ms); sfx('occupy'); return; }
      if (res.why === 'taken') hintOnce((res.by || '다른 사람') + ' 님이 점유 중이에요');
    });
  }

  // 자동완성: 친 앞부분이 코드의 앞부분과 같으면 나머지를 채운다 (띄어쓰기는 무시하고 비교)
  function autoOn() {
    if (!game) return false;
    var t = game.paused ? game.pauseAt : now();
    return game.fx.auto > t;
  }
  /** 친 글자 다음에 올 코드의 나머지. 앞부분이 다르면 null, 이미 다 쳤으면 '' */
  function autoRest(code, typed) {
    var a = typed.replace(/\s+/g, '');
    if (!a) return null;
    var k = 0, i = 0;
    for (; i < code.length && k < a.length; i++) {
      if (/\s/.test(code[i])) continue;
      if (code[i] !== a[k]) return null;
      k++;
    }
    if (k < a.length) return null;
    var rest = code.slice(i);
    if (/\s$/.test(typed)) rest = rest.replace(/^\s+/, '');
    return rest.replace(/\s+$/, '') ? rest : '';
  }
  function autoComplete() {
    if (!game || game.paused || !autoOn()) return false;
    var code = game.board.cells[game.myOcc].code;
    var rest = autoRest(code, input.value);
    if (!rest) return false;
    input.value = code;
    input.setSelectionRange(code.length, code.length);
    updateGhost();
    // 채워지는 순간: 번쩍 + "⚡ 자동완성!" + 소리
    var el = bubble.el;
    el.classList.remove('auto-filled'); void el.offsetWidth; el.classList.add('auto-filled');
    clearTimeout(el._fillT);
    el._fillT = setTimeout(function () { el.classList.remove('auto-filled'); }, 900);
    sfx('autoFill');
    return true;
  }
  // 입력란 흐린 글씨 (v0.12.0): 칠 코드를 흐리게 깔고, 맞게 친 만큼 진하게 · 틀린 글자는 빨갛게 하고 커서는 멈춘다.
  //   따옴표 밖 빈칸은 신경 쓰지 않는다 (shared/typing.js — 채점과 같은 기준). 먹구름 중에는 남은 코드를 가린다.
  //   v0.6.3 자동완성: 아이템이 있으면 Tab 표시
  var TYPING = window.CGTyping;
  function caretToEnd() { var n = input.value.length; if (input.selectionStart !== n || input.selectionEnd !== n) input.setSelectionRange(n, n); }
  function typingState() {
    if (!game || game.myOcc < 0 || !game.board.cells[game.myOcc]) return null;
    var code = game.board.cells[game.myOcc].code;
    return { code: code, a: TYPING.align(code, input.value) };
  }
  function updateGhost() {
    var on = !!game && game.mode === 'occupy' && autoOn();
    var t = game ? (game.paused ? game.pauseAt : now()) : 0;
    var cloudy = !!game && game.fx.cloud > t;
    bubble.el.classList.toggle('auto-on', on);
    var st = game && game.mode === 'occupy' ? typingState() : null;
    var done = '', bad = '', rest = '';
    if (st) {
      done = st.code.slice(0, st.a.pos);
      if (st.a.bad >= 0) bad = input.value[st.a.bad] === ' ' ? '␣' : input.value[st.a.bad];
      rest = cloudy ? '' : st.code.slice(st.a.pos);
    }
    var key = done + '\u0001' + bad + '\u0001' + rest + '\u0001' + (on && !bad && input.value ? 1 : 0);
    if (bubble.ghost._key === key) return;
    bubble.ghost._key = key;
    bubble.gDone.textContent = done;
    bubble.gBad.textContent = bad;
    bubble.gRest.textContent = rest;
    bubble.gTab.hidden = !(on && !bad && input.value && st && !st.a.done);
    bubble.el.classList.toggle('typo', !!bad);
    // 커서가 보이게 가로로 밀기
    var g = bubble.ghost, cx = bubble.gCaret.offsetLeft;
    g.scrollLeft = Math.max(0, cx - g.clientWidth + 60);
  }
  input.addEventListener('input', function () {
    // 틀린 글자 뒤로는 더 쳐지지 않는다 (Backspace 로 지우면 다시 진행)
    var st = typingState();
    if (st && st.a.bad >= 0 && input.value.length > st.a.bad + 1) input.value = input.value.slice(0, st.a.bad + 1);
    caretToEnd();
    updateGhost();
  });
  input.addEventListener('beforeinput', function (e) {
    if (!e.inputType || e.inputType.indexOf('insert') !== 0) return;
    var st = typingState();
    if (st && st.a.bad >= 0) {
      e.preventDefault();
      hintOnce('틀린 글자(빨간색)를 Backspace 로 지우세요');
      var el = bubble.el; el.classList.remove('typo-shake'); void el.offsetWidth; el.classList.add('typo-shake');
    }
  });
  ['click', 'select', 'focus', 'keyup'].forEach(function (ev) { input.addEventListener(ev, function () { caretToEnd(); updateGhost(); }); });


  input.addEventListener('keydown', function (e) {
    var k = e.key;
    if (e.isComposing || k === 'Process') return;
    if (k === 'Enter') { e.preventDefault(); if (!e.repeat) submit(); return; }
    if (k === 'Escape') { e.preventDefault(); socket.emit('release'); closeBubble(); return; }
    // v0.12.0: 커서는 늘 끝 (흐린 글씨를 따라 치므로 ← → Home End 로 옮기지 않는다)
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End' || k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); return; }
    if ((e.ctrlKey || e.metaKey) && (k === 'a' || k === 'A')) { e.preventDefault(); return; }
    if (k === 'Tab') {
      // 입력 중 Tab: 자동완성 아이템이 있을 때만 쓴다 (없으면 아무 일도 없음)
      e.preventDefault();
      if (!e.repeat) autoComplete();
    }
  });
  // 창 밖을 눌렀다가 돌아와도 입력창에 다시 초점
  input.addEventListener('blur', function () {
    if (game && game.mode === 'occupy') setTimeout(function () { if (game && game.mode === 'occupy') input.focus(); }, 0);
  });

  // ── 보스 말풍선 ──
  var bossBubble = (function () {
    var el = document.createElement('div');
    el.className = 'bubble boss-bubble';
    el.hidden = true;
    el.innerHTML =
      '<i class="tail"></i>' +
      '<div class="bb-head"><span class="bb-badge">BOSS</span><b class="bb-title"></b><span class="bb-kind"></span></div>' +
      '<pre class="bb-code"></pre>' +
      '<div class="bb-given"></div>' +
      '<label class="bb-answer"><span>출력 결과는?</span><input type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" lang="en" maxlength="200" aria-label="출력 결과"></label>' +
      '<div class="b-bar"><div></div></div>' +
      '<span class="b-hint">Enter 제출 · Esc 포기 · 한 번만 제출할 수 있어요</span>';
    return {
      el: el, title: el.querySelector('.bb-title'), kind: el.querySelector('.bb-kind'), code: el.querySelector('.bb-code'),
      given: el.querySelector('.bb-given'), answer: el.querySelector('.bb-answer'), answerInput: el.querySelector('.bb-answer input'),
      bar: el.querySelector('.b-bar div'), tail: el.querySelector('.tail'), blankInput: null, side: 'left'
    };
  })();
  guardInput(bossBubble.answerInput);
  function bossInputs() { return [bossBubble.answerInput].concat(bossBubble.blankInput ? [bossBubble.blankInput] : []); }
  function bossActiveInput() { return bossBubble.blankInput || bossBubble.answerInput; }

  function openBossBubble(res) {
    var q = res.q;
    game.mode = 'boss';
    bossBubble.side = res.side;
    bossBubble.title.textContent = q.title;
    bossBubble.kind.textContent = q.blank ? '빈칸 채우기' : '출력 결과 맞히기';
    bossBubble.code.innerHTML = '';
    bossBubble.blankInput = null;
    if (q.blank) {
      // 빈칸(___) 자리에 입력칸을 그대로 넣는다
      var parts = q.code.split('___');
      bossBubble.code.appendChild(document.createTextNode(parts[0]));
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'bb-blank';
      inp.setAttribute('autocomplete', 'off'); inp.setAttribute('spellcheck', 'false'); inp.setAttribute('lang', 'en');
      inp.setAttribute('aria-label', '빈칸');
      inp.maxLength = 120;
      inp.style.width = '5ch';
      inp.addEventListener('input', function () { inp.style.width = Math.max(5, inp.value.length + 1) + 'ch'; });
      guardInput(inp);
      bindBossKeys(inp);
      bossBubble.code.appendChild(inp);
      bossBubble.code.appendChild(document.createTextNode(parts.slice(1).join('___')));
      bossBubble.blankInput = inp;
    } else {
      bossBubble.code.textContent = q.code;
    }
    bossBubble.given.textContent = q.input != null ? '입력: ' + q.input : '';
    bossBubble.given.hidden = q.input == null;
    bossBubble.answer.hidden = q.blank;
    bossBubble.answerInput.value = '';
    bossBubble.el.hidden = false;
    $('toast').className = 'toast'; // '보스 등장' 알림이 말풍선을 가리지 않게
    placeBossBubble();
    fitBanner();
    game.bossUntil = now() + res.ms;
    barRun(bossBubble.bar, res.ms);
    renderKeys(); renderMembers();
    bossActiveInput().focus();
  }

  function closeBossBubble() {
    bossBubble.el.hidden = true;
    bossInputs().forEach(function (x) { x.blur(); });
    if (game && game.mode === 'boss') { game.mode = 'move'; renderKeys(); renderMembers(); }
  }

  // 내가 공격해 들어온 반대쪽으로 연다 (왼쪽에서 Delete → 오른쪽에)
  function placeBossBubble() {
    if (!game || bossBubble.el.hidden || !game.boss) return;
    var i = game.boss.i, cols = game.board.cols;
    var r = Math.floor(i / cols), c = i % cols;
    var q = xy(r, c), size = boardSize();
    var w = Math.min(460, size.w);
    bossBubble.el.style.width = w + 'px';
    var right = bossBubble.side === 'left';
    var left = right ? q.x + cellW + 18 : q.x - w - 18;
    if (left + w > size.w) { left = q.x - w - 18; right = false; }
    if (left < 0) { left = q.x + cellW + 18; right = true; }
    left = Math.max(0, Math.min(size.w - w, left));
    var h = bossBubble.el.offsetHeight;
    var top = Math.max(0, Math.min(size.h - h + 20, q.y + cellH / 2 - h / 2));
    bossBubble.el.style.left = left + 'px';
    bossBubble.el.style.top = top + 'px';
    bossBubble.el.classList.toggle('to-right', right);
    bossBubble.el.classList.toggle('to-left', !right);
    bossBubble.tail.style.top = Math.max(14, Math.min(h - 30, q.y + cellH / 2 - top - 9)) + 'px';
  }

  function bossSubmit() {
    if (!game || game.mode !== 'boss' || game.pending) return;
    var text = bossActiveInput().value;
    if (!text.trim()) { hintOnce('답을 입력하세요'); return; }
    game.pending = true;
    socket.emit('boss:submit', { text: text }, function (res) {
      if (!game) return;
      game.pending = false;
      if (res && (res.why === 'frozen' || res.why === 'paused')) return;
      closeBossBubble();
    });
  }

  function bindBossKeys(el) {
    el.addEventListener('keydown', function (e) {
      var k = e.key;
      if (e.isComposing || k === 'Process') return;
      if (k === 'Enter') { e.preventDefault(); if (!e.repeat) bossSubmit(); return; }
      if (k === 'Escape') { e.preventDefault(); socket.emit('boss:giveup'); closeBossBubble(); return; }
      if (k === 'Tab') e.preventDefault();
    });
    el.addEventListener('blur', function () {
      if (game && game.mode === 'boss') setTimeout(function () { if (game && game.mode === 'boss') bossActiveInput().focus(); }, 0);
    });
  }
  bindBossKeys(bossBubble.answerInput);

  function tryBoss(key) {
    if (game.pending) return;
    var b = game.boss;
    if (!b) return;
    var nb = nextToBoss();
    if (nb !== key) {
      hintOnce(key === 'Delete' ? 'Delete 는 보스 바로 왼쪽 칸에서!' : 'Backspace 는 보스 바로 오른쪽 칸에서!');
      return;
    }
    game.pending = true;
    socket.emit('boss:grab', { key: key }, function (res) {
      if (!game) return;
      game.pending = false;
      if (res && res.ok && res.gather) {
        // 집결 보스 잡기 (v0.12.0) — 잡은 뒤에는 자리를 떠나도 된다
        sfx('occupy');
        if (res.got < res.need) toast('잡았어요! ' + res.got + '/' + res.need + ' — 이제 움직여도 돼요', 'good', 1800);
        if (game.boss && game.boss.phase === 'gather' && game.boss.ids.indexOf(game.meId) < 0) game.boss.ids.push(game.meId);
        renderKeys(); renderMembers();
        if (game.boss) { renderCell(game.boss.i - 1); renderCell(game.boss.i + 1); }
        return;
      }
      if (res && res.ok) { openBossBubble(res); sfx('occupy'); }
    });
  }

  // ── 키보드 (이동 상태) ──
  var lastPoke = 0;
  var ARROWS = { ArrowLeft: 'L', ArrowRight: 'R', ArrowUp: 'U', ArrowDown: 'D' };
  function sendMove(msg) {
    game.seq += 1;
    msg.seq = game.seq;
    socket.emit('move', msg);
  }

  // 게임 중 막는 브라우저 단축키 (Ctrl+W·Ctrl+T·Alt+Tab 은 브라우저가 먼저 가져가서 막을 수 없다)
  var CTRL_BLOCK = { f: 1, g: 1, s: 1, p: 1, u: 1, o: 1, h: 1, j: 1, d: 1, r: 1, e: 1, k: 1, l: 1, v: 1 };
  var KEY_BLOCK = { F1: 1, F3: 1, F5: 1, F6: 1, F7: 1, F10: 1 };
  function blockShortcut(e) {
    var ctrl = e.ctrlKey || e.metaKey;
    var k = (e.key || '').toLowerCase();
    if (ctrl && CTRL_BLOCK[k]) return true;
    if (KEY_BLOCK[e.key]) return true;
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home')) return true;
    return false;
  }

  function deckKey(e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return 0;
    var m = /^(Digit|Numpad)([1-59])$/.exec(e.code || '');
    if (!m) return 0;
    if (m[1] === 'Digit' && !e.shiftKey) return 0; // Ctrl+숫자는 브라우저 탭 전환이라 쓰지 않는다
    return Number(m[2]);
  }

  window.addEventListener('keydown', function (e) {
    if (current !== 'game' || !game) return;
    if (!$('overlay-offline').hidden || !$('overlay-kicked').hidden) return;
    if (blockShortcut(e)) { e.preventDefault(); return; }
    // 방치 경고 중이면 어떤 키든 '여기 있어요'
    if (game.idleUntil) { game.idleUntil = 0; $('idle').hidden = true; socket.emit('poke'); }
    else if (now() - lastPoke > 10000) { lastPoke = now(); socket.emit('poke'); } // 긴 코드를 치는 중에도 방치로 보지 않게

    // 개인 덱 (v0.7.0): Ctrl+Shift+1~5 아이템 · Ctrl+Shift+9 방패 — 입력 중에도, 얼음 중에도(막기) 받는다.
    // Shift 를 누르면 e.key 가 '!' 등으로 바뀌므로 키 자리(e.code)로 본다. 숫자 패드는 Ctrl 만 눌러도 된다
    // (윈도에서 Shift+숫자 패드는 Shift 가 풀려서 오기 때문)
    if (aimKey(e)) return; // v0.12.0: 방해 아이템 대상 고르는 중 (숫자 · Enter · Esc)
    var dk = deckKey(e);
    if (dk) {
      e.preventDefault();
      if (!e.repeat && !game.paused && !game.ended) { if (dk === 9) defend(); else useSlot(dk); }
      return;
    }

    // 일시정지 · 우리 조 판 완성: 움직이지 않는다 (Esc 로 점유 풀기만 된다)
    if (game.paused || game.ended) {
      if (e.key !== 'Escape') e.preventDefault();
      return;
    }
    // 얼음: 아무 키도 안 먹는다
    if (game.fx.freeze > now()) {
      if (e.key !== 'Escape') e.preventDefault();
      return;
    }
    // 입력 중: 키는 입력칸이 처리한다
    if (game.mode === 'occupy') { if (document.activeElement !== input) input.focus(); return; }
    if (game.mode === 'boss') { var bi = bossActiveInput(); if (document.activeElement !== bi) bi.focus(); return; }

    var k = e.key;
    var ctrl = e.ctrlKey || e.metaKey;

    // Tab = 오른쪽 방향키, Shift+Tab = 왼쪽 방향키와 같다 (v0.6.4)
    if (k === 'Tab') {
      e.preventDefault();
      k = e.shiftKey ? 'ArrowLeft' : 'ArrowRight';
    }
    if (ARROWS[k]) {
      e.preventDefault();
      var dir = ARROWS[k];
      if (game.fx.confuse > now()) dir = MOVE.reverse(dir); // 혼란: 방향 반대로 (서버도 똑같이)
      game.me = MOVE.step(boardView(), game.me, dir, ctrl); // 미리 움직여 보이기
      renderAvatars();
      sendMove({ dir: ARROWS[k], ctrl: ctrl });
      return;
    }
    if ((k === 'Home' || k === 'End') && ctrl) {
      // Ctrl+Home / Ctrl+End: 판의 맨 처음 칸 / 맨 마지막 칸
      e.preventDefault();
      var which = k === 'Home' ? 'first' : 'last';
      game.me = MOVE.corner(boardView(), which);
      renderAvatars();
      sendMove({ to: which });
      return;
    }
    if (k === 'Home' || k === 'End') {
      e.preventDefault();
      var to = k === 'Home' ? 'home' : 'end';
      game.me = MOVE.edge(boardView(), game.me, to);
      renderAvatars();
      sendMove({ to: to });
      return;
    }
    if (k === 'Enter') { e.preventDefault(); if (!e.repeat) tryOccupy(); return; }
    if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault(); // Backspace 로 뒤로 가기 막기
      if (!e.repeat && game.boss && (game.boss.phase === 'wait' || (game.boss.phase === 'gather' && !iGrabbed()))) tryBoss(k);
      return;
    }
    if (k === 'Process' || e.isComposing) { e.preventDefault(); warnHangul(); return; }
    // 페이지가 스크롤되는 키 막기
    if (k === ' ' || k === 'PageUp' || k === 'PageDown') e.preventDefault();
    if (k.length === 1 && !ctrl && !e.altKey) hintOnce('먼저 블록 위에서 Enter 를 눌러 점유하세요');
  }, true);
})();
