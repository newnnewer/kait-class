'use strict';
// 학생 방 설정 — 고를 수 있는 값과 기본값. 브라우저에서 온 값은 여기서 다시 검사한다.

const { TAGS } = require('../problems/parser');

const OPTIONS = {
  max: { min: 2, max: 16, def: 4 },
  limitMin: { min: 1, max: 30, def: 5 },                   // 제한 시간(분, 1분 단위 직접 입력)
  occSec: { list: [10, 15, 20, 30], def: 20 },            // 블록 점유 시간 (v0.12.0: 10~30초, 기본 20초)
  bossEverySec: { list: [10, 15, 30, 60], def: 15 },      // 보스 등장 간격
  bossWaitSec: { list: [5, 8, 12, 20], def: 8 },          // 보스 잔류 시간
  bossLimitSec: { list: [20, 30, 45, 60], def: 30 },      // 보스 풀이 시간
  blocks: { min: 24, max: 144, step: 12 },                 // 0 = 자동
  teams: { min: 2, max: 8, def: 4 },                       // 수업 게임: 조 수
  botSpeed: { list: ['slow', 'normal', 'fast'], def: 'normal' }, // 봇 속도 (학생 방 · 수업 게임)
};

function pickList(v, o) { v = Number(v); return o.list.includes(v) ? v : o.def; }
/** 범위 안의 정수로 (숫자가 아니면 기본값) */
function pickRange(v, o) {
  v = Math.round(Number(v));
  if (!Number.isFinite(v)) return o.def;
  return Math.max(o.min, Math.min(o.max, v));
}

/** 브라우저에서 온 설정 → 검사한 설정. 태그가 없으면 null */
function clean(raw) {
  raw = raw || {};
  const tags = Array.isArray(raw.tags) ? [...new Set(raw.tags.filter(t => TAGS.includes(t)))] : [];
  if (!tags.length) return null;
  const max = pickRange(raw.max, OPTIONS.max);
  let blocks = Math.round(Number(raw.blocks) / 12) * 12;
  if (!Number.isFinite(blocks) || blocks <= 0) blocks = 0; // 자동
  else blocks = Math.max(OPTIONS.blocks.min, Math.min(OPTIONS.blocks.max, blocks));
  return {
    tags: TAGS.filter(t => tags.includes(t)), // 늘 같은 순서로
    max,
    limitMin: pickRange(raw.limitMin, OPTIONS.limitMin),
    occSec: pickList(raw.occSec, OPTIONS.occSec),
    bossEverySec: pickList(raw.bossEverySec, OPTIONS.bossEverySec),
    bossWaitSec: pickList(raw.bossWaitSec, OPTIONS.bossWaitSec),
    bossLimitSec: pickList(raw.bossLimitSec, OPTIONS.bossLimitSec),
    penalty: raw.penalty !== false,
    blocks,
    botSpeed: OPTIONS.botSpeed.list.includes(raw.botSpeed) ? raw.botSpeed : OPTIONS.botSpeed.def, // 봇 속도 (학생 방 v0.6.4 · 수업 게임)
  };
}

/** 수업 게임 설정 — 학생 방과 같고, 최대 인원 대신 조 수. 태그가 없으면 null */
function cleanClass(raw) {
  const c = clean(raw);
  if (!c) return null;
  delete c.max;
  let teams = Math.round(Number(raw.teams));
  if (!Number.isFinite(teams)) teams = OPTIONS.teams.def;
  c.teams = Math.max(OPTIONS.teams.min, Math.min(OPTIONS.teams.max, teams));
  c.attacks = raw.attacks !== false; // 방해 아이템 (게임 중에도 교사가 켜고 끔)
  c.sfx = raw.sfx !== false;         // 학생 기기 효과음 (6-2, 게임 중에도 켜고 끔)
  c.bgm = raw.bgm !== false;         // 전광판 배경음
  return c;
}

module.exports = { OPTIONS, clean, cleanClass };
