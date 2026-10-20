/*
 * 팀 이름 (0.14.0) — 서버와 브라우저가 같은 파일을 쓴다.
 *   '1팀 · 2팀 …' 대신 컴퓨터과학자 8명의 이름. 공식전 · 팀 배틀 방을 만들 때 무작위로 한 번 뽑고
 *   닫을 때까지 그대로 (공식전은 교사가 게임 전에 다시 뽑을 수 있다). 한 판 안에서는 겹치지 않는다.
 *   팀 번호(1~8)는 그대로 — 팀 색 · 방해 아이템 대상 고르기(숫자 키)는 번호를 쓴다.
 *   names: 번호 순서의 이름 배열 (names[0] = 1번 팀). 없으면 예전처럼 'N팀'.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CGTeams = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 시대순
  var LIST = [
    { name: '알콰리즈미', desc: "'알고리즘'이라는 말이 이 사람 이름에서 왔어요" },
    { name: '러브레이스', desc: '세계 최초의 프로그래머' },
    { name: '튜링', desc: '컴퓨터 과학의 아버지' },
    { name: '폰노이만', desc: '오늘날 컴퓨터의 구조를 설계했어요' },
    { name: '호퍼', desc: "컴파일러를 만들고 '버그'라는 말을 퍼뜨렸어요" },
    { name: '섀넌', desc: "정보 이론을 세우고 '비트'를 널리 알렸어요" },
    { name: '다익스트라', desc: '최단 경로 알고리즘을 만들었어요' },
    { name: '반로섬', desc: '파이썬을 만든 사람' },
  ];
  var CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];

  /** 무작위로 8명을 섞은 이름 배열 (rng: 0~1 을 돌려주는 함수) */
  function roll(rng) {
    var r = rng || Math.random;
    var a = LIST.map(function (x) { return x.name; });
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  /** 이름만 (예: '튜링'). 이름이 없으면 'N팀' */
  function name(names, no) {
    var n = names && names[no - 1];
    return n || no + '팀';
  }
  /** 'OO 팀' (예: '튜링 팀'). 이름이 없으면 'N팀' */
  function label(names, no) {
    var n = names && names[no - 1];
    return n ? n + ' 팀' : no + '팀';
  }
  /** 번호 붙인 것 (예: '① 튜링 팀') — 숫자 키로 고를 때 */
  function numbered(names, no) {
    var n = names && names[no - 1];
    return n ? (CIRCLED[no - 1] || no) + ' ' + n + ' 팀' : no + '팀';
  }
  /** 한 줄 소개 */
  function desc(names, no) {
    var n = names && names[no - 1];
    for (var k = 0; k < LIST.length; k++) if (LIST[k].name === n) return LIST[k].desc;
    return '';
  }

  return { LIST: LIST, roll: roll, name: name, label: label, numbered: numbered, desc: desc };
});
