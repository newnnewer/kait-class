'use strict';
// 플립 배틀 (0.16.0) — 두 팀(1 = 빨강 · 2 = 파랑)이 맵 하나를 같이 쓴다.
//   · 처음 맵은 반반이 되게 무작위로 섞는다. 블록에는 코드가 없고 색(팀)만 있다
//   · 상대 색 블록에서 Enter → 그때마다 새 코드(일반 블록 문제에서 무작위) → 다 치면 우리 색으로 뒤집힌다
//   · 먼저 Enter 를 누른 사람만 칠 수 있다(점유). 점유 시간이 지나면 풀린다. 우리 색 블록은 잡을 수 없다
//   · 클리어가 없다 — 게임 시간이 끝났을 때 우리 색 블록이 많은 팀이 이긴다 (같으면 무승부)
//     끝나는 순간 치고 있던 블록은 뒤집히지 않은 것으로 센다
//   · 놓은 블록(Esc · 오답 · 시간 초과)은 그 사람이 다른 블록을 뒤집기 전까지 다시 못 잡는다 — 긴 코드 피하기 막기
//   · 보스 · 아이템 없음 (첫 버전). 이동은 블록 러시와 같은 규칙 — '깬 블록' = 우리 색 블록
//
// FlipMatch 는 블록 러시의 Match 와 같은 이름의 함수(move · occupy · submit · release …)를 갖춰
// 소켓 처리(server/index.js) · 대기실(room.js) · 공식전(classgame.js)이 그대로 부를 수 있게 한다.
// FlipRound 는 TeamRound 와 같은 모양 — owner(공식전 · 팀 배틀 방)가 갖춰 줄 것도 같다.

const { step, edge, corner } = require('../../public/js/shared/move');
const { isCorrect } = require('./grade');
const { randomSeed, makeRng, shuffle } = require('../rng');
const { stepFlipBot } = require('../classes/bot');
const TEAMS = require('../../public/js/shared/teams');

const MAX_INPUT = 200;
const IDLE_MS = 60000;
const IDLE_WARN_MS = 15000;
const SNAP_MS = 5000; // 그래프 기록 간격 (블록 수 변화) — 사용자 결정 2026-10-22: 10초 → 5초

// ── 맵 크기 ── (숫자는 여기서 고친다)
const FLIP = {
  times: [3, 4, 5],                    // 게임 시간(분) — 고를 수 있는 값
  defMin: 4,
  perPerson: { 3: 5, 4: 6, 5: 7 },     // 자동 블록 수 = 전체 인원 × 이 값
  minBlocks: 40,
  maxBlocks: 320,
  ratio: 1.6,                          // 가로 : 세로 (화면 모양)
  minCols: 8, maxCols: 24,
};

/** 자동 블록 수 = 인원 × (3 · 4 · 5분 → 5 · 6 · 7), 40 ~ 320 */
function flipBlocks(people, limitMin) {
  const per = FLIP.perPerson[limitMin] || FLIP.perPerson[FLIP.defMin];
  return Math.max(FLIP.minBlocks, Math.min(FLIP.maxBlocks, Math.max(1, people) * per));
}

/**
 * 블록 수 → 맵 모양 { cols, rows, total } — 직사각형을 꽉 채운다 (total 은 blocks 보다 조금 많을 수 있음).
 * 가로 : 세로가 1.6 에 가깝고 남는 칸(total - blocks)이 적은 것 — 둘을 함께 따진다
 *   (남는 칸만 따지면 224 → 16 × 14 처럼 정사각형에 가까워져 넓은 화면에서 칸이 작아진다)
 */
function flipShape(blocks) {
  const n = Math.max(FLIP.minBlocks, Math.min(FLIP.maxBlocks, Math.round(Number(blocks)) || FLIP.minBlocks));
  const c0 = Math.round(Math.sqrt(n * FLIP.ratio));
  let best = null;
  for (let cols = c0 - 3; cols <= c0 + 3; cols++) {
    if (cols < FLIP.minCols || cols > FLIP.maxCols) continue;
    const rows = Math.ceil(n / cols);
    const waste = cols * rows - n, off = Math.abs(cols / rows - FLIP.ratio);
    const score = off + waste / n * 4;
    if (!best || score < best.score) best = { cols, rows, score };
  }
  return { cols: best.cols, rows: best.rows, total: best.cols * best.rows };
}

/** 처음 맵: 반반 무작위 (씨앗이 같으면 같은 맵) */
function createFlipBoard({ blocks, seed }) {
  const { cols, rows, total } = flipShape(blocks);
  const half = Math.floor(total / 2);
  const rng = makeRng(seed);
  const teams = shuffle(Array.from({ length: total }, (_, i) => (i < half ? 1 : 2)), rng);
  // 홀수면 남는 한 칸은 무작위 팀
  if (total % 2) teams[teams.indexOf(2)] = rng() < 0.5 ? 1 : 2;
  return { cols, rows, cells: teams.map(t => ({ t, by: null })), seed };
}

class FlipMatch {
  /**
   * channels: 알림을 보낼 곳 (두 팀 채널)
   * teamOf(p) → 1 | 2 (0 = 팀 없음)
   * s: { blocks, occMs, limitMs, countdownMs, idleMs, idleWarnMs, noIdle }
   */
  constructor({ io, channels, info, codes, s, teamOf, onEnd, seed }) {
    this.io = io;
    this.channels = channels;
    this.info = info || { id: 'x', name: '', tags: [] };
    this.codes = codes && codes.length ? codes : ['a = 1'];
    this.teamOf = teamOf;
    s = s || {};
    this.game = 'flip';
    this.occLimitMs = s.occMs || 20000;
    this.limitMs = s.limitMs || FLIP.defMin * 60000;
    this.idleMs = s.idleMs || IDLE_MS;
    this.idleWarnMs = s.idleWarnMs || IDLE_WARN_MS;
    this.noIdle = !!s.noIdle;
    this.onEnd = onEnd || (() => {});
    this.pausedAt = 0;
    this.ended = false;
    // 블록 러시와 같은 이름 (소켓 처리 · 교사 화면 · 비트가 그대로 읽는다) — 플립 배틀에는 보스 · 효과가 없다
    this.boss = null;
    this.fx = { auto: 0, freeze: 0, confuse: 0, cloud: 0 };
    this.shields = 0;

    this.pos = new Map();      // id → { r, c }
    this.members = new Map();  // id → player
    this.stats = new Map();    // id → { solved(뒤집은 수), bosses: 0 }
    this.occ = new Map();      // 블록 번호 → { pid, until, code }
    this.occBy = new Map();    // id → 블록 번호
    this.banned = new Map();   // id → 놓은 블록 번호 (다른 블록을 뒤집으면 풀림)

    this.seed = seed == null ? randomSeed() : seed;
    this.board = createFlipBoard({ blocks: s.blocks || FLIP.minBlocks, seed: this.seed });
    this.codeRng = makeRng((this.seed ^ 0x9e3779b9) >>> 0);
    this.lastCode = '';
    const now = Date.now();
    this.startedAt = now;
    this.endAt = now + this.limitMs;
    this.lastInput = now;
    this.idleWarn = false;

    this.sweeper = setInterval(() => { try { this.sweep(); } catch (e) { console.error('[오류] flip sweep:', e); } }, 200);
    this.sweeper.unref();

    this.countdownUntil = 0;
    if (s.countdownMs > 0) {
      this.pausedAt = now;
      this.countdownUntil = now + s.countdownMs;
      this.countdownTimer = setTimeout(() => { this.countdownUntil = 0; this.resume(); }, s.countdownMs);
      this.countdownTimer.unref();
    }
  }

  // ── 맵 ──

  /** 이동 규칙에 넘길 맵 — 보는 사람 기준: 우리 색 블록 = '깬 블록' (Ctrl+방향키가 건너뜀) */
  viewFor(p) {
    const b = this.board, t = this.teamOf(p);
    return { cols: b.cols, rows: b.rows, solved: i => b.cells[i].t === t, blocked: () => false };
  }

  /** 팀별 블록 수 [빨강, 파랑] */
  counts() {
    let a = 0, b = 0;
    for (const c of this.board.cells) { if (c.t === 1) a++; else b++; }
    return [a, b];
  }

  /** 진행률 자리 (로비 목록) — 이기고 있는 팀의 비율 */
  progress() {
    const [a, b] = this.counts();
    return Math.round(Math.max(a, b) / (a + b) * 100);
  }

  msLeft(t) { return Math.max(0, t - (this.pausedAt || Date.now())); }

  /** 비어 있는 자리 하나 (다른 사람과 겹치지 않게 몇 번 다시 뽑아 본다 — 처음 자리를 흩어지게) */
  randomPos() {
    const b = this.board;
    const used = new Set([...this.pos.values()].map(q => q.r * b.cols + q.c));
    let pos = null;
    for (let k = 0; k < 30; k++) {
      pos = { r: Math.floor(Math.random() * b.rows), c: Math.floor(Math.random() * b.cols) };
      if (!used.has(pos.r * b.cols + pos.c)) break;
    }
    return pos;
  }

  snapshot(forId) {
    const b = this.board;
    const me = forId ? this.members.get(forId) : null;
    const mine = forId != null ? this.occBy.get(forId) : undefined;
    const o = mine !== undefined ? this.occ.get(mine) : null;
    return {
      game: 'flip',
      room: this.info,
      board: { cols: b.cols, rows: b.rows, cells: b.cells.map(x => x.t).join('') },
      players: [...this.members.values()].map(p => ({ ...this.pubOf(p), ...this.pos.get(p.id), team: this.teamOf(p), solved: this.stat(p).solved })),
      occ: [...this.occ.entries()].map(([i, x]) => ({ i, by: x.pid })),
      mine: o ? { i: mine, code: o.code, ms: this.msLeft(o.until) } : null, // 새로고침해도 치던 코드를 이어서
      banned: forId != null && this.banned.has(forId) ? this.banned.get(forId) : -1,
      totalMs: this.limitMs,
      myTeam: me ? this.teamOf(me) : 0,
      counts: this.counts(),
      limits: { occ: this.occLimitMs },
      endMs: this.msLeft(this.endAt),
      idle: this.idleWarn ? { ms: this.msLeft(this.lastInput + this.idleMs + this.idleWarnMs) } : null,
      paused: !!this.pausedAt && !this.countdownUntil,
      countdownMs: this.countdownUntil ? Math.max(0, this.countdownUntil - Date.now()) : 0,
      ended: this.ended,
      meId: forId,
    };
  }

  pubOf(p) { return { id: p.id, nick: p.nick, kind: p.kind, color: p.color, online: p.online, bot: !!p.bot }; }
  emitAll(ev, data) { this.io.to(this.channels).emit(ev, data); } // 두 팀 채널 (socket.io 가 겹치는 연결은 한 번만 보냄)
  emitTo(p, ev, data) { if (p.socketId) this.io.to(p.socketId).emit(ev, data); }
  feed(text, kind) { this.emitAll('feed', { text, kind: kind || 'info' }); }
  stat(p) { let s = this.stats.get(p.id); if (!s) { s = { solved: 0, bosses: 0 }; this.stats.set(p.id, s); } return s; }

  // ── 사람 ──

  add(p) {
    this.members.set(p.id, p);
    if (!this.pos.has(p.id)) this.pos.set(p.id, this.randomPos());
    this.stat(p);
  }

  /** 게임 중에 들어온 사람 (공식전: 교사가 팀을 정해 줌 · 팀 옮기기) */
  join(p) {
    if (this.members.has(p.id)) { this.sendState(p); return; }
    const pos = this.randomPos();
    this.pos.set(p.id, pos);
    this.add(p);
    this.emitAll('player:join', { ...this.pubOf(p), ...pos, team: this.teamOf(p) });
    this.sendState(p);
  }

  sendState(p) { this.emitTo(p, 'state', this.snapshot(p.id)); }
  has(p) { return this.members.has(p.id); }

  leave(p) {
    if (!this.members.has(p.id)) return;
    this.release(p, 'leave');
    this.members.delete(p.id);
    this.pos.delete(p.id);
    this.emitAll('player:leave', { id: p.id });
  }

  setOnline(p) {
    if (!p.online) this.release(p, 'offline');
    this.emitAll('player:online', { id: p.id, online: p.online });
  }

  touch(p) {
    if (p && p.bot) return;
    this.lastInput = Date.now();
    if (this.idleWarn) { this.idleWarn = false; this.emitAll('idle', { warn: false }); }
  }

  // ── 일시정지 (공식전) · 시작 카운트다운 ──
  pause() {
    if (this.ended || this.pausedAt) return;
    this.pausedAt = Date.now();
    this.emitAll('pause', { on: true });
  }

  resume() {
    if (!this.pausedAt) return;
    const d = Date.now() - this.pausedAt;
    this.pausedAt = 0;
    this.endAt += d;
    this.startedAt += d;
    this.lastInput += d;
    for (const o of this.occ.values()) o.until += d;
    if (this.ended) return;
    this.emitAll('pause', { on: false, endMs: this.msLeft(this.endAt) });
  }

  frozen() { return false; }
  busy(p) { return this.occBy.has(p.id); }
  cellIndex(p) { const cur = this.pos.get(p.id); return cur ? cur.r * this.board.cols + cur.c : -1; }

  // ── 이동 ──

  move(p, msg) {
    if (this.ended) return;
    const cur = this.pos.get(p.id);
    if (!cur) return;
    this.touch(p);
    let to = cur;
    if (!this.busy(p) && !this.pausedAt) {
      const v = this.viewFor(p);
      if (msg.to === 'home' || msg.to === 'end') to = edge(v, cur, msg.to);
      else if (msg.to === 'first' || msg.to === 'last') to = corner(v, msg.to);
      else to = step(v, cur, msg.dir, !!msg.ctrl);
      this.pos.set(p.id, to);
    }
    this.emitAll('pos', { id: p.id, r: to.r, c: to.c, seq: msg.seq });
  }

  // ── 점유 · 뒤집기 ──

  /** 새 코드 하나 (바로 앞에 낸 코드와는 다르게) */
  pickCode() {
    const list = this.codes;
    let code = list[Math.floor(this.codeRng() * list.length)];
    if (list.length > 1 && code === this.lastCode) code = list[(list.indexOf(code) + 1) % list.length];
    this.lastCode = code;
    return code;
  }

  occupy(p) {
    if (this.ended) return { ok: false, why: 'ended' };
    if (this.pausedAt) return { ok: false, why: 'paused' };
    this.touch(p);
    const team = this.teamOf(p);
    if (!team) return { ok: false, why: 'none' };
    if (this.occBy.has(p.id)) {
      const i = this.occBy.get(p.id), o = this.occ.get(i);
      return { ok: true, i, ms: this.msLeft(o.until), code: o.code };
    }
    const i = this.cellIndex(p);
    const cell = this.board.cells[i];
    if (!cell) return { ok: false, why: 'none' };
    if (cell.t === team) return { ok: false, why: 'own' }; // 우리 색 블록
    if (this.banned.get(p.id) === i) return { ok: false, why: 'again' }; // 방금 놓은 블록
    const o = this.occ.get(i);
    if (o) {
      const who = this.members.get(o.pid);
      return { ok: false, why: 'taken', by: who ? who.nick : '' };
    }
    const code = this.pickCode();
    this.occ.set(i, { pid: p.id, until: Date.now() + this.occLimitMs, code });
    this.occBy.set(p.id, i);
    this.emitAll('occ', { i, by: p.id });
    return { ok: true, i, ms: this.occLimitMs, code };
  }

  submit(p, text) {
    if (this.ended) return { ok: false, why: 'ended' };
    this.touch(p);
    const i = this.occBy.get(p.id);
    if (i === undefined) return { ok: false, why: 'not-occupying' };
    if (this.pausedAt) return { ok: false, why: 'paused' };
    text = String(text == null ? '' : text).slice(0, MAX_INPUT);
    const o = this.occ.get(i);
    if (isCorrect(text, o.code)) {
      this.occ.delete(i);
      this.occBy.delete(p.id);
      this.emitAll('occ', { i, by: null });
      this.flip(i, p);
      return { ok: true, correct: true, i };
    }
    this.release(p, 'wrong');
    return { ok: true, correct: false, i };
  }

  /** 블록 하나를 p 의 팀 색으로 */
  flip(i, p) {
    const cell = this.board.cells[i];
    const team = this.teamOf(p);
    if (!cell || !team || cell.t === team) return;
    cell.t = team;
    cell.by = p.id;
    this.banned.delete(p.id); // 뒤집었으니 놓았던 블록도 다시 잡을 수 있다
    const st = this.stat(p);
    st.solved += 1;
    this.emitAll('stat', { id: p.id, solved: st.solved });
    this.emitAll('cell', { i, t: team, by: p.id, counts: this.counts() });
  }

  /** 점유 풀기 — why: esc / wrong / timeout / leave / offline */
  release(p, why) {
    const i = this.occBy.get(p.id);
    if (i === undefined) return;
    this.occ.delete(i);
    this.occBy.delete(p.id);
    if (why === 'esc' || why === 'wrong' || why === 'timeout') this.banned.set(p.id, i);
    if (why === 'timeout') this.emitTo(p, 'released', { i, why });
    this.emitAll('occ', { i, by: null, why });
  }

  // 블록 러시에만 있는 것 — 소켓으로 와도 아무 일 없게
  bossGrab() { return { ok: false, why: 'none' }; }
  bossSubmit() { return { ok: false, why: 'none' }; }
  bossDrop() {}
  useItem() { return { ok: false, why: 'none' }; }
  defend() { return { ok: false, why: 'none' }; }
  spawnBoss() {}

  // ── 시계 (0.2초마다) ──

  sweep() {
    if (this.ended || this.pausedAt) return;
    const now = Date.now();
    if (now >= this.endAt) return this.finish('time');
    if (!this.noIdle && !this.idleWarn && now - this.lastInput > this.idleMs) {
      this.idleWarn = true;
      this.emitAll('idle', { warn: true, ms: this.idleWarnMs });
    }
    if (this.idleWarn && now - this.lastInput > this.idleMs + this.idleWarnMs) return this.finish('idle');
    for (const [, o] of this.occ) {
      if (now > o.until) { const p = this.members.get(o.pid); if (p) this.release(p, 'timeout'); }
    }
  }

  /** 끝: time / idle / stop(교사) / forfeit(한 팀이 모두 나감 — loser 팀 번호) */
  finish(reason, loser) {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.sweeper);
    clearTimeout(this.countdownTimer);
    // 치고 있던 블록은 뒤집히지 않은 것으로 (점유만 푼다)
    this.occ.clear();
    this.occBy.clear();
    const counts = this.counts();
    let winner = counts[0] > counts[1] ? 1 : counts[1] > counts[0] ? 2 : 0;
    if (reason === 'forfeit' && loser) winner = loser === 1 ? 2 : 1;
    const players = [...this.members.values()].map(p => ({ ...this.pubOf(p), team: this.teamOf(p), ...this.stat(p) }));
    this.onEnd({ reason, loser: loser || 0, winner, counts, total: this.board.cells.length, ms: Date.now() - this.startedAt, limitMs: this.limitMs, players });
  }

  stop() { this.ended = true; clearInterval(this.sweeper); clearTimeout(this.countdownTimer); }
}

class FlipRound {
  /** owner: 공식전(ClassGame) · 팀 배틀 방(Room) — TeamRound 와 같은 것을 갖춰 준다. 팀은 늘 1(빨강) · 2(파랑) */
  constructor({ owner, seed, codes, countdownMs }) {
    const s = owner.settings;
    this.owner = owner;
    this.io = owner.io;
    this.game = 'flip';
    this.seed = seed == null ? randomSeed() : seed;
    this.codes = codes;
    const people = owner.teamMembers(1).length + owner.teamMembers(2).length;
    this.blocks = flipShape(s.blocks || flipBlocks(people, s.limitMin)).total;
    this.limitMs = s.limitMin * 60000;
    this.startedAt = Date.now();
    this.pausedAt = 0;
    this.pausedMs = 0;
    this.stopped = false;
    this.finished = false;
    this.results = new Map(); // TeamRound 와 같은 이름 (교사 화면이 읽음) — 플립 배틀은 끝날 때 한꺼번에
    this.history = [];        // [{ t: 흐른 ms, c: [빨강 블록 수, 파랑 블록 수] }] — SNAP_MS(5초)마다
    this.nextSnap = 0;
    this.lastStandKey = '';
    this.countdownUntil = 0;
    if (countdownMs > 0) {
      this.pausedAt = Date.now();
      this.countdownUntil = Date.now() + countdownMs;
      this.countdownTimer = setTimeout(() => {
        if (!this.countdownUntil) return;
        this.countdownUntil = 0;
        if (this.pausedAt) { this.pausedMs += Date.now() - this.pausedAt; this.pausedAt = 0; }
        owner.changed();
      }, countdownMs);
      this.countdownTimer.unref();
    }
    this.match = new FlipMatch({
      io: this.io, channels: [owner.teamChannel(1), owner.teamChannel(2)], seed: this.seed,
      info: { id: owner.label, name: s.game === 'flip' ? '플립 배틀' : '', tags: s.tags, mode: owner.mode, game: 'flip' },
      codes,
      s: {
        blocks: this.blocks,
        occMs: s.occSec * 1000,
        limitMs: this.limitMs,
        idleMs: owner.idleMs, idleWarnMs: owner.idleWarnMs, noIdle: !!owner.noIdle,
        countdownMs: this.countdownUntil ? Math.max(0, this.countdownUntil - Date.now()) : 0,
      },
      teamOf: p => { const no = owner.teamOf.get(p.id) || 0; return no === 1 || no === 2 ? no : 0; },
      onEnd: r => this.matchEnded(r),
    });
    // 두 팀이 같은 판 — 팀 번호로 찾아도 같은 판이 나온다 (owner.matchOf · 교사 화면)
    this.matches = new Map([[1, this.match], [2, this.match]]);
    for (const no of [1, 2]) for (const p of owner.teamMembers(no)) this.match.add(p);
    for (const no of [1, 2]) for (const p of owner.teamMembers(no)) this.match.sendState(p);
    this.timer = setInterval(() => { try { this.tick(); } catch (e) { console.error('[오류] flip tick:', e); } }, 200);
    this.timer.unref();
  }

  elapsed() {
    const now = Date.now();
    return now - this.startedAt - this.pausedMs - (this.pausedAt ? now - this.pausedAt : 0);
  }
  remainMs() { return Math.max(0, this.limitMs - this.elapsed()); }
  isPaused() { return !!(this.pausedAt && !this.countdownUntil); }

  ensureMatch() { return this.match; }
  sendDone() {}
  gatherSpotFor() { return { r: 0, side: 0 }; }
  attack() { return null; }
  setAttacks() {}
  tl(no) { return TEAMS.label(this.owner.names, no); }

  tick() {
    if (this.pausedAt || this.finished) return;
    const o = this.owner, m = this.match;
    const taken = new Set();
    for (const bot of o.bots()) {
      if (!m.has(bot) || m.ended) continue;
      try { stepFlipBot(bot, m, o.settings.botSpeed, taken); } catch (e) { console.error('[오류] flip bot:', e); }
    }
    const el = this.elapsed();
    if (el >= this.nextSnap) { this.snap(el); this.nextSnap += SNAP_MS; }
    this.sendStandings();
    if (o.onRoundTick) o.onRoundTick();
  }

  snap(el) {
    this.history.push({ t: Math.round(el), c: this.match.counts() });
    if (this.history.length > 400) this.history.shift();
  }

  /** 상황판 — 팀마다 블록 수 (블록 러시의 standings 와 같은 칸 이름도 채운다: solved · total · pct) */
  standings() {
    const counts = this.match.counts(), total = counts[0] + counts[1];
    const lead = counts[0] > counts[1] ? 1 : counts[1] > counts[0] ? 2 : 0;
    return [1, 2].map(no => {
      const n = counts[no - 1];
      return { no, game: 'flip', count: this.owner.teamMembers(no).length, blocks: n, solved: n, total, pct: Math.round(n / total * 100), lead: lead === no, rank: null, done: false };
    });
  }

  sendStandings(force) {
    const st = this.standings();
    const key = JSON.stringify(st);
    if (!force && key === this.lastStandKey) return;
    this.lastStandKey = key;
    for (const ch of this.owner.standingsTo()) this.io.to(ch).emit('standings', st);
  }

  /** 지금 순위 (이기고 있는 팀 먼저) */
  rankOrder() { const c = this.match.counts(); return c[1] > c[0] ? [2, 1] : [1, 2]; }

  /** 한 팀이 모두 나감 → 그 팀 기권, 상대 팀 승 */
  forfeit(no) { if (!this.match.ended) this.match.finish('forfeit', no); }

  pause(on) {
    if (this.countdownUntil) return { ok: false, error: '시작 카운트다운 중이에요 — 잠시 뒤에 눌러 주세요' };
    if (on && !this.pausedAt) {
      this.pausedAt = Date.now();
      this.match.pause();
    } else if (!on && this.pausedAt) {
      this.pausedMs += Date.now() - this.pausedAt;
      this.pausedAt = 0;
      this.match.resume();
    }
    return { ok: true, paused: !!this.pausedAt };
  }

  /** 교사 '게임 종료' — 지금 블록 수로 승패 */
  stop() {
    if (this.countdownUntil) { clearTimeout(this.countdownTimer); this.countdownUntil = 0; }
    if (this.pausedAt) { this.pausedMs += Date.now() - this.pausedAt; this.pausedAt = 0; this.match.countdownUntil = 0; this.match.resume(); }
    this.stopped = true;
    if (!this.match.ended) this.match.finish('stop');
  }

  kill() {
    this.finished = true;
    clearInterval(this.timer);
    clearTimeout(this.countdownTimer);
    this.match.stop();
  }

  /** 판이 끝남 → 결과를 owner.onRoundEnd 로 (모양은 블록 러시 팀 대전 결과와 맞춤 + game · winner · counts) */
  matchEnded(r) {
    if (this.finished) return;
    this.kill();
    const endT = Math.round(Math.min(this.elapsed(), this.limitMs));
    const hist = this.history.filter(h => h.t < endT);
    hist.push({ t: endT, c: r.counts.slice() });
    const teams = [1, 2].map(no => {
      const n = r.counts[no - 1];
      const out = r.reason === 'forfeit' && r.loser === no;
      const players = r.players.filter(p => p.team === no);
      return {
        no, game: 'flip', clear: false, out,
        reason: out ? 'forfeit' : r.reason,
        rank: r.winner === 0 || r.winner === no ? 1 : 2,
        win: r.winner === no, blocks: n, solved: n, total: r.total, pct: Math.round(n / r.total * 100), ms: endT,
        bosses: 0, atk: { sent: 0, got: 0, blocked: 0 },
        members: players.sort((a, b) => b.solved - a.solved).map(p => ({ nick: p.nick, kind: p.kind, color: p.color, solved: p.solved, bosses: 0, bot: !!p.bot })),
        bots: players.filter(p => p.bot).length,
      };
    }).sort((a, b) => a.rank - b.rank || a.no - b.no);
    for (const t of teams) this.results.set(t.no, t);
    const result = {
      game: 'flip',
      code: this.owner.label, mode: this.owner.mode, startedAt: this.startedAt, endedAt: Date.now(),
      reason: this.stopped ? 'stop' : r.reason, winner: r.winner, counts: r.counts,
      limitMs: this.limitMs, blocks: r.total, ms: endT, teams, history: hist, snapMs: SNAP_MS,
      names: (this.owner.names || []).slice(),
    };
    if (this.owner.onRoundEnd) this.owner.onRoundEnd(result);
  }
}

module.exports = { FlipMatch, FlipRound, FLIP, SNAP_MS, flipBlocks, flipShape, createFlipBoard, MAX_INPUT };
