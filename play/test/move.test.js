'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { step, edge, corner } = require('../public/js/shared/move');

// 한 줄 12칸 판. solvedSet: 해결된 칸 번호, bossAt: 막힌 칸
function board(rows, solvedSet = [], bossAt = -1) {
  const s = new Set(solvedSet);
  return { cols: 12, rows, solved: i => s.has(i), blocked: i => i === bossAt };
}

test('방향키 한 칸, 판 밖으로는 못 나간다', () => {
  const b = board(2);
  assert.deepStrictEqual(step(b, { r: 0, c: 0 }, 'R', false), { r: 0, c: 1 });
  assert.deepStrictEqual(step(b, { r: 0, c: 0 }, 'L', false), { r: 0, c: 0 });
  assert.deepStrictEqual(step(b, { r: 1, c: 5 }, 'D', false), { r: 1, c: 5 });
});

test('Ctrl: 미해결 덩어리 끝까지', () => {
  // 0행: 0~4 미해결, 5 해결, 6~11 미해결
  const b = board(1, [5]);
  assert.deepStrictEqual(step(b, { r: 0, c: 0 }, 'R', true), { r: 0, c: 4 });
});

test('Ctrl: 해결 칸은 건너뛰고 다음 미해결 칸까지', () => {
  const b = board(1, [5, 6, 7]);
  assert.deepStrictEqual(step(b, { r: 0, c: 4 }, 'R', true), { r: 0, c: 8 });
});

test('Ctrl: 해결 칸 위에서 출발하면 다음 미해결 칸, 없으면 판 끝', () => {
  const b = board(1, [9, 10, 11]);
  assert.deepStrictEqual(step(b, { r: 0, c: 9 }, 'R', true), { r: 0, c: 11 });
});

test('Ctrl: 보스 바로 앞에서 멈춘다', () => {
  const b = board(1, [], 7);
  assert.deepStrictEqual(step(b, { r: 0, c: 0 }, 'R', true), { r: 0, c: 6 });
  assert.deepStrictEqual(step(b, { r: 0, c: 6 }, 'R', false), { r: 0, c: 6 });
});

test('Ctrl 세로 이동', () => {
  const b = board(4, [12, 24]); // 1행·2행 0열 해결
  assert.deepStrictEqual(step(b, { r: 0, c: 0 }, 'D', true), { r: 3, c: 0 });
});

test('Home / End', () => {
  const b = board(1);
  assert.deepStrictEqual(edge(b, { r: 0, c: 5 }, 'home'), { r: 0, c: 0 });
  assert.deepStrictEqual(edge(b, { r: 0, c: 5 }, 'end'), { r: 0, c: 11 });
  const b2 = board(1, [], 9);
  assert.deepStrictEqual(edge(b2, { r: 0, c: 5 }, 'end'), { r: 0, c: 8 });
});

test('Ctrl+Home / Ctrl+End: 판의 맨 처음 칸 / 맨 마지막 칸, 보스면 바로 옆', () => {
  assert.deepStrictEqual(corner(board(3), 'first'), { r: 0, c: 0 });
  assert.deepStrictEqual(corner(board(3), 'last'), { r: 2, c: 11 });
  assert.deepStrictEqual(corner(board(3, [], 0), 'first'), { r: 0, c: 1 });
  assert.deepStrictEqual(corner(board(3, [], 35), 'last'), { r: 2, c: 10 });
});
