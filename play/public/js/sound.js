/* KAIT-PLAY — 소리 (6-2). 음원 파일 없이 브라우저(Web Audio)가 8비트 느낌으로 직접 만든다.
 *   CGSound.play('correct')   효과음 한 번
 *   CGSound.bgm(true/false, fast)   배경음 (전광판만)
 *   CGSound.unlock()   첫 클릭·키 입력 때 불러 준다 (브라우저는 사용자가 한 번 누르기 전에는 소리를 못 낸다)
 *   CGSound.volume = 0.25   전체 크기 (학생 기기는 작게, 전광판은 크게)
 * 소리가 안 나는 기기(스피커 없음 · 음소거 · 옛 브라우저)에서도 게임은 그대로 돌아간다. */
(function () {
  'use strict';
  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = null, master = null;
  var S = { volume: 0.25, enabled: true };

  function ensure() {
    if (!AC) return null;
    if (!ctx) {
      try { ctx = new AC(); master = ctx.createGain(); master.gain.value = S.volume; master.connect(ctx.destination); } catch (e) { ctx = null; return null; }
    }
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* 다음 입력 때 다시 */ } }
    return ctx;
  }
  S.unlock = function () { ensure(); };
  S.ready = function () { return !!ctx && ctx.state === 'running'; };
  S.setVolume = function (v) { S.volume = v; if (master) master.gain.value = v; };

  // 음 하나: 주파수(또는 [시작, 끝] 미끄러짐), 길이, 파형, 크기, 시작 지연
  function tone(f, dur, type, vol, delay) {
    var c = ensure();
    if (!c || !S.enabled) return;
    var t = c.currentTime + (delay || 0);
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'square';
    if (Array.isArray(f)) { o.frequency.setValueAtTime(f[0], t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f[1]), t + dur); }
    else o.frequency.setValueAtTime(f, t);
    var v = vol == null ? 0.5 : vol;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  // 잡음 (폭발 · 먹구름): 짧은 흰 잡음에 낮은 소리 거르기
  function noise(dur, vol, delay, cutoff) {
    var c = ensure();
    if (!c || !S.enabled) return;
    var t = c.currentTime + (delay || 0);
    var n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    var src = c.createBufferSource(), g = c.createGain(), fl = c.createBiquadFilter();
    src.buffer = buf; fl.type = 'lowpass'; fl.frequency.value = cutoff || 1200;
    g.gain.setValueAtTime(vol || 0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(fl); fl.connect(g); g.connect(master);
    src.start(t);
  }
  function seq(notes, step, type, vol) { notes.forEach(function (f, k) { if (f) tone(f, step * 0.95, type, vol, k * step); }); }

  // 음 이름 → 주파수
  var N = {};
  ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].forEach(function (n, i) {
    for (var o = 2; o <= 7; o++) N[n + o] = 440 * Math.pow(2, (i - 9) / 12 + (o - 4));
  });

  var SOUNDS = {
    occupy: function () { tone(N.G5, 0.05, 'square', 0.35); },
    // 타자음: 짧은 딸깍 (6-2 수정: 더 크게 · 조금 길게 · 잘 들리는 높이)
    type: function () { tone(1100 + Math.random() * 300, 0.035, 'square', 0.45); noise(0.02, 0.25, 0, 5000); },
    correct: function () { seq([N.C6, N.E6, N.G6], 0.06, 'square', 0.4); },
    wrong: function () { tone([N.A3, N.E3], 0.22, 'sawtooth', 0.35); },
    bossAppear: function () { tone(N.A5, 0.12, 'square', 0.4); tone(N.A5, 0.12, 'square', 0.4, 0.18); },
    bossWin: function () { seq([N.C5, N.E5, N.G5, N.C6, 0, N.G5, N.C6], 0.07, 'square', 0.45); },
    // 자동완성으로 채워질 때: 위로 쓸려 올라가는 '슈욱' + 반짝
    autoFill: function () { tone([N.C5, N.C7], 0.14, 'sawtooth', 0.3); noise(0.12, 0.25, 0, 6000); seq([N.E7, N.G7, N.C7 * 2], 0.04, 'triangle', 0.35); },
    // v0.7.0: 공격이 들어오는 중 (2초 안에 막기) · 집결 보스 등장
    alarm: function () { tone(N.A5, 0.12, 'square', 0.45); tone(N.E5, 0.12, 'square', 0.45, 0.14); tone(N.A5, 0.12, 'square', 0.45, 0.28); tone(N.E5, 0.12, 'square', 0.45, 0.42); },
    gather: function () { seq([N.C5, N.G5, N.C6, N.G5, N.C6, N.E6], 0.07, 'square', 0.42); },
    // v0.7.3: 대기실에서 누가 한마디 (작게)
    chat: function () { tone(N.E6, 0.05, 'triangle', 0.3); tone(N.A6, 0.06, 'triangle', 0.25, 0.05); },
    good: function () { tone([N.C5, N.C7], 0.25, 'triangle', 0.5); },
    bomb: function () { noise(0.45, 0.8, 0, 900); tone([180, 40], 0.4, 'sine', 0.7); },
    laser: function () { tone([N.C7, N.C5], 0.3, 'sawtooth', 0.35); tone([N.G6, N.G4], 0.3, 'square', 0.2, 0.04); },
    bad: function () { tone([N.E4, N.E2], 0.5, 'sawtooth', 0.4); },
    hit: function () { tone([N.A4, N.A2], 0.45, 'square', 0.45); noise(0.2, 0.3, 0.05, 2000); },
    attackSend: function () { tone([N.C4, N.C6], 0.18, 'square', 0.45); tone([N.C5, N.C7], 0.18, 'square', 0.3, 0.1); },
    shield: function () { tone(N.E6, 0.25, 'triangle', 0.5); tone(N.B6, 0.3, 'triangle', 0.4, 0.05); },
    ice: function () { seq([N.E7, N.B6, N.G6, N.E6], 0.05, 'triangle', 0.45); },
    // 먹구름: 우르릉 천둥 (6-2 수정: 잡음을 크게 + 낮은 울림 추가)
    cloud: function () { noise(1.0, 1.0, 0, 700); tone([110, 45], 0.9, 'sawtooth', 0.6); noise(0.5, 0.8, 0.35, 450); },
    tick: function () { tone(N.C6, 0.04, 'square', 0.35); },
    tickLast: function () { tone(N.C7, 0.12, 'square', 0.45); },
    start: function () { seq([N.G4, N.C5, N.E5, N.G5], 0.09, 'square', 0.45); },
    win: function () { seq([N.C5, N.E5, N.G5, N.C6, 0, N.A5, N.B5, N.C6], 0.1, 'square', 0.45); },
    end: function () { seq([N.G5, N.E5, N.C5, N.C4], 0.12, 'triangle', 0.45); },
    clear: function () { seq([N.E6, N.G6, N.E7, N.C7, N.D7, N.G7], 0.07, 'square', 0.45); },
  };
  S.play = function (name) {
    if (!S.enabled || !SOUNDS[name]) return;
    try { SOUNDS[name](); } catch (e) { /* 소리는 없어도 된다 */ }
  };

  // ── 배경음 (전광판): 짧은 칩튠 두 마디를 반복. fast = 마지막 30초 ──
  var MEL = ['E5', 'G5', 'A5', 'G5', 'E5', 'D5', 'C5', 'D5', 'E5', 'G5', 'C6', 'B5', 'A5', 'G5', 'E5', 0,
    'F5', 'A5', 'C6', 'A5', 'G5', 'E5', 'D5', 'E5', 'F5', 'E5', 'D5', 'B4', 'C5', 0, 'G4', 0];
  var BASS = ['C3', 0, 'C3', 'G3', 'A2', 0, 'A2', 'E3', 'F2', 0, 'F2', 'C3', 'G2', 0, 'G2', 'D3'];
  var bgmOn = false, bgmFast = false, bgmTimer = null, bgmStep = 0, bgmNext = 0;
  function bgmTick() {
    var c = ensure();
    if (!bgmOn || !c) return;
    var step = bgmFast ? 0.115 : 0.16;
    if (!bgmNext || bgmNext < c.currentTime) bgmNext = c.currentTime + 0.05;
    while (bgmNext < c.currentTime + 0.3) {
      var m = MEL[bgmStep % MEL.length], b = BASS[Math.floor(bgmStep / 2) % BASS.length];
      var d = bgmNext - c.currentTime;
      if (m) tone(N[m], step * 0.85, 'square', 0.16, d);
      if (b && bgmStep % 2 === 0) tone(N[b], step * 1.7, 'triangle', 0.3, d);
      if (bgmStep % 4 === 0) noise(0.04, 0.12, d, 6000);
      bgmStep += 1;
      bgmNext += step;
    }
  }
  S.bgm = function (on, fast) {
    bgmFast = !!fast;
    if (on && !bgmOn) { bgmOn = true; bgmNext = 0; bgmTimer = setInterval(bgmTick, 100); }
    else if (!on && bgmOn) { bgmOn = false; clearInterval(bgmTimer); bgmTimer = null; }
  };

  // 첫 입력 때 소리 준비 (학생 · 교사 화면 모두)
  ['keydown', 'pointerdown'].forEach(function (ev) { window.addEventListener(ev, function () { ensure(); }, { capture: true, passive: true }); });

  window.CGSound = S;
})();
