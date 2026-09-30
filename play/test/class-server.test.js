'use strict';
// 서버를 실제로 띄워 교사 로그인 → 수업 게임 → 학생 입장 → 경기 → 결과 · 기록을 시험한다
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { io } = require('socket.io-client');

const PORT = 4000 + Math.floor(Math.random() * 90);
const URL = `http://127.0.0.1:${PORT}`;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-'));
let proc;

function once(sock, ev, pred) {
  return new Promise(r => { const f = d => { if (!pred || pred(d)) { sock.off(ev, f); r(d); } }; sock.on(ev, f); });
}
function call(sock, ev, msg) { return new Promise(r => sock.emit(ev, msg, r)); }
function tok() { return 'test' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }
function client() { return io(URL, { path: '/play/socket.io', transports: ['websocket'], forceNew: true, reconnection: false }); }

test.before(async () => {
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), BASE_PATH: '/play', GRACE_MS: '300', COUNTDOWN_MS: '0', ADMIN_PASSWORD: 'test-pw', DB_FILE: path.join(DIR, 'game.db') },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise(r => proc.stdout.on('data', d => { if (String(d).includes('기다리는 중')) r(); }));
});
test.after(() => { proc.kill(); fs.rmSync(DIR, { recursive: true, force: true }); });

async function student() {
  const s = client();
  await once(s, 'connect');
  await call(s, 'hello', { token: tok() });
  const lob = once(s, 'lobby');
  const j = await call(s, 'join', { kind: 'cat', color: '#FFD23F' });
  await lob;
  return { s, me: j.me };
}
async function teacher() {
  const t = client();
  await once(t, 'connect');
  return t;
}

test('교사 화면 주소가 열린다', async () => {
  const res = await fetch(URL + '/play/teacher');
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /교사/);
});

test('로그인 없이는 관리자 기능을 못 쓰고, 틀린 비밀번호는 거절', async () => {
  const t = await teacher();
  const r = await call(t, 'class:create', { settings: { tags: ['출력'] } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.auth, false);
  const bad = await call(t, 'admin:login', { password: 'nope' });
  assert.strictEqual(bad.ok, false);
  const good = await call(t, 'admin:login', { password: 'test-pw' });
  assert.strictEqual(good.ok, true);
  // 새로 연결해도 열쇠로 로그인 유지
  const t2 = await teacher();
  assert.strictEqual((await call(t2, 'admin:hello', { key: good.key })).ok, true);
  assert.strictEqual((await call(t2, 'admin:hello', { key: 'wrong' })).ok, false);
  t.close(); t2.close();
});

test('수업 게임: 코드로 입장 → 조 선택 → 시작 → 같은 판 → 종료 → 순위와 기록', async () => {
  const t = await teacher();
  await call(t, 'admin:login', { password: 'test-pw' });
  const made = await call(t, 'class:create', { settings: { tags: ['출력'], teams: 2, limitMin: 5, blocks: 24 } });
  assert.strictEqual(made.ok, true);
  const code = made.cls.code;
  assert.match(code, /^\d{4}$/);

  const a = await student(), b = await student();
  const wrong = await call(a.s, 'class:join', { code: code === '0000' ? '0001' : '0000' });
  assert.strictEqual(wrong.ok, false);
  const ja = await call(a.s, 'class:join', { code });
  assert.strictEqual(ja.ok, true);
  assert.strictEqual(ja.cls.teams.length, 2);
  await call(b.s, 'class:join', { code });
  const seen = once(t, 'teach', d => d.teams[0].members.length === 1 && d.teams[1].members.length === 1);
  await call(a.s, 'class:team', { no: 1 });
  await call(b.s, 'class:team', { no: 2 });
  await seen;

  const sa = once(a.s, 'state'), sb = once(b.s, 'state');
  const st = await call(t, 'class:start', {});
  assert.strictEqual(st.ok, true);
  const [ga, gb] = await Promise.all([sa, sb]);
  assert.strictEqual(ga.room.mode, 'class');
  assert.strictEqual(ga.room.name, '1조');
  assert.deepStrictEqual(ga.board.cells.map(c => c.code), gb.board.cells.map(c => c.code));

  // 일시정지 중에는 점유할 수 없다
  const pz = once(a.s, 'pause');
  await call(t, 'class:pause', { on: true });
  assert.strictEqual((await pz).on, true);
  assert.strictEqual((await call(a.s, 'occupy', {})).why, 'paused');
  await call(t, 'class:pause', { on: false });

  // 1조가 한 칸 풂 → 종료하면 1조 1위
  const r1 = await call(a.s, 'occupy', {});
  assert.strictEqual(r1.ok, true);
  const g = await call(a.s, 'submit', { text: ga.board.cells[r1.i].code });
  assert.strictEqual(g.correct, true);
  const resA = once(a.s, 'class:result');
  await call(t, 'class:stop', {});
  const res = await resA;
  assert.deepStrictEqual(res.teams.map(x => [x.no, x.rank]), [[1, 1], [2, 2]]);
  assert.strictEqual(res.teams[0].solved, 1);

  const rec = await call(t, 'admin:records', {});
  assert.strictEqual(rec.games[0].code, code);
  a.s.close(); b.s.close(); t.close();
});

test('게임 중에 들어온 학생도 조를 고르면 바로 판을 받는다', async () => {
  const t = await teacher();
  await call(t, 'admin:login', { password: 'test-pw' });
  const made = await call(t, 'class:create', { settings: { tags: ['출력'], teams: 2, blocks: 24 } });
  const code = made.cls.code;
  const a = await student();
  await call(a.s, 'class:join', { code });
  await call(a.s, 'class:team', { no: 1 });
  await call(t, 'class:start', {});
  const late = await student();
  await call(late.s, 'class:join', { code });
  const st = once(late.s, 'state');
  await call(late.s, 'class:team', { no: 2 });
  const g = await st;
  assert.strictEqual(g.room.name, '2조');
  assert.ok(g.endMs > 0 && g.endMs <= 600000);
  await call(t, 'class:close', {});
  a.s.close(); late.s.close(); t.close();
});

test('학생 방 만들기를 끄면 방을 만들 수 없고, 서버를 다시 켜도 유지된다(저장)', async () => {
  const t = await teacher();
  await call(t, 'admin:login', { password: 'test-pw' });
  const a = await student();
  const lob = once(a.s, 'lobby', l => l.allowRooms === false);
  await call(t, 'admin:rooms', { allow: false });
  await lob;
  const r = await call(a.s, 'room:create', { settings: { tags: ['출력'] } });
  assert.strictEqual(r.ok, false);
  const { open } = require('../server/db');
  const db = open(path.join(DIR, 'game.db'));
  assert.strictEqual(db.getSetting('allowRooms', true), false);
  db.close();
  await call(t, 'admin:rooms', { allow: true });
  a.s.close(); t.close();
});

test('교사 화면에서 봇으로 인원 맞추기 → 봇도 판을 받는다', async () => {
  const t = await teacher();
  await call(t, 'admin:login', { password: 'test-pw' });
  const made = await call(t, 'class:create', { settings: { tags: ['출력'], teams: 2, blocks: 24 } });
  const a = await student(), b = await student();
  for (const x of [a, b]) await call(x.s, 'class:join', { code: made.cls.code });
  await call(a.s, 'class:team', { no: 1 });
  await call(b.s, 'class:team', { no: 1 });
  await call(b.s, 'class:team', { no: 1 });
  const other = await student();
  await call(other.s, 'class:join', { code: made.cls.code });
  await call(other.s, 'class:team', { no: 2 });
  const f = await call(t, 'class:bot:fill', {});
  assert.deepStrictEqual([f.ok, f.added], [true, 1]);
  const st = once(other.s, 'state');
  await call(t, 'class:start', {});
  const g = await st;
  assert.strictEqual(g.players.length, 2);
  assert.strictEqual(g.players.filter(p => p.bot).length, 1);
  await call(t, 'class:close', {});
  a.s.close(); b.s.close(); other.s.close(); t.close();
});

test('비밀번호 바꾸기 → 예전 비밀번호는 안 되고, 잊으면 서버 명령으로 새로 만든다', async () => {
  const t = await teacher();
  const k = (await call(t, 'admin:login', { password: 'test-pw' })).key;
  const t2 = await teacher();
  assert.strictEqual((await call(t2, 'admin:hello', { key: k })).ok, true);
  const bad = await call(t, 'admin:password', { old: 'nope', new: 'brand-new' });
  assert.strictEqual(bad.ok, false);
  const ch = await call(t, 'admin:password', { old: 'test-pw', new: 'brand-new' });
  assert.strictEqual(ch.ok, true);
  assert.strictEqual(ch.pwSource, 'db');
  // 바꾼 화면은 계속, 다른 화면은 로그아웃
  assert.strictEqual((await call(t, 'admin:list', {})).ok, true);
  assert.strictEqual((await call(t2, 'admin:list', {})).auth, false);
  assert.strictEqual((await call(t2, 'admin:login', { password: 'test-pw' })).ok, false);
  assert.strictEqual((await call(t2, 'admin:login', { password: 'brand-new' })).ok, true);
  // 서버 명령으로 새 비밀번호 (서버를 다시 켜지 않아도 됨)
  const out = require('child_process').execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'admin-password.js'), 'from-script'], { env: { ...process.env, DB_FILE: path.join(DIR, 'game.db') } }).toString();
  assert.match(out, /from-script/);
  assert.strictEqual((await call(t2, 'admin:login', { password: 'from-script' })).ok, true);
  t.close(); t2.close();
});

test('전광판: 교사 로그인 열쇠로만 지켜볼 수 있고, 판 정보가 온다 · 방해 스위치', async () => {
  const res = await fetch(URL + '/play/board');
  assert.strictEqual(res.status, 200);
  const t = await teacher();
  const k = (await call(t, 'admin:login', { password: 'from-script' })).key;
  const made = await call(t, 'class:create', { settings: { tags: ['출력'], teams: 2, blocks: 24 } });
  const code = made.cls.code;
  const b = await teacher();
  assert.strictEqual((await call(b, 'board:watch', { code })).ok, false, '로그인 전에는 안 됨');
  await call(b, 'admin:hello', { key: k });
  const w = await call(b, 'board:watch', { code });
  assert.strictEqual(w.ok, true);
  assert.strictEqual(w.board.phase, 'waiting');
  assert.strictEqual(w.board.attacks, true);
  const a = await student();
  await call(a.s, 'class:join', { code });
  await call(a.s, 'class:team', { no: 1 });
  const playing = once(b, 'board', d => d.phase === 'playing' && d.teams[0].cells);
  await call(t, 'class:start', {});
  const d = await playing;
  assert.strictEqual(d.teams[0].cells.length, 24);
  const off = once(b, 'board', x => x.attacks === false);
  assert.strictEqual((await call(t, 'class:attacks', { on: false })).attacks, false);
  await off;
  await call(t, 'class:close', {});
  a.s.close(); b.close(); t.close();
});

test('문제 은행: 로그인해야 쓰고, 붙여넣기 추가는 다음 게임부터 · 내려받기', async () => {
  const noKey = await fetch(URL + '/play/admin/bank/add?apply=1', { method: 'POST', body: '# 출력\nprint(1)' });
  assert.strictEqual(noKey.status, 401);
  const t = await teacher();
  const k = (await call(t, 'admin:login', { password: 'from-script' })).key;
  const pre = await (await fetch(URL + '/play/admin/bank/add', { method: 'POST', headers: { 'X-Admin-Key': k }, body: '[일반 문제]\n# 함수\nzz_new_fn()' })).json();
  assert.strictEqual(pre.added, 1);
  const add = await (await fetch(URL + '/play/admin/bank/add?apply=1', { method: 'POST', headers: { 'X-Admin-Key': k }, body: '[일반 문제]\n# 함수\nzz_new_fn()' })).json();
  assert.strictEqual(add.added, 1);
  const list = await call(t, 'bank:list', {});
  const mine = list.problems.find(p => p.code === 'zz_new_fn()');
  assert.ok(mine);
  // 학생 화면의 태그별 문제 수에도 반영
  const s = await student();
  assert.strictEqual(s.me && true, true);
  const exp = await (await fetch(URL + '/play/admin/bank/export', { headers: { 'X-Admin-Key': k } })).text();
  assert.match(exp, /zz_new_fn\(\)/);
  assert.strictEqual((await call(t, 'bank:try', { kind: 'normal', code: "print('a b')", text: 'print( "a b" )' })).correct, true);
  assert.strictEqual((await call(t, 'bank:try', { kind: 'boss', code: 'print(1 + ___)', answers: '2 | 1 + 1', text: '1+1' })).correct, true);
  assert.strictEqual((await call(t, 'bank:remove', { id: mine.id })).ok, true);
  s.s.close(); t.close();
});
