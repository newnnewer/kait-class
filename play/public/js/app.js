/* KAIT-PLAY — 브라우저 쪽 (입장 · 로비 · 방 만들기 · 대기실 · 공식전 팀 선택 · 게임 · 결과) */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var AV = window.CGAvatar;
  var MOVE = window.CGMove;
  var SND = window.CGSound;
  var TEAMS = window.CGTeams;
  // 0.14.0: 팀 이름 (컴퓨터과학자) — 지금 공식전 · 팀 배틀 방이 뽑은 이름. 없으면 'N팀'
  function curNames() { return (cls && cls.names) || (room && room.names) || null; }
  function tl(no, names) { return TEAMS.label(names || curNames(), no); }

  // ── 소리 (6-2): 내 설정 + 공식전은 교사 스위치 ──
  //   v0.12.0: 두 스위치가 따로 — 배경음 · 효과음(Ctrl+S) / 타자음 · 오류음(Ctrl+K)
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
  /** 타자음 · 오류음 (v0.12.0) — 배경음 스위치와 상관없이 타자음 스위치만 따른다 */
  function typeSfx(name) {
    if (!sound.typing) return;
    if (teacherMuted()) return; // 선생님이 학생 소리를 껐다
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
    if (name !== 'wait' && seatMenu) seatMenu.close(); // 0.15.1: 대기실 방장 메뉴
    if (name === 'game') { if (document.activeElement) document.activeElement.blur(); layout(); }
  }

  // ── 연결 ──
  var socket = io({ path: BASE + '/socket.io', transports: ['polling', 'websocket'] });
  var CHARS = ['slime', 'robot', 'cat', 'ghost', 'owl', 'dino', 'alien', 'frog'];
  var COLORS = ['#FFD23F', '#45B1F5', '#FF8FB1', '#7EE0B5', '#FFB347', '#C9A2FF', '#F2F4FA', '#FF6B6B'];
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
      // 인트로 (v0.13.0): 페이지를 열 때마다(새로고침 포함). 방 · 게임으로 돌아가는 사람만 빼고 (게임 중에 끼면 팀이 손해)
      if (!introChecked) { introChecked = true; if (!(res.me && res.where === 'room')) playIntro(); }
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

  // ── 인트로 (v0.13.0): 페이지를 열고 서버와 처음 인사할 때 한 번 (연결이 잠깐 끊겼다 다시 붙을 때는 안 나옴) ──
  //   아무 키를 누른 순간(사용자 입력 안)이라야 브라우저가 소리를 허락한다 → 그때 효과음 + 배경음
  var introChecked = false;
  function playIntro() {
    var I = window.CGIntro;
    if (!I) return;
    I.play({
      onPress: function () {
        SND.unlock();
        if (sound.on) SND.play('intro');
        setTimeout(updateBgm, 700); // 효과음이 끝날 즈음 배경음
      }
    });
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

  // ── 로비 (v0.13.0): 위 공식전 코드 · 아래 두 칸(팀 배틀 | 레이드) ──
  var lobby = { rooms: [], allowRooms: true, openOnly: { 2: false, 3: false } }; // 칸마다 '모집중인 방만 보기'
  var TAG_ORDER = ['출력', '입력', '변수', '연산자', '조건문', '반복문', '리스트', '함수'];
  var LCOL = { 2: { id: 'lob-battle', mode: 'battle', name: '팀 배틀' }, 3: { id: 'lob-coop', mode: 'coop', name: '레이드' } };

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
    if (current !== 'create' || !lobby.allowRooms) {
      room = null;
      if (current !== 'lobby') show('lobby');
    }
    renderLobby();
  });

  function roomsOf(z) {
    var mode = LCOL[z].mode;
    var list = lobby.rooms.filter(function (r) {
      if ((r.mode || 'coop') !== mode) return false;
      return !lobby.openOnly[z] || r.phase === 'waiting';
    });
    list.sort(function (a, b) { return (a.phase === 'waiting' ? 0 : 1) - (b.phase === 'waiting' ? 0 : 1); }); // 모집 중인 방을 앞에
    return list;
  }

  /** 방 한 줄: [모집중] 2팀 · 5/8명 · #조건문 · 5분 — 이름 (팀 배틀은 팀별 자리) */
  function roomRow(r) {
    var playing = r.phase !== 'waiting';
    var li = el('li', 'lroom' + (playing ? ' playing' : ''));
    li.setAttribute('role', 'button');
    li.appendChild(el('span', 'badge' + (playing ? ' play' : ''), playing ? '진행중' : (r.count >= r.max ? '꽉 참' : '모집중')));
    var info = [];
    if (r.mode === 'battle') li.appendChild(el('span', 'lr-game ' + (r.game || 'rush'), GAME_NAME[r.game || 'rush'])); // 0.16.0
    if (r.mode === 'battle') info.push(r.teams + '팀');
    info.push(playing ? r.count + '명' : r.count + '/' + r.max + '명');
    if (playing && r.game !== 'flip') info.push(r.pct + '%'); // 플립 배틀은 진행률이 없다
    else info.push(r.tags.map(function (t) { return '#' + t; }).join(' '), r.limitMin + '분');
    if (!playing && r.bossMode === 'typing') info.push('타이핑 보스');
    li.appendChild(el('span', 'lr-info', info.join(' · ')));
    li.appendChild(el('b', 'lr-name', r.name));
    if (r.mode === 'battle' && !playing && r.teamCounts) {
      var tc = el('span', 'lr-teams');
      r.teamCounts.forEach(function (k, i) {
        var t = el('span', 'lr-team');
        var em = el('em', null, TEAMS.name(r.names, i + 1));
        if (r.game === 'flip') em.style.color = FLIP_COLORS[i];
        t.appendChild(em);
        var dots = '';
        if (r.teamSize > 8) dots = k + '/' + r.teamSize; // 플립 배틀: 팀마다 16명까지라 숫자로
        else for (var d = 0; d < r.teamSize; d++) dots += d < k ? '●' : '○';
        t.appendChild(el('span', null, dots));
        tc.appendChild(t);
      });
      li.appendChild(tc);
    }
    li.onclick = function (e) { joinRoom(r); };
    return li;
  }

  function joinRoom(r) {
    if (r.phase !== 'waiting') { pageToast('진행 중인 방에는 들어갈 수 없어요', 'warn'); return; }
    if (r.count >= r.max) { pageToast('방이 꽉 찼어요', 'warn'); return; }
    socket.emit('room:join', { id: r.id }, function (res) {
      if (!res || !res.ok) { pageToast((res && res.error) || '들어가지 못했어요', 'warn'); return; }
      openWait(res.room);
    });
  }

  function renderLobby() {
    if (ME) {
      $('lobby-avatar').innerHTML = AV.svg(ME.kind, ME.color);
      $('lobby-nick').textContent = ME.nick;
    }
    $('rooms-off').hidden = lobby.allowRooms;
    [2, 3].forEach(function (z) {
      var col = $(LCOL[z].id), mode = LCOL[z].mode;
      var all = lobby.rooms.filter(function (r) { return (r.mode || 'coop') === mode; });
      var open = all.filter(function (r) { return r.phase === 'waiting'; }).length;
      col.querySelector('.lc-count').textContent = '모집중 ' + open + ' · 진행중 ' + (all.length - open);
      var cb = col.querySelector('.lc-create');
      cb.disabled = !lobby.allowRooms;
      cb.onclick = function () { openCreate(mode); };
      var cbx = col.querySelector('.lc-open-cb');
      cbx.checked = lobby.openOnly[z];
      cbx.onchange = function () { lobby.openOnly[z] = cbx.checked; renderLobby(); };
      var ul = col.querySelector('.lc-rooms');
      ul.innerHTML = '';
      var list = roomsOf(z);
      if (!list.length) {
        var e = el('li', 'lempty');
        e.appendChild(el('b', null, all.length ? '지금 모집중인 방이 없어요' : '아직 열린 ' + LCOL[z].name + '이 없어요'));
        e.appendChild(el('span', null, lobby.allowRooms ? '＋ 방 만들기로 첫 방을 열어 보세요' : '선생님이 자유 플레이를 꺼 두었어요'));
        ul.appendChild(e);
      }
      list.forEach(function (r) { ul.appendChild(roomRow(r)); });
    });
  }

  $('btn-profile').onclick = function () {
    // 캐릭터·닉네임 바꾸기: 입장 화면으로 (다시 '입장하기'를 누르면 로비로)
    if (ME) { enter.nick = ME.nick; enter.kind = ME.kind; enter.color = ME.color; }
    showEnter();
  };

  socket.on('closed', function (m) {
    var why = {
      timeout: '10분 동안 시작하지 않아 방이 닫혔어요', idle: '아무도 입력하지 않아 방이 끝났어요', empty: '방이 닫혔어요',
      kicked: '선생님이 공식전에서 내보냈어요', 'class': '선생님이 공식전을 끝냈어요', 'class-idle': '오랫동안 쓰지 않아 공식전이 닫혔어요',
      'room-kicked': '방장이 방에서 내보냈어요'
    }[m.reason] || '방이 닫혔어요';
    closeBubble(); closeBossBubble();
    pageToast(why, 'warn');
  });

  // ── 공식전: 코드로 들어가기 · 팀 선택 ──
  var cls = null; // 서버가 보낸 공식전 정보

  $('class-code').addEventListener('input', function () {
    var v = this.value.replace(/[^0-9]/g, '').slice(0, 4);
    if (v !== this.value) this.value = v;
    $('class-error').textContent = '';
  });
  $('class-join').onsubmit = function (e) {
    e.preventDefault();
    var code = $('class-code').value.trim();
    if (!/^[0-9]{4}$/.test(code)) { $('class-error').textContent = '공식전 코드는 숫자 4자리예요'; return; }
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
    // 게임 중이면 화면은 그대로 (팀별 상황판은 'standings' 로 온다)
    if (current === 'game' && game) { renderSoundBtns(); return; }
    if (current !== 'team') show('team');
    renderTeam();
  });

  // 게임 중에 선생님이 '팀 미선택'으로 옮겼다
  socket.on('class:bench', function () {
    closeBubble(); closeBossBubble();
    game = null;
    show('team');
    renderTeam();
    pageToast('선생님이 팀을 다시 정하고 있어요. 잠시 기다려 주세요', 'warn');
  });

  // 공식전 대기실 (1.0.0: 팀 배틀 대기실과 같은 모양 — 팀 칸마다 한 줄 카드 · 오른쪽 상태 · 방 설정)
  function renderTeam() {
    if (!cls) return;
    var mine = myTeam();
    var s = cls.settings || {};
    var clsFlip = s.game === 'flip';
    var playingNow = cls.phase === 'playing';
    var noPick = cls.teamLock || playingNow; // 0.15.0: 게임 중에는 선생님이 팀을 정해 줌
    $('t-code').textContent = cls.code;
    var total = cls.teams.reduce(function (n, t) { return n + t.members.length; }, 0) + (cls.waiting || 0);
    $('t-count').textContent = total + '명';
    $('t-game').textContent = GAME_NAME[clsFlip ? 'flip' : 'rush'] + ' · ' + (clsFlip ? '빨강 · 파랑' : cls.teams.length + '팀');
    $('t-game').classList.toggle('flip', clsFlip);
    // 오른쪽: 나 · 상태 · 안내
    if (ME) { $('t-avatar').innerHTML = AV.svg(ME.kind, ME.color); $('t-nick').textContent = ME.nick; }
    $('t-picked').textContent = mine ? tl(mine) + ' 선택' : playingNow ? '팀 배정을 기다리는 중' : '팀을 골라 주세요';
    $('t-picked').classList.toggle('none', !mine);
    $('t-teaminfo').textContent = playingNow ? '⏳ 게임 중에는 선생님이 팀을 정해 줘요' : cls.teamLock ? '🔒 선생님이 팀 선택을 잠갔어요 — 정해진 팀으로 참여해요' : mine ? '다른 팀으로 옮기려면 그 팀의 [이 팀으로] 단추' : '팀 칸 아래 [이 팀으로] 단추를 눌러 팀을 골라요';
    $('t-teaminfo').classList.toggle('locked', noPick);
    var st = $('t-status'), txt = st.querySelector('span');
    st.classList.toggle('playing', playingNow);
    st.classList.toggle('pick', !mine && !playingNow);
    txt.textContent = playingNow ? '게임이 진행 중이에요 · 선생님이 팀을 정해 주면 바로 들어가요' : mine ? '선생님이 게임을 시작하기를 기다리는 중' : '먼저 팀을 골라 주세요';
    // 방 설정
    var sum = [['게임', GAME_NAME[clsFlip ? 'flip' : 'rush']], ['태그', (s.tags || []).join(' · ')], ['팀', clsFlip ? '빨강 · 파랑' : cls.teams.length + '팀'], ['게임 시간', s.limitMin + '분']];
    if (!clsFlip) sum.push(['보스', BOSS_MODE[s.bossMode] || '문제 풀이']);
    fillSummary($('t-summary'), sum);
    // 팀 칸 (팀 배틀 대기실과 같은 .wteams · .wteam · .wt-slots)
    var box = $('t-teams');
    box.innerHTML = '';
    var n = cls.teams.length;
    box.className = 'wteams class-teams n' + Math.min(4, n) + (n > 4 ? ' many' : '');
    cls.teams.forEach(function (t) {
      var col = el('section', 'wteam' + (t.no === mine ? ' mine' : ''));
      col.style.setProperty('--tc', teamColor(t.no, clsFlip));
      var hd = el('div', 'wt-head');
      var tn = el('b', null, tl(t.no)); // 내 팀 ★ 은 CSS(.wteam.mine)가 붙인다
      tn.title = TEAMS.desc(cls.names, t.no);
      hd.appendChild(tn);
      hd.appendChild(el('span', 'wt-count', t.members.length + '명'));
      col.appendChild(hd);
      col.appendChild(el('small', 'wt-desc', TEAMS.desc(cls.names, t.no)));
      var g = el('div', 'wt-slots');
      t.members.forEach(function (p) {
        var d = el('div', 'slot' + (ME && p.id === ME.id ? ' me' : '') + (p.bot ? ' bot' : '') + (p.online ? '' : ' off'));
        d.setAttribute('data-pid', p.id);
        var said = chat.say[p.id];
        if (said && said.until > Date.now()) d.appendChild(el('span', 'say', said.text));
        if (p.bot) d.appendChild(el('span', 'bot-badge big', '비트'));
        else if (!p.online) d.appendChild(el('span', 'ready-badge off-badge', '끊김'));
        d.appendChild(avatarSpan(p.kind, p.color, p.bot ? 'av bot-av' : 'av'));
        var nm = el('b', 'nick', p.nick);
        nm.title = p.nick;
        d.appendChild(nm);
        g.appendChild(d);
      });
      if (!t.members.length) g.appendChild(el('div', 'slot empty', '아직 아무도 없어요'));
      col.appendChild(g);
      if (t.no !== mine) {
        var jb = el('button', 'wt-join', '＋ 이 팀으로');
        jb.type = 'button';
        jb.disabled = noPick;
        jb.title = playingNow ? '게임 중에는 선생님이 팀을 정해 줘요' : cls.teamLock ? '선생님이 팀 선택을 잠갔어요' : tl(t.no) + '으로 가기';
        jb.onclick = function () { pickClassTeam(t.no); };
        col.appendChild(jb);
      }
      box.appendChild(col);
    });
    renderChat();
    renderSoundBtns();
  }

  function pickClassTeam(no) {
    if (!cls || no > cls.teams.length || no === myTeam()) return;
    if (cls.phase === 'playing') { pageToast('게임 중이에요 — 선생님이 팀을 정해 주면 바로 들어가요', 'warn'); return; }
    if (cls.teamLock) { pageToast('선생님이 팀 선택을 잠갔어요', 'warn'); return; }
    socket.emit('class:team', { no: no }, function (res) {
      if (!res || !res.ok) pageToast((res && res.error) || '팀을 고르지 못했어요', 'warn');
    });
  }

  $('btn-team-leave').onclick = function () {
    socket.emit('room:leave', {}, function () {});
  };

  // 팀별 상황판 (게임 화면 왼쪽)
  var standings = [];
  socket.on('standings', function (st) { standings = st || []; renderStand(); });
  function renderStand() {
    if (!game || !game.cls) return;
    if (game.flip) { // 블록 수는 'cell' 로도 오지만, 상황판이 오면 맞춘다
      if (standings.length === 2 && standings[0].game === 'flip') game.counts = [standings[0].blocks, standings[1].blocks];
      renderFlipBar();
      return;
    }
    var list = standings.filter(function (x) { return x.count > 0 || x.solved > 0 || x.done; }).slice();
    // 완성한 팀은 순위대로 위에, 나머지는 해결률 순
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
      var name = el('b', null, tl(x.no));
      if (x.no === game.team) name.appendChild(el('small', null, '우리 팀'));
      top.appendChild(name);
      top.appendChild(el('span', 'st-pct', x.rank ? '클리어' : x.pct + '%'));
      mid.appendChild(top);
      var bar = el('i'); var fill = el('b'); fill.style.width = x.pct + '%'; bar.appendChild(fill); mid.appendChild(bar);
      li.appendChild(mid);
      ol.appendChild(li);
    });
  }

  // 우리 팀이 판을 완성했다 → 다른 팀을 기다린다
  socket.on('team:done', function (m) {
    if (!game) return;
    game.ended = true;
    closeBubble(); closeBossBubble();
    $('done-rank').textContent = m.rank ? m.rank + '위' : '끝';
    $('done-sub').textContent = m.clear === false && m.reason === 'idle' ? '아무도 입력하지 않아 우리 팀은 끝났어요 · 다른 팀을 기다리는 중' : '걸린 시간 ' + mmss(m.ms) + ' · 다른 팀이 끝나기를 기다리는 중';
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
  // 0.16.0: 게임 이름 — 블록 러시(예전 블록 점령전) / 플립 배틀
  var GAME_NAME = { rush: '블록 러시', flip: '플립 배틀' };
  var GAME_HELP = {
    rush: '팀마다 맵을 하나씩 받아 블록을 먼저 다 깨는 팀이 이겨요',
    flip: '두 팀이 맵 하나에서 상대 색 블록을 뒤집어요 · 끝났을 때 블록이 많은 팀 승'
  };
  var BOSS_MODE = { quiz: '문제 풀이', typing: '타이핑' };
  var BOSS_MODE_HELP = {
    quiz: '보스가 빈칸 채우기 · 출력 결과 맞히기 문제를 내요 (한 번만 제출)',
    typing: '보스 코드를 한 줄씩 그대로 쳐서 깨요 (틀린 줄은 다시 · 시간은 5초 + 줄마다 7초)'
  };
  function optDefault(k) { return OPTIONS && OPTIONS[k] ? OPTIONS[k].def : null; }

  function openCreate(mode) {
    cr = cr || {
      tags: [], max: optDefault('max') || 4, teams: optDefault('roomTeams') || 2, teamSize: optDefault('teamSize') || 4, limitMin: optDefault('limitMin') || 5,
      botSpeed: optDefault('botSpeed') || 'normal', auto: true, blocks: 72, bossMode: 'quiz',
      game: 'rush', flipMin: optDefault('flipMin') || 4, flipSize: optDefault('flipTeamSize') || 8, flipBlocks: 120 // 0.16.0
    };
    cr.mode = mode === 'battle' ? 'battle' : 'coop';
    $('cr-error').textContent = '';
    $('btn-open').disabled = false;
    show('create');
    renderCreate();
    createTick();
  }

  // 0.15.1: 방은 1분에 하나 — 남은 시간을 1초마다 세어 보여 주고, 그동안 [방 열기]를 흐리게
  var createWaitUntil = 0, createTimer = null;
  function createTick() {
    var left = Math.ceil((createWaitUntil - Date.now()) / 1000);
    if (left > 0) {
      $('cr-error').textContent = '방은 1분에 하나만 만들 수 있어요 (' + left + '초 뒤에 다시)';
      $('btn-open').disabled = true;
      if (!createTimer) createTimer = setInterval(createTick, 250);
      return;
    }
    if (createTimer) { clearInterval(createTimer); createTimer = null; }
    if (createWaitUntil) {
      createWaitUntil = 0;
      $('cr-error').textContent = '';
      $('btn-open').disabled = false;
    }
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
    var crIsFlip = cr.mode === 'battle' && cr.game === 'flip';
    if (crIsFlip) info.className = 'tag-info' + (cr.tags.length ? '' : ' warn');
    info.textContent = !cr.tags.length ? '태그를 하나 이상 고르세요' : crIsFlip ? '일반 ' + cnt.normal + '문제 출제 (플립 배틀은 보스가 없어요)' :
      '일반 ' + cnt.normal + '문제 · 보스 ' + cnt.boss + '문제 출제' + (cnt.boss ? '' : ' — 보스 문제가 없어 보스가 나오지 않아요');

    var battle = cr.mode === 'battle';
    var flip = battle && cr.game === 'flip'; // 0.16.0: 플립 배틀 (팀 배틀만)
    $('cr-title').textContent = battle ? '팀 배틀 만들기' : '레이드 만들기';
    // 게임 고르기: 블록 러시 / 플립 배틀
    $('cr-game-field').hidden = !battle;
    var gs = $('cr-game');
    gs.innerHTML = '';
    ['rush', 'flip'].forEach(function (v) {
      var b = el('button', 'ss-opt', GAME_NAME[v]);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(v === cr.game));
      b.onclick = function () { cr.game = v; renderCreate(); };
      gs.appendChild(b);
    });
    $('cr-gamehelp').textContent = GAME_HELP[cr.game];
    $('cr-ppl-field').hidden = battle;
    $('cr-team-field').hidden = !battle;
    $('cr-tm-wrap').hidden = flip;
    $('cr-tm-flip').hidden = !flip;
    var tsize = flip ? cr.flipSize : cr.teamSize, tsMax = flip ? 16 : 8;
    $('cr-tm').textContent = cr.teams + '팀';
    $('cr-ts').textContent = tsize + '명';
    $('cr-tm-down').disabled = cr.teams <= 2; $('cr-tm-up').disabled = cr.teams >= 4;
    $('cr-ts-down').disabled = tsize <= 1; $('cr-ts-up').disabled = tsize >= tsMax;
    $('cr-team-help').textContent = flip ? '팀마다 1 ~ 16명 (1:1 도 돼요)' : '2 ~ 4팀 · 팀마다 1 ~ 8명 (1:1 도 돼요)';
    $('cr-hint').textContent = flip
      ? '빨강 · 파랑 두 팀이 맵 하나에서 상대 색 블록을 뒤집어요. 게임 시간이 끝났을 때 우리 색 블록이 많은 팀이 이겨요.'
      : battle
      ? '팀마다 같은 맵 · 같은 문제로 겨뤄요. 보스를 잡으면 다른 팀을 공격하는 방해 아이템과 방패가 나와요.'
      : '혼자서도, 친구와 함께도 · 모두가 맵 하나를 같이 깨요. 다른 팀을 공격하는 아이템과 방패는 나오지 않아요.';
    // 게임 시간: 플립 배틀은 3 · 4 · 5분 고르기
    $('cr-flipmin-field').hidden = !flip;
    $('cr-lim-field').hidden = flip;
    var fm = $('cr-flipmin');
    fm.innerHTML = '';
    ((o.flipMin || {}).list || [3, 4, 5]).forEach(function (v) {
      var b = el('button', 'seg-btn', v + '분');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(v === cr.flipMin));
      b.onclick = function () { cr.flipMin = v; renderCreate(); };
      fm.appendChild(b);
    });
    $('cr-boss-field').parentNode.hidden = flip; // 플립 배틀은 보스 · 아이템 없음
    $('cr-bothelp').textContent = flip ? '대기실에서 방장이 비트를 부를 수 있어요 (비트도 인원에 들어가요)' : '대기실에서 방장이 비트를 부를 수 있어요 (비트도 인원에 들어가요 · 보스는 안 잡음)';
    $('cr-ppl').textContent = cr.max;
    $('cr-ppl-down').disabled = cr.max <= 2;
    $('cr-ppl-up').disabled = cr.max >= 16;
    var lim = (o.limitMin || {}), limMin = lim.min || 1, limMax = lim.max || 30;
    if (document.activeElement !== $('cr-lim')) $('cr-lim').value = cr.limitMin;
    $('cr-lim-down').disabled = cr.limitMin <= limMin;
    $('cr-lim-up').disabled = cr.limitMin >= limMax;
    // 0.15.0 보스 방식: 문제 풀이 / 타이핑
    var bm = $('cr-bossmode');
    bm.innerHTML = '';
    ['quiz', 'typing'].forEach(function (v) {
      var b = el('button', 'ss-opt', BOSS_MODE[v]);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(v === cr.bossMode));
      b.onclick = function () { cr.bossMode = v; renderCreate(); };
      bm.appendChild(b);
    });
    $('cr-bosshelp').textContent = BOSS_MODE_HELP[cr.bossMode];
    var sb = $('cr-botspeed');
    sb.innerHTML = '';
    ((o.botSpeed || {}).list || ['slow', 'normal', 'fast']).forEach(function (v) {
      var b = el('button', 'seg-btn', BOT_SPEED[v] || v);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(v === cr.botSpeed));
      b.onclick = function () { cr.botSpeed = v; renderCreate(); };
      sb.appendChild(b);
    });
    $('cr-auto').setAttribute('aria-pressed', String(cr.auto));
    var blk = flip ? cr.flipBlocks : cr.blocks;
    $('cr-blk').textContent = cr.auto ? '자동' : String(blk);
    $('cr-blk-down').disabled = cr.auto || (flip ? blk <= 40 : blk <= 24);
    $('cr-blk-up').disabled = cr.auto || (flip ? blk >= 320 : blk >= 144);
    $('cr-blkhelp').textContent = flip ? (cr.auto ? '' : '40 ~ 320블록, 10블록씩')
      : cr.auto ? (battle ? '시작할 때 가장 큰 팀 인원 × 24블록 (최대 96블록)' : '시작할 때 인원 × 24블록 (최대 96블록)') : '24 ~ 144블록, 12블록씩 (' + (cr.blocks / 12) + '줄)';

    if (ME) { $('cr-avatar').innerHTML = AV.svg(ME.kind, ME.color); $('cr-name').textContent = ME.nick + '의 방'; }
    var sum = flip ? [
      ['방식', '팀 배틀'], ['게임', GAME_NAME.flip], ['태그', cr.tags.length ? cr.tags.join(' · ') : '없음'],
      ['팀', '빨강 · 파랑 × ' + cr.flipSize + '명 (최대 ' + (2 * cr.flipSize) + '명)'], ['게임 시간', cr.flipMin + '분'],
      ['블록 수', cr.auto ? '자동' : cr.flipBlocks + '블록'], ['비트 속도', BOT_SPEED_SHORT[cr.botSpeed] || '보통']
    ] : [
      ['방식', battle ? '팀 배틀' : '레이드']].concat(battle ? [['게임', GAME_NAME.rush]] : []).concat([['태그', cr.tags.length ? cr.tags.join(' · ') : '없음'],
      battle ? ['팀', cr.teams + '팀 × ' + cr.teamSize + '명 (최대 ' + (cr.teams * cr.teamSize) + '명)'] : ['최대 인원', cr.max + '명'], ['게임 시간', cr.limitMin + '분'],
      ['블록 수', cr.auto ? '자동' : cr.blocks + '블록'], ['보스', BOSS_MODE[cr.bossMode]], ['비트 속도', BOT_SPEED_SHORT[cr.botSpeed] || '보통']
    ]);
    fillSummary($('cr-summary'), sum);
    $('btn-open').disabled = !cr.tags.length || createWaitUntil > Date.now(); // 0.15.1: 1분 제한 동안은 흐리게
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
  $('cr-tm-down').onclick = function () { cr.teams = Math.max(2, cr.teams - 1); renderCreate(); };
  $('cr-tm-up').onclick = function () { cr.teams = Math.min(4, cr.teams + 1); renderCreate(); };
  function crFlip() { return cr.mode === 'battle' && cr.game === 'flip'; }
  $('cr-ts-down').onclick = function () { if (crFlip()) cr.flipSize = Math.max(1, cr.flipSize - 1); else cr.teamSize = Math.max(1, cr.teamSize - 1); renderCreate(); };
  $('cr-ts-up').onclick = function () { if (crFlip()) cr.flipSize = Math.min(16, cr.flipSize + 1); else cr.teamSize = Math.min(8, cr.teamSize + 1); renderCreate(); };
  $('cr-auto').onclick = function () { cr.auto = !cr.auto; renderCreate(); };
  $('cr-blk-down').onclick = function () { if (crFlip()) cr.flipBlocks = Math.max(40, cr.flipBlocks - 10); else cr.blocks = Math.max(24, cr.blocks - 12); renderCreate(); };
  $('cr-blk-up').onclick = function () { if (crFlip()) cr.flipBlocks = Math.min(320, cr.flipBlocks + 10); else cr.blocks = Math.min(144, cr.blocks + 12); renderCreate(); };

  $('btn-open').onclick = function () {
    if (!cr.tags.length) return;
    $('btn-open').disabled = true;
    var flip = crFlip();
    var settings = {
      mode: cr.mode, teams: cr.teams, teamSize: flip ? cr.flipSize : cr.teamSize,
      tags: cr.tags, max: cr.max, limitMin: flip ? cr.flipMin : cr.limitMin, blocks: cr.auto ? 0 : (flip ? cr.flipBlocks : cr.blocks),
      botSpeed: cr.botSpeed, bossMode: cr.bossMode, game: flip ? 'flip' : 'rush'
    };
    socket.emit('room:create', { settings: settings }, function (res) {
      if (!res || !res.ok) {
        $('btn-open').disabled = false;
        $('cr-error').textContent = (res && res.error) || '방을 열지 못했어요';
        if (res && res.waitMs) { createWaitUntil = Date.now() + res.waitMs; createTick(); }
        return;
      }
      if (res.gapMs) createWaitUntil = Date.now() + res.gapMs;
      openWait(res.room);
    });
  };

  // ── 대기실 ──
  var room = null; // 서버가 보낸 방 정보 + closeAt
  // 0.14.0 준비 재촉: 준비 안 한 채 기다리기 시작한 시각 (서버가 보낸 waitMs 로 화면에서 이어서 센다)
  function stampWait(r) { (r.members || []).forEach(function (p) { p.waitFrom = p.waitMs ? Date.now() - p.waitMs : 0; }); }

  function openWait(r) {
    room = r;
    room.closeAt = Date.now() + r.closeMs;
    stampWait(r);
    room.autoAt = r.autoMs ? Date.now() + r.autoMs : 0;
    if (current !== 'game') show('wait');
    renderWait();
  }

  socket.on('room', function (r) {
    var wasPlaying = room && room.phase === 'playing';
    // v0.11.0: 대기실에 사람이 새로 들어오면 방장에게 '딩동' (비트 · 나 자신은 빼고)
    if (room && room.id === r.id && r.phase === 'waiting' && ME && r.hostId === ME.id) {
      var before = {};
      (room.members || []).forEach(function (p) { before[p.id] = 1; });
      var someone = (r.members || []).some(function (p) { return !before[p.id] && !p.bot && p.id !== ME.id; });
      if (someone) sfx('join');
    }
    var lastTick = room && room.lastAutoTick;
    room = r;
    room.closeAt = Date.now() + r.closeMs;
    stampWait(r);
    room.autoAt = r.autoMs ? Date.now() + r.autoMs : 0;
    room.lastAutoTick = lastTick;
    // 게임 중에는 대기실 화면으로 바꾸지 않는다 ('state' 로 게임 화면이 온다)
    if (r.phase === 'waiting' && current !== 'game') { show('wait'); renderWait(); }
    else if (r.phase === 'waiting' && current === 'game' && !wasPlaying) { /* 결과가 곧 온다 */ }
    if (current === 'wait') renderWait();
  });

  // 대기실 사람 카드 하나 (레이드 슬롯 · 팀 배틀 팀 칸 공용)
  // 0.15.1: 캐릭터 + 닉네임 한 줄 (아래 작은 글씨 줄은 없앰) · 방장 관리는 카드를 누르면 뜨는 메뉴로
  function personSlot(p, opt) {
    var meId = ME && ME.id, amHost = room.hostId === meId;
    var d = el('div', 'slot' + (p.id === meId ? ' me' : '') + (p.bot ? ' bot' : '') + (p.online ? '' : ' off') + (p.ready ? ' ready' : ''));
    d.setAttribute('data-pid', p.id);
    var said = chat.say[p.id];
    if (said && said.until > Date.now()) d.appendChild(el('span', 'say', said.text));
    if (p.id === room.hostId) d.appendChild(el('span', 'host-badge', '방장'));
    else if (p.bot) d.appendChild(el('span', 'bot-badge big', '비트'));
    else if (!p.online) d.appendChild(el('span', 'ready-badge off-badge', '끊김'));
    else d.appendChild(el('span', 'ready-badge' + (p.ready ? ' on' : ''), p.ready ? '✔ 준비' : '준비 전'));
    d.appendChild(avatarSpan(p.kind, p.color, p.bot ? 'av bot-av' : 'av'));
    var nm = el('b', 'nick', p.nick);
    nm.title = p.nick;
    d.appendChild(nm);
    // 방장 관리 (마우스): 카드를 누르면 팀 옮기기 · 내보내기 / 비트 빼기 메뉴
    if (amHost && p.id !== meId && room.phase === 'waiting') {
      d.classList.add('pickable');
      d.tabIndex = 0;
      d.setAttribute('role', 'button');
      d.setAttribute('aria-label', p.nick + ' — 팀 옮기기 · ' + (p.bot ? '빼기' : '내보내기'));
      d.onclick = function (ev) { ev.stopPropagation(); seatMenu.open(p.id, opt.team || 0); };
      d.onkeydown = function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); seatMenu.open(p.id, opt.team || 0); } };
    }
    return d;
  }

  // 0.15.1: 방장 메뉴 — 대기실은 자주 다시 그려지므로 카드 밖(body)에 하나만 두고, 다시 그릴 때마다 자리를 맞춘다
  var seatMenu = (function () {
    var box = null, pid = null, armAt = 0;
    function close() { if (box) box.hidden = true; pid = null; armAt = 0; }
    function find(id) {
      var who = null;
      (room && room.members || []).forEach(function (x) { if (x.id === id) who = x; });
      return who;
    }
    function teamOf(id) {
      var no = 0;
      (room && room.teams || []).forEach(function (t) { if (t.members.some(function (x) { return x.id === id; })) no = t.no; });
      return no;
    }
    function place() {
      if (!box || box.hidden || !pid) return;
      var card = document.querySelector('#screen-wait .slot[data-pid="' + pid + '"]');
      if (!card) { close(); return; }
      var r = card.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
      var x = Math.min(window.innerWidth - w - 8, Math.max(8, r.left));
      var y = r.bottom + 6;
      if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 6);
      box.style.left = x + 'px';
      box.style.top = y + 'px';
    }
    function build() {
      var p = find(pid);
      if (!p || !room || room.phase !== 'waiting' || !ME || room.hostId !== ME.id) { close(); return; }
      box.innerHTML = '';
      box.appendChild(el('b', 'sm-title', p.nick));
      if (room.mode === 'battle') {
        var cur = teamOf(p.id);
        box.appendChild(el('span', 'sm-label', '팀 옮기기'));
        room.teams.forEach(function (t) {
          var b = el('button', 'sm-item sm-team' + (t.no === cur ? ' cur' : ''));
          b.type = 'button';
          b.style.setProperty('--tc', TEAM_COLORS[(t.no - 1) % TEAM_COLORS.length]);
          b.appendChild(el('i'));
          b.appendChild(document.createTextNode(TEAMS.name(room.names, t.no) + (t.no === cur ? ' · 지금 팀' : '')));
          b.disabled = t.no === cur;
          b.onclick = function () { roomAct('move', { id: p.id, no: t.no }); close(); };
          box.appendChild(b);
        });
      }
      var k = el('button', 'sm-item sm-out', p.bot ? '빼기' : (armAt && Date.now() - armAt < 3000 ? '한 번 더 누르면 내보내요' : '내보내기'));
      k.type = 'button';
      k.onclick = function () {
        if (p.bot) { roomBot({ op: 'remove', id: p.id }); close(); return; }
        if (!armAt || Date.now() - armAt > 3000) {
          armAt = Date.now();
          k.textContent = '한 번 더 누르면 내보내요';
          setTimeout(function () { if (box && !box.hidden && Date.now() - armAt >= 3000) build(); }, 3000);
          return;
        }
        roomAct('kick', { id: p.id });
        close();
      };
      box.appendChild(k);
      place();
    }
    function open(id) {
      if (!box) {
        box = el('div', 'seat-menu');
        box.setAttribute('role', 'menu');
        box.hidden = true;
        box.onclick = function (ev) { ev.stopPropagation(); };
        document.body.appendChild(box);
        document.addEventListener('click', function () { close(); });
        document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && box && !box.hidden) { ev.stopPropagation(); close(); } }, true);
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
      }
      if (pid === id && !box.hidden) { close(); return; }
      pid = id; armAt = 0;
      box.hidden = false;
      build();
      var first = box.querySelector('button:not(:disabled)');
      if (first) first.focus();
    }
    /** 대기실을 다시 그린 뒤 — 메뉴가 열려 있으면 내용 · 자리를 맞춘다 (나간 사람이면 닫음) */
    function refresh() { if (box && !box.hidden && pid) build(); }
    return { open: open, close: close, refresh: refresh };
  })();
  function emptySlot(team) {
    var meId = ME && ME.id, amHost = room.hostId === meId, s = room.settings;
    if (amHost && !emptySlot.botShown[team || 0]) {
      emptySlot.botShown[team || 0] = 1;
      var ab = el('button', 'slot empty add-bot');
      ab.type = 'button';
      ab.appendChild(el('i', null, '+'));
      ab.appendChild(el('span', null, '비트 부르기')); // 0.15.1: 비트 속도는 오른쪽 방 설정 표에만
      ab.onclick = function () { roomBot({ op: 'add', no: team || 0 }); };
      return ab;
    }
    var mine = myRoomTeam(), locked = amReady();
    var can = team && team !== mine && !locked;
    var e = el(can ? 'button' : 'div', 'slot empty' + (can ? ' movable' : ''));
    e.appendChild(el('i', null, '?'));
    if (team && team !== mine && locked) e.appendChild(el('span', null, '준비를 풀면 옮길 수 있어요'));
    else if (can) {
      e.type = 'button';
      e.appendChild(el('span', null, '여기로 옮기기')); // 팀 칸 안이라 이름은 빼고 짧게 (좁은 칸에서 줄바꿈되지 않게)
      e.onclick = function (ev) { pickRoomTeam(team); };
    } else e.appendChild(el('span', null, team ? '빈자리' : '친구를 기다리는 중')); // 0.14.0: 팀 칸은 좁아서 짧게
    return e;
  }
  emptySlot.botShown = {};
  function myRoomTeam() {
    if (!room || room.mode !== 'battle' || !ME) return 0;
    for (var k = 0; k < room.teams.length; k++) if (room.teams[k].members.some(function (p) { return p.id === ME.id; })) return room.teams[k].no;
    return 0;
  }
  // 0.14.0: 내가 준비했는지 (준비한 동안은 팀을 못 옮긴다)
  function amReady() {
    if (!room || !ME || room.hostId === ME.id) return false;
    for (var k = 0; k < room.members.length; k++) if (room.members[k].id === ME.id) return !!room.members[k].ready;
    return false;
  }
  function pickRoomTeam(no) {
    if (!room || room.mode !== 'battle' || room.phase !== 'waiting') return;
    if (amReady() && no !== myRoomTeam()) { $('w-error').textContent = '준비를 풀어야 팀을 옮길 수 있어요'; return; }
    if (no > room.teams.length) return;
    if (no === myRoomTeam()) return;
    roomAct('team', { no: no });
  }
  function roomAct(op, msg) {
    $('w-error').textContent = '';
    socket.emit('room:' + op, msg || {}, function (res) {
      if (!res || !res.ok) $('w-error').textContent = (res && res.error) || '하지 못했어요';
    });
  }

  function renderWait() {
    if (!room) return;
    var s = room.settings, meId = ME && ME.id, battle = room.mode === 'battle';
    var amHost = room.hostId === meId;
    $('w-name').textContent = room.name;
    var flip = battle && s.game === 'flip';
    [].forEach.call(document.querySelectorAll('#screen-wait .rush-only'), function (x) { x.hidden = flip; });
    $('w-mode').textContent = battle ? '팀 배틀 · ' + GAME_NAME[flip ? 'flip' : 'rush'] + ' · ' + s.teams + '팀 × ' + s.teamSize + '명' : '레이드';
    $('w-count').textContent = room.members.length + '/' + s.max;
    emptySlot.botShown = {};
    var slots = $('w-slots'), teams = $('w-teams');
    slots.hidden = battle; teams.hidden = !battle;
    if (battle) {
      teams.innerHTML = '';
      teams.className = 'wteams n' + room.teams.length + (s.teamSize > 4 ? ' big' : '');
      var mine = myRoomTeam();
      room.teams.forEach(function (t) {
        var col = el('section', 'wteam' + (t.no === mine ? ' mine' : ''));
        col.style.setProperty('--tc', teamColor(t.no, flip));
        var hd = el('div', 'wt-head');
        var tn = el('b', null, tl(t.no));
        tn.title = TEAMS.desc(room.names, t.no);
        hd.appendChild(tn); // 0.14.0: 인원 표시 · '우리 팀' 뺌 — 내 팀은 칸 전체를 도드라지게 (.wteam.mine)
        col.appendChild(hd);
        var g = el('div', 'wt-slots');
        t.members.forEach(function (p) { g.appendChild(personSlot(p, { team: t.no })); });
        for (var i = t.members.length; i < s.teamSize; i++) g.appendChild(emptySlot(t.no));
        col.appendChild(g);
        teams.appendChild(col);
      });
    } else {
      slots.innerHTML = '';
      slots.classList.toggle('many', s.max > 8);
      for (var i = 0; i < s.max; i++) {
        var p = room.members[i];
        slots.appendChild(p ? personSlot(p, {}) : emptySlot(0));
      }
    }
    var sum = [['방식', battle ? '팀 배틀' : '레이드']];
    if (battle) sum.push(['게임', GAME_NAME[flip ? 'flip' : 'rush']]);
    sum.push(['태그', s.tags.join(' · ')]);
    sum.push(flip ? ['팀', '빨강 · 파랑 × ' + s.teamSize + '명'] : battle ? ['팀', s.teams + '팀 × ' + s.teamSize + '명'] : ['최대 인원', s.max + '명']);
    sum.push(['게임 시간', s.limitMin + '분'],
      ['블록 수', s.blocks ? s.blocks + '블록' : flip ? '자동' : (battle ? '자동 (가장 큰 팀 × 24)' : '자동 (인원 × 24)')]);
    if (!flip) sum.push(['보스', BOSS_MODE[s.bossMode] || '문제 풀이']);
    sum.push(['비트 속도', BOT_SPEED_SHORT[s.botSpeed] || '보통']);
    if (battle && !flip) sum.push(['방해 아이템', '늘 나옴']);
    fillSummary($('w-summary'), sum);
    // 시작 조건 · 준비 · 자동 시작
    var chk = room.check || { ok: true }, me = null;
    room.members.forEach(function (p) { if (p.id === meId) me = p; });
    $('w-host').hidden = !amHost;
    $('w-guest').hidden = amHost;
    $('btn-start').disabled = !chk.ok;
    var rb = $('btn-ready'), ready = !!(me && me.ready);
    rb.setAttribute('aria-pressed', String(ready));
    rb.firstChild.textContent = ready ? '✔ 준비 완료' : '준비';
    rb.classList.toggle('on', ready);
    $('w-guestinfo').textContent = ready ? '한 번 더 누르면 준비가 풀려요 · 모두 준비하면 15초 뒤 자동 시작' : 'Ctrl + Enter 로 준비! 모두 준비해야 시작할 수 있어요';
    var msg = '';
    if (chk.why === 'rival') msg = battle ? '상대 팀이 없어요 — 다른 팀에도 사람이나 비트가 있어야 시작할 수 있어요' : '';
    else if (chk.why === 'ready') msg = chk.notReady + '명이 아직 준비하지 않았어요';
    if (chk.ok && chk.warn === 'uneven') {
      msg = room.teams.filter(function (t) { return t.members.length; }).map(function (t) { return tl(t.no) + ' ' + t.members.length + '명'; }).join(' · ') + ' — 인원이 달라요';
    }
    $('w-check').textContent = msg;
    $('w-check').hidden = !msg;
    $('w-check').classList.toggle('warn', !!(chk.ok && chk.warn));
    $('btn-fill').hidden = !(amHost && battle && (chk.why === 'rival' || chk.warn === 'uneven'));
    $('w-startinfo').innerHTML = '';
    $('w-startinfo').appendChild(document.createTextNode('지금 시작하면 '));
    $('w-startinfo').appendChild(el('b', null, (flip ? '' : battle ? room.teams.filter(function (t) { return t.members.length; }).length + '팀 · ' : room.members.length + '명 · ') + room.blocksNow + '블록'));
    $('w-startinfo').appendChild(document.createTextNode(battle && !flip ? '(팀마다)으로 정해져요' : '으로 정해져요'));
    tickClocks();
    renderChat();
    renderSoundBtns();
    seatMenu.refresh(); // 0.15.1: 열린 방장 메뉴를 새 카드 자리에 맞춤
  }
  var TEAM_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
  // 0.16.0: 플립 배틀 팀 색 — 1 빨강 · 2 파랑
  var FLIP_COLORS = ['#FF4655', '#2F80FF'];
  function teamColor(no, flip) { return flip ? FLIP_COLORS[(no - 1) % 2] : TEAM_COLORS[(no - 1) % TEAM_COLORS.length]; }

  // ── 대기실 · 팀 선택 화면 채팅 (v0.7.3): 정해 둔 문구만 · 게임 중에는 없음 ──
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
    if (current === 'team') { renderTeam(); } // 1.0.0: 공식전 대기실 카드에 말풍선 (3초 뒤 다시 그려 지움)
    if (current === 'team') setTimeout(function () { if (current === 'team') renderTeam(); }, 3050);
    if (current === 'wait') {
      var slot = document.querySelector('#screen-wait [data-pid="' + m.pid + '"]'); // 1.0.0: 팀 배틀 팀 칸에도
      if (slot) {
        var old = slot.querySelector('.say'); if (old) old.remove();
        slot.appendChild(el('span', 'say', m.text));
        // 3초 뒤 지운다 — 그 사이 대기실이 다시 그려져도 사람 id 로 찾아서
        setTimeout(function () {
          document.querySelectorAll('#screen-wait .say').forEach(function (x) {
            var said = chat.say[x.parentNode.getAttribute('data-pid')];
            if (!said || said.until <= Date.now() + 50) x.remove();
          });
        }, 3050);
      }
    }
    renderChat();
    if (!ME || m.pid !== ME.id) sfx('chat');
  });
  // 키보드: 숫자 1~6 보내기 · ← → 묶음 바꾸기 (대기실 · 팀 선택 화면에서만, 글 칸에 있을 때는 안 함)
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
      if (!res || !res.ok) $('w-error').textContent = (res && res.error) || '비트를 넣지 못했어요';
    });
  }

  $('btn-wait-leave').onclick = function () {
    socket.emit('room:leave', {}, function () {});
  };
  $('btn-ready').onclick = function (e) { roomAct('ready'); };
  $('btn-fill').onclick = function () { roomBot({ op: 'fill' }); };
  $('btn-start').onclick = function () {
    $('btn-start').disabled = true;
    $('w-error').textContent = '';
    socket.emit('room:start', {}, function (res) {
      $('btn-start').disabled = false;
      if (!res || !res.ok) $('w-error').textContent = (res && res.error) || '시작하지 못했어요';
    });
  };

  // ── 결과 ──
  var REASON = { clear: '클리어!', time: '시간 초과', idle: '방치로 끝남', empty: '모두 나감' };
  socket.on('result', function (r) {
    closeBubble(); closeBossBubble();
    game = null;
    $('rs-teams').hidden = true;
    $('rs-graph').hidden = true;
    $('rs-flip').hidden = true;
    $('rs-players').hidden = false;
    $('btn-result-ok').textContent = '대기실로';
    var box = document.querySelector('#overlay-result .result');
    box.classList.toggle('fail', !r.success);
    $('rs-kind').textContent = r.success ? '성공' : '아쉬워요';
    sfx(r.success ? 'win' : 'end');
    $('rs-title').textContent = REASON[r.reason] || '끝';
    var stats = $('rs-stats');
    stats.innerHTML = '';
    [['걸린 시간', mmss(r.ms)], ['깬 블록', r.solved + ' / ' + r.total], ['보스 격파', r.bosses + '마리']].forEach(function (x) {
      var d = el('div'); d.appendChild(el('span', null, x[0])); d.appendChild(el('b', null, x[1])); stats.appendChild(d);
    });
    var ol = $('rs-players');
    ol.innerHTML = '';
    r.players.forEach(function (p) {
      var li = el('li', ME && p.id === ME.id ? 'me' : '');
      li.appendChild(avatarSpan(p.kind, p.color));
      li.appendChild(el('b', null, p.nick + (p.bot ? ' (비트)' : '')));
      li.appendChild(el('em', null, '블록 ' + p.solved + (p.bot ? '' : ' · 보스 ' + p.bosses)));
      ol.appendChild(li);
    });
    $('overlay-result').hidden = false;
    show('wait');
    renderWait();
    setTimeout(function () { $('btn-result-ok').focus(); }, 50);
  });
  function closeResult(focusWait) { $('overlay-result').hidden = true; }

  // 공식전 한 판 결과 — 팀별 순위
  var CLASS_REASON = { clear: '모든 팀 클리어!', time: '시간 종료', stop: '선생님이 게임을 끝냈어요', out: '게임 끝' };
  socket.on('class:result', function (r) {
    if (r.game === 'flip') { showFlipResult(r); return; }
    $('rs-flip').hidden = true;
    var battle = r.mode === 'battle';
    var mine = game && game.team ? game.team : battle ? myRoomTeam() : myTeam();
    closeBubble(); closeBossBubble();
    game = null;
    var my = r.teams.filter(function (t) { return t.no === mine; })[0];
    if (sound.on && !(cls && cls.sfx === false)) SND.play(my && my.rank === 1 ? 'win' : 'end');
    drawRankGraph(r);
    var box = document.querySelector('#overlay-result .result');
    box.classList.toggle('fail', !(my && my.rank === 1));
    $('rs-kind').textContent = CLASS_REASON[r.reason] || '게임 끝';
    $('rs-title').textContent = my ? tl(my.no, r.names) + ' ' + my.rank + '위' : '게임 끝';
    var stats = $('rs-stats');
    stats.innerHTML = '';
    var mineRows = [['걸린 시간', mmss(my ? my.ms : r.ms)], ['깬 블록', my ? my.solved + ' / ' + my.total : '-'], ['보스 격파', (my ? my.bosses : 0) + '마리']];
    mineRows.forEach(function (x) { var d = el('div'); d.appendChild(el('span', null, x[0])); d.appendChild(el('b', null, x[1])); stats.appendChild(d); });
    var ol = $('rs-teams');
    ol.innerHTML = '';
    r.teams.forEach(function (t) {
      var li = el('li', t.no === mine ? 'me' : '');
      li.appendChild(el('span', 'rt-rank', t.rank + '위'));
      li.appendChild(el('b', null, tl(t.no, r.names)));
      li.appendChild(el('em', null, t.clear ? '클리어 · ' + mmss(t.ms) : t.reason === 'forfeit' ? '기권 · ' + t.pct + '%' : '진행률 ' + t.pct + '%'));
      ol.appendChild(li);
    });
    ol.hidden = false;
    // 우리 팀원 기록
    var pl = $('rs-players');
    pl.innerHTML = '';
    (my ? my.members : []).forEach(function (p) {
      var li = el('li', ME && p.nick === ME.nick ? 'me' : '');
      li.appendChild(avatarSpan(p.kind, p.color));
      li.appendChild(el('b', null, p.nick + (p.bot ? ' (비트)' : '')));
      li.appendChild(el('em', null, '블록 ' + p.solved + (p.bot ? '' : ' · 보스 ' + p.bosses)));
      pl.appendChild(li);
    });
    pl.hidden = !(my && my.members.length);
    $('btn-result-ok').textContent = '대기실로';
    $('overlay-result').hidden = false;
    if (battle) { show('wait'); renderWait(); }
    else { show('team'); renderTeam(); }
    setTimeout(function () { $('btn-result-ok').focus(); }, 50);
  });
  $('btn-result-ok').onclick = function () { closeResult(true); };

  // 0.16.0 플립 배틀 결과 — 이긴 팀(또는 무승부) · 마지막 블록 수 · 블록 수 변화 그래프 · 우리 팀원
  var FLIP_REASON = { time: '시간 종료', stop: '선생님이 게임을 끝냈어요', forfeit: '상대 팀 기권', idle: '게임 끝' };
  function showFlipResult(r) {
    var battle = r.mode === 'battle';
    var mine = game && game.team ? game.team : battle ? myRoomTeam() : myTeam();
    closeBubble(); closeBossBubble();
    game = null;
    var names = r.names;
    var my = r.teams.filter(function (t) { return t.no === mine; })[0];
    var win = r.winner && r.winner === mine, draw = !r.winner;
    if (sound.on && !(cls && cls.sfx === false)) SND.play(win ? 'win' : 'end');
    $('rs-graph').hidden = true;
    var box = document.querySelector('#overlay-result .result');
    box.classList.toggle('fail', !win && !draw);
    $('rs-kind').textContent = r.reason === 'forfeit' && r.teams.some(function (t) { return t.out && t.no === mine; }) ? '게임 끝' : (FLIP_REASON[r.reason] || '게임 끝');
    $('rs-title').textContent = draw ? '무승부!' : TEAMS.name(names, r.winner) + ' 승리!';
    // 큰 숫자: 빨강 N : 파랑 M
    var stats = $('rs-stats');
    stats.innerHTML = '';
    [1, 2].forEach(function (no) {
      var t = r.teams.filter(function (x) { return x.no === no; })[0];
      var d = el('div', 'rs-fteam t' + no + (r.winner === no ? ' win' : '') + (no === mine ? ' us' : ''));
      d.appendChild(el('span', null, TEAMS.name(names, no) + (no === mine ? ' · 우리 팀' : '')));
      d.appendChild(el('b', null, (t ? t.blocks : 0) + '블록'));
      stats.appendChild(d);
    });
    $('rs-teams').hidden = true;
    var fc = $('rs-flip');
    fc.innerHTML = '';
    if (window.CGFlipChart && r.history && r.history.length) fc.appendChild(window.CGFlipChart.svg(r.history, { totalMs: r.limitMs, slotMs: r.snapMs, width: 460, height: 150, labels: true }));
    fc.hidden = !fc.firstChild;
    var pl = $('rs-players');
    pl.innerHTML = '';
    (my ? my.members : []).forEach(function (p) {
      var li = el('li', ME && p.nick === ME.nick ? 'me' : '');
      li.appendChild(avatarSpan(p.kind, p.color));
      li.appendChild(el('b', null, p.nick + (p.bot ? ' (비트)' : '')));
      li.appendChild(el('em', null, '뒤집기 ' + p.solved));
      pl.appendChild(li);
    });
    pl.hidden = !(my && my.members.length);
    $('btn-result-ok').textContent = '대기실로';
    $('overlay-result').hidden = false;
    if (battle) { show('wait'); renderWait(); }
    else { show('team'); renderTeam(); }
    setTimeout(function () { $('btn-result-ok').focus(); }, 50);
  }

  // 결과 화면의 순위 변동 그래프 (v0.13.0, 전광판 그래프를 작게) — 판이 끝난 순간까지
  function drawRankGraph(r) {
    var box = $('rs-graph');
    var hist = r.history || [];
    box.hidden = hist.length < 2 || r.teams.length < 2;
    if (box.hidden) return;
    box.innerHTML = '';
    var NS = 'http://www.w3.org/2000/svg';
    function sv(tag, a, text) { var e = document.createElementNS(NS, tag); for (var k in a) e.setAttribute(k, a[k]); if (text != null) e.textContent = text; return e; }
    var W = 460, H = Math.max(140, 58 + r.teams.length * 34), L = 44, R = 92, T = 34, B = 26; // T: 1위 클리어 이름표 자리 (0.14.0)
    var span = Math.max(hist[hist.length - 1].t, 10000), n = Math.max(2, r.teams.length);
    var x = function (t) { return L + (W - L - R) * Math.min(1, t / span); };
    var y = function (k) { return T + (H - T - B) * (k - 1) / (n - 1); };
    var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', role: 'img' });
    for (var k = 1; k <= r.teams.length; k++) {
      svg.appendChild(sv('line', { x1: L, x2: W - R + 10, y1: y(k), y2: y(k), class: 'grid' }));
      svg.appendChild(sv('text', { x: L - 10, y: y(k) + 5, class: 'ylab', 'text-anchor': 'end' }, k + '위'));
    }
    svg.appendChild(sv('text', { x: L, y: H - 6, class: 'xlab', 'text-anchor': 'middle' }, '시작'));
    svg.appendChild(sv('text', { x: x(span), y: H - 6, class: 'xlab', 'text-anchor': 'middle' }, '끝 ' + mmss(span)));
    var mine = game && game.team ? game.team : (r.mode === 'battle' ? myRoomTeam() : myTeam());
    // 0.14.0: 클리어한 팀은 그 순간 자리에 등수 · 시간(1~3위 트로피), 그 뒤 선은 회색
    var marks = sv('g', {});
    r.teams.forEach(function (t) {
      var clear = t.clear && t.rank && t.ms != null ? { rank: t.rank, ms: t.ms } : null;
      var ln = window.CGRankChart.lines(hist, t.no, clear, x, y);
      if (!ln) return;
      var c = TEAM_COLORS[(t.no - 1) % TEAM_COLORS.length];
      svg.appendChild(sv('path', { d: ln.on, class: 'ln' + (t.no === mine ? ' mine' : ''), stroke: c }));
      if (ln.off) svg.appendChild(sv('path', { d: ln.off, class: 'ln off' }));
      svg.appendChild(sv('circle', { cx: ln.last[0], cy: ln.last[1], r: 6, fill: c }));
      svg.appendChild(sv('text', { x: ln.last[0] + 10, y: ln.last[1] + 5, class: 'tlab' + (t.no === mine ? ' mine' : '') }, TEAMS.name(r.names, t.no)));
      if (ln.mark) marks.appendChild(window.CGRankChart.mark(sv, ln.mark, clear, { size: 11, W: W }));
    });
    svg.appendChild(marks);
    box.appendChild(svg);
  }

  function mmss(ms) {
    var t = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(t / 60), sec = t % 60;
    return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  // 대기실 닫힘 · 게임 제한 시간 · 방치 경고 초 세기
  function tickClocks() {
    var t = Date.now();
    if (room && current === 'wait') {
      $('w-close').textContent = mmss(room.closeAt - t);
      var ab = $('w-auto'), left = room.autoAt ? Math.ceil((room.autoAt - t) / 1000) : 0;
      ab.hidden = !(room.autoAt && left > 0 && room.phase === 'waiting');
      if (!ab.hidden) {
        ab.textContent = '모두 준비 완료! ' + left + '초 뒤에 자동으로 시작해요';
        if (left <= 5 && left !== room.lastAutoTick) { room.lastAutoTick = left; sfx('tick'); }
      }
      tickNudge(t);
    }
    if (game && current === 'game') {
      var left = game.endAt - (game.paused ? game.pauseAt : t);
      var tm = $('g-timer');
      tm.textContent = mmss(left);
      tm.classList.toggle('low', left < 30000);
      // 0.16.0: 남은 시간 막대
      var tb = $('time-bar'), pct = Math.max(0, Math.min(100, left / game.totalMs * 100));
      tb.firstChild.style.width = pct + '%';
      tb.setAttribute('aria-valuenow', String(Math.round(pct)));
      tb.classList.toggle('warn', left <= 60000 && left > 30000);
      tb.classList.toggle('low', left <= 30000);
      tb.classList.toggle('paused', !!game.paused);
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

  // ── 준비 재촉 (0.14.0) ──
  // 대기실에 사람이 2명 이상일 때, 준비 안 한 채 20초가 지나면 그 학생 화면에 재촉(띠 · 준비 단추 튐 · 소리),
  // 그 뒤 10초마다 다시(점점 세게: 화면 테두리 깜빡임). 다른 사람 화면에는 그 학생 자리에 ⏳ 와 흔들림.
  var NUDGE_FIRST = 20000, NUDGE_EVERY = 10000;
  var nudge = { level: 0 };
  function nudgeLevel(p, t) {
    if (!p.waitFrom || p.ready || p.bot || p.id === room.hostId) return 0;
    var w = t - p.waitFrom;
    return w < NUDGE_FIRST ? 0 : 1 + Math.floor((w - NUDGE_FIRST) / NUDGE_EVERY);
  }
  function tickNudge(t) {
    var on = room.phase === 'waiting' && room.members.filter(function (p) { return !p.bot; }).length >= 2;
    var mine = 0;
    room.members.forEach(function (p) {
      var lv = on ? nudgeLevel(p, t) : 0;
      if (ME && p.id === ME.id) mine = lv;
      var slot = document.querySelector('#screen-wait .slot[data-pid="' + p.id + '"]');
      if (slot) slot.classList.toggle('slow', lv > 0);
    });
    var banner = $('w-nudge'), rb = $('btn-ready');
    banner.hidden = !mine;
    rb.classList.toggle('nudge', mine > 0);
    if (mine > nudge.level) { // 새 단계: 소리 + (2단계부터) 화면 테두리 깜빡임
      sfx('nudge');
      banner.classList.remove('pop'); void banner.offsetWidth; banner.classList.add('pop');
      if (mine >= 2) {
        var fl = $('nudge-flash');
        fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
      }
    }
    nudge.level = mine;
  }

  // 게임 중 '나가기': 한 번 더 눌러야 나간다 (실수 방지)
  var leaveArm = 0;
  $('btn-leave').onclick = function () {
    var b = $('btn-leave');
    if (Date.now() - leaveArm > 3000) {
      leaveArm = Date.now();
      b.textContent = '한 번 더 누르면 나가요';
      toast('한 번 더 누르면 나가요 (Alt + Q)', 'warn', 2500);
      setTimeout(function () { b.textContent = '나가기 · Alt+Q'; }, 3000);
      return;
    }
    b.textContent = '나가기 · Alt+Q';
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
    // 0.16.0 플립 배틀: 칸은 팀 번호 글자 '1212…' → 칸마다 { t, solved(= 우리 색, Ctrl+방향키가 건너뜀), code(점유하면 받음) }
    var flip = st.game === 'flip';
    if (flip) {
      var myT = st.myTeam || 0;
      st.board = { cols: st.board.cols, rows: st.board.rows, cells: String(st.board.cells).split('').map(function (ch) { var tt = +ch; return { t: tt, solved: tt === myT, code: '' }; }) };
    }
    var players = {};
    st.players.forEach(function (p) { players[p.id] = p; });
    var mine = players[st.meId];
    var occ = {};
    (st.occ || []).forEach(function (o) { occ[o.i] = o.by; });
    closeBubble(); closeBossBubble();
    var t = now(), fx = st.fx || {};
    $('overlay-result').hidden = true;
    var isClass = st.room.mode === 'class' || st.room.mode === 'battle'; // 팀 대전 (공식전 · 팀 배틀)
    game = {
      board: st.board, players: players, meId: st.meId,
      cls: isClass, team: flip ? (st.myTeam || 0) : isClass ? st.room.team : 0, ended: !!st.ended,
      flip: flip, counts: st.counts || [0, 0], banned: flip && st.banned >= 0 ? st.banned : -1, paused: false, pauseAt: 0, occUntil: 0, bossUntil: 0,
      me: { r: mine.r, c: mine.c }, seq: 0, title: st.room.name,
      endAt: t + (st.endMs || 0), totalMs: Math.max(st.totalMs || 0, st.endMs || 0, 1), idleUntil: st.idle ? t + st.idle.ms : 0,
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
    $('g-room').textContent = st.room.name || '레이드';
    $('g-mode').textContent = flip ? (st.room.mode === 'class' ? '공식전' : '팀 배틀') + ' · 플립 배틀 · ' + TEAMS.name(curNames(), game.team)
      : st.room.mode === 'class' ? '공식전 · ' + st.room.name : st.room.mode === 'battle' ? '팀 배틀 · ' + st.room.name : '레이드';
    $('g-mode').classList.toggle('flip-t1', flip && game.team === 1);
    $('g-mode').classList.toggle('flip-t2', flip && game.team === 2);
    $('g-stand-card').hidden = !isClass || flip; // 플립 배틀은 위쪽 가로 막대 하나
    $('flip-bar').hidden = !flip;
    $('deck').hidden = flip; // 플립 배틀은 아이템이 없다
    document.querySelector('#screen-game .feed-card').hidden = flip;
    $('g-progress-card').hidden = isClass;
    $('g-team-title').textContent = isClass ? '우리 팀원' : '우리 팀';
    $('done').hidden = true;
    $('aim').hidden = true; clearTimeout(aimTimer);
    $('paused').hidden = true;
    if (st.paused) setPaused(true);
    var tg = $('g-tags');
    tg.innerHTML = '';
    (st.room.tags || []).forEach(function (x) { tg.appendChild(el('span', null, '#' + x)); });
    $('btn-leave').textContent = '나가기 · Alt+Q';
    $('idle').hidden = !game.idleUntil;
    show('game');
    renderAll();
    renderStand();
    renderDeck(); renderIncoming();
    if (flip) renderFlipBar();
    // 새로고침: 치던 블록과 코드를 이어서 (플립 배틀)
    if (flip && st.mine && game.board.cells[st.mine.i]) { game.board.cells[st.mine.i].code = st.mine.code; openBubble(st.mine.i, st.mine.ms); }
    if (!wasGame && !st.paused && !st.ended && !game.countdownUntil) sfx('start');
    tickCountdown();
    requestAnimationFrame(layout); // 0.16.0: 내 아이템 줄 · 시간 막대까지 그려진 뒤 칸 크기를 다시 잰다 (맵이 아래로 넘치지 않게)
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
    if (game.flip) { // 0.16.0: 블록이 뒤집혔다
      cell.t = m.t;
      cell.solved = m.t === game.team;
      if (m.counts) game.counts = m.counts;
      renderCell(m.i);
      pop(m.i, m.t === game.team ? 'flip-us' : 'flip-them');
      renderFlipBar();
      if (m.t !== game.team && m.by !== game.meId) sfx('flipped'); // 우리 블록을 빼앗김
      return;
    }
    cell.solved = m.solved;
    cell.boss = m.solved ? (m.boss || null) : null;
    renderProgress();
    // 0.14.0: 폭탄 · 레이저는 쓴 칸에서부터 차례로 '드르르륵' 터진다 (판 자료는 바로 바뀌고 화면만 늦게)
    var wait = m.solved ? chainDelay(m) : 0;
    if (wait > 0) {
      cell.pend = (cell.pend || 0) + 1;
      setTimeout(function () {
        if (!game || game.board.cells[m.i] !== cell) return;
        cell.pend -= 1;
        renderCell(m.i);
        pop(m.i, m.via);
        itemFx.cellBurst(m.i, m.via);
      }, wait);
      return;
    }
    renderCell(m.i);
    pop(m.i, m.solved ? (m.via || '') : 'revive');
    if (m.solved && m.via) itemFx.cellBurst(m.i, m.via);
    else if (!m.solved) itemFx.cellBurst(m.i, 'revive');
  });

  // 쉬운 길: 블록 코드가 바뀌었다
  socket.on('code', function (m) {
    if (!game || !game.board.cells[m.i]) return;
    game.board.cells[m.i].code = m.code;
    var el = cellEls[m.i];
    el.querySelector('code').textContent = m.code;
    el.classList.toggle('long', m.code.length > 16);
    pop(m.i, 'easy');
    itemFx.cellBurst(m.i, 'easy');
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
  var VIA_NAME = { bomb: '폭탄으로', laser: '가로 레이저로', vlaser: '세로 레이저로' };
  socket.on('released', function (m) {
    if (!game || m.i !== game.myOcc) return;
    closeBubble();
    if (m.why === 'item') toast((VIA_NAME[m.via] || '아이템으로') + ' 깼어요! 다른 블록으로', 'good', 2200);
    else if (m.why === 'shuffle') toast('뒤섞기! 모두 한 자리로 모였어요 — 흩어져서 다시 점유하세요', 'warn', 2600);
    else { wrong(m.i, '시간 초과'); sfx('wrong'); setBanned(m.i); }
  });

  socket.on('clear', function () { toast('맵을 모두 깼어요! 곧 새 맵이 나와요', 'good', 3000); });

  // ── 보스 ──
  socket.on('boss', function (m) {
    if (!game) return;
    var old = game.boss;
    if (m.i >= 0) {
      game.boss = { i: m.i, phase: m.phase, by: m.by || null, until: now() + m.ms, got: m.got || 0, need: m.need || 0, ids: m.ids || [] };
      if (m.phase === 'wait') { game.radar = null; toast('보스 등장! 옆 자리에서 Delete · Backspace', 'boss', 2200); sfx('bossAppear'); }
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
  // 0.15.0 타이핑 보스: 몇 줄째 깨고 있는지 (팀원 화면의 '공략 중' 표시)
  socket.on('bossline', function (m) {
    if (!game || !game.boss || game.boss.i !== m.i) return;
    game.boss.prog = m.line + '/' + m.total;
    renderCell(m.i);
  });
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
    // good 아이템 · bad 페널티 · attack 우리가 쏜 방해 · hit 다른 팀의 공격을 맞음 · blocked 방패로 막음
    // v0.7.0: get 보스 보상이 덱으로 · gather 집결 보스 성공 보상
    var KIND = { good: ['good', '아이템'], bad: ['bad', '페널티'], attack: ['attack', '공격 발사!'], hit: ['bad', '공격 받음!'], blocked: ['shielded', '방패!'],
      get: [m.lost ? 'bad' : 'good', m.lost ? '내 아이템이 가득 참' : '아이템 획득!'], gather: [m.lost ? 'bad' : 'good', '모두 잡았다!'] }[m.kind] || ['good', '아이템'];
    el.className = 'banner show ' + KIND[0];
    fitBanner();
    el.querySelector('.bn-kind').textContent = KIND[1];
    el.querySelector('.bn-name').textContent = m.kind === 'attack' ? tl(m.to) + '에 ' + m.name : m.name;
    el.querySelector('.bn-desc').textContent = m.desc + ' · ' + m.by;
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.className = 'banner'; }, 2600);
    // 0.14.0: 화면 가장자리 번쩍임 (폭탄 · 레이저는 터질 때 따로)
    if (m.id !== 'bomb' && m.id !== 'laser' && m.id !== 'vlaser' || m.kind !== 'good') {
      screenFlash(m.kind === 'bad' || m.kind === 'hit' ? 'bad' : m.kind === 'attack' ? 'attack' : m.kind === 'blocked' ? 'shield' : 'good');
    }
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
    toast((m.shield ? '방패는 2개까지 — ' : '내 아이템이 가득 차서 ') + m.name + '이(가) 사라졌어요. 아이템을 쓰고 비워 두세요!', 'warn', 2600);
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
    // 방패 칸: 공식전에서만 (자유 플레이라도 가진 게 있으면)
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
  var USE_WHY = { empty: '그 자리는 비어 있어요', 'attacks-off': '선생님이 방해 아이템을 껐어요', 'no-target': '공격할 팀이 없어요 — 아이템은 그대로 있어요',
    'bad-target': '그 팀은 공격할 수 없어요 — 아이템은 그대로 있어요',
    frozen: '얼음 중에는 아이템을 쓸 수 없어요', paused: '일시정지 중이에요', ended: '게임이 끝났어요' };
  // ── 방해 아이템 대상 고르기 (v0.12.0): Ctrl+Shift+번호 → 숫자 키로 팀 번호 (3초 안에 안 고르면 바로 위 순위 팀) ──
  var AIM_MS = 3000, aimTimer = null;
  /** 공격할 수 있는 팀 (우리 팀 · 끝난 팀 · 아무도 없는 팀 빼고) */
  function aimTargets() {
    return standings.filter(function (x) { return x.no !== game.team && !x.done && (x.count > 0 || x.solved > 0); });
  }
  /** 기본 대상: 바로 위 순위 팀 (1등이면 2등) — 서버와 같은 순서 */
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
    box.querySelector('.aim-title').textContent = '🎯 ' + a.item.name + ' — 몇 팀을 공격할까요?';
    var list = box.querySelector('.aim-teams');
    list.innerHTML = '';
    aimTargets().forEach(function (x) {
      var b = el('button', 'aim-team' + (x.no === def ? ' def' : ''));
      b.type = 'button';
      b.appendChild(el('kbd', null, String(x.no)));
      b.appendChild(el('b', null, tl(x.no)));
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
      if (!aimTargets().some(function (x) { return x.no === to; })) { toast(to === game.team ? '우리 팀은 공격할 수 없어요' : TEAMS.josa(tl(to), '은/는') + ' 공격할 수 없어요', 'warn', 1400); return true; }
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
    box.querySelector('.in-title').textContent = '⚠ ' + tl(x.from) + '의 ' + x.name + ' 공격!' + (game.incoming.length > 1 ? ' (+' + (game.incoming.length - 1) + ')' : '');
    box.querySelector('.in-help').textContent = mine > 0 ? '지금 Ctrl+Shift+9 로 막기! (내 방패 ' + mine + ')'
      : (x.holders && x.holders.length ? '방패: ' + x.holders.join(', ') + ' — Ctrl+Shift+9' : '우리 팀에 방패가 없어요');
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
    screenFlash(m.type === 'freeze' ? 'ice' : m.type === 'cloud' ? 'cloud' : m.type === 'auto' ? 'good' : 'bad'); // 0.14.0
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

  // ── 아이템 효과 (0.14.0): 폭탄 · 레이저 차례로 터뜨리기 · 입자 · 빛줄기 · 화면 번쩍임 ──
  var CHAIN_STEP = { laser: 70, vlaser: 70, bomb: 85 };
  var BOMB_ORDER = ['-1,-1', '-1,0', '-1,1', '0,1', '1,1', '1,0', '1,-1', '0,-1']; // 시계 방향
  /** 이 칸이 몇 ms 뒤에 터질지 — 레이저: 쓴 칸에서 멀수록, 폭탄: 왼쪽 위부터 시계 방향 */
  function chainDelay(m) {
    if (m.at == null || !CHAIN_STEP[m.via] || !game) return 0;
    var cols = game.board.cols, r = Math.floor(m.i / cols), c = m.i % cols, r0 = Math.floor(m.at / cols), c0 = m.at % cols;
    var k = m.via === 'laser' ? Math.abs(c - c0) : m.via === 'vlaser' ? Math.abs(r - r0) : BOMB_ORDER.indexOf((r - r0) + ',' + (c - c0)) + 1;
    if (!itemFx.started(m)) itemFx.start(m); // 같은 아이템의 첫 칸에서 한 번: 충격파 · 빛줄기
    return Math.max(0, k) * CHAIN_STEP[m.via] + 60;
  }
  var itemFx = (function () {
    var last = {}; // via → { at, t } (같은 아이템의 칸들이 한꺼번에 오므로 시작 효과는 한 번만)
    function boardBox() { return $('board'); }
    function center(i) {
      var e = cellEls[i];
      return e ? { x: e.offsetLeft + e.offsetWidth / 2, y: e.offsetTop + e.offsetHeight / 2, w: e.offsetWidth, h: e.offsetHeight } : null;
    }
    function add(cls, css, ms) {
      var d = document.createElement('div');
      d.className = cls;
      for (var k in css) d.style.setProperty(k, css[k]);
      boardBox().appendChild(d);
      setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, ms);
      return d;
    }
    var COLORS = { bomb: ['#FFD23F', '#FF9F43', '#FF5C2A', '#fff'], laser: ['#7CF5FF', '#C9FBFF', '#45B1F5', '#fff'], vlaser: ['#7CF5FF', '#C9FBFF', '#45B1F5', '#fff'],
      easy: ['#3DDC97', '#B8FFD9', '#fff'], revive: ['#FF6B81', '#FFB3C6'], gather: ['#FFB347', '#FFD9A6', '#fff'] };
    /** 칸 한 개가 깨질 때: 입자 + 소리 */
    function cellBurst(i, via) {
      var c = center(i), cols = COLORS[via];
      if (!c || !cols) return;
      var n = via === 'bomb' ? 14 : via === 'revive' ? 6 : 9;
      for (var k = 0; k < n; k++) {
        var ang = Math.random() * Math.PI * 2, dist = (via === 'bomb' ? 50 : 34) + Math.random() * 40;
        add('fx-spark', { left: c.x + 'px', top: c.y + 'px', '--dx': Math.cos(ang) * dist + 'px', '--dy': Math.sin(ang) * dist + 'px',
          '--sc': (0.6 + Math.random() * 0.9).toFixed(2), background: cols[k % cols.length], color: cols[k % cols.length] }, 700);
      }
      if (via === 'bomb') {
        add('fx-ring bomb', { left: c.x + 'px', top: c.y + 'px' }, 600);
        sfx('blast');
      } else if (via === 'laser' || via === 'vlaser') sfx('zap');
    }
    /** 아이템을 쓴 순간: 폭탄은 충격파 + 판 흔들림, 레이저는 빛줄기가 쓴 칸에서 양쪽 끝으로 */
    function start(m) {
      last[m.via] = { at: m.at, t: Date.now() };
      var c = center(m.at);
      if (!c) return;
      var wrap = $('board-wrap');
      if (m.via === 'bomb') {
        add('fx-ring big', { left: c.x + 'px', top: c.y + 'px' }, 900);
        add('fx-core', { left: c.x + 'px', top: c.y + 'px' }, 700);
        wrap.classList.remove('fx-quake'); void wrap.offsetWidth; wrap.classList.add('fx-quake');
        setTimeout(function () { wrap.classList.remove('fx-quake'); }, 1100);
        screenFlash('bomb');
      } else {
        var b = boardBox(), horiz = m.via === 'laser';
        var beam = add('fx-beam ' + (horiz ? 'h' : 'v'), horiz
          ? { left: '0px', width: b.offsetWidth + 'px', top: (c.y - c.h * 0.22) + 'px', height: (c.h * 0.44) + 'px', 'transform-origin': c.x + 'px 50%' }
          : { top: '0px', height: b.offsetHeight + 'px', left: (c.x - c.w * 0.22) + 'px', width: (c.w * 0.44) + 'px', 'transform-origin': '50% ' + c.y + 'px' }, 1300);
        beam.style.setProperty('--len', (horiz ? game.board.cols : game.board.rows) * CHAIN_STEP[m.via] + 'ms');
        screenFlash('laser');
      }
    }
    function started(m) { var l = last[m.via]; return !!(l && l.at === m.at && Date.now() - l.t < 800); }
    return { cellBurst: cellBurst, start: start, started: started };
  })();
  /** 화면 가장자리 번쩍임 — 아이템 종류마다 색 */
  function screenFlash(kind) {
    var f = $('fx-flash');
    if (!f) return;
    f.className = 'fx-flash';
    void f.offsetWidth;
    f.className = 'fx-flash go ' + kind;
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
    el.classList.toggle('flip', !!game.flip); // 0.16.0: 플립 배틀 — 칸은 색만 (코드 없음)
    el.style.gridTemplateColumns = 'repeat(' + game.board.cols + ', var(--cw))';
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
    if (game.flip) { // 0.16.0: 빨강(t1) · 파랑(t2) · 우리 색(ours) · 점유(누가 치는 중)
      el.classList.toggle('t1', cell.t === 1);
      el.classList.toggle('t2', cell.t === 2);
      el.classList.toggle('ours', cell.t === game.team);
      el.classList.toggle('banned', game.banned === i && cell.t !== game.team);
      el.classList.toggle('occ-mine', !!mine);
      el.classList.toggle('occ-other', !!other);
      var ftag = el.querySelector('.occ-tag');
      if (other) {
        var fp = game.players[by];
        el.style.setProperty('--occ', fp ? fp.color : '#FFD23F');
        ftag.textContent = nickOf(by);
      } else { el.style.removeProperty('--occ'); ftag.textContent = ''; }
      return;
    }
    var boss = game.boss && game.boss.i === i ? game.boss : null;
    var shown = !!cell.solved && !cell.pend; // 0.14.0: 차례로 터지는 중인 칸은 아직 안 깨진 모양
    el.classList.toggle('solved', shown);
    el.classList.toggle('boss-won', !!(shown && cell.boss));
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
      tag.textContent = boss.prog ? '공략 중 ' + boss.prog : (boss.by === game.meId ? '내가' : nickOf(boss.by)) + ' 공략 중';
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
    gap = game.flip ? (cols > 16 ? 4 : 6) : wrap.clientWidth < 800 ? 5 : 8;
    // 플립 배틀: 칸이 많아(최대 24 × 16) 더 작게까지 줄인다 — 칸에 글자가 없어서 괜찮다
    cellW = Math.max(game.flip ? 22 : 40, Math.min(82, Math.floor((wrap.clientWidth - (cols - 1) * gap) / cols)));
    cellH = Math.max(game.flip ? 20 : 34, Math.min(78, Math.floor((wrap.clientHeight - 24 - (rows - 1) * gap) / rows)));
    if (game.flip) { var sq = Math.min(cellW, cellH * 1.15); cellW = Math.floor(sq); cellH = Math.floor(Math.min(cellH, sq)); }
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

  // 선생님이 공식전의 학생 소리를 껐는지 (팀 선택 화면 · 공식전 중)
  function teacherMuted() { return !!(cls && cls.sfx === false && (current === 'team' || (game && game.cls))); }
  function renderSoundBtns() {
    var teacherOff = teacherMuted();
    ['btn-sfx', 'w-sfx', 't-sfx', 'e-sfx', 'l-sfx'].forEach(function (id) {
      var b = $(id);
      if (!b) return;
      b.textContent = teacherOff ? '소리 꺼짐(선생님)' : (sound.on ? '배경음 켬' : '배경음 끔') + ' · Ctrl+S';
      b.setAttribute('aria-pressed', String(sound.on && !teacherOff));
      b.disabled = teacherOff;
    });
    var t = $('btn-typesnd');
    t.textContent = '타자음 ' + (sound.typing ? '켬' : '끔') + ' · Ctrl+K';
    t.setAttribute('aria-pressed', String(sound.typing));
    t.hidden = teacherOff; // v0.12.0: 배경음과 따로 (배경음을 꺼도 보임)
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
  ['btn-sfx', 'w-sfx', 't-sfx', 'e-sfx', 'l-sfx'].forEach(function (id) {
    $(id).onclick = function () { SND.unlock(); toggleSound(); this.blur(); };
  });

  // ── 배경음 (v0.11.0): 대기실 · 팀 선택 화면은 잔잔한 곡, 게임 중은 게임 곡 (마지막 30초 빠르게) ──
  function updateBgm() {
    var tune = null, fast = false;
    if (!$('overlay-result').hidden) tune = null; // 결과 화면에서는 쉰다
    else if (current === 'game' && game) {
      if (!game.paused && !game.ended) { tune = 'game'; fast = game.endAt - Date.now() < 30000; }
    } else if (current === 'wait' || current === 'team') tune = 'lobby';
    else if (current === 'enter' || current === 'lobby' || current === 'create') tune = 'title'; // v0.13.0
    if (window.CGIntro && window.CGIntro.active()) tune = null; // 인트로 동안은 조용히 (키를 누르면 시작)
    SND.bgm(!!tune && sound.on && !teacherMuted(), fast, tune || 'game');
  }
  setInterval(updateBgm, 250);

  // 단축키 (v0.11.0) — Ctrl+S: 소리 켜기/끄기 (입장 화면 · 로비 · 방 만들기[v0.13.0] · 대기실 · 팀 선택 · 게임 중, 코드 입력 중에도)
  //   Ctrl+Enter: 방장이 게임 시작 (대기실). 한글 입력 상태에서도 되게 키 자리(e.code)로 본다
  window.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    if (e.code === 'KeyS') {
      if (current === 'loading') return; // v0.13.0: 입장 화면 · 로비 · 방 만들기에서도
      e.preventDefault();
      if (!e.repeat) toggleSound();
      return;
    }
    if (e.code === 'KeyK' && current === 'game') {
      e.preventDefault();
      if (!e.repeat) toggleTyping();
      return;
    }
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && current === 'wait') {
      // v0.13.0: 방장 = 시작, 다른 사람 = 준비 / 준비 풀기
      e.preventDefault();
      if (e.repeat || !room || !ME) return;
      if (room.hostId === ME.id) { var b = $('btn-start'); if (!b.disabled) b.click(); else if (room.check && room.check.why === 'ready') $('w-error').textContent = room.check.notReady + '명이 아직 준비하지 않았어요'; }
      else roomAct('ready');
    }
  }, true);

  // v0.13.0: Alt+Q = 나가기 (대기실 · 공식전 팀 선택 · 게임 중). 실수 방지로 두 번 눌러야 나간다.
  //   왼쪽 Alt (오른쪽 Alt 는 한/영 키). 한글 입력 상태에서도 되게 키 자리(e.code)로 본다
  function isAltQ(e) { return e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyQ'; }
  var quitArm = 0;
  window.addEventListener('keydown', function (e) {
    if (!isAltQ(e)) return;
    if (current !== 'wait' && current !== 'team' && current !== 'game') return;
    e.preventDefault();
    if (e.repeat) return;
    if (current === 'game') { if (game) $('btn-leave').click(); return; } // 게임 '나가기' 단추와 같음 (두 번)
    if (Date.now() - quitArm > 3000) {
      quitArm = Date.now();
      pageToast('Alt + Q 를 한 번 더 누르면 ' + (current === 'wait' ? '방' : '공식전') + '에서 나가요', 'warn');
      return;
    }
    quitArm = 0;
    socket.emit('room:leave', {}, function () {});
  }, true);
  // 타자음 · 오류음 켜기/끄기 (버튼 · Ctrl+K, v0.12.0)
  function toggleTyping() {
    if (teacherMuted()) { toast('선생님이 소리를 꺼 두었어요', 'warn'); return; }
    sound.typing = !sound.typing;
    try { localStorage.setItem('kp.typesnd', sound.typing ? '1' : '0'); } catch (e) { /* 저장 못 해도 됨 */ }
    renderSoundBtns();
    if (current === 'game') toast('타자음 ' + (sound.typing ? '켬' : '끔'), 'info', 1000);
    if (sound.typing) { SND.unlock(); typeSfx('type'); }
  }
  $('btn-typesnd').onclick = function () { SND.unlock(); toggleTyping(); this.blur(); };

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
        el.className = 'avatar' + (id === game.meId ? ' mine' : '') + (p.bot ? ' bot' : '') + (game.flip && p.team ? ' tm' + p.team : '');
        el.innerHTML = AV.svg(p.kind, p.color);
        el.title = p.bot ? '🤖 ' + p.nick + ' (비트)' : p.nick;
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
    if (game.flip) list = list.filter(function (p) { return p.team === game.team; }); // 플립 배틀: 두 팀이 한 판 — 목록은 우리 팀만
    list.sort(function (a, b) { return a.id === game.meId ? -1 : b.id === game.meId ? 1 : a.nick.localeCompare(b.nick, 'ko'); });
    var top = list.reduce(function (m, p) { return Math.max(m, p.solved || 0); }, 0);
    list.forEach(function (p) {
      var li = document.createElement('li');
      if (!p.online && p.id !== game.meId) li.className = 'off';
      if (p.bot) li.classList.add('bot');
      // 해결한 블록 수 막대 (v0.7.4) — 팀원 중 가장 많이 푼 사람을 꽉 찬 막대로
      li.innerHTML = '<span class="av">' + AV.svg(p.kind, p.color) + '</span><span class="who"><b></b><span class="mbar"><i></i></span></span><em class="mnum"></em>';
      var gb = game.boss && game.boss.phase === 'gather' ? game.boss : null;
      if (gb && !p.bot) li.classList.add((gb.ids || []).indexOf(p.id) >= 0 ? 'grabbed' : 'ungrabbed');
      li.querySelector('b').textContent = (gb && !p.bot ? ((gb.ids || []).indexOf(p.id) >= 0 ? '✅ ' : '⏳ ') : '') + (p.bot ? '🤖 ' : '') + p.nick + (p.id === game.meId ? ' (나)' : p.bot ? ' (비트)' : '') + (!p.online && p.id !== game.meId ? ' · 연결 끊김' : '');
      var n = p.solved || 0;
      li.querySelector('.mbar i').style.width = (top ? Math.round(n / top * 100) : 0) + '%';
      li.querySelector('.mbar i').style.background = p.color || '';
      li.querySelector('.mnum').textContent = n;
      ul.appendChild(li);
    });
    $('g-count').textContent = list.length;
  }

  // 0.16.0 플립 배틀: 놓은 블록(Esc · 오답 · 시간 초과)은 다른 블록을 뒤집기 전까지 다시 못 잡는다 — 그 블록에 표시
  function setBanned(i) {
    if (!game || !game.flip) return;
    var old = game.banned;
    game.banned = i;
    if (old >= 0) renderCell(old);
    if (i >= 0) renderCell(i);
  }

  // 0.16.0 플립 배틀: 위쪽 가로 막대 — 빨강 | 파랑 블록 비율, 앞선 팀 쪽을 밝게 (같으면 둘 다 보통)
  function renderFlipBar() {
    if (!game || !game.flip) return;
    var bar = $('flip-bar'), c = game.counts || [0, 0], tot = c[0] + c[1] || 1;
    var lead = c[0] > c[1] ? 1 : c[1] > c[0] ? 2 : 0;
    var names = curNames();
    var sides = bar.querySelectorAll('.fb-side');
    [0, 1].forEach(function (k) {
      var sd = sides[k], no = k + 1;
      sd.querySelector('.fb-name').textContent = TEAMS.name(names, no) + (no === game.team ? ' · 우리 팀' : '');
      sd.querySelector('.fb-num').textContent = c[k];
      sd.classList.toggle('lead', lead === no);
      sd.classList.toggle('us', no === game.team);
    });
    var red = c[0] / tot * 100;
    bar.querySelector('.fb-red-fill').style.width = red + '%';
    bar.querySelector('.fb-blue-fill').style.width = (100 - red) + '%';
    bar.classList.toggle('lead1', lead === 1);
    bar.classList.toggle('lead2', lead === 2);
  }

  function renderProgress() {
    if (!game) return;
    if (game.flip) { renderFlipBar(); return; }
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
    if (game.shields) parts.push('<span class="fx-chip fx-shield">팀 방패 ×' + game.shields + '</span>');
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
      label = '클리어'; list = [['', '다른 팀이 끝나기를 기다리는 중']];
    } else if (game.mode === 'occupy') {
      label = '입력 중'; cls = ' typing';
      list = [['', '흐린 글씨를 따라 치기 (띄어쓰기는 무시)'], ['Backspace', '지우기'], ['Enter', '제출'], ['Esc', '점유 풀기']];
      if (game.fx.auto > now()) list.push(['Tab', '자동완성']);
    } else if (game.mode === 'boss') {
      label = '보스 공략'; cls = ' boss';
      list = bossBubble.typing ? [['Enter', '이 줄 제출'], ['Backspace', '틀린 글자 지우기'], ['Esc', '포기']] : [['← →', '커서'], ['Enter', '제출'], ['Esc', '포기']];
    } else {
      label = '이동';
      list = [['← ↑ → ↓ · Tab · Shift+Tab', '한 블록'], ['Home / End', '줄 처음 · 끝'], ['Ctrl + Home / End', '맵 처음 · 끝'], ['Ctrl + 방향키', game.flip ? '상대 색 블록으로 점프' : '점프'], ['Enter', game.flip ? '상대 색 블록 뒤집기' : '블록 점유']];
      var nb = nextToBoss();
      var gat = game.boss && game.boss.phase === 'gather';
      if (gat && iGrabbed()) list.unshift(['', '✅ 잡았어요 — 다른 팀원을 기다리는 중 (움직여도 돼요)']);
      else if (gat && nb) list.unshift([nb, '집결 보스 잡기!']);
      else if (gat) list.unshift(['↑ ↓ + Home / End', '집결 보스 옆으로!']);
      else if (nb) list.unshift([nb, '보스 공략!']);
      if (game.fx.auto > now()) list.push(['Tab', '⚡ 자동완성 (블록 안에서)']);
      else if (game.boss && game.boss.phase === 'wait') list.push(['Delete / Backspace', '보스 왼쪽 / 오른쪽에서']);
    }
    if (game.aim) list = [['숫자', '공격할 팀'], ['Enter', '기본 (바로 위 순위 팀)'], ['Esc', '취소']];
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
      // 점유 입력란은 맞고 틀림에 따라 따로 소리를 낸다 (흐린 글씨, v0.12.0)
      if (!el._ownTypeSound && e.inputType && e.inputType.indexOf('insert') === 0) typeSfx('type');
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
  input._ownTypeSound = true;
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
      if (res && res.ok && !res.correct) { wrong(i, '오답'); sfx('wrong'); setBanned(i); }
      else if (res && res.ok && res.correct) { sfx('correct'); setBanned(-1); }
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
    if (!cell) return;
    if (cell.solved) { if (game.flip) hintOnce('우리 색 블록이에요 — 상대 색 블록에서 Enter!'); return; }
    if (game.flip && game.banned === i) { hintOnce('방금 놓은 블록이에요 — 다른 블록을 뒤집은 뒤에 다시 잡을 수 있어요'); return; }
    var by = game.occ[i];
    if (by && by !== game.meId) { hintOnce(nickOf(by) + ' 님이 ' + (game.flip ? '뒤집는' : '점유') + ' 중이에요'); return; }
    game.pending = true;
    socket.emit('occupy', {}, function (res) {
      if (!game) return;
      game.pending = false;
      if (!res) return;
      if (res.ok && res.code != null && game.board.cells[res.i]) game.board.cells[res.i].code = res.code; // 플립 배틀: 잡을 때마다 새 코드
      if (res.ok) { openBubble(res.i, res.ms); sfx('occupy'); return; }
      if (res.why === 'own') { hintOnce('우리 색 블록이에요 — 상대 색 블록에서 Enter!'); return; }
      if (res.why === 'again') { setBanned(res.i != null ? res.i : i); hintOnce('방금 놓은 블록이에요 — 다른 블록을 뒤집은 뒤에 다시 잡을 수 있어요'); return; }
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
  input.addEventListener('input', function (e) {
    // 틀린 글자 뒤로는 더 쳐지지 않는다 (Backspace 로 지우면 다시 진행)
    var st = typingState();
    if (st && st.a.bad >= 0 && input.value.length > st.a.bad + 1) input.value = input.value.slice(0, st.a.bad + 1);
    // 소리: 맞게 쳤으면 타자음, 방금 친 글자가 틀렸으면 오류음
    if (e.inputType && e.inputType.indexOf('insert') === 0 && !e.isComposing) typeSfx(st && st.a.bad >= 0 ? 'typo' : 'type');
    caretToEnd();
    updateGhost();
  });
  input.addEventListener('beforeinput', function (e) {
    if (!e.inputType || e.inputType.indexOf('insert') !== 0) return;
    var st = typingState();
    if (st && st.a.bad >= 0) {
      e.preventDefault();
      if (!lastKeyRepeat) typeSfx('typo'); // 막힌 뒤에도 누를 때마다 (꾹 눌러 반복되는 건 빼고)
      hintOnce('틀린 글자(빨간색)를 Backspace 로 지우세요');
      var el = bubble.el; el.classList.remove('typo-shake'); void el.offsetWidth; el.classList.add('typo-shake');
    }
  });
  ['click', 'select', 'focus', 'keyup'].forEach(function (ev) { input.addEventListener(ev, function () { caretToEnd(); updateGhost(); }); });


  var lastKeyRepeat = false;
  input.addEventListener('keydown', function (e) {
    lastKeyRepeat = !!e.repeat;
    var k = e.key;
    if (e.isComposing || k === 'Process') return;
    if (k === 'Enter') { e.preventDefault(); if (!e.repeat) submit(); return; }
    if (k === 'Escape') { e.preventDefault(); var escI = game ? game.myOcc : -1; socket.emit('release'); closeBubble(); if (escI >= 0) setBanned(escI); return; }
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
      // 0.15.0 타이핑 보스: 지금 줄을 흐린 글씨로 깔고 따라 친다 (일반 블록 입력란과 같은 방식)
      '<div class="bb-type b-field" hidden>' +
        '<div class="b-ghost show" aria-hidden="true"><span class="g-done"></span><span class="g-bad"></span><i class="g-caret"></i><span class="g-rest"></span></div>' +
        '<input class="b-input" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" lang="en" maxlength="200" aria-label="코드 입력">' +
      '</div>' +
      '<div class="b-bar"><div></div></div>' +
      '<span class="b-hint">Enter 제출 · Esc 포기 · 한 번만 제출할 수 있어요</span>';
    var tf = el.querySelector('.bb-type');
    return {
      el: el, title: el.querySelector('.bb-title'), kind: el.querySelector('.bb-kind'), code: el.querySelector('.bb-code'),
      given: el.querySelector('.bb-given'), answer: el.querySelector('.bb-answer'), answerInput: el.querySelector('.bb-answer input'),
      bar: el.querySelector('.b-bar div'), tail: el.querySelector('.tail'), hint: el.querySelector('.b-hint'), blankInput: null, side: 'left',
      typeField: tf, typeInput: tf.querySelector('.b-input'), ghost: tf.querySelector('.b-ghost'),
      gDone: tf.querySelector('.g-done'), gBad: tf.querySelector('.g-bad'), gCaret: tf.querySelector('.g-caret'), gRest: tf.querySelector('.g-rest'),
      typing: null // 타이핑 보스: { lines, line, els }
    };
  })();
  guardInput(bossBubble.answerInput);
  bossBubble.typeInput._ownTypeSound = true;
  guardInput(bossBubble.typeInput);
  function bossInputs() { return [bossBubble.answerInput, bossBubble.typeInput].concat(bossBubble.blankInput ? [bossBubble.blankInput] : []); }
  function bossActiveInput() { return bossBubble.typing ? bossBubble.typeInput : (bossBubble.blankInput || bossBubble.answerInput); }

  // ── 타이핑 보스 (0.15.0): 한 줄씩 깨기 ──
  function bossTypeLine() { var t = bossBubble.typing; return t ? t.lines[t.line].replace(/^\s+/, '') : ''; }
  function bossTypeState() {
    if (!bossBubble.typing) return null;
    var code = bossTypeLine();
    return { code: code, a: TYPING.align(code, bossBubble.typeInput.value) };
  }
  function renderBossLines() {
    var t = bossBubble.typing;
    if (!t) return;
    t.els.forEach(function (e, k) {
      e.classList.toggle('done', k < t.line);
      e.classList.toggle('cur', k === t.line);
    });
    bossBubble.kind.textContent = '한 줄씩 깨기 · ' + t.line + ' / ' + t.lines.length + '줄';
  }
  function updateBossGhost() {
    var st = bossTypeState();
    var inp = bossBubble.typeInput, done = '', bad = '', rest = '';
    if (st) {
      done = st.code.slice(0, st.a.pos);
      if (st.a.bad >= 0) bad = inp.value[st.a.bad] === ' ' ? '␣' : inp.value[st.a.bad];
      var t = game ? (game.paused ? game.pauseAt : now()) : 0;
      rest = game && game.fx.cloud > t ? '' : st.code.slice(st.a.pos);
    }
    bossBubble.gDone.textContent = done;
    bossBubble.gBad.textContent = bad;
    bossBubble.gRest.textContent = rest;
    bossBubble.el.classList.toggle('typo', !!bad);
    var g = bossBubble.ghost;
    g.scrollLeft = Math.max(0, bossBubble.gCaret.offsetLeft - g.clientWidth + 60);
  }
  (function () {
    var inp = bossBubble.typeInput, repeat = false;
    inp.addEventListener('keydown', function (e) {
      repeat = !!e.repeat;
      var k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End' || k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && (k === 'a' || k === 'A')) e.preventDefault();
    });
    inp.addEventListener('input', function (e) {
      var st = bossTypeState();
      if (st && st.a.bad >= 0 && inp.value.length > st.a.bad + 1) inp.value = inp.value.slice(0, st.a.bad + 1);
      if (e.inputType && e.inputType.indexOf('insert') === 0 && !e.isComposing) typeSfx(st && st.a.bad >= 0 ? 'typo' : 'type');
      var n = inp.value.length; inp.setSelectionRange(n, n);
      updateBossGhost();
    });
    inp.addEventListener('beforeinput', function (e) {
      if (!e.inputType || e.inputType.indexOf('insert') !== 0) return;
      var st = bossTypeState();
      if (st && st.a.bad >= 0) {
        e.preventDefault();
        if (!repeat) typeSfx('typo');
        hintOnce('틀린 글자(빨간색)를 Backspace 로 지우세요');
        var el = bossBubble.el; el.classList.remove('typo-shake'); void el.offsetWidth; el.classList.add('typo-shake');
      }
    });
    ['click', 'select', 'focus', 'keyup'].forEach(function (ev) {
      inp.addEventListener(ev, function () { var n = inp.value.length; if (inp.selectionStart !== n) inp.setSelectionRange(n, n); updateBossGhost(); });
    });
    bindBossKeys(inp);
  })();

  function openBossBubble(res) {
    var q = res.q;
    game.mode = 'boss';
    bossBubble.side = res.side;
    bossBubble.title.textContent = q.title;
    bossBubble.kind.textContent = q.blank ? '빈칸 채우기' : '출력 결과 맞히기';
    bossBubble.code.innerHTML = '';
    bossBubble.blankInput = null;
    bossBubble.typing = null;
    bossBubble.el.classList.toggle('typing', !!q.typing);
    bossBubble.typeField.hidden = !q.typing;
    bossBubble.typeInput.value = '';
    bossBubble.hint.textContent = q.typing ? 'Enter 이 줄 제출 · Esc 포기 · 틀린 줄은 다시 칠 수 있어요' : 'Enter 제출 · Esc 포기 · 한 번만 제출할 수 있어요';
    if (q.typing) {
      // 타이핑 보스: 완성된 코드를 줄마다 보여 주고, 지금 줄을 아래 입력란에서 친다
      var els = q.lines.map(function (line) {
        var d = el('span', 'bb-line', line);
        bossBubble.code.appendChild(d);
        return d;
      });
      bossBubble.typing = { lines: q.lines, line: q.line || 0, els: els };
      renderBossLines();
      updateBossGhost();
    } else if (q.blank) {
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
    bossBubble.given.hidden = q.input == null || !!q.typing;
    bossBubble.answer.hidden = q.blank || !!q.typing;
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
    bossBubble.typing = null;
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
    if (!text.trim()) { hintOnce(bossBubble.typing ? '보이는 코드를 그대로 치세요' : '답을 입력하세요'); return; }
    game.pending = true;
    var typing = bossBubble.typing;
    socket.emit('boss:submit', { text: text }, function (res) {
      if (!game) return;
      game.pending = false;
      if (res && (res.why === 'frozen' || res.why === 'paused')) return;
      if (typing && res && res.ok && (res.more || res.retry)) {
        // 타이핑 보스: 이 줄을 깼으면 다음 줄, 틀렸으면 그 줄 다시
        if (res.more) {
          typing.line = res.line;
          bossBubble.typeInput.value = '';
          sfx('correct');
        } else {
          sfx('wrong');
          hintOnce('아직 이 줄이 덜 쳐졌어요 — 끝까지 똑같이 치세요');
          var e2 = bossBubble.el; e2.classList.remove('typo-shake'); void e2.offsetWidth; e2.classList.add('typo-shake');
        }
        renderBossLines();
        updateBossGhost();
        return;
      }
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
      hintOnce(key === 'Delete' ? 'Delete 는 보스 바로 왼쪽 자리에서!' : 'Backspace 는 보스 바로 오른쪽 자리에서!');
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
    if (isAltQ(e)) return; // 나가기 (위에서 처리)
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

    // 일시정지 · 우리 팀 판 완성: 움직이지 않는다 (Esc 로 점유 풀기만 된다)
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
