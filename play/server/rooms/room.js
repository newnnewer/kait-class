'use strict';
// 학생 방 하나 — 대기실(모집 중) ↔ 경기(진행 중)
//   방장만 시작 · 방장이 나가면 다음 사람이 방장 · 모두 나가면 방이 없어진다
//   10분 동안 시작하지 않으면 닫힌다 · 경기가 끝나면 결과를 보여 주고 대기실로 돌아온다
//   봇 (v0.6.4): 방장이 대기실에서 넣고 뺀다 · 최대 인원에 들어간다 · 사람이 모두 나가면 방이 닫힌다

const { Match } = require('../game/match');
const { recommendBlocks } = require('../game/board');
const { makeBot, stepBot } = require('../classes/bot');
const { rollNick } = require('../nick');
const CHAT = require('../../public/js/shared/chat');

const WAIT_CLOSE_MS = 10 * 60000;
const COUNTDOWN_MS = 5000; // 시작하면 5초 카운트다운 뒤에 움직일 수 있다 (v0.7.6)

class Room {
  constructor({ lobby, id, host, settings }) {
    this.lobby = lobby;
    this.io = lobby.io;
    this.id = id;
    this.name = `${host.nick}의 방`;
    this.hostId = host.id;
    this.settings = settings;
    this.channel = 'room:' + id;
    this.members = new Map(); // id → player (들어온 순서대로)
    this.phase = 'waiting';
    this.match = null;
    this.lastResult = null;
    this.closeAt = Date.now() + (lobby.waitCloseMs || WAIT_CLOSE_MS);
    this.closed = false;
    this.botTimer = null;
    this.chatLog = [];         // 대기실 채팅 최근 8개
  }

  pubOf(p) { return { id: p.id, nick: p.nick, kind: p.kind, color: p.color, online: p.online, bot: !!p.bot }; }
  humans() { return [...this.members.values()].filter(p => !p.bot); }
  bots() { return [...this.members.values()].filter(p => p.bot); }

  /** 로비 목록에 보이는 요약 */
  summary() {
    const s = this.settings;
    return {
      id: this.id, name: this.name, phase: this.phase,
      count: this.members.size, max: s.max, tags: s.tags, limitMin: s.limitMin,
      members: [...this.members.values()].slice(0, 8).map(p => ({ kind: p.kind, color: p.color })),
      pct: this.match ? this.match.progress() : 0,
    };
  }

  /** 대기실 화면에 보내는 정보 */
  detail() {
    return {
      id: this.id, name: this.name, phase: this.phase, hostId: this.hostId,
      members: [...this.members.values()].map(p => this.pubOf(p)),
      settings: this.settings,
      blocksNow: this.blocksFor(this.members.size),
      closeMs: Math.max(0, this.closeAt - Date.now()),
      result: this.lastResult,
      chat: this.chatLog,
    };
  }

  matchOf(p) { return this.match && this.match.has(p) ? this.match : null; }

  blocksFor(n) { return this.settings.blocks || recommendBlocks(Math.max(1, n)); }

  emitAll(ev, data) { this.io.to(this.channel).emit(ev, data); }
  sendDetail() { this.emitAll('room', this.detail()); }

  // ── 들어오고 나가기 ──

  canJoin() {
    if (this.closed) return '없어진 방이에요';
    if (this.phase !== 'waiting') return '이미 게임이 진행 중이에요';
    if (this.members.size >= this.settings.max) return '방이 꽉 찼어요';
    return null;
  }

  join(p, socket) {
    const why = this.canJoin();
    if (why) return { ok: false, error: why };
    this.members.set(p.id, p);
    p.room = this;
    socket.leave('lobby');
    socket.join(this.channel);
    this.sendDetail();
    this.lobby.changed();
    return { ok: true, room: this.detail() };
  }

  /** 새로고침·재접속: 있던 곳(대기실 또는 경기)으로 되돌려 보낸다 */
  resend(p, socket) {
    socket.leave('lobby');
    socket.join(this.channel);
    socket.emit('room', this.detail());
    if (this.phase === 'playing' && this.match && this.match.has(p)) {
      this.match.setOnline(p);
      this.match.sendState(p);
    } else {
      this.sendDetail();
    }
  }

  /** 연결이 끊겼다 (잠깐일 수도 있다) */
  offline(p) {
    if (this.match && this.match.has(p)) this.match.setOnline(p);
    else this.sendDetail();
  }

  leave(p, socket) {
    if (!this.members.has(p.id)) return;
    this.members.delete(p.id);
    p.room = null;
    if (socket) socket.leave(this.channel);
    if (this.match) this.match.leave(p); // 경기 중이면 판에서도 뺀다 (모두 나가면 경기가 끝난다)
    if (this.closed) return;
    if (!this.humans().length) { this.close('empty'); return; } // 봇만 남으면 닫는다
    if (this.hostId === p.id) {
      const nextHost = this.humans()[0];
      this.hostId = nextHost.id;
    }
    this.sendDetail();
    this.lobby.changed();
  }

  // ── 대기실 채팅 (v0.7.3): 정해 둔 문구만 · 게임 중에는 안 됨 · 한 사람 2초에 한 번 ──
  say(p, id) {
    if (this.phase !== 'waiting') return { ok: false, why: 'playing' };
    const x = CHAT.find(String(id || ''), 'room');
    if (!x) return { ok: false, why: 'bad' };
    const now = Date.now();
    if (p.lastChat && now - p.lastChat < CHAT.GAP_MS) return { ok: false, why: 'fast', ms: CHAT.GAP_MS - (now - p.lastChat) };
    p.lastChat = now;
    const msg = { pid: p.id, nick: p.nick, kind: p.kind, color: p.color, id: x.id, text: x.text, at: now };
    this.chatLog.push(msg);
    if (this.chatLog.length > 8) this.chatLog.shift();
    this.io.to(this.channel).emit('chat', msg);
    return { ok: true };
  }

  // ── 봇 (방장만, 대기실에서만) ──

  addBot(p) {
    if (p.id !== this.hostId) return { ok: false, error: '방장만 봇을 넣을 수 있어요' };
    if (this.phase !== 'waiting') return { ok: false, error: '게임 중에는 봇을 넣을 수 없어요' };
    if (this.members.size >= this.settings.max) return { ok: false, error: '방이 꽉 찼어요 (봇도 인원에 들어가요)' };
    const used = new Set([...this.members.values()].map(x => x.nick));
    const bot = makeBot(rollNick(used));
    bot.room = this;
    this.members.set(bot.id, bot);
    this.sendDetail();
    this.lobby.changed();
    return { ok: true, id: bot.id };
  }

  removeBot(p, id) {
    if (p.id !== this.hostId) return { ok: false, error: '방장만 봇을 뺄 수 있어요' };
    if (this.phase !== 'waiting') return { ok: false, error: '게임 중에는 봇을 뺄 수 없어요' };
    const bot = this.members.get(id);
    if (!bot || !bot.bot) return { ok: false, error: '없는 봇이에요' };
    this.leave(bot, null);
    return { ok: true };
  }

  /** 0.2초마다 봇을 한 걸음씩 (수업 게임과 같은 봇) */
  stepBots() {
    const m = this.match;
    if (!m || m.ended) return;
    const taken = new Set();
    for (const bot of this.bots()) {
      if (!m.has(bot)) continue;
      try { stepBot(bot, m, this.settings.botSpeed, taken); } catch (e) { console.error('[오류] room bot:', e); }
    }
  }
  stopBots() { if (this.botTimer) { clearInterval(this.botTimer); this.botTimer = null; } }

  // ── 시작과 끝 ──

  start(p) {
    if (this.phase !== 'waiting') return { ok: false, error: '이미 시작했어요' };
    if (p.id !== this.hostId) return { ok: false, error: '방장만 시작할 수 있어요' };
    const s = this.settings;
    const { codes, bosses } = this.lobby.problemsFor(s.tags);
    if (!codes.length) return { ok: false, error: '고른 태그에 문제가 없어요' };
    this.lastResult = null;
    this.phase = 'playing';
    this.match = new Match({
      io: this.io, channel: this.channel,
      info: { id: this.id, name: this.name, tags: s.tags, mode: 'room' },
      codes, bosses,
      s: {
        blocks: this.blocksFor(this.members.size),
        occMs: s.occSec * 1000,
        bossEveryMs: s.bossEverySec * 1000,
        bossWaitMs: s.bossWaitSec * 1000,
        bossLimitMs: s.bossLimitSec * 1000,
        penalty: s.penalty,
        limitMs: s.limitMin * 60000,
        idleMs: this.lobby.idleMs, idleWarnMs: this.lobby.idleWarnMs,
        countdownMs: this.lobby.countdownMs == null ? COUNTDOWN_MS : this.lobby.countdownMs,
      },
      onEnd: result => this.onEnd(result),
    });
    for (const m of this.members.values()) this.match.add(m);
    for (const m of this.members.values()) if (!m.bot) this.match.sendState(m);
    if (this.bots().length) this.botTimer = setInterval(() => this.stepBots(), 200);
    this.lobby.changed();
    return { ok: true };
  }

  onEnd(result) {
    this.stopBots();
    this.match = null;
    this.phase = 'waiting';
    this.lastResult = result;
    this.closeAt = Date.now() + (this.lobby.waitCloseMs || WAIT_CLOSE_MS);
    if (this.closed) return;
    if (result.reason === 'idle') { this.close('idle'); return; }
    this.emitAll('result', result);
    this.sendDetail();
    this.lobby.changed();
  }

  /** 방 닫기: empty(모두 나감) / timeout(10분 미시작) / idle(게임 중 방치) */
  close(reason) {
    if (this.closed) return;
    this.closed = true;
    this.stopBots();
    if (this.match) { this.match.stop(); this.match = null; }
    for (const p of this.members.values()) {
      p.room = null;
      const sock = this.lobby.socketOf(p);
      if (sock) {
        sock.leave(this.channel);
        sock.emit('closed', { reason });
        this.lobby.enter(p, sock);
      }
    }
    this.members.clear();
    this.lobby.remove(this);
  }

  tick(now) {
    if (this.phase === 'waiting' && now >= this.closeAt) this.close('timeout');
  }
}

module.exports = { Room, WAIT_CLOSE_MS };
