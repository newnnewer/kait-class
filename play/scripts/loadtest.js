'use strict';
// 부하 시험 (6-3, v0.7.5) — 가상 학생 여러 명이 실제 학생처럼 놀면서 서버가 얼마나 빨리 답하는지 잰다.
//
// ⚠ 300명이 넘는 큰 시험은 게임 컨테이너 '밖'의 따로 된 컨테이너에서 돌린다 (v0.8.1):
//   게임 컨테이너는 메모리 한도가 300MB 인데, 500명 시험이면 게임 서버 약 130MB + 이 도구 약 120MB 라
//   'docker exec kait-play …' 로 같은 컨테이너 안에서 돌리면 한도에 닿아 서버가 꺼질 수 있다.
//   cd /opt/kait-play
//   docker run --rm -it --network host kait-play:latest node scripts/loadtest.js --url http://127.0.0.1:3100/play \
//       --teacher 비밀번호 --classes 8 --students 240 --teams 6 --rooms 40 --per 7 --minutes 10
//   그리고 서버 .env 의 MAX_PLAYERS(최대 접속 인원, 기본 300)를 600 등으로 늘리고 docker compose up -d 로 다시 켠 뒤에.
//
// 서버 안에서 (100명 정도까지, 연습 서버: cd /opt/kait-play):
//   docker exec kait-play node scripts/loadtest.js --rooms 10 --per 7 --minutes 5
//       → 학생 방 10개 × 7명 (70명)을 스스로 만들어 판이 끝나면 다시 시작
//   docker exec kait-play node scripts/loadtest.js --class 4827 --students 30 --minutes 5
//       → 교사 화면에서 만든 수업 게임(코드 4827)에 30명이 들어가 조를 차례로 고름 → 교사가 '게임 시작'
//   교사 역할까지 자동: --teacher 비밀번호 --students 30 --teams 6   (수업 게임을 만들고, 모두 들어오면 시작, 끝나면 닫음)
//   둘을 함께: --teacher 비밀번호 --students 30 --rooms 10 --per 7   (모두 100명)
//   수업 게임 여러 개 (v0.8.1): --teacher 비밀번호 --classes 8 --students 240 --teams 6 --rooms 40 --per 7 --minutes 10
//       → 수업 게임 8개에 240명을 나눠(30명씩) 넣고, 판이 끝나면 5초 뒤 다음 판을 자동으로 시작 (한 판 --round 분, 기본 3)
//       → 학생 방 40개 × 7명 = 280명, 모두 520명
//   접속은 한꺼번에 몰리지 않게 가상 학생마다 --ramp 밀리초(기본 20) 간격으로
//   다른 주소: --url http://서버주소/play
//
// 가상 학생이 하는 일: 가까운 빈 블록으로 걸어가 점유 → 글자 수만큼 '타이핑' 시간 → 제출 (10% 틀림)
//   · 보스 옆이면 잡아 보고 아무 답이나 냄 · 덱에 아이템이 있으면 가끔 씀 · 공격이 오면 방패로 막아 봄
//   · 집결 보스가 나오면 그 줄로 가서 Home/End · 대기실에서 가끔 한마디
// 10초마다 알려 주는 것 (+ 시험 도구 자신의 CPU · 밀린 시간 — 도구가 바쁘면 응답 시간이 부풀려져 보임):
//   응답 시간 = 움직임을 보내고 서버에서 내 새 위치가 돌아오기까지 (학생이 느끼는 '반응 속도')
//   서버 메모리 · 밀린 시간(lag, 서버가 바빠서 늦어진 시간) — /healthz
// 끝나면 (Ctrl + C 또는 --minutes) 전체 요약. 가상 학생은 1분 뒤 방에서 빠진다.

const { io } = require('socket.io-client');
const http = require('http');

// ── 옵션 ──
const argv = process.argv.slice(2);
function opt(name, def) { const k = argv.indexOf('--' + name); return k >= 0 ? argv[k + 1] : def; }
const TEACHER = opt('teacher', null);   // 교사 비밀번호 (주면 수업 게임을 스스로 만들고 시작)
const TEAMS = Math.max(2, Math.min(8, parseInt(opt('teams', '6'), 10)));
let CLASS = opt('class', null);          // 교사 화면에서 만든 수업 게임 코드 (하나)
const CLASSES = TEACHER ? Math.max(1, Math.min(20, parseInt(opt('classes', '1'), 10))) : (CLASS ? 1 : 0); // 서버 한도 20
const ROUND = Math.max(1, Math.min(30, parseInt(opt('round', '3'), 10)));   // 수업 게임 한 판 (분)
const RAMP = Math.max(0, parseInt(opt('ramp', '20'), 10));                  // 접속 간격 (ms)
const STUDENTS = Math.max(0, Math.min(1000, parseInt(opt('students', CLASS || TEACHER ? String(30 * CLASSES) : '0'), 10)));
const ROOMS = Math.max(0, Math.min(60, parseInt(opt('rooms', CLASS || TEACHER ? '0' : '10'), 10)));  // 서버 한도 60
const PER = Math.max(1, Math.min(16, parseInt(opt('per', '7'), 10)));
const MINUTES = Math.max(0.2, parseFloat(opt('minutes', '5')));
const target = new URL(opt('url', `http://127.0.0.1:${process.env.PORT || 3000}${process.env.BASE_PATH || ''}`));
const base = target.pathname.replace(/\/+$/, '');
const TAGS = ['출력', '입력', '변수', '연산자'];

const KINDS = ['slime', 'robot', 'cat', 'ghost', 'owl', 'dino'];
const COLORS = ['#FFD23F', '#45B1F5', '#FF8FB1', '#7EE0B5', '#FFB347', '#C9A2FF'];
const pick = a => a[Math.floor(Math.random() * a.length)];
const rand = (a, b) => a + Math.random() * (b - a);

// ── 잰 값 ──
const lat = [];        // 이번 10초 응답 시간 (ms)
const latAll = [];     // 전체
const acks = [];       // 점유 · 제출 · 아이템 답이 오기까지
let sent = 0, got = 0, errors = 0, disconnects = 0, solved = 0, bossTried = 0, itemsUsed = 0, defended = 0, gathers = 0, games = 0, rounds = 0;
const server = [];     // /healthz 기록
const said = {};      // 같은 오류는 한 번만 보여 주고 개수만 셈
function warnOnce(msg) {
  said[msg] = (said[msg] || 0) + 1;
  if (said[msg] > 1) return;
  console.log(msg);
  if (/사람이 너무 많아요/.test(msg)) console.log('  → 서버의 최대 접속 인원(MAX_PLAYERS, 기본 300)에 걸렸어요. 서버 .env 에 MAX_PLAYERS=600 처럼 늘리고 docker compose up -d 로 다시 켠 뒤 시험하세요.'
    + ' (방금 끝난 시험의 가상 학생은 1분 동안 자리를 차지하니 1분 뒤에)');
  if (/방이 너무 많아요/.test(msg)) console.log('  → 서버의 학생 방 한도(MAX_ROOMS, 기본 60)에 걸렸어요.');
}
function pct(a, p) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; }

// ── 가상 학생 하나 ──
function student(no, plan) {
  const s = io(target.origin, { path: base + '/socket.io', transports: ['websocket'], forceNew: true, reconnection: true });
  const token = 'load' + no + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const st = { board: null, me: null, occ: {}, boss: null, occupying: -1, typeUntil: 0, fighting: 0, deck: null, incoming: [], seq: 0, pending: {}, busy: false, target: -1 };
  let timer = null, roomId = null;

  function ack(ev, msg, cb) {
    const t0 = Date.now();
    s.emit(ev, msg, r => { acks.push(Date.now() - t0); if (cb) cb(r); });
  }
  function move(msg) {
    msg.seq = ++st.seq;
    st.pending[msg.seq] = Date.now();
    sent++;
    s.emit('move', msg);
  }

  s.on('state', g => {
    st.board = g.board;
    const p = g.players.find(x => x.id === g.meId);
    st.me = { id: g.meId, r: p.r, c: p.c };
    st.occ = {}; (g.occ || []).forEach(o => { st.occ[o.i] = o.by; });
    st.boss = g.boss; st.deck = g.deck; st.occupying = -1; st.fighting = 0; st.target = -1;
  });
  s.on('pos', m => {
    if (!st.me || m.id !== st.me.id) return;
    st.me.r = m.r; st.me.c = m.c;
    const t0 = st.pending[m.seq];
    if (t0) { const d = Date.now() - t0; lat.push(d); latAll.push(d); got++; delete st.pending[m.seq]; }
  });
  s.on('cell', m => { if (st.board && st.board.cells[m.i]) st.board.cells[m.i].solved = m.solved; });
  s.on('code', m => { if (st.board && st.board.cells[m.i]) st.board.cells[m.i].code = m.code; });
  s.on('occ', m => { if (m.by) st.occ[m.i] = m.by; else delete st.occ[m.i]; });
  s.on('released', () => { st.occupying = -1; });
  s.on('boss', m => { st.boss = m.i >= 0 ? m : null; if (m.i < 0) st.fighting = 0; });
  s.on('deck', d => { st.deck = d; });
  s.on('incoming', m => {
    // 방패가 있으면 0.3~1.5초 뒤에 막아 본다 (2초 안이면 막힘)
    if (st.deck && st.deck.shields > 0 && Math.random() < 0.8) setTimeout(() => ack('defend', {}, r => { if (r && r.ok) defended++; }), rand(300, 1500));
  });
  s.on('result', () => { st.board = null; });
  s.on('disconnect', () => { disconnects++; });
  s.on('connect_error', () => { errors++; });

  function freeCell(i) { const b = st.board; return b && b.cells[i] && !b.cells[i].solved && !st.occ[i] && !(st.boss && st.boss.i === i); }

  function tick() {
    const b = st.board, me = st.me;
    if (!b || !me || st.busy) return;
    const cols = b.cols, here = me.r * cols + me.c;
    // 덱의 아이템: 가끔 쓴다
    if (st.deck && st.deck.slots && Math.random() < 0.04) {
      const k = st.deck.slots.findIndex(x => x && !x.off);
      if (k >= 0) { itemsUsed++; return ack('item:use', { slot: k + 1 }); }
    }
    // 집결 보스: 그 줄로 가서 Home(1열 보스) / End(오른쪽 보스) → 키로 잡기
    if (st.boss && st.boss.phase === 'gather') {
      const br = Math.floor(st.boss.i / cols), bc = st.boss.i % cols;
      if (st.occupying >= 0) { st.occupying = -1; s.emit('release'); return; }
      if (me.r !== br) return move({ dir: me.r < br ? 'D' : 'U' });
      if (Math.abs(me.c - bc) !== 1) { gathers++; return move({ to: bc === 1 ? 'home' : 'end' }); }
      // v0.12.0: 옆 칸에 왔으면 Delete(왼쪽) / Backspace(오른쪽) 로 잡는다
      if (st.grabbedBoss !== st.boss.i) { st.grabbedBoss = st.boss.i; return ack('boss:grab', { key: me.c < bc ? 'Delete' : 'Backspace' }); }
      return;
    }
    // 보스 공략 중: 잠시 생각하다가 아무 답이나 (가상 학생은 보스 답을 모른다)
    if (st.fighting) {
      if (--st.fighting === 0) ack('boss:submit', { text: 'x' });
      return;
    }
    // 보스 바로 옆이면 잡아 본다
    if (st.boss && st.boss.phase === 'wait' && st.occupying < 0) {
      const row = Math.floor(st.boss.i / cols) === me.r;
      const key = row && st.boss.i === here + 1 ? 'Delete' : row && st.boss.i === here - 1 ? 'Backspace' : null;
      if (key && Math.random() < 0.7) { bossTried++; return ack('boss:grab', { key }, r => { if (r && r.ok) st.fighting = 4 + Math.floor(Math.random() * 6); }); }
    }
    // 치는 중: 글자 수만큼 시간이 지나면 제출 (10% 틀림)
    if (st.occupying >= 0) {
      if (Date.now() < st.typeUntil) return;
      const code = b.cells[st.occupying].code;
      st.occupying = -1;
      st.busy = true;
      return ack('submit', { text: Math.random() < 0.9 ? code : code + ';' }, r => { st.busy = false; if (r && r.correct) solved++; });
    }
    // 서 있는 칸이 빈 블록이면 점유
    if (freeCell(here)) {
      st.busy = true;
      return ack('occupy', {}, r => {
        st.busy = false;
        if (r && r.ok) { st.occupying = r.i; st.typeUntil = Date.now() + b.cells[r.i].code.length * rand(180, 320); }
        else st.target = -1;
      });
    }
    // 가까운 빈 블록으로 한 칸씩 (가끔 Ctrl 점프 · Home/End)
    if (!freeCell(st.target)) {
      let best = -1, bd = 1e9;
      for (let i = 0; i < b.cells.length; i++) {
        if (!freeCell(i)) continue;
        const d = Math.abs(Math.floor(i / cols) - me.r) + Math.abs(i % cols - me.c) + Math.random() * 3;
        if (d < bd) { bd = d; best = i; }
      }
      st.target = best;
    }
    if (st.target < 0) return;
    const tr = Math.floor(st.target / cols), tc = st.target % cols;
    if (tr !== me.r) return move({ dir: tr > me.r ? 'D' : 'U', ctrl: false });
    return move({ dir: tc > me.c ? 'R' : 'L', ctrl: false });
  }

  // 학생 방: 방장은 방을 만들고 사람이 차면 시작 · 끝나면 다시 시작
  s.on('room', r => {
    roomId = r.id;
    if (plan.host && r.phase === 'waiting' && r.members.length >= PER && r.hostId === st.id) {
      setTimeout(() => ack('room:start', {}, x => { if (x && x.ok) games++; }), rand(1500, 4000));
    }
    if (r.phase === 'waiting' && Math.random() < 0.15) setTimeout(() => s.emit('chat', { id: pick(['ok', 'hello', 'ready', 'go', 'again', 'hehe']) }), rand(200, 1500));
  });
  s.on('lobby', l => {
    if (plan.cls) return;
    if (plan.host) {
      if (roomId) return;
      roomId = 'making';
      return ack('room:create', { settings: { tags: TAGS, max: PER, limitMin: 3, botSpeed: 'normal' } }, r => {
        if (!r || !r.ok) { roomId = null; errors++; return warnOnce('방을 못 만듦 — ' + (r && r.error)); }
        roomId = r.room.id; plan.roomBox.id = roomId;
      });
    }
    if (roomId || !plan.roomBox.id) return;
    const room = l.rooms.find(x => x.id === plan.roomBox.id && x.phase === 'waiting' && x.count < x.max);
    if (!room) return;
    roomId = 'joining';
    ack('room:join', { id: room.id }, r => { roomId = r && r.ok ? room.id : null; });
  });

  s.on('connect', () => {
    s.emit('hello', { token }, () => {
      s.emit('join', { kind: pick(KINDS), color: pick(COLORS) }, r => {
        if (!r || !r.ok) { errors++; return warnOnce('입장 실패 — ' + (r && r.error)); }
        st.id = r.me.id;
        if (plan.cls) {
          ack('class:join', { code: plan.code }, x => {
            if (!x || !x.ok) { errors++; return warnOnce('수업 게임에 못 들어감 — ' + (x && x.error)); }
            const t = (plan.t % x.cls.teams.length) + 1;
            s.emit('class:team', { no: t }, () => {});
          });
        }
        clearInterval(timer);
        timer = setInterval(tick, rand(250, 450)); // 사람처럼: 1초에 2~4번 키
      });
    });
  });
  return s;
}

// ── 교사 역할 (--teacher): 수업 게임 만들기 → 모두 들어오면 시작 → 판이 끝나면 5초 뒤 다음 판 → 끝나면 닫기 ──
// 교사 화면 하나는 수업 게임 하나만 보므로 수업 게임마다 교사 연결을 따로 만든다.
const classes = [];   // { code, teacher, expect }
function teach() {
  return new Promise((res, rej) => {
    const teacher = io(target.origin, { path: base + '/socket.io', transports: ['websocket'], forceNew: true });
    teacher.on('connect', () => {
      teacher.emit('admin:login', { password: TEACHER }, r => {
        if (!r || !r.ok) return rej(new Error('교사 비밀번호가 맞지 않아요' + (r && r.error ? ' — ' + r.error : '')));
        teacher.emit('class:create', { settings: { tags: TAGS, teams: TEAMS, limitMin: ROUND, botSpeed: 'normal' } }, c => {
          if (!c || !c.ok) return rej(new Error('수업 게임을 못 만듦: ' + (c && c.error)));
          res({ code: c.cls.code, teacher, expect: 0 });
        });
      });
    });
    teacher.on('connect_error', e => rej(e));
  });
}
function runClass(c) {
  let tries = 0, played = false, restartAt = 0;
  setInterval(() => {
    c.teacher.emit('class:watch', { code: c.code }, d => {
      const cls = d && d.cls;
      if (!cls || cls.phase !== 'waiting') { restartAt = 0; return; }
      const picked = cls.teams.reduce((a, x) => a + x.members.length, 0);
      if (!played) {
        tries++;
        if (picked < c.expect && tries <= 60) return;
      } else {
        if (!restartAt) { restartAt = Date.now() + 5000; return; }   // 결과를 5초 보고
        if (Date.now() < restartAt) return;
      }
      restartAt = 0;
      c.teacher.emit('class:start', { code: c.code }, r => {
        if (r && r.ok) { played = true; rounds++; console.log(`수업 게임 ${c.code} 판 시작 (${picked}명)`); }
        else console.log(`수업 게임 ${c.code} 시작 실패: ` + (r && r.error));
      });
    });
  }, 1000);
}

// ── 시작 ──
const sockets = [];
let n = 0;
async function main() {
  if (TEACHER && STUDENTS) {
    for (let k = 0; k < CLASSES; k++) {
      try { classes.push(await teach()); } catch (e) { console.log(e.message); break; }
    }
    if (!classes.length) process.exit(1);
    console.log(`수업 게임 ${classes.length}개를 만들었어요 (${classes.map(c => c.code).join(', ')} · 조 ${TEAMS}개 · 한 판 ${ROUND}분)`);
  } else if (CLASS && STUDENTS) classes.push({ code: CLASS, teacher: null, expect: 0 });
  // 누가 어디로: 수업 게임 학생 k → 수업 (k % 개수), 그 안에서 차례로 조를 고름
  const plans = [];
  for (let r = 0; r < ROOMS; r++) {
    const box = { id: null };
    for (let k = 0; k < PER; k++) plans.push({ host: k === 0, roomBox: box });
  }
  for (let k = 0; k < STUDENTS && classes.length; k++) {
    const c = classes[k % classes.length];
    plans.push({ cls: true, code: c.code, t: c.expect++ });
  }
  // 섞어서 차례로 접속 (학생 방 · 수업 게임이 함께 늘어나게, 방장은 먼저)
  plans.sort((x, y) => (y.host ? 1 : 0) - (x.host ? 1 : 0) || Math.random() - 0.5);
  plans.forEach((pl, i) => setTimeout(() => sockets.push(student(++n, pl)), i * RAMP));
  const total = plans.length;
  console.log(`가상 학생 ${total}명 — 학생 방 ${ROOMS}개 × ${PER}명 = ${ROOMS * PER}명`
    + (classes.length ? ` · 수업 게임 ${classes.length}개에 ${STUDENTS}명` + (TEACHER ? '' : " (교사 화면에서 '게임 시작'을 눌러 주세요)") : '')
    + ` · ${MINUTES}분 동안 · 접속에 약 ${Math.ceil(total * RAMP / 1000)}초`);
  classes.forEach(c => { if (c.teacher) runClass(c); });
}
main();

// ── 시험 도구 자신이 얼마나 바쁜가 (가상 학생 수백 명을 흉내 내는 쪽도 CPU를 씀) ──
let cpuPrev = process.cpuUsage(), cpuAt = Date.now(), toolLag = 0;
const toolCpu = [], toolLags = [];
let lagPrev = Date.now();
setInterval(() => { const now = Date.now(); toolLag = Math.max(toolLag, now - lagPrev - 100); lagPrev = now; }, 100).unref();
function toolStat() {
  const u = process.cpuUsage(cpuPrev), now = Date.now();
  const pctCpu = Math.round((u.user + u.system) / 1000 / (now - cpuAt) * 100);
  cpuPrev = process.cpuUsage(); cpuAt = now;
  const lg = toolLag; toolLag = 0;
  toolCpu.push(pctCpu); toolLags.push(lg);
  return { cpu: pctCpu, lag: lg };
}

function healthz() {
  return new Promise(res => {
    const req = http.get({ host: target.hostname, port: target.port || 80, path: base + '/healthz', timeout: 3000 }, r => {
      let d = ''; r.on('data', c => { d += c; }); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { res(null); } });
    });
    req.on('error', () => res(null)); req.on('timeout', () => { req.destroy(); res(null); });
  });
}

const started = Date.now();
const report = setInterval(async () => {
  const h = await healthz();
  if (h) server.push(h);
  const sec = Math.round((Date.now() - started) / 1000);
  const tool = toolStat();
  console.log(`[${String(sec).padStart(4)}초] 접속 ${h ? h.players : '?'}명 · 경기 ${h ? h.matches : '?'}개 | 응답 보통 ${pct(lat, 0.5)}ms · 느린 5% ${pct(lat, 0.95)}ms · 가장 느림 ${lat.length ? Math.max(...lat) : 0}ms (${lat.length}번)`
    + ` | 서버 메모리 ${h ? h.memMB : '?'}MB · 밀린 시간 ${h ? h.lagMaxMs : '?'}ms | 푼 블록 ${solved}`
    + ` | 시험 도구 CPU ${tool.cpu}% · 밀림 ${tool.lag}ms` + (tool.cpu >= 85 ? ' ⚠ 도구가 바빠요' : ''));
  lat.length = 0;
}, 10000);

function finish() {
  clearInterval(report);
  const mem = server.map(h => h.memMB), lagM = server.map(h => h.lagMaxMs);
  console.log('\n──── 요약 ────');
  console.log(`가상 학생 ${n}명 · ${Math.round((Date.now() - started) / 1000)}초`);
  console.log(`응답 시간(움직임): 보통 ${pct(latAll, 0.5)}ms · 느린 5% ${pct(latAll, 0.95)}ms · 느린 1% ${pct(latAll, 0.99)}ms · 가장 느림 ${latAll.length ? Math.max(...latAll) : 0}ms · ${latAll.length}번 (보낸 ${sent} · 받은 ${got})`);
  console.log(`응답 시간(점유 · 제출 · 아이템 답): 보통 ${pct(acks, 0.5)}ms · 느린 5% ${pct(acks, 0.95)}ms`);
  console.log(`서버 메모리: 가장 클 때 ${mem.length ? Math.max(...mem) : '?'}MB · 밀린 시간 가장 클 때 ${lagM.length ? Math.max(...lagM) : '?'}ms`);
  console.log(`한 일: 푼 블록 ${solved} · 보스 시도 ${bossTried} · 아이템 사용 ${itemsUsed} · 방패로 막기 ${defended} · 집결 이동 ${gathers} · 학생 방 판 시작 ${games} · 수업 게임 판 시작 ${rounds}`);
  const tc = toolCpu.length ? Math.max(...toolCpu) : 0, tl = toolLags.length ? Math.max(...toolLags) : 0;
  console.log(`시험 도구: CPU 가장 클 때 ${tc}% · 밀린 시간 가장 클 때 ${tl}ms`
    + (tc >= 85 || tl >= 100 ? '  ⚠ 도구 자신이 바빴어요 — 응답 시간이 실제보다 크게 나왔을 수 있어요 (도구를 둘로 나눠 돌리거나 다른 컴퓨터에서 --url 로)' : '  (도구는 여유 있었음 — 응답 시간을 믿어도 돼요)'));
  console.log(`문제: 연결 실패 ${errors} · 끊김 ${disconnects}`);
  Object.keys(said).forEach(m => console.log(`  ${m} × ${said[m]}`));
  console.log('판단 기준(대략): 응답 보통 100ms 아래 · 느린 5% 300ms 아래 · 밀린 시간 100ms 아래면 학생이 느끼기에 매끄러워요.');
  const own = classes.filter(c => c.teacher);
  if (own.length) {
    let left = own.length;
    own.forEach(c => c.teacher.emit('class:close', { code: c.code }, () => { if (--left === 0) process.exit(0); }));
    setTimeout(() => process.exit(0), 3000); return;
  }
  process.exit(0);
}
setTimeout(finish, MINUTES * 60000);
process.on('SIGINT', finish);
