'use strict';
// 이용 통계 (1.2.0) — game.db 와 따로 data/stats.db 한 파일
//   · 체험 서버의 매일 되돌리기(demo-reset.sh)는 game.db 만 되돌리므로 통계는 지워지지 않는다
//   · plays    : 끝난 게임 한 판마다 한 줄 (공식전 · 자유 플레이 모두) — 닉네임 등 개인 정보는 남기지 않음
//   · visits   : 날마다 입장한 브라우저 (열쇠를 그대로 두지 않고 줄인 해시만)
//   · settings : 통계 비밀번호(암호화) — 교사 비밀번호와 따로, 서버 명령 scripts/stats-password.js 로만 정함
// 파일을 열 수 없거나 기록에 실패해도 게임은 멈추지 않는다.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('./db'); // node:sqlite 의 '실험 기능' 경고 숨기기를 먼저
const { DatabaseSync } = require('node:sqlite');

const KST = 9 * 3600 * 1000;           // 날짜는 한국 시각으로 나눈다 (서버 시간대와 상관없이)
const DAY = 24 * 3600 * 1000;
const dayOf = t => new Date(t + KST).toISOString().slice(0, 10);   // '2026-10-24'
const hourOf = t => new Date(t + KST).getUTCHours();

/** 끝난 게임 결과 → 통계 한 줄. 사람이 없는 판(비트만)은 null */
function fromResult(place, s, r) {
  s = s || {}; r = r || {};
  let game = r.game === 'flip' || s.game === 'flip' ? 'flip' : 'rush';
  let mode, people;
  if (Array.isArray(r.teams)) {          // 팀 대전 (블록 러시 N팀 · 플립 배틀) — 공식전 · 자유 플레이 모두
    mode = game === 'flip' ? 'flip' : 'teams';
    people = [].concat(...r.teams.map(t => t.members || []));
  } else {                               // 블록 러시 협동 (자유 플레이)
    mode = 'coop';
    game = 'rush';
    people = r.players || [];
  }
  const humans = people.filter(p => !p.bot).length;
  if (!humans) return null;
  const teams = Array.isArray(r.teams) ? r.teams.length : 0;
  return {
    place: place === 'class' ? 'class' : 'room',
    game, mode, teams,
    humans, bots: people.length - humans,
    limitMin: Number(s.limitMin) || 0,
    bossMode: game === 'flip' ? '' : String(s.bossMode || 'quiz'),
    items: game === 'flip' ? (s.items !== false ? 1 : 0) : (s.bossMode === 'none' ? 0 : 1),
    ms: Math.max(0, Math.round(Number(r.ms) || 0)),
    reason: String(r.reason || (r.success ? 'clear' : '')).slice(0, 12),
  };
}

class Stats {
  constructor(file) {
    let db;
    try {
      if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
      db = new DatabaseSync(file);
    } catch (e) {
      console.error(`[통계] ${file} 을 열 수 없어 메모리에만 저장해요 (재시작하면 사라짐):`, e.message);
      db = new DatabaseSync(':memory:');
    }
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS plays (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ended_at INTEGER NOT NULL, day TEXT NOT NULL, hour INTEGER NOT NULL,
        place TEXT NOT NULL, game TEXT NOT NULL, mode TEXT NOT NULL, teams INTEGER NOT NULL,
        humans INTEGER NOT NULL, bots INTEGER NOT NULL,
        limit_min INTEGER NOT NULL, boss_mode TEXT NOT NULL, items INTEGER NOT NULL,
        ms INTEGER NOT NULL, reason TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS plays_day ON plays(day);
      CREATE TABLE IF NOT EXISTS visits (day TEXT NOT NULL, who TEXT NOT NULL, PRIMARY KEY(day, who));
    `);
    this.q = {
      getSet: db.prepare('SELECT value FROM settings WHERE key = ?'),
      putSet: db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
      addPlay: db.prepare(`INSERT INTO plays(ended_at, day, hour, place, game, mode, teams, humans, bots, limit_min, boss_mode, items, ms, reason)
                           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      visit: db.prepare('INSERT OR IGNORE INTO visits(day, who) VALUES(?, ?)'),
    };
    // 해시에 섞는 값 — 서버마다 한 번 만들어 둔다 (열쇠를 알아도 통계와 맞춰 볼 수 없게)
    this.salt = this.getSetting('salt', null);
    if (!this.salt) { this.salt = crypto.randomBytes(16).toString('hex'); this.setSetting('salt', this.salt); }
  }

  // Auth 가 비밀번호를 저장하는 곳으로 쓴다
  getSetting(key, def) {
    const row = this.q.getSet.get(key);
    if (!row) return def;
    try { return JSON.parse(row.value); } catch (e) { return def; }
  }
  setSetting(key, value) { this.q.putSet.run(key, JSON.stringify(value)); }

  /** 게임 한 판 끝 — place: 'class'(공식전) / 'room'(자유 플레이) */
  record(place, settings, result, now = Date.now()) {
    try {
      const p = fromResult(place, settings, result);
      if (!p) return false;
      this.q.addPlay.run(now, dayOf(now), hourOf(now), p.place, p.game, p.mode, p.teams, p.humans, p.bots,
        p.limitMin, p.bossMode, p.items, p.ms, p.reason);
      return true;
    } catch (e) { console.error('[통계] 기록 실패:', e.message); return false; }
  }

  /** 입장 — 같은 브라우저는 하루에 한 번만 센다 */
  visit(token, now = Date.now()) {
    try {
      const who = crypto.createHash('sha256').update(this.salt + ':' + token).digest('base64url').slice(0, 16);
      this.q.visit.run(dayOf(now), who);
    } catch (e) { console.error('[통계] 입장 기록 실패:', e.message); }
  }

  /** 기간 정하기 — { days: 1(오늘) · 7 · 30 · 0(전체) } 또는 { from, to: 'YYYY-MM-DD' } (직접, 1.2.0) */
  range(opt, now = Date.now()) {
    opt = opt || {};
    const today = dayOf(now);
    const first = this.db.prepare('SELECT MIN(day) AS d FROM (SELECT day FROM plays UNION ALL SELECT day FROM visits)').get().d;
    const okDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(Date.parse(v)).toISOString().slice(0, 10) === v;
    if (okDay(opt.from) && okDay(opt.to)) {
      let from = opt.from, to = opt.to;
      if (from > to) [from, to] = [to, from];
      if (to > today) to = today;
      if (from > to) from = to;
      return { days: -1, from, to, first: first || null };
    }
    const days = [1, 7, 30, 0].includes(Number(opt.days)) ? Number(opt.days) : 7;
    const from = days ? dayOf(now - (days - 1) * DAY) : (first || today);
    return { days, from, to: today, first: first || null };
  }

  /** 내려받기 — 고른 기간의 게임 기록 (한 판에 한 줄, 끝난 순서) */
  rows(opt, now = Date.now()) {
    const R = this.range(opt, now);
    const rows = this.db.prepare('SELECT * FROM plays WHERE day >= ? AND day <= ? ORDER BY ended_at, id').all(R.from, R.to).map(p => ({
      at: p.ended_at, place: p.place, game: p.game, mode: p.mode, teams: p.teams,
      humans: p.humans, bots: p.bots, limitMin: p.limit_min, bossMode: p.boss_mode, items: !!p.items, ms: p.ms, reason: p.reason,
    }));
    return { ok: true, from: R.from, to: R.to, rows };
  }

  /** 통계 화면 — opt 는 range() 와 같음 (예전처럼 숫자 하나만 줘도 됨) */
  summary(opt, now = Date.now()) {
    if (typeof opt !== 'object' || opt == null) opt = { days: opt };
    const R = this.range(opt, now);
    const { days, from, first } = R;
    const today = R.to;
    const W = 'day >= ? AND day <= ?';
    const all = this.db.prepare(`SELECT * FROM plays WHERE ${W} ORDER BY ended_at, id`).all(from, today);

    const sum = { plays: all.length, classPlays: 0, roomPlays: 0, people: 0, minutes: 0, bots: 0 };
    const kinds = {};   // 'rush-coop' · 'rush-teams' · 'flip' → { class, room }
    const reasons = {};
    for (const p of all) {
      if (p.place === 'class') sum.classPlays++; else sum.roomPlays++;
      sum.people += p.humans;
      sum.bots += p.bots;
      sum.minutes += p.ms / 60000;
      const k = p.game === 'flip' ? 'flip' : 'rush-' + p.mode;
      kinds[k] = kinds[k] || { class: 0, room: 0 };
      kinds[k][p.place]++;
      reasons[p.reason] = (reasons[p.reason] || 0) + 1;
    }
    sum.minutes = Math.round(sum.minutes);
    sum.avgPeople = all.length ? Math.round(sum.people / all.length * 10) / 10 : 0;
    sum.visitors = this.db.prepare(`SELECT COUNT(DISTINCT who) AS n FROM visits WHERE ${W}`).get(from, today).n;

    // 그래프: 하루 = 시간별 · 60일까지 = 날짜별 · 그보다 길면 달별 (직접 고른 기간도 같음)
    const spanDays = Math.round((Date.parse(today) - Date.parse(from)) / DAY) + 1;
    const unit = spanDays === 1 ? 'hour' : spanDays > 60 ? 'month' : 'day';
    const buckets = [];
    const idx = new Map();
    const add = (key, label) => { idx.set(key, buckets.length); buckets.push({ key, label, class: 0, room: 0, visitors: 0 }); };
    if (unit === 'hour') {
      for (let h = 0; h < 24; h++) add(String(h), h + '시');
    } else if (unit === 'day') {
      for (let i = 0; i < spanDays; i++) {
        const d = dayOf(Date.parse(from) + i * DAY);
        add(d, Number(d.slice(5, 7)) + '/' + Number(d.slice(8, 10)));
      }
    } else {
      let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
      const ey = Number(today.slice(0, 4)), em = Number(today.slice(5, 7));
      while (y < ey || (y === ey && m <= em)) {
        add(y + '-' + String(m).padStart(2, '0'), (m === 1 || !buckets.length ? y + '년 ' : '') + m + '월');
        m++; if (m > 12) { m = 1; y++; }
      }
    }
    const keyOf = p => (unit === 'hour' ? String(p.hour) : unit === 'day' ? p.day : p.day.slice(0, 7));
    for (const p of all) { const i = idx.get(keyOf(p)); if (i != null) buckets[i][p.place]++; }
    const vrows = unit === 'hour'
      ? [] // 입장은 날짜 단위로만 센다
      : this.db.prepare(`SELECT ${unit === 'day' ? 'day' : 'substr(day, 1, 7)'} AS k, COUNT(DISTINCT who) AS n FROM visits WHERE ${W} GROUP BY k`).all(from, today);
    for (const v of vrows) { const i = idx.get(v.k); if (i != null) buckets[i].visitors = v.n; }

    const recent = all.slice(-20).reverse().map(p => ({
      at: p.ended_at, place: p.place, game: p.game, mode: p.mode, teams: p.teams,
      humans: p.humans, bots: p.bots, limitMin: p.limit_min, bossMode: p.boss_mode, items: !!p.items, ms: p.ms, reason: p.reason,
    }));
    return { ok: true, days, from, to: today, first, unit, sum, kinds, reasons, chart: buckets, recent };
  }

  close() { try { this.db.close(); } catch (e) { /* 이미 닫힘 */ } }
}

function open(file) { return new Stats(file); }

module.exports = { open, Stats, fromResult, dayOf };
