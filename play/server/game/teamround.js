'use strict';
// 팀 대전 한 판 (v0.13.0) — 수업방과 학생 대전방이 함께 쓴다.
//   · 팀마다 판(Match) 하나. 모든 팀이 같은 씨앗 → 같은 배치 · 같은 문제 순서
//   · 보스: "게임 시작부터 N초마다" 모든 팀에 같은 문제. 그 차례에 보스가 남아 있는 팀은 한 번 건너뜀
//   · 순위: 판을 완성한 순서 → 시간이 끝나면(또는 끝내면) 남은 팀은 해결률 순 → 기권한 팀은 맨 아래
//   · 방해 아이템: 다른 팀을 고른다 (0 = 바로 위 순위 팀)
//   · 일시정지(수업방만): 모든 팀의 입력과 모든 시계가 멈춘다
//
// owner(수업방 ClassGame · 학생 대전방 Room)가 갖춰 줄 것:
//   io, channel, settings, mode('class' | 'battle'), label(코드 · 방 id)
//   teamChannel(no), teamMembers(no), bots(), matchOf(p), socketOf(p), teamCount(), attacksOn()
//   standingsTo(): standings 를 보낼 채널 목록 · changed()
//   선택: noIdle(true 면 방치 종료 없음) · onRoundEvent(type, data) · onRoundTick() · onRoundEnd(result)

const { Match } = require('./match');
const { recommendBlocks } = require('./board');
const { randomSeed, makeRng, shuffle } = require('../rng');
const { stepBot } = require('../classes/bot');

const RANK_SNAP_MS = 10000; // 순위 변동 그래프 기록 간격
const OUT_REASONS = ['forfeit', 'idle']; // 이렇게 끝난 팀은 맨 아래 (완성 · 시간 끝이 아님)

class TeamRound {
  /**
   * teams: 판을 만들 팀 번호들 · seed: 씨앗 · codes/bosses: 문제 · countdownMs: 시작 카운트다운
   */
  constructor({ owner, teams, seed, codes, bosses, countdownMs }) {
    const s = owner.settings;
    this.owner = owner;
    this.io = owner.io;
    const biggest = Math.max(1, ...teams.map(no => owner.teamMembers(no).length));
    this.seed = seed;
    this.codes = codes;
    this.bosses = bosses;
    this.blocks = s.blocks || recommendBlocks(biggest);
    this.limitMs = s.limitMin * 60000;
    this.startedAt = Date.now();
    this.pausedAt = 0;
    this.pausedMs = 0;
    this.matches = new Map();
    this.results = new Map();
    this.clearCount = 0;
    this.stopped = false;
    this.finished = false;
    this.bossQueue = shuffle(bosses, makeRng((seed ^ 0x5bd1e995) >>> 0));
    this.bossPos = 0;
    this.everyMs = s.bossEverySec * 1000;
    this.nextSlot = this.everyMs; // 흐른 시간 기준 다음 보스 차례
    this.countdownUntil = 0;
    this.history = [];            // 순위 기록 (순위 변동 그래프) — [{ t: 흐른 ms, order: [1위 팀, 2위 팀, …] }]
    this.nextSnap = 0;
    this.lastStandKey = '';
    // 시작 카운트다운: 그동안 모든 시계를 멈춰 둔다 (일시정지 가림막 없이, 판마다 카운트다운 화면)
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
    for (const no of teams) this.ensureMatch(no);
    this.timer = setInterval(() => { try { this.tick(); } catch (e) { console.error('[오류] team tick:', e); } }, 200);
    this.timer.unref();
  }

  // ── 시간 (일시정지를 뺀 흐른 시간) ──
  elapsed() {
    const now = Date.now();
    return now - this.startedAt - this.pausedMs - (this.pausedAt ? now - this.pausedAt : 0);
  }
  remainMs() { return Math.max(0, this.limitMs - this.elapsed()); }
  isPaused() { return !!(this.pausedAt && !this.countdownUntil); }

  /** 팀의 판 — 없으면 같은 씨앗으로 만든다 (게임 중에 처음 사람이 들어온 팀도 같은 판) */
  ensureMatch(no) {
    let m = this.matches.get(no);
    if (m) return m;
    const o = this.owner, s = o.settings;
    m = new Match({
      io: this.io, channel: o.teamChannel(no), seed: this.seed,
      info: { id: o.label, name: `${no}팀`, tags: s.tags, mode: o.mode, team: no },
      codes: this.codes, bosses: this.bosses,
      s: {
        blocks: this.blocks,
        occMs: s.occSec * 1000,
        bossEveryMs: this.everyMs,
        bossWaitMs: s.bossWaitSec * 1000,
        bossLimitMs: s.bossLimitSec * 1000,
        penalty: s.penalty,
        limitMs: Math.max(1000, this.remainMs()),
        idleMs: o.idleMs, idleWarnMs: o.idleWarnMs,
        external: true, noIdle: !!o.noIdle, keepEmpty: true,
        countdownMs: this.countdownUntil ? Math.max(0, this.countdownUntil - Date.now()) : 0,
        attacks: o.attacksOn(),
        onAttack: (item, p, to) => this.attack(no, item, p, to),
        onEvent: e => this.event(no, e),
      },
      onEnd: result => this.teamEnded(no, result),
    });
    m.nextBossAt = Date.now() + Math.max(0, this.nextSlot - this.elapsed());
    this.matches.set(no, m);
    for (const p of o.teamMembers(no)) m.add(p);
    for (const p of o.teamMembers(no)) m.sendState(p);
    if (this.pausedAt && !this.countdownUntil) m.pause();
    return m;
  }

  /** 집결 보스 자리 (모든 팀 같게): 몇 번째 줄 · 왼쪽(1열)/오른쪽(열-2) */
  gatherSpotFor(turn) {
    const rng = makeRng(((this.seed ^ 0x27d4eb2d) + turn * 2654435761) >>> 0);
    const rows = Math.ceil(this.blocks / 12);
    return { r: Math.floor(rng() * rows), side: rng() < 0.5 ? 0 : 1 };
  }

  /** 판을 완성한 팀에게 "N위 완성!" (게임 중에 그 팀으로 들어온 사람에게도) */
  sendDone(no, p) {
    const res = this.results.get(no);
    if (!res) return;
    const payload = { rank: res.clear ? res.rank : null, ms: res.ms, clear: res.clear, reason: res.reason };
    if (p) { const sock = this.owner.socketOf(p); if (sock) sock.emit('team:done', payload); }
    else this.io.to(this.owner.teamChannel(no)).emit('team:done', payload);
  }

  tick() {
    if (this.pausedAt || this.finished) return;
    const o = this.owner;
    // 봇 움직이기 (판마다 다른 봇이 노리는 칸은 피한다)
    const taken = new Map();
    for (const bot of o.bots()) {
      const m = o.matchOf(bot);
      if (!m || m.ended) continue;
      if (!taken.has(m)) taken.set(m, new Set());
      try { stepBot(bot, m, o.settings.botSpeed, taken.get(m)); } catch (e) { console.error('[오류] bot:', e); }
    }
    const el = this.elapsed();
    // 보스 차례: 모든 팀에 같은 문제. 아직 보스가 남아 있는 팀은 건너뛴다
    if (this.bossQueue.length) {
      let fired = false;
      while (el >= this.nextSlot) {
        const q = this.bossQueue[this.bossPos % this.bossQueue.length];
        this.bossPos += 1;
        // 4번에 1번은 집결 보스 — 모든 팀에 같은 줄 · 같은 쪽 (씨앗으로 정함). 3명 미만 팀은 보통 보스
        const gather = this.bossPos % 4 === 0 ? this.gatherSpotFor(this.bossPos) : null;
        for (const m of this.matches.values()) if (!m.ended) m.spawnBoss(q, gather);
        this.nextSlot += this.everyMs;
        fired = true;
      }
      if (fired) {
        const at = Date.now() + (this.nextSlot - el);
        for (const m of this.matches.values()) m.nextBossAt = at; // 레이더가 쓰는 시각
      }
    }
    // 순위 기록: 10초마다 (일시정지 · 카운트다운 동안은 흐른 시간이 멈추므로 기록도 멈춤)
    if (el >= this.nextSnap) { this.snapRanks(el); this.nextSnap += RANK_SNAP_MS; }
    this.sendStandings();
    if (o.onRoundTick) o.onRoundTick();
  }

  // ── 순위 ──

  /** 팀별 상황판 — 팀마다 해결률 · 완성 순위 */
  standings() {
    const o = this.owner, out = [];
    for (let no = 1; no <= o.teamCount(); no++) {
      const m = this.matches.get(no);
      const count = o.teamMembers(no).length;
      if (!m) { out.push({ no, count, solved: 0, total: this.blocks, pct: 0, rank: null, done: false }); continue; }
      const total = m.board.cells.length;
      const solved = m.board.cells.filter(c => c.solved).length;
      const res = this.results.get(no);
      out.push({ no, count, solved, total, pct: Math.round(solved / total * 100), rank: res && res.clear ? res.rank : null, done: !!res, ms: res ? res.ms : null, out: !!(res && res.out) });
    }
    return out;
  }

  sendStandings(force) {
    const st = this.standings();
    const key = JSON.stringify(st);
    if (!force && key === this.lastStandKey) return;
    this.lastStandKey = key;
    for (const ch of this.owner.standingsTo()) this.io.to(ch).emit('standings', st);
  }

  /** 지금 순위 — 완성한 팀은 완성 순, 나머지는 해결률 · 해결 블록 수 · 팀 번호 순, 기권한 팀은 맨 아래 */
  rankOrder() {
    const list = [...this.matches.entries()].map(([no, m]) => {
      const res = this.results.get(no);
      const solved = m.board.cells.filter(c => c.solved).length;
      return { no, solved, pct: solved / m.board.cells.length, rank: res && res.clear ? res.rank : 0, out: !!(res && res.out) };
    });
    list.sort((a, b) => {
      if (a.rank && b.rank) return a.rank - b.rank;
      if (a.rank) return -1;
      if (b.rank) return 1;
      if (a.out !== b.out) return a.out ? 1 : -1;
      return b.pct - a.pct || b.solved - a.solved || a.no - b.no;
    });
    return list.map(x => x.no);
  }

  snapRanks(el) {
    this.history.push({ t: Math.round(el), order: this.rankOrder() });
    if (this.history.length > 400) this.history.shift(); // 혹시 몰라 (30분 = 180개)
  }

  // ── 방해 아이템 ──

  /**
   * fromNo 팀이 덱의 방해 아이템을 썼다 → to 팀을 공격 (학생이 고름)
   *   to 가 0 이면 바로 위 순위 팀 (1등이면 2등을). 고른 팀이 우리 팀 · 없는 팀 · 끝난 팀이면 { bad: true }
   * 순위: 지금 해결률(같으면 해결 블록 수, 팀 번호). 판을 이미 끝낸 팀은 빼고 센다.
   * 공격은 2초 뒤에 들어가고 그 사이 대상 팀이 방패로 막을 수 있다 — 결과는 나중에 알린다.
   * 돌려주는 값: { to } / 공격할 팀이 없으면 null (아이템은 덱에 남음)
   */
  attack(fromNo, item, p, to) {
    const live = [...this.matches.entries()]
      .filter(([no, m]) => !m.ended && !this.results.has(no))
      .map(([no, m]) => ({ no, m, solved: m.board.cells.filter(c => c.solved).length, total: m.board.cells.length }))
      .sort((a, b) => (b.solved / b.total) - (a.solved / a.total) || b.solved - a.solved || a.no - b.no);
    const k = live.findIndex(x => x.no === fromNo);
    if (k < 0 || live.length < 2) return null;
    let target = live[k === 0 ? 1 : k - 1];
    if (to) {
      target = live.find(x => x.no === to && x.no !== fromNo);
      if (!target) return { bad: true };
    }
    target.m.receiveAttack(item, fromNo, p.nick, (blocked, byNick) => {
      this.emitEvent('attack', { from: fromNo, to: target.no, id: item.id, name: item.name, desc: item.desc, blocked });
      this.io.to(this.owner.channel).emit('class:feed', { text: `${fromNo}팀 → ${target.no}팀 ${item.name}${blocked ? ' (방패에 막힘)' : '!'}`, kind: blocked ? 'info' : 'attack' });
      // 공격한 팀에도 결과를 알려 준다
      const from = this.matches.get(fromNo);
      if (from && !from.ended) {
        from.emitAll('item', { id: blocked ? 'shield' : item.id, name: blocked ? '막힘' : item.name,
          desc: blocked ? `${target.no}팀 ${byNick} 님이 방패로 막았어요` : `${target.no}팀에 ${item.name} 명중!`, kind: blocked ? 'blocked' : 'attack', by: p.nick, to: target.no });
        from.feed(`${target.no}팀에 ${item.name} ${blocked ? '→ 방패에 막힘' : '명중!'}`, blocked ? 'muted' : 'attack');
      }
    });
    return { to: target.no };
  }

  setAttacks(on) { for (const m of this.matches.values()) m.attacks = !!on; }

  /** 판에서 생긴 소식 (보스 격파 · 집결 · 아이템) → owner 가 원하면 받는다 (전광판) */
  event(no, e) { this.emitEvent('match', { no, e }); }
  emitEvent(type, data) { if (this.owner.onRoundEvent) this.owner.onRoundEvent(type, data); }

  // ── 끝 ──

  teamEnded(no, result) {
    if (this.results.has(no)) return;
    const clear = result.reason === 'clear';
    const rec = {
      no, clear, reason: result.reason, out: OUT_REASONS.includes(result.reason), ms: Math.min(this.elapsed(), this.limitMs),
      solved: result.solved, total: result.total, bosses: result.bosses, players: result.players,
      atk: result.atk || { sent: 0, got: 0, blocked: 0 },
    };
    if (clear) { this.clearCount += 1; rec.rank = this.clearCount; }
    this.results.set(no, rec);
    if (clear || rec.out) this.sendDone(no);
    if (clear) this.emitEvent('clear', { no, rank: rec.rank });
    this.sendStandings(true);
    this.owner.changed();
    // 모든 팀이 끝났으면 (모두 완성 · 시간 끝 · 끝냄 · 기권) 한 판 마무리
    if ([...this.matches.keys()].every(k => this.results.has(k))) setImmediate(() => this.finish());
  }

  /** 팀 하나를 기권으로 끝낸다 (학생 대전방: 팀원이 모두 나감) */
  forfeit(no) {
    const m = this.matches.get(no);
    if (m && !m.ended) m.finish('forfeit');
  }

  pause(on) {
    if (this.countdownUntil) return { ok: false, error: '시작 카운트다운 중이에요 — 잠시 뒤에 눌러 주세요' };
    if (on && !this.pausedAt) {
      this.pausedAt = Date.now();
      for (const m of this.matches.values()) m.pause();
    } else if (!on && this.pausedAt) {
      this.pausedMs += Date.now() - this.pausedAt;
      this.pausedAt = 0;
      for (const m of this.matches.values()) m.resume();
    }
    return { ok: true, paused: !!this.pausedAt };
  }

  /** 끝내기 (교사 '게임 종료') — 남은 팀은 해결률 순 */
  stop() {
    if (this.countdownUntil) { clearTimeout(this.countdownTimer); this.countdownUntil = 0; }
    if (this.pausedAt) { this.pausedMs += Date.now() - this.pausedAt; this.pausedAt = 0; for (const m of this.matches.values()) { m.countdownUntil = 0; m.resume(); } }
    this.stopped = true;
    for (const m of this.matches.values()) if (!m.ended) m.finish('stop');
  }

  /** 시계 · 판 정리 (결과 없이) */
  kill() {
    this.finished = true;
    clearInterval(this.timer);
    clearTimeout(this.countdownTimer);
    for (const m of this.matches.values()) m.stop();
  }

  /** 모든 팀이 끝남 → 결과를 만들어 owner.onRoundEnd 로 */
  finish() {
    if (this.finished) return;
    this.kill();
    const list = [...this.results.values()].map(x => ({
      no: x.no, clear: x.clear, rank: x.rank || null, ms: x.ms, reason: x.reason, out: x.out,
      solved: x.solved, total: x.total, pct: Math.round(x.solved / x.total * 100), bosses: x.bosses, atk: x.atk,
      members: x.players.map(p => ({ nick: p.nick, kind: p.kind, color: p.color, solved: p.solved, bosses: p.bosses, bot: !!p.bot })),
      bots: x.players.filter(p => p.bot).length,
    }));
    // 완성한 팀은 완성 순서, 나머지는 해결한 블록이 많은 순 (같으면 같은 순위), 기권한 팀은 그 아래
    const cleared = list.filter(x => x.clear).sort((a, b) => a.rank - b.rank);
    const byPct = (a, b) => b.pct - a.pct || b.solved - a.solved;
    const rest = list.filter(x => !x.clear && !x.out).sort(byPct).concat(list.filter(x => x.out).sort(byPct));
    let rank = cleared.length;
    rest.forEach((x, k) => {
      const prev = rest[k - 1];
      if (k === 0 || x.out !== prev.out || x.pct !== prev.pct || x.solved !== prev.solved) rank = cleared.length + k + 1;
      x.rank = rank;
    });
    const teams = cleared.concat(rest);
    // 끝난 순간의 순위도 순위 기록에 넣는다 (게임이 끝난 뒤 그래프를 남김)
    const endT = Math.round(Math.min(this.elapsed(), this.limitMs));
    const hist = this.history.filter(h => h.t < endT);
    hist.push({ t: endT, order: teams.map(x => x.no) });
    const reason = teams.every(x => x.clear) ? 'clear' : this.stopped ? 'stop' : teams.every(x => x.clear || x.out) ? 'out' : 'time';
    const result = {
      code: this.owner.label, mode: this.owner.mode, startedAt: this.startedAt, endedAt: Date.now(), reason,
      limitMs: this.limitMs, blocks: this.blocks, ms: Math.min(this.elapsed(), this.limitMs), teams, history: hist,
    };
    if (this.owner.onRoundEnd) this.owner.onRoundEnd(result);
  }
}

module.exports = { TeamRound, RANK_SNAP_MS };
