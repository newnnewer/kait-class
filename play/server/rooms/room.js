'use strict';
// 학생 방 하나 — 대기실(모집 중) ↔ 경기(진행 중)
//   협동방(coop): 모두가 판 하나를 함께 채운다 (예전 학생 방)
//   대전방(battle, v0.13.0): 2~4팀 × 팀마다 1~8명. 팀마다 같은 판으로 겨룬다 (수업방과 같은 TeamRound)
//
//   · 방장만 시작 · 방장이 나가거나 10초 넘게 연결이 끊기면 다음 사람이 방장 · 사람이 모두 나가면 방이 없어진다
//   · 준비(v0.13.0): 방장 말고 모두 '준비'해야 시작 가능 (봇은 늘 준비). 모두 준비되면 15초 뒤 자동 시작
//   · 방장: 봇 넣고 빼기 · (대전방) 학생을 다른 팀으로 옮기기 · 내보내기(같은 방에 다시 못 들어옴)
//   · 10분 동안 시작하지 않으면 닫힌다 · 경기가 끝나면 결과를 보여 주고 대기실로 돌아온다 (준비는 모두 풀림)
//   · 대전방: 팀원(사람)이 모두 나간 팀은 기권 → 맨 아래 순위

const { Match } = require('../game/match');
const { TeamRound } = require('../game/teamround');
const { recommendBlocks } = require('../game/board');
const { makeBot, stepBot } = require('../classes/bot');
const { rollNick } = require('../nick');
const { randomSeed } = require('../rng');
const CHAT = require('../../public/js/shared/chat');

const WAIT_CLOSE_MS = 10 * 60000;
const COUNTDOWN_MS = 5000;   // 시작하면 5초 카운트다운 뒤에 움직일 수 있다 (v0.7.6)
const AUTO_START_MS = 15000; // v0.13.0: 모두 준비되면 이만큼 뒤에 자동 시작
const HOST_OFF_MS = 10000;   // v0.13.0: 방장 연결이 이만큼 끊기면 방장을 넘긴다

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
    this.teamOf = new Map();  // 대전방: id → 팀 번호
    this.ready = new Set();   // 준비한 사람 id
    this.kicked = new Set();  // 내보낸 브라우저 열쇠
    this.phase = 'waiting';
    this.match = null;        // 협동방 경기
    this.round = null;        // 대전방 경기 (TeamRound)
    this.lastResult = null;
    this.closeAt = Date.now() + (lobby.waitCloseMs || WAIT_CLOSE_MS);
    this.autoAt = 0;          // 자동 시작 시각 (0 = 없음)
    this.hostOffSince = 0;
    this.closed = false;
    this.botTimer = null;
    this.chatLog = [];        // 대기실 채팅 최근 8개
  }

  isRoom() { return true; }
  get battle() { return this.settings.mode === 'battle'; }
  pubOf(p) { return { id: p.id, nick: p.nick, kind: p.kind, color: p.color, online: p.online, bot: !!p.bot }; }
  humans() { return [...this.members.values()].filter(p => !p.bot); }
  bots() { return [...this.members.values()].filter(p => p.bot); }
  socketOf(p) { return this.lobby.socketOf(p); }
  isReady(p) { return p.bot || p.id === this.hostId || this.ready.has(p.id); }

  // ── 팀 (대전방) ──
  teamCount() { return this.battle ? this.settings.teams : 0; }
  teamMembers(no) { return [...this.members.values()].filter(p => this.teamOf.get(p.id) === no); }
  teamChannel(no) { return this.channel + ':t' + no; }
  /** 사람이 가장 적은 팀 (꽉 찬 팀은 빼고, 같으면 번호가 작은 팀). 없으면 0 */
  emptiestTeam() {
    let best = 0, min = Infinity;
    for (let no = 1; no <= this.settings.teams; no++) {
      const k = this.teamMembers(no).length;
      if (k < this.settings.teamSize && k < min) { min = k; best = no; }
    }
    return best;
  }
  biggestTeam() {
    let big = 0;
    for (let no = 1; no <= this.teamCount(); no++) big = Math.max(big, this.teamMembers(no).length);
    return big;
  }

  // ── TeamRound 가 쓰는 것 ──
  get label() { return this.id; }
  get mode() { return 'battle'; }
  get idleMs() { return this.lobby.idleMs; }
  get idleWarnMs() { return this.lobby.idleWarnMs; }
  attacksOn() { return true; }
  standingsTo() { return [this.channel]; }
  changed() { this.sendDetail(); this.lobby.changed(); }
  onRoundEnd(result) { this.onEnd(result); }

  /** 로비 목록에 보이는 요약 */
  summary() {
    const s = this.settings;
    const out = {
      id: this.id, name: this.name, phase: this.phase, mode: s.mode,
      count: this.members.size, max: s.max, tags: s.tags, limitMin: s.limitMin,
      members: [...this.members.values()].slice(0, 8).map(p => ({ kind: p.kind, color: p.color })),
      pct: this.progress(),
    };
    if (this.battle) {
      out.teams = s.teams;
      out.teamSize = s.teamSize;
      out.teamCounts = Array.from({ length: s.teams }, (_, k) => this.teamMembers(k + 1).length);
    }
    return out;
  }

  /** 진행률 — 대전방은 가장 앞선 팀 */
  progress() {
    if (this.match) return this.match.progress();
    if (this.round) return Math.max(0, ...[...this.round.matches.values()].map(m => m.progress()));
    return 0;
  }

  /** 시작할 수 있는지 — { ok, why, notReady, warn } (대기실 화면에 보여 준다) */
  startCheck() {
    const notReady = this.humans().filter(p => !this.isReady(p)).length;
    let why = null, warn = null;
    if (this.battle) {
      const used = [];
      for (let no = 1; no <= this.settings.teams; no++) { const k = this.teamMembers(no).length; if (k) used.push(k); }
      if (used.length < 2) why = 'rival';
      else if (Math.min(...used) !== Math.max(...used)) warn = 'uneven';
    }
    if (!why && notReady) why = 'ready';
    return { ok: !why, why, notReady, warn };
  }

  /** 대기실 화면에 보내는 정보 */
  detail() {
    const s = this.settings;
    const person = p => ({ ...this.pubOf(p), ready: this.isReady(p) });
    const d = {
      id: this.id, name: this.name, phase: this.phase, hostId: this.hostId, mode: s.mode,
      members: [...this.members.values()].map(person),
      settings: s,
      blocksNow: this.blocksFor(this.battle ? this.biggestTeam() : this.members.size),
      closeMs: Math.max(0, this.closeAt - Date.now()),
      autoMs: this.autoAt ? Math.max(0, this.autoAt - Date.now()) : 0,
      check: this.startCheck(),
      result: this.lastResult,
      chat: this.chatLog,
    };
    if (this.battle) d.teams = Array.from({ length: s.teams }, (_, k) => ({ no: k + 1, members: this.teamMembers(k + 1).map(person) }));
    return d;
  }

  matchOf(p) {
    if (this.match) return this.match.has(p) ? this.match : null;
    if (this.round) {
      const m = this.round.matches.get(this.teamOf.get(p.id));
      return m && m.has(p) ? m : null;
    }
    return null;
  }

  blocksFor(n) { return this.settings.blocks || recommendBlocks(Math.max(1, n)); }

  emitAll(ev, data) { this.io.to(this.channel).emit(ev, data); }
  sendDetail() { if (!this.closed) this.emitAll('room', this.detail()); }

  // ── 들어오고 나가기 ──

  canJoin(p) {
    if (this.closed) return '없어진 방이에요';
    if (p && this.kicked.has(p.token)) return '방장이 내보낸 방에는 다시 들어갈 수 없어요';
    if (this.phase !== 'waiting') return '이미 게임이 진행 중이에요';
    if (this.members.size >= this.settings.max) return '방이 꽉 찼어요';
    if (this.battle && !this.emptiestTeam()) return '방이 꽉 찼어요';
    return null;
  }

  join(p, socket) {
    const why = this.canJoin(p);
    if (why) return { ok: false, error: why };
    this.members.set(p.id, p);
    if (this.battle) this.teamOf.set(p.id, this.emptiestTeam());
    p.room = this;
    socket.leave('lobby');
    socket.join(this.channel);
    this.recheckAuto();
    this.changed();
    return { ok: true, room: this.detail() };
  }

  /** 새로고침·재접속: 있던 곳(대기실 또는 경기)으로 되돌려 보낸다 */
  resend(p, socket) {
    socket.leave('lobby');
    socket.join(this.channel);
    socket.emit('room', this.detail());
    const m = this.matchOf(p);
    if (this.phase === 'playing' && m) {
      if (this.round) {
        const no = this.teamOf.get(p.id);
        socket.join(this.teamChannel(no));
        socket.emit('standings', this.round.standings());
        m.setOnline(p);
        m.sendState(p);
        this.round.sendDone(no, p);
      } else {
        m.setOnline(p);
        m.sendState(p);
      }
    } else {
      this.sendDetail();
    }
  }

  /** 연결이 끊겼다 (잠깐일 수도 있다) */
  offline(p) {
    const m = this.matchOf(p);
    if (m) m.setOnline(p);
    else this.sendDetail();
  }

  leave(p, socket) {
    if (!this.members.has(p.id)) return;
    const no = this.teamOf.get(p.id) || 0;
    const m = this.matchOf(p);
    this.members.delete(p.id);
    this.teamOf.delete(p.id);
    this.ready.delete(p.id);
    p.room = null;
    if (socket) { socket.leave(this.channel); if (no) socket.leave(this.teamChannel(no)); }
    if (m) m.leave(p); // 경기 중이면 판에서도 뺀다 (협동방: 모두 나가면 경기가 끝난다)
    if (this.closed) return;
    if (!this.humans().length) { this.close('empty'); return; } // 봇만 남으면 닫는다
    // 대전방: 그 팀에 사람이 아무도 없으면 기권
    if (this.round && no && !this.teamMembers(no).some(x => !x.bot)) this.round.forfeit(no);
    if (this.hostId === p.id) this.passHost();
    this.recheckAuto();
    this.changed();
  }

  /** 방장을 다음 사람에게 (연결된 사람 먼저) */
  passHost() {
    const hs = this.humans().filter(x => x.id !== this.hostId);
    const next = hs.find(x => x.online) || hs[0];
    if (!next) return;
    this.hostId = next.id;
    this.ready.delete(next.id);
    this.hostOffSince = 0;
  }

  // ── 준비 · 팀 · 방장 관리 (v0.13.0) ──

  /** 준비 / 준비 풀기 (방장은 준비가 없다 — 대신 시작) */
  toggleReady(p) {
    if (this.phase !== 'waiting') return { ok: false, error: '게임 중이에요' };
    if (p.id === this.hostId) return { ok: false, error: '방장은 준비 대신 시작을 눌러요' };
    if (this.ready.has(p.id)) this.ready.delete(p.id); else this.ready.add(p.id);
    this.recheckAuto();
    this.changed();
    return { ok: true, ready: this.ready.has(p.id) };
  }

  /** 팀 옮기기 — 학생 스스로(pickTeam) 또는 방장이(moveTo). 준비 상태는 그대로 */
  setTeam(p, no) {
    if (!this.battle) return { ok: false, error: '대전방에서만 팀을 고를 수 있어요' };
    if (this.phase !== 'waiting') return { ok: false, error: '게임 중에는 팀을 바꿀 수 없어요' };
    no = Math.round(Number(no));
    if (!(no >= 1 && no <= this.settings.teams)) return { ok: false, error: '없는 팀이에요' };
    if (this.teamOf.get(p.id) === no) return { ok: true };
    if (this.teamMembers(no).length >= this.settings.teamSize) return { ok: false, error: `${no}팀은 꽉 찼어요` };
    this.teamOf.set(p.id, no);
    this.changed();
    return { ok: true };
  }
  pickTeam(p, no) { return this.setTeam(p, no); }

  hostOnly(p) {
    if (p.id !== this.hostId) return '방장만 할 수 있어요';
    if (this.phase !== 'waiting') return '게임 중에는 할 수 없어요';
    return null;
  }

  moveTo(p, pid, no) {
    const why = this.hostOnly(p);
    if (why) return { ok: false, error: why };
    const x = this.members.get(String(pid));
    if (!x) return { ok: false, error: '없는 사람이에요' };
    return this.setTeam(x, no);
  }

  kick(p, pid) {
    const why = this.hostOnly(p);
    if (why) return { ok: false, error: why };
    const x = this.members.get(String(pid));
    if (!x) return { ok: false, error: '없는 사람이에요' };
    if (x.id === p.id) return { ok: false, error: '나 자신은 내보낼 수 없어요' };
    if (x.bot) return this.removeBot(p, x.id);
    const sock = this.socketOf(x);
    this.kicked.add(x.token);
    this.leave(x, sock);
    if (sock) {
      sock.emit('closed', { reason: 'room-kicked' });
      this.lobby.enter(x, sock);
    }
    return { ok: true };
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

  addBot(p, no) {
    const why = this.hostOnly(p);
    if (why) return { ok: false, error: why === '방장만 할 수 있어요' ? '방장만 봇을 넣을 수 있어요' : '게임 중에는 봇을 넣을 수 없어요' };
    if (this.members.size >= this.settings.max) return { ok: false, error: '방이 꽉 찼어요 (봇도 인원에 들어가요)' };
    let team = 0;
    if (this.battle) {
      team = Math.round(Number(no)) || this.emptiestTeam();
      if (!(team >= 1 && team <= this.settings.teams)) return { ok: false, error: '없는 팀이에요' };
      if (this.teamMembers(team).length >= this.settings.teamSize) return { ok: false, error: `${team}팀은 꽉 찼어요` };
    }
    const used = new Set([...this.members.values()].map(x => x.nick));
    const bot = makeBot(rollNick(used));
    bot.room = this;
    this.members.set(bot.id, bot);
    if (team) this.teamOf.set(bot.id, team);
    this.recheckAuto();
    this.changed();
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

  /** 대전방: 모든 팀을 가장 큰 팀 인원까지 봇으로 채운다 (한 팀만 있으면 상대 팀도 같은 인원으로) */
  fillBots(p) {
    const why = this.hostOnly(p);
    if (why) return { ok: false, error: why };
    if (!this.battle) return { ok: false, error: '대전방에서만 쓸 수 있어요' };
    const target = Math.max(1, this.biggestTeam());
    let added = 0;
    for (let no = 1; no <= this.settings.teams; no++) {
      while (this.teamMembers(no).length < target) {
        const r = this.addBot(p, no);
        if (!r.ok) return added ? { ok: true, added } : r;
        added += 1;
      }
    }
    return added ? { ok: true, added } : { ok: false, error: '이미 인원이 맞춰져 있어요' };
  }

  /** 협동방: 0.2초마다 봇을 한 걸음씩 (대전방은 TeamRound 가 움직인다) */
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

  /** 자동 시작 시계: 다른 사람이 한 명 이상 있고 모두 준비 + 시작 조건이 맞으면 15초, 아니면 멈춤 */
  recheckAuto() {
    const others = this.humans().some(p => p.id !== this.hostId);
    const go = this.phase === 'waiting' && others && this.startCheck().ok;
    if (go && !this.autoAt) this.autoAt = Date.now() + (this.lobby.autoStartMs == null ? AUTO_START_MS : this.lobby.autoStartMs);
    else if (!go) this.autoAt = 0;
  }

  start(p) {
    if (this.phase !== 'waiting') return { ok: false, error: '이미 시작했어요' };
    if (p.id !== this.hostId) return { ok: false, error: '방장만 시작할 수 있어요' };
    return this.begin();
  }

  begin() {
    const s = this.settings;
    const chk = this.startCheck();
    if (chk.why === 'rival') return { ok: false, error: '상대 팀이 없어요 — 다른 팀에도 사람이나 봇이 있어야 해요' };
    if (chk.why === 'ready') return { ok: false, error: `${chk.notReady}명이 아직 준비하지 않았어요` };
    const { codes, bosses } = this.lobby.problemsFor(s.tags);
    if (!codes.length) return { ok: false, error: '고른 태그에 문제가 없어요' };
    this.lastResult = null;
    this.autoAt = 0;
    this.phase = 'playing';
    const cd = this.lobby.countdownMs == null ? COUNTDOWN_MS : this.lobby.countdownMs;
    if (this.battle) {
      // 팀 채널 다시 맞추기 (대기실에서 팀을 옮겼을 수 있다)
      for (const x of this.members.values()) {
        const sock = this.socketOf(x);
        if (!sock) continue;
        for (let no = 1; no <= s.teams; no++) sock.leave(this.teamChannel(no));
        sock.join(this.teamChannel(this.teamOf.get(x.id)));
      }
      const teams = [];
      for (let no = 1; no <= s.teams; no++) if (this.teamMembers(no).length) teams.push(no);
      this.round = new TeamRound({ owner: this, teams, seed: randomSeed(), codes, bosses, countdownMs: cd });
      this.round.sendStandings(true);
    } else {
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
          countdownMs: cd,
        },
        onEnd: result => this.onEnd(result),
      });
      for (const m of this.members.values()) this.match.add(m);
      for (const m of this.members.values()) if (!m.bot) this.match.sendState(m);
      if (this.bots().length) this.botTimer = setInterval(() => this.stepBots(), 200);
    }
    this.changed();
    return { ok: true };
  }

  /** 경기 끝 — 협동방: Match 결과 · 대전방: TeamRound 결과(팀 순위) */
  onEnd(result) {
    this.stopBots();
    this.match = null;
    this.round = null;
    this.phase = 'waiting';
    this.lastResult = result;
    this.ready.clear();
    this.autoAt = 0;
    this.closeAt = Date.now() + (this.lobby.waitCloseMs || WAIT_CLOSE_MS);
    if (this.closed) return;
    const idle = this.battle ? result.teams.every(t => t.reason === 'idle' || t.reason === 'forfeit') && result.teams.some(t => t.reason === 'idle') : result.reason === 'idle';
    if (idle) { this.close('idle'); return; }
    this.emitAll(this.battle ? 'class:result' : 'result', result);
    this.changed();
  }

  /** 방 닫기: empty(모두 나감) / timeout(10분 미시작) / idle(게임 중 방치) */
  close(reason) {
    if (this.closed) return;
    this.closed = true;
    this.stopBots();
    if (this.match) { this.match.stop(); this.match = null; }
    if (this.round) { this.round.kill(); this.round = null; }
    for (const p of this.members.values()) {
      p.room = null;
      const sock = this.socketOf(p);
      if (sock) {
        sock.leave(this.channel);
        const no = this.teamOf.get(p.id);
        if (no) sock.leave(this.teamChannel(no));
        sock.emit('closed', { reason });
        this.lobby.enter(p, sock);
      }
    }
    this.members.clear();
    this.teamOf.clear();
    this.lobby.remove(this);
  }

  tick(now) {
    if (this.phase !== 'waiting') return;
    if (now >= this.closeAt) { this.close('timeout'); return; }
    // 방장 연결이 10초 넘게 끊겼으면 넘긴다
    const host = this.members.get(this.hostId);
    if (host && !host.online) {
      if (!this.hostOffSince) this.hostOffSince = now;
      else if (now - this.hostOffSince >= (this.lobby.hostOffMs == null ? HOST_OFF_MS : this.lobby.hostOffMs) && this.humans().some(x => x.id !== host.id && x.online)) {
        this.passHost();
        this.recheckAuto();
        this.changed();
      }
    } else this.hostOffSince = 0;
    if (this.autoAt && now >= this.autoAt) {
      this.autoAt = 0;
      const r = this.begin();
      if (!r.ok) this.changed();
    }
  }
}

module.exports = { Room, WAIT_CLOSE_MS, AUTO_START_MS };
