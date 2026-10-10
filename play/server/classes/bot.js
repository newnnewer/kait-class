'use strict';
// 공식전의 비트 — 팀 인원을 맞추려고 교사가 넣는다. 서버 안에서 움직인다 (연결 없음).
//   · 일반 블록만: 가까운 빈 블록으로 걸어가 점유 → 잠시 '타이핑' → 제출 (가끔 틀림)
//   · 보스는 잡지 않는다 (보스·아이템은 학생 몫)
//   · 속도는 공식전 설정의 '비트 속도' — 한 블록에 걸리는 시간이 대략
//       느림 20초 · 보통 12초 · 빠름 7초 (걷는 시간 포함)
//   · 사람과 똑같은 규칙(Match 의 move/occupy/submit)을 쓰므로 얼음·혼란·일시정지도 똑같이 받는다

const crypto = require('crypto');

const SPEED_MS = { slow: 20000, normal: 12000, fast: 7000 };
const STEP_MS = 280;       // 한 칸 걷는 간격
const WRONG_RATE = 0.1;    // 틀리는 비율
const KINDS = ['slime', 'robot', 'cat', 'ghost', 'owl', 'dino', 'alien', 'frog'];
const COLORS = ['#FFD23F', '#45B1F5', '#FF8FB1', '#7EE0B5', '#FFB347', '#C9A2FF', '#F2F4FA', '#FF6B6B'];

function makeBot(nick) {
  const id = 'b' + crypto.randomBytes(4).toString('hex');
  return {
    id, token: 'bot:' + id, nick, bot: true,
    kind: KINDS[Math.floor(Math.random() * KINDS.length)],
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    socketId: null, room: null, online: true, lastSeen: Date.now(), dropTimer: null,
    brain: { target: -1, nextAt: 0, submitAt: 0, occ: -1 },
  };
}

/** 한 번 움직여 본다 (공식전이 0.2초마다 부름). taken: 이 판에서 다른 비트가 노리는 칸 */
function stepBot(bot, m, speed, taken) {
  const b = bot.brain;
  const now = Date.now();
  if (m.ended || m.pausedAt || now < b.nextAt) return;
  // 먹구름: 코드가 안 보이니 잠깐 멈춘다 (사람과 같게)
  if (m.fx.cloud > now) { b.nextAt = now + 300; if (b.submitAt) b.submitAt += 300; return; }
  const per = SPEED_MS[speed] || SPEED_MS.normal;
  const cols = m.board.cols;
  const cells = m.board.cells;

  // 점유 중: 타이핑이 끝나면 제출
  const mine = m.occBy.get(bot.id);
  if (mine !== undefined) {
    if (b.occ !== mine) { b.occ = mine; b.submitAt = now + per * (0.55 + Math.random() * 0.3); }
    if (now < b.submitAt) return;
    const code = cells[mine].code;
    m.submit(bot, Math.random() < WRONG_RATE ? code + ' x' : code);
    b.occ = -1; b.target = -1;
    b.nextAt = now + 400 + Math.random() * 600; // 잠깐 숨 고르기
    return;
  }
  b.occ = -1;

  const pos = m.pos.get(bot.id);
  if (!pos) return;
  const here = pos.r * cols + pos.c;
  const free = i => i >= 0 && cells[i] && !cells[i].solved && !m.occ.has(i) && !(m.boss && m.boss.i === i);

  // 노릴 칸 고르기: 가까운 빈 블록 중 하나 (다른 비트와 겹치지 않게)
  if (!free(b.target)) {
    const list = [];
    cells.forEach((c, i) => {
      if (!free(i) || taken.has(i)) return;
      const d = Math.abs(Math.floor(i / cols) - pos.r) + Math.abs((i % cols) - pos.c);
      list.push({ i, d });
    });
    if (!list.length) { b.nextAt = now + 1000; return; }
    list.sort((x, y) => x.d - y.d);
    b.target = list[Math.floor(Math.random() * Math.min(3, list.length))].i;
  }
  taken.add(b.target);

  if (here === b.target) {
    const r = m.occupy(bot);
    if (!r.ok) b.target = -1;
    b.nextAt = now + 300;
    return;
  }
  // 한 칸씩 걸어간다 (세로 먼저)
  const tr = Math.floor(b.target / cols), tc = b.target % cols;
  const dir = tr !== pos.r ? (tr > pos.r ? 'D' : 'U') : (tc > pos.c ? 'R' : 'L');
  m.move(bot, { dir, seq: -1 });
  const after = m.pos.get(bot.id);
  if (after && after.r === pos.r && after.c === pos.c) b.target = -1; // 막혔으면 (보스 등) 다른 칸
  b.nextAt = now + STEP_MS + Math.random() * 120;
}

module.exports = { makeBot, stepBot, SPEED_MS };
