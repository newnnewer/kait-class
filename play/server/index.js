'use strict';
// KAIT-PLAY 게임 서버 (예전 이름: 코딩 대항전)
//  · 화면 파일(public/)을 내려주고
//  · Socket.IO 로 실시간 게임을 처리한다.
// 판정(이동·점유·정답·아이템)은 모두 서버가 한다. 브라우저는 보여 주기와 키 입력만.

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const config = require('./config');
const { ProblemStore } = require('./problems/store');
const { isCorrect, isBossCorrect } = require('./game/grade');
const { rollNick, CHARS, COLORS } = require('./nick');
const { Players } = require('./players');
const { Lobby } = require('./rooms/lobby');
const { OPTIONS, cleanClass } = require('./rooms/settings');
const { ClassHub } = require('./classes/hub');
const { Auth } = require('./admin/auth');
const db = require('./db').open(config.dbFile);


const BASE = config.basePath; // '' 또는 '/play'
const VERSION = require('../package.json').version;

// ── 문제 은행 (6단계: DB. 처음 켤 때만 problems/bank.txt 를 가져온다) ──
const store = new ProblemStore(db, (() => { try { return fs.readFileSync(config.bankFile, 'utf8'); } catch (e) { return ''; } })());
if (store.imported) console.log(`[문제 은행] ${config.bankFile} 에서 ${store.imported}개를 처음으로 가져왔어요`);
console.log(`[문제 은행] 일반 ${store.bank().normal.length}개, 보스 ${store.bank().boss.length}개 (DB)`);

// ── 웹 ──
const app = express();
app.disable('x-powered-by');
const router = express.Router();
// 서버가 얼마나 바쁜지 (v0.7.5, 부하 시험용): 0.5초마다 재는 타이머가 늦게 불린 만큼 = 밀린 시간
const lag = { now: 0, max: 0, since: Date.now() };
{
  let expect = Date.now() + 500;
  const t = setInterval(() => {
    const d = Math.max(0, Date.now() - expect);
    expect = Date.now() + 500;
    lag.now = d;
    if (Date.now() - lag.since > 10000) { lag.max = 0; lag.since = Date.now(); } // 10초마다 새로
    lag.max = Math.max(lag.max, d);
  }, 500);
  t.unref();
}
router.get('/healthz', (req, res) => {
  const m = process.memoryUsage();
  let playing = 0;
  for (const r of lobby.rooms.values()) if (r.match) playing += 1;
  for (const c of hub.classes.values()) if (c.round) playing += c.round.matches.size;
  res.json({
    ok: true, version: VERSION, players: players.count(), rooms: lobby.rooms.size, classes: hub.classes.size,
    matches: playing, sockets: io.engine ? io.engine.clientsCount : null,
    memMB: Math.round(m.rss / 1048576), heapMB: Math.round(m.heapUsed / 1048576),
    lagMs: lag.now, lagMaxMs: lag.max, // 최근 10초 가장 크게 밀린 시간
    demo: config.demo,
  });
});
// 전광판 (교사가 로그인한 브라우저에서만 — 화면 안에서 관리자 열쇠로 확인)
router.get('/board', (req, res) => {
  if (req.path.endsWith('/')) return res.redirect(301, req.baseUrl + '/board');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, '..', 'public', 'board.html'));
});
// 문제 은행 붙여넣기 · 내려받기 (관리자 열쇠를 X-Admin-Key 머리글로)
function adminHttp(req, res, next) {
  if (!auth.check(req.get('x-admin-key'))) return res.status(401).json({ ok: false, error: '로그인이 필요해요', auth: false });
  next();
}
router.post('/admin/bank/add', adminHttp, express.text({ limit: '1mb', type: '*/*' }), (req, res) => {
  try {
    res.json(store.addText(req.body, req.query.apply === '1'));
  } catch (e) {
    console.error('[문제 은행] 추가 오류:', e);
    res.status(500).json({ ok: false, error: '추가하지 못했어요' });
  }
});
router.get('/admin/bank/export', adminHttp, (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(store.exportText());
});
// 교사 화면
router.get('/teacher', (req, res) => {
  if (req.path.endsWith('/')) return res.redirect(301, req.baseUrl + '/teacher'); // 화면 파일 주소가 맞게
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, '..', 'public', 'teacher.html'));
});
router.use(express.static(path.join(__dirname, '..', 'public'), {
  index: 'index.html',
  setHeaders(res, file) {
    // 화면 파일은 바로 바뀐 것이 보이게, 글꼴은 오래 보관
    if (/\.(woff2)$/.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    else res.setHeader('Cache-Control', 'no-cache');
  },
}));
if (BASE) {
  // /play → /play/ (끝에 / 가 있어야 화면 파일 주소가 맞는다)
  app.use((req, res, next) => (req.path === BASE ? res.redirect(301, BASE + '/') : next()));
  app.use(BASE, router);
} else {
  app.use(router);
}
app.use((req, res) => res.status(404).type('text/plain; charset=utf-8').send('없는 주소예요'));

const server = http.createServer(app);
const io = new Server(server, {
  path: BASE + '/socket.io',
  maxHttpBufferSize: 8 * 1024, // 한 번에 받는 메시지 크기 제한
  pingInterval: 20000,
  pingTimeout: 20000,
  serveClient: true,
});

// ── 게임 상태 ──
const players = new Players();
const lobby = new Lobby({
  io, store,
  maxRooms: config.maxRooms, createGapMs: config.createGapMs, waitCloseMs: config.waitCloseMs,
  idleMs: config.idleMs, idleWarnMs: config.idleWarnMs,
});

const hub = new ClassHub({ io, bank: store, db, lobby, idleMs: config.classIdleMs });
lobby.allowRooms = () => hub.allowRooms;
lobby.countdownMs = config.countdownMs;
hub.countdownMs = config.countdownMs;
hub.nicks = () => players.nicks();
const auth = new Auth(config.adminPassword, db);
console.log(`[관리자] 교사 화면 비밀번호: ${({ db: '교사 화면에서 바꾼 비밀번호', env: '.env 의 ADMIN_PASSWORD (처음 비밀번호)', none: '없음 — 로그인할 수 없어요 (.env 확인)' })[auth.source()]}`);

// 방 만들기 화면에서 태그별 문제 수를 세는 데 쓰는 정보 (코드·정답은 빼고 태그만)
// (문제 은행이 바뀌면 다음 요청부터 새 값)
const bankTags = () => store.bankTags();

// 사람마다 초당 메시지 수 제한 (키를 꾹 누르고 있어도 서버가 버티게)
function makeLimiter(perSec) {
  let tokens = perSec, last = Date.now();
  return function allow() {
    const now = Date.now();
    tokens = Math.min(perSec, tokens + (now - last) / 1000 * perSec);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

const ok = (fn, v) => { if (typeof fn === 'function') fn(v); };

/** 사람을 완전히 내보낸다 (방에서도 빠진다) */
function drop(p, socket) {
  if (p.room) p.room.leave(p, socket);
  players.remove(p);
}

io.on('connection', (socket) => {
  // 한 사람의 요청에서 오류가 나도 서버 전체(모두의 판)가 꺼지지 않게 막는다
  const rawOn = socket.on.bind(socket);
  socket.on = (ev, fn) => rawOn(ev, (...args) => {
    try { fn(...args); } catch (e) { console.error(`[오류] ${ev}:`, e); }
  });
  const allow = makeLimiter(40);
  let me = null;          // 입장을 마친 사람
  let token = null;       // 이 연결의 열쇠
  let pendingNick = null; // 입장 화면에서 뽑아 둔 닉네임

  function bind(p) {
    // 같은 열쇠로 다른 탭이 열려 있으면 그쪽은 끊는다
    if (p.socketId && p.socketId !== socket.id) {
      const old = io.sockets.sockets.get(p.socketId);
      if (old) { old.emit('kicked', { reason: 'dup' }); old.disconnect(true); }
    }
    if (p.dropTimer) { clearTimeout(p.dropTimer); p.dropTimer = null; }
    p.socketId = socket.id;
    p.online = true;
    p.lastSeen = Date.now();
    me = p;
  }
  const match = () => (me && me.room && me.room.matchOf ? me.room.matchOf(me) : null);

  // 1) 처음 인사: 전에 입장한 적이 있으면 있던 곳(로비·대기실·경기)으로 돌아간다
  socket.on('hello', (msg, cb) => {
    if (!allow()) return;
    const t = msg && msg.token;
    if (!players.validToken(t)) return ok(cb, { ok: false, error: '잘못된 요청' });
    token = t;
    const base = { ok: true, chars: CHARS, colors: COLORS, options: OPTIONS, bankTags: bankTags(), demo: config.demo };
    const p = players.get(token);
    if (p) {
      bind(p);
      ok(cb, { ...base, me: players.pub(p), where: p.room ? 'room' : 'lobby' });
      if (p.room) p.room.resend(p, socket); else lobby.enter(p, socket);
      return;
    }
    pendingNick = rollNick(players.nicks());
    ok(cb, { ...base, me: null, nick: pendingNick });
  });

  // 2) 닉네임 다시 뽑기 (입장 화면 — 로비에서 '캐릭터 바꾸기'로 돌아와도 된다)
  socket.on('nick:roll', (msg, cb) => {
    if (!allow() || !token || (me && me.room)) return;
    pendingNick = rollNick(players.nicks());
    ok(cb, { nick: pendingNick });
  });

  // 3) 입장 → 로비
  socket.on('join', (msg, cb) => {
    if (!allow() || !token) return;
    const kind = msg && msg.kind, color = msg && msg.color;
    if (!CHARS.includes(kind) || !COLORS.includes(color)) return ok(cb, { ok: false, error: '캐릭터와 색을 골라 주세요' });
    let p = players.get(token);
    if (!p) {
      if (players.count() >= config.maxPlayers) return ok(cb, { ok: false, error: '지금은 사람이 너무 많아요. 잠시 뒤에 다시 들어와 주세요' });
      const nick = pendingNick && !players.nicks().has(pendingNick) ? pendingNick : rollNick(players.nicks());
      p = players.create(token, { nick, kind, color });
    } else {
      if (p.room) return ok(cb, { ok: false, error: '방에 있을 때는 바꿀 수 없어요' });
      p.kind = kind; p.color = color;
      if (pendingNick && pendingNick !== p.nick && !players.nicks().has(pendingNick)) p.nick = pendingNick;
    }
    pendingNick = null;
    bind(p);
    ok(cb, { ok: true, me: players.pub(p) });
    lobby.enter(p, socket);
  });

  // 4) 로비 · 방
  socket.on('room:create', (msg, cb) => {
    if (!allow() || !me) return;
    ok(cb, lobby.create(me, socket, msg && msg.settings));
  });
  socket.on('room:join', (msg, cb) => {
    if (!allow() || !me) return;
    ok(cb, lobby.join(me, socket, msg && msg.id));
  });
  socket.on('room:bot', (msg, cb) => {
    if (!allow() || !me) return;
    ok(cb, lobby.roomBot(me, msg));
  });
  // 대기실 · 조 선택 화면 채팅 (v0.7.3) — 정해 둔 문구 id 만
  socket.on('chat', (msg, cb) => {
    if (!allow() || !me || !me.room || typeof me.room.say !== 'function') return;
    ok(cb, me.room.say(me, msg && msg.id));
  });
  socket.on('room:leave', (msg, cb) => {
    if (!allow() || !me) return;
    ok(cb, lobby.leaveRoom(me, socket));
  });
  socket.on('room:start', (msg, cb) => {
    if (!allow() || !me || !me.room) return;
    ok(cb, me.room.start(me));
  });

  // 4-1) 수업 게임: 방 코드로 들어가기 · 조 고르기
  socket.on('class:join', (msg, cb) => {
    if (!allow() || !me) return;
    ok(cb, hub.join(me, socket, msg && msg.code));
  });
  socket.on('class:team', (msg, cb) => {
    if (!allow() || !me || !me.room || !me.room.isClass) return;
    ok(cb, me.room.pickTeam(me, msg && msg.no));
  });

  // 8) 관리자(교사)
  let adminKey = null;
  const admin = () => (adminKey && auth.check(adminKey) ? true : (adminKey = null, false));
  let watching = null; // 교사 화면이 보고 있는 수업 게임
  const cls = () => (watching ? hub.get(watching) : null);
  const adminBase = () => ({ ok: true, classes: hub.list(), allowRooms: hub.allowRooms, options: OPTIONS, bankTags: bankTags(), version: VERSION, pwSource: auth.source(), demo: config.demo });
  function watch(code) {
    if (watching) socket.leave('teach:' + watching);
    watching = null;
    const c = hub.get(code);
    if (!c) return null;
    watching = c.code;
    socket.join('teach:' + c.code);
    return c;
  }
  function adminOn(ev, fn) {
    socket.on(ev, (msg, cb) => {
      if (!allow()) return;
      if (!admin()) return ok(cb, { ok: false, error: '로그인이 필요해요', auth: false });
      ok(cb, fn(msg || {}));
    });
  }
  socket.on('admin:login', (msg, cb) => {
    if (!allow()) return;
    const r = auth.login(msg && msg.password);
    if (!r.ok) return ok(cb, r);
    adminKey = r.key;
    ok(cb, { ...adminBase(), key: r.key });
  });
  socket.on('admin:hello', (msg, cb) => {
    if (!allow()) return;
    if (!auth.check(msg && msg.key)) return ok(cb, { ok: false, auth: false });
    adminKey = msg.key;
    ok(cb, adminBase());
  });
  adminOn('admin:logout', () => { auth.logout(adminKey); adminKey = null; return { ok: true }; });
  adminOn('admin:password', m => {
    // 체험 서버: 비밀번호를 여럿이 함께 쓰므로 바꾸지 못하게 한다 (서버 명령 admin-password.js 는 됨)
    if (config.demo) return { ok: false, error: '체험 서버에서는 비밀번호를 바꿀 수 없어요' };
    const r = auth.change(m.old, m.new);
    if (r.ok) adminKey = r.key; // 이 화면은 새 열쇠로 계속 로그인 (다른 곳은 로그아웃)
    return r.ok ? { ok: true, key: r.key, pwSource: auth.source() } : r;
  });
  adminOn('admin:list', () => adminBase());
  adminOn('admin:rooms', m => hub.setAllowRooms(m.allow));
  adminOn('admin:records', m => ({ ok: true, games: db.recentGames(m.n || 30) }));
  adminOn('class:create', m => {
    const s = cleanClass(m.settings);
    if (!s) return { ok: false, error: '태그를 하나 이상 고르세요' };
    const r = hub.create(s);
    if (!r.ok) return r;
    return { ok: true, cls: watch(r.code).teacherDetail() };
  });
  adminOn('class:watch', m => {
    const c = watch(m.code);
    return c ? { ok: true, cls: c.teacherDetail() } : { ok: false, error: '없는 수업 게임이에요' };
  });
  function withClass(fn) {
    return m => { const c = cls(); return c ? fn(c, m) : { ok: false, error: '수업 게임을 먼저 고르세요' }; };
  }
  adminOn('class:settings', withClass((c, m) => {
    const s = cleanClass(m.settings);
    if (!s) return { ok: false, error: '태그를 하나 이상 고르세요' };
    return c.updateSettings(s);
  }));
  adminOn('class:start', withClass(c => c.begin()));
  adminOn('class:pause', withClass((c, m) => c.pause(!!m.on)));
  adminOn('class:stop', withClass(c => c.stop()));
  adminOn('class:close', withClass(c => { c.close('teacher'); watching = null; return { ok: true }; }));
  adminOn('class:kick', withClass((c, m) => c.kick(m.id)));
  adminOn('class:move', withClass((c, m) => c.move(m.id, m.no)));
  adminOn('class:autoassign', withClass(c => c.autoAssign()));
  adminOn('class:teamlock', withClass((c, m) => c.setTeamLock(!!m.on)));
  adminOn('class:shuffle', withClass(c => c.shuffleTeams()));
  // 문제 은행 (6단계) — 붙여넣기 추가와 내려받기는 글자가 많아 아래 HTTP 주소로
  adminOn('bank:list', () => ({ ok: true, problems: store.bank().normal.map(p => ({ ...p, kind: 'normal' })).concat(store.bank().boss.map(p => ({ ...p, kind: 'boss' }))) }));
  adminOn('bank:update', m => store.update(m.id, m.fields));
  adminOn('bank:remove', m => store.remove(m.id));
  // 채점 시험: 학생이 칠 법한 답을 넣어 게임과 같은 규칙으로 맞는지 본다
  adminOn('bank:try', m => {
    const text = String(m.text || '').slice(0, 300);
    if (m.kind === 'boss') {
      const answers = (Array.isArray(m.answers) ? m.answers : String(m.answers || '').split('|')).map(x => String(x).trim()).filter(Boolean);
      return { ok: true, correct: isBossCorrect({ code: String(m.code || ''), answers }, text) };
    }
    return { ok: true, correct: isCorrect(text, String(m.code || '')) };
  });
  adminOn('class:attacks', withClass((c, m) => c.setAttacks(!!m.on)));
  adminOn('class:sound', withClass((c, m) => c.setSound(m)));
  // 전광판: 수업 게임 하나를 지켜본다 (교사 화면과 따로 연결)
  let boardOf = null;
  adminOn('board:watch', m => {
    const c = hub.get(m.code);
    if (boardOf) socket.leave('board:' + boardOf);
    boardOf = null;
    if (!c) return { ok: false, error: '없는 수업 게임이에요' };
    boardOf = c.code;
    socket.join('board:' + c.code);
    return { ok: true, board: c.boardState(), address: null };
  });
  adminOn('class:bot:add', withClass((c, m) => c.addBot(m.no)));
  adminOn('class:bot:remove', withClass((c, m) => c.removeBot(m.id)));
  adminOn('class:bot:fill', withClass(c => c.fillBots()));
  adminOn('class:bot:clear', withClass(c => c.clearBots()));

  // 5) 이동
  socket.on('move', (msg) => {
    const m = match();
    if (!allow() || !m || !msg) return;
    const dirOk = ['L', 'R', 'U', 'D'].includes(msg.dir);
    const toOk = ['home', 'end', 'first', 'last'].includes(msg.to);
    if (!dirOk && !toOk) return;
    const seq = Number.isInteger(msg.seq) ? msg.seq : 0;
    me.lastSeen = Date.now();
    m.move(me, { dir: msg.dir, to: msg.to, ctrl: !!msg.ctrl, seq });
  });

  // 6) 일반 블록: 점유 · 제출 · 풀기
  socket.on('occupy', (msg, cb) => {
    const m = match();
    if (!allow() || !m) return;
    ok(cb, m.occupy(me));
  });
  socket.on('submit', (msg, cb) => {
    const m = match();
    if (!allow() || !m) return;
    const text = msg && typeof msg.text === 'string' ? msg.text : '';
    ok(cb, m.submit(me, text));
  });
  socket.on('release', () => {
    const m = match();
    if (!allow() || !m) return;
    m.touch();
    m.release(me, 'esc');
  });

  // 7) 보스: Delete/Backspace 로 점유 · 제출 · 포기(Esc)
  socket.on('boss:grab', (msg, cb) => {
    const m = match();
    if (!allow() || !m) return;
    const key = msg && msg.key === 'Backspace' ? 'Backspace' : 'Delete';
    ok(cb, m.bossGrab(me, key));
  });
  socket.on('boss:submit', (msg, cb) => {
    const m = match();
    if (!allow() || !m) return;
    const text = msg && typeof msg.text === 'string' ? msg.text : '';
    ok(cb, m.bossSubmit(me, text));
  });
  socket.on('boss:giveup', () => {
    const m = match();
    if (!allow() || !m) return;
    m.bossDrop(me, 'giveup');
  });
  // 8) 개인 덱 (v0.7.0): Ctrl+Shift+1~5 아이템 쓰기 · Ctrl+Shift+9 방패로 막기
  socket.on('item:use', (msg, cb) => {
    const m = match();
    if (!allow() || !m) return;
    const slot = msg && Number.isInteger(msg.slot) ? msg.slot : 0;
    ok(cb, m.useItem(me, slot));
  });
  socket.on('defend', (msg, cb) => {
    const m = match();
    if (!allow() || !m) return;
    ok(cb, m.defend(me));
  });

  // 방치 경고 중 아무 키 (화살표 말고 다른 키를 눌러도 경고가 풀리게)
  socket.on('poke', () => {
    const m = match();
    if (!allow() || !m) return;
    m.touch();
  });

  socket.on('disconnect', () => {
    if (!me || me.socketId !== socket.id) return;
    const p = me;
    p.online = false;
    p.socketId = null;
    p.lastSeen = Date.now();
    if (p.room) p.room.offline(p);
    // 잠깐 끊긴 것일 수 있으니 조금 기다렸다가 방에서 뺀다
    p.dropTimer = setTimeout(() => {
      p.dropTimer = null;
      if (!p.online) drop(p, null);
    }, config.graceMs);
  });
});

server.listen(config.port, () => {
  console.log(`[KAIT-PLAY ${VERSION}] http://localhost:${config.port}${BASE}/ 에서 기다리는 중`);
});

function shutdown() {
  console.log('끝내는 중…');
  db.close();
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
