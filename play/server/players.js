'use strict';
// 접속한 사람 목록.
//  token : 브라우저가 만들어 저장해 둔 비밀 열쇠 — 새로고침해도 같은 사람으로 돌아온다
//  id    : 다른 사람에게 보여 주는 짧은 번호 (token 은 절대 내보내지 않는다)

const crypto = require('crypto');

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

class Players {
  constructor() {
    this.byToken = new Map();
    this.byId = new Map();
  }

  validToken(t) { return typeof t === 'string' && TOKEN_RE.test(t); }

  get(token) { return this.byToken.get(token) || null; }

  create(token, { nick, kind, color }) {
    let id;
    do { id = crypto.randomBytes(4).toString('hex'); } while (this.byId.has(id));
    const p = { token, id, nick, kind, color, socketId: null, room: null, online: false, lastSeen: Date.now(), dropTimer: null };
    this.byToken.set(token, p);
    this.byId.set(id, p);
    return p;
  }

  remove(p) {
    if (p.dropTimer) clearTimeout(p.dropTimer);
    this.byToken.delete(p.token);
    this.byId.delete(p.id);
  }

  nicks() { return new Set([...this.byToken.values()].map(p => p.nick)); }

  count() { return this.byToken.size; }

  /** 다른 사람에게 보여 줄 정보 */
  pub(p) { return { id: p.id, nick: p.nick, kind: p.kind, color: p.color, online: p.online }; }
}

module.exports = { Players };
