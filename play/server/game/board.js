'use strict';
// 판 만들기 — 씨앗이 같으면 같은 판이 나온다

const { makeRng, shuffle } = require('../rng');

const COLS = 12;

/** 블록 수: 24~144 사이 12의 배수로 맞춘다 */
function clampBlocks(n) {
  n = Math.round(Number(n) / COLS) * COLS;
  if (!Number.isFinite(n)) n = 96;
  return Math.max(24, Math.min(144, n));
}

/** 추천 블록 수 = 인원 × 24 (최대 96) */
function recommendBlocks(people) {
  return clampBlocks(Math.min(96, Math.max(1, people) * 24));
}

/**
 * codes: 출제할 일반 문제 코드 목록 (블록 수보다 적으면 반복)
 */
function createBoard({ blocks, seed, codes }) {
  const n = clampBlocks(blocks);
  const rng = makeRng(seed);
  let pool = [];
  while (pool.length < n) pool = pool.concat(shuffle(codes, rng));
  const cells = pool.slice(0, n).map(code => ({ code, solved: false, by: null }));
  const board = {
    cols: COLS,
    rows: n / COLS,
    cells,
    seed,
    solved(i) { return cells[i].solved; },
    blocked() { return false; }, // 보스는 3단계에서
  };
  return board;
}

module.exports = { COLS, clampBlocks, recommendBlocks, createBoard };
