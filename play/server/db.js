'use strict';
// 저장소 — Node.js 내장 SQLite(node:sqlite) 한 파일 (data/game.db)
//   · settings : 서버 설정 몇 가지 (자유 플레이 허용 등)
//   · games    : 공식전 기록 (날짜 · 공식전 코드 · 설정 · 팀별 순위)
//   · problems : 문제 은행 (6단계 — problems/store.js 가 만든다)
// 파일을 열 수 없으면(권한 등) 메모리에만 두고 계속 돌아간다 — 게임은 멈추지 않게.

const fs = require('fs');
const path = require('path');

// '실험 기능' 경고 한 줄은 숨긴다 (Node 22 에서 node:sqlite 를 처음 쓸 때 나옴)
const rawEmit = process.emitWarning;
process.emitWarning = function (w, ...rest) {
  const text = typeof w === 'string' ? w : (w && w.message) || '';
  if (/SQLite is an experimental feature/.test(text)) return;
  return rawEmit.call(process, w, ...rest);
};
const { DatabaseSync } = require('node:sqlite');

function open(file) {
  let db;
  try {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new DatabaseSync(file);
  } catch (e) {
    console.error(`[저장소] ${file} 을 열 수 없어 메모리에만 저장해요 (재시작하면 사라짐):`, e.message);
    db = new DatabaseSync(':memory:');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      reason TEXT NOT NULL,
      settings TEXT NOT NULL,
      result TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS games_ended ON games(ended_at);
  `);

  const getSet = db.prepare('SELECT value FROM settings WHERE key = ?');
  const putSet = db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const addGame = db.prepare('INSERT INTO games(code, started_at, ended_at, reason, settings, result) VALUES(?, ?, ?, ?, ?, ?)');
  const recent = db.prepare('SELECT * FROM games ORDER BY id DESC LIMIT ?');

  return {
    sql: db, // 다른 모듈이 자기 표를 만들 때 (문제 은행)
    getSetting(key, def) {
      const row = getSet.get(key);
      if (!row) return def;
      try { return JSON.parse(row.value); } catch (e) { return def; }
    },
    setSetting(key, value) { putSet.run(key, JSON.stringify(value)); },
    saveGame({ code, startedAt, endedAt, reason, settings, result }) {
      const r = addGame.run(String(code), startedAt, endedAt, reason, JSON.stringify(settings), JSON.stringify(result));
      return Number(r.lastInsertRowid);
    },
    recentGames(n) {
      return recent.all(Math.max(1, Math.min(100, n || 30))).map(g => ({
        id: g.id, code: g.code, startedAt: g.started_at, endedAt: g.ended_at, reason: g.reason,
        settings: JSON.parse(g.settings), result: JSON.parse(g.result),
      }));
    },
    close() { try { db.close(); } catch (e) { /* 이미 닫힘 */ } },
  };
}

module.exports = { open };
