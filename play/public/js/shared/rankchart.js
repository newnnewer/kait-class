/* KAIT-PLAY — 순위 변동 그래프 공용 (0.14.0)
 * 전광판(게임 중 · 지난 판 결과)과 팀 배틀 결과 화면이 같이 쓴다.
 *   CGRankChart.lines(pts, no, clear, x, y)
 *     pts: [{ t, order: [1위 팀, 2위 팀, …] }] · no: 팀 번호 · clear: { rank, ms } 또는 null
 *     → { on: 색 선 path, off: 클리어 뒤 회색 선 path('' 이면 없음), last: [x, y], mark: [x, y] | null }
 *   CGRankChart.mark(sv, at, clear, opt) → 클리어 표시 <g> (등수 · 시간 · 1~3위 트로피)
 *     sv: (tag, attrs, text) → SVG 요소 · opt: { size: 글자 크기, W: 그림 너비 }
 * 클리어한 팀은 그 순간의 자리에 등수와 시간을 붙이고, 그 뒤 선은 회색으로 그린다. */
(function () {
  'use strict';
  function mmss(ms) {
    var t = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(t / 60), s = t % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  // 점들을 부드러운 S자로 (가운데에서 꺾임)
  function curve(list) {
    var d = '', prev = null;
    list.forEach(function (p) {
      if (!prev) d += 'M' + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
      else {
        var mx = (prev[0] + p[0]) / 2;
        d += 'C' + mx.toFixed(1) + ' ' + prev[1].toFixed(1) + ' ' + mx.toFixed(1) + ' ' + p[1].toFixed(1) + ' ' + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
      }
      prev = p;
    });
    return d;
  }
  function lines(pts, no, clear, x, y) {
    var raw = [];
    pts.forEach(function (p) {
      var k = p.order.indexOf(no);
      if (k >= 0) raw.push({ t: p.t, rank: k + 1 });
    });
    if (!raw.length) return null;
    var lastT = raw[raw.length - 1].t;
    if (!clear || clear.ms == null || clear.ms > lastT) {
      var all = raw.map(function (q) { return [x(q.t), y(q.rank)]; });
      return { on: curve(all), off: '', last: all[all.length - 1], mark: null };
    }
    // 클리어 순간까지는 색, 그 뒤는 그 등수 자리에 회색 (클리어한 팀의 등수는 더 바뀌지 않는다)
    var on = [], off = [];
    raw.forEach(function (q) { if (q.t < clear.ms) on.push([x(q.t), y(q.rank)]); });
    var m = [x(clear.ms), y(clear.rank)];
    on.push(m);
    off.push(m);
    raw.forEach(function (q) { if (q.t > clear.ms) off.push([x(q.t), y(clear.rank)]); });
    var end = off.length > 1 ? off[off.length - 1] : m;
    return { on: curve(on), off: off.length > 1 ? 'M' + m[0].toFixed(1) + ' ' + m[1].toFixed(1) + 'L' + end[0].toFixed(1) + ' ' + end[1].toFixed(1) : '', last: end, mark: m };
  }
  var MEDAL = { 1: '#FFD23F', 2: '#D3DCEA', 3: '#E0904F' };
  // 트로피 (24 × 24)
  function trophy(sv, color) {
    var g = sv('g', { class: 'rc-trophy' });
    g.appendChild(sv('path', { d: 'M6 5 H3.2 V7.2 A3.4 3.4 0 0 0 6.6 10.6 M18 5 H20.8 V7.2 A3.4 3.4 0 0 1 17.4 10.6', fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round' }));
    g.appendChild(sv('path', { d: 'M6 2.5 H18 V8 A6 6 0 0 1 6 8 Z', fill: color }));
    g.appendChild(sv('rect', { x: 10.6, y: 13.6, width: 2.8, height: 3.6, fill: color }));
    g.appendChild(sv('rect', { x: 7, y: 17.2, width: 10, height: 3.6, rx: 1.2, fill: color }));
    g.appendChild(sv('path', { d: 'M9 4.5 V8', stroke: 'rgba(255,255,255,.55)', 'stroke-width': 1.6, 'stroke-linecap': 'round' }));
    return g;
  }
  /** 클리어 표시 — 점 위(자리가 없으면 아래)에 '🏆 1위 · 03:42' 이름표 */
  function mark(sv, at, clear, opt) {
    var size = opt.size || 14, W = opt.W || 9999;
    var medal = MEDAL[clear.rank];
    var label = clear.rank + '위 · ' + mmss(clear.ms);
    var th = medal ? size * 1.15 : 0, gapT = medal ? size * 0.35 : 0;
    var textW = label.length * size * 0.56; // 대략 (숫자 · 한글 섞임)
    var pad = size * 0.55, h = size * 1.75, w = pad * 2 + th + gapT + textW;
    var above = at[1] - h - size * 0.7 >= 2;
    var cx = Math.max(w / 2 + 2, Math.min(W - w / 2 - 2, at[0]));
    var top = above ? at[1] - h - size * 0.7 : at[1] + size * 0.7;
    var g = sv('g', { class: 'rc-mark' + (medal ? ' medal r' + clear.rank : '') });
    // 꼭지 (이름표 → 점)
    var tipY = above ? top + h : top;
    g.appendChild(sv('path', { d: 'M' + (at[0] - size * 0.35).toFixed(1) + ' ' + tipY.toFixed(1) + 'L' + at[0].toFixed(1) + ' ' + (above ? at[1] - size * 0.2 : at[1] + size * 0.2).toFixed(1) + 'L' + (at[0] + size * 0.35).toFixed(1) + ' ' + tipY.toFixed(1) + 'Z', class: 'rc-tip', fill: medal || '#8C9BB8' }));
    g.appendChild(sv('rect', { x: (cx - w / 2).toFixed(1), y: top.toFixed(1), width: w.toFixed(1), height: h.toFixed(1), rx: (h / 2).toFixed(1), class: 'rc-pill', stroke: medal || '#8C9BB8' }));
    var left = cx - w / 2 + pad;
    if (medal) {
      var t = trophy(sv, medal);
      var sc = th / 24;
      t.setAttribute('transform', 'translate(' + left.toFixed(1) + ' ' + (top + (h - th) / 2).toFixed(1) + ') scale(' + sc.toFixed(3) + ')');
      g.appendChild(t);
      left += th + gapT;
    }
    g.appendChild(sv('text', { x: left.toFixed(1), y: (top + h / 2 + size * 0.36).toFixed(1), class: 'rc-text', 'font-size': size }, label));
    g.appendChild(sv('circle', { cx: at[0], cy: at[1], r: size * 0.42, class: 'rc-dot', fill: medal || '#C9D3E3' }));
    return g;
  }
  window.CGRankChart = { lines: lines, mark: mark, mmss: mmss };
})();
