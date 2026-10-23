'use strict';
// 자유 플레이(레이드 · 팀 배틀) · 공식전 설정 — 고를 수 있는 값과 기본값. 브라우저에서 온 값은 여기서 다시 검사한다.

const { TAGS } = require('../problems/parser');
const { FLIP } = require('../game/flip');

const OPTIONS = {
  max: { min: 2, max: 16, def: 4 },
  limitMin: { min: 1, max: 10, def: 3 },                   // 게임 시간(분, 1분 단위 직접 입력) — 1.1.0: 두 게임 모두 1 ~ 10분 · 처음 값 3분
  occSec: { list: [10, 15, 20, 30], def: 20 },            // 블록 점유 시간 (v0.12.0: 10~30초, 기본 20초)
  bossEverySec: { list: [10, 15, 30, 60], def: 15 },      // 보스 등장 간격
  bossWaitSec: { list: [5, 8, 12, 20], def: 8 },          // 보스 잔류 시간
  bossLimitSec: { list: [20, 30, 45, 60], def: 30 },      // 보스 풀이 시간 (문제 풀이 보스)
  bossMode: { list: ['quiz', 'typing', 'none'], def: 'quiz' }, // 0.15.0: 보스 방식 — 문제 풀이 / 타이핑 · 1.1.0: 없음(보스 · 아이템 없이 타이핑만)
  bossLineSec: { list: [5, 7, 10, 12], def: 7 },          // 0.15.0: 타이핑 보스 줄마다 시간 (+ 기본 5초)
  blocks: { min: 24, max: 144, step: 12 },                 // 0 = 자동
  teams: { min: 2, max: 8, def: 4 },                       // 공식전: 팀 수
  roomTeams: { min: 2, max: 4, def: 2 },                   // 학생 팀 배틀: 팀 수 (v0.13.0)
  teamSize: { min: 1, max: 8, def: 4 },                    // 학생 팀 배틀: 팀마다 인원 (v0.13.0)
  botSpeed: { list: ['slow', 'normal', 'fast'], def: 'normal' }, // 비트 속도 (자유 플레이 · 공식전)
  game: { list: ['rush', 'flip'], def: 'rush' },           // 0.16.0: 게임 — 블록 러시 / 플립 배틀 (레이드는 늘 블록 러시)
  flipBlocks: { min: FLIP.minBlocks, max: FLIP.maxBlocks, step: 10 }, // 0.16.0: 플립 배틀 블록 수 (0 = 자동)
  flipTeamSize: { min: 1, max: 16, def: 8 },               // 0.16.0: 플립 배틀 팀 배틀 — 팀마다 인원 (팀은 늘 2)
};

function pickList(v, o) { v = Number(v); return o.list.includes(v) ? v : o.def; }
/** 범위 안의 정수로 (숫자가 아니면 기본값) */
function pickRange(v, o) {
  v = Math.round(Number(v));
  if (!Number.isFinite(v)) return o.def;
  return Math.max(o.min, Math.min(o.max, v));
}

/** v0.13.0: 자유 플레이(레이드 · 팀 배틀)은 이 값으로 고정 — 방 만들기에서 고르지 않는다 (공식전은 교사가 고름) */
const ROOM_FIXED = { occSec: 20, bossEverySec: 15, bossWaitSec: 8, bossLimitSec: 30, bossLineSec: 7, penalty: true };

/** 자유 플레이 설정: 브라우저에서 온 값 → 검사한 값 (고정 항목은 ROOM_FIXED). 태그가 없으면 null */
function cleanRoom(raw) {
  const c = clean(raw);
  return c ? Object.assign(c, ROOM_FIXED) : null;
}

/** 브라우저에서 온 설정 → 검사한 설정. 태그가 없으면 null */
function clean(raw) {
  raw = raw || {};
  const tags = Array.isArray(raw.tags) ? [...new Set(raw.tags.filter(t => TAGS.includes(t)))] : [];
  if (!tags.length) return null;
  const mode = raw.mode === 'battle' ? 'battle' : 'coop'; // v0.13.0: 레이드 / 팀 배틀
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
    bossMode: OPTIONS.bossMode.list.includes(raw.bossMode) ? raw.bossMode : OPTIONS.bossMode.def,
    bossLineSec: pickList(raw.bossLineSec, OPTIONS.bossLineSec),
    penalty: raw.penalty !== false,
    blocks,
    botSpeed: OPTIONS.botSpeed.list.includes(raw.botSpeed) ? raw.botSpeed : OPTIONS.botSpeed.def, // 비트 속도 (자유 플레이 v0.6.4 · 공식전)
  };
  out.game = 'rush';
  if (mode === 'battle') {
    out.teams = pickRange(raw.teams, OPTIONS.roomTeams);
    out.teamSize = pickRange(raw.teamSize, OPTIONS.teamSize);
    out.attacks = true; // 팀 배틀은 방해 아이템이 늘 나온다
    if (raw.game === 'flip') {
      flipify(out, raw);
      out.teamSize = pickRange(raw.teamSize, OPTIONS.flipTeamSize);
    }
    out.max = out.teams * out.teamSize;
  } else {
    out.max = pickRange(raw.max, OPTIONS.max); // 레이드는 늘 블록 러시
  }
  return out;
}

/** 0.16.0: 플립 배틀 설정으로 — 2팀 · 블록 수 40 ~ 320(10 단위, 0 = 자동) · 보스 없음 · 아이템은 아이템 블록에서(1.1.0) (게임 시간은 1.1.0 부터 블록 러시와 같이 1 ~ 10분) */
function flipify(out, raw) {
  out.game = 'flip';
  out.teams = 2;
  let b = Math.round(Number(raw.blocks) / 10) * 10;
  out.blocks = Number.isFinite(b) && b > 0 ? Math.max(OPTIONS.flipBlocks.min, Math.min(OPTIONS.flipBlocks.max, b)) : 0;
  out.attacks = false;
  out.items = raw.items !== false; // 1.1.0: 아이템 블록 나옴 / 없음 (처음 값 나옴)
  return out;
}

/** 공식전 설정 — 자유 플레이와 같고, 최대 인원 대신 팀 수. 태그가 없으면 null */
function cleanClass(raw) {
  const c = clean(raw);
  if (!c) return null;
  delete c.max;
  delete c.mode;
  let teams = Math.round(Number(raw.teams));
  if (!Number.isFinite(teams)) teams = OPTIONS.teams.def;
  c.teams = Math.max(OPTIONS.teams.min, Math.min(OPTIONS.teams.max, teams));
  if (raw.game === 'flip') {
    // 블록 러시로 돌아갈 때 쓸 팀 수 — 화면이 보낸 rushTeams(플립 배틀 동안 계속 들고 다님), 없으면 바꾸기 전 teams
    const rt = Math.round(Number(raw.rushTeams));
    c.rushTeams = Number.isFinite(rt) && rt >= OPTIONS.teams.min ? Math.min(OPTIONS.teams.max, rt) : c.teams;
    flipify(c, raw);
  } // 0.16.0: 플립 배틀 — 팀 2개 고정 (교사 화면은 팀 수를 숨김). 블록 러시로 돌아갈 때 쓸 팀 수는 rushTeams 에 기억
  // 0.14.0: 교사 화면의 스위치를 없앰 — 방해 아이템 · 학생 효과음 · 전광판 배경음은 늘 켬
  c.attacks = c.game !== 'flip' && c.bossMode !== 'none'; // 1.1.0: 보스가 없으면 아이템도 없다
  c.sfx = true;
  c.bgm = true;
  return c;
}

module.exports = { OPTIONS, ROOM_FIXED, clean, cleanRoom, cleanClass };
