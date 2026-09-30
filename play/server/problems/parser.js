'use strict';
// 문제 은행 형식 해석기 — 초기 등록과 관리자 '붙여넣기로 추가'가 함께 쓴다.
//
//   // 설명            → 무시
//   [일반 문제] / [보스 문제]  → 구역 표시
//   # 태그1, 태그2      → 그 아래 일반 문제에 붙을 태그
//   === 제목 # 태그     → 보스 문제 시작, 이어서 코드 … (선택) 입력: … → 정답: 답1 | 답2

const TAGS = ['출력', '입력', '변수', '연산자', '조건문', '반복문', '리스트', '함수'];

// 같은 문제인지 비교할 때 쓰는 열쇠 (띄어쓰기 무시)
function sameKey(code) { return String(code).replace(/\s+/g, ''); }

function parseTags(s, errors, lineNo) {
  const tags = [];
  for (const t of String(s).split(',').map(x => x.trim()).filter(Boolean)) {
    if (!TAGS.includes(t)) { errors.push(`${lineNo}번째 줄: 모르는 태그 "${t}"`); continue; }
    if (!tags.includes(t)) tags.push(t);
  }
  return tags;
}

const HANGUL = /[ㄱ-ㆎ가-힣]/;

function parseBank(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const errors = [];
  const normal = new Map(); // sameKey → {code, tags}
  const boss = [];
  let section = 'normal';
  let tags = [];
  let cur = null; // 만들고 있는 보스 문제

  function closeBoss(lineNo) {
    if (!cur) return;
    while (cur.code.length && cur.code[cur.code.length - 1].trim() === '') cur.code.pop();
    if (!cur.code.length) errors.push(`${cur.line}번째 줄 보스 "${cur.title}": 코드가 없어요`);
    else if (!cur.answers.length) errors.push(`${cur.line}번째 줄 보스 "${cur.title}": 정답이 없어요`);
    else if (!cur.tags.length) errors.push(`${cur.line}번째 줄 보스 "${cur.title}": 태그가 없어요`);
    else {
      const code = cur.code.join('\n');
      if (HANGUL.test(code) || cur.answers.some(a => HANGUL.test(a))) errors.push(`${cur.line}번째 줄 보스 "${cur.title}": 코드·정답에 한글이 있어요`);
      else boss.push({ title: cur.title, code, input: cur.input, answers: cur.answers, tags: cur.tags });
    }
    cur = null;
  }

  lines.forEach((raw, i) => {
    const n = i + 1;
    const line = raw.replace(/\s+$/, '');
    const t = line.trim();
    if (t.startsWith('//')) return;
    if (t === '[일반 문제]') { closeBoss(n); section = 'normal'; tags = []; return; }
    if (t === '[보스 문제]') { closeBoss(n); section = 'boss'; return; }

    if (section === 'normal') {
      if (!t) return;
      if (t.startsWith('#')) { tags = parseTags(t.slice(1), errors, n); return; }
      if (!tags.length) { errors.push(`${n}번째 줄: 태그 줄(# 태그)보다 먼저 나온 문제`); return; }
      if (HANGUL.test(t)) { errors.push(`${n}번째 줄: 코드에 한글이 있어요`); return; }
      const key = sameKey(t);
      const old = normal.get(key);
      if (old) { for (const g of tags) if (!old.tags.includes(g)) old.tags.push(g); }
      else normal.set(key, { code: t, tags: tags.slice() });
      return;
    }

    // 보스 구역
    const head = t.match(/^===\s*(.+?)\s*#\s*(.+)$/);
    if (head) {
      closeBoss(n);
      cur = { line: n, title: head[1], tags: parseTags(head[2], errors, n), code: [], input: null, answers: [], done: false };
      return;
    }
    if (!cur) { if (t) errors.push(`${n}번째 줄: 보스 문제는 "=== 제목 # 태그" 로 시작해야 해요`); return; }
    if (cur.done) { if (t) errors.push(`${n}번째 줄: 정답 줄 다음에 온 내용 (보스 "${cur.title}")`); return; }
    const inp = t.match(/^입력:\s?(.*)$/);
    if (inp) { cur.input = inp[1]; return; }
    const ans = t.match(/^정답:\s*(.*)$/);
    if (ans) {
      cur.answers = ans[1].split('|').map(x => x.trim()).filter(Boolean);
      cur.done = true;
      return;
    }
    if (!t && !cur.code.length) return;
    cur.code.push(line); // 들여쓰기 유지
  });
  closeBoss(lines.length);

  return { normal: [...normal.values()], boss, errors };
}

module.exports = { parseBank, sameKey, TAGS };
