'use strict';
// 채점 — 일반 블록과 보스가 함께 쓴다.
//
// 글자를 그대로 비교하지 않고, 코드를 '문자열'과 '나머지'로 나눠서 비교한다.
//   · 따옴표 밖의 띄어쓰기는 무시한다          print( 1 )  ==  print(1)
//   · 문자열 안의 글자·띄어쓰기는 정확히 비교한다  'a b'  !=  'ab'
//   · 작은따옴표와 큰따옴표는 같게 본다          'hi'  ==  "hi"
//   · 따옴표 짝이 맞지 않으면 오답이다           print('It's ok')  →  오답

/** 코드 → 조각 목록. 따옴표 짝이 안 맞으면 null */
function tokenize(src) {
  const s = String(src);
  const out = [];
  let code = '';
  let i = 0;
  const flush = () => { if (code) { out.push({ k: 'c', v: code }); code = ''; } };
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\'' || ch === '"') {
      flush();
      const q = ch;
      let j = i + 1, v = '';
      while (j < s.length && s[j] !== q) {
        if (s[j] === '\\' && j + 1 < s.length) { v += s[j] + s[j + 1]; j += 2; continue; }
        if (s[j] === '\n') return null;
        v += s[j]; j++;
      }
      if (j >= s.length) return null; // 닫는 따옴표가 없다
      out.push({ k: 's', v });
      i = j + 1;
      continue;
    }
    if (!/\s/.test(ch)) code += ch;
    i++;
  }
  flush();
  return out;
}

function same(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].k !== b[i].k || a[i].v !== b[i].v) return false;
  }
  return true;
}

/** 입력이 정답(들) 중 하나와 같은가 */
function isCorrect(input, answers) {
  const t = tokenize(input);
  if (!t) return false;
  const list = Array.isArray(answers) ? answers : [answers];
  return list.some(a => same(t, tokenize(a)));
}

/**
 * 보스 '출력 결과 맞히기'(코드에 ___ 가 없는 문제)는 답이 코드가 아니라 출력이다.
 * 따옴표도 그냥 글자이므로, 띄어쓰기만 빼고 그대로 비교한다.
 */
function isCorrectOutput(input, answers) {
  const n = x => String(x).replace(/\s+/g, '');
  const t = n(input);
  if (!t) return false;
  const list = Array.isArray(answers) ? answers : [answers];
  return list.some(a => n(a) === t);
}

/** 보스 문제 채점: 빈칸(___) 문제는 코드 비교, 아니면 출력 비교 */
function isBossCorrect(boss, input) {
  return boss.code.includes('___') ? isCorrect(input, boss.answers) : isCorrectOutput(input, boss.answers);
}

module.exports = { tokenize, isCorrect, isCorrectOutput, isBossCorrect };
