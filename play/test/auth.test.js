'use strict';
// 관리자 비밀번호: 처음 비밀번호(.env) → 바꾸면 DB에 암호화 저장, 다른 로그인은 풀림, 5번 틀리면 잠금
const test = require('node:test');
const assert = require('node:assert');
const { Auth } = require('../server/admin/auth');
const { open } = require('../server/db');

test('처음에는 .env 비밀번호, 바꾸면 새 비밀번호만 되고 다른 로그인은 풀린다', () => {
  const db = open(':memory:');
  const a = new Auth('first-pw', db);
  assert.strictEqual(a.source(), 'env');
  const k1 = a.login('first-pw').key;
  assert.ok(a.check(k1));
  assert.strictEqual(a.change('wrong', 'new-pass').ok, false);
  assert.strictEqual(a.change('first-pw', '123').ok, false, '너무 짧음');
  const r = a.change('first-pw', 'new-pass');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(a.source(), 'db');
  assert.strictEqual(a.check(k1), false, '예전 열쇠는 로그아웃');
  assert.ok(a.check(r.key));
  assert.strictEqual(a.login('first-pw').ok, false);
  assert.strictEqual(a.login('new-pass').ok, true);
  // DB에는 비밀번호 그대로가 아니라 암호화한 값
  assert.ok(!JSON.stringify(db.getSetting('adminHash')).includes('new-pass'));
});

test('비밀번호가 하나도 없으면 로그인할 수 없고, 5번 틀리면 잠긴다', () => {
  const none = new Auth('', open(':memory:'));
  assert.strictEqual(none.login('x').ok, false);
  const a = new Auth('pw-pw-pw', open(':memory:'));
  for (let k = 0; k < 5; k++) a.login('no');
  const r = a.login('pw-pw-pw');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /여러 번/);
});
