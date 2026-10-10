'use strict';
// 로비 — 방 목록과 방 만들기 (협동방 · 대전방)
//   같은 브라우저(기기 열쇠)는 1분에 방 1개까지 · 서버 전체 방은 최대 60개

const crypto = require('crypto');
const { Room } = require('./room');
const { cleanRoom } = require('./settings');

class Lobby {
  constructor({ io, store, maxRooms, createGapMs, waitCloseMs, idleMs, idleWarnMs }) {
    this.io = io;
    this.store = store; // 문제 은행 (바뀌면 다음 게임부터)
    this.maxRooms = maxRooms || 60;
    this.createGapMs = createGapMs == null ? 60000 : createGapMs;
    this.waitCloseMs = waitCloseMs;
    this.idleMs = idleMs;
    this.idleWarnMs = idleWarnMs;
    this.rooms = new Map();
    this.lastCreate = new Map(); // 기기 열쇠 → 마지막으로 방을 만든 시각
    this.dirty = false;
    this.lastProgress = '';
    this.allowRooms = () => true; // '학생 방 만들기 허용' (수업방 모음이 정해 준다)
    this.timer = setInterval(() => { try { this.tick(); } catch (e) { console.error('[오류] lobby:', e); } }, 1000);
    this.timer.unref();
  }

  socketOf(p) { return p.socketId ? this.io.sockets.sockets.get(p.socketId) : null; }

  list() { return [...this.rooms.values()].map(r => r.summary()); }

  message() { return { rooms: this.list(), allowRooms: this.allowRooms() }; }

  /** 로비에 있는 사람들에게 목록을 다시 보낸다 (여러 번 불려도 0.3초에 한 번) */
  changed() {
    if (this.dirty) return;
    this.dirty = true;
    setTimeout(() => { this.dirty = false; this.io.to('lobby').emit('lobby', this.message()); }, 300).unref();
  }

  enter(p, socket) {
    p.room = null;
    socket.join('lobby');
    socket.emit('lobby', this.message());
  }

  /** 태그 중 하나라도 붙은 문제 (합집합) */
  problemsFor(tags) {
    const has = x => x.tags.some(t => tags.includes(t));
    const bank = this.store.bank();
    return { codes: bank.normal.filter(has).map(x => x.code), bosses: bank.boss.filter(has) };
  }

  create(p, socket, raw) {
    if (p.room) return { ok: false, error: '이미 방에 있어요' };
    if (!this.allowRooms()) return { ok: false, error: '지금은 선생님이 방 만들기를 꺼 두었어요' };
    const settings = cleanRoom(raw);
    if (!settings) return { ok: false, error: '태그를 하나 이상 고르세요' };
    if (this.rooms.size >= this.maxRooms) return { ok: false, error: '지금은 방이 너무 많아요. 열려 있는 방에 들어가 보세요' };
    const now = Date.now();
    const last = this.lastCreate.get(p.token) || 0;
    if (now - last < this.createGapMs) {
      const sec = Math.ceil((this.createGapMs - (now - last)) / 1000);
      return { ok: false, error: `방은 1분에 하나만 만들 수 있어요 (${sec}초 뒤에 다시)` };
    }
    let id;
    do { id = crypto.randomBytes(3).toString('hex'); } while (this.rooms.has(id));
    const room = new Room({ lobby: this, id, host: p, settings });
    this.rooms.set(id, room);
    this.lastCreate.set(p.token, now);
    return room.join(p, socket);
  }

  join(p, socket, id) {
    if (p.room) return { ok: false, error: '이미 방에 있어요' };
    const room = this.rooms.get(String(id));
    if (!room) return { ok: false, error: '없어진 방이에요' };
    return room.join(p, socket);
  }

  /** 내가 있는 학생 방 (수업방이면 null) */
  myRoom(p) {
    const r = p.room;
    return r && this.rooms.get(r.id) === r ? r : null;
  }

  /** 대기실에서 방장이 봇 넣기 · 빼기 · 채우기. msg: { op: 'add', no? } · { op: 'remove', id } · { op: 'fill' } */
  roomBot(p, msg) {
    const r = this.myRoom(p);
    if (!r) return { ok: false, error: '방에 있지 않아요' };
    if (msg && msg.op === 'remove') return r.removeBot(p, String(msg.id || ''));
    if (msg && msg.op === 'fill') return r.fillBots(p);
    return r.addBot(p, msg && msg.no);
  }

  /** v0.13.0: 준비 · 팀 고르기 · (방장) 옮기기 · 내보내기 */
  roomAct(p, op, msg) {
    const r = this.myRoom(p);
    if (!r) return { ok: false, error: '방에 있지 않아요' };
    msg = msg || {};
    if (op === 'ready') return r.toggleReady(p);
    if (op === 'team') return r.pickTeam(p, msg.no);
    if (op === 'move') return r.moveTo(p, msg.id, msg.no);
    if (op === 'kick') return r.kick(p, msg.id);
    return { ok: false, error: '잘못된 요청' };
  }

  leaveRoom(p, socket) {
    if (p.room) p.room.leave(p, socket);
    this.enter(p, socket);
    return { ok: true };
  }

  remove(room) {
    this.rooms.delete(room.id);
    this.changed();
  }

  tick() {
    const now = Date.now();
    for (const r of [...this.rooms.values()]) r.tick(now);
    // 진행 중인 방의 진행률이 바뀌었으면 로비에 알린다 (2초마다 보면 충분)
    if (now % 2000 < 1000) {
      const key = [...this.rooms.values()].filter(r => r.match).map(r => r.id + ':' + r.match.progress()).join(',');
      if (key !== this.lastProgress) { this.lastProgress = key; this.changed(); }
    }
    // 오래된 '방 만들기 기록' 정리
    for (const [k, t] of this.lastCreate) if (now - t > this.createGapMs) this.lastCreate.delete(k);
  }
}

module.exports = { Lobby };
