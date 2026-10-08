/*
 * 입력란 흐린 글씨 (v0.12.0) — 친 글자를 코드에 맞춰 본다. 서버 시험과 브라우저가 같은 파일을 쓴다.
 *
 * 채점(server/game/grade.js)과 같은 기준:
 *   · 따옴표 밖의 띄어쓰기는 무시한다 — 코드 쪽 빈칸은 건너뛰고, 내가 더 친 빈칸도 무시
 *       'a = b + c' 에 'a='  → 커서는 '=' 다음
 *       'else:'     에 'else ' → 커서는 'e' 와 ':' 사이 그대로
 *   · 문자열 안은 빈칸까지 정확히
 *   · 작은따옴표 · 큰따옴표는 같게 (문자열 안에 따옴표가 없을 때만 — 'It\'s' 같은 건 그대로 쳐야 함)
 *
 * align(code, typed) → { pos, bad, done }
 *   pos : 코드에서 여기까지 맞게 쳤다 (다음에 칠 글자 앞, 따옴표 밖 빈칸은 건너뛴 자리)
 *   bad : 처음 틀린 글자가 typed 의 몇 번째인가 (-1 = 틀린 것 없음)
 *   done: 코드를 끝까지 다 쳤다
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CGTyping = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function isQ(ch) { return ch === '\'' || ch === '"'; }
  function isSp(ch) { return /\s/.test(ch); }

  /** 코드의 문자열 위치: open 인덱스 → { close, flex(따옴표 바꿔 쳐도 됨) } */
  function strings(code) {
    var out = {}, i = 0;
    while (i < code.length) {
      if (isQ(code[i])) {
        var q = code[i], j = i + 1, inner = '';
        while (j < code.length && code[j] !== q) {
          if (code[j] === '\\' && j + 1 < code.length) { inner += code[j] + code[j + 1]; j += 2; continue; }
          inner += code[j]; j++;
        }
        if (j >= code.length) break; // 짝이 안 맞는 코드: 그 뒤는 그냥 글자로
        out[i] = { close: j, flex: inner.indexOf('\'') < 0 && inner.indexOf('"') < 0 };
        i = j + 1;
        continue;
      }
      i++;
    }
    return out;
  }

  function align(code, typed) {
    code = String(code || ''); typed = String(typed || '');
    var S = strings(code);
    var i = 0, k = 0, str = null; // str: 지금 문자열 안 { close, q(내가 친 여는 따옴표) }
    function skip() { if (!str) while (i < code.length && isSp(code[i])) i++; }
    skip();
    for (; k < typed.length; k++) {
      var t = typed[k];
      if (!str && isSp(t)) continue;           // 따옴표 밖에서 더 친 빈칸은 무시
      skip();
      if (i >= code.length) return { pos: i, bad: k, done: true };
      var c = code[i], ok;
      if (str && i === str.close) {
        ok = str.flex ? t === str.q : t === c;  // 닫는 따옴표는 연 따옴표와 같아야 함
        if (ok) str = null;
      } else if (!str && S[i]) {
        ok = S[i].flex ? isQ(t) : t === c;
        if (ok) str = { close: S[i].close, flex: S[i].flex, q: t };
      } else ok = t === c;
      if (!ok) return { pos: i, bad: k, done: false };
      i++;
      skip();
    }
    return { pos: i, bad: -1, done: i >= code.length };
  }

  return { align: align };
});
