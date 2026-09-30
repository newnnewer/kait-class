/* 캐릭터 그림 (직접 디자인한 오리지널 캐릭터 6종) — SVG 문자열을 만든다 */
/* 브라우저 저장소 이름 옮기기 (v0.9.0): 예전 'cg.' 로 저장한 값(닉네임 · 캐릭터 · 교사 로그인 · 설정)을
   'kp.' 로 한 번 복사한다. 이 파일은 학생 · 교사 · 전광판 화면 모두에서 가장 먼저 읽힌다. */
(function () {
  try {
    if (localStorage.getItem('kp.moved')) return;
    var keys = [];   // 먼저 이름을 모아 둔다 (넣는 동안 순서가 바뀌므로)
    for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    keys.forEach(function (k) {
      if (k && k.indexOf('cg.') === 0 && localStorage.getItem('kp.' + k.slice(3)) === null) {
        localStorage.setItem('kp.' + k.slice(3), localStorage.getItem(k));
      }
    });
    localStorage.setItem('kp.moved', '1');
  } catch (e) { /* 저장소를 못 써도 게임은 된다 */ }
})();

(function () {
  'use strict';
  var INK = '#0B1030';

  var PARTS = {
    slime: function (c) {
      return '<path d="M5 28 C5 17 9 9 16 9 C23 9 27 17 27 28 Z" fill="' + c + '" stroke="' + INK + '" stroke-width="1.6" stroke-linejoin="round"/>' +
        '<path d="M10 15 C11 12.5 13 11.4 15 11.2" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".75"/>' +
        '<circle cx="12.5" cy="19.5" r="2.2" fill="' + INK + '"/><circle cx="19.5" cy="19.5" r="2.2" fill="' + INK + '"/>' +
        '<circle cx="13.2" cy="18.8" r=".7" fill="#fff"/><circle cx="20.2" cy="18.8" r=".7" fill="#fff"/>' +
        '<path d="M14 23.6 Q16 25.2 18 23.6" stroke="' + INK + '" stroke-width="1.4" fill="none" stroke-linecap="round"/>';
    },
    robot: function (c) {
      return '<line x1="16" y1="3.8" x2="16" y2="8" stroke="' + INK + '" stroke-width="1.6"/>' +
        '<circle cx="16" cy="3.6" r="1.9" fill="#FF5C8A" stroke="' + INK + '" stroke-width="1.2"/>' +
        '<rect x="6" y="8" width="20" height="15" rx="3.5" fill="' + c + '" stroke="' + INK + '" stroke-width="1.6"/>' +
        '<rect x="9" y="12" width="14" height="6.5" rx="2" fill="' + INK + '"/>' +
        '<rect x="11" y="14.2" width="3.2" height="2.2" fill="#7CF5FF"/><rect x="17.8" y="14.2" width="3.2" height="2.2" fill="#7CF5FF"/>' +
        '<rect x="10" y="23" width="12" height="5.6" rx="1.6" fill="' + c + '" stroke="' + INK + '" stroke-width="1.6"/>';
    },
    cat: function (c) {
      return '<path d="M7.5 15 L8.5 4.8 L15 10.5 Z" fill="' + c + '" stroke="' + INK + '" stroke-width="1.6" stroke-linejoin="round"/>' +
        '<path d="M24.5 15 L23.5 4.8 L17 10.5 Z" fill="' + c + '" stroke="' + INK + '" stroke-width="1.6" stroke-linejoin="round"/>' +
        '<circle cx="16" cy="18.5" r="10" fill="' + c + '" stroke="' + INK + '" stroke-width="1.6"/>' +
        '<ellipse cx="12" cy="17.8" rx="1.6" ry="2.4" fill="' + INK + '"/><ellipse cx="20" cy="17.8" rx="1.6" ry="2.4" fill="' + INK + '"/>' +
        '<path d="M15 21.4 L17 21.4 L16 22.8 Z" fill="#FF5C8A"/>' +
        '<line x1="4" y1="20" x2="9.5" y2="21" stroke="' + INK + '" stroke-width="1"/><line x1="28" y1="20" x2="22.5" y2="21" stroke="' + INK + '" stroke-width="1"/>';
    },
    ghost: function (c) {
      return '<path d="M6 28.5 V15 A10 10 0 0 1 26 15 V28.5 L22.7 25.8 L19.3 28.5 L16 25.8 L12.7 28.5 L9.3 25.8 Z" fill="' + c + '" stroke="' + INK + '" stroke-width="1.6" stroke-linejoin="round"/>' +
        '<ellipse cx="12.5" cy="16" rx="2" ry="2.9" fill="' + INK + '"/><ellipse cx="19.5" cy="16" rx="2" ry="2.9" fill="' + INK + '"/>' +
        '<ellipse cx="10" cy="20.5" rx="1.6" ry="1" fill="#FF5C8A" opacity=".6"/><ellipse cx="22" cy="20.5" rx="1.6" ry="1" fill="#FF5C8A" opacity=".6"/>';
    },
    owl: function (c) {
      return '<path d="M8 11 L7 4 L12.5 8 Z" fill="' + c + '" stroke="' + INK + '" stroke-width="1.4" stroke-linejoin="round"/>' +
        '<path d="M24 11 L25 4 L19.5 8 Z" fill="' + c + '" stroke="' + INK + '" stroke-width="1.4" stroke-linejoin="round"/>' +
        '<ellipse cx="16" cy="18" rx="10.5" ry="11" fill="' + c + '" stroke="' + INK + '" stroke-width="1.6"/>' +
        '<ellipse cx="16" cy="24" rx="5.5" ry="3.8" fill="#fff" opacity=".35"/>' +
        '<circle cx="12" cy="15.5" r="4" fill="#fff" stroke="' + INK + '" stroke-width="1.2"/><circle cx="20" cy="15.5" r="4" fill="#fff" stroke="' + INK + '" stroke-width="1.2"/>' +
        '<circle cx="12.4" cy="15.8" r="1.9" fill="' + INK + '"/><circle cx="19.6" cy="15.8" r="1.9" fill="' + INK + '"/>' +
        '<path d="M14.6 19.4 L17.4 19.4 L16 22 Z" fill="#FFB347" stroke="' + INK + '" stroke-width="1" stroke-linejoin="round"/>';
    },
    dino: function (c) {
      return '<path d="M10 9 L11.6 4.6 L13.6 8.4 L15.6 4.2 L17.4 8.2 L19.2 4.8 L20.4 8.4" fill="#fff" stroke="' + INK + '" stroke-width="1.2" stroke-linejoin="round"/>' +
        '<path d="M6 28.5 V16 C6 11 10 8 15 8 H19.5 C24.5 8 27.5 11 27.5 15 V18.5 H22 V28.5 Z" fill="' + c + '" stroke="' + INK + '" stroke-width="1.6" stroke-linejoin="round"/>' +
        '<circle cx="21" cy="13" r="1.9" fill="' + INK + '"/><circle cx="21.6" cy="12.4" r=".6" fill="#fff"/>' +
        '<path d="M22.5 18.5 L23.5 20 L24.5 18.5 L25.5 20 L26.5 18.5" fill="none" stroke="' + INK + '" stroke-width="1" stroke-linejoin="round"/>' +
        '<ellipse cx="12" cy="22" rx="3.2" ry="4" fill="#fff" opacity=".3"/>';
    }
  };

  var NAMES = { slime: '슬라임', robot: '로봇', cat: '고양이', ghost: '유령', owl: '부엉이', dino: '공룡' };
  var COLOR_NAMES = { '#FFD23F': '노랑', '#45B1F5': '하늘', '#FF8FB1': '분홍', '#7EE0B5': '민트', '#FFB347': '주황', '#C9A2FF': '보라' };

  function svg(kind, color) {
    var f = PARTS[kind] || PARTS.slime;
    return '<svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">' +
      '<ellipse cx="16" cy="29.6" rx="9" ry="1.7" fill="#000" opacity=".35"/>' + f(color) + '</svg>';
  }

  window.CGAvatar = { svg: svg, NAMES: NAMES, COLOR_NAMES: COLOR_NAMES };
})();
