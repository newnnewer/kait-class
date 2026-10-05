/*
 * 대기실 채팅 문구 (v0.7.3) — 서버와 브라우저가 같은 파일을 쓴다.
 *   정해 둔 문구만 보낼 수 있다 (자유 입력 없음). 게임 중에는 채팅 없음.
 *   학생 방 대기실 · 수업 게임 조 선택 화면에서만.
 *   only: 'room' = 학생 방에서만 · 'class' = 수업 게임에서만
 *   'ㅎㅎㅎ'는 어느 탭에서나 마지막 칸에 있다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CGChat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TABS = [
    { id: 'reply', name: '응답', list: [
      { id: 'ok', text: '좋아요! 👍' },
      { id: 'gotit', text: '알겠어! 👌' },
      { id: 'hmm', text: '그건 좀… 🤔' },
      { id: 'well', text: '글쎄… 😅' },
      { id: 'metoo', text: '나도! 🙋' },
    ] },
    { id: 'hi', name: '인사', list: [
      { id: 'hello', text: '안녕! 👋' },
      { id: 'please', text: '잘 부탁해!' },
      { id: 'glad', text: '반가워!' },
    ] },
    { id: 'ready', name: '준비', list: [
      { id: 'ready', text: '준비됐어요!' },
      { id: 'wait', text: '잠깐만요! ✋' },
      { id: 'go', text: '시작해요! 🚀' },
      { id: 'bot', text: '봇 넣을까요? 🤖', only: 'room' },
    ] },
    { id: 'plan', name: '작전', list: [
      { id: 'left', text: '왼쪽 맡을게!' },
      { id: 'right', text: '오른쪽 맡을게!' },
      { id: 'boss', text: '보스는 내가! 👑' },
      { id: 'gather', text: '집결 보스 나오면 모이자!' },
      { id: 'shield', text: '방패 아껴 두자! 🛡', only: 'class' },
    ] },
    { id: 'after', name: '끝난 뒤', list: [
      { id: 'again', text: '한 판 더! 🔁' },
      { id: 'gj', text: '수고했어! 👏' },
      { id: 'next', text: '다음엔 이기자! 🔥' },
    ] },
  ];
  var HEHE = { id: 'hehe', text: 'ㅎㅎㅎ 😆' };
  var GAP_MS = 2000; // 한 사람이 2초에 한 번만

  /** 탭 하나의 문구 (mode: 'room' | 'class') — 마지막은 늘 ㅎㅎㅎ */
  function listFor(tabId, mode) {
    var tab = TABS.filter(function (t) { return t.id === tabId; })[0] || TABS[0];
    return tab.list.filter(function (x) { return !x.only || x.only === mode; }).concat([HEHE]);
  }

  /** 문구 id → 문구 (그 모드에서 쓸 수 없으면 null) */
  function find(id, mode) {
    if (id === HEHE.id) return HEHE;
    for (var k = 0; k < TABS.length; k++) {
      for (var j = 0; j < TABS[k].list.length; j++) {
        var x = TABS[k].list[j];
        if (x.id === id) return (!x.only || x.only === mode) ? x : null;
      }
    }
    return null;
  }

  return { TABS: TABS, HEHE: HEHE, GAP_MS: GAP_MS, listFor: listFor, find: find };
});
