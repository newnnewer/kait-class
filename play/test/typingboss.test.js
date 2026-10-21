'use strict';
// 0.15.0 타이핑 보스 — 보스 방식 '타이핑': 문제 없이 완성된 코드를 한 줄씩 친다
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { Match } = require('../server/game/match');
const { typingLines, isCorrect } = require('../server/game/grade');
const { parseBank } = require('../server/problems/parser');
const { clean, cleanRoom, cleanClass } = require('../server/rooms/settings');

function fakeIo() {
  const log = [];
  const room = { emit: (ev, data) => log.push({ ev, data }) };
  return { log, to: () => room, last: ev => [...log].reverse().find(x => x.ev === ev) };
}
const LOOP = { title: '0부터 세기', code: "for i in range(3):\n    print(i, end='')", input: null, answers: ['012'], tags: ['반복문'] };
const BLANK = { title: '빈칸', code: "x = 5\n___\nprint(x)", input: null, answers: ['x = x + 1', 'x += 1'], tags: ['변수'] };

function makeRoom(extra) {
  const io = fakeIo();
  const room = new Match({
    io, channel: 'c', codes: ['print(1)', 'a = 1'], bosses: [LOOP],
    s: { blocks: 96, bossMode: 'typing', bossLineMs: 7000, ...(extra || {}) }, onEnd: () => {},
  });
  clearInterval(room.sweeper);
  const add = (id, r, c) => {
    const p = { id, nick: 'p' + id, kind: 'cat', color: '#FFD23F', online: true, socketId: 's' + id };
    room.add(p);
    room.pos.set(id, { r, c });
    return p;
  };
  return { room, io, add };
}

test('typingLines: 빈칸은 첫 정답으로 채우고, 들여쓰기는 남기고, 빈 줄은 뺀다', () => {
  assert.deepStrictEqual(typingLines(BLANK), ['x = 5', 'x = x + 1', 'print(x)']);
  assert.deepStrictEqual(typingLines(LOOP), ['for i in range(3):', "    print(i, end='')"]);
  assert.deepStrictEqual(typingLines({ code: 'a = 1\n\n  \nb = 2  ', answers: [] }), ['a = 1', 'b = 2']);
});

test('문제 은행의 보스 모두 타이핑 보스로 칠 수 있다 (각 줄을 그대로 치면 정답)', () => {
  const bank = parseBank(fs.readFileSync(path.join(__dirname, '../problems/bank.txt'), 'utf8'));
  assert.ok(bank.boss.length >= 100);
  for (const q of bank.boss) {
    const lines = typingLines(q);
    assert.ok(lines.length >= 1, q.title);
    for (const l of lines) {
      assert.ok(!l.includes('___'), q.title);
      assert.ok(isCorrect(l, l), `${q.title}: ${l}`);
      assert.ok(isCorrect(l.trim(), l), `들여쓰기 없이 쳐도 정답 — ${q.title}: ${l}`);
    }
  }
});

test('설정: 보스 방식 · 줄마다 시간 검사 (자유 플레이는 줄마다 7초 고정)', () => {
  assert.strictEqual(clean({ tags: ['출력'] }).bossMode, 'quiz');
  assert.strictEqual(clean({ tags: ['출력'], bossMode: 'typing' }).bossMode, 'typing');
  assert.strictEqual(clean({ tags: ['출력'], bossMode: 'xx' }).bossMode, 'quiz');
  assert.strictEqual(cleanClass({ tags: ['출력'], bossLineSec: 10 }).bossLineSec, 10);
  assert.strictEqual(cleanClass({ tags: ['출력'], bossLineSec: 9 }).bossLineSec, 7);
  const r = cleanRoom({ tags: ['출력'], bossMode: 'typing', bossLineSec: 12 });
  assert.strictEqual(r.bossMode, 'typing');
  assert.strictEqual(r.bossLineSec, 7);
});

test('타이핑 보스: 잡으면 완성된 코드 줄이 오고, 시간 = 5초 + 줄 수 × 줄마다 시간', () => {
  const { room, add } = makeRoom();
  const a = add('a', 0, 4);
  room.boss = { i: 5, q: LOOP, phase: 'wait', until: Date.now() + 9999, pid: null };
  const g = room.bossGrab(a, 'Delete');
  assert.strictEqual(g.ok, true);
  assert.strictEqual(g.q.typing, true);
  assert.strictEqual(g.q.title, '타이핑 보스');
  assert.deepStrictEqual(g.q.lines, typingLines(LOOP));
  assert.strictEqual(g.ms, 5000 + 2 * 7000);
});

test('타이핑 보스: 틀린 줄은 다시 칠 수 있고, 마지막 줄까지 맞으면 격파 + 아이템', () => {
  const { room, add, io } = makeRoom();
  const a = add('a', 0, 4);
  room.boss = { i: 5, q: LOOP, phase: 'wait', until: Date.now() + 9999, pid: null };
  room.bossGrab(a, 'Delete');
  let r = room.bossSubmit(a, 'for i in range(4):');
  assert.deepStrictEqual([r.correct, r.retry, r.line], [false, true, 0]);
  assert.ok(room.boss && room.boss.phase === 'fight'); // 틀려도 끝나지 않는다
  r = room.bossSubmit(a, 'for i in range(3):');
  assert.deepStrictEqual([r.correct, r.more, r.line], [true, true, 1]);
  assert.deepStrictEqual(io.last('bossline').data, { i: 5, line: 1, total: 2 });
  r = room.bossSubmit(a, 'print(i,end="")'); // 들여쓰기 · 띄어쓰기 무시, 따옴표 바꿔도 됨
  assert.strictEqual(r.correct, true);
  assert.ok(r.item);
  assert.strictEqual(room.boss, null);
  assert.strictEqual(room.board.cells[5].solved, true);
  assert.strictEqual(room.stat(a).bosses, 1);
});

test('타이핑 보스: 시간이 지나면 실패 (줄을 다 못 쳤을 때)', () => {
  const { room, add } = makeRoom();
  const a = add('a', 0, 4);
  room.boss = { i: 5, q: LOOP, phase: 'wait', until: Date.now() + 9999, pid: null };
  room.bossGrab(a, 'Delete');
  room.bossSubmit(a, 'for i in range(3):');
  room.boss.until = Date.now() - 1;
  room.sweep();
  assert.strictEqual(room.boss, null);
  assert.strictEqual(room.board.cells[5].solved, false);
});

test('문제 풀이 방식은 그대로 (한 번 틀리면 끝)', () => {
  const { room, add } = makeRoom({ bossMode: 'quiz' });
  const a = add('a', 0, 4);
  room.boss = { i: 5, q: LOOP, phase: 'wait', until: Date.now() + 9999, pid: null };
  const g = room.bossGrab(a, 'Delete');
  assert.strictEqual(g.q.typing, undefined);
  assert.strictEqual(g.q.lines, undefined);
  assert.strictEqual(g.ms, 30000);
  const r = room.bossSubmit(a, '0 1 3');
  assert.strictEqual(r.correct, false);
  assert.strictEqual(room.boss, null);
});
