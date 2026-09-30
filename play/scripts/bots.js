'use strict';
// 가상 학생 — 혼자서도 '여러 명이 함께 하는 모습'을 시험해 볼 수 있다.
//   1) 브라우저로 방을 만든다 (대기실에서 기다린다)
//   2) 서버 안에서:  docker exec kait-play node scripts/bots.js 3
//      → 가상 학생들이 '모집 중'인 방에 빈자리만큼 들어온다 (방이 없으면 생길 때까지 기다린다)
//   3) 방장이 게임을 시작하면 가상 학생도 함께 움직이고, 블록을 점유·제출한다
//   직접 주소 지정: node scripts/bots.js 3 http://서버주소/play
//   수업 게임에 넣기: node scripts/bots.js 12 --class 4827   (조 1 → 2 → 3 … 차례로 고름)
// 멈추려면 Ctrl + C (1분 뒤 방에서 빠짐)

const { io } = require('socket.io-client');

const argv = process.argv.slice(2);
const ci = argv.indexOf('--class');
const CLASS = ci >= 0 ? String(argv[ci + 1] || '') : null;
if (ci >= 0) argv.splice(ci, 2);
const N = Math.max(1, Math.min(200, parseInt(argv[0] || '5', 10)));
const target = new URL(argv[1] || `http://127.0.0.1:${process.env.PORT || 3000}${process.env.BASE_PATH || ''}`);
const base = target.pathname.replace(/\/+$/, '');
const KINDS = ['slime', 'robot', 'cat', 'ghost', 'owl', 'dino'];
const COLORS = ['#FFD23F', '#45B1F5', '#FF8FB1', '#7EE0B5', '#FFB347', '#C9A2FF'];
const DIRS = ['L', 'R', 'U', 'D'];
const pick = a => a[Math.floor(Math.random() * a.length)];

let joined = 0;
for (let i = 0; i < N; i++) {
  const s = io(target.origin, { path: base + '/socket.io', transports: ['websocket'], forceNew: true });
  const token = 'bot' + i + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  let seq = 0, timer = null;
  let board = null, me = null, occupying = -1, occ = {}, boss = null, fighting = 0;
  s.on('state', st => {
    board = st.board;
    const p = st.players.find(x => x.id === st.meId);
    me = { id: st.meId, r: p.r, c: p.c };
    occ = {}; (st.occ || []).forEach(o => { occ[o.i] = o.by; });
    occupying = -1;
  });
  s.on('pos', m => { if (me && m.id === me.id) { me.r = m.r; me.c = m.c; } });
  s.on('cell', m => { if (board) board.cells[m.i].solved = m.solved; });
  s.on('occ', m => { if (m.by) occ[m.i] = m.by; else delete occ[m.i]; });
  s.on('released', () => { occupying = -1; });
  s.on('boss', m => { boss = m.i >= 0 ? m : null; if (m.i < 0) fighting = 0; });

  // 한 번에 한 가지씩: 움직이기 → 점유 → (몇 초 뒤) 제출. 가끔 틀린다.
  function tick() {
    if (!board || !me) return;
    // 보스 공략 중: 몇 번 생각하다가 아무 답이나 낸다 (가상 학생은 보스 답을 모른다)
    if (fighting) {
      if (--fighting === 0) s.emit('boss:submit', { text: 'x' }, () => {});
      return;
    }
    // 보스 바로 옆이면 잡아 본다
    if (boss && boss.phase === 'wait' && occupying < 0) {
      const i = me.r * board.cols + me.c;
      const row = Math.floor(boss.i / board.cols) === me.r;
      const key = row && boss.i === i + 1 ? 'Delete' : row && boss.i === i - 1 ? 'Backspace' : null;
      if (key && Math.random() < 0.6) return s.emit('boss:grab', { key }, r => { if (r && r.ok) fighting = 3 + Math.floor(Math.random() * 4); });
    }
    if (occupying >= 0) {
      if (Math.random() < 0.35) return s.emit('typing'); // 아직 치는 중
      const code = board.cells[occupying].code;
      const text = Math.random() < 0.8 ? code : code + ';';
      occupying = -1;
      return s.emit('submit', { text }, () => {});
    }
    const i = me.r * board.cols + me.c;
    if (!board.cells[i].solved && !occ[i] && Math.random() < 0.5) {
      return s.emit('occupy', {}, r => { if (r && r.ok) occupying = r.i; });
    }
    const x = Math.random();
    if (x < 0.08) s.emit('move', { to: pick(['home', 'end']), seq: ++seq });
    else s.emit('move', { dir: pick(DIRS), ctrl: Math.random() < 0.15, seq: ++seq });
  }

  // 로비: 모집 중이고 빈자리가 있는 방에 들어간다
  let inRoom = false, joining = false;
  s.on('lobby', l => {
    inRoom = false; board = null;
    if (CLASS) {
      // 수업 게임: 코드로 들어가 조를 차례로 고른다
      if (joining) return;
      joining = true;
      return s.emit('class:join', { code: CLASS }, r => {
        if (!r || !r.ok) { joining = false; return console.log(`가상 학생 ${i + 1}: 수업 게임에 못 들어감 —`, r && r.error); }
        const no = (i % r.cls.teams.length) + 1;
        s.emit('class:team', { no }, () => console.log(`가상 학생 ${i + 1} → 수업 ${CLASS} · ${no}조`));
      });
    }
    if (joining) return;
    const room = l.rooms.find(r => r.phase === 'waiting' && r.count < r.max);
    if (!room) return;
    joining = true;
    s.emit('room:join', { id: room.id }, r => {
      joining = false;
      if (r && r.ok) { inRoom = true; console.log(`가상 학생 ${i + 1} → ${room.name}`); }
    });
  });
  s.on('room', () => { inRoom = true; });
  s.on('result', () => { board = null; });

  s.on('connect', () => {
    s.emit('hello', { token }, () => {
      s.emit('join', { kind: pick(KINDS), color: pick(COLORS) }, (r) => {
        if (!r || !r.ok) return console.log('입장 실패', r && r.error);
        joined++;
        if (joined === N) console.log(`가상 학생 ${N}명 접속 — 모집 중인 방이 있으면 들어가요. Ctrl + C 로 끝내기`);
        clearInterval(timer);
        timer = setInterval(tick, 500 + Math.random() * 500);
      });
    });
  });
  s.on('connect_error', e => console.log('연결 실패:', e.message));
}
process.on('SIGINT', () => process.exit(0));
