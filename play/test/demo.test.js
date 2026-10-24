'use strict';
// 체험 서버(DEMO=1): 교사 비밀번호를 바꿀 수 없고, 화면에 체험 표시를 알린다 (v0.10.0)
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { io } = require('socket.io-client');

const PORT = 4100 + Math.floor(Math.random() * 90);
const URL = `http://127.0.0.1:${PORT}`;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-demo-'));
let proc;

function once(sock, ev) { return new Promise(r => sock.once(ev, r)); }
function call(sock, ev, msg) { return new Promise(r => sock.emit(ev, msg, r)); }
function client() { return io(URL, { path: '/play/socket.io', transports: ['websocket'], forceNew: true, reconnection: false }); }

test.before(async () => {
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), BASE_PATH: '/play', DEMO: '1', ADMIN_PASSWORD: 'demo-pw', DB_FILE: path.join(DIR, 'game.db'), STATS_FILE: path.join(DIR, 'stats.db') },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise(r => proc.stdout.on('data', d => { if (String(d).includes('기다리는 중')) r(); }));
});
test.after(() => { proc.kill(); fs.rmSync(DIR, { recursive: true, force: true }); });

test('체험 서버: 상태 · 학생 · 교사 모두 demo 를 알림', async () => {
  const h = await (await fetch(URL + '/play/healthz')).json();
  assert.strictEqual(h.demo, true);
  const s = client(); await once(s, 'connect');
  const hi = await call(s, 'hello', { token: 'demo' + Math.random().toString(36).slice(2) + 'abcdefgh' });
  assert.strictEqual(hi.demo, true);
  const t = client(); await once(t, 'connect');
  const login = await call(t, 'admin:login', { password: 'demo-pw' });
  assert.strictEqual(login.ok, true);
  assert.strictEqual(login.demo, true);
  s.close(); t.close();
});

test('체험 서버: 교사 비밀번호를 바꿀 수 없고, 처음 비밀번호가 계속 된다', async () => {
  const t = client(); await once(t, 'connect');
  await call(t, 'admin:login', { password: 'demo-pw' });
  const r = await call(t, 'admin:password', { old: 'demo-pw', new: 'hacked-123' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /체험 서버/);
  const t2 = client(); await once(t2, 'connect');
  assert.strictEqual((await call(t2, 'admin:login', { password: 'demo-pw' })).ok, true);
  assert.strictEqual((await call(t2, 'admin:login', { password: 'hacked-123' })).ok, false);
  t.close(); t2.close();
});

test('1.2.0 체험 서버: 통계 비밀번호가 없으면 통계가 열리지 않고 · 만들면 바꿀 수 있지만 없앨 수는 없다', async () => {
  const t = client(); await once(t, 'connect');
  await call(t, 'admin:login', { password: 'demo-pw' });
  assert.strictEqual((await call(t, 'stats:get', { days: 7 })).none, true);
  assert.strictEqual((await call(t, 'stats:export', { days: 7 })).none, true);
  assert.strictEqual((await call(t, 'stats:login', { password: '' })).none, true);
  require('child_process').execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'stats-password.js'), 'owner-only'], { env: { ...process.env, STATS_FILE: path.join(DIR, 'stats.db') } });
  assert.strictEqual((await call(t, 'stats:get', { days: 7 })).statsAuth, false);
  const key = (await call(t, 'stats:login', { password: 'owner-only' })).key;
  const g = await call(t, 'stats:get', { key, days: 7 });
  assert.strictEqual(g.ok, true);
  assert.strictEqual(g.canRemove, false);
  const r = await call(t, 'stats:remove', { password: 'owner-only' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /체험 서버/);
  assert.strictEqual((await call(t, 'stats:password', { old: 'owner-only', new: 'owner-two' })).ok, true, '바꾸기는 됨');
  t.close();
});
