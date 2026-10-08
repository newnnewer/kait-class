'use strict';
// 경기 한 판 — 한 방(한 조)이 판 하나를 함께 채운다.
//   점유 → 타이핑 → 채점 · 보스 · 아이템 · 페널티 · 제한 시간 · 방치 경고
//   v0.7.0: 아이템은 잡은 사람의 개인 덱으로 (원할 때 사용) · 공격은 2초 뒤에 들어오고 방패로 직접 막음 · 집결 보스
// 방(rooms/room.js)이 시작할 때 만들고, 끝나면 onEnd(결과)로 알려 준다.

const { createBoard } = require('./board');
const { step, edge, corner, reverse } = require('../../public/js/shared/move');
const { isCorrect, isBossCorrect } = require('./grade');
const { rollItem, rollHelp, sample, MAX_SHIELD, DECK_SIZE, DEFEND_MS, ITEM_MS, FX_OF, POWER } = require('./items');
const { randomSeed, makeRng, shuffle } = require('../rng');

const MAX_INPUT = 200;
const IDLE_MS = 60000;      // 아무도 입력하지 않으면 경고까지
const IDLE_WARN_MS = 15000; // 경고 뒤 이만큼 더 없으면 방 종료
// 집결 보스 (v0.7.0): 접속 중인 사람이 3명 이상인 조에서 보스 차례 4번에 1번.
//   (n, 1) 또는 (n, 열-2) 에 나타나 8초 안에 모두가 바로 왼쪽·오른쪽 칸에서 Delete / Backspace 로 잡으면 성공 → 모두에게 도움 아이템
//   v0.12.0: 옆에 서 있기만 해서는 안 되고 각자 키로 잡는다. 잡은 사람은 자리를 떠나도 된다
const GATHER_MS = 8000; // v0.12.0: 5초 → 8초
const GATHER_MIN = 3;
const GATHER_EVERY = 4;

class Match {
  /**
   * io, channel: 알림을 보낼 곳 (방의 채널)
   * info: { id, name, tags } — 화면에 보여 줄 방 정보
   * codes: 출제할 일반 문제 코드, bosses: 보스 문제
   * s: { blocks, occMs, bossEveryMs, bossWaitMs, bossLimitMs, penalty, limitMs, idleMs?, idleWarnMs? }
   *    수업 게임: external(보스를 수업 게임이 정한 일정에 내보냄) · noIdle(방치 종료 없음) · keepEmpty(모두 나가도 계속)
   */
  constructor({ io, channel, info, codes, bosses, s, onEnd, seed }) {
    this.io = io;
    this.channel = channel;
    this.info = info || { id: 'x', name: '', tags: [] };
    this.codes = codes;
    this.bosses = bosses || [];
    this.shortCodes = codes.filter(c => c.length <= 6);
    if (!this.shortCodes.length) this.shortCodes = ['a = 1', 'f()', 'x += 1'];
    s = s || {};
    this.occLimitMs = s.occMs || 20000;
    this.bossEveryMs = s.bossEveryMs || 15000;
    this.bossWaitMs = s.bossWaitMs || 8000;
    this.bossLimitMs = s.bossLimitMs || 30000;
    this.penalty = s.penalty !== false;
    this.limitMs = s.limitMs || 10 * 60000;
    this.idleMs = s.idleMs || IDLE_MS;
    this.idleWarnMs = s.idleWarnMs || IDLE_WARN_MS;
    this.external = !!s.external;
    this.noIdle = !!s.noIdle;
    this.keepEmpty = !!s.keepEmpty;
    this.pausedAt = 0;         // 일시정지한 시각 (0 = 진행 중)
    // 방해 아이템 (수업 게임, 5-2): attacks = 켜짐 여부(교사 스위치, 게임 중에 바뀔 수 있음)
    //   onAttack(item, p) → 수업 게임이 대상 조를 골라 공격하고 { to, blocked } 를 돌려준다 (대상이 없으면 null)
    //   onEvent(e) → 전광판에 보낼 소식 (아이템 · 보스 격파)
    this.attacks = !!s.attacks;
    this.onAttack = s.onAttack || null;
    this.onEvent = s.onEvent || (() => {});
    this.atk = { sent: 0, got: 0, blocked: 0 };
    this.decks = new Map();    // player id → [아이템 | null] × 5 (개인 덱)
    this.shieldOf = new Map(); // player id → 방패 수 (최대 2)
    this.incoming = [];        // 들어오는 중인 공격 [{ id, item, fromNo, fromNick, until, done }]
    this.incomingSeq = 0;
    this.bossTurn = 0;         // 학생 방: 보스 차례 번호 (4번에 1번 집결 보스)
    this.itemSeq = 0;
    this.onEnd = onEnd || (() => {});

    this.pos = new Map();      // player id → {r, c}
    this.members = new Map();  // player id → player
    this.stats = new Map();    // player id → { solved, bosses }
    this.occ = new Map();      // 칸 번호 → { pid, until }  (점유)
    this.occBy = new Map();    // player id → 칸 번호
    this.bossQueue = [];
    this.ended = false;

    this.board = createBoard({ blocks: s.blocks || 96, seed: seed == null ? randomSeed() : seed, codes: this.codes });
    const now = Date.now();
    this.startedAt = now;
    this.endAt = now + this.limitMs;
    this.lastInput = now;
    this.idleWarn = false;
    this.boss = null;          // { i, q, phase: 'wait'|'fight', until, pid }
    this.nextBossAt = now + this.bossEveryMs;
    this.pendingBoss = -1;     // 미리 정해 둔 다음 보스 자리 (예전 레이더용 — v0.7.1 에서 레이더를 빼서 지금은 쓰지 않음)
    this.fx = { auto: 0, freeze: 0, confuse: 0, cloud: 0 }; // 효과가 끝나는 시각

    this.sweeper = setInterval(() => { try { this.sweep(); } catch (e) { console.error('[오류] sweep:', e); } }, 200);
    this.sweeper.unref();

    // 시작 카운트다운 (v0.7.6): 판을 보여 주되 s.countdownMs 동안 모든 시간 · 입력을 멈췄다가 푼다 (일시정지와 같은 방법)
    this.countdownUntil = 0;
    if (s.countdownMs > 0) {
      this.pausedAt = now;
      this.countdownUntil = now + s.countdownMs;
      this.countdownTimer = setTimeout(() => { this.countdownUntil = 0; this.resume(); }, s.countdownMs);
      this.countdownTimer.unref();
    }
  }

  // ── 판 ──

  /** 이동 규칙에 넘길 판 — 보스 칸은 들어갈 수 없다 */
  get view() {
    const b = this.board, boss = this.boss;
    return { cols: b.cols, rows: b.rows, solved: i => b.cells[i].solved, blocked: i => !!boss && boss.i === i };
  }

  randomPos() {
    const b = this.board;
    return { r: Math.floor(Math.random() * b.rows), c: Math.floor(Math.random() * b.cols) };
  }

  /** 남은 시간 — 일시정지 중에는 멈춘 순간 기준 */
  msLeft(t) { return Math.max(0, t - (this.pausedAt || Date.now())); }

  progress() {
    const cells = this.board.cells;
    return Math.round(cells.filter(c => c.solved).length / cells.length * 100);
  }

  snapshot(forId) {
    const b = this.board, boss = this.boss;
    return {
      room: this.info,
      board: {
        cols: b.cols, rows: b.rows,
        cells: b.cells.map(x => ({ code: x.code, solved: x.solved, boss: x.bossBy || null })),
      },
      players: [...this.members.values()].map(p => ({ ...this.pubOf(p), ...this.pos.get(p.id), solved: this.stat(p).solved })),
      occ: [...this.occ.entries()].map(([i, o]) => ({ i, by: o.pid })),
      boss: boss ? { i: boss.i, phase: boss.phase, by: boss.pid || null, ms: this.msLeft(boss.until), ...(boss.phase === 'gather' ? this.gatherInfo() : {}) } : null,
      fx: { auto: this.msLeft(this.fx.auto), freeze: this.msLeft(this.fx.freeze), confuse: this.msLeft(this.fx.confuse), cloud: this.msLeft(this.fx.cloud) },
      shields: this.shields,
      deck: forId ? this.deckMsg(forId) : null,
      incoming: this.incoming.filter(x => !x.done).map(x => this.incomingMsg(x)),
      limits: { occ: this.occLimitMs, boss: this.bossLimitMs, bossWait: this.bossWaitMs },
      endMs: this.msLeft(this.endAt),
      idle: this.idleWarn ? { ms: this.msLeft(this.lastInput + this.idleMs + this.idleWarnMs) } : null,
      paused: !!this.pausedAt && !this.countdownUntil,
      countdownMs: this.countdownUntil ? Math.max(0, this.countdownUntil - Date.now()) : 0,
      ended: this.ended,
      meId: forId,
    };
  }

  pubOf(p) { return { id: p.id, nick: p.nick, kind: p.kind, color: p.color, online: p.online, bot: !!p.bot }; }
  emitAll(ev, data) { this.io.to(this.channel).emit(ev, data); }
  emitTo(p, ev, data) { if (p.socketId) this.io.to(p.socketId).emit(ev, data); }
  feed(text, kind) { this.emitAll('feed', { text, kind: kind || 'info' }); }

  // ── 사람 ──

  /** 시작할 때 방에 있던 사람 넣기 */
  add(p) {
    this.members.set(p.id, p);
    if (!this.pos.has(p.id)) this.pos.set(p.id, this.randomPos());
    if (!this.stats.has(p.id)) this.stats.set(p.id, { solved: 0, bosses: 0 });
  }

  /** 게임 중에 들어온 사람 (수업 게임의 지각생 · 조 옮기기) — 보스 칸이 아닌 곳에 세운다 */
  join(p) {
    if (this.members.has(p.id)) { this.sendState(p); return; }
    let pos = this.randomPos();
    for (let k = 0; k < 20 && this.boss && pos.r * this.board.cols + pos.c === this.boss.i; k++) pos = this.randomPos();
    this.pos.set(p.id, pos);
    this.add(p);
    this.emitAll('player:join', { ...this.pubOf(p), ...pos });
    this.sendState(p);
  }

  /** 새로고침 등으로 다시 들어온 사람에게 지금 판을 보낸다 */
  sendState(p) { this.emitTo(p, 'state', this.snapshot(p.id)); }

  has(p) { return this.members.has(p.id); }

  leave(p) {
    if (!this.members.has(p.id)) return;
    this.release(p, 'leave');
    this.bossDrop(p, 'left');
    this.members.delete(p.id);
    this.pos.delete(p.id);
    this.emitAll('player:leave', { id: p.id });
    if (!this.members.size && !this.keepEmpty) this.finish('empty');
  }

  /** 연결이 끊기면 점유·보스 공략은 바로 푼다 (다른 사람이 쓸 수 있게) */
  setOnline(p) {
    if (!p.online) { this.release(p, 'offline'); this.bossDrop(p, 'left'); }
    this.emitAll('player:online', { id: p.id, online: p.online });
  }

  /** 누군가 키를 눌렀다 — 방치 경고를 풀어 준다 (봇은 치지 않는다: 사람이 모두 자리를 비우면 방치로 본다) */
  touch(p) {
    if (p && p.bot) return;
    this.lastInput = Date.now();
    if (this.idleWarn) { this.idleWarn = false; this.emitAll('idle', { warn: false }); }
  }

  // ── 일시정지 (수업 게임) — 모든 시계를 멈췄다가 멈춘 만큼 뒤로 민다 ──
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
    this.nextBossAt += d;
    for (const o of this.occ.values()) o.until += d;
    if (this.boss) this.boss.until += d;
    for (const x of this.incoming) x.until += d;
    for (const k of Object.keys(this.fx)) if (this.fx[k]) this.fx[k] += d;
    if (this.ended) return;
    this.emitAll('pause', { on: false, endMs: this.msLeft(this.endAt) });
  }

  frozen() { return Date.now() < this.fx.freeze; }
  busy(p) { return this.occBy.has(p.id) || (this.boss && this.boss.pid === p.id); }
  cellIndex(p) { const cur = this.pos.get(p.id); return cur ? cur.r * this.board.cols + cur.c : -1; }
  stat(p) { let s = this.stats.get(p.id); if (!s) { s = { solved: 0, bosses: 0 }; this.stats.set(p.id, s); } return s; }

  // ── 개인 덱 (v0.7.0) ──

  /** 조 전체 방패 수 (전광판·교사 화면용) */
  get shields() { let n = 0; for (const [id, k] of this.shieldOf) if (this.members.has(id)) n += k; return n; }
  deckOf(id) { let d = this.decks.get(id); if (!d) { d = new Array(DECK_SIZE).fill(null); this.decks.set(id, d); } return d; }
  deckMsg(id) {
    const attacksOn = this.attacks && !!this.onAttack;
    return {
      slots: this.deckOf(id).map(x => x && { id: x.id, name: x.name, desc: x.desc, kind: x.kind, off: x.kind === 'attack' && !attacksOn }),
      shields: this.shieldOf.get(id) || 0,
    };
  }
  sendDeck(p) { this.emitTo(p, 'deck', this.deckMsg(p.id)); }
  /** 방패를 가진 조원 (공격 경고에 이름을 보여 준다) */
  shieldHolders() { return [...this.members.values()].filter(q => (this.shieldOf.get(q.id) || 0) > 0).map(q => q.nick); }

  /** 덱에 아이템 넣기 — 방패는 따로 (최대 2). 자리가 없으면 false (아이템은 사라짐) */
  giveItem(p, item) {
    if (p.bot) return false;
    if (item.id === 'shield') {
      const n = this.shieldOf.get(p.id) || 0;
      if (n >= MAX_SHIELD) { this.emitTo(p, 'deck:full', { name: item.name, shield: true }); return false; }
      this.shieldOf.set(p.id, n + 1);
      this.sendDeck(p);
      this.emitAll('shield', { n: this.shields });
      return true;
    }
    const d = this.deckOf(p.id);
    const k = d.indexOf(null);
    if (k < 0) { this.emitTo(p, 'deck:full', { name: item.name }); return false; }
    d[k] = { uid: ++this.itemSeq, id: item.id, name: item.name, desc: item.desc, kind: item.kind };
    this.sendDeck(p);
    return true;
  }

  /**
   * 덱의 아이템 쓰기 (Ctrl+Shift+1~5). slot: 1~5
   * 폭탄·레이저는 쓰는 사람이 서 있는 칸 기준. 공격은 그 순간 바로 위 순위 조에게 (2초 뒤 들어감).
   */
  useItem(p, slot) {
    if (this.ended) return { ok: false, why: 'ended' };
    if (this.pausedAt) return { ok: false, why: 'paused' };
    this.touch(p);
    if (this.frozen()) return { ok: false, why: 'frozen' };
    const k = Number(slot) - 1;
    const d = this.deckOf(p.id);
    const item = Number.isInteger(k) && k >= 0 && k < DECK_SIZE ? d[k] : null;
    if (!item) return { ok: false, why: 'empty' };
    if (item.kind === 'attack') {
      if (!this.attacks || !this.onAttack) return { ok: false, why: 'attacks-off' };
      const r = this.onAttack(item, p);
      if (!r) return { ok: false, why: 'no-target' }; // 공격할 조가 없으면 아이템은 그대로
      d[k] = null;
      this.sendDeck(p);
      this.atk.sent += 1;
      this.emitAll('item', { id: item.id, name: item.name, desc: `${r.to}조에 ${item.name} 발사! (${item.desc})`, kind: 'attack', by: p.nick, to: r.to });
      this.feed(`${p.nick} → ${r.to}조 ${item.name}`, 'attack');
      return { ok: true, item: { id: item.id, name: item.name, kind: 'attack', to: r.to } };
    }
    d[k] = null;
    this.sendDeck(p);
    this.applyItem(item, p, this.cellIndex(p));
    return { ok: true, item: { id: item.id, name: item.name, kind: item.kind } };
  }

  // ── 공격 받기 · 막기 (v0.7.0: 2초 안에 방패를 가진 조원이 Ctrl+Shift+9) ──

  incomingMsg(x) {
    return { id: x.id, name: x.item.name, desc: x.item.desc, from: x.fromNo, fromNick: x.fromNick, ms: this.msLeft(x.until), holders: this.shieldHolders() };
  }

  /**
   * 다른 조의 방해가 온다 (수업 게임). 바로 맞지 않고 2초 기다린다.
   * done(blocked): 막았거나 맞았을 때 수업 게임에 알려 준다
   */
  receiveAttack(item, fromNo, fromNick, done) {
    const x = { id: ++this.incomingSeq, item, fromNo, fromNick, until: Date.now() + DEFEND_MS, done: false, cb: done || (() => {}) };
    this.incoming.push(x);
    this.emitAll('incoming', this.incomingMsg(x));
    return 'pending';
  }

  /** Ctrl+Shift+9: 들어오는 공격 중 가장 먼저 온 것을 내 방패로 막는다 (얼음 중에도 된다) */
  defend(p) {
    if (this.ended) return { ok: false, why: 'ended' };
    if (this.pausedAt) return { ok: false, why: 'paused' };
    this.touch(p);
    const x = this.incoming.find(y => !y.done);
    if (!x) return { ok: false, why: 'nothing' };
    const n = this.shieldOf.get(p.id) || 0;
    if (!n) return { ok: false, why: 'no-shield' };
    this.shieldOf.set(p.id, n - 1);
    this.sendDeck(p);
    x.done = true;
    this.incoming = this.incoming.filter(y => !y.done);
    this.atk.blocked += 1;
    this.emitAll('shield', { n: this.shields });
    this.emitAll('incoming:end', { id: x.id, blocked: true, by: p.nick });
    this.emitAll('item', { id: 'shield', name: '방패', desc: `${p.nick} 님이 ${x.fromNo}조의 ${x.item.name} 공격을 막았어요!`, kind: 'blocked', by: p.nick });
    this.feed(`${x.fromNo}조의 ${x.item.name} → ${p.nick} 방패로 막음!`, 'good');
    x.cb(true, p.nick);
    return { ok: true, blocked: x.item.name };
  }

  /** 2초가 지났는데 아무도 막지 않았다 → 맞는다 */
  hitBy(x) {
    x.done = true;
    const b = this.board, item = x.item;
    this.atk.got += 1;
    this.emitAll('incoming:end', { id: x.id, blocked: false });
    this.emitAll('item', { id: item.id, name: item.name, desc: `${x.fromNo}조의 공격! ${item.desc}`, kind: 'hit', by: `${x.fromNo}조 ${x.fromNick}` });
    this.feed(`${x.fromNo}조의 공격: ${item.name}`, 'bad');
    switch (item.id) {
      case 'ice': case 'cloud': case 'flip': this.startEffect(item.id); break;
      case 'revive': this.revive(POWER.revive, 'revive'); break;
      case 'shuffle': {
        // 보스 공략 중인 사람을 뺀 모든 조원을 무작위의 같은 한 칸으로 (점유 중이면 풀림)
        let pos = this.randomPos();
        for (let k = 0; k < 30 && this.boss && pos.r * b.cols + pos.c === this.boss.i; k++) pos = this.randomPos();
        this.moveAll(() => ({ r: pos.r, c: pos.c }), 'shuffle');
        break;
      }
    }
    x.cb(false);
  }

  // ── 이동 ──

  /** 방향키 / Ctrl+방향키 / Home / End / Ctrl+Home / Ctrl+End — 점유·공략 중이거나 얼음이면 움직이지 않는다 */
  move(p, msg) {
    if (this.ended) return;
    const cur = this.pos.get(p.id);
    if (!cur) return;
    this.touch(p);
    let to = cur;
    if (!this.busy(p) && !this.frozen() && !this.pausedAt) {
      if (msg.to === 'home' || msg.to === 'end') to = edge(this.view, cur, msg.to);
      else if (msg.to === 'first' || msg.to === 'last') to = corner(this.view, msg.to);
      else {
        const dir = Date.now() < this.fx.confuse ? reverse(msg.dir) : msg.dir;
        to = step(this.view, cur, dir, !!msg.ctrl);
      }
      this.pos.set(p.id, to);
    }
    // seq: 브라우저가 미리 움직인 것과 맞춰 보는 번호
    this.emitAll('pos', { id: p.id, r: to.r, c: to.c, seq: msg.seq });
  }

  // ── 일반 블록 점유 ──

  occupy(p) {
    if (this.ended) return { ok: false, why: 'ended' };
    if (this.pausedAt) return { ok: false, why: 'paused' };
    this.touch(p);
    if (this.frozen()) return { ok: false, why: 'frozen' };
    if (this.boss && this.boss.pid === p.id) return { ok: false, why: 'busy' };
    if (this.occBy.has(p.id)) return { ok: true, i: this.occBy.get(p.id), ms: this.msLeft(this.occ.get(this.occBy.get(p.id)).until) };
    const i = this.cellIndex(p);
    const cell = this.board.cells[i];
    if (!cell) return { ok: false, why: 'none' };
    if (cell.solved) return { ok: false, why: 'solved' };
    const o = this.occ.get(i);
    if (o) {
      const who = this.members.get(o.pid);
      return { ok: false, why: 'taken', by: who ? who.nick : '' };
    }
    this.occ.set(i, { pid: p.id, until: Date.now() + this.occLimitMs });
    this.occBy.set(p.id, i);
    this.emitAll('occ', { i, by: p.id });
    return { ok: true, i, ms: this.occLimitMs };
  }

  submit(p, text) {
    if (this.ended) return { ok: false, why: 'ended' };
    this.touch(p);
    const i = this.occBy.get(p.id);
    if (i === undefined) return { ok: false, why: 'not-occupying' };
    if (this.frozen()) return { ok: false, why: 'frozen' };
    if (this.pausedAt) return { ok: false, why: 'paused' };
    text = String(text == null ? '' : text).slice(0, MAX_INPUT);
    const cell = this.board.cells[i];
    if (isCorrect(text, cell.code)) {
      this.occ.delete(i);
      this.occBy.delete(p.id);
      this.emitAll('occ', { i, by: null });
      this.solveCells([i], p, { count: true });
      return { ok: true, correct: true, i };
    }
    this.release(p, 'wrong');
    return { ok: true, correct: false, i };
  }

  /** 점유 풀기 — why: esc / wrong / timeout / leave / offline */
  release(p, why) {
    const i = this.occBy.get(p.id);
    if (i === undefined) return;
    this.occ.delete(i);
    this.occBy.delete(p.id);
    if (why === 'timeout') this.emitTo(p, 'released', { i, why }); // 본인에게 먼저 알려야 안내가 뜬다
    this.emitAll('occ', { i, by: null, why });
  }

  /** 칸들을 해결로 (정답·아이템). extra.count: 개인 기록에 더함 */
  solveCells(list, p, extra) {
    for (const i of list) {
      const cell = this.board.cells[i];
      if (!cell || cell.solved) continue;
      cell.solved = true;
      cell.by = p ? p.id : null;
      if (extra && extra.boss && p) cell.bossBy = p.nick;
      if (p && extra && extra.count) { this.stat(p).solved += 1; this.emitAll('stat', { id: p.id, solved: this.stat(p).solved }); } // 왼쪽 '우리 팀' 막대 (v0.7.4)
      this.emitAll('cell', { i, solved: true, by: cell.by, boss: cell.bossBy || null, via: extra && extra.via });
    }
    this.checkClear();
  }

  // ── 보스 ──

  nextQuestion() {
    if (!this.bossQueue.length) this.bossQueue = shuffle(this.bosses, makeRng(randomSeed()));
    return this.bossQueue.pop();
  }

  /** 보스가 될 수 있는 칸: 미해결 · 점유 안 됨 · 아무도 서 있지 않음 */
  bossCandidates() {
    const standing = new Set([...this.pos.values()].map(q => q.r * this.board.cols + q.c));
    const out = [];
    this.board.cells.forEach((c, i) => { if (!c.solved && !this.occ.has(i) && !standing.has(i)) out.push(i); });
    return out;
  }

  bossOk(i) {
    if (i < 0) return false;
    const c = this.board.cells[i];
    if (!c || c.solved || this.occ.has(i)) return false;
    for (const q of this.pos.values()) if (q.r * this.board.cols + q.c === i) return false;
    return true;
  }

  // ── 집결 보스 (v0.7.0) ──

  /** 접속 중인 사람 (봇 · 연결 끊김 제외) */
  onlineHumans() { return [...this.members.values()].filter(q => !q.bot && q.online !== false); }

  /** 집결 보스 자리: (n, 1) 또는 (n, 열-2) 중 아무도 서 있지 않은 칸. pref: { r, side } 먼저 시도 */
  gatherSpot(pref) {
    const b = this.board, cols = b.cols;
    if (cols < 4) return -1;
    const standing = new Set([...this.pos.values()].map(q => q.r * cols + q.c));
    const ok = i => i >= 0 && i < b.cells.length && !standing.has(i) && !this.occ.has(i);
    const colOf = side => side === 1 ? cols - 2 : 1;
    if (pref) {
      const first = pref.r * cols + colOf(pref.side);
      if (pref.r < b.rows && ok(first)) return first;
      const other = pref.r * cols + colOf(1 - pref.side);
      if (pref.r < b.rows && ok(other)) return other;
    }
    const cand = [];
    for (let r = 0; r < b.rows; r++) for (const side of [0, 1]) { const i = r * cols + colOf(side); if (ok(i)) cand.push(i); }
    return cand.length ? cand[Math.floor(Math.random() * cand.length)] : -1;
  }

  /** 집결 보스를 낼 수 있으면 낸다 — 사람 3명 이상 · 보스 없음 · 자리가 있음 */
  spawnGather(pref) {
    if (this.boss || this.ended) return false;
    const need = this.onlineHumans().length;
    if (need < GATHER_MIN) return false;
    const i = this.gatherSpot(pref);
    if (i < 0) return false;
    this.boss = { i, phase: 'gather', until: Date.now() + GATHER_MS, pid: null, got: 0, grabbed: new Set() };
    this.emitAll('boss', { i, phase: 'gather', ms: GATHER_MS, ...this.gatherInfo() });
    this.feed('집결 보스 등장! 모두 보스 옆에서 Delete · Backspace 로 잡으세요', 'boss');
    this.checkGather();
    return true;
  }

  /** 지금 잡은 사람 수 / 잡아야 할 사람 수 (접속 중인 사람만) · ids: 잡은 사람 */
  gatherInfo() {
    const boss = this.boss;
    if (!boss || !boss.grabbed) return { got: 0, need: 0, ids: [] };
    const people = this.onlineHumans();
    const ids = people.filter(q => boss.grabbed.has(q.id)).map(q => q.id);
    return { got: ids.length, need: people.length, ids };
  }

  /** 집결 보스 잡기 (v0.12.0): 보스 바로 왼쪽 칸에서 Delete · 오른쪽 칸에서 Backspace */
  gatherGrab(p, key) {
    const boss = this.boss;
    if (this.frozen()) return { ok: false, why: 'frozen' };
    if (this.pausedAt) return { ok: false, why: 'paused' };
    if (this.busy(p)) return { ok: false, why: 'busy' };
    const cur = this.pos.get(p.id);
    if (!cur) return { ok: false, why: 'none' };
    const target = cur.r * this.board.cols + cur.c + (key === 'Delete' ? 1 : -1);
    const sameRow = Math.floor(target / this.board.cols) === cur.r;
    if (!sameRow || target !== boss.i) return { ok: false, why: key === 'Delete' ? 'left' : 'right' };
    boss.grabbed.add(p.id);
    const g = this.gatherInfo();
    this.checkGather();
    return { ok: true, gather: true, got: g.got, need: g.need };
  }

  /** 모두 잡았으면 바로 성공 (잡을 때마다 · 0.2초마다 확인 — 누가 나가면 남은 사람만으로) */
  checkGather() {
    const boss = this.boss;
    if (!boss || boss.phase !== 'gather' || this.ended || this.pausedAt) return;
    const g = this.gatherInfo();
    const key = g.ids.join(',') + '/' + g.need;
    if (key !== boss.gkey) { boss.gkey = key; boss.got = g.got; this.emitAll('gather', g); }
    if (g.need >= 1 && g.got >= g.need) this.gatherWin();
  }

  gatherWin() {
    const i = this.boss.i;
    this.boss = null;
    if (!this.external) this.nextBossAt = Date.now() + this.bossEveryMs;
    this.emitAll('boss', { i: -1, end: 'gather', at: i });
    this.feed('모두 잡았다! 조원 모두 도움 아이템 획득', 'good');
    this.onEvent({ type: 'gather' });
    const shield = this.attacks && !!this.onAttack;
    for (const q of this.onlineHumans()) {
      const item = rollHelp({ shield });
      const kept = this.giveItem(q, item);
      this.emitTo(q, 'item', { id: item.id, name: item.name, desc: kept ? '모두 잡았다! 내 덱에 들어갔어요' : '모두 잡았다! …하지만 덱이 가득 차서 사라졌어요', kind: 'gather', by: q.nick, lost: !kept });
    }
    const cell = this.board.cells[i];
    if (cell && !cell.solved) {
      cell.bossBy = '모두'; // 해결 + 왕관 (이름 자리에 '모두')
      this.itemSolve([i], null, 'gather');
    }
  }

  /** q: 수업 게임은 모든 조에 같은 문제를 넘겨준다 (없으면 이 판의 순서대로)
   *  gather: 수업 게임이 정한 집결 보스 차례 ({ r, side }) — 조건이 안 되면 보통 보스 */
  spawnBoss(q, gather) {
    if (this.boss || this.ended) return false;
    // 학생 방: 보스 차례 4번에 1번은 집결 보스 (레이더로 자리를 미리 보여 준 차례는 보통 보스)
    if (!this.external) {
      this.bossTurn += 1;
      if (this.bossTurn % GATHER_EVERY === 0 && this.pendingBoss < 0 && this.spawnGather()) return true;
    } else if (gather && this.pendingBoss < 0 && this.spawnGather(gather)) return true;
    if (!q && !this.bosses.length) return false;
    let i = this.pendingBoss;
    this.pendingBoss = -1;
    if (!this.bossOk(i)) {
      const cand = this.bossCandidates();
      if (!cand.length) { if (!this.external) this.nextBossAt = Date.now() + 2000; return false; }
      i = cand[Math.floor(Math.random() * cand.length)];
    }
    this.boss = { i, q: q || this.nextQuestion(), phase: 'wait', until: Date.now() + this.bossWaitMs, pid: null };
    this.emitAll('boss', { i, phase: 'wait', ms: this.bossWaitMs });
    return true;
  }

  /** Delete: 보스 왼쪽 칸에서 / Backspace: 보스 오른쪽 칸에서 */
  bossGrab(p, key) {
    if (this.ended) return { ok: false, why: 'ended' };
    this.touch(p);
    const boss = this.boss;
    if (boss && boss.phase === 'gather') return this.gatherGrab(p, key);
    if (!boss || boss.phase !== 'wait') return { ok: false, why: 'none' };
    if (this.frozen()) return { ok: false, why: 'frozen' };
    if (this.pausedAt) return { ok: false, why: 'paused' };
    if (this.busy(p)) return { ok: false, why: 'busy' };
    const cur = this.pos.get(p.id);
    if (!cur) return { ok: false, why: 'none' };
    const target = cur.r * this.board.cols + cur.c + (key === 'Delete' ? 1 : -1);
    const sameRow = Math.floor(target / this.board.cols) === cur.r;
    if (!sameRow || target !== boss.i) return { ok: false, why: key === 'Delete' ? 'left' : 'right' };
    boss.phase = 'fight';
    boss.pid = p.id;
    boss.until = Date.now() + this.bossLimitMs;
    this.emitAll('boss', { i: boss.i, phase: 'fight', by: p.id, ms: this.bossLimitMs });
    const q = boss.q;
    // 정답은 보내지 않는다
    return { ok: true, i: boss.i, side: key === 'Delete' ? 'left' : 'right', ms: this.bossLimitMs,
      q: { title: q.title, code: q.code, input: q.input, blank: q.code.includes('___') } };
  }

  bossSubmit(p, text) {
    if (this.ended) return { ok: false, why: 'ended' };
    this.touch(p);
    const boss = this.boss;
    if (!boss || boss.phase !== 'fight' || boss.pid !== p.id) return { ok: false, why: 'none' };
    if (this.frozen()) return { ok: false, why: 'frozen' };
    if (this.pausedAt) return { ok: false, why: 'paused' };
    text = String(text == null ? '' : text).slice(0, MAX_INPUT);
    const q = boss.q;
    if (!isBossCorrect(q, text)) {
      this.bossEnd('wrong', p);
      return { ok: true, correct: false }; // 정답은 알려 주지 않는다 (같은 보스가 다시 나오므로)
    }
    const i = boss.i;
    this.boss = null;
    if (!this.external) this.nextBossAt = Date.now() + this.bossEveryMs;
    this.stat(p).bosses += 1;
    this.emitAll('boss', { i: -1, end: 'win', at: i, by: p.id });
    this.feed(`${p.nick} 보스 "${q.title}" 격파!`, 'good');
    this.onEvent({ type: 'boss', nick: p.nick, title: q.title });
    const item = rollItem({ penalty: this.penalty, attacks: this.attacks && !!this.onAttack, force: process.env.FORCE_ITEM }); // FORCE_ITEM: 시험용
    if (item.kind === 'bad') {
      // 페널티는 덱에 넣지 않고 바로 (마지막 칸이면 판 완성은 그 뒤에)
      this.applyItem(item, p, i);
      this.solveCells([i], p, { boss: true, count: true });
      return { ok: true, correct: true, item: { id: item.id, name: item.name, kind: item.kind } };
    }
    // 도움 · 공격 · 방패 → 잡은 사람의 덱으로 (가득 차면 사라짐)
    const kept = this.giveItem(p, item);
    this.emitAll('item', { id: item.id, name: item.name, desc: kept ? `${p.nick} 님 덱에 들어갔어요` : `${p.nick} 님 덱이 가득 차서 사라졌어요`, kind: 'get', by: p.nick, lost: !kept });
    this.feed(`${p.nick} ${item.name} ${kept ? '획득' : '(덱이 가득 참)'}`, kept ? 'good' : 'muted');
    this.solveCells([i], p, { boss: true, count: true });
    return { ok: true, correct: true, item: { id: item.id, name: item.name, kind: item.kind, kept } };
  }

  /** 공략 중인 사람이 나가면 실패로 */
  bossDrop(p, why) {
    if (this.boss && this.boss.pid === p.id) { this.touch(p); this.bossEnd(why, p); }
  }

  /** 보스 끝 (승리 말고): wrong / timeout / giveup / left / escaped */
  bossEnd(why, p) {
    const boss = this.boss;
    if (!boss) return;
    this.boss = null;
    if (!this.external) this.nextBossAt = Date.now() + this.bossEveryMs;
    this.emitAll('boss', { i: -1, end: why, at: boss.i, by: p ? p.id : null });
    const msg = { wrong: '보스 공략 실패 (오답)', timeout: '보스 공략 실패 (시간 초과)', giveup: '보스 공략 포기', left: '보스 공략이 중단됐어요', escaped: '보스가 달아났어요', scattered: `집결 실패 — ${GATHER_MS / 1000}초 안에 모두 잡지 못했어요` }[why];
    if (msg) this.feed(msg, 'muted');
  }

  // ── 아이템 ──

  /**
   * 아이템으로 칸 해결 — 점유 중인 칸도 해결한다 (치던 사람의 말풍선은 닫히고 안내가 뜬다).
   * 아이템으로 푼 칸은 개인 기록(블록 수)에 세지 않는다.
   */
  itemSolve(list, p, via) {
    for (const i of list) {
      const o = this.occ.get(i);
      if (!o) continue;
      this.occ.delete(i);
      this.occBy.delete(o.pid);
      const who = this.members.get(o.pid);
      if (who) this.emitTo(who, 'released', { i, why: 'item', via });
      this.emitAll('occ', { i, by: null, why: 'item' });
    }
    this.solveCells(list, p, { via });
  }

  /** 서 있는 사람을 옮긴다 — 점유 중이면 풀고 (치던 글자는 사라짐), 보스 공략 중인 사람은 그대로 */
  moveAll(pickPos, why) {
    for (const q of this.members.values()) {
      if (this.boss && this.boss.pid === q.id) continue;
      if (this.occBy.has(q.id)) {
        const i = this.occBy.get(q.id);
        this.occ.delete(i);
        this.occBy.delete(q.id);
        this.emitTo(q, 'released', { i, why });
        this.emitAll('occ', { i, by: null, why });
      }
      const pos = pickPos(q);
      this.pos.set(q.id, pos);
      this.emitAll('pos', { id: q.id, r: pos.r, c: pos.c, seq: -1 });
    }
  }

  /** 시간 효과 (자동완성 · 자폭 · 혼란 · 얼음 · 먹구름 · 방향 반전) — 이미 걸려 있으면 다시 처음부터 */
  startEffect(itemId) {
    const key = FX_OF[itemId], ms = ITEM_MS[itemId];
    this.fx[key] = Date.now() + ms;
    this.emitAll('effect', { type: key, ms });
  }

  /** 되살리기 · 역풍: 해결한 칸 n개를 미해결로 (적으면 있는 만큼) */
  revive(n, via) {
    const b = this.board, done = [];
    b.cells.forEach((x, i) => { if (x.solved) done.push(i); });
    for (const i of sample(done, n)) {
      b.cells[i].solved = false;
      b.cells[i].bossBy = null;
      this.emitAll('cell', { i, solved: false, via });
    }
  }

  /** 아이템 효과. at: 기준 칸 (덱에서 쓰면 쓰는 사람이 서 있는 칸, 페널티는 보스 칸) — 지금 보스 칸은 건드리지 않는다 */
  applyItem(item, p, at) {
    const b = this.board, cols = b.cols, rows = b.rows;
    const bossI = this.boss ? this.boss.i : -1;
    const unsolved = i => i >= 0 && i < b.cells.length && i !== bossI && !b.cells[i].solved;
    this.emitAll('item', { id: item.id, name: item.name, desc: item.desc, kind: item.kind, by: p.nick });
    this.feed(`${item.kind === 'bad' ? '페널티' : '아이템'} ${item.name} (${p.nick})`, item.kind === 'bad' ? 'bad' : 'good');
    this.onEvent({ type: 'item', item: { id: item.id, name: item.name, kind: item.kind }, nick: p.nick });
    const r = Math.floor(at / cols), c = at % cols;
    switch (item.id) {
      case 'bomb': { // 둘레 8칸 모두 (점유 중인 칸도)
        const list = [];
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if ((dr || dc) && rr >= 0 && rr < rows && cc >= 0 && cc < cols) list.push(rr * cols + cc);
        }
        this.itemSolve(list.filter(unsolved), p, 'bomb');
        break;
      }
      case 'laser': { // 가로줄 남은 칸 모두
        const list = [];
        for (let k = 0; k < cols; k++) list.push(r * cols + k);
        this.itemSolve(list.filter(unsolved), p, 'laser');
        break;
      }
      case 'vlaser': { // 세로줄 남은 칸 모두
        const list = [];
        for (let k = 0; k < rows; k++) list.push(k * cols + c);
        this.itemSolve(list.filter(unsolved), p, 'vlaser');
        break;
      }
      case 'easy': { // 내 둘레 8칸 중 풀지 않았고 아무도 치고 있지 않은 칸 (v0.7.1)
        const list = [];
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc, i = rr * cols + cc;
          if ((dr || dc) && rr >= 0 && rr < rows && cc >= 0 && cc < cols && unsolved(i) && !this.occ.has(i)) list.push(i);
        }
        for (const i of list) {
          b.cells[i].code = this.shortCodes[Math.floor(Math.random() * this.shortCodes.length)];
          this.emitAll('code', { i, code: b.cells[i].code });
        }
        break;
      }
      case 'backfire': this.revive(POWER.backfire, 'backfire'); break;
      case 'auto': case 'freeze': case 'confuse': this.startEffect(item.id); break;
    }
  }

  // ── 시계 (0.2초마다) ──

  sweep() {
    if (this.ended || this.pausedAt) return;
    const now = Date.now();
    // 제한 시간
    if (now >= this.endAt) return this.finish('time');
    // 방치: 1분 동안 아무도 입력하지 않으면 15초 경고, 그래도 없으면 방 종료
    if (!this.noIdle && !this.idleWarn && now - this.lastInput > this.idleMs) {
      this.idleWarn = true;
      this.emitAll('idle', { warn: true, ms: this.idleWarnMs });
    }
    if (this.idleWarn && now - this.lastInput > this.idleMs + this.idleWarnMs) return this.finish('idle');
    // 들어오는 공격: 2초 안에 아무도 막지 않으면 맞는다
    if (this.incoming.length) {
      for (const x of this.incoming) if (!x.done && now >= x.until) this.hitBy(x);
      this.incoming = this.incoming.filter(x => !x.done);
      if (this.ended) return;
    }
    // 점유 시간
    for (const [, o] of this.occ) {
      if (now > o.until) { const p = this.members.get(o.pid); if (p) this.release(p, 'timeout'); }
    }
    const boss = this.boss;
    if (boss && boss.phase === 'gather') {
      this.checkGather();
      if (this.boss === boss && now > boss.until) this.bossEnd('scattered');
      return;
    }
    if (boss) {
      if (now > boss.until) {
        if (boss.phase === 'wait') this.bossEnd('escaped');
        else this.bossEnd('timeout', this.members.get(boss.pid));
      }
      return;
    }
    if (!this.external && now >= this.nextBossAt && this.members.size) this.spawnBoss();
  }

  checkClear() {
    if (!this.ended && this.board.cells.every(x => x.solved)) this.finish('clear');
  }

  /** 끝: clear(성공) / time(시간 초과) / idle(방치) / empty(모두 나감) / stop(교사가 끝냄) */
  finish(reason) {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.sweeper);
    clearTimeout(this.countdownTimer);
    const cells = this.board.cells;
    const solved = cells.filter(c => c.solved).length;
    const stats = this.stats;
    const players = [...this.members.values()].map(p => ({ ...this.pubOf(p), ...(stats.get(p.id) || { solved: 0, bosses: 0 }) }));
    let bosses = 0;
    for (const s of stats.values()) bosses += s.bosses;
    const result = {
      reason, success: reason === 'clear',
      ms: Date.now() - this.startedAt, limitMs: this.limitMs,
      solved, total: cells.length, bosses, atk: { ...this.atk },
      players: players.sort((a, b) => (b.solved + b.bosses * 3) - (a.solved + a.bosses * 3)),
    };
    this.onEnd(result);
  }

  stop() { this.ended = true; clearInterval(this.sweeper); clearTimeout(this.countdownTimer); }
}

module.exports = { Match, MAX_INPUT };
