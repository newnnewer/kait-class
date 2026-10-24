'use strict';
// 1.2.0 이용 통계 (data/stats.db)
const test = require('node:test');
const assert = require('node:assert');
const { open, fromResult, dayOf } = require('../server/stats');
const { Auth, STATS_HASH_KEY, hashPassword } = require('../server/admin/auth');

const H = (bot) => ({ nick: 'x', bot: !!bot });
const T0 = Date.parse('2026-10-24T01:00:00Z'); // 한국 10시

test('결과 → 통계 한 줄: 협동 · N팀 · 플립 · 비트만', () => {
  const coop = fromResult('room', { mode: 'coop', limitMin: 3, bossMode: 'typing' }, { reason: 'clear', ms: 61000, players: [H(), H(), H(1)] });
  assert.deepStrictEqual([coop.place, coop.game, coop.mode, coop.humans, coop.bots, coop.bossMode, coop.items], ['room', 'rush', 'coop', 2, 1, 'typing', 1]);
  const teams = fromResult('class', { limitMin: 5, bossMode: 'none' }, { reason: 'time', ms: 300000, teams: [{ members: [H(), H()] }, { members: [H(), H(1)] }, { members: [H()] }] });
  assert.deepStrictEqual([teams.place, teams.mode, teams.teams, teams.humans, teams.bots, teams.items], ['class', 'teams', 3, 4, 1, 0]);
  const flip = fromResult('room', { game: 'flip', items: false }, { game: 'flip', reason: 'time', teams: [{ members: [H()] }, { members: [H()] }] });
  assert.deepStrictEqual([flip.game, flip.mode, flip.items, flip.bossMode], ['flip', 'flip', 0, '']);
  assert.strictEqual(fromResult('class', {}, { teams: [{ members: [H(1)] }, { members: [H(1)] }] }), null);
});

test('날짜는 한국 시각으로', () => {
  assert.strictEqual(dayOf(Date.parse('2026-10-24T15:30:00Z')), '2026-10-25');
  assert.strictEqual(dayOf(Date.parse('2026-10-24T14:59:00Z')), '2026-10-24');
});

test('기록 · 입장 · 요약', () => {
  const s = open(':memory:');
  s.record('room', { mode: 'coop', limitMin: 3 }, { reason: 'clear', ms: 120000, players: [H(), H()] }, T0);
  s.record('class', { limitMin: 3 }, { reason: 'time', ms: 180000, teams: [{ members: [H(), H()] }, { members: [H(), H()] }] }, T0 + 3600e3);
  s.record('room', { game: 'flip' }, { game: 'flip', reason: 'time', ms: 60000, teams: [{ members: [H()] }, { members: [H()] }] }, T0 - 3 * 86400e3);
  s.record('class', {}, { teams: [{ members: [H(1)] }] }, T0); // 비트만 → 안 남김
  s.visit('aaaaaaaaaaaaaaaaaaaa', T0); s.visit('aaaaaaaaaaaaaaaaaaaa', T0 + 1000); s.visit('bbbbbbbbbbbbbbbbbbbb', T0);
  s.visit('aaaaaaaaaaaaaaaaaaaa', T0 - 3 * 86400e3);

  const d1 = s.summary(1, T0 + 2 * 3600e3);
  assert.strictEqual(d1.unit, 'hour');
  assert.strictEqual(d1.chart.length, 24);
  assert.deepStrictEqual([d1.sum.plays, d1.sum.classPlays, d1.sum.roomPlays, d1.sum.people, d1.sum.visitors], [2, 1, 1, 6, 2]);
  assert.strictEqual(d1.chart[10].room, 1);
  assert.strictEqual(d1.chart[11].class, 1);

  const d7 = s.summary(7, T0 + 2 * 3600e3);
  assert.strictEqual(d7.chart.length, 7);
  assert.strictEqual(d7.sum.plays, 3);
  assert.strictEqual(d7.sum.visitors, 2); // 같은 브라우저는 기간 안에서 한 번
  assert.strictEqual(d7.chart[6].visitors, 2);
  assert.strictEqual(d7.chart[3].visitors, 1);
  assert.deepStrictEqual(d7.kinds, { 'rush-coop': { class: 0, room: 1 }, 'rush-teams': { class: 1, room: 0 }, flip: { class: 0, room: 1 } });
  assert.strictEqual(d7.recent[0].place, 'class');
  assert.strictEqual(d7.recent.length, 3);
  assert.strictEqual(JSON.stringify(d7).includes('aaaa'), false); // 열쇠는 남지 않음

  const all = s.summary(0, T0 + 2 * 3600e3);
  assert.strictEqual(all.unit, 'day');
  assert.strictEqual(all.from, '2026-10-21');
  s.close();
});

test('전체 기간이 60일을 넘으면 달별', () => {
  const s = open(':memory:');
  s.record('room', { mode: 'coop' }, { reason: 'clear', players: [H()] }, T0 - 100 * 86400e3);
  const all = s.summary(0, T0);
  assert.strictEqual(all.unit, 'month');
  assert.strictEqual(all.chart[0].label, '2026년 7월');
  assert.strictEqual(all.chart.length, 4);
  s.close();
});

test('통계 비밀번호는 stats.db 에 따로 (교사 비밀번호와 다름)', () => {
  const s = open(':memory:');
  const a = new Auth('', s, STATS_HASH_KEY);
  assert.strictEqual(a.enabled(), false);
  s.setSetting(STATS_HASH_KEY, hashPassword('stats-pw-1'));
  assert.strictEqual(a.enabled(), true);
  assert.strictEqual(a.login('teacher').ok, false);
  const r = a.login('stats-pw-1');
  assert.ok(r.ok && a.check(r.key));
  s.close();
});

test('1.2.0 기간 직접 고르기 · 내려받기 줄', () => {
  const s = open(':memory:');
  s.record('room', { mode: 'coop' }, { reason: 'clear', ms: 1000, players: [H()] }, T0 - 10 * 86400e3);
  s.record('class', {}, { reason: 'time', ms: 2000, teams: [{ members: [H()] }, { members: [H()] }] }, T0 - 2 * 86400e3);
  s.record('room', { game: 'flip' }, { game: 'flip', reason: 'time', ms: 3000, teams: [{ members: [H()] }, { members: [H()] }] }, T0);
  const now = T0 + 3600e3;
  const r = s.summary({ from: '2026-10-14', to: '2026-10-22' }, now);
  assert.deepStrictEqual([r.days, r.from, r.to, r.unit, r.chart.length, r.sum.plays], [-1, '2026-10-14', '2026-10-22', 'day', 9, 2]);
  assert.deepStrictEqual([s.summary({ from: '2026-10-22', to: '2026-10-14' }, now).from], ['2026-10-14'], '거꾸로 넣어도 됨');
  assert.strictEqual(s.summary({ from: '2026-10-20', to: '2030-01-01' }, now).to, '2026-10-24', '오늘 뒤는 오늘까지');
  const one = s.summary({ from: '2026-10-22', to: '2026-10-22' }, now);
  assert.strictEqual(one.unit, 'hour');
  const long = s.summary({ from: '2026-01-01', to: '2026-10-24' }, now);
  assert.strictEqual(long.unit, 'month');
  assert.strictEqual(long.chart.length, 10);
  assert.strictEqual(s.summary({ from: '2026-13-40', to: 'x' }, now).days, 7, '잘못된 날짜는 7일');
  const ex = s.rows({ from: '2026-10-14', to: '2026-10-24' }, now);
  assert.deepStrictEqual(ex.rows.map(x => x.place + x.game), ['roomrush', 'classrush', 'roomflip']);
  assert.strictEqual(ex.rows[2].ms, 3000);
  assert.strictEqual(s.rows({ days: 1 }, now).rows.length, 1);
  s.close();
});
