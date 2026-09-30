'use strict';
// 관리자(교사) 로그인 — 아이디 없이 비밀번호 하나
//   · 처음 비밀번호: 서버 .env 의 ADMIN_PASSWORD
//   · 교사 화면에서 바꾸면 암호화(scrypt)해서 DB(data/game.db)에 저장 → 그 뒤로는 DB 비밀번호만 씀
//   · 잊었을 때: 서버 어느 폴더에서나 docker exec kait-play node scripts/admin-password.js (새 비밀번호를 만들어 보여 줌)
//   · 맞으면 무작위 '관리자 열쇠'를 준다 (브라우저가 저장해 새로고침해도 로그인 유지, 12시간)
//   · 5번 틀리면 1분 동안 로그인을 막는다 (비밀번호 찍어 보기 방지)
//   · 비밀번호를 바꾸거나 서버를 다시 시작하면 모두 로그아웃

const crypto = require('crypto');

const KEY_MS = 12 * 3600 * 1000;
const MAX_FAIL = 5;
const LOCK_MS = 60000;
const MIN_LEN = 6;
const HASH_KEY = 'adminHash';

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 32).toString('hex');
  return { salt, hash };
}

function sameText(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

class Auth {
  /** envPassword: .env 의 처음 비밀번호, db: 바꾼 비밀번호를 저장하는 곳 */
  constructor(envPassword, db) {
    this.envPassword = String(envPassword || '');
    this.db = db;
    this.keys = new Map(); // 열쇠 → 만료 시각
    this.fails = 0;
    this.lockUntil = 0;
  }

  stored() {
    const h = this.db ? this.db.getSetting(HASH_KEY, null) : null;
    return h && h.salt && h.hash ? h : null;
  }

  /** 지금 쓰는 비밀번호가 어디 것인지: db(바꾼 것) / env(처음 것) / none */
  source() { return this.stored() ? 'db' : this.envPassword ? 'env' : 'none'; }

  enabled() { return this.source() !== 'none'; }

  verify(pw) {
    pw = String(pw || '');
    const h = this.stored();
    if (h) {
      const got = crypto.scryptSync(pw, h.salt, 32);
      return crypto.timingSafeEqual(got, Buffer.from(h.hash, 'hex'));
    }
    return this.envPassword.length > 0 && sameText(pw, this.envPassword);
  }

  /** 틀린 횟수를 세며 확인 — 잠겨 있으면 error */
  attempt(pw) {
    const now = Date.now();
    if (!this.enabled()) return { ok: false, error: '서버에 관리자 비밀번호(ADMIN_PASSWORD)가 설정되지 않았어요' };
    if (now < this.lockUntil) return { ok: false, error: `비밀번호를 여러 번 틀렸어요. ${Math.ceil((this.lockUntil - now) / 1000)}초 뒤에 다시 해 주세요` };
    if (!this.verify(pw)) {
      this.fails += 1;
      if (this.fails >= MAX_FAIL) { this.fails = 0; this.lockUntil = now + LOCK_MS; }
      return { ok: false, error: '비밀번호가 맞지 않아요' };
    }
    this.fails = 0;
    return { ok: true };
  }

  newKey() {
    const now = Date.now();
    const key = crypto.randomBytes(24).toString('base64url');
    this.keys.set(key, now + KEY_MS);
    for (const [k, t] of this.keys) if (t < now) this.keys.delete(k);
    return key;
  }

  login(pw) {
    const r = this.attempt(pw);
    if (!r.ok) return r;
    return { ok: true, key: this.newKey() };
  }

  /** 비밀번호 바꾸기 — 지금 비밀번호 확인, 새 비밀번호는 6자 이상. 다른 곳의 로그인은 모두 풀림 */
  change(oldPw, newPw) {
    newPw = String(newPw || '');
    if (newPw.length < MIN_LEN) return { ok: false, error: `새 비밀번호는 ${MIN_LEN}자 이상이어야 해요` };
    if (/\s/.test(newPw)) return { ok: false, error: '새 비밀번호에 띄어쓰기는 쓸 수 없어요' };
    const r = this.attempt(oldPw);
    if (!r.ok) return { ok: false, error: r.error === '비밀번호가 맞지 않아요' ? '지금 비밀번호가 맞지 않아요' : r.error };
    this.db.setSetting(HASH_KEY, hashPassword(newPw));
    this.keys.clear();
    return { ok: true, key: this.newKey() };
  }

  check(key) {
    if (typeof key !== 'string') return false;
    const t = this.keys.get(key);
    if (!t) return false;
    if (t < Date.now()) { this.keys.delete(key); return false; }
    return true;
  }

  logout(key) { this.keys.delete(key); }
}

module.exports = { Auth, hashPassword, HASH_KEY, MIN_LEN };
