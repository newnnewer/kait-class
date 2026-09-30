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
    env: { ...process.env, PORT: String(PORT), BASE_PATH: '/play', DEMO: '1', ADMIN_PASSWORD: 'demo-pw', DB_FILE: path.join(DIR, 'game.db') },
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
