'use strict';
// 수업방 하나 — 교사가 만들고, 학생은 방 코드(숫자 4자리)로 들어와 팀을 고른다.
//   · 방 코드와 팀 편성은 교사가 '수업 끝내기'를 누를 때까지 유지 → 여러 판을 이어서 할 수 있다
//   · 한 판(round): 팀마다 판(Match) 하나. 모든 팀이 같은 씨앗 → 같은 배치 · 같은 문제 순서
//   · 보스: "게임 시작부터 N초마다" 모든 팀에 같은 문제. 그 차례에 보스가 남아 있는 팀은 한 번 건너뜀
//   · 순위: 판을 완성한 순서 → 시간이 끝나면(또는 교사가 끝내면) 남은 팀은 해결률 순
//   · 일시정지: 모든 팀의 입력과 모든 시계가 멈춘다
//   · 게임 중에도 들어오거나 팀을 옮길 수 있다 (지각생)

const { TeamRound } = require('../game/teamround');
const { recommendBlocks } = require('../game/board');
const { randomSeed, makeRng, shuffle } = require('../rng');
const { rollNick } = require('../nick');
const { makeBot } = require('./bot');
const CHAT = require('../../public/js/shared/chat');

const MAX_BOTS = 40; // 수업방 하나에 넣을 수 있는 봇 수

class ClassGame {
  constructor({ hub, code, settings }) {
    this.hub = hub;
    this.io = hub.io;
    this.code = code;
    this.settings = settings;
    this.chatLog = [];         // 팀 선택 화면 채팅 최근 8개 (v0.7.3)
    this.teamLock = false;     // v0.12.0: 교사가 팀 선택을 잠금 (학생은 팀을 못 고름 · 교사는 옮길 수 있음)
    this.channel = 'class:' + code;
    this.teachChannel = 'teach:' + code;
    this.boardChannel = 'board:' + code; // 전광판
    this.lastBoardAt = 0;
    this.members = new Map();  // id → player (들어온 순서)
    this.teamOf = new Map();   // id → 팀 번호 (0 = 아직 안 고름)
    this.kicked = new Set();   // 강퇴한 브라우저 열쇠
    this.phase = 'waiting';    // waiting | playing
    this.round = null;
    this.lastResult = null;
    this.createdAt = Date.now();
    this.lastActive = Date.now();
    this.closed = false;
    this.sendTimer = null;
    this.lastStandKey = '';
  }

  isClass() { return true; }
  pubOf(p) { return { id: p.id, nick: p.nick, kind: p.kind, color: p.color, online: p.online, bot: !!p.bot }; }
  bots() { return [...this.members.values()].filter(p => p.bot); }
  teamChannel(no) { return this.channel + ':t' + no; }
  socketOf(p) { return this.hub.socketOf(p); }
  touch() { this.lastActive = Date.now(); }

  teamMembers(no) { return [...this.members.values()].filter(p => this.teamOf.get(p.id) === no); }

  // ── 시간 (일시정지를 뺀 흐른 시간) ──
  elapsed() { return this.round ? this.round.elapsed() : 0; }
  remainMs() { return this.round ? this.round.remainMs() : 0; }

  // ── 공용 팀 대전(TeamRound)이 쓰는 것 ──
  get label() { return this.code; }
  get mode() { return 'class'; }
  get noIdle() { return true; }
  teamCount() { return this.settings.teams; }
  attacksOn() { return this.settings.attacks !== false; }
  standingsTo() { return [this.channel, this.teachChannel]; }

  // ── 알림 ──

  /** 학생 화면에 보내는 정보 */
  detail() {
    const s = this.settings;
    return {
      code: this.code, phase: this.phase, paused: !!(this.round && this.round.pausedAt && !this.round.countdownUntil),
      teams: Array.from({ length: s.teams }, (_, k) => ({ no: k + 1, members: this.teamMembers(k + 1).map(p => this.pubOf(p)) })),
      waiting: this.teamMembers(0).length,
      teamLock: this.teamLock,
      settings: { tags: s.tags, limitMin: s.limitMin },
      sfx: s.sfx !== false,
      remainMs: this.remainMs(),
      chat: this.chatLog,
    };
  }

  // ── 대기실 채팅 (v0.7.3): 정해 둔 문구만 · 게임 중에는 안 됨 · 한 사람 2초에 한 번 ──
  say(p, id) {
    if (this.matchOf(p)) return { ok: false, why: 'playing' };
    const x = CHAT.find(String(id || ''), 'class');
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

  /** 교사 화면에 보내는 정보 */
  teacherDetail() {
    const s = this.settings;
    const stateOf = (p) => {
      if (!p.online) return 'off';
      if (p.bot && !this.matchOf(p)) return 'bot';
      const m = this.matchOf(p);
      if (!m) return this.phase === 'playing' && this.teamOf.get(p.id) ? 'wait' : 'on';
      if (m.boss && m.boss.pid === p.id) return 'boss';
      if (m.occBy.has(p.id)) return 'typing';
      return 'play';
    };
    const person = p => ({ ...this.pubOf(p), state: stateOf(p) });
    const biggest = Math.max(0, ...Array.from({ length: s.teams }, (_, k) => this.teamMembers(k + 1).length));
    return {
      code: this.code, phase: this.phase, paused: !!(this.round && this.round.pausedAt),
      settings: s,
      teams: Array.from({ length: s.teams }, (_, k) => ({ no: k + 1, members: this.teamMembers(k + 1).map(person) })),
      unassigned: this.teamMembers(0).map(person),
      teamLock: this.teamLock,
      count: this.members.size,
      blocksNow: s.blocks || recommendBlocks(Math.max(1, biggest)),
      blocks: this.round ? this.round.blocks : null,
      remainMs: this.remainMs(),
      bots: this.bots().length, maxBots: MAX_BOTS,
      standings: this.standings(),
      result: this.lastResult,
      allowRooms: this.hub.allowRooms,
    };
  }

  /** 여러 번 불려도 0.15초에 한 번만 보낸다 */
  changed() {
    if (this.sendTimer || this.closed) return;
    this.sendTimer = setTimeout(() => {
      this.sendTimer = null;
      if (this.closed) return;
      this.io.to(this.channel).emit('class', this.detail());
      this.io.to(this.teachChannel).emit('teach', this.teacherDetail());
      this.sendBoard();
    }, 150);
    this.sendTimer.unref();
  }

  /** 팀별 상황판 (게임 전에는 들어온 팀만) */
  standings() {
    if (this.round) return this.round.standings();
    const out = [];
    for (let no = 1; no <= this.settings.teams; no++) {
      const count = this.teamMembers(no).length;
      if (count) out.push({ no, count, solved: 0, total: 0, pct: 0, rank: null, done: false });
    }
    return out;
  }

  sendStandings(force) {
    if (this.round) { this.round.sendStandings(force); return; }
    const st = this.standings();
    const key = JSON.stringify(st);
    if (!force && key === this.lastStandKey) return;
    this.lastStandKey = key;
    for (const ch of this.standingsTo()) this.io.to(ch).emit('standings', st);
  }

  // ── 학생: 들어오기 · 팀 고르기 · 나가기 ──

  join(p, socket) {
    if (this.closed) return { ok: false, error: '끝난 수업방이에요' };
    if (this.kicked.has(p.token)) return { ok: false, error: '이 수업방에는 다시 들어갈 수 없어요' };
    this.members.set(p.id, p);
    if (!this.teamOf.has(p.id)) this.teamOf.set(p.id, 0);
    p.room = this;
    socket.leave('lobby');
    socket.join(this.channel);
    this.changed();
    this.hub.lobby.changed();
    return { ok: true, cls: this.detail() };
  }

  pickTeam(p, no) {
    if (this.teamLock) return { ok: false, error: '선생님이 팀 선택을 잠갔어요' };
    no = Math.round(Number(no));
    if (!(no >= 1 && no <= this.settings.teams)) return { ok: false, error: '없는 팀이에요' };
    this.setTeam(p, no);
    return { ok: true };
  }

  /** 팀 바꾸기 (학생이 고르거나 교사가 옮김). 게임 중이면 판도 옮긴다 */
  setTeam(p, no) {
    const old = this.teamOf.get(p.id) || 0;
    if (old === no) return;
    const sock = this.socketOf(p);
    const r = this.round;
    if (old) {
      if (r && r.matches.get(old)) r.matches.get(old).leave(p);
      if (sock) sock.leave(this.teamChannel(old));
    }
    this.teamOf.set(p.id, no);
    if (no) {
      if (sock) sock.join(this.teamChannel(no));
      if (r) {
        const m = this.ensureMatch(no);
        m.join(p); // 판을 보내 준다
        this.sendDone(no, p);
      }
    } else if (r && sock) {
      sock.emit('class:bench', {}); // 게임 중에 팀에서 빠짐 → 팀 선택 화면으로
    }
    this.touch();
    this.changed();
    this.sendStandings();
  }

  leave(p, socket) {
    if (!this.members.has(p.id)) return;
    const no = this.teamOf.get(p.id) || 0;
    const m = this.matchOf(p);
    if (m) m.leave(p);
    this.members.delete(p.id);
    this.teamOf.delete(p.id);
    p.room = null;
    if (socket) { socket.leave(this.channel); if (no) socket.leave(this.teamChannel(no)); }
    this.changed();
    this.sendStandings();
  }

  /** 새로고침·재접속: 있던 곳(팀 선택 화면 또는 경기)으로 되돌려 보낸다 */
  resend(p, socket) {
    socket.leave('lobby');
    socket.join(this.channel);
    const no = this.teamOf.get(p.id) || 0;
    if (no) socket.join(this.teamChannel(no));
    socket.emit('class', this.detail());
    socket.emit('standings', this.standings());
    const m = this.matchOf(p);
    if (m) {
      m.setOnline(p);
      m.sendState(p);
      this.sendDone(no, p);
    } else if (this.round && no) {
      // 판이 있어야 할 사람인데 없으면 (끊긴 사이에 빠졌으면) 다시 넣는다
      this.ensureMatch(no).join(p);
      this.sendDone(no, p);
    }
    this.changed();
  }

  offline(p) {
    const m = this.matchOf(p);
    if (m) m.setOnline(p);
    this.changed();
  }

  matchOf(p) {
    const no = this.teamOf.get(p.id);
    const m = no && this.round ? this.round.matches.get(no) : null;
    return m && m.has(p) ? m : null;
  }

  /** 학생은 시작할 수 없다 (교사 화면에서만) */
  start() { return { ok: false, error: '수업방은 선생님이 시작해요' }; }

  // ── 교사 ──

  updateSettings(s) {
    if (this.phase !== 'waiting') return { ok: false, error: '게임 중에는 설정을 바꿀 수 없어요' };
    this.settings = s;
    // 팀 수를 줄였으면 없어진 팀의 학생은 '팀 미선택'으로
    for (const p of this.members.values()) {
      const no = this.teamOf.get(p.id);
      if (no > s.teams) {
        const sock = this.socketOf(p);
        if (sock) sock.leave(this.teamChannel(no));
        this.teamOf.set(p.id, 0);
      }
    }
    this.touch();
    this.changed();
    return { ok: true };
  }

  /** 팀을 안 고른 학생을 사람이 적은 팀부터 채워 넣는다 */
  autoAssign() {
    const n = this.settings.teams;
    for (const p of this.teamMembers(0)) {
      let best = 1;
      for (let no = 2; no <= n; no++) if (this.teamMembers(no).length < this.teamMembers(best).length) best = no;
      this.setTeam(p, best);
    }
    return { ok: true };
  }

  /** v0.12.0: 팀 선택 잠그기 / 풀기 */
  setTeamLock(on) {
    this.teamLock = !!on;
    this.touch();
    this.changed();
    return { ok: true, on: this.teamLock };
  }

  /** v0.12.0: 학생(팀 미선택 포함)을 무작위로 섞어 고르게 나눈다. 봇은 제자리 — 봇까지 센 인원이 고르게 */
  shuffleTeams() {
    if (this.phase !== 'waiting') return { ok: false, error: '게임 중에는 섞을 수 없어요' };
    const n = this.settings.teams;
    const people = shuffle([...this.members.values()].filter(p => !p.bot), makeRng(randomSeed()));
    if (!people.length) return { ok: false, error: '들어온 학생이 없어요' };
    const size = new Map();
    for (let no = 1; no <= n; no++) size.set(no, this.teamMembers(no).filter(p => p.bot).length);
    // 먼저 모두 미선택으로 (채널 · 판 정리는 setTeam 이 한다)
    for (const p of people) this.setTeam(p, 0);
    for (const p of people) {
      let best = [], min = Infinity;
      for (let no = 1; no <= n; no++) {
        const k = size.get(no);
        if (k < min) { min = k; best = [no]; } else if (k === min) best.push(no);
      }
      const no = best[Math.floor(Math.random() * best.length)];
      size.set(no, min + 1);
      this.setTeam(p, no);
    }
    return { ok: true };
  }

  move(pid, no) {
    const p = this.members.get(String(pid));
    if (!p) return { ok: false, error: '없는 학생이에요' };
    no = Math.round(Number(no));
    if (!(no >= 0 && no <= this.settings.teams)) return { ok: false, error: '없는 팀이에요' };
    this.setTeam(p, no);
    return { ok: true };
  }

  kick(pid) {
    const p = this.members.get(String(pid));
    if (!p) return { ok: false, error: '없는 학생이에요' };
    if (p.bot) return this.removeBot(p.id);
    const sock = this.socketOf(p);
    this.kicked.add(p.token);
    this.leave(p, sock);
    if (sock) {
      sock.emit('closed', { reason: 'kicked' });
      this.hub.lobby.enter(p, sock);
    }
    this.touch();
    return { ok: true };
  }

  // ── 봇 (팀 인원 맞추기) ──

  /** no 팀에 봇 한 명 */
  addBot(no) {
    no = Math.round(Number(no));
    if (!(no >= 1 && no <= this.settings.teams)) return { ok: false, error: '없는 팀이에요' };
    if (this.bots().length >= MAX_BOTS) return { ok: false, error: `봇은 ${MAX_BOTS}명까지 넣을 수 있어요` };
    const used = new Set([...this.hub.nicks(), ...[...this.members.values()].map(p => p.nick)]);
    const bot = makeBot(rollNick(used));
    bot.room = this;
    this.members.set(bot.id, bot);
    this.teamOf.set(bot.id, 0);
    this.setTeam(bot, no);
    return { ok: true, id: bot.id };
  }

  removeBot(id) {
    const p = this.members.get(String(id));
    if (!p || !p.bot) return { ok: false, error: '없는 봇이에요' };
    this.leave(p, null);
    this.touch();
    return { ok: true };
  }

  /** 모든 팀을 가장 큰 팀 인원까지 봇으로 채운다 */
  fillBots() {
    const n = this.settings.teams;
    const size = no => this.teamMembers(no).length;
    let target = 0;
    for (let no = 1; no <= n; no++) target = Math.max(target, size(no));
    if (!target) return { ok: false, error: '팀을 고른 학생이 없어요' };
    let added = 0;
    for (let no = 1; no <= n; no++) {
      // v0.7.6: 아무도 없는 팀도 채운다 (예전에는 건너뜀 → 사람이 1팀에만 있으면 '이미 맞춰져 있음'이 됐음)
      while (size(no) < target) {
        const r = this.addBot(no);
        if (!r.ok) return added ? { ok: true, added, error: r.error } : r;
        added += 1;
      }
    }
    return { ok: true, added };
  }

  /** 수업방에서 봇을 모두 뺀다 */
  clearBots() {
    for (const b of this.bots()) this.leave(b, null);
    this.touch();
    return { ok: true };
  }

  begin(opts) {
    if (this.phase !== 'waiting') return { ok: false, error: '이미 진행 중이에요' };
    const s = this.settings;
    const { codes, bosses } = this.hub.problemsFor(s.tags);
    if (!codes.length) return { ok: false, error: '고른 태그에 문제가 없어요' };
    const teams = [];
    for (let no = 1; no <= s.teams; no++) if (this.teamMembers(no).length) teams.push(no);
    if (!teams.length) return { ok: false, error: '팀을 고른 학생이 없어요' };
    const seed = (opts && opts.seed != null) ? opts.seed >>> 0 : randomSeed();
    this.lastResult = null;
    this.phase = 'playing';
    const cd = this.hub.countdownMs == null ? 5000 : this.hub.countdownMs;
    this.round = new TeamRound({ owner: this, teams, seed, codes, bosses, countdownMs: cd });
    this.touch();
    this.changed();
    this.sendStandings(true);
    return { ok: true };
  }

  ensureMatch(no) { return this.round.ensureMatch(no); }
  gatherSpotFor(turn) { return this.round.gatherSpotFor(turn); }
  sendDone(no, p) { if (this.round) this.round.sendDone(no, p); }
  tick() { if (this.round) this.round.tick(); }
  rankOrder() { return this.round ? this.round.rankOrder() : []; }
  attack(fromNo, item, p, to) { return this.round ? this.round.attack(fromNo, item, p, to) : null; }

  /** 0.2초마다 (TeamRound) — 전광판은 0.5초마다 */
  onRoundTick() { if (Date.now() - this.lastBoardAt >= 500) this.sendBoard(); }

  /** 판에서 생긴 소식 → 전광판 */
  onRoundEvent(type, d) {
    const board = this.io.to(this.boardChannel);
    if (type === 'attack') { board.emit('board:attack', d); return; }
    if (type === 'clear') { board.emit('board:feed', { text: `${d.no}팀 CLEAR! ${d.rank}위`, kind: 'clear' }); return; }
    if (type !== 'match') return;
    const no = d.no, e = d.e;
    let text = null, kind = 'info';
    if (e.type === 'boss') { text = `${no}팀 ${e.nick} 보스 격파!`; kind = 'boss'; }
    else if (e.type === 'gather') { text = `${no}팀 모두 잡았다! (집결 보스)`; kind = 'good'; }
    else if (e.type === 'item') { text = `${no}팀 ${e.item.kind === 'bad' ? '페널티' : '아이템'} ${e.item.name}`; kind = e.item.kind === 'bad' ? 'bad' : 'good'; }
    if (text) board.emit('board:feed', { text, kind });
  }

  /** 소리 (6-2): 학생 효과음 · 전광판 배경음 켜고 끄기 — 게임 중에도 바로 */
  setSound(m) {
    const next = { ...this.settings };
    if (typeof m.sfx === 'boolean') next.sfx = m.sfx;
    if (typeof m.bgm === 'boolean') next.bgm = m.bgm;
    this.settings = next;
    this.touch();
    this.changed();
    return { ok: true, sfx: next.sfx !== false, bgm: next.bgm !== false };
  }

  // ── 방해 아이템 (5-2) ──

  /** 방해 아이템 켜기/끄기 — 게임 중에도 바로 적용 */
  setAttacks(on) {
    this.settings = { ...this.settings, attacks: !!on };
    if (this.round) this.round.setAttacks(on);
    this.io.to(this.boardChannel).emit('board:feed', { text: `방해 아이템 ${on ? '켜짐' : '꺼짐'}`, kind: 'info' });
    this.touch();
    this.changed();
    return { ok: true, attacks: !!on };
  }

  // ── 전광판 ──

  /** 전광판에 보여 줄 모든 것 (팀마다 작은 판 · 효과 · 방패) */
  boardState() {
    const r = this.round, s = this.settings, now = Date.now();
    const teams = [];
    for (let no = 1; no <= s.teams; no++) {
      const members = this.teamMembers(no).map(p => this.pubOf(p));
      const t = { no, members };
      const m = r && r.matches.get(no);
      if (m) {
        const cells = m.board.cells;
        let solved = 0;
        // 칸 하나 = 글자 하나: 0 미해결 · 1 해결 · 2 보스 해결 · B 보스 · O 점유
        t.cells = cells.map((c, i) => {
          if (c.solved) { solved += 1; return c.bossBy ? '2' : '1'; }
          if (m.boss && m.boss.i === i) return 'B';
          return m.occ.has(i) ? 'O' : '0';
        }).join('');
        const res = r.results.get(no);
        const left = k => Math.max(0, m.fx[k] - (m.pausedAt || now));
        Object.assign(t, {
          solved, total: cells.length, pct: Math.round(solved / cells.length * 100),
          rank: res && res.clear ? res.rank : null, done: !!res, ms: res ? res.ms : null,
          fx: { freeze: left('freeze'), cloud: left('cloud'), confuse: left('confuse'), auto: left('auto') },
          shields: m.shields,
        });
      }
      teams.push(t);
    }
    return {
      code: this.code, phase: this.phase, paused: !!(r && r.pausedAt && !r.countdownUntil), remainMs: this.remainMs(),
      countdownMs: r && r.countdownUntil ? Math.max(0, r.countdownUntil - now) : 0,
      limitMs: r ? r.limitMs : s.limitMin * 60000, attacks: s.attacks !== false, bgm: s.bgm !== false,
      teams, waiting: this.teamMembers(0).length, result: this.phase === 'waiting' ? this.lastResult : null,
      history: r ? r.history : null, elapsedMs: r ? Math.round(this.elapsed()) : 0,
    };
  }

  sendBoard() {
    this.lastBoardAt = Date.now();
    const room = this.io.sockets && this.io.sockets.adapter && this.io.sockets.adapter.rooms.get(this.boardChannel);
    if (room && !room.size) return; // 보는 전광판이 없으면 만들지 않는다
    this.io.to(this.boardChannel).emit('board', this.boardState());
  }

  pause(on) {
    const r = this.round;
    if (!r) return { ok: false, error: '진행 중인 게임이 없어요' };
    const res = r.pause(on);
    if (!res.ok) return res;
    this.io.to(this.channel).emit('class:pause', { on: !!r.pausedAt });
    this.touch();
    this.changed();
    return res;
  }

  /** 교사가 '게임 종료' — 남은 팀은 해결률 순 */
  stop() {
    if (!this.round) return { ok: false, error: '진행 중인 게임이 없어요' };
    this.round.stop();
    return { ok: true };
  }

  /** 한 판이 끝남 (TeamRound) → 기록 저장 · 결과 보내기 */
  onRoundEnd(result) {
    try {
      result.id = this.hub.db.saveGame({ code: this.code, startedAt: result.startedAt, endedAt: result.endedAt, reason: result.reason, settings: this.settings, result });
    } catch (e) { console.error('[저장소] 게임 기록 저장 실패:', e.message); }
    this.round = null;
    this.phase = 'waiting';
    this.lastResult = result;
    this.touch();
    this.io.to(this.channel).emit('class:result', result);
    this.io.to(this.teachChannel).emit('class:result', result);
    this.io.to(this.boardChannel).emit('class:result', result);
    this.changed();
  }

  /** 수업 끝내기 (교사) / 오래 쓰지 않아 자동으로 닫힘 */
  close(reason) {
    if (this.closed) return;
    const r = this.round;
    if (r) { r.kill(); this.round = null; }
    this.closed = true;
    for (const p of [...this.members.values()]) {
      const no = this.teamOf.get(p.id) || 0;
      p.room = null;
      const sock = this.socketOf(p);
      if (sock) {
        sock.leave(this.channel);
        if (no) sock.leave(this.teamChannel(no));
        sock.emit('closed', { reason: reason === 'idle' ? 'class-idle' : 'class' });
        this.hub.lobby.enter(p, sock);
      }
    }
    this.members.clear();
    this.teamOf.clear();
    this.io.to(this.teachChannel).emit('teach:closed', { code: this.code, reason });
    this.io.to(this.boardChannel).emit('teach:closed', { code: this.code, reason });
    this.hub.remove(this);
  }
}

module.exports = { ClassGame };
