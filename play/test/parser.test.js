'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseBank } = require('../server/problems/parser');

test('문제 은행 파일을 오류 없이 읽는다', () => {
  const r = parseBank(fs.readFileSync(path.join(__dirname, '..', 'problems', 'bank.txt'), 'utf8'));
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.normal.length, 483);
  assert.strictEqual(r.boss.length, 160);
});

test('같은 문제는 태그만 합친다, 한글 코드는 거부', () => {
  const r = parseBank('# 출력\nprint(1)\n# 연산자\nprint( 1 )\nprint("안녕")\n');
  assert.strictEqual(r.normal.length, 1);
  assert.deepStrictEqual(r.normal[0].tags, ['출력', '연산자']);
  assert.strictEqual(r.errors.length, 1);
});
