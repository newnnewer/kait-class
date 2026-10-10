'use strict';
// 서버를 실제로 띄워 여러 명이 접속해 보는 시험 (/play 경로 아래)
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 3900 + Math.floor(Math.random() * 90);
const URL = `http://127.0.0.1:${PORT}`;
let proc;

function once(sock, ev) { return new Promise(r => sock.once(ev, r)); }
function call(sock, ev, msg) { return new Promise(r => sock.emit(ev, msg, r)); }
function tok() { return 'test' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }
function client(transports) {
  return io(URL, { path: '/play/socket.io', transports: transports || ['websocket'], forceNew: true, reconnection: false });
}
const SETTINGS = { tags: ['출력'], max: 4, limitMin: 5, occSec: 20, bossEverySec: 60, bossWaitSec: 5, bossLimitSec: 20, penalty: true, blocks: 24 };

test.before(async () => {
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), BASE_PATH: '/play', GRACE_MS: '300', COUNTDOWN_MS: '0', CREATE_GAP_MS: '0', WAIT_CLOSE_MS: '1500', DB_FILE: ':memory:' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise(r => proc.stdout.on('data', d => { if (String(d).includes('기다리는 중')) r(); }));
});
test.after(() => proc.kill());

/** 접속 → 입장 → 로비 */
async function enter(kind, transports) {
  const s = client(transports);
  await once(s, 'connect');
  const h = await call(s, 'hello', { token: tok() });
  const lob = once(s, 'lobby');
  const j = await call(s, 'join', { kind: kind || 'cat', color: '#FFD23F' });
  await lob;
  return { s, h, me: j.me };
}

test('입장하면 로비로, 방 만들기 → 로비 목록에 보인다', async () => {
  const a = await enter('cat');
  assert.ok(a.h.options && a.h.bankTags.normal.length === 483);
  const b = await enter('owl', ['polling']); // b 는 WebSocket 이 막힌 학교망 흉내
  const seen = new Promise(res => b.s.on('lobby', l => { if (l.rooms.some(r => r.name === a.me.nick + '의 방')) res(l); }));
  const c = await call(a.s, 'room:create', { settings: SETTINGS });
  assert.strictEqual(c.ok, true);
  assert.strictEqual(c.room.hostId, a.me.id);
  const l = await seen;
  const r = l.rooms.find(x => x.id === c.room.id);
  assert.deepStrictEqual([r.phase, r.count, r.max], ['waiting', 1, 4]);
  a.s.close(); b.s.close();
});

test('태그가 없으면 방을 만들 수 없고, 이상한 값은 기본값으로', async () => {
  const a = await enter();
  const bad = await call(a.s, 'room:create', { settings: { tags: [] } });
  assert.strictEqual(bad.ok, false);
  const c = await call(a.s, 'room:create', { settings: { tags: ['변수', '없는태그'], max: 99, limitMin: 7, blocks: 50 } });
  assert.deepStrictEqual(c.room.settings.tags, ['변수']);
  assert.strictEqual(c.room.settings.max, 16);
  assert.strictEqual(c.room.settings.limitMin, 7); // 1 ~ 30분 사이면 그대로
  assert.strictEqual(c.room.settings.blocks, 48);
  a.s.close();
});

test('제한 시간은 1 ~ 30분 정수, 없으면 5분', () => {
  const { clean, cleanClass } = require('../server/rooms/settings');
  const lim = v => clean({ tags: ['출력'], limitMin: v }).limitMin;
  assert.strictEqual(lim(undefined), 5);
  assert.strictEqual(lim('abc'), 5);
  assert.strictEqual(lim(0), 1);
  assert.strictEqual(lim(-3), 1);
  assert.strictEqual(lim(1), 1);
  assert.strictEqual(lim(12.4), 12);
  assert.strictEqual(lim('25'), 25);
  assert.strictEqual(lim(99), 30);
  assert.strictEqual(cleanClass({ tags: ['출력'] }).limitMin, 5);
  assert.strictEqual(cleanClass({ tags: ['출력'], limitMin: 17 }).limitMin, 17);
});

test('들어가기 · 방장만 시작 · 시작하면 판이 온다 · 진행 중에는 못 들어온다', async () => {
  const a = await enter(), b = await enter(), c = await enter();
  const made = await call(a.s, 'room:create', { settings: { ...SETTINGS, blocks: 0 } });
  const j = await call(b.s, 'room:join', { id: made.room.id });
  assert.strictEqual(j.ok, true);
  assert.strictEqual(j.room.members.length, 2);
  assert.strictEqual(j.room.blocksNow, 48); // 자동: 2명 × 24
  const notHost = await call(b.s, 'room:start', {});
  assert.strictEqual(notHost.ok, false);
  const sa = once(a.s, 'state'), sb = once(b.s, 'state');
  const early = await call(a.s, 'room:start', {});
  assert.strictEqual(early.ok, false, 'b 가 준비하지 않았으면 시작할 수 없다 (v0.13.0)');
  assert.strictEqual((await call(b.s, 'room:ready', {})).ready, true);
  const st = await call(a.s, 'room:start', {});
  assert.strictEqual(st.ok, true);
  const [ga, gb] = await Promise.all([sa, sb]);
  assert.strictEqual(ga.board.cells.length, 48);
  assert.strictEqual(gb.players.length, 2);
  assert.ok(ga.endMs > 290000);
  const late = await call(c.s, 'room:join', { id: made.room.id });
  assert.strictEqual(late.ok, false);
  a.s.close(); b.s.close(); c.s.close();
});

test('게임 안에서 점유 → 정답 · 남이 점유한 칸은 못 잡는다', async () => {
  const a = await enter(), b = await enter();
  const made = await call(a.s, 'room:create', { settings: SETTINGS });
  await call(b.s, 'room:join', { id: made.room.id });
  await call(b.s, 'room:ready', {});
  const sa = once(a.s, 'state'), sb = once(b.s, 'state');
  await call(a.s, 'room:start', {});
  const [ga, gb] = await Promise.all([sa, sb]);
  // 둘 다 맨 위 왼쪽 칸으로
  for (const [s, g] of [[a.s, ga], [b.s, gb]]) {
    const done = new Promise(res => s.on('pos', m => { if (m.id === g.meId && m.r === 0 && m.c === 0) res(); }));
    for (let k = 0; k < 3; k++) s.emit('move', { dir: 'U', seq: 0 });
    s.emit('move', { to: 'home', seq: 0 });
    await done;
  }
  const r1 = await call(a.s, 'occupy', {});
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r1.ms, 20000);
  const r2 = await call(b.s, 'occupy', {});
  assert.strictEqual(r2.why, 'taken');
  const cell = once(b.s, 'cell');
  const g = await call(a.s, 'submit', { text: ga.board.cells[0].code });
  assert.strictEqual(g.correct, true);
  assert.strictEqual((await cell).i, 0);
  a.s.close(); b.s.close();
});

test('학생 방 봇: 방장만 넣고 빼기 · 인원에 들어감 · 게임에서 블록을 푼다 · 사람이 나가면 방이 닫힌다 (v0.6.4)', async () => {
  const a = await enter(), b = await enter();
  const made = await call(a.s, 'room:create', { settings: { ...SETTINGS, max: 3, botSpeed: 'fast' } });
  assert.strictEqual(made.room.settings.botSpeed, 'fast');
  await call(b.s, 'room:join', { id: made.room.id });
  await call(b.s, 'room:ready', {});
  const notHost = await call(b.s, 'room:bot', { op: 'add' });
  assert.strictEqual(notHost.ok, false);
  const added = await call(a.s, 'room:bot', { op: 'add' });
  assert.strictEqual(added.ok, true);
  const full = await call(a.s, 'room:bot', { op: 'add' }); // 3명이 꽉 참
  assert.strictEqual(full.ok, false);
  const out = await call(a.s, 'room:bot', { op: 'remove', id: added.id });
  assert.strictEqual(out.ok, true);
  const again = await call(a.s, 'room:bot', { op: 'add' });
  assert.strictEqual(again.ok, true);
  await call(b.s, 'room:leave', {}); // 사람 한 명이 나가도 방장 a 와 봇은 남는다
  const st = once(a.s, 'state');
  assert.strictEqual((await call(a.s, 'room:start', {})).ok, true);
  const g = await st;
  const botInfo = g.players.find(p => p.bot);
  assert.ok(botInfo, '판에 봇이 있다');
  // 빠른 봇은 7초에 한 블록 (가끔 틀림 · 시험을 함께 돌리면 느려짐) → 25초 안에 하나는 푼다
  const solved = await new Promise(res => {
    const t = setTimeout(() => res(false), 25000);
    a.s.on('cell', m => { if (m.solved && m.by === botInfo.id) { clearTimeout(t); res(true); } });
  });
  assert.ok(solved, '봇이 블록을 풀었다');
  // 사람이 모두 나가면 (봇만 남아도) 방이 없어진다
  await call(a.s, 'room:leave', {});
  const l = await new Promise(res => a.s.once('lobby', res));
  assert.ok(!l.rooms.some(r => r.id === made.room.id));
  a.s.close(); b.s.close();
});

test('대기실 채팅: 정해 둔 문구만 · 2초에 한 번 · 학생 방 전용 문구 · 게임 중에는 안 됨 (v0.7.3)', async () => {
  const a = await enter(), b = await enter();
  const made = await call(a.s, 'room:create', { settings: SETTINGS });
  await call(b.s, 'room:join', { id: made.room.id });
  const heard = once(b.s, 'chat');
  const r1 = await call(a.s, 'chat', { id: 'ok' });
  assert.strictEqual(r1.ok, true);
  const m = await heard;
  assert.strictEqual(m.text, '좋아요! 👍');
  assert.strictEqual(m.nick, a.me.nick);
  assert.strictEqual((await call(a.s, 'chat', { id: 'hehe' })).why, 'fast', '2초 안에 또 보내면 막힘');
  assert.strictEqual((await call(b.s, 'chat', { id: '아무말' })).why, 'bad', '없는 문구');
  assert.strictEqual((await call(b.s, 'chat', { id: 'shield' })).why, 'bad', '수업 게임 전용 문구');
  assert.strictEqual((await call(b.s, 'chat', { id: 'bot' })).ok, true, '학생 방 전용 문구');
  // 새로 들어온 사람도 최근 대화를 받는다
  const c = await enter();
  const j = await call(c.s, 'room:join', { id: made.room.id });
  assert.deepStrictEqual(j.room.chat.map(x => x.id), ['ok', 'bot']);
  // 게임 중에는 채팅 없음
  await call(b.s, 'room:ready', {}); await call(c.s, 'room:ready', {});
  await call(a.s, 'room:start', {});
  await new Promise(r => setTimeout(r, 2100));
  assert.strictEqual((await call(a.s, 'chat', { id: 'ok' })).why, 'playing');
  a.s.close(); b.s.close(); c.s.close();
});

test('방장이 나가면 다음 사람이 방장, 모두 나가면 방이 없어진다', async () => {
  const a = await enter(), b = await enter(), w = await enter();
  const made = await call(a.s, 'room:create', { settings: SETTINGS });
  await call(b.s, 'room:join', { id: made.room.id });
  const d = new Promise(res => b.s.on('room', r => { if (r.members.length === 1) res(r); }));
  await call(a.s, 'room:leave', {});
  const r = await d;
  assert.strictEqual(r.hostId, b.me.id);
  const gone = new Promise(res => w.s.on('lobby', l => { if (!l.rooms.some(x => x.id === made.room.id)) res(); }));
  await call(b.s, 'room:leave', {});
  await gone;
  a.s.close(); b.s.close(); w.s.close();
});

test('시작하지 않은 방은 정해진 시간이 지나면 닫힌다 (시험에서는 1.5초)', async () => {
  const a = await enter();
  await call(a.s, 'room:create', { settings: SETTINGS });
  const closed = await once(a.s, 'closed');
  assert.strictEqual(closed.reason, 'timeout');
  a.s.close();
});

test('새로고침(같은 열쇠로 다시 접속)하면 같은 방 · 같은 판으로 돌아온다', async () => {
  const t = tok();
  const a = client();
  await once(a, 'connect');
  await call(a, 'hello', { token: t });
  await call(a, 'join', { kind: 'dino', color: '#7EE0B5' });
  const made = await call(a, 'room:create', { settings: SETTINGS });
  const st = once(a, 'state');
  await call(a, 'room:start', {});
  const g1 = await st;
  a.close();

  const a2 = client();
  await once(a2, 'connect');
  const st2 = once(a2, 'state');
  const h = await call(a2, 'hello', { token: t });
  assert.strictEqual(h.where, 'room');
  const g2 = await st2;
  assert.strictEqual(g2.meId, g1.meId);
  assert.strictEqual(g2.room.id, made.room.id);
  assert.strictEqual(g2.board.cells[0].code, g1.board.cells[0].code);
  a2.close();
});

test('같은 열쇠로 두 탭을 열면 먼저 연 탭이 멈춘다', async () => {
  const t = tok();
  const a = client();
  await once(a, 'connect');
  await call(a, 'hello', { token: t });
  await call(a, 'join', { kind: 'slime', color: '#FFD23F' });
  const kicked = once(a, 'kicked');
  const b = client();
  await once(b, 'connect');
  await call(b, 'hello', { token: t });
  assert.strictEqual((await kicked).reason, 'dup');
  b.close();
});

test('게임 중 연결이 끊긴 채로 두면 방에서 빠진다', async () => {
  const a = await enter(), b = await enter();
  const made = await call(a.s, 'room:create', { settings: SETTINGS });
  await call(b.s, 'room:join', { id: made.room.id });
  await call(b.s, 'room:ready', {});
  const sa = once(a.s, 'state');
  await call(a.s, 'room:start', {});
  await sa;
  const left = new Promise(res => a.s.on('player:leave', m => { if (m.id === b.me.id) res(); }));
  b.s.close();
  await left; // GRACE_MS=300
  a.s.close();
});

test('대전방(v0.13.0): 팀 고르기 · 준비 · 시작하면 팀마다 판 · 학생 방 고정 설정', async () => {
  const a = await enter(), b = await enter(), c = await enter();
  const made = await call(a.s, 'room:create', { settings: { ...SETTINGS, mode: 'battle', teams: 2, teamSize: 2, occSec: 10, bossEverySec: 60, penalty: false } });
  assert.strictEqual(made.room.mode, 'battle');
  const st0 = made.room.settings;
  assert.deepStrictEqual([st0.occSec, st0.bossEverySec, st0.bossWaitSec, st0.bossLimitSec, st0.penalty], [20, 15, 8, 30, true], '학생 방은 점유 · 보스 · 페널티 고정');
  const jb = await call(b.s, 'room:join', { id: made.room.id });
  assert.deepStrictEqual(jb.room.teams.map(t => t.members.length), [1, 1], '사람 적은 팀에 앉음');
  await call(c.s, 'room:join', { id: made.room.id });
  assert.strictEqual((await call(c.s, 'room:team', { no: 2 })).ok, true);
  assert.strictEqual((await call(b.s, 'room:team', { no: 2 })).ok, true, '이미 2팀');
  for (const x of [b, c]) await call(x.s, 'room:ready', {});
  const sa = once(a.s, 'state'), sb = once(b.s, 'state'), sc = once(c.s, 'state');
  assert.strictEqual((await call(a.s, 'room:start', {})).ok, true);
  const [ga, gb, gc] = await Promise.all([sa, sb, sc]);
  assert.deepStrictEqual([ga.room.mode, ga.room.name, gb.room.name, gc.room.name], ['battle', '1팀', '2팀', '2팀']);
  assert.strictEqual(gb.players.length, 2);
  a.s.close(); b.s.close(); c.s.close();
});
