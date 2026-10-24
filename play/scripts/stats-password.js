'use strict';
// 통계 비밀번호 만들기 · 잊었을 때 (1.2.0) — 교사 화면 '통계' 탭을 열 때 한 번 더 넣는, 교사 비밀번호와 다른 비밀번호
//   보통의 설치에는 필요 없어요 (없으면 교사 로그인만으로 통계가 열림).
//   교사 비밀번호를 여러 선생님이 함께 쓰는 서버(체험 서버 등)에서 운영자만 통계를 보려면 만드세요.
//   체험 서버(DEMO=1)는 이 비밀번호가 없으면 통계가 열리지 않아요.
//   서버 어느 폴더에서나:  sudo docker exec kait-play node scripts/stats-password.js
//   직접 정하기:           sudo docker exec kait-play node scripts/stats-password.js 새비밀번호
// 처음 만들기는 교사 화면에서 할 수 없어요 (교사 비밀번호를 아는 다른 선생님이 먼저 정하지 못하게).
// 만든 뒤 바꾸기 · 없애기(체험 서버 말고)는 통계 탭에서 지금 비밀번호를 넣고 할 수 있어요.
// 비밀번호는 data/stats.db 에 암호화해서 저장돼요 — 체험 서버의 매일 되돌리기에도 그대로 남아요.
// 서버를 다시 켤 필요 없음. 실행하면 지금 비밀번호가 바뀌어요 (이미 통계를 열어 둔 화면은 12시간 동안 그대로).

const crypto = require('crypto');
const config = require('../server/config');
const { hashPassword, STATS_HASH_KEY, MIN_LEN } = require('../server/admin/auth');
const stats = require('../server/stats').open(config.statsFile);

let pw = process.argv[2];
if (pw == null) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  pw = Array.from(crypto.randomBytes(10), b => abc[b % abc.length]).join('');
}
if (pw.length < MIN_LEN || /\s/.test(pw)) {
  console.error(`비밀번호는 ${MIN_LEN}자 이상, 띄어쓰기 없이 정해 주세요`);
  process.exit(1);
}
stats.setSetting(STATS_HASH_KEY, hashPassword(pw));
stats.close();
console.log('');
console.log(`  \x1b[1;33m통계 비밀번호:  ${pw}\x1b[0m`);
console.log('  (교사 화면 › 통계 탭에서 넣으세요. 바꾸기는 통계 탭에서, 잊었을 때는 이 명령을 다시 실행하세요)');
console.log('');
