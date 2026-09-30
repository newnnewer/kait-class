/*
 * 이동 규칙 — 서버와 브라우저가 같은 파일을 쓴다.
 *   서버: 실제 판정 (require)
 *   브라우저: 키를 누르자마자 미리 움직여 보여 주기 (window.CGMove)
 *
 * board = { cols, rows, solved(i) → bool, blocked(i) → bool }
 *   blocked: 보스처럼 들어갈 수 없는 칸 (1단계에는 없음)
 * pos   = { r, c }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CGMove = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DIRS = { L: [0, -1], R: [0, 1], U: [-1, 0], D: [1, 0] };
  var REVERSE = { L: 'R', R: 'L', U: 'D', D: 'U' };

  function inside(b, r, c) { return r >= 0 && r < b.rows && c >= 0 && c < b.cols; }
  function idx(b, r, c) { return r * b.cols + c; }

  /** 방향키 한 번 (ctrl = Ctrl+방향키 점프) */
  function step(b, pos, dir, ctrl) {
    var d = DIRS[dir];
    if (!d) return pos;
    var dr = d[0], dc = d[1];
    var r = pos.r, c = pos.c;
    var nr = r + dr, nc = c + dc;
    if (!inside(b, nr, nc) || b.blocked(idx(b, nr, nc))) return pos;
    if (!ctrl) return { r: nr, c: nc };

    // Ctrl+방향키 — 엑셀 방식
    //  · 지금 칸과 다음 칸이 모두 미해결: 미해결 덩어리의 끝까지
    //  · 그 밖: 해결 칸을 건너뛰고 다음 미해결 칸까지 (없으면 판 끝)
    //  · 판 끝이나 막힌 칸(보스) 바로 앞에서 멈춘다. 다른 조원은 무시한다.
    if (!b.solved(idx(b, r, c)) && !b.solved(idx(b, nr, nc))) {
      while (inside(b, nr, nc) && !b.blocked(idx(b, nr, nc)) && !b.solved(idx(b, nr, nc))) {
        r = nr; c = nc; nr += dr; nc += dc;
      }
    } else {
      while (inside(b, nr, nc) && !b.blocked(idx(b, nr, nc))) {
        r = nr; c = nc;
        if (!b.solved(idx(b, r, c))) break;
        nr += dr; nc += dc;
      }
    }
    return { r: r, c: c };
  }

  /** Home / End — 줄의 처음 / 끝 (보스가 가로막으면 그 앞까지) */
  function edge(b, pos, which) {
    var dc = which === 'home' ? -1 : 1;
    var c = pos.c;
    while (inside(b, pos.r, c + dc) && !b.blocked(idx(b, pos.r, c + dc))) c += dc;
    return { r: pos.r, c: c };
  }

  /** Ctrl+Home / Ctrl+End — 판의 맨 처음 칸 / 맨 마지막 칸 (그 칸이 보스면 바로 옆 칸) */
  function corner(b, which) {
    var n = b.rows * b.cols;
    var i = which === 'first' ? 0 : n - 1;
    var d = which === 'first' ? 1 : -1;
    while (i >= 0 && i < n && b.blocked(i)) i += d;
    return { r: Math.floor(i / b.cols), c: i % b.cols };
  }

  /** 방향 반전 아이템용 */
  function reverse(dir) { return REVERSE[dir] || dir; }

  return { DIRS: DIRS, step: step, edge: edge, corner: corner, reverse: reverse };
});
