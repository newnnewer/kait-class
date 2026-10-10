'use strict';
// 씨앗(seed)이 같으면 항상 같은 순서가 나오는 난수.
// 공식전에서 모든 팀에 같은 배치·문제 순서를 주는 데 쓴다.

function makeRng(seed) {
  let a = seed >>> 0;
  return function () { // mulberry32
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomSeed() { return (Math.random() * 0xFFFFFFFF) >>> 0; }

module.exports = { makeRng, shuffle, randomSeed };
