'use strict';
// 공식전 모음 — 공식전 코드(숫자 4자리) → 공식전
//   · 공식전 코드를 연속으로 틀리면 잠시 막는다 (코드 찍어 보기 방지)
//   · '자유 플레이 허용' 스위치 (서버 전체, DB에 저장)
//   · 3시간 동안 아무 일이 없는 공식전은 자동으로 닫는다

const { ClassGame } = require('./classgame');

const MAX_CLASSES = 20;
const CODE_FAIL_MAX = 5;          // 이만큼 틀리면
const CODE_LOCK_MS = 60000;       // 이만큼 막는다
const CLASS_IDLE_MS = 3 * 3600 * 1000;

class ClassHub {
  constructor({ io, bank, db, lobby, idleMs }) {
    this.io = io;
    this.bank = bank;
    this.db = db;
    this.lobby = lobby;
    this.idleMs = idleMs || CLASS_IDLE_MS;
    this.classes = new Map();
    this.tries = new Map(); // 브라우저 열쇠 → { n: 틀린 횟수, at: 마지막으로 틀린 시각 }
    this.allowRooms = db.getSetting('allowRooms', true) !== false;
    this.nicks = () => new Set(); // 지금 접속한 사람들의 닉네임 (비트 이름이 겹치지 않게, index.js 가 정해 줌)
    this.timer = setInterval(() => { try { this.sweep(); } catch (e) { console.error('[오류] class hub:', e); } }, 30000);
    this.timer.unref();
  }

  socketOf(p) { return p.socketId ? this.io.sockets.sockets.get(p.socketId) : null; }

  problemsFor(tags) { return this.lobby.problemsFor(tags); }

  setAllowRooms(on) {
    this.allowRooms = !!on;
    this.db.setSetting('allowRooms', this.allowRooms);
    this.lobby.changed();
    for (const c of this.classes.values()) c.changed();
    return { ok: true, allowRooms: this.allowRooms };
  }

  list() {
    return [...this.classes.values()].map(c => ({
      code: c.code, phase: c.phase, count: c.members.size, teams: c.settings.teams, tags: c.settings.tags, createdAt: c.createdAt,
    }));
  }

  get(code) { return this.classes.get(String(code)) || null; }

  create(settings) {
    if (this.classes.size >= MAX_CLASSES) return { ok: false, error: '열려 있는 공식전이 너무 많아요. 안 쓰는 수업을 끝내 주세요' };
    let code;
    do { code = String(1000 + Math.floor(Math.random() * 9000)); } while (this.classes.has(code));
    const c = new ClassGame({ hub: this, code, settings });
    this.classes.set(code, c);
    return { ok: true, code };
  }

  /** 학생이 공식전 코드로 들어가기 */
  join(p, socket, code) {
    if (p.room) return { ok: false, error: '이미 방에 있어요' };
    const now = Date.now();
    let t = this.tries.get(p.token);
    if (t && now - t.at > CODE_LOCK_MS) t = null; // 1분 지나면 새로 센다
    if (t && t.n >= CODE_FAIL_MAX) return { ok: false, error: `코드를 여러 번 틀렸어요. ${Math.ceil((t.at + CODE_LOCK_MS - now) / 1000)}초 뒤에 다시 해 보세요` };
    code = String(code == null ? '' : code).trim();
    const c = /^\d{4}$/.test(code) ? this.classes.get(code) : null;
    if (!c) {
      t = t || { n: 0, at: now };
      t.n += 1; t.at = now;
      this.tries.set(p.token, t);
      return { ok: false, error: '그런 공식전 코드가 없어요' };
    }
    this.tries.delete(p.token);
    return c.join(p, socket);
  }

  remove(c) { this.classes.delete(c.code); }

  sweep() {
    const now = Date.now();
    for (const c of [...this.classes.values()]) {
      if (c.phase === 'waiting' && now - c.lastActive > this.idleMs) c.close('idle');
    }
    for (const [k, t] of this.tries) if (now - t.at > CODE_LOCK_MS) this.tries.delete(k);
  }
}

module.exports = { ClassHub };
