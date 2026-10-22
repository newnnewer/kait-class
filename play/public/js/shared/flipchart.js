/* KAIT-PLAY — 플립 배틀 그래프 공용 (0.16.0)
 * 전광판(게임 중 · 지난 판)과 결과 화면(학생 · 교사)이 같이 쓴다.
 *   CGFlipChart.svg(hist, opt) → <svg>
 *     hist: [{ t: 흐른 ms, c: [빨강 블록 수, 파랑 블록 수] }] — 5초마다 하나 + 맨 끝에 '지금'(게임 중) 또는 '끝난 순간'
 *     opt: { totalMs: 게임 시간, slotMs: 칸 길이(기본 5초), width, height, live: 게임 중이면 true(지금 막대가 깜빡임), labels: true 면 아래에 1분 눈금 }
 * 게임 시간을 5초 칸으로 미리 나눈다 (3분 = 36칸). 막대는 5초마다 왼쪽부터 하나씩 생기고, 아직 안 온 칸은 비어 있다.
 *   칸 k = k×5초 ~ (k+1)×5초. 5초마다 찍은 기록(t ≈ (k+1)×5초)은 칸 k, 맨 끝 점(지금 · 끝난 순간)은 그 점이 들어 있는 칸.
 * 막대 하나 = 그때의 블록 비율 (아래 빨강 · 위 파랑, 늘 100%). 가운데 50% 점선.
 * 맨 끝 막대(지금)는 앞선 팀 쪽을 진하게 — 게임 중이면 깜빡인다. 색은 CSS(.fc-red · .fc-blue …). */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var SLOT_DEF = 5000; // 5초 (서버 flip.js 의 SNAP_MS 와 같게 — 사용자 결정 2026-10-22: 10초 → 5초)
  function sv(tag, a, text) {
    var e = document.createElementNS(NS, tag);
    for (var k in a) e.setAttribute(k, a[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function svg(hist, opt) {
    opt = opt || {};
    var W = opt.width || 460, H = opt.height || 180, B = opt.labels ? 22 : 0;
    var SLOT = opt.slotMs || SLOT_DEF;
    var root = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', class: 'fc', role: 'img', 'aria-label': '블록 수 변화 (' + (SLOT / 1000) + '초마다)' });
    var list = (hist || []).filter(function (h) { return h && h.c && h.c[0] + h.c[1] > 0; });
    var lastT = list.length ? list[list.length - 1].t : 0;
    var total = Math.max(SLOT, opt.totalMs || lastT || SLOT);
    var n = Math.max(1, Math.ceil(total / SLOT)); // 3분 = 36칸
    // 칸마다 그 칸 끝의 블록 수
    var slots = new Array(n);
    var nowK = -1;
    list.forEach(function (h, i) {
      var last = i === list.length - 1;
      var k = last ? Math.ceil(h.t / SLOT) - 1 : Math.round(h.t / SLOT) - 1;
      if (last && opt.live) k = Math.floor(h.t / SLOT); // 게임 중: 지금 흐르고 있는 칸
      if (k < 0) { if (!last) return; k = 0; }
      if (k >= n) k = n - 1;
      slots[k] = h.c;
      if (last) nowK = k;
    });
    var gap = n > 40 ? 1 : 2;
    var bw = (W - gap * (n - 1)) / n, ph = H - B;
    root.appendChild(sv('rect', { x: 0, y: 0, width: W, height: ph, class: 'fc-bg' })); // 아직 안 온 시간
    for (var k = 0; k < n; k++) {
      var c = slots[k];
      if (!c) continue;
      var tot = c[0] + c[1], red = c[0] / tot;
      var x = k * (bw + gap), rh = ph * red;
      var now = k === nowK;
      var lead = c[0] > c[1] ? 1 : c[1] > c[0] ? 2 : 0;
      var g = sv('g', { class: 'fc-bar' + (now ? ' fc-now' + (opt.live ? ' live' : '') : '') });
      g.appendChild(sv('rect', { x: x.toFixed(2), y: 0, width: bw.toFixed(2), height: (ph - rh).toFixed(2), class: 'fc-blue' + (now && lead === 2 ? ' lead' : '') }));
      g.appendChild(sv('rect', { x: x.toFixed(2), y: (ph - rh).toFixed(2), width: bw.toFixed(2), height: rh.toFixed(2), class: 'fc-red' + (now && lead === 1 ? ' lead' : '') }));
      root.appendChild(g);
    }
    root.appendChild(sv('line', { x1: 0, x2: W, y1: ph / 2, y2: ph / 2, class: 'fc-mid' }));
    // 아래: 1분 눈금 (0분 · 1분 · 2분 …)
    if (opt.labels) {
      var mins = Math.floor(total / 60000);
      for (var m = 0; m <= mins; m++) {
        var mx = Math.min(W, m * 60000 / (n * SLOT) * W);
        root.appendChild(sv('line', { x1: mx, x2: mx, y1: ph, y2: ph + 5, class: 'fc-tick' }));
        root.appendChild(sv('text', { x: mx, y: H - 3, class: 'fc-lab', 'text-anchor': m === 0 ? 'start' : mx >= W - 1 ? 'end' : 'middle' }, m + '분'));
      }
    }
    return root;
  }
  var api = { svg: svg, SLOT_MS: SLOT_DEF };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.CGFlipChart = api;
})();
