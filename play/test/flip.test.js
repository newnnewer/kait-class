'use strict';
// 0.16.0 플립 배틀 — 맵 · 점유 · 뒤집기 · 끝내기 · 비트 · 설정 · 팀 배틀 방 (서버 없이 직접)
const test = require('node:test');
const assert = require('node:assert');
const { FlipMatch, FlipRound, flipBlocks, flipShape, createFlipBoard } = require('../server/game/flip');
const { stepFlipBot, makeBot } = require('../server/classes/bot');
const { clean, cleanRoom, cleanClass } = require('../server/rooms/settings');
const { Room } = require('../server/rooms/room');

function fakeIo() {
  const log = [];
  const sink = { emit: (ev, data) => log.push({ ev, data }) };
  const chain = { to: () => chain, emit: sink.emit };
  return { log, to: () => chain, last: ev => [...log].reverse().find(x => x.ev === ev) };
}
let n = 0;
function person(extra) {
  n += 1;
  return { id: 'p' + n, token: 't' + n, nick: '사람' + n, kind: 'cat', color: '#FFD23F', online: true, ...(extra || {}) };
}
/** 판 하나 + 팀 정하기 (team: id → 1 | 2) */
function makeMatch(opts) {
  const io = fakeIo();
  const team = new Map();
  const ends = [];
  const m = new FlipMatch({
    io, channels: ['a', 'b'], codes: ['print(1)', 'a = 1', 'x += 1'], seed: 7,
    s: { blocks: 40, occMs: 20000, limitMs: 60000, ...(opts || {}) },
    teamOf: p => team.get(p.id) || 0, onEnd: r => ends.push(r),
  });
  clearInterval(m.sweeper);
  const add = (no, r, c) => { const p = person(); team.set(p.id, no); m.add(p); m.pos.set(p.id, { r, c }); return p; };
  return { m, io, add, ends, team };
}
/** 상대(otherTeam) 색인 블록 번호 하나 */
function cellOf(m, t) { return m.board.cells.findIndex(c => c.t === t); }
function at(m, i) { return { r: Math.floor(i / m.board.cols), c: i % m.board.cols }; }

test('블록 수 = 인원 × (3 · 4 · 5분 → 5 · 6 · 7), 40 ~ 320 · 맵은 직사각형을 꽉 채운다', () => {
  assert.strictEqual(flipBlocks(30, 3), 150);
  assert.strictEqual(flipBlocks(30, 4), 180);
  assert.strictEqual(flipBlocks(30, 5), 210);
  assert.strictEqual(flipBlocks(2, 4), 40);    // 가장 작은 맵
  assert.strictEqual(flipBlocks(80, 5), 320);  // 가장 큰 맵
  assert.deepStrictEqual(flipShape(180), { cols: 18, rows: 10, total: 180 });
  const sh = flipShape(97);
  assert.ok(sh.total >= 97 && sh.cols > sh.rows);
});

test('처음 맵은 반반 무작위 — 씨앗이 같으면 같은 맵', () => {
  const a = createFlipBoard({ blocks: 180, seed: 5 }), b = createFlipBoard({ blocks: 180, seed: 5 });
  assert.deepStrictEqual(a.cells.map(c => c.t), b.cells.map(c => c.t));
  assert.strictEqual(a.cells.filter(c => c.t === 1).length, 90);
  assert.strictEqual(a.cells.filter(c => c.t === 2).length, 90);
});

test('우리 색 블록은 못 잡고, 상대 색 블록은 먼저 Enter 누른 사람만 — 잡을 때마다 새 코드', () => {
  const { m, add } = makeMatch();
  const own = cellOf(m, 1), opp = cellOf(m, 2);
  const a = add(1, 0, 0), b = add(1, 0, 0), c = add(2, 0, 0);
  m.pos.set(a.id, at(m, own));
  assert.strictEqual(m.occupy(a).why, 'own');
  m.pos.set(a.id, at(m, opp));
  const r = m.occupy(a);
  assert.ok(r.ok && typeof r.code === 'string' && r.i === opp);
  m.pos.set(b.id, at(m, opp));
  assert.strictEqual(m.occupy(b).why, 'taken');
  m.pos.set(c.id, at(m, opp));                 // 파랑 팀은 자기 색이라 못 잡음
  assert.strictEqual(m.occupy(c).why, 'own');
  // 틀리면 풀리고, 다시 잡으면 새 코드 (바로 앞 코드와 다름)
  assert.strictEqual(m.submit(a, 'zzz').correct, false);
  assert.ok(!m.occ.has(opp));
  const r2 = m.occupy(a);
  assert.notStrictEqual(r2.code, r.code);
});

test('다 치면 우리 색으로 뒤집히고, 상대가 다시 뒤집을 수 있다', () => {
  const { m, add, io } = makeMatch();
  const opp = cellOf(m, 2);
  const a = add(1, 0, 0), c = add(2, 0, 0);
  const before = m.counts();
  m.pos.set(a.id, at(m, opp));
  const code = m.occupy(a).code;
  assert.strictEqual(m.submit(a, code).correct, true);
  assert.strictEqual(m.board.cells[opp].t, 1);
  assert.deepStrictEqual(m.counts(), [before[0] + 1, before[1] - 1]);
  assert.strictEqual(m.stat(a).solved, 1);
  assert.deepStrictEqual(io.last('cell').data.counts, m.counts());
  // 파랑이 바로 다시 뒤집음 (뒤집힌 뒤 잠금 없음)
  m.pos.set(c.id, at(m, opp));
  const code2 = m.occupy(c).code;
  m.submit(c, code2);
  assert.strictEqual(m.board.cells[opp].t, 2);
});

test('Ctrl+방향키는 우리 색 블록을 건너뛰어 상대 색 블록으로 — 팀마다 반대로', () => {
  const { m, add } = makeMatch();
  const cols = m.board.cols;
  // 첫 줄을 빨강 빨강 빨강 파랑 … 으로
  for (let c = 0; c < cols; c++) m.board.cells[c].t = c < 3 ? 1 : 2;
  const red = add(1, 0, 0), blue = add(2, 0, 0);
  m.move(red, { dir: 'R', ctrl: true, seq: 1 });
  assert.deepStrictEqual(m.pos.get(red.id), { r: 0, c: 3 });  // 빨강: 첫 파랑 블록
  m.move(blue, { dir: 'R', ctrl: true, seq: 1 });
  assert.deepStrictEqual(m.pos.get(blue.id), { r: 0, c: 2 });  // 파랑: 빨강 덩어리의 끝
});

test('잠긴 블록(누가 치는 중)도 지나갈 수 있다 · 치는 동안은 못 움직인다', () => {
  const { m, add } = makeMatch();
  for (let c = 0; c < 3; c++) m.board.cells[c].t = 2;
  const a = add(1, 0, 1), b = add(1, 0, 0);
  m.occupy(a);
  m.move(a, { dir: 'R', seq: 1 });
  assert.deepStrictEqual(m.pos.get(a.id), { r: 0, c: 1 });     // 치는 중이라 그대로
  m.move(b, { dir: 'R', seq: 1 }); m.move(b, { dir: 'R', seq: 2 });
  assert.deepStrictEqual(m.pos.get(b.id), { r: 0, c: 2 });     // 잠긴 블록을 지나감
});

test('점유 시간이 지나면 풀린다', () => {
  const { m, add } = makeMatch({ occMs: 50 });
  const a = add(1, 0, 0);
  m.pos.set(a.id, at(m, cellOf(m, 2)));
  m.occupy(a);
  m.occ.get(m.occBy.get(a.id)).until = Date.now() - 1;
  m.sweep();
  assert.ok(!m.occBy.has(a.id));
});

test('시간이 끝나면 블록이 많은 팀 승 · 치던 블록은 안 뒤집힘 · 같으면 무승부', () => {
  const { m, add, ends } = makeMatch();
  const a = add(1, 0, 0);
  m.pos.set(a.id, at(m, cellOf(m, 2)));
  m.occupy(a);                       // 치는 중에 끝남
  const before = m.counts();
  m.endAt = Date.now() - 1;
  m.sweep();
  assert.strictEqual(ends.length, 1);
  assert.deepStrictEqual(ends[0].counts, before);
  assert.strictEqual(ends[0].winner, 0);  // 처음 맵은 20 : 20 → 무승부
  assert.strictEqual(ends[0].reason, 'time');

  const x = makeMatch();
  x.m.board.cells[cellOf(x.m, 2)].t = 1;  // 빨강 21 : 파랑 19
  x.m.finish('time');
  assert.strictEqual(x.ends[0].winner, 1);
});

test('비트: 가까운 상대 색 블록으로 가서 점유 → 제출해 뒤집는다', () => {
  const { m, team } = makeMatch();
  const bot = makeBot('비트');
  team.set(bot.id, 1);
  m.add(bot);
  const opp = cellOf(m, 2);
  m.pos.set(bot.id, at(m, opp));
  const rnd = Math.random;
  Math.random = () => 0.2;            // 가장 가까운 블록 · 틀리지 않게 (WRONG_RATE 0.1)
  try {
    stepFlipBot(bot, m, 'fast', new Set());
    assert.strictEqual(m.occBy.get(bot.id), opp);
    bot.brain.nextAt = 0;
    stepFlipBot(bot, m, 'fast', new Set()); // 타이핑 시간 정하기
    bot.brain.submitAt = Date.now() - 1;
    stepFlipBot(bot, m, 'fast', new Set());
  } finally { Math.random = rnd; }
  assert.strictEqual(m.board.cells[opp].t, 1);
});

test('설정: 플립 배틀은 팀 배틀에서만 · 2팀 · 팀마다 1~16명 · 게임 시간 3 · 4 · 5분 · 블록 40 ~ 320', () => {
  const s = cleanRoom({ tags: ['출력'], mode: 'battle', game: 'flip', teams: 4, teamSize: 20, limitMin: 7, blocks: 999 });
  assert.deepStrictEqual([s.game, s.teams, s.teamSize, s.max, s.limitMin, s.blocks], ['flip', 2, 16, 32, 4, 320]);
  assert.strictEqual(cleanRoom({ tags: ['출력'], mode: 'battle', game: 'flip', limitMin: 3 }).limitMin, 3);
  assert.strictEqual(clean({ tags: ['출력'], game: 'flip' }).game, 'rush');           // 레이드는 늘 블록 러시
  const r = cleanRoom({ tags: ['출력'], mode: 'battle', teams: 3, teamSize: 20 });     // 블록 러시 팀 배틀은 그대로
  assert.deepStrictEqual([r.game, r.teams, r.teamSize], ['rush', 3, 8]);
  const c = cleanClass({ tags: ['출력'], game: 'flip', teams: 6, limitMin: 5 });
  assert.deepStrictEqual([c.game, c.teams, c.limitMin, c.attacks], ['flip', 2, 5, false]);
  assert.strictEqual(cleanClass({ tags: ['출력'], teams: 6 }).game, 'rush');
});

// ── 팀 배틀 방에서 ──
function fakeWorld() {
  const log = [];
  const io = { to: ch => ({ to: () => io.to(ch), emit: (ev, data) => log.push({ ch, ev, data }) }), sockets: { sockets: new Map() } };
  const lobby = {
    io, idleMs: 60000, idleWarnMs: 15000, countdownMs: 0, autoStartMs: 1000, hostOffMs: 1000, waitCloseMs: 600000,
    problemsFor: () => ({ codes: ['print(1)', 'a = 1', 'x += 1'], bosses: [] }),
    changed() {}, enter() {}, remove() {}, socketOf: p => p.sock || null,
  };
  const mk = () => {
    const sock = { joined: new Set(), got: [], join(c) { this.joined.add(c); }, leave(c) { this.joined.delete(c); }, emit(ev, d) { this.got.push({ ev, d }); } };
    return person({ sock });
  };
  return { lobby, log, mk };
}

test('팀 배틀 · 플립 배틀: 두 팀이 같은 판 · 한 팀이 모두 나가면 상대 팀 승', () => {
  const w = fakeWorld();
  const host = w.mk();
  const room = new Room({ lobby: w.lobby, id: 'f1', host, settings: cleanRoom({ tags: ['출력'], mode: 'battle', game: 'flip', teamSize: 12 }) });
  room.join(host, host.sock);
  const b = w.mk();
  room.join(b, b.sock);
  room.toggleReady(b);
  assert.notStrictEqual(room.teamOf.get(host.id), room.teamOf.get(b.id));
  const res = room.start(host);
  assert.ok(res.ok, res.error);
  assert.strictEqual(room.round.game, 'flip');
  const m = room.matchOf(host);
  assert.ok(m && m === room.matchOf(b));
  assert.strictEqual(m.board.cells.length, 40);
  assert.ok(room.detail().blocksNow >= 40);
  const ended = [];
  room.onEnd = r => ended.push(r);
  const bTeam = room.teamOf.get(b.id);
  room.leave(b, b.sock);                     // b 의 팀에 사람이 없음 → 기권
  assert.strictEqual(ended.length, 1);
  const r = ended[0];
  assert.strictEqual(r.game, 'flip');
  assert.strictEqual(r.winner, bTeam === 1 ? 2 : 1);
  assert.strictEqual(r.teams[0].no, r.winner);
  assert.ok(r.teams.find(t => t.no === bTeam).out);
  assert.ok(Array.isArray(r.history) && r.history.length >= 1 && r.history[0].c.length === 2);
  if (room.round) room.round.kill();
  room.closed = true;
});

test('FlipRound: 상황판 · 일시정지 · 교사가 끝내기', () => {
  const io = fakeIo();
  const teamOf = new Map();
  const ps = [person(), person(), person()];
  teamOf.set(ps[0].id, 1); teamOf.set(ps[1].id, 2); teamOf.set(ps[2].id, 2);
  const results = [];
  const owner = {
    io, settings: cleanClass({ tags: ['출력'], game: 'flip', limitMin: 3 }), names: ['튜링', '호퍼'], label: '1234', mode: 'class', noIdle: true,
    teamOf, teamMembers: no => ps.filter(p => teamOf.get(p.id) === no), teamChannel: no => 'c:t' + no,
    bots: () => [], standingsTo: () => ['c'], changed() {}, onRoundEnd: r => results.push(r),
  };
  const r = new FlipRound({ owner, seed: 3, codes: ['a = 1', 'b = 2'], countdownMs: 0 });
  assert.strictEqual(r.blocks, 40);
  assert.strictEqual(r.limitMs, 180000);
  const st = r.standings();
  assert.deepStrictEqual(st.map(x => x.no), [1, 2]);
  assert.strictEqual(st[0].blocks + st[1].blocks, 40);
  assert.ok(r.pause(true).paused);
  assert.ok(r.match.pausedAt);
  r.pause(false);
  r.match.board.cells[cellOf(r.match, 1)].t = 2;   // 파랑이 앞섬
  r.stop();
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].reason, 'stop');
  assert.strictEqual(results[0].winner, 2);
  assert.strictEqual(results[0].teams[0].no, 2);
  assert.strictEqual(results[0].teams[0].rank, 1);
  assert.strictEqual(results[0].teams[1].rank, 2);
});

test('놓은 블록(Esc · 오답 · 시간 초과)은 다른 블록을 뒤집기 전까지 다시 못 잡는다', () => {
  const { m, add } = makeMatch();
  const [x, y] = m.board.cells.map((c, i) => (c.t === 2 ? i : -1)).filter(i => i >= 0);
  const a = add(1, 0, 0);
  m.pos.set(a.id, at(m, x));
  m.occupy(a);
  m.release(a, 'esc');
  assert.strictEqual(m.occupy(a).why, 'again');
  m.occupy(a); // 여전히 막힘
  assert.ok(!m.occBy.has(a.id));
  // 다른 사람은 그 블록을 잡을 수 있다
  const b = add(1, 0, 0);
  m.pos.set(b.id, at(m, x));
  assert.ok(m.occupy(b).ok);
  m.release(b, 'leave');                 // 나가서 풀린 것은 막지 않는다
  m.pos.set(b.id, at(m, x));
  assert.ok(m.occupy(b).ok);
  m.release(b, 'esc');
  // 틀려도 같다
  m.pos.set(a.id, at(m, y));
  m.occupy(a);
  m.submit(a, 'zzz');
  assert.strictEqual(m.occupy(a).why, 'again');
  assert.strictEqual(m.snapshot(a.id).banned, y);
  // 다른 블록을 뒤집으면 풀린다
  const z = m.board.cells.findIndex((c, i) => c.t === 2 && i !== x && i !== y);
  m.pos.set(a.id, at(m, z));
  m.submit(a, m.occupy(a).code);
  m.pos.set(a.id, at(m, y));
  assert.ok(m.occupy(a).ok);
});
