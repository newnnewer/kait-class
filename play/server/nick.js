'use strict';
// 무작위 닉네임 — 학생은 '다시 뽑기'만 할 수 있다 (직접 입력 없음)

const ADJ = ['날쌘', '졸린', '용감한', '번개', '수줍은', '배고픈', '엉뚱한', '씩씩한', '느긋한', '반짝이는',
  '행복한', '신나는', '조용한', '똑똑한', '재빠른', '든든한', '말랑한', '튼튼한', '상냥한', '당당한',
  // v0.13.0
  '꼼꼼한', '부지런한', '힘센', '명랑한', '다정한', '쾌활한', '늠름한', '영리한', '귀여운', '우아한',
  '활발한', '차분한', '포근한', '상큼한', '대담한', '의젓한', '기운찬', '슬기로운', '유쾌한', '깜찍한'];
const ANI = ['여우', '판다', '수달', '펭귄', '고래', '다람쥐', '햄스터', '부엉이', '고슴도치', '너구리',
  '토끼', '거북이', '코알라', '돌고래', '미어캣', '알파카', '라쿤', '두더지', '참새', '물개',
  // v0.13.0
  '사자', '호랑이', '기린', '코끼리', '하마', '앵무새', '독수리', '치타', '낙타', '사슴',
  '오리', '병아리', '강아지', '북극곰', '나무늘보', '비버', '플라밍고', '카멜레온', '청설모', '해마'];

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

/** 닉네임의 앞부분 (형용사 + 동물) — '날쌘 여우 42' → '날쌘 여우' */
function stem(n) { return String(n).replace(/\s*\d+$/, ''); }

/**
 * taken: 이미 쓰고 있는 닉네임 (Set)
 * v0.13.0: 지금 쓰는 닉네임과 앞부분(형용사 + 동물)이 같은 것도 피한다 (숫자만 다른 같은 이름이 헷갈려서).
 *   형용사 40 × 동물 40 = 1600가지라 거의 늘 찾는다. 못 찾으면 숫자만 다르게라도.
 */
function rollNick(taken) {
  const stems = new Set();
  if (taken) for (const t of taken) stems.add(stem(t));
  for (let i = 0; i < 80; i++) {
    const a = pick(ADJ), b = pick(ANI);
    const n = `${a} ${b} ${String(Math.floor(Math.random() * 90) + 10)}`;
    if (!stems.has(`${a} ${b}`)) return n;
  }
  for (let i = 0; i < 50; i++) {
    const n = `${pick(ADJ)} ${pick(ANI)} ${String(Math.floor(Math.random() * 90) + 10)}`;
    if (!taken || !taken.has(n)) return n;
  }
  return `${pick(ADJ)} ${pick(ANI)} ${Date.now() % 1000}`;
}

const CHARS = ['slime', 'robot', 'cat', 'ghost', 'owl', 'dino', 'alien', 'frog'];
const COLORS = ['#FFD23F', '#45B1F5', '#FF8FB1', '#7EE0B5', '#FFB347', '#C9A2FF', '#F2F4FA', '#FF6B6B'];

module.exports = { rollNick, stem, ADJ, ANI, CHARS, COLORS };
