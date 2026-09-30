'use strict';
// 자료 백업 — data/game.db (문제 은행 · 게임 기록 · 교사 비밀번호 · 설정)를 날짜 붙여 복사한다.
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

const old = fs.readdirSync(dir).filter(f => /^game-.*\.db$/.test(f)).sort();
for (const f of old.slice(0, Math.max(0, old.length - KEEP))) fs.unlinkSync(path.join(dir, f));
const kb = Math.round(fs.statSync(file).size / 1024);
console.log(`백업했어요: data/backup/${path.basename(file)} (${kb}KB) · 보관 ${Math.min(old.length, KEEP)}개`);
