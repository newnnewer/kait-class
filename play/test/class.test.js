'use strict';
// 수업 게임 규칙을 서버 없이 직접 시험한다 (가짜 io · 메모리 DB)
const test = require('node:test');
const assert = require('node:assert');
const { ClassHub } = require('../server/classes/hub');
const { cleanClass } = require('../server/rooms/settings');
const { open } = require('../server/db');

function fakeIo() {
  const log = [];
  const sockets = new Map();
  const io = {
    log,
    to: ch => ({ emit: (ev, data) => log.push({ ch, ev, data }) }),
    sockets: { sockets },
    last: (ev, ch) => [...log].reverse().find(x => x.ev === ev && (!ch || x.ch === ch)),
  };
  return io;
}
function fakeSocket(io, id) {
  const s = {
    id, rooms: new Set(), got: [],
    join(ch) { s.rooms.add(ch); }, leave(ch) { s.rooms.delete(ch); },
    emit(ev, data) { s.got.push({ ev, data }); },
    last(ev) { return [...s.got].reverse().find(x => x.ev === ev); },
  };
  io.sockets.sockets.set(id, s);
  return s;
}
const BANK = {
  normal: ['print(1)', 'a = 1', 'x += 1', 'if a > b:', 'b = 2', 'c = 3'].map(code => ({ code, tags: ['출력'] })),
  boss: [
    { title: '보스1', code: 'print(___)', input: null, answers: ['1'], tags: ['출력'] },
    { title: '보스2', code: 'print(2)', input: null, answers: ['2'], tags: ['출력'] },
  ],
};

function setup(extra) {
  const io = fakeIo();
  const db = open(':memory:');
  const lobby = {
    changed() {}, enter(p, sock) { p.room = null; sock.join('lobby'); },
    problemsFor(tags) {
      const has = x => x.tags.some(t => tags.includes(t));
      return { codes: BANK.normal.filter(has).map(x => x.code), bosses: BANK.boss.filter(has) };
    },
  };
  const hub = new ClassHub({ io, bank: BANK, db, lobby });
  hub.countdownMs = (extra && extra.countdownMs) || 0; // 시작 카운트다운은 따로 시험
  clearInterval(hub.timer);
  const s = cleanClass({ tags: ['출력'], teams: 3, limitMin: 5, bossEverySec: 10, blocks: 24, ...(extra || {}) });
  const code = hub.create(s).code;
  const c = hub.get(code);
  let n = 0;
  const student = () => {
    n += 1;
    const sock = fakeSocket(io, 's' + n);
    const p = { id: 'p' + n, token: 'tok' + n, nick: '학생' + n, kind: 'cat', color: '#FFD23F', online: true, socketId: sock.id, room: null };
    return { p, sock };
  };
  const stopTimers = () => { if (c.round) { clearInterval(c.round.timer); for (const m of c.round.matches.values()) clearInterval(m.sweeper); } };
  return { io, db, hub, c, code, student, stopTimers };
}

test('방 코드는 숫자 4자리, 틀린 코드를 5번 넣으면 1분 동안 막힌다', () => {
  const { hub, code, student } = setup();
  assert.match(code, /^\d{4}$/);
  const { p, sock } = student();
  const wrong = code === '1111' ? '2222' : '1111';
  for (let k = 0; k < 5; k++) assert.strictEqual(hub.join(p, sock, wrong).ok, false);
  const locked = hub.join(p, sock, code);
  assert.strictEqual(locked.ok, false);
  assert.match(locked.error, /여러 번/);
  hub.tries.clear();
  assert.strictEqual(hub.join(p, sock, code).ok, true);
});

test('조 고르기 → 시작하면 모든 조가 같은 판 · 사람 없는 조는 판이 없다', () => {
  const { c, hub, code, student, stopTimers, io } = setup();
  const a = student(), b = student(), d = student();
  for (const x of [a, b, d]) hub.join(x.p, x.sock, code);
  c.pickTeam(a.p, 1); c.pickTeam(b.p, 2); c.pickTeam(d.p, 2);
  assert.strictEqual(c.pickTeam(a.p, 9).ok, false);
  const r = c.begin();
  assert.strictEqual(r.ok, true);
  stopTimers();
  const m1 = c.round.matches.get(1), m2 = c.round.matches.get(2);
  assert.ok(m1 && m2);
  assert.strictEqual(c.round.matches.has(3), false);
  assert.deepStrictEqual(m1.board.cells.map(x => x.code), m2.board.cells.map(x => x.code));
  assert.strictEqual(m1.board.cells.length, 24);
  const st = io.last('state', a.sock.id); // 판은 그 학생의 연결로 간다
  assert.ok(st, '1조 학생에게 판이 간다');
  assert.strictEqual(st.data.room.mode, 'class');
});

test('보스는 "시작부터 N초마다" 모든 조에 같은 문제, 보스가 남아 있는 조는 건너뛴다', () => {
  const { c, hub, code, student, stopTimers } = setup();
  const a = student(), b = student();
  hub.join(a.p, a.sock, code); hub.join(b.p, b.sock, code);
  c.pickTeam(a.p, 1); c.pickTeam(b.p, 2);
  c.begin();
  stopTimers();
  const r = c.round;
  const m1 = r.matches.get(1), m2 = r.matches.get(2);
  r.startedAt -= 10001; // 10초가 지났다고 치고
  c.tick();
  assert.ok(m1.boss && m2.boss);
  assert.strictEqual(m1.boss.q, m2.boss.q, '같은 문제');
  // 2조 보스만 끝남 → 다음 차례에 1조는 건너뛰고 2조만 새 보스
  m2.bossEnd('escaped');
  const q1 = m1.boss.q;
  r.startedAt -= 10000;
  c.tick();
  assert.strictEqual(m1.boss.q, q1, '1조는 이전 보스 그대로');
  assert.ok(m2.boss && m2.boss.q !== q1, '2조는 다음 문제');
  // 레이더가 쓰는 다음 보스 시각은 모든 조가 같다
  assert.strictEqual(m1.nextBossAt, m2.nextBossAt);
});

test('일시정지: 입력이 막히고 시계가 멈췄다가 멈춘 만큼 뒤로 밀린다', () => {
  const { c, hub, code, student, stopTimers } = setup();
  const a = student();
  hub.join(a.p, a.sock, code); c.pickTeam(a.p, 1);
  c.begin(); stopTimers();
  const m = c.round.matches.get(1);
  m.pos.set(a.p.id, { r: 0, c: 0 });
  const endAt = m.endAt;
  c.pause(true);
  assert.strictEqual(m.occupy(a.p).why, 'paused');
  const before = c.elapsed();
  c.round.pausedAt -= 5000; c.round.startedAt -= 5000; // 멈춘 채로 5초가 지났다고 치고
  assert.ok(Math.abs(c.elapsed() - before) < 50, '멈춘 동안은 시간이 흐르지 않는다');
  m.pausedAt -= 5000;
  c.pause(false);
  assert.ok(m.endAt - endAt >= 5000, '끝나는 시각이 5초 뒤로');
  assert.strictEqual(m.occupy(a.p).ok, true);
});

test('게임 중에 들어온 학생: 사람이 없던 조도 같은 판으로 참여 · 조를 옮기면 판도 옮긴다', () => {
  const { c, hub, code, student, stopTimers } = setup();
  const a = student(), late = student();
  hub.join(a.p, a.sock, code); c.pickTeam(a.p, 1);
  c.begin(); stopTimers();
  hub.join(late.p, late.sock, code);
  c.pickTeam(late.p, 3);
  stopTimers();
  const m3 = c.round.matches.get(3);
  assert.ok(m3 && m3.has(late.p));
  assert.deepStrictEqual(m3.board.cells.map(x => x.code), c.round.matches.get(1).board.cells.map(x => x.code));
  assert.ok(Math.abs(m3.endAt - c.round.matches.get(1).endAt) < 1000, '끝나는 시각도 같다');
  // 교사가 1조로 옮김
  c.move(late.p.id, 1);
  assert.strictEqual(m3.has(late.p), false);
  assert.strictEqual(c.round.matches.get(1).has(late.p), true);
  assert.ok(late.sock.rooms.has(c.teamChannel(1)) && !late.sock.rooms.has(c.teamChannel(3)));
});

test('순위: 판을 완성한 순서 → 교사가 끝내면 남은 조는 해결률 순, 기록이 저장된다', async () => {
  const { c, hub, code, student, stopTimers, db, io } = setup();
  const xs = [student(), student(), student()];
  xs.forEach((x, k) => { hub.join(x.p, x.sock, code); c.pickTeam(x.p, k + 1); });
  c.begin(); stopTimers();
  const [m1, m2, m3] = [1, 2, 3].map(no => c.round.matches.get(no));
  // 2조가 먼저 완성
  m2.board.cells.forEach((x, i) => { if (i > 0) x.solved = true; });
  m2.pos.set(xs[1].p.id, { r: 0, c: 0 });
  m2.occupy(xs[1].p);
  m2.submit(xs[1].p, m2.board.cells[0].code);
  assert.strictEqual(io.last('team:done', c.teamChannel(2)).data.rank, 1);
  // 3조가 1조보다 많이 풂
  m3.board.cells.slice(0, 10).forEach(x => { x.solved = true; });
  m1.board.cells.slice(0, 3).forEach(x => { x.solved = true; });
  c.stop();
  await new Promise(r => setImmediate(r));
  const res = io.last('class:result', c.channel).data;
  assert.deepStrictEqual(res.teams.map(t => [t.no, t.rank]), [[2, 1], [3, 2], [1, 3]]);
  assert.strictEqual(res.reason, 'stop');
  assert.strictEqual(c.phase, 'waiting');
  const saved = db.recentGames(5);
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(saved[0].code, code);
  assert.strictEqual(saved[0].result.teams[0].no, 2);
});

test('해결률이 같은 조는 같은 순위', async () => {
  const { c, hub, code, student, stopTimers, io } = setup();
  const xs = [student(), student()];
  xs.forEach((x, k) => { hub.join(x.p, x.sock, code); c.pickTeam(x.p, k + 1); });
  c.begin(); stopTimers();
  c.stop();
  await new Promise(r => setImmediate(r));
  const res = io.last('class:result', c.channel).data;
  assert.deepStrictEqual(res.teams.map(t => t.rank), [1, 1]);
});

test('강퇴하면 로비로 가고 같은 브라우저로는 다시 못 들어온다', () => {
  const { c, hub, code, student } = setup();
  const a = student();
  hub.join(a.p, a.sock, code); c.pickTeam(a.p, 2);
  c.kick(a.p.id);
  assert.strictEqual(a.p.room, null);
  assert.strictEqual(a.sock.last('closed').data.reason, 'kicked');
  assert.strictEqual(hub.join(a.p, a.sock, code).ok, false);
});

test('조 수를 줄이면 없어진 조의 학생은 조 미선택으로 · 자동 배정은 적은 조부터', () => {
  const { c, hub, code, student } = setup({ teams: 4 });
  const xs = [student(), student(), student(), student(), student()];
  xs.forEach(x => hub.join(x.p, x.sock, code));
  c.pickTeam(xs[0].p, 4);
  c.pickTeam(xs[1].p, 1);
  c.updateSettings(cleanClass({ tags: ['출력'], teams: 2 }));
  assert.strictEqual(c.teamOf.get(xs[0].p.id), 0);
  c.autoAssign();
  const counts = [1, 2].map(no => c.teamMembers(no).length);
  assert.deepStrictEqual(counts.sort(), [2, 3]);
  assert.strictEqual(c.teamMembers(0).length, 0);
});

test('수업을 끝내면 학생은 모두 로비로, 코드는 없어진다', () => {
  const { c, hub, code, student } = setup();
  const a = student();
  hub.join(a.p, a.sock, code);
  c.close('teacher');
  assert.strictEqual(hub.get(code), null);
  assert.strictEqual(a.p.room, null);
  assert.ok(a.sock.rooms.has('lobby'));
});

test('봇: 조에 넣고 빼기 · 인원 맞추기는 가장 큰 조까지 · 빈 조도 채운다 (v0.7.6)', () => {
  const { c, hub, code, student } = setup({ teams: 3 });
  const xs = [student(), student(), student()];
  xs.forEach(x => hub.join(x.p, x.sock, code));
  c.pickTeam(xs[0].p, 1); c.pickTeam(xs[1].p, 1); c.pickTeam(xs[2].p, 2);
  const r = c.fillBots();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.added, 3);
  assert.deepStrictEqual([1, 2, 3].map(no => c.teamMembers(no).length), [2, 2, 2], '사람이 없던 3조도 봇 2명');
  const bot = c.teamMembers(2).find(p => p.bot);
  assert.ok(bot && bot.nick);
  assert.strictEqual(c.teacherDetail().teams[1].members.some(p => p.bot), true);
  assert.strictEqual(c.addBot(3).ok, true);
  assert.strictEqual(c.teamMembers(3).length, 3);
  // 사용자가 알려 준 경우: 조 4개 · 1조에만 사람 → 나머지 3개 조가 봇으로 채워진다
  const y = setup({ teams: 4 });
  const ys = [y.student(), y.student(), y.student()];
  ys.forEach(x => { y.hub.join(x.p, x.sock, y.code); y.c.pickTeam(x.p, 1); });
  const f = y.c.fillBots();
  assert.strictEqual(f.ok, true);
  assert.deepStrictEqual([1, 2, 3, 4].map(no => y.c.teamMembers(no).length), [3, 3, 3, 3]);
  assert.strictEqual(y.c.fillBots().added, 0, '다시 누르면 더 넣을 것 없음');
  assert.strictEqual(c.kick(bot.id).ok, true); // 봇은 '빼기'
  assert.strictEqual(c.members.has(bot.id), false);
  c.clearBots();
  assert.strictEqual(c.bots().length, 0);
});

test('봇은 판에서 일반 블록을 풀고, 보스는 잡지 않는다', () => {
  const { c, hub, code, student, stopTimers } = setup({ teams: 2, botSpeed: 'fast' });
  const a = student();
  hub.join(a.p, a.sock, code); c.pickTeam(a.p, 1);
  c.addBot(2);
  c.begin(); stopTimers();
  const m = c.round.matches.get(2);
  const bot = c.bots()[0];
  assert.ok(m.has(bot), '봇도 판을 받는다');
  // 시간을 빨리 돌려 여러 번 움직이게 한다
  const realNow = Date.now;
  let t = realNow();
  Date.now = () => t;
  try {
    for (let k = 0; k < 3000; k++) {
      t += 200;
      m.boss = null;
      bot.brain.nextAt = Math.min(bot.brain.nextAt, t);
      c.round.startedAt = t; // 보스 차례·제한 시간은 흐르지 않게
      m.endAt = t + 600000;
      for (const o of m.occ.values()) o.until = t + 60000;
      c.tick();
    }
  } finally { Date.now = realNow; }
  const solved = m.board.cells.filter(x => x.solved).length;
  assert.ok(solved >= 20, `봇이 푼 블록 ${solved}`);
  assert.strictEqual(m.stats.get(bot.id).bosses, 0);
});

test('봇 속도 설정은 느림·보통·빠름만', () => {
  assert.strictEqual(cleanClass({ tags: ['출력'], botSpeed: 'turbo' }).botSpeed, 'normal');
  assert.strictEqual(cleanClass({ tags: ['출력'], botSpeed: 'slow' }).botSpeed, 'slow');
});

// ── 5-2: 방해 아이템 · 방패 · 전광판 ──
const { rollItem } = require('../server/game/items');

test('아이템 확률 (v0.12.0): 방해 켜짐이면 도움 57.5 · 페널티 15 · 방해 20 · 방패 7.5, 꺼지면 도움 85 · 페널티 15', () => {
  const N = 40000;
  const cnt = { good: 0, attack: 0, bad: 0 };
  const per = {};
  let shield = 0;
  for (let k = 0; k < N; k++) {
    const it = rollItem({ attacks: true, rng: Math.random });
    cnt[it.kind] += 1; per[it.id] = (per[it.id] || 0) + 1;
    if (it.id === 'shield') shield += 1;
  }
  assert.ok(Math.abs(cnt.attack / N - 0.20) < 0.015, `방해 ${cnt.attack}`);
  assert.ok(Math.abs(cnt.bad / N - 0.15) < 0.015, `페널티 ${cnt.bad}`);
  assert.ok(Math.abs(shield / N - 0.075) < 0.01, `방패 ${shield}`);
  assert.ok(Math.abs(per.bomb / N - 0.115) < 0.01, `폭탄 ${per.bomb}`);
  assert.ok(Math.abs(per.freeze / N - 0.05) < 0.01, `자폭 ${per.freeze}`);
  // 방해 꺼짐: 방해 · 방패 없음, 도움 각 17%
  const c2 = { good: 0, bad: 0 }, p2 = {};
  for (let k = 0; k < N; k++) {
    const it = rollItem({ attacks: false, rng: Math.random });
    assert.ok(it.kind !== 'attack' && it.id !== 'shield');
    c2[it.kind] += 1; p2[it.id] = (p2[it.id] || 0) + 1;
  }
  assert.ok(Math.abs(c2.bad / N - 0.15) < 0.015, `페널티 ${c2.bad}`);
  assert.ok(Math.abs(p2.laser / N - 0.17) < 0.012, `레이저 ${p2.laser}`);
  // 페널티 꺼짐: 페널티 없음
  for (let k = 0; k < 3000; k++) assert.notStrictEqual(rollItem({ attacks: true, penalty: false }).kind, 'bad');
});

function threeTeams(extra) {
  const x = setup({ teams: 3, ...(extra || {}) });
  const xs = [x.student(), x.student(), x.student()];
  xs.forEach((s, k) => { x.hub.join(s.p, s.sock, x.code); x.c.pickTeam(s.p, k + 1); });
  x.c.begin(); x.stopTimers();
  const ms = [1, 2, 3].map(no => x.c.round.matches.get(no));
  // 해결률: 1조 50% · 2조 30% · 3조 10%
  [12, 7, 2].forEach((n, k) => ms[k].board.cells.slice(0, n).forEach(cell => { cell.solved = true; }));
  return { ...x, xs, ms };
}

/** 들어오는 중인 공격을 지금 바로 맞게 한다 (2초 기다리는 대신) */
function land(m) { for (const x of m.incoming) x.until = 0; m.sweep(); }

test('방해 대상은 바로 위 순위 조, 1등은 2등을 공격, 끝난 조는 건너뜀 · 2초 뒤에 들어간다 (v0.7.0)', () => {
  const { c, xs, ms } = threeTeams();
  const ice = { id: 'ice', name: '얼음', desc: '' };
  assert.strictEqual(c.attack(3, ice, xs[2].p).to, 2);
  assert.strictEqual(c.attack(2, ice, xs[1].p).to, 1);
  assert.strictEqual(c.attack(1, ice, xs[0].p).to, 2);
  assert.ok(!(ms[0].fx.freeze > Date.now()), '바로 맞지는 않는다');
  assert.strictEqual(ms[0].incoming.length, 1, '1조에 들어오는 중');
  land(ms[0]);
  assert.ok(ms[0].fx.freeze > Date.now(), '2초 뒤 1조 얼음');
  assert.strictEqual(ms[0].atk.got, 1);
  // 1조가 판을 끝냈으면 2조의 공격은 (위에 남은 조가 없으니) 3조로
  c.round.results.set(1, { clear: true });
  assert.strictEqual(c.attack(2, ice, xs[1].p).to, 3);
  // 혼자 남으면 공격할 조가 없다
  c.round.results.set(3, { clear: false });
  assert.strictEqual(c.attack(2, ice, xs[1].p), null);
});

test('방패: 개인 덱 따로 최대 2개 · 2초 안에 가진 사람이 직접 막아야 한다 (v0.7.0)', () => {
  const { c, io, xs, ms } = threeTeams();
  const m2 = ms[1];
  const a = xs[1].p;
  for (let k = 0; k < 3; k++) m2.giveItem(a, { id: 'shield', name: '방패', desc: '', kind: 'good' });
  assert.strictEqual(m2.shieldOf.get(a.id), 2, '최대 2개');
  assert.strictEqual(m2.shields, 2);
  assert.strictEqual(m2.defend(a).why, 'nothing', '들어오는 공격이 없으면 못 씀');
  c.attack(3, { id: 'revive', name: '되살리기', desc: '' }, xs[2].p);
  const warn = io.last('incoming');
  assert.deepStrictEqual(warn.data.holders, [a.nick], '경고에 방패 가진 사람 이름');
  const d = m2.defend(a);
  assert.strictEqual(d.ok, true);
  land(m2);
  assert.strictEqual(m2.shieldOf.get(a.id), 1);
  assert.strictEqual(m2.board.cells.filter(x => x.solved).length, 7, '막았으니 그대로');
  assert.strictEqual(m2.atk.blocked, 1);
  assert.strictEqual(m2.atk.got, 0);
  const fb = io.log.filter(x => x.ev === 'board:attack').pop();
  assert.strictEqual(fb.data.blocked, true, '전광판에 막힘');
  // 방패가 없는 사람은 못 막고, 아무도 안 막으면 맞는다
  const other = { id: 'zz', nick: 'z', online: true, socketId: null };
  m2.add(other);
  c.attack(3, { id: 'revive', name: '되살리기', desc: '' }, xs[2].p);
  assert.strictEqual(m2.defend(other).why, 'no-shield');
  land(m2);
  assert.strictEqual(m2.board.cells.filter(x => x.solved).length, 1, '되살리기 6칸');
  assert.strictEqual(m2.atk.got, 1);
});

test('방해 효과: 얼음·먹구름 8초 · 방향 반전 15초 · 되살리기 6칸 · 뒤섞기(보스 공략 중인 사람만 빼고 모두 한 칸으로)', () => {
  const x = setup({ teams: 3 });
  const xs = [x.student(), x.student(), x.student(), x.student()];
  xs.forEach((s, k) => { x.hub.join(s.p, s.sock, x.code); x.c.pickTeam(s.p, k < 3 ? 1 : 2); });
  x.c.begin(); x.stopTimers();
  const m = x.c.round.matches.get(1);
  m.board.cells.slice(0, 12).forEach(c => { c.solved = true; });
  for (const id of ['ice', 'cloud', 'flip']) m.receiveAttack({ id, name: id, desc: '' }, 2, 'x');
  const t = Date.now();
  land(m);
  assert.ok(Math.abs(m.fx.freeze - t - 8000) < 200);
  assert.ok(Math.abs(m.fx.cloud - t - 8000) < 200);
  assert.ok(Math.abs(m.fx.confuse - t - 15000) < 200);
  m.fx.freeze = 0;
  m.receiveAttack({ id: 'revive', name: '되살리기', desc: '' }, 2, 'x');
  land(m);
  assert.strictEqual(m.board.cells.filter(c => c.solved).length, 6);
  // 뒤섞기: a 는 입력 중(→ 풀리고 옮겨짐), b 는 보스 공략 중(→ 그대로), c 는 그냥 서 있음
  const [a, b, c] = xs.map(s => s.p);
  m.pos.set(a.id, { r: 1, c: 5 }); m.occupy(a);
  m.pos.set(b.id, { r: 1, c: 8 });
  m.boss = { i: 1 * 12 + 9, q: BANK.boss[0], phase: 'wait', until: Date.now() + 9999, pid: null };
  m.bossGrab(b, 'Delete');
  m.receiveAttack({ id: 'shuffle', name: '뒤섞기', desc: '' }, 2, 'x');
  land(m);
  assert.deepStrictEqual(m.pos.get(b.id), { r: 1, c: 8 }, '보스 공략 중인 사람은 그대로');
  assert.deepStrictEqual(m.pos.get(a.id), m.pos.get(c.id), '나머지는 같은 칸');
  assert.notStrictEqual(m.pos.get(a.id).r * 12 + m.pos.get(a.id).c, m.boss.i, '보스 칸은 아님');
  assert.strictEqual(m.occBy.has(a.id), false, '치던 사람 점유는 풀림');
  assert.strictEqual(m.atk.got, 5);
});

test('보스를 잡으면 방해 아이템은 덱으로 → 원할 때 써서 대상 조가 맞고, 방해를 끄면 못 쓴다 (v0.7.0)', () => {
  const { c, ms, xs } = threeTeams();
  const m = ms[2], p = xs[2].p;
  process.env.FORCE_ITEM = 'ice';
  try {
    m.pos.set(p.id, { r: 1, c: 4 });
    m.boss = { i: 17, q: BANK.boss[1], phase: 'wait', until: Date.now() + 9999, pid: null };
    m.bossGrab(p, 'Delete');
    const r = m.bossSubmit(p, '2');
    assert.strictEqual(r.item.kind, 'attack');
    assert.strictEqual(r.item.kept, true);
    assert.strictEqual(ms[1].incoming.length, 0, '잡는 순간에는 공격하지 않는다');
    assert.strictEqual(m.deckOf(p.id)[0].id, 'ice', '덱 1번 칸');
    const u = m.useItem(p, 1);
    assert.strictEqual(u.ok, true);
    assert.strictEqual(u.item.to, 2);
    assert.strictEqual(m.deckOf(p.id)[0], null, '쓰면 칸이 빈다');
    land(ms[1]);
    assert.ok(ms[1].fx.freeze > Date.now());
    assert.strictEqual(m.atk.sent, 1);
    // 방해 끄기 → 덱의 공격 아이템은 못 쓰고(회색) 그대로 남는다
    m.giveItem(p, { id: 'cloud', name: '먹구름', desc: '', kind: 'attack' });
    c.setAttacks(false);
    assert.strictEqual(m.useItem(p, 1).why, 'attacks-off');
    assert.strictEqual(m.deckMsg(p.id).slots[0].off, true);
    assert.strictEqual(m.deckOf(p.id)[0].id, 'cloud');
  } finally { delete process.env.FORCE_ITEM; }
  assert.strictEqual(rollItem({ attacks: false, force: undefined }).kind !== 'attack', true);
});

test('전광판 정보: 조마다 작은 판(칸 글자) · 해결률 · 효과', () => {
  const { c, ms } = threeTeams();
  ms[0].boss = { i: 20, q: BANK.boss[0], phase: 'wait', until: Date.now() + 9999, pid: null };
  ms[0].receiveAttack({ id: 'cloud', name: '먹구름', desc: '' }, 2, 'x');
  land(ms[0]);
  const b = c.boardState();
  assert.strictEqual(b.teams.length, 3);
  assert.strictEqual(b.teams[0].cells.length, 24);
  assert.strictEqual(b.teams[0].cells[20], 'B');
  assert.strictEqual(b.teams[0].cells.slice(0, 12), '111111111111');
  assert.strictEqual(b.teams[0].pct, 50);
  assert.ok(b.teams[0].fx.cloud > 0);
  assert.strictEqual(b.attacks, true);
});

test('집결 보스 (수업 게임): 4번째 보스 차례에 모든 조 같은 자리 · 3명 미만 조는 보통 보스 (v0.7.0)', () => {
  const x = setup({ teams: 2 });
  const xs = [x.student(), x.student(), x.student(), x.student()];
  xs.forEach((s, k) => { x.hub.join(s.p, s.sock, x.code); x.c.pickTeam(s.p, k < 3 ? 1 : 2); });
  x.c.begin(); x.stopTimers();
  const r = x.c.round;
  const m1 = r.matches.get(1), m2 = r.matches.get(2);
  // 사람이 서 있지 않은 곳에 나오도록 모두 3열에 세운다
  for (const s of xs) (m1.has(s.p) ? m1 : m2).pos.set(s.p.id, { r: 0, c: 3 });
  for (let turn = 1; turn <= 4; turn++) {
    for (const m of [m1, m2]) m.boss = null;
    r.startedAt -= r.everyMs; // 한 차례 앞으로
    x.c.tick();
    if (turn < 4) assert.notStrictEqual(m1.boss.phase, 'gather', turn + '번째는 보통 보스');
  }
  assert.strictEqual(m1.boss.phase, 'gather', '4번째는 집결 보스 (3명 조)');
  assert.notStrictEqual(m2.boss.phase, 'gather', '1명 조는 보통 보스');
  const spot = x.c.gatherSpotFor(4);
  const col = m1.boss.i % 12;
  assert.ok(col === 1 || col === 10, '1열 또는 10열');
  assert.strictEqual(m1.boss.i, spot.r * 12 + (spot.side ? 10 : 1));
});

test('조 선택 화면 채팅: 수업 게임 전용 문구 · 게임 중인 학생은 못 보냄 (v0.7.3)', () => {
  const x = setup({ teams: 2 });
  const [s1, s2] = [x.student(), x.student()];
  x.hub.join(s1.p, s1.sock, x.code); x.hub.join(s2.p, s2.sock, x.code);
  x.c.pickTeam(s1.p, 1);
  assert.strictEqual(x.c.say(s1.p, 'shield').ok, true, '수업 게임 전용 문구');
  assert.strictEqual(x.c.say(s2.p, 'bot').why, 'bad', '학생 방 전용 문구는 안 됨');
  assert.strictEqual(x.io.last('chat').data.text, '방패 아껴 두자! 🛡');
  x.c.begin(); x.stopTimers();
  s1.p.lastChat = 0;
  assert.strictEqual(x.c.say(s1.p, 'ok').why, 'playing', '게임 중인 학생');
  assert.strictEqual(x.c.say(s2.p, 'ok').ok, true, '아직 조를 안 고른 학생은 조 선택 화면이라 됨');
  assert.strictEqual(x.c.detail().chat.length, 2);
});

test('시작 카운트다운: 5초(시험은 0.15초) 동안 움직임 · 보스 · 시간이 멈췄다가 풀린다 · 그동안 일시정지는 안 됨 (v0.7.6)', async () => {
  const x = setup({ teams: 2, countdownMs: 150 });
  const s1 = x.student();
  x.hub.join(s1.p, s1.sock, x.code); x.c.pickTeam(s1.p, 1);
  x.c.begin();
  clearInterval(x.c.round.timer);
  const m = x.c.round.matches.get(1);
  const before = x.c.remainMs();
  assert.ok(m.snapshot(s1.p.id).countdownMs > 0, '학생 화면에 카운트다운');
  assert.strictEqual(m.snapshot(s1.p.id).paused, false, '일시정지 가림막은 아님');
  const at = { ...m.pos.get(s1.p.id) };
  m.move(s1.p, { dir: at.c > 0 ? 'L' : 'R', seq: 1 });
  assert.deepStrictEqual(m.pos.get(s1.p.id), at, '카운트다운 중에는 못 움직임');
  assert.strictEqual(x.c.pause(true).ok, false);
  await new Promise(r => setTimeout(r, 250));
  assert.strictEqual(x.c.round.pausedAt, 0);
  assert.strictEqual(m.pausedAt, 0);
  assert.ok(Math.abs(x.c.remainMs() - before) < 150, '카운트다운 동안 제한 시간은 줄지 않음');
  m.move(s1.p, { dir: at.c > 0 ? 'L' : 'R', seq: 2 });
  assert.notDeepStrictEqual(m.pos.get(s1.p.id), at, '풀리면 움직임');
  clearInterval(m.sweeper);
});

test('소리 스위치: 학생 효과음 · 전광판 배경음 (기본 켜짐, 게임 중에도 바뀜)', () => {
  const { c } = setup();
  assert.strictEqual(c.settings.sfx, true);
  assert.strictEqual(c.settings.bgm, true);
  const r = c.setSound({ sfx: false });
  assert.deepStrictEqual([r.sfx, r.bgm], [false, true]);
  assert.strictEqual(c.detail().sfx, false);
  c.setSound({ bgm: false });
  assert.strictEqual(c.boardState().bgm, false);
});

// ── v0.12.0: 조 선택 잠그기 · 무작위로 섞기 ──
test('조 선택 잠그기: 학생은 못 고르고 교사는 옮길 수 있다', () => {
  const x = setup({ teams: 3 });
  const s = x.student();
  x.hub.join(s.p, s.sock, x.code);
  x.c.pickTeam(s.p, 1);
  assert.strictEqual(x.c.setTeamLock(true).on, true);
  assert.strictEqual(x.c.pickTeam(s.p, 2).ok, false);
  assert.strictEqual(x.c.teamOf.get(s.p.id), 1);
  assert.strictEqual(x.c.move(s.p.id, 3).ok, true, '교사는 옮김');
  assert.strictEqual(x.c.detail().teamLock, true);
  x.c.setTeamLock(false);
  assert.strictEqual(x.c.pickTeam(s.p, 2).ok, true);
});

test('무작위로 섞기: 미선택 학생까지 모두 고르게 · 봇은 제자리 · 게임 중에는 안 됨', () => {
  const x = setup({ teams: 3 });
  const xs = Array.from({ length: 8 }, () => x.student());
  xs.forEach((s, k) => { x.hub.join(s.p, s.sock, x.code); if (k < 5) x.c.pickTeam(s.p, 1); });
  x.c.addBot(2);
  const bot = x.c.bots()[0];
  assert.strictEqual(x.c.shuffleTeams().ok, true);
  assert.strictEqual(x.c.teamMembers(0).length, 0, '미선택 없음');
  assert.strictEqual(x.c.teamOf.get(bot.id), 2, '봇은 그대로');
  const sizes = [1, 2, 3].map(no => x.c.teamMembers(no).length);
  assert.strictEqual(sizes.reduce((a, b) => a + b), 9);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, '고르게 ' + sizes);
  x.c.begin(); x.stopTimers();
  assert.strictEqual(x.c.shuffleTeams().ok, false);
});
