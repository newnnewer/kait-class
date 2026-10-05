'use strict';
// v0.7.1: 레이더 뺌 · 쉬운 길은 내 둘레 8칸
// 아이템 — 보스를 맞히면 잡은 사람의 개인 덱에 들어가고, 원할 때 Ctrl+Shift+1~5 로 쓴다 (v0.7.0).
//   페널티만 바로 발동. 방패는 덱과 따로 (최대 2개), 공격이 올 때 2초 안에 Ctrl+Shift+9 로 직접 막는다.
//   v0.11.0 확률 (RATE):
//     방해 켜진 수업 게임:        도움 50%(5종 각 10%) · 페널티 15%(3종 각 5%) · 방해 20%(5종 각 4%) · 방패 15%
//     학생 방 · 방해 꺼진 수업 게임: 도움 85%(5종 각 17%) · 페널티 15%
//   페널티를 끈 방은 페널티 몫이 우리 조 도움으로 간다

const GOOD = [
  { id: 'bomb', name: '폭탄', desc: '내 둘레 8칸이 모두 해결됐어요' },
  { id: 'laser', name: '가로 레이저', desc: '내 가로줄의 남은 블록이 모두 해결됐어요' },
  { id: 'vlaser', name: '세로 레이저', desc: '내 세로줄의 남은 블록이 모두 해결됐어요' },
  { id: 'auto', name: '자동완성', desc: '10초 동안 앞부분을 치고 Tab 을 누르면 완성!' },
  { id: 'easy', name: '쉬운 길', desc: '내 둘레 블록이 짧은 코드로 바뀌었어요' },
];
// 수업 게임(방해 켜짐)에서만: 다음 방해 공격 1번을 막는다 (최대 2개)
const SHIELD = { id: 'shield', name: '방패', desc: '다음 방해 공격을 한 번 막아요' };
const MAX_SHIELD = 2;
const BAD = [
  { id: 'freeze', name: '자폭', desc: '우리 조 전원 5초 동안 얼음!' },
  { id: 'backfire', name: '역풍', desc: '해결한 블록 4개가 되살아났어요' },
  { id: 'confuse', name: '혼란', desc: '8초 동안 방향키가 반대로!' },
];
// 다른 조 방해 (수업 게임만) — 대상: 바로 위 순위 조
const ATTACK = [
  { id: 'ice', name: '얼음', desc: '전원 8초 동안 입력 금지' },
  { id: 'cloud', name: '먹구름', desc: '8초 동안 코드가 가려져요' },
  { id: 'revive', name: '되살리기', desc: '해결한 칸 6개가 되살아나요' },
  { id: 'shuffle', name: '뒤섞기', desc: '조원이 모두 한 칸에 모여요' },
  { id: 'flip', name: '방향 반전', desc: '8초 동안 방향키가 반대로' },
];

// 아이템마다 효과 시간 (v0.5.4 강화: 얼음·먹구름·방향 반전·혼란 8초, 자폭은 5초 그대로)
const ITEM_MS = { auto: 10000, freeze: 5000, confuse: 8000, ice: 8000, cloud: 8000, flip: 8000 };
// 효과 종류(학생 화면 fx 이름) — 얼음·자폭은 freeze, 방향 반전·혼란은 confuse
const FX_OF = { auto: 'auto', freeze: 'freeze', confuse: 'confuse', ice: 'freeze', cloud: 'cloud', flip: 'confuse' };
// 아이템 수치
const POWER = { easy: 8, revive: 6, backfire: 4 };
const EFFECT_MS = ITEM_MS; // 예전 이름 (호환)

function pick(a, rng) { return a[Math.floor((rng || Math.random)() * a.length)]; }

// 보스 아이템 확률 (v0.11.0) — 남는 몫은 모두 도움
const RATE = { bad: 0.15, attack: 0.20, shield: 0.15 };

/**
 * 어떤 아이템이 나올지
 *   penalty: 페널티 켜짐 · attacks: 방해 아이템 켜짐(수업 게임) · force: 시험용 아이템 id
 */
function rollItem({ penalty = true, attacks = false, rng, force } = {}) {
  if (force) {
    const g = GOOD.concat([SHIELD]).find(x => x.id === force), b = BAD.find(x => x.id === force), a = ATTACK.find(x => x.id === force);
    if (g) return { ...g, kind: 'good' };
    if (b) return { ...b, kind: 'bad' };
    if (a) return { ...a, kind: 'attack' };
  }
  const r = (rng || Math.random)();
  let edge = 0;
  if (penalty && r < (edge += RATE.bad)) return { ...pick(BAD, rng), kind: 'bad' };
  if (attacks) {
    if (r < (edge += RATE.attack)) return { ...pick(ATTACK, rng), kind: 'attack' };
    if (r < (edge += RATE.shield)) return { ...SHIELD, kind: 'good' };
  }
  return { ...pick(GOOD, rng), kind: 'good' };
}

/** 도움 아이템 하나 (집결 보스 보상) — shield: 방패도 15% 로 나올 수 있음 (방해 켜진 수업 게임) */
function rollHelp({ shield = false, rng } = {}) {
  if (shield && (rng || Math.random)() < RATE.shield) return { ...SHIELD, kind: 'good' };
  return { ...pick(GOOD, rng), kind: 'good' };
}

/** 배열에서 n개 무작위로 */
function sample(arr, n) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

const DECK_SIZE = 5;      // 개인 덱 칸 수 (Ctrl+Shift+1~5)
const DEFEND_MS = 2000;   // 공격이 들어오기까지 막을 수 있는 시간 (Ctrl+Shift+9)

module.exports = { RATE, GOOD, BAD, ATTACK, SHIELD, MAX_SHIELD, DECK_SIZE, DEFEND_MS, EFFECT_MS, ITEM_MS, FX_OF, POWER, rollItem, rollHelp, sample };
