'use strict';
// 교사 화면 비밀번호를 잊었을 때 — 새 비밀번호를 만들어 보여 준다 (서버를 다시 켤 필요 없음)
//   서버 어느 폴더에서나:  docker exec kait-play node scripts/admin-password.js
//   직접 정하기:           docker exec kait-play node scripts/admin-password.js 새비밀번호
//   (docker exec 는 어느 폴더에서나 됨)
// 실행하면 지금 비밀번호가 바뀌어요 — 잊었을 때만 쓰세요.
// 새 비밀번호는 DB(data/game.db)에 암호화해서 저장돼요. .env 의 처음 비밀번호는 더 이상 쓰이지 않아요.

const crypto = require('crypto');
const config = require('../server/config');
const { hashPassword, HASH_KEY, MIN_LEN } = require('../server/admin/auth');
const db = require('../server/db').open(config.dbFile);

let pw = process.argv[2];
if (pw == null) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  pw = Array.from(crypto.randomBytes(10), b => abc[b % abc.length]).join('');
}
if (pw.length < MIN_LEN || /\s/.test(pw)) {
  console.error(`비밀번호는 ${MIN_LEN}자 이상, 띄어쓰기 없이 정해 주세요`);
  process.exit(1);
}
db.setSetting(HASH_KEY, hashPassword(pw));
db.close();
console.log('');
console.log(`  \x1b[1;33m교사 화면 새 비밀번호:  ${pw}\x1b[0m`);
console.log('  (교사 화면에서 로그인한 뒤 원하는 비밀번호로 바꿀 수 있어요)');
console.log('');
