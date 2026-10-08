'use strict';
// 입력란 흐린 글씨 (v0.12.0) — 친 글자를 코드에 맞춰 보기
const test = require('node:test');
const assert = require('node:assert');
const { align } = require('../public/js/shared/typing');
const { isCorrect } = require('../server/game/grade');

test('따옴표 밖 빈칸: 코드 쪽은 건너뛰고, 내가 더 친 것은 무시', () => {
  assert.deepStrictEqual(align('a = b + c', 'a'), { pos: 2, bad: -1, done: false }, "'a' 다음 커서는 '=' 앞");
  assert.deepStrictEqual(align('a = b + c', 'a='), { pos: 4, bad: -1, done: false }, "'a=' 다음 커서는 'b' 앞");
  assert.deepStrictEqual(align('else:', 'else'), { pos: 4, bad: -1, done: false });
  assert.deepStrictEqual(align('else:', 'else '), { pos: 4, bad: -1, done: false }, "빈칸을 쳐도 'e' 와 ':' 사이");
  assert.deepStrictEqual(align('else:', 'else  :'), { pos: 5, bad: -1, done: true });
  assert.deepStrictEqual(align('a = b + c', 'a = b + c'), { pos: 9, bad: -1, done: true });
  assert.deepStrictEqual(align('a = b + c', 'a=b+c'), { pos: 9, bad: -1, done: true });
});

test('틀린 글자: 그 자리에서 멈춘다', () => {
  assert.deepStrictEqual(align('a = b + c', 'a=c'), { pos: 4, bad: 2, done: false });
  assert.deepStrictEqual(align('print(1)', 'pront'), { pos: 2, bad: 2, done: false });
  assert.deepStrictEqual(align('f()', 'f()x'), { pos: 3, bad: 3, done: true }, '다 친 뒤에 더 치면 틀림');
});

test('문자열 안은 빈칸까지 정확히', () => {
  assert.strictEqual(align("print('a b')", "print('a b')").done, true);
  assert.strictEqual(align("print('a b')", "print('ab").bad, 8);
  assert.strictEqual(align("print('1 + 2')", "print( '1 +").pos, 10);
  assert.strictEqual(align("print('a', end=' ')", "print('a',end=' ')").done, true);
});

test('따옴표: 안에 따옴표가 없으면 바꿔 쳐도 되고, 닫는 것은 연 것과 같아야 함', () => {
  assert.strictEqual(align("print('hi')", 'print("hi")').done, true);
  assert.strictEqual(align("print('hi')", 'print("hi\'').bad, 9);
  assert.strictEqual(align('print("It\'s ok")', "print('").bad, 6, '안에 작은따옴표가 있으면 큰따옴표 그대로');
  assert.strictEqual(align('print("It\'s ok")', 'print("It\'s ok")').done, true);
  assert.strictEqual(align("print('line\\nnext')", "print('line\\nnext')").done, true);
});

test('흐린 글씨를 끝까지 맞게 치면 채점도 정답 (문제 은행 전체)', () => {
  const { parseBank } = require('../server/problems/parser');
  const fs = require('fs'), path = require('path');
  const bank = parseBank(fs.readFileSync(path.join(__dirname, '../problems/bank.txt'), 'utf8'));
  const codes = (bank.problems || bank.normal || []).map(p => p.code || p);
  assert.ok(codes.length > 100, '일반 문제 ' + codes.length);
  for (const code of codes) {
    const squeezed = code.replace(/\s+/g, ' ');
    assert.strictEqual(align(code, code).done, true, code);
    assert.strictEqual(align(code, code).bad, -1, code);
    assert.ok(isCorrect(code, [code]), code);
    // 따옴표 밖 빈칸을 모두 지우고 쳐도 흐린 글씨와 채점이 같은 답
    const tight = code.split(/('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/).map((x, n) => n % 2 ? x : x.replace(/\s+/g, '')).join('');
    assert.strictEqual(align(code, tight).done && align(code, tight).bad < 0, isCorrect(tight, [code]), code + ' / ' + tight + ' / ' + squeezed);
  }
});
