'use strict';
// 공식전 모음 — 공식전 코드(숫자 4자리) → 공식전
//   · 공식전 코드를 연속으로 틀리면 잠시 막는다 (코드 찍어 보기 방지)
//   · '자유 플레이 허용' 스위치 (서버 전체, DB에 저장)
//   · 3시간 동안 아무 일이 없는 공식전은 자동으로 닫는다
//   · 1.2.1 체험 서버(demo): 교사 비밀번호를 여럿이 쓰므로 목록에서 '내 공식전'(이 브라우저가 만들었거나 코드로 연 것)만 코드를 보여 준다.
//     다른 공식전은 코드를 가리고, 교사가 공식전 코드를 넣어야 열린다 (잘못 들어가지 않게 하는 장치 — 막는 장치는 아님)

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
    this.demo = false; // index.js 가 정해 줌
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

  /** viewer = 교사 브라우저 아이디. idleMs = 대기 중일 때 마지막으로 무언가 한 뒤 지난 시간 (게임 중이면 0) */
  list(viewer) {
    const now = Date.now();
    return [...this.classes.values()].map(c => {
      const mine = !this.demo || this.isOwner(c, viewer);
      return {
        code: mine ? c.code : null, mine,
        phase: c.phase, count: c.members.size - c.bots().length, // 0.14.0: 비트는 빼고 센다
        teams: c.settings.teams, tags: c.settings.tags, createdAt: c.createdAt,
        idleMs: c.phase === 'waiting' ? Math.max(0, now - c.lastActive) : 0,
      };
    });
  }

  isOwner(c, viewer) { return !!viewer && c.owners.has(viewer); }
  addOwner(c, viewer) { if (viewer) c.owners.add(viewer); }

  /** 코드 찍어 보기 막기 — key 마다 1분에 5번까지 틀릴 수 있다 */
  triesLeft(key) {
    const now = Date.now();
    let t = this.tries.get(key);
    if (t && now - t.at > CODE_LOCK_MS) { this.tries.delete(key); t = null; } // 1분 지나면 새로 센다
    if (t && t.n >= CODE_FAIL_MAX) return { ok: false, error: `코드를 여러 번 틀렸어요. ${Math.ceil((t.at + CODE_LOCK_MS - now) / 1000)}초 뒤에 다시 해 보세요` };
    return null;
  }
  failTry(key) {
    const now = Date.now();
    const t = this.tries.get(key) || { n: 0, at: now };
    t.n += 1; t.at = now;
    this.tries.set(key, t);
  }

  get(code) { return this.classes.get(String(code)) || null; }

  create(settings, owner) {
    if (this.classes.size >= MAX_CLASSES) return { ok: false, error: '열려 있는 공식전이 너무 많아요. 안 쓰는 수업을 끝내 주세요' };
    let code;
    do { code = String(1000 + Math.floor(Math.random() * 9000)); } while (this.classes.has(code));
    const c = new ClassGame({ hub: this, code, settings });
    c.owners = new Set(); // 1.2.1 이 공식전을 만들었거나 코드로 연 교사 브라우저들
    this.addOwner(c, owner);
    this.classes.set(code, c);
    return { ok: true, code };
  }

  /** 학생이 공식전 코드로 들어가기 */
  join(p, socket, code) {
    if (p.room) return { ok: false, error: '이미 방에 있어요' };
    const locked = this.triesLeft(p.token);
    if (locked) return locked;
    code = String(code == null ? '' : code).trim();
    const c = /^\d{4}$/.test(code) ? this.classes.get(code) : null;
    if (!c) {
      this.failTry(p.token);
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
