'use strict';
// 경기(보스·아이템·점유·끝) 규칙을 서버 없이 직접 시험한다
const test = require('node:test');
const assert = require('node:assert');
const { Match } = require('../server/game/match');

// 보낸 알림을 모아 두는 가짜 io
function fakeIo() {
  const log = [];
  const room = { emit: (ev, data) => log.push({ ev, data }) };
  return { log, to: () => room, last: ev => [...log].reverse().find(x => x.ev === ev) };
}
const BOSSES = [
  { title: '빈칸', code: "print('Hello', ___)", input: null, answers: ["'World'"], tags: ['출력'] },
];
function makeRoom(timing, extra) {
  const io = fakeIo();
  const t = timing || {};
  const ends = [];
  const room = new Match({
    io, channel: 'c', codes: ['print(1)', 'a = 1', 'x += 1', 'if a > b:'], bosses: BOSSES,
    s: { blocks: 96, occMs: t.occLimitMs, ...(extra || {}) }, onEnd: r => ends.push(r),
  });
  clearInterval(room.sweeper);
  const add = (id, r, c) => {
    const p = { id, nick: 'p' + id, kind: 'cat', color: '#FFD23F', online: true, socketId: 's' + id };
    room.add(p);
    room.pos.set(id, { r, c });
    return p;
  };
  return { room, io, add, ends };
}
const W = 12;

test('보스는 미해결 · 점유 안 됨 · 아무도 서 있지 않은 칸에만 나온다', () => {
  const { room, add } = makeRoom();
  room.board.cells.forEach((c, i) => { if (i > 2) c.solved = true; });
  const a = add('a', 0, 0);             // 0번 칸에 서 있음
  add('b', 0, 1); room.pos.set('b', { r: 5, c: 5 }); // 해결된 칸에 서 있음
  room.pos.set('a', { r: 0, c: 1 });    // 1번 칸에 서서
  room.occupy(a);                       //   1번 칸 점유
  room.pos.set('a', { r: 0, c: 0 });    // 0번 칸으로 (점유 중이라 원래는 못 움직이지만 시험용)
  room.spawnBoss();
  assert.strictEqual(room.boss.i, 2);
});

test('보스 칸으로는 못 들어가고, Ctrl 점프도 보스 앞에서 멈춘다', () => {
  const { room, add } = makeRoom();
  const a = add('a', 0, 0);
  room.boss = { i: 5, q: BOSSES[0], phase: 'wait', until: Date.now() + 9999, pid: null };
  room.move(a, { dir: 'R', ctrl: true, seq: 1 });
  assert.deepStrictEqual(room.pos.get('a'), { r: 0, c: 4 });
  room.move(a, { dir: 'R', seq: 2 });
  assert.deepStrictEqual(room.pos.get('a'), { r: 0, c: 4 });
});

test('Delete 는 보스 왼쪽에서, Backspace 는 오른쪽에서', () => {
  const { room, add } = makeRoom();
  const a = add('a', 0, 4), b = add('b', 0, 6);
  room.boss = { i: 5, q: BOSSES[0], phase: 'wait', until: Date.now() + 9999, pid: null };
  assert.strictEqual(room.bossGrab(a, 'Backspace').why, 'right');
  assert.strictEqual(room.bossGrab(b, 'Delete').why, 'left');
  const g = room.bossGrab(b, 'Backspace');
  assert.strictEqual(g.ok, true);
  assert.strictEqual(g.q.blank, true);
  assert.strictEqual(g.q.answers, undefined); // 정답은 보내지 않는다
  assert.strictEqual(room.bossGrab(a, 'Delete').why, 'none'); // 이미 공략 중
  // 공략 중에는 움직이지 않는다
  room.move(b, { dir: 'R', seq: 3 });
  assert.deepStrictEqual(room.pos.get('b'), { r: 0, c: 6 });
});

test('줄이 바뀌는 곳에서는 잡을 수 없다 (11열 오른쪽은 다음 줄 0열이 아님)', () => {
  const { room, add } = makeRoom();
  const a = add('a', 0, 11);
  room.boss = { i: 12, q: BOSSES[0], phase: 'wait', until: Date.now() + 9999, pid: null };
  assert.strictEqual(room.bossGrab(a, 'Delete').ok, false);
});

test('보스 정답 → 그 칸 해결 + 보스 해결 표시 + 아이템', () => {
  const { room, io, add } = makeRoom();
  const a = add('a', 1, 4);
  room.boss = { i: 17, q: BOSSES[0], phase: 'wait', until: Date.now() + 9999, pid: null };
  room.bossGrab(a, 'Delete');
  const r = room.bossSubmit(a, '"World"');
  assert.strictEqual(r.correct, true);
  assert.ok(r.item && r.item.name);
  assert.strictEqual(room.board.cells[17].solved, true);
  assert.strictEqual(room.board.cells[17].bossBy, 'pa');
  assert.strictEqual(room.boss, null);
  assert.ok(io.last('item'));
});

test('보스 오답 → 일반 블록으로 돌아가고 기회 소멸', () => {
  const { room, add } = makeRoom();
  const a = add('a', 1, 4);
  room.boss = { i: 17, q: BOSSES[0], phase: 'wait', until: Date.now() + 9999, pid: null };
  room.bossGrab(a, 'Delete');
  const r = room.bossSubmit(a, 'World');
  assert.strictEqual(r.correct, false);
  assert.strictEqual(room.boss, null);
  assert.strictEqual(room.board.cells[17].solved, false);
});

test('보스: 8초 안에 아무도 안 잡으면 달아나고, 공략 30초가 지나면 실패', () => {
  const { room, io, add } = makeRoom();
  const a = add('a', 1, 4);
  room.boss = { i: 17, q: BOSSES[0], phase: 'wait', until: Date.now() - 1, pid: null };
  room.sweep();
  assert.strictEqual(room.boss, null);
  assert.strictEqual(io.last('boss').data.end, 'escaped');
  room.boss = { i: 17, q: BOSSES[0], phase: 'wait', until: Date.now() + 9999, pid: null };
  room.bossGrab(a, 'Delete');
  room.boss.until = Date.now() - 1;
  room.sweep();
  assert.strictEqual(io.last('boss').data.end, 'timeout');
  // 끝나면 15초 뒤 다음 보스
  assert.ok(room.nextBossAt - Date.now() > 14000);
});

test('일반 블록 점유는 점유한 순간부터 제한 시간', () => {
  const { room, io, add } = makeRoom({ occLimitMs: 30000 });
  const a = add('a', 0, 0);
  const r = room.occupy(a);
  assert.strictEqual(r.ms, 30000);
  room.occ.get(0).until = Date.now() - 1;
  room.sweep();
  assert.strictEqual(room.occBy.has('a'), false);
  assert.strictEqual(io.last('occ').data.why, 'timeout');
});

test('아이템: 폭탄(둘레 8칸, 점유 칸 포함) · 가로/세로 레이저(남은 칸 모두) · 쉬운 길(둘레 8칸) · 역풍 4칸', () => {
  const { room, io, add } = makeRoom();
  const a = add('a', 3, 3);
  const typer = add('t', 0, 0);
  const b = room.board;
  const bi = 2 * W + 5;
  // 폭탄: 둘레 8칸 — 누가 치고 있던 칸도 해결되고, 그 사람에게 알린다
  room.pos.set('t', { r: 1, c: 6 });
  room.occupy(typer);
  room.applyItem({ id: 'bomb', name: '폭탄', kind: 'good' }, a, bi);
  const ring = [bi - W - 1, bi - W, bi - W + 1, bi - 1, bi + 1, bi + W - 1, bi + W, bi + W + 1];
  assert.deepStrictEqual(ring.map(i => b.cells[i].solved), ring.map(() => true));
  assert.strictEqual(room.occBy.has('t'), false, '치던 사람의 점유가 풀림');
  assert.strictEqual(io.log.filter(x => x.ev === 'released').pop().data.why, 'item');
  assert.strictEqual(room.stats.get('t').solved, 0, '아이템으로 푼 칸은 개인 기록에 안 셈');
  // 판 모서리 폭탄은 있는 칸만
  room.applyItem({ id: 'bomb', name: '폭탄', kind: 'good' }, a, 0);
  assert.deepStrictEqual([1, W, W + 1].map(i => b.cells[i].solved), [true, true, true]);
  // 가로 레이저: 그 줄 남은 칸 모두 (보스 칸은 따로 해결되므로 제외)
  room.applyItem({ id: 'laser', name: '가로 레이저', kind: 'good' }, a, 4 * W + 7);
  assert.strictEqual(b.cells.slice(4 * W, 5 * W).filter((x, k) => !x.solved && k !== 7).length, 0);
  // 세로 레이저: 그 세로줄 남은 칸 모두
  room.applyItem({ id: 'vlaser', name: '세로 레이저', kind: 'good' }, a, 6 * W + 10);
  for (let r = 0; r < b.rows; r++) if (r !== 6) assert.strictEqual(b.cells[r * W + 10].solved, true);
  // 쉬운 길: 내 둘레 8칸 (v0.7.1) — 치고 있는 칸은 그대로
  const codesBefore = b.cells.map(c => c.code);
  room.shortCodes = ['f()'];
  const ei = 6 * W + 3;
  room.pos.set('t', { r: 5, c: 2 }); room.occupy(typer);
  room.applyItem({ id: 'easy', name: '쉬운 길', kind: 'good' }, a, ei);
  const changed = b.cells.map((c, i) => c.code !== codesBefore[i] ? i : -1).filter(i => i >= 0);
  assert.deepStrictEqual(changed, [ei - W, ei - W + 1, ei - 1, ei + 1, ei + W - 1, ei + W, ei + W + 1], '둘레 8칸 중 치고 있는 칸(5,2) 빼고 7칸');
  room.release(typer, 'esc');
  // 역풍: 해결 칸 4개가 되살아남
  const solved = () => b.cells.filter(c => c.solved).length;
  const s0 = solved();
  room.applyItem({ id: 'backfire', name: '역풍', kind: 'bad' }, a, bi);
  assert.strictEqual(solved(), s0 - 4);
});

test('아이템 시간: 자폭 5초 · 혼란 15초 · 자동완성 10초', () => {
  const { room, add } = makeRoom();
  const a = add('a', 3, 3);
  const t = Date.now();
  room.applyItem({ id: 'freeze', name: '자폭', kind: 'bad' }, a, 0);
  room.applyItem({ id: 'confuse', name: '혼란', kind: 'bad' }, a, 0);
  room.applyItem({ id: 'auto', name: '자동완성', kind: 'good' }, a, 0);
  assert.ok(Math.abs(room.fx.freeze - t - 5000) < 200);
  assert.ok(Math.abs(room.fx.confuse - t - 15000) < 200);
  assert.ok(Math.abs(room.fx.auto - t - 10000) < 200);
});

test('아이템: 자폭(얼음)은 움직임·점유를 막고, 혼란은 방향을 뒤집는다', () => {
  const { room, add } = makeRoom();
  const a = add('a', 3, 3);
  room.applyItem({ id: 'freeze', name: '자폭', kind: 'bad' }, a, 0);
  room.move(a, { dir: 'R', seq: 1 });
  assert.deepStrictEqual(room.pos.get('a'), { r: 3, c: 3 });
  assert.strictEqual(room.occupy(a).why, 'frozen');
  room.fx.freeze = 0;
  room.applyItem({ id: 'confuse', name: '혼란', kind: 'bad' }, a, 0);
  room.move(a, { dir: 'R', seq: 2 });
  assert.deepStrictEqual(room.pos.get('a'), { r: 3, c: 2 });
});

test('Ctrl+Home / Ctrl+End 이동, 점유 중에는 안 움직인다', () => {
  const { room, add } = makeRoom();
  const a = add('a', 3, 5);
  room.move(a, { to: 'last', seq: 1 });
  assert.deepStrictEqual(room.pos.get('a'), { r: 7, c: 11 });
  room.move(a, { to: 'first', seq: 2 });
  assert.deepStrictEqual(room.pos.get('a'), { r: 0, c: 0 });
  room.occupy(a);
  room.move(a, { to: 'last', seq: 3 });
  assert.deepStrictEqual(room.pos.get('a'), { r: 0, c: 0 });
});

test('끝: 판을 모두 채우면 성공, 제한 시간이 지나면 시간 초과, 개인 기록', () => {
  const { room, add, ends } = makeRoom();
  const a = add('a', 0, 0);
  room.board.cells.forEach((c, i) => { if (i > 0) c.solved = true; });
  room.occupy(a);
  room.submit(a, room.board.cells[0].code);
  assert.strictEqual(ends.length, 1);
  assert.strictEqual(ends[0].reason, 'clear');
  assert.strictEqual(ends[0].success, true);
  assert.strictEqual(ends[0].players[0].solved, 1);
  const r2 = makeRoom();
  r2.add('b', 0, 0);
  r2.room.endAt = Date.now() - 1;
  r2.room.sweep();
  assert.strictEqual(r2.ends[0].reason, 'time');
});

test('방치: 1분 동안 아무도 입력하지 않으면 경고, 키를 누르면 풀리고, 그대로 두면 끝', () => {
  const { room, io, add, ends } = makeRoom();
  const a = add('a', 0, 0);
  room.lastInput = Date.now() - 61000;
  room.sweep();
  assert.strictEqual(io.last('idle').data.warn, true);
  room.move(a, { dir: 'R', seq: 1 });
  assert.strictEqual(io.last('idle').data.warn, false);
  room.lastInput = Date.now() - 76000;
  room.sweep(); room.sweep();
  assert.strictEqual(ends[0].reason, 'idle');
});

test('모두 나가면 경기가 끝난다', () => {
  const { room, add, ends } = makeRoom();
  const a = add('a', 0, 0), b = add('b', 1, 1);
  room.leave(a);
  assert.strictEqual(ends.length, 0);
  room.leave(b);
  assert.strictEqual(ends[0].reason, 'empty');
});

test('봇의 움직임은 방치 판정에 들어가지 않는다 (v0.6.4)', () => {
  const { room, io, add } = makeRoom();
  add('a', 0, 0);
  const bot = { id: 'bot1', nick: '봇', kind: 'cat', color: '#fff', online: true, socketId: null, bot: true };
  room.add(bot); room.pos.set('bot1', { r: 2, c: 2 });
  room.lastInput = Date.now() - 61000;
  room.sweep();
  assert.strictEqual(io.last('idle').data.warn, true);
  room.move(bot, { dir: 'R', seq: -1 });
  room.occupy(bot);
  assert.strictEqual(io.last('idle').data.warn, true); // 봇이 움직여도 경고는 그대로
});

// ── v0.7.0: 개인 덱 · 집결 보스 ──

test('보스를 잡으면 아이템은 잡은 사람의 덱으로 (5칸, 가득 차면 사라짐) · 페널티는 바로', () => {
  const { room, add } = makeRoom();
  const a = add('a', 0, 4);
  const win = () => {
    room.pos.set('a', { r: 0, c: 4 });
    room.boss = { i: 5, q: BOSSES[0], phase: 'wait', until: Date.now() + 9999, pid: null };
    room.bossGrab(a, 'Delete');
    room.board.cells[5].solved = false;
    return room.bossSubmit(a, "'World'");
  };
  process.env.FORCE_ITEM = 'bomb';
  try {
    for (let k = 0; k < 5; k++) assert.strictEqual(win().item.kept, true);
    assert.strictEqual(room.deckOf('a').filter(Boolean).length, 5);
    assert.strictEqual(win().item.kept, false, '6번째는 사라짐');
    process.env.FORCE_ITEM = 'confuse';
    const t = Date.now();
    win();
    assert.ok(room.fx.confuse - t > 7000, '페널티는 바로 발동');
  } finally { delete process.env.FORCE_ITEM; }
  assert.strictEqual(room.useItem(a, 9).why, 'empty');
});

test('덱 아이템은 쓰는 사람의 자리 기준: 폭탄(내 둘레 8칸) · 가로/세로 레이저(내 줄) · 빈 칸은 못 씀', () => {
  const { room, add } = makeRoom();
  const a = add('a', 3, 5);
  const give = id => room.giveItem(a, { id, name: id, desc: '', kind: 'good' });
  give('bomb'); give('laser'); give('vlaser');
  room.useItem(a, 1);
  const around = [2 * W + 4, 2 * W + 5, 2 * W + 6, 3 * W + 4, 3 * W + 6, 4 * W + 4, 4 * W + 5, 4 * W + 6];
  assert.ok(around.every(i => room.board.cells[i].solved), '둘레 8칸');
  assert.strictEqual(room.board.cells[3 * W + 5].solved, false, '내 칸은 아님');
  room.pos.set('a', { r: 6, c: 2 });
  room.useItem(a, 2);
  for (let c = 0; c < W; c++) assert.ok(room.board.cells[6 * W + c].solved, '6줄 모두');
  room.useItem(a, 3);
  for (let r = 0; r < 8; r++) assert.ok(room.board.cells[r * W + 2].solved, '2열 모두');
  assert.strictEqual(room.useItem(a, 1).why, 'empty', '쓴 칸은 비어 있음');
  // 얼음 중에는 못 씀
  give('auto');
  room.fx.freeze = Date.now() + 5000;
  assert.strictEqual(room.useItem(a, 1).why, 'frozen');
});

test('집결 보스: 사람 3명 이상일 때 4번째 보스 차례에 (n,1) 또는 (n,10), 봇은 세지 않는다', () => {
  const { room, add } = makeRoom();
  add('a', 0, 5); add('b', 0, 6);
  const bot = { id: 'bot', nick: '봇', kind: 'cat', color: '#fff', online: true, socketId: null, bot: true };
  room.add(bot); room.pos.set('bot', { r: 0, c: 7 });
  assert.strictEqual(room.spawnGather(), false, '사람 2명 + 봇이면 안 나온다');
  add('c', 0, 8);
  for (let k = 1; k <= 3; k++) { room.boss = null; room.spawnBoss(); assert.strictEqual(room.boss.phase, 'wait'); }
  room.boss = null;
  room.spawnBoss();
  assert.strictEqual(room.boss.phase, 'gather', '4번째는 집결 보스');
  const col = room.boss.i % W;
  assert.ok(col === 1 || col === W - 2);
  assert.strictEqual(room.gatherInfo().need, 3);
});

test('집결 보스: 왼쪽·오른쪽 칸에 모두 모이면 바로 성공 → 모두에게 도움 아이템 · 칸 해결', () => {
  const { room, io, add } = makeRoom();
  const a = add('a', 3, 7), b = add('b', 4, 0), c = add('c', 0, 0);
  const bot = { id: 'bot', nick: '봇', kind: 'cat', color: '#fff', online: true, socketId: null, bot: true };
  room.add(bot); room.pos.set('bot', { r: 5, c: 5 });
  room.spawnGather({ r: 3, side: 0 }); // (3, 1)
  assert.strictEqual(room.boss.i, 3 * W + 1);
  room.move(a, { to: 'home', seq: 1 });          // Home 은 보스 앞에서 멈춤 → (3,2) 보스 오른쪽
  assert.deepStrictEqual(room.pos.get('a'), { r: 3, c: 2 });
  room.move(b, { dir: 'U', seq: 1 });            // ↑ → (3,0) 보스 왼쪽
  assert.deepStrictEqual(room.pos.get('b'), { r: 3, c: 0 });
  assert.strictEqual(io.last('gather').data.got, 2);
  assert.ok(room.boss, '아직 한 명 남음');
  room.pos.set('c', { r: 2, c: 0 });
  room.move(c, { dir: 'D', seq: 1 });            // ↓ 로 (3,0)
  assert.strictEqual(room.boss, null, '모두 모였으니 성공');
  assert.strictEqual(io.last('boss').data.end, 'gather');
  for (const id of ['a', 'b', 'c']) assert.strictEqual(room.deckOf(id).filter(Boolean).length, 1, id + ' 도움 아이템');
  assert.strictEqual(room.deckOf('bot').filter(Boolean).length, 0, '봇은 없음');
  assert.ok(room.deckOf('a')[0].kind === 'good');
  assert.strictEqual(room.board.cells[3 * W + 1].solved, true);
  assert.strictEqual(room.board.cells[3 * W + 1].bossBy, '모두');
});

test('집결 보스: 5초 안에 못 모이면 실패 · 사람이 서 있는 자리에는 안 나온다', () => {
  const { room, io, add } = makeRoom();
  add('a', 2, 1); add('b', 2, 10); add('c', 0, 5);
  room.spawnGather({ r: 2, side: 0 });
  assert.ok(room.boss.i !== 2 * W + 1 && room.boss.i !== 2 * W + 10, '2줄 양쪽 다 사람이 있으니 다른 줄');
  room.boss.until = Date.now() - 1;
  room.sweep();
  assert.strictEqual(room.boss, null);
  assert.strictEqual(io.last('boss').data.end, 'scattered');
});

test('시작 카운트다운 (학생 방): 그동안 점유 · 이동이 막히고 제한 시간이 흐르지 않는다 (v0.7.6)', async () => {
  const { room, add } = makeRoom({}, { countdownMs: 150, limitMs: 60000 });
  const a = add('a', 2, 2);
  assert.ok(room.snapshot('a').countdownMs > 0);
  assert.strictEqual(room.occupy(a).why, 'paused');
  room.move(a, { dir: 'R', seq: 1 });
  assert.deepStrictEqual(room.pos.get('a'), { r: 2, c: 2 });
  await new Promise(r => setTimeout(r, 250));
  assert.strictEqual(room.pausedAt, 0);
  assert.ok(room.endAt - Date.now() > 59700, '카운트다운 동안 멈췄던 만큼 뒤로');
  room.move(a, { dir: 'R', seq: 2 });
  assert.deepStrictEqual(room.pos.get('a'), { r: 2, c: 3 });
});
