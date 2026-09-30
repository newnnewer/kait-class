'use strict';
// 문제 은행 저장소 (6단계): 처음 가져오기 · 고치기 · 지우기 · 붙여넣기(미리보기/추가) · 내려받기
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { open } = require('../server/db');
const { ProblemStore } = require('../server/problems/store');

const BANK = fs.readFileSync(path.join(__dirname, '..', 'problems', 'bank.txt'), 'utf8');
const fresh = () => new ProblemStore(open(':memory:'), BANK);

test('처음 켤 때 bank.txt 를 가져오고, 다시 열면 가져오지 않는다 (DB만 씀)', () => {
  const db = open(':memory:');
  const s = new ProblemStore(db, BANK);
  assert.strictEqual(s.imported, 643);
  assert.strictEqual(s.bank().normal.length, 483);
  assert.strictEqual(s.bank().boss.length, 160);
  s.remove(s.bank().normal[0].id);
  const again = new ProblemStore(db, BANK);
  assert.strictEqual(again.imported, 0);
  assert.strictEqual(again.bank().normal.length, 482, '지운 문제가 되살아나지 않음');
});

test('한 문제 고치기: 한글 · 빈 태그 · 여러 줄 · 같은 코드 중복 · 빈칸 2개는 거절', () => {
  const s = fresh();
  const [a, b] = s.bank().normal;
  assert.match(s.update(a.id, { code: 'print("안녕")', tags: ['출력'] }).error, /한글/);
  assert.match(s.update(a.id, { code: 'x = 1', tags: [] }).error, /태그/);
  assert.match(s.update(a.id, { code: 'a\nb', tags: ['출력'] }).error, /한 줄/);
  assert.match(s.update(a.id, { code: b.code.replace(/ /g, ''), tags: ['출력'] }).error, /이미 있어요/);
  const ok = s.update(a.id, { code: 'print( 12345 )', tags: ['출력', '연산자', '없는태그'] });
  assert.strictEqual(ok.ok, true);
  assert.deepStrictEqual(ok.problem.tags, ['출력', '연산자']);
  const boss = s.bank().boss[0];
  assert.match(s.update(boss.id, { title: 't', code: 'print(___, ___)', answers: '1', tags: ['출력'] }).error, /빈칸/);
  assert.match(s.update(boss.id, { title: 't', code: 'print(1)', answers: '', tags: ['출력'] }).error, /정답/);
  const bo = s.update(boss.id, { title: '새 보스', code: 'x = 3\nprint(x * ___)', answers: '2 | 2.0', input: '', tags: ['연산자'] });
  assert.strictEqual(bo.ok, true);
  assert.deepStrictEqual(bo.problem.answers, ['2', '2.0']);
  assert.strictEqual(bo.problem.input, null);
  assert.strictEqual(s.bank().boss.find(x => x.id === boss.id).title, '새 보스', '게임이 쓰는 문제 은행에도 바로 반영');
});

test('붙여넣기: 미리보기는 저장하지 않고, 추가는 새 문제 · 태그 합치기 · 오류를 알려 준다', () => {
  const s = fresh();
  const text = [
    '[일반 문제]', '# 출력', "print('hello')", 'print("new one")', '# 반복문', "print( 'hello' )", 'print("나")',
    '[보스 문제]', '=== 새 보스 # 함수', 'def f(x):', '    return x * ___', 'print(f(3))', '정답: 2',
  ].join('\n');
  const pre = s.addText(text, false);
  assert.deepStrictEqual([pre.added, pre.merged, pre.errors.length], [2, 1, 1]);
  assert.strictEqual(s.bank().normal.length, 483, '미리보기는 저장 안 함');
  const r = s.addText(text, true);
  assert.deepStrictEqual([r.added, r.merged], [2, 1]);
  assert.strictEqual(s.bank().normal.length, 484);
  assert.strictEqual(s.bank().boss.length, 161);
  assert.deepStrictEqual(s.bank().normal.find(x => x.code === "print('hello')").tags, ['출력', '반복문']);
  assert.strictEqual(s.bank().boss.find(x => x.title === '새 보스').code, 'def f(x):\n    return x * ___\nprint(f(3))', '들여쓰기 유지');
  assert.strictEqual(s.addText(text, true).same, 3, '같은 것을 또 넣으면 바뀌는 것 없음');
});

test('내려받은 파일을 다시 가져오면 같은 문제 은행이 된다', () => {
  const s = fresh();
  const t = s.exportText();
  const s2 = new ProblemStore(open(':memory:'), t);
  const norm = b => ({ n: b.normal.map(x => x.code + '|' + x.tags).sort(), b: b.boss.map(x => [x.title, x.code, x.input, x.answers.join('|'), x.tags.join()].join('#')).sort() });
  assert.deepStrictEqual(norm(s2.bank()), norm(s.bank()));
});
