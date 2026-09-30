'use strict';
// 무작위 닉네임 — 학생은 '다시 뽑기'만 할 수 있다 (직접 입력 없음)

const ADJ = ['날쌘', '졸린', '용감한', '번개', '수줍은', '배고픈', '엉뚱한', '씩씩한', '느긋한', '반짝이는',
  '행복한', '신나는', '조용한', '똑똑한', '재빠른', '든든한', '말랑한', '튼튼한', '상냥한', '당당한'];
const ANI = ['여우', '판다', '수달', '펭귄', '고래', '다람쥐', '햄스터', '부엉이', '고슴도치', '너구리',
  '토끼', '거북이', '코알라', '돌고래', '미어캣', '알파카', '라쿤', '두더지', '참새', '물개'];

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

/** taken: 이미 쓰고 있는 닉네임 (Set) */
function rollNick(taken) {
  for (let i = 0; i < 50; i++) {
    const n = `${pick(ADJ)} ${pick(ANI)} ${String(Math.floor(Math.random() * 90) + 10)}`;
    if (!taken || !taken.has(n)) return n;
  }
  return `${pick(ADJ)} ${pick(ANI)} ${Date.now() % 1000}`;
}

const CHARS = ['slime', 'robot', 'cat', 'ghost', 'owl', 'dino'];
const COLORS = ['#FFD23F', '#45B1F5', '#FF8FB1', '#7EE0B5', '#FFB347', '#C9A2FF'];

module.exports = { rollNick, CHARS, COLORS };
