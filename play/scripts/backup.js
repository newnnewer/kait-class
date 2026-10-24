'use strict';
// 자료 백업 — data/game.db (문제 은행 · 게임 기록 · 교사 비밀번호 · 설정)와 data/stats.db(이용 통계, 1.2.0)를 날짜 붙여 복사한다.
//   서버 어느 폴더에서나:  docker exec kait-play node scripts/backup.js
//   → /opt/kait-play/data/backup/game-2026-09-29_2130.db  (최근 30개만 남김)
// 게임이 돌아가는 중에도 안전하게 복사된다 (SQLite 'VACUUM INTO').
// 되돌리기: 게임을 끄고(docker compose down) 백업 파일을 data/game.db 로 복사한 뒤 다시 켠다 (INSTALL.md 참고).

const fs = require('fs');
const path = require('path');
const config = require('../server/config');
const db = require('../server/db').open(config.dbFile);

const KEEP = 30;
const dir = path.join(path.dirname(config.dbFile), 'backup');
fs.mkdirSync(dir, { recursive: true });
const d = new Date(Date.now() + 9 * 3600 * 1000); // 한국 시각으로 이름
const stamp = d.toISOString().slice(0, 16).replace('T', '_').replace(':', '');
const file = path.join(dir, `game-${stamp}.db`);
if (fs.existsSync(file)) fs.unlinkSync(file);
db.sql.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
db.close();
// 1.2.0: 이용 통계(data/stats.db)도 같은 이름 규칙으로 (stats-날짜.db)
const sfile = path.join(dir, `stats-${stamp}.db`);
if (fs.existsSync(config.statsFile)) {
  const stats = require('../server/stats').open(config.statsFile);
  if (fs.existsSync(sfile)) fs.unlinkSync(sfile);
  stats.db.exec(`VACUUM INTO '${sfile.replace(/'/g, "''")}'`);
  stats.close();
}

for (const kind of ['game', 'stats']) {
  const old = fs.readdirSync(dir).filter(f => new RegExp(`^${kind}-.*\\.db$`).test(f)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - KEEP))) fs.unlinkSync(path.join(dir, f));
}
const kb = Math.round(fs.statSync(file).size / 1024);
const n = fs.readdirSync(dir).filter(f => /^game-.*\.db$/.test(f)).length;
console.log(`백업했어요: data/backup/${path.basename(file)} (${kb}KB)${fs.existsSync(sfile) ? ' · ' + path.basename(sfile) : ''} · 보관 ${n}개`);
