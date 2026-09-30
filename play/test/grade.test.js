'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { isCorrect, tokenize, isBossCorrect } = require('../server/game/grade');
const { parseBank } = require('../server/problems/parser');

test('따옴표 밖 띄어쓰기는 무시', () => {
  assert.ok(isCorrect('print( 1,2 )', 'print(1, 2)'));
  assert.ok(isCorrect('for i in range(5):', 'for i in range(5):'));
  assert.ok(isCorrect('fori in range(5):', 'for i in range(5):')); // 약속한 규칙 그대로
});

test('문자열 안은 정확히', () => {
  assert.ok(!isCorrect("print('Hello,World!')", "print('Hello, World!')"));
  assert.ok(!isCorrect("print('hello ')", "print('hello')"));
  assert.ok(!isCorrect("print('Hello')", "print('hello')"));
});

test("작은따옴표와 큰따옴표는 같게", () => {
  assert.ok(isCorrect('print("hi")', "print('hi')"));
  assert.ok(isCorrect("'World'", '"World"'));
  assert.ok(isCorrect("print('It\\'s ok')", "print('It\\'s ok')"));
});

test('따옴표 짝이 틀리면 오답', () => {
  assert.ok(!isCorrect("print('It's ok')", 'print("It\'s ok")'));
  assert.ok(!isCorrect("print('hi)", "print('hi')"));
  assert.ok(!isCorrect("print('hi\")", "print('hi')"));
  assert.strictEqual(tokenize("'abc"), null);
});

test('이스케이프 글자는 그대로 비교', () => {
  assert.ok(isCorrect("print('line\\nnext')", "print('line\\nnext')"));
  assert.ok(!isCorrect("print('line\\next')", "print('line\\nnext')"));
});

test('정답 여러 개', () => {
  assert.ok(isCorrect('n+n', ['n * 2', 'n + n', '2 * n']));
  assert.ok(!isCorrect('n+1', ['n * 2', 'n + n']));
});

test('문제 은행의 모든 문제는 자기 자신과 같다 (한 번씩 띄어쓰기를 빼고도)', () => {
  const r = parseBank(fs.readFileSync(path.join(__dirname, '..', 'problems', 'bank.txt'), 'utf8'));
  for (const p of r.normal) {
    assert.ok(tokenize(p.code), '해석 실패: ' + p.code);
    assert.ok(isCorrect(p.code, p.code), p.code);
  }
  for (const b of r.boss) for (const a of b.answers) assert.ok(isBossCorrect(b, a), b.title + ': ' + a);
});

test('보스: 출력 맞히기는 출력 글자 그대로 (따옴표도 글자)', () => {
  const b = { code: "print(\"It's\", 'ok')", answers: ["It's ok"] };
  assert.ok(isBossCorrect(b, "It's ok"));
  assert.ok(isBossCorrect(b, "It'sok"));
  assert.ok(!isBossCorrect(b, 'Its ok'));
  const f = { code: "print('Hello', ___)", answers: ["'World'"] };
  assert.ok(isBossCorrect(f, '"World"'));
  assert.ok(!isBossCorrect(f, 'World'));
});
