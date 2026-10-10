'use strict';
// 학생 방 v0.13.0 — 대전방(팀) · 준비 · 자동 시작 · 방장 관리 · 기권 (서버 없이 직접)
const test = require('node:test');
const assert = require('node:assert');
const { Room } = require('../server/rooms/room');
const { clean } = require('../server/rooms/settings');

function fakeWorld() {
  const log = [];
  const io = { to: ch => ({ emit: (ev, data) => log.push({ ch, ev, data }) }), sockets: { sockets: new Map() } };
  const lobby = {
    io, idleMs: 60000, idleWarnMs: 15000, countdownMs: 0, autoStartMs: 1000, hostOffMs: 1000, waitCloseMs: 600000,
    problemsFor: () => ({ codes: ['print(1)', 'a = 1', 'x += 1', 'if a > b:'], bosses: [] }),
    changed() {}, enter() {}, remove() {},
    socketOf: p => p.sock || null,
  };
  let n = 0;
  const person = () => {
    n += 1;
    const sock = { joined: new Set(), got: [], join(c) { this.joined.add(c); }, leave(c) { this.joined.delete(c); }, emit(ev, d) { this.got.push({ ev, d }); } };
    return { id: 'p' + n, token: 't' + n, nick: '사람' + n, kind: 'cat', color: '#FFD23F', online: true, sock };
  };
  const last = (ev, ch) => [...log].reverse().find(x => x.ev === ev && (!ch || x.ch === ch));
  return { io, lobby, log, person, last };
}
function battleRoom(w, extra) {
  const host = w.person();
  const room = new Room({ lobby: w.lobby, id: 'r1', host, settings: clean({ tags: ['출력'], mode: 'battle', teams: 2, teamSize: 2, blocks: 24, ...(extra || {}) }) });
  room.join(host, host.sock);
  return { room, host };
}
function cleanup(room) { if (room.round) room.round.kill(); room.closed = true; }

test('대전방 설정: 2~4팀 × 1~8명, 최대 인원 = 팀 수 × 팀 인원, 방해 아이템은 늘 켬', () => {
  const s = clean({ tags: ['출력'], mode: 'battle', teams: 9, teamSize: 0 });
  assert.deepStrictEqual([s.mode, s.teams, s.teamSize, s.max, s.attacks], ['battle', 4, 1, 4, true]);
  assert.strictEqual(clean({ tags: ['출력'] }).mode, 'coop');
});

test('들어오면 사람 적은 팀에 앉고, 꽉 찬 팀으로는 못 옮기며, 방이 꽉 차면 못 들어온다', () => {
  const w = fakeWorld();
  const { room, host } = battleRoom(w);
  const b = w.person(), c = w.person(), d = w.person(), e = w.person();
  for (const p of [b, c, d]) assert.strictEqual(room.join(p, p.sock).ok, true);
  assert.deepStrictEqual([host, b, c, d].map(p => room.teamOf.get(p.id)), [1, 2, 1, 2]);
  assert.strictEqual(room.pickTeam(b, 1).ok, false, '1팀은 꽉 참');
  assert.strictEqual(room.join(e, e.sock).ok, false, '4명이 꽉 참');
  const sum = room.summary();
  assert.deepStrictEqual([sum.mode, sum.teams, sum.teamCounts], ['battle', 2, [2, 2]]);
  cleanup(room);
});

test('시작 조건: 상대 팀이 있어야 하고, 모두 준비해야 한다 (인원이 다르면 경고만)', () => {
  const w = fakeWorld();
  const { room, host } = battleRoom(w, { teamSize: 3 });
  assert.strictEqual(room.startCheck().why, 'rival');
  const b = w.person(), c = w.person();
  room.join(b, b.sock); room.join(c, c.sock); // b → 2팀, c → 1팀
  assert.deepStrictEqual(room.startCheck(), { ok: false, why: 'ready', notReady: 2, warn: 'uneven' });
  assert.strictEqual(room.start(b).ok, false, '방장만');
  assert.strictEqual(room.start(host).ok, false, '준비 안 함');
  assert.strictEqual(room.toggleReady(host).ok, false, '방장은 준비가 없다');
  room.toggleReady(b); room.toggleReady(c);
  assert.strictEqual(room.startCheck().ok, true);
  // 모두 같은 팀이면 시작 못 함
  assert.strictEqual(room.setTeam(b, 1).ok, true);
  assert.strictEqual(room.startCheck().why, 'rival');
  assert.strictEqual(room.ready.has(b.id), true, '팀을 옮겨도 준비는 그대로');
  cleanup(room);
});

test('모두 준비하면 자동 시작 시계가 돌고, 누가 들어오거나 준비를 풀면 멈춘다', () => {
  const w = fakeWorld();
  const { room } = battleRoom(w);
  const b = w.person(), c = w.person();
  room.join(b, b.sock);
  room.toggleReady(b);
  assert.ok(room.autoAt > 0);
  room.join(c, c.sock);
  assert.strictEqual(room.autoAt, 0, '새로 들어온 사람은 준비 안 함');
  room.toggleReady(c);
  const at = room.autoAt;
  assert.ok(at > 0);
  room.toggleReady(c);
  assert.strictEqual(room.autoAt, 0);
  room.toggleReady(c);
  room.tick(room.autoAt + 1);
  assert.strictEqual(room.phase, 'playing');
  cleanup(room);
});

test('방장 혼자(봇만)일 때는 자동 시작하지 않는다', () => {
  const w = fakeWorld();
  const { room, host } = battleRoom(w);
  assert.strictEqual(room.addBot(host, 2).ok, true);
  assert.strictEqual(room.startCheck().ok, true);
  assert.strictEqual(room.autoAt, 0);
  cleanup(room);
});

test('시작하면 팀마다 같은 판 · 팀 채널 · 방해 아이템 켬 · 결과는 팀 순위', () => {
  const w = fakeWorld();
  const { room, host } = battleRoom(w);
  const b = w.person();
  room.join(b, b.sock);
  room.toggleReady(b);
  assert.strictEqual(room.start(host).ok, true);
  const m1 = room.matchOf(host), m2 = room.matchOf(b);
  assert.ok(m1 && m2 && m1 !== m2);
  assert.deepStrictEqual(m1.board.cells.map(c => c.code), m2.board.cells.map(c => c.code));
  assert.deepStrictEqual([m1.info.mode, m1.info.name, m2.info.name], ['battle', '1팀', '2팀']);
  assert.ok(host.sock.joined.has('room:r1:t1') && b.sock.joined.has('room:r1:t2'));
  assert.strictEqual(m1.attacks, true);
  assert.strictEqual(room.summary().phase, 'playing');
  // 1팀이 판을 완성 → 2팀은 시간 끝
  m1.board.cells.forEach(c => { c.solved = true; });
  m1.checkClear();
  room.round.stop();
  return new Promise(r => setImmediate(r)).then(() => {
    const res = w.last('class:result', 'room:r1');
    assert.ok(res, '결과는 방 채널로');
    assert.deepStrictEqual(res.data.teams.map(t => [t.no, t.rank, t.clear]), [[1, 1, true], [2, 2, false]]);
    assert.strictEqual(res.data.mode, 'battle');
    assert.strictEqual(room.phase, 'waiting');
    assert.strictEqual(room.ready.size, 0, '판이 끝나면 준비는 모두 풀림');
    assert.strictEqual(room.teamOf.get(b.id), 2, '팀 편성은 그대로');
    cleanup(room);
  });
});

test('팀원(사람)이 모두 나간 팀은 기권 → 해결률이 높아도 맨 아래', async () => {
  const w = fakeWorld();
  const { room, host } = battleRoom(w, { teams: 3 });
  const b = w.person(), c = w.person();
  room.join(b, b.sock); room.join(c, c.sock); // host 1팀, b 2팀, c 3팀
  room.addBot(host, 2);                     // 2팀에 봇
  room.toggleReady(b); room.toggleReady(c);
  assert.strictEqual(room.start(host).ok, true);
  const m2 = room.matchOf(b);
  m2.board.cells.slice(0, 10).forEach(c2 => { c2.solved = true; }); // 2팀이 가장 앞서 있음
  room.leave(b, b.sock);
  assert.strictEqual(m2.ended, true, '사람이 없으면 봇이 남아도 기권');
  assert.strictEqual(room.round.results.get(2).out, true);
  assert.ok(room.round.standings().find(x => x.no === 2).out);
  room.round.stop();
  await new Promise(r => setImmediate(r));
  const res = w.last('class:result');
  assert.deepStrictEqual(res.data.teams.map(t => t.no), [1, 3, 2]);
  assert.strictEqual(res.data.teams[2].reason, 'forfeit');
  cleanup(room);
});

test('방장: 학생 옮기기 · 내보내기(다시 못 들어옴) · 봇으로 채우기', () => {
  const w = fakeWorld();
  const { room, host } = battleRoom(w, { teamSize: 3 });
  const b = w.person(), c = w.person();
  room.join(b, b.sock); room.join(c, c.sock); // b 2팀, c 1팀
  assert.strictEqual(room.moveTo(b, c.id, 2).ok, false, '방장만');
  assert.strictEqual(room.moveTo(host, c.id, 2).ok, true);
  assert.strictEqual(room.teamOf.get(c.id), 2);
  assert.strictEqual(room.kick(host, host.id).ok, false);
  assert.strictEqual(room.kick(host, c.id).ok, true);
  assert.ok(c.sock.got.some(x => x.ev === 'closed' && x.d.reason === 'room-kicked'));
  assert.strictEqual(room.join(c, c.sock).ok, false);
  // 1팀 1명(방장) · 2팀 1명(b) → 이미 맞음
  assert.strictEqual(room.fillBots(host).ok, false);
  room.setTeam(b, 1); // 1팀 2명 · 2팀 0명 → 2팀에 봇 2
  const f = room.fillBots(host);
  assert.deepStrictEqual([f.ok, f.added, room.teamMembers(2).length], [true, 2, 2]);
  cleanup(room);
});

test('방장 연결이 오래 끊기면 다음 사람(연결된 사람)이 방장', () => {
  const w = fakeWorld();
  const { room, host } = battleRoom(w);
  const b = w.person();
  room.join(b, b.sock);
  room.toggleReady(b);
  host.online = false;
  const t = Date.now();
  room.tick(t);
  assert.strictEqual(room.hostId, host.id, '바로 넘기지는 않음');
  room.tick(t + 1001);
  assert.strictEqual(room.hostId, b.id);
  assert.strictEqual(room.ready.has(b.id), false, '방장이 되면 준비 표시는 없어진다');
  cleanup(room);
});

test('협동방에도 준비: 다른 사람이 준비해야 시작 · 모두 준비하면 자동 시작', () => {
  const w = fakeWorld();
  const host = w.person();
  const room = new Room({ lobby: w.lobby, id: 'c1', host, settings: clean({ tags: ['출력'], max: 4, blocks: 24 }) });
  room.join(host, host.sock);
  assert.strictEqual(room.autoAt, 0, '혼자서는 자동 시작 안 함');
  const b = w.person();
  room.join(b, b.sock);
  assert.strictEqual(room.start(host).ok, false);
  room.toggleReady(b);
  assert.ok(room.autoAt > 0);
  assert.strictEqual(room.start(host).ok, true);
  assert.ok(room.match && room.match.has(b));
  assert.strictEqual(room.pickTeam(b, 1).ok, false, '협동방에는 팀이 없다');
  room.match.stop(); room.closed = true;
});
