/* KAIT-PLAY — 교사 화면 (로그인 · 수업 게임 만들기 · 조 현황 · 시작/일시정지/종료 · 지난 기록) */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var AV = window.CGAvatar;
  var store = {
    get: function (k) { try { return localStorage.getItem('kp.' + k); } catch (e) { return null; } },
    set: function (k, v) { try { if (v == null) localStorage.removeItem('kp.' + k); else localStorage.setItem('kp.' + k, v); } catch (e) { /* 저장 못 해도 된다 */ } }
  };
  var BASE = location.pathname.replace(/\/teacher\/?$/, '');
  var socket = io({ path: BASE + '/socket.io', transports: ['polling', 'websocket'] });

  var TAG_ORDER = ['출력', '입력', '변수', '연산자', '조건문', '반복문', '리스트', '함수'];
  var OPTIONS = null, BANK_TAGS = { normal: [], boss: [] };
  var allowRooms = true;
  var classes = [];
  var cur = null;       // 보고 있는 수업 게임 (서버가 보낸 교사용 정보)
  var standings = [];
  var clockBase = 0;    // 남은 시간을 받은 시각
  var current = 'loading';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function avatarSpan(kind, color) { var s = el('span', 'av'); s.innerHTML = AV.svg(kind, color); return s; }
  function show(name) {
    current = name;
    ['loading', 'login', 'home', 'class'].forEach(function (s) { $('screen-' + s).hidden = s !== name; });
  }
  function toast(text, kind) {
    var t = $('page-toast');
    t.textContent = text;
    t.className = 'toast page-toast show ' + (kind || '');
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.className = 'toast page-toast'; }, 3000);
  }
  function mmss(ms) {
    var t = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(t / 60), s = t % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  // 관리자 요청 — 로그인이 풀렸으면 로그인 화면으로
  function call(ev, msg, done) {
    socket.emit(ev, msg || {}, function (res) {
      if (res && res.auth === false) { store.set('admin', null); show('login'); return; }
      if (done) done(res || { ok: false, error: '응답이 없어요' });
    });
  }

  // ── 연결 · 로그인 ──
  socket.on('connect', function () {
    $('overlay-offline').hidden = true;
    var key = store.get('admin');
    if (!key) { show('login'); return; }
    socket.emit('admin:hello', { key: key }, function (res) {
      if (!res || !res.ok) { store.set('admin', null); show('login'); return; }
      loggedIn(res);
    });
  });
  socket.on('disconnect', function () { setTimeout(function () { if (!socket.connected) $('overlay-offline').hidden = false; }, 1500); });

  $('login-form').onsubmit = function (e) {
    e.preventDefault();
    $('btn-login').disabled = true;
    socket.emit('admin:login', { password: $('login-pw').value }, function (res) {
      $('btn-login').disabled = false;
      if (!res || !res.ok) { $('login-error').textContent = (res && res.error) || '로그인하지 못했어요'; return; }
      $('login-pw').value = '';
      $('login-error').textContent = '';
      store.set('admin', res.key);
      loggedIn(res);
    });
  };

  var pwSource = 'env';
  var DEMO = false;
  function loggedIn(res) {
    OPTIONS = res.options; BANK_TAGS = res.bankTags || BANK_TAGS;
    pwSource = res.pwSource || pwSource;
    DEMO = !!res.demo;
    $('demo-pill').hidden = !DEMO;
    $('btn-pw').hidden = DEMO;                  // 체험 서버: 비밀번호 바꾸기 없음
    allowRooms = res.allowRooms !== false;
    classes = res.classes || [];
    // 새로고침 전에 보던 수업 게임으로 돌아간다
    var last = store.get('class');
    if (last && classes.some(function (c) { return c.code === last; })) { openClass(last); return; }
    showHome();
  }

  $('btn-logout').onclick = function () {
    call('admin:logout', {}, function () { store.set('admin', null); store.set('class', null); show('login'); });
  };

  // ── 목록 · 기록 ──
  var tab = 'classes';
  Array.prototype.forEach.call(document.querySelectorAll('#home-tabs button'), function (b) {
    b.onclick = function () { tab = b.getAttribute('data-tab'); renderHome(); if (tab === 'records') loadRecords(); if (tab === 'bank') loadBank(); };
  });

  function showHome() {
    cur = null;
    store.set('class', null);
    show('home');
    call('admin:list', {}, function (res) { if (res.ok) { classes = res.classes; allowRooms = res.allowRooms !== false; pwSource = res.pwSource || pwSource; renderHome(); } });
    renderHome();
  }

  function renderHome() {
    Array.prototype.forEach.call(document.querySelectorAll('#home-tabs button'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-tab') === tab));
    });
    $('tab-classes').hidden = tab !== 'classes';
    $('tab-records').hidden = tab !== 'records';
    $('tab-bank').hidden = tab !== 'bank';
    $('home-rooms').setAttribute('aria-pressed', String(allowRooms));
    $('pw-warn').hidden = DEMO || pwSource !== 'env';
    var box = $('class-list');
    box.innerHTML = '';
    if (!classes.length) {
      var e = el('div', 'empty');
      e.appendChild(el('b', null, '열려 있는 수업 게임이 없어요'));
      e.appendChild(el('span', null, '새 수업 게임을 누르면 방 코드가 만들어져요'));
      box.appendChild(e);
      return;
    }
    classes.forEach(function (c) {
      var card = el('article', 'class-card');
      card.appendChild(el('b', 'code-chip', c.code));
      var mid = el('div', 'cc-mid');
      mid.appendChild(el('b', null, c.phase === 'playing' ? '게임 진행 중' : '대기 중'));
      mid.appendChild(el('span', 'muted', '학생 ' + c.count + '명 · ' + c.teams + '조 · ' + c.tags.join(' · ')));
      card.appendChild(mid);
      var b = el('button', 'join-btn', '열기');
      b.type = 'button';
      b.onclick = function () { openClass(c.code); };
      card.appendChild(b);
      box.appendChild(card);
    });
  }

  function roomsSwitch(btn) {
    btn.onclick = function () {
      call('admin:rooms', { allow: !allowRooms }, function (res) {
        if (!res.ok) return toast(res.error || '바꾸지 못했어요', 'warn');
        allowRooms = res.allowRooms;
        renderHome();
        if (cur) { cur.allowRooms = allowRooms; renderClass(); }
        toast(allowRooms ? '학생 방 만들기를 켰어요' : '학생 방 만들기를 껐어요');
      });
    };
  }
  roomsSwitch($('home-rooms'));
  roomsSwitch($('c-rooms'));

  var REASON = { clear: '모든 조 완성', time: '시간 종료', stop: '교사가 종료' };
  // 방해 기록: 공격 · 맞음 · 막음 (없으면 빈칸)
  function atkText(a) {
    if (!a || !(a.sent || a.got || a.blocked)) return '';
    return ' · 공격 ' + a.sent + ' · 맞음 ' + a.got + ' · 막음 ' + a.blocked;
  }
  function loadRecords() {
    var box = $('records');
    box.innerHTML = '<p class="muted">불러오는 중…</p>';
    call('admin:records', { n: 30 }, function (res) {
      box.innerHTML = '';
      if (!res.ok) { box.appendChild(el('p', 'error', res.error || '불러오지 못했어요')); return; }
      if (!res.games.length) { var e = el('div', 'empty'); e.appendChild(el('b', null, '아직 기록이 없어요')); e.appendChild(el('span', null, '수업 게임을 한 판 끝내면 여기에 남아요')); box.appendChild(e); return; }
      var table = el('table', 'rec-table');
      var head = el('tr');
      ['날짜', '코드', '태그', '조별 순위 (해결률 · 완성 시간)', '끝난 방식'].forEach(function (h) { head.appendChild(el('th', null, h)); });
      var thead = el('thead'); thead.appendChild(head); table.appendChild(thead);
      var tb = el('tbody');
      res.games.forEach(function (g) {
        var tr = el('tr');
        var d = new Date(g.startedAt);
        tr.appendChild(el('td', 'nowrap', (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')));
        tr.appendChild(el('td', 'mono', g.code));
        tr.appendChild(el('td', null, (g.settings.tags || []).join(' · ')));
        var td = el('td', 'rec-teams');
        (g.result.teams || []).forEach(function (t) {
          var chip = el('span', 'rec-chip' + (t.rank === 1 ? ' first' : ''));
          chip.appendChild(el('b', null, t.rank + '위 ' + t.no + '조'));
          chip.appendChild(document.createTextNode(' ' + t.pct + '%' + (t.clear ? ' · ' + mmss(t.ms) : '') + ' · ' + t.members.length + '명' + (t.bots ? '(봇 ' + t.bots + ')' : '') + atkText(t.atk)));
          td.appendChild(chip);
        });
        tr.appendChild(td);
        tr.appendChild(el('td', 'nowrap', REASON[g.reason] || g.reason));
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      box.appendChild(table);
    });
  }

  // ── 문제 은행 (6단계) ──
  var bk = { list: [], kind: 'normal', tag: '', q: '', show: 150, editing: null, lastPreview: '' };
  function loadBank() {
    $('bk-list').innerHTML = '<p class="muted">불러오는 중…</p>';
    call('bank:list', {}, function (res) {
      if (!res.ok) { $('bk-list').innerHTML = ''; $('bk-list').appendChild(el('p', 'error', res.error || '불러오지 못했어요')); return; }
      bk.list = res.problems;
      // 방 만들기 · 교사 설정의 태그별 문제 수도 새로
      BANK_TAGS = { normal: bk.list.filter(function (p) { return p.kind === 'normal'; }).map(function (p) { return p.tags; }),
        boss: bk.list.filter(function (p) { return p.kind === 'boss'; }).map(function (p) { return p.tags; }) };
      renderBank();
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('#bk-kind button'), function (b) {
    b.onclick = function () { bk.kind = b.getAttribute('data-kind'); bk.show = 150; renderBank(); };
  });
  $('bk-q').addEventListener('input', function () { bk.q = this.value.trim().toLowerCase(); bk.show = 150; renderBank(); });
  $('btn-bk-more').onclick = function () { bk.show += 300; renderBank(); };

  function renderBank() {
    Array.prototype.forEach.call(document.querySelectorAll('#bk-kind button'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-kind') === bk.kind));
    });
    var nN = 0, nB = 0;
    bk.list.forEach(function (p) { if (p.kind === 'boss') nB++; else nN++; });
    $('bk-count').textContent = '일반 ' + nN + '개 · 보스 ' + nB + '개';
    var ofKind = bk.list.filter(function (p) { return p.kind === bk.kind; });
    // 태그 거르기
    var tl = $('bk-tags');
    tl.innerHTML = '';
    [''].concat(TAG_ORDER).forEach(function (t) {
      var n = t ? ofKind.filter(function (p) { return p.tags.indexOf(t) >= 0; }).length : ofKind.length;
      var b = el('button', 'tag-btn', t || '전체');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(bk.tag === t));
      b.appendChild(el('small', null, String(n)));
      b.onclick = function () { bk.tag = t; bk.show = 150; renderBank(); };
      tl.appendChild(b);
    });
    var list = ofKind.filter(function (p) {
      if (bk.tag && p.tags.indexOf(bk.tag) < 0) return false;
      if (bk.q) return (p.code + ' ' + (p.title || '') + ' ' + (p.answers || []).join(' ')).toLowerCase().indexOf(bk.q) >= 0;
      return true;
    });
    var box = $('bk-list');
    box.innerHTML = '';
    if (!list.length) { var e = el('div', 'empty'); e.appendChild(el('b', null, '조건에 맞는 문제가 없어요')); box.appendChild(e); }
    list.slice(0, bk.show).forEach(function (p) {
      var row = el('button', 'bk-row' + (p.kind === 'boss' ? ' boss' : ''));
      row.type = 'button';
      row.setAttribute('aria-label', (p.title || p.code) + ' 고치기');
      if (p.kind === 'boss') {
        var head = el('span', 'bk-head');
        head.appendChild(el('b', null, p.title));
        head.appendChild(el('em', 'bk-type', p.code.indexOf('___') >= 0 ? '빈칸 채우기' : '출력 결과 맞히기'));
        row.appendChild(head);
        row.appendChild(el('code', 'bk-code-view', p.code));
        row.appendChild(el('span', 'bk-ans', '정답: ' + p.answers.join(' | ') + (p.input != null ? '   · 입력: ' + p.input : '')));
      } else {
        row.appendChild(el('code', 'bk-code-view', p.code));
      }
      var tg = el('span', 'tagline');
      p.tags.forEach(function (t) { tg.appendChild(el('span', null, '#' + t)); });
      row.appendChild(tg);
      row.onclick = function () { openEdit(p); };
      box.appendChild(row);
    });
    $('btn-bk-more').hidden = list.length <= bk.show;
    $('btn-bk-more').textContent = '더 보기 (' + (list.length - bk.show) + '개 남음)';
  }

  // 한 문제 고치기
  var editTags = [];
  function renderEditTags() {
    var box = $('bk-f-tags');
    box.innerHTML = '';
    TAG_ORDER.forEach(function (t) {
      var b = el('button', 'tag-btn', t);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(editTags.indexOf(t) >= 0));
      b.onclick = function () { var k = editTags.indexOf(t); if (k >= 0) editTags.splice(k, 1); else editTags.push(t); renderEditTags(); };
      box.appendChild(b);
    });
  }
  function fitCode() { var ta = $('bk-f-code'); ta.rows = Math.max(1, Math.min(14, ta.value.split('\n').length)); }
  $('bk-f-code').addEventListener('input', fitCode);
  function openEdit(p) {
    bk.editing = p;
    var boss = p.kind === 'boss';
    $('bk-edit').classList.toggle('is-boss', boss);
    $('bk-edit-title').textContent = boss ? '보스 문제 고치기' : '일반 문제 고치기';
    $('bk-f-code-label').textContent = boss ? '코드 (여러 줄, 들여쓰기 그대로)' : '코드 (한 줄)';
    $('bk-f-title').value = p.title || '';
    $('bk-f-code').value = p.code;
    $('bk-f-input').value = p.input == null ? '' : p.input;
    $('bk-f-answers').value = (p.answers || []).join(' | ');
    $('bk-try-in').value = '';
    $('bk-try-out').textContent = '';
    $('bk-edit-error').textContent = '';
    $('btn-bk-del').textContent = '이 문제 지우기';
    editTags = p.tags.slice();
    renderEditTags();
    fitCode();
    $('bk-edit').hidden = false;
    setTimeout(function () { $('bk-f-code').focus(); }, 30);
  }
  function editFields() {
    return { title: $('bk-f-title').value, code: $('bk-f-code').value, input: $('bk-f-input').value, answers: $('bk-f-answers').value,
      tags: TAG_ORDER.filter(function (t) { return editTags.indexOf(t) >= 0; }) };
  }
  $('btn-bk-cancel').onclick = function () { $('bk-edit').hidden = true; };
  $('bk-edit-form').onsubmit = function (e) {
    e.preventDefault();
    $('btn-bk-save').disabled = true;
    call('bank:update', { id: bk.editing.id, fields: editFields() }, function (res) {
      $('btn-bk-save').disabled = false;
      if (!res.ok) { $('bk-edit-error').textContent = res.error || '저장하지 못했어요'; return; }
      $('bk-edit').hidden = true;
      toast('저장했어요 — 다음 게임부터 나와요');
      loadBank();
    });
  };
  armed($('btn-bk-del'), '이 문제 지우기', function () {
    call('bank:remove', { id: bk.editing.id }, function (res) {
      if (!res.ok) { $('bk-edit-error').textContent = res.error || '지우지 못했어요'; return; }
      $('bk-edit').hidden = true;
      toast('지웠어요');
      loadBank();
    });
  });
  function tryGrade() {
    var f = editFields();
    call('bank:try', { kind: bk.editing.kind, code: f.code, answers: f.answers, text: $('bk-try-in').value }, function (res) {
      var o = $('bk-try-out');
      o.textContent = res.ok ? (res.correct ? '정답으로 채점돼요' : '오답으로 채점돼요') : '';
      o.className = 'bk-try-out ' + (res.correct ? 'good' : 'bad');
    });
  }
  $('btn-bk-try').onclick = tryGrade;
  $('bk-try-in').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); tryGrade(); } });

  // 붙여넣기로 추가 · 내려받기 (글자가 많아 HTTP 로 보낸다)
  function adminFetch(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'X-Admin-Key': store.get('admin') || '' }, opts.headers || {});
    return fetch(BASE + url, opts).then(function (r) {
      if (r.status === 401) { store.set('admin', null); show('login'); throw new Error('login'); }
      return r;
    });
  }
  $('btn-bk-add').onclick = function () {
    $('bk-add').hidden = false;
    $('btn-bk-apply').disabled = true;
    setTimeout(function () { $('bk-add-text').focus(); }, 30);
  };
  $('btn-bk-add-cancel').onclick = function () { $('bk-add').hidden = true; };
  $('bk-add-text').addEventListener('input', function () { $('btn-bk-apply').disabled = true; });
  function showPreview(r, applied) {
    var box = $('bk-preview');
    box.innerHTML = '';
    var sum = el('div', 'bk-sum');
    [['새 문제', r.added, 'good'], ['태그만 더함', r.merged, ''], ['이미 있음', r.same, 'muted'], ['오류', r.errors.length, r.errors.length ? 'bad' : 'muted']].forEach(function (x) {
      var d = el('span', x[2]); d.appendChild(el('b', null, String(x[1]))); d.appendChild(document.createTextNode(' ' + x[0])); sum.appendChild(d);
    });
    box.appendChild(sum);
    if (applied) box.appendChild(el('p', 'bk-done', '추가했어요! 다음 게임부터 나와요.'));
    if (r.errors.length) {
      box.appendChild(el('h3', null, '확인할 곳'));
      var ul = el('ul', 'bk-errs');
      r.errors.slice(0, 30).forEach(function (m) { ul.appendChild(el('li', null, m)); });
      box.appendChild(ul);
    }
    if (r.newBoss.length) {
      box.appendChild(el('h3', null, '새 보스 문제'));
      var ub = el('ul');
      r.newBoss.forEach(function (b) { ub.appendChild(el('li', null, b.title + ' (' + (b.blank ? '빈칸' : '출력') + ') #' + b.tags.join(' #'))); });
      box.appendChild(ub);
    }
    if (r.newNormal.length) {
      box.appendChild(el('h3', null, '새 일반 문제'));
      var un = el('ul', 'mono-list');
      r.newNormal.forEach(function (n) { un.appendChild(el('li', null, n.code + '   #' + n.tags.join(' #'))); });
      box.appendChild(un);
    }
    if (r.mergedList.length) {
      box.appendChild(el('h3', null, '태그만 더하는 문제'));
      var um = el('ul', 'mono-list');
      r.mergedList.forEach(function (m) { um.appendChild(el('li', null, m.code + '   + #' + m.add.join(' #'))); });
      box.appendChild(um);
    }
  }
  $('btn-bk-preview').onclick = function () {
    var text = $('bk-add-text').value;
    if (!text.trim()) return;
    adminFetch('/admin/bank/add', { method: 'POST', body: text }).then(function (r) { return r.json(); }).then(function (r) {
      showPreview(r, false);
      bk.lastPreview = text;
      $('btn-bk-apply').disabled = !(r.added || r.merged);
    }).catch(function (e) { if (e.message !== 'login') toast('미리보기를 못 했어요', 'warn'); });
  };
  $('btn-bk-apply').onclick = function () {
    var text = $('bk-add-text').value;
    if (text !== bk.lastPreview) { $('btn-bk-apply').disabled = true; return; }
    $('btn-bk-apply').disabled = true;
    adminFetch('/admin/bank/add?apply=1', { method: 'POST', body: text }).then(function (r) { return r.json(); }).then(function (r) {
      showPreview(r, true);
      loadBank();
    }).catch(function (e) { if (e.message !== 'login') toast('추가하지 못했어요', 'warn'); });
  };
  $('btn-bk-export').onclick = function () {
    adminFetch('/admin/bank/export').then(function (r) { return r.text(); }).then(function (text) {
      var d = new Date();
      var name = 'bank-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '.txt';
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }).catch(function (e) { if (e.message !== 'login') toast('내려받지 못했어요', 'warn'); });
  };

  // ── 수업 게임 만들기 · 열기 ──
  function defaults() {
    function d(k, v) { return OPTIONS && OPTIONS[k] && OPTIONS[k].def != null ? OPTIONS[k].def : v; }
    return { botSpeed: 'normal', tags: ['출력', '입력', '변수'], teams: d('teams', 4), limitMin: d('limitMin', 5), occSec: d('occSec', 20), bossLimitSec: d('bossLimitSec', 30), bossEverySec: d('bossEverySec', 15), bossWaitSec: d('bossWaitSec', 8), penalty: true, blocks: 0 };
  }
  $('btn-new-class').onclick = function () {
    var last = null;
    try { last = JSON.parse(store.get('lastSettings') || 'null'); } catch (e) { last = null; }
    $('btn-new-class').disabled = true;
    call('class:create', { settings: last || defaults() }, function (res) {
      $('btn-new-class').disabled = false;
      if (!res.ok) return toast(res.error || '만들지 못했어요', 'warn');
      enterClass(res.cls);
    });
  };

  function openClass(code) {
    call('class:watch', { code: code }, function (res) {
      if (!res.ok) { toast(res.error || '열지 못했어요', 'warn'); showHome(); return; }
      enterClass(res.cls);
    });
  }

  function enterClass(c) {
    cur = c;
    standings = c.standings || [];
    clockBase = Date.now();
    store.set('class', c.code);
    show('class');
    renderClass();
  }

  $('btn-back').onclick = function () { showHome(); };

  socket.on('teach', function (d) {
    if (!cur || d.code !== cur.code) return;
    cur = d;
    standings = d.standings || standings;
    clockBase = Date.now();
    renderClass();
  });
  socket.on('standings', function (st) { standings = st || []; if (cur) renderTeams(); });
  socket.on('teach:closed', function (m) {
    if (cur && m.code === cur.code) { toast(m.reason === 'idle' ? '오래 쓰지 않아 수업 게임이 닫혔어요' : '수업 게임을 끝냈어요'); showHome(); }
  });

  // ── 설정 ──
  function sets() { return cur.settings; }
  function countFor(tags) {
    function n(list) { return list.filter(function (ts) { return ts.some(function (t) { return tags.indexOf(t) >= 0; }); }).length; }
    return { normal: n(BANK_TAGS.normal), boss: n(BANK_TAGS.boss) };
  }
  var sendTimer = null;
  function changeSettings(fn) {
    if (!cur || cur.phase !== 'waiting') return;
    var s = JSON.parse(JSON.stringify(cur.settings));
    fn(s);
    cur.settings = s;
    renderSettings();
    clearTimeout(sendTimer);
    sendTimer = setTimeout(function () {
      if (!s.tags.length) { $('c-set-error').textContent = '태그를 하나 이상 고르세요'; return; }
      call('class:settings', { settings: s }, function (res) {
        $('c-set-error').textContent = res.ok ? '' : (res.error || '바꾸지 못했어요');
        if (res.ok) store.set('lastSettings', JSON.stringify(s));
      });
    }, 250);
  }

  function seg(id, list, value, unit, onPick, disabled) {
    var box = $(id);
    box.innerHTML = '';
    list.forEach(function (v) {
      var b = el('button', 'seg-btn', v + unit);
      b.type = 'button';
      b.disabled = disabled;
      b.setAttribute('aria-pressed', String(v === value));
      b.onclick = function () { changeSettings(function (s) { onPick(s, v); }); };
      box.appendChild(b);
    });
  }

  function renderSettings() {
    var s = sets(), o = OPTIONS || {}, lock = cur.phase !== 'waiting';
    $('c-settings').classList.toggle('locked', lock);
    $('c-set-note').textContent = lock ? '게임 중에는 바꿀 수 없어요' : '판과 판 사이에만 바꿀 수 있어요';
    var tl = $('c-tags');
    tl.innerHTML = '';
    TAG_ORDER.forEach(function (t) {
      var c = countFor([t]);
      var b = el('button', 'tag-btn', t);
      b.type = 'button';
      b.disabled = lock;
      b.setAttribute('aria-pressed', String(s.tags.indexOf(t) >= 0));
      b.appendChild(el('small', null, c.normal + '·' + c.boss));
      b.onclick = function () {
        changeSettings(function (x) {
          var k = x.tags.indexOf(t);
          if (k >= 0) x.tags.splice(k, 1); else x.tags.push(t);
          x.tags.sort(function (a, b2) { return TAG_ORDER.indexOf(a) - TAG_ORDER.indexOf(b2); });
        });
      };
      tl.appendChild(b);
    });
    var cnt = countFor(s.tags), info = $('c-taginfo');
    info.className = 'tag-info' + (s.tags.length && cnt.boss ? '' : ' warn');
    info.textContent = !s.tags.length ? '태그를 하나 이상 고르세요' : '일반 ' + cnt.normal + '문제 · 보스 ' + cnt.boss + '문제 출제' + (cnt.boss ? '' : ' — 보스가 나오지 않아요');
    $('c-teams').textContent = s.teams;
    $('c-teams-down').disabled = lock || s.teams <= 2;
    $('c-teams-up').disabled = lock || s.teams >= 8;
    var lim = (o.limitMin || {}), limMin = lim.min || 1, limMax = lim.max || 30;
    if (document.activeElement !== $('c-lim')) $('c-lim').value = s.limitMin;
    $('c-lim').disabled = lock;
    $('c-lim-down').disabled = lock || s.limitMin <= limMin;
    $('c-lim-up').disabled = lock || s.limitMin >= limMax;
    seg('c-occ', (o.occSec || {}).list || [10, 15, 20, 30], s.occSec, '초', function (x, v) { x.occSec = v; }, lock);
    seg('c-bosslimit', (o.bossLimitSec || {}).list || [20, 30, 45, 60], s.bossLimitSec, '초', function (x, v) { x.bossLimitSec = v; }, lock);
    seg('c-bossevery', (o.bossEverySec || {}).list || [10, 15, 30, 60], s.bossEverySec, '초', function (x, v) { x.bossEverySec = v; }, lock);
    seg('c-bosswait', (o.bossWaitSec || {}).list || [5, 8, 12, 20], s.bossWaitSec, '초', function (x, v) { x.bossWaitSec = v; }, lock);
    var SPEED = { slow: '느림 (20초)', normal: '보통 (12초)', fast: '빠름 (7초)' };
    var sb = $('c-botspeed');
    sb.innerHTML = '';
    ((o.botSpeed || {}).list || ['slow', 'normal', 'fast']).forEach(function (v) {
      var b = el('button', 'seg-btn', SPEED[v] || v);
      b.type = 'button';
      b.disabled = lock;
      b.setAttribute('aria-pressed', String(v === (s.botSpeed || 'normal')));
      b.onclick = function () { changeSettings(function (x) { x.botSpeed = v; }); };
      sb.appendChild(b);
    });
    $('c-pen').setAttribute('aria-pressed', String(s.penalty));
    $('c-pen').disabled = lock;
    $('c-pentext').textContent = s.penalty ? '보스 보상의 15%가 페널티' : '페널티 없이 좋은 아이템만';
    var auto = !s.blocks;
    $('c-auto').setAttribute('aria-pressed', String(auto));
    $('c-auto').disabled = lock;
    $('c-blk').textContent = auto ? '자동' : String(s.blocks);
    $('c-blk-down').disabled = lock || auto || s.blocks <= 24;
    $('c-blk-up').disabled = lock || auto || s.blocks >= 144;
    $('c-blkhelp').textContent = cur.phase === 'playing' && cur.blocks ? '이번 판: 조마다 ' + cur.blocks + '칸'
      : auto ? '가장 큰 조 인원 × 24칸 (최대 96) · 지금 시작하면 ' + cur.blocksNow + '칸' : '24 ~ 144칸, 12칸씩 (' + (s.blocks / 12) + '줄)';
  }
  $('c-teams-down').onclick = function () { changeSettings(function (s) { s.teams = Math.max(2, s.teams - 1); }); };
  // 제한 시간: − / + 또는 숫자 직접 입력 (1 ~ 30분)
  function setLimit(v) {
    var o = (OPTIONS && OPTIONS.limitMin) || {}, lo = o.min || 1, hi = o.max || 30;
    var empty = String(v).trim() === ''; // 빈칸이면 이전 값 그대로
    v = Math.round(Number(v));
    if (empty || !Number.isFinite(v)) { if (cur) $('c-lim').value = cur.settings.limitMin; return; }
    v = Math.max(lo, Math.min(hi, v));
    $('c-lim').value = v;
    changeSettings(function (s) { s.limitMin = v; });
  }
  $('c-lim-down').onclick = function () { if (cur) setLimit(cur.settings.limitMin - 1); };
  $('c-lim-up').onclick = function () { if (cur) setLimit(cur.settings.limitMin + 1); };
  $('c-lim').addEventListener('input', function () { this.value = this.value.replace(/[^0-9]/g, ''); });
  $('c-lim').addEventListener('change', function () { setLimit(this.value); });
  $('c-lim').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); this.blur(); }
    else if (e.key === 'ArrowUp' && cur) { e.preventDefault(); setLimit(cur.settings.limitMin + 1); }
    else if (e.key === 'ArrowDown' && cur) { e.preventDefault(); setLimit(cur.settings.limitMin - 1); }
  });
  $('c-teams-up').onclick = function () { changeSettings(function (s) { s.teams = Math.min(8, s.teams + 1); }); };
  $('c-pen').onclick = function () { changeSettings(function (s) { s.penalty = !s.penalty; }); };
  $('c-auto').onclick = function () { changeSettings(function (s) { s.blocks = s.blocks ? 0 : (cur.blocksNow || 72); }); };
  $('c-blk-down').onclick = function () { changeSettings(function (s) { s.blocks = Math.max(24, s.blocks - 12); }); };
  $('c-blk-up').onclick = function () { changeSettings(function (s) { s.blocks = Math.min(144, s.blocks + 12); }); };

  // ── 조 현황 ──
  var STATE = { on: ['접속', 'ok'], off: ['연결 끊김', 'off'], wait: ['참여 대기', 'muted'], play: ['이동 중', 'ok'], typing: ['입력 중', 'hot'], boss: ['보스 공략', 'boss'], bot: ['봇 · 대기', 'muted'] };
  var kickArm = {};

  function personRow(p, no) {
    var row = el('div', 'person' + (p.online ? '' : ' off'));
    row.appendChild(avatarSpan(p.kind, p.color));
    var who = el('span', 'pwho');
    var nm = el('b', 'pname', p.nick);
    nm.title = p.nick;
    if (p.bot) { row.classList.add('is-bot'); nm.insertBefore(el('span', 'bot-badge', '봇'), nm.firstChild); }
    who.appendChild(nm);
    var st = STATE[p.state] || ['', ''];
    who.appendChild(el('span', 'pstate ' + st[1], st[0]));
    row.appendChild(who);
    var sel = el('select', 'move-sel');
    sel.setAttribute('aria-label', p.nick + ' 조 옮기기');
    var o0 = el('option', null, '미선택'); o0.value = '0'; sel.appendChild(o0);
    for (var k = 1; k <= cur.settings.teams; k++) { var o = el('option', null, k + '조'); o.value = String(k); sel.appendChild(o); }
    sel.value = String(no);
    sel.onchange = function () {
      call('class:move', { id: p.id, no: Number(sel.value) }, function (res) { if (!res.ok) toast(res.error || '옮기지 못했어요', 'warn'); });
    };
    row.appendChild(sel);
    if (p.bot) {
      var rb = el('button', 'kick-btn', '빼기');
      rb.type = 'button';
      rb.setAttribute('aria-label', p.nick + ' 봇 빼기');
      rb.onclick = function () { call('class:bot:remove', { id: p.id }, function (res) { if (!res.ok) toast(res.error || '빼지 못했어요', 'warn'); }); };
      row.appendChild(rb);
      return row;
    }
    var kb = el('button', 'kick-btn', kickArm[p.id] && Date.now() - kickArm[p.id] < 3000 ? '한 번 더' : '강퇴');
    kb.type = 'button';
    kb.setAttribute('aria-label', p.nick + ' 강퇴');
    kb.onclick = function () {
      if (!kickArm[p.id] || Date.now() - kickArm[p.id] > 3000) { kickArm[p.id] = Date.now(); kb.textContent = '한 번 더'; kb.classList.add('armed'); return; }
      delete kickArm[p.id];
      call('class:kick', { id: p.id }, function (res) { if (!res.ok) toast(res.error || '강퇴하지 못했어요', 'warn'); else toast(p.nick + ' 강퇴'); });
    };
    row.appendChild(kb);
    return row;
  }

  function renderTeams() {
    var grid = $('c-teams-grid');
    grid.innerHTML = '';
    var byNo = {};
    standings.forEach(function (x) { byNo[x.no] = x; });
    var playing = cur.phase === 'playing';
    cur.teams.forEach(function (t) {
      var card = el('div', 'card tteam');
      var head = el('div', 'tt-head');
      head.appendChild(el('b', 'tt-name', t.no + '조'));
      var nb = t.members.filter(function (p) { return p.bot; }).length;
      head.appendChild(el('span', 'muted', t.members.length + '명' + (nb ? ' (봇 ' + nb + ')' : '')));
      var x = byNo[t.no];
      if (playing && x) {
        head.appendChild(el('span', 'grow'));
        head.appendChild(el('span', 'tt-pct' + (x.rank ? ' done' : ''), x.rank ? x.rank + '위 완성' : x.pct + '%'));
      }
      card.appendChild(head);
      if (playing && x) {
        var bar = el('i', 'tt-bar'); var fill = el('b'); fill.style.width = x.pct + '%'; bar.appendChild(fill); card.appendChild(bar);
      }
      if (!t.members.length) card.appendChild(el('span', 'muted small', '아직 아무도 없어요'));
      t.members.forEach(function (p) { card.appendChild(personRow(p, t.no)); });
      var ab = el('button', 'add-bot', '+ 봇 넣기');
      ab.type = 'button';
      ab.setAttribute('aria-label', t.no + '조에 봇 넣기');
      ab.onclick = function () { call('class:bot:add', { no: t.no }, function (res) { if (!res.ok) toast(res.error || '넣지 못했어요', 'warn'); }); };
      card.appendChild(ab);
      grid.appendChild(card);
    });
    var un = el('div', 'card tteam unassigned');
    var uh = el('div', 'tt-head');
    uh.appendChild(el('b', 'tt-name', '조 미선택'));
    uh.appendChild(el('span', 'muted', cur.unassigned.length + '명'));
    un.appendChild(uh);
    if (!cur.unassigned.length) un.appendChild(el('span', 'muted small', '모두 조를 골랐어요'));
    cur.unassigned.forEach(function (p) { un.appendChild(personRow(p, 0)); });
    grid.appendChild(un);
    $('btn-autoassign').disabled = !cur.unassigned.length;
    // v0.12.0: 조 선택 잠그기 · 무작위로 섞기
    var lk = $('btn-teamlock');
    lk.setAttribute('aria-pressed', String(!!cur.teamLock));
    lk.textContent = cur.teamLock ? '🔒 조 선택 잠김' : '🔓 조 선택 열림';
    lk.classList.toggle('locked', !!cur.teamLock);
    $('btn-shuffle').disabled = cur.phase !== 'waiting' || !cur.count;
    $('btn-botclear').hidden = !cur.bots;
  }

  function renderClass() {
    if (!cur) return;
    var playing = cur.phase === 'playing';
    $('c-code').textContent = cur.code;
    var inTeam = cur.count - cur.unassigned.length;
    $('c-counts').innerHTML = '';
    $('c-counts').appendChild(document.createTextNode('접속 '));
    $('c-counts').appendChild(el('b', null, cur.count + '명'));
    $('c-counts').appendChild(document.createTextNode(' · 조 미선택 '));
    $('c-counts').appendChild(el('b', null, cur.unassigned.length + '명'));
    $('c-help').innerHTML = '';
    $('c-help').appendChild(document.createTextNode('학생 안내: '));
    $('c-help').appendChild(el('b', 'mono', location.origin + BASE + '/'));
    $('c-help').appendChild(document.createTextNode(' 에 들어가 캐릭터를 고른 뒤, 로비의 '));
    $('c-help').appendChild(el('b', null, '수업 게임 코드'));
    $('c-help').appendChild(document.createTextNode(' 칸에 '));
    $('c-help').appendChild(el('b', 'pixel', cur.code));
    $('c-help').appendChild(document.createTextNode(' 입력 → 조 선택'));
    $('btn-start').hidden = playing;
    $('btn-start').disabled = !inTeam || !cur.settings.tags.length;
    $('btn-start').title = !inTeam ? '조를 고른 학생이 있어야 시작할 수 있어요' : '';
    $('btn-pause').hidden = !playing;
    $('btn-pause').textContent = cur.paused ? '다시 시작' : '일시정지';
    $('btn-pause').classList.toggle('on', !!cur.paused);
    $('btn-stop').hidden = !playing;
    $('c-timer').hidden = !playing;
    $('c-teams-note').textContent = playing ? '게임 중에도 조를 옮기거나 새로 들어온 학생을 넣을 수 있어요' : '학생이 직접 조를 고르고, 여기서 옮길 수도 있어요';
    $('c-rooms').setAttribute('aria-pressed', String(cur.allowRooms !== false));
    $('c-attacks').setAttribute('aria-pressed', String(cur.settings.attacks !== false));
    $('c-sfx').setAttribute('aria-pressed', String(cur.settings.sfx !== false));
    $('c-bgm').setAttribute('aria-pressed', String(cur.settings.bgm !== false));
    allowRooms = cur.allowRooms !== false;
    // 게임 중에는 설정(바꿀 수 없음) 대신 한 줄 요약만 — 조 현황을 넓게
    $('c-settings').hidden = playing;
    $('c-summary').hidden = !playing;
    var s = cur.settings;
    var BS = { slow: '느림', normal: '보통', fast: '빠름' };
    $('c-summary').textContent = '이번 판: ' + s.tags.join(' · ') + ' · 제한 ' + s.limitMin + '분 · 조마다 ' + (cur.blocks || cur.blocksNow) + '칸 · 점유 ' + s.occSec + '초 · 보스 ' + s.bossEverySec + '초마다(잔류 ' + s.bossWaitSec + '초 · 풀이 ' + s.bossLimitSec + '초) · 봇 ' + (BS[s.botSpeed] || '보통') + ' · 페널티 ' + (s.penalty ? '있음' : '없음');
    $('c-teams-grid').classList.toggle('wide', playing);
    renderSettings();
    renderTeams();
    tick();
  }

  function tick() {
    if (!cur || cur.phase !== 'playing') return;
    var left = cur.paused ? cur.remainMs : cur.remainMs - (Date.now() - clockBase);
    var tm = $('c-timer');
    tm.textContent = mmss(left);
    tm.classList.toggle('low', left < 30000 && !cur.paused);
    tm.classList.toggle('paused', !!cur.paused);
  }
  setInterval(tick, 250);

  // ── 진행 버튼 ──
  $('btn-start').onclick = function () {
    $('btn-start').disabled = true;
    $('c-error').textContent = '';
    call('class:start', {}, function (res) {
      $('btn-start').disabled = false;
      if (!res.ok) $('c-error').textContent = res.error || '시작하지 못했어요';
      else store.set('lastSettings', JSON.stringify(cur.settings));
    });
  };
  // Ctrl+Enter: 게임 시작 (v0.11.0) — 시작 버튼이 화면에 보이고 누를 수 있을 때만. 여러 줄 글 칸에서는 안 함
  window.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
    if (e.target && e.target.tagName === 'TEXTAREA') return;
    var b = $('btn-start');
    if (!b || b.hidden || b.disabled || !b.offsetParent) return;
    e.preventDefault();
    if (!e.repeat) b.click();
  });
  $('btn-pause').onclick = function () {
    call('class:pause', { on: !cur.paused }, function (res) { if (!res.ok) toast(res.error || '안 됐어요', 'warn'); });
  };
  function armed(btn, label, fn) {
    var t = 0;
    btn.onclick = function () {
      if (Date.now() - t > 3000) {
        t = Date.now();
        btn.textContent = '한 번 더 누르면 ' + label;
        setTimeout(function () { if (Date.now() - t >= 3000) btn.textContent = label; }, 3050);
        return;
      }
      t = 0;
      btn.textContent = label;
      fn();
    };
  }
  armed($('btn-stop'), '게임 종료', function () {
    call('class:stop', {}, function (res) { if (!res.ok) toast(res.error || '안 됐어요', 'warn'); });
  });
  armed($('btn-close'), '수업 끝내기', function () {
    call('class:close', {}, function (res) { if (res.ok) { toast('수업 게임을 끝냈어요'); showHome(); } });
  });
  $('btn-autoassign').onclick = function () { call('class:autoassign', {}, function () {}); };
  $('c-attacks').onclick = function () {
    var on = cur.settings.attacks === false;
    call('class:attacks', { on: on }, function (res) {
      if (!res.ok) return toast(res.error || '바꾸지 못했어요', 'warn');
      cur.settings.attacks = res.attacks;
      renderClass();
      toast(res.attacks ? '방해 아이템을 켰어요' : '방해 아이템을 껐어요');
    });
  };
  function soundSwitch(key, label) {
    $('c-' + key).onclick = function () {
      var m = {}; m[key] = cur.settings[key] === false;
      call('class:sound', m, function (res) {
        if (!res.ok) return toast(res.error || '바꾸지 못했어요', 'warn');
        cur.settings.sfx = res.sfx; cur.settings.bgm = res.bgm;
        renderClass();
        toast(label + (res[key] ? '을 켰어요' : '을 껐어요'));
      });
    };
  }
  soundSwitch('sfx', '학생 효과음');
  soundSwitch('bgm', '전광판 배경음');
  // 전광판: 새 창 (같은 브라우저라 로그인이 이어짐). 프로젝터 화면으로 옮긴 뒤 F11 로 전체 화면
  $('btn-board').onclick = function () {
    window.open(BASE + '/board?code=' + encodeURIComponent(cur.code), 'cg-board-' + cur.code);
  };
  $('btn-botfill').onclick = function () {
    call('class:bot:fill', {}, function (res) {
      if (!res.ok) return toast(res.error || '채우지 못했어요', 'warn');
      toast(res.added ? '봇 ' + res.added + '명을 넣었어요' : '이미 인원이 같아요');
    });
  };
  armed($('btn-botclear'), '봇 모두 빼기', function () { call('class:bot:clear', {}, function () {}); });
  $('btn-teamlock').onclick = function () {
    var on = !(cur && cur.teamLock);
    call('class:teamlock', { on: on }, function (res) {
      if (!res.ok) return toast(res.error || '바꾸지 못했어요', 'warn');
      toast(on ? '조 선택을 잠갔어요 — 학생은 조를 바꿀 수 없어요' : '조 선택을 열었어요');
    });
  };
  armed($('btn-shuffle'), '🔀 무작위로 섞기', function () {
    call('class:shuffle', {}, function (res) {
      if (!res.ok) return toast(res.error || '섞지 못했어요', 'warn');
      toast('학생들을 무작위로 섞었어요');
    });
  });

  // ── 비밀번호 바꾸기 ──
  function openPw() {
    ['pw-old', 'pw-new', 'pw-new2'].forEach(function (id) { $(id).value = ''; });
    $('pw-error').textContent = '';
    $('pw-dialog').hidden = false;
    setTimeout(function () { $('pw-old').focus(); }, 30);
  }
  $('btn-pw').onclick = openPw;
  $('btn-pw2').onclick = openPw;
  $('btn-pw-cancel').onclick = function () { $('pw-dialog').hidden = true; };
  $('pw-form').onsubmit = function (e) {
    e.preventDefault();
    var nw = $('pw-new').value;
    if (nw !== $('pw-new2').value) { $('pw-error').textContent = '새 비밀번호 두 개가 서로 달라요'; return; }
    $('btn-pw-save').disabled = true;
    call('admin:password', { old: $('pw-old').value, new: nw }, function (res) {
      $('btn-pw-save').disabled = false;
      if (!res.ok) { $('pw-error').textContent = res.error || '바꾸지 못했어요'; return; }
      store.set('admin', res.key);
      pwSource = res.pwSource || 'db';
      $('pw-dialog').hidden = true;
      renderHome();
      toast('비밀번호를 바꿨어요');
    });
  };

  // ── 한 판 결과 ──
  var lastShown = 0;
  socket.on('class:result', function (r) {
    if (!cur || r.code !== cur.code) return;
    lastShown = r.endedAt;
    $('tr-kind').textContent = (REASON[r.reason] || '게임 끝') + ' · ' + mmss(r.ms) + ' · 조마다 ' + r.blocks + '칸';
    $('tr-title').textContent = r.teams.length ? r.teams.filter(function (t) { return t.rank === 1; }).map(function (t) { return t.no + '조'; }).join(' · ') + ' 1위!' : '게임 끝';
    var ol = $('tr-teams');
    ol.innerHTML = '';
    r.teams.forEach(function (t) {
      var li = el('li');
      li.appendChild(el('span', 'rt-rank', t.rank + '위'));
      li.appendChild(el('b', null, t.no + '조'));
      li.appendChild(el('em', null, (t.clear ? '완성 ' + mmss(t.ms) : '해결률 ' + t.pct + '%') + ' · 블록 ' + t.solved + '/' + t.total + ' · 보스 ' + t.bosses + ' · ' + t.members.length + '명' + (t.bots ? '(봇 ' + t.bots + ')' : '') + atkText(t.atk)));
      ol.appendChild(li);
    });
    $('t-result').hidden = false;
    setTimeout(function () { $('btn-tr-ok').focus(); }, 50);
  });
  $('btn-tr-ok').onclick = function () { $('t-result').hidden = true; };
})();
