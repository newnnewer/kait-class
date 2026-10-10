'use strict';
// 학생 방(협동방 · 대전방) · 수업방 설정 — 고를 수 있는 값과 기본값. 브라우저에서 온 값은 여기서 다시 검사한다.

const { TAGS } = require('../problems/parser');

const OPTIONS = {
  max: { min: 2, max: 16, def: 4 },
  limitMin: { min: 1, max: 30, def: 5 },                   // 제한 시간(분, 1분 단위 직접 입력)
  occSec: { list: [10, 15, 20, 30], def: 20 },            // 블록 점유 시간 (v0.12.0: 10~30초, 기본 20초)
  bossEverySec: { list: [10, 15, 30, 60], def: 15 },      // 보스 등장 간격
  bossWaitSec: { list: [5, 8, 12, 20], def: 8 },          // 보스 잔류 시간
  bossLimitSec: { list: [20, 30, 45, 60], def: 30 },      // 보스 풀이 시간
  blocks: { min: 24, max: 144, step: 12 },                 // 0 = 자동
  teams: { min: 2, max: 8, def: 4 },                       // 수업방: 팀 수
  roomTeams: { min: 2, max: 4, def: 2 },                   // 학생 대전방: 팀 수 (v0.13.0)
  teamSize: { min: 1, max: 8, def: 4 },                    // 학생 대전방: 팀마다 인원 (v0.13.0)
  botSpeed: { list: ['slow', 'normal', 'fast'], def: 'normal' }, // 봇 속도 (학생 방 · 수업방)
};

function pickList(v, o) { v = Number(v); return o.list.includes(v) ? v : o.def; }
/** 범위 안의 정수로 (숫자가 아니면 기본값) */
function pickRange(v, o) {
  v = Math.round(Number(v));
  if (!Number.isFinite(v)) return o.def;
  return Math.max(o.min, Math.min(o.max, v));
}

/** v0.13.0: 학생 방(협동방 · 대전방)은 이 값으로 고정 — 방 만들기에서 고르지 않는다 (수업방은 교사가 고름) */
const ROOM_FIXED = { occSec: 20, bossEverySec: 15, bossWaitSec: 8, bossLimitSec: 30, penalty: true };

/** 학생 방 설정: 브라우저에서 온 값 → 검사한 값 (고정 항목은 ROOM_FIXED). 태그가 없으면 null */
function cleanRoom(raw) {
  const c = clean(raw);
  return c ? Object.assign(c, ROOM_FIXED) : null;
}

/** 브라우저에서 온 설정 → 검사한 설정. 태그가 없으면 null */
function clean(raw) {
  raw = raw || {};
  const tags = Array.isArray(raw.tags) ? [...new Set(raw.tags.filter(t => TAGS.includes(t)))] : [];
  if (!tags.length) return null;
  const mode = raw.mode === 'battle' ? 'battle' : 'coop'; // v0.13.0: 협동방 / 대전방
  let blocks = Math.round(Number(raw.blocks) / 12) * 12;
  if (!Number.isFinite(blocks) || blocks <= 0) blocks = 0; // 자동
  else blocks = Math.max(OPTIONS.blocks.min, Math.min(OPTIONS.blocks.max, blocks));
  const out = {
    tags: TAGS.filter(t => tags.includes(t)), // 늘 같은 순서로
    mode,
    limitMin: pickRange(raw.limitMin, OPTIONS.limitMin),
    occSec: pickList(raw.occSec, OPTIONS.occSec),
    bossEverySec: pickList(raw.bossEverySec, OPTIONS.bossEverySec),
    bossWaitSec: pickList(raw.bossWaitSec, OPTIONS.bossWaitSec),
    bossLimitSec: pickList(raw.bossLimitSec, OPTIONS.bossLimitSec),
    penalty: raw.penalty !== false,
    blocks,
    botSpeed: OPTIONS.botSpeed.list.includes(raw.botSpeed) ? raw.botSpeed : OPTIONS.botSpeed.def, // 봇 속도 (학생 방 v0.6.4 · 수업방)
  };
  if (mode === 'battle') {
    out.teams = pickRange(raw.teams, OPTIONS.roomTeams);
    out.teamSize = pickRange(raw.teamSize, OPTIONS.teamSize);
    out.max = out.teams * out.teamSize;
    out.attacks = true; // 대전방은 방해 아이템이 늘 나온다
  } else {
    out.max = pickRange(raw.max, OPTIONS.max);
  }
  return out;
}

/** 수업방 설정 — 학생 방과 같고, 최대 인원 대신 팀 수. 태그가 없으면 null */
function cleanClass(raw) {
  const c = clean(raw);
  if (!c) return null;
  delete c.max;
  delete c.mode;
  let teams = Math.round(Number(raw.teams));
  if (!Number.isFinite(teams)) teams = OPTIONS.teams.def;
  c.teams = Math.max(OPTIONS.teams.min, Math.min(OPTIONS.teams.max, teams));
  c.attacks = raw.attacks !== false; // 방해 아이템 (게임 중에도 교사가 켜고 끔)
  c.sfx = raw.sfx !== false;         // 학생 기기 효과음 (6-2, 게임 중에도 켜고 끔)
  c.bgm = raw.bgm !== false;         // 전광판 배경음
  return c;
}

module.exports = { OPTIONS, ROOM_FIXED, clean, cleanRoom, cleanClass };
