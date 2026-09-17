/* ═══════════════════════════════════════════════
   hero.js — 첫 화면의 코드 타이핑 연출

   코드가 한 글자씩 쳐지고, 실행하면 사이트 이름이 출력된다.
   이 사이트에서 학생이 매일 하는 일을 그대로 보여주는 셈이다.

   · 외부 라이브러리를 쓰지 않는다 (글꼴·편집기만으로도 이미 무겁다)
   · 화면 밖으로 나가거나 다른 탭으로 옮기면 멈춘다 (노트북 배터리)
   · 자바스크립트가 없거나 '동작 줄이기'를 켠 사람에게는 완성된 모습이 그냥 보인다
   ═══════════════════════════════════════════════ */
(function () {
  var wrap = document.getElementById('codeplay');
  if (!wrap) return;

  var elCode  = document.getElementById('cpCode');
  var elLang  = document.getElementById('cpLang');
  var elTitle = document.getElementById('cpTitle');
  var letters = elTitle ? elTitle.querySelectorAll('span') : [];

  /* 동작을 줄이기로 한 사람에게는 애니메이션을 하지 않는다 */
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (calm) { wrap.classList.add('ready'); return; }

  /* 사이트 이름을 코드 안에 넣는다. index.php 가 window.SITE_NAME 으로 넘겨준다.
     설정 화면에서 따옴표와 역슬래시를 막아 두었으므로 그대로 문자열에 넣어도 된다. */
  var NAME = String(window.SITE_NAME || 'OJ');

  /* 글자 단위로 나눈다.
     name[i] 로 꺼내면 이모지처럼 두 칸을 차지하는 글자가 반쪽으로 잘린다. */
  var CHARS = Array.from(NAME);

  /* 한글이 섞이면 C 스니펫은 쓰지 않는다.
     printf 로 한글을 찍는 것은 환경에 따라 깨지고,
     첫 화면에서 학생에게 보여 줄 코드로는 적절하지 않다. */
  var hasWide = /[^\x00-\x7F]/.test(NAME);

  /* 토큰으로 미리 쪼개 둔다. 한 글자씩 색을 계산하는 것보다 간단하고 빠르다.
     k=키워드 s=문자열 f=함수 n=숫자 c=주석 */
  var Q = '"' + NAME + '"';

  var SNIPPETS = [
    { lang: 'Python3', code: [
      ['f', 'print'], ['', '('], ['s', Q], ['', ')']
    ]},
    { lang: 'Python3', code: [
      ['k', 'for'], ['', ' c '], ['k', 'in'], ['', ' '], ['s', Q], ['', ':\n    '],
      ['f', 'print'], ['', '(c, end='], ['s', '""'], ['', ')']
    ]},
    { lang: 'Python3', code: [
      ['', 'name = '], ['s', Q], ['', '\n'],
      ['f', 'print'], ['', '('], ['s', 'f"{name}"'], ['', ')']
    ]}
  ];

  /* 글자를 하나씩 배열에 넣는 연출. 이름이 길면 한 줄이 화면을 넘어가므로
     8자 이내일 때만 쓴다. */
  if (CHARS.length <= 8) {
    var arr = [['', 'code = [']];
    CHARS.forEach(function (c, i) {
      if (i) arr.push(['', ', ']);
      arr.push(['s', "'" + c + "'"]);
    });
    arr.push(['', ']\n'], ['f', 'print'], ['', '('], ['s', '""'], ['', '.'],
             ['f', 'join'], ['', '(code))']);
    SNIPPETS.push({ lang: 'Python3', code: arr });
  }

  if (!hasWide) {
    SNIPPETS.push({ lang: 'C(GCC)', code: [
      ['c', '#include <stdio.h>'], ['', '\n'],
      ['k', 'int'], ['', ' '], ['f', 'main'], ['', '() {\n    '],
      ['f', 'printf'], ['', '('], ['s', Q], ['', ');\n    '],
      ['k', 'return'], ['', ' '], ['n', '0'], ['', ';\n}']
    ]});
  }

  /* 타이핑할 글자 목록으로 펼친다 */
  function flatten(tokens) {
    var out = [];
    tokens.forEach(function (t) {
      Array.from(t[1]).forEach(function (ch) { out.push([t[0], ch]); });
    });
    return out;
  }

  var idx = Math.floor(Math.random() * SNIPPETS.length);
  var timer = null, skip = false, running = false, visible = true;

  function wait(ms) {
    return new Promise(function (res) {
      timer = setTimeout(res, skip ? Math.min(ms, 16) : ms);
    });
  }

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* 사람이 치는 것처럼 속도를 조금씩 흔든다 */
  function keyDelay(ch) {
    if (ch === '\n') return 150;
    if (ch === ' ')  return 28;
    return 22 + Math.random() * 34;
  }

  function hideTitle() {
    letters.forEach(function (el) { el.className = ''; });
    elTitle.classList.remove('done');
  }

  async function play() {
    if (running) return;
    running = true;
    skip = false;

    var snip = SNIPPETS[idx];
    idx = (idx + 1) % SNIPPETS.length;

    elLang.textContent = snip.lang;
    elCode.innerHTML = '';
    hideTitle();
    wrap.classList.remove('ran');
    wrap.classList.add('ready');

    /* 한 글자씩 친다 */
    var chars = flatten(snip.code);
    var html = '', cls = null;
    for (var i = 0; i < chars.length; i++) {
      var c = chars[i];
      if (c[0] !== cls) {
        if (cls !== null) html += '</span>';
        cls = c[0];
        html += cls ? '<span class="t-' + cls + '">' : '<span>';
      }
      html += esc(c[1]);
      elCode.innerHTML = html + '</span>';
      await wait(keyDelay(c[1]));
      if (!visible) { running = false; return; }
    }

    await wait(420);

    /* 실행 */
    wrap.classList.add('ran');
    await wait(260);

    for (var j = 0; j < letters.length; j++) {
      letters[j].className = 'on';
      await wait(70);
    }
    elTitle.classList.add('done');

    await wait(skip ? 900 : 3200);
    running = false;
    if (visible) play();
  }

  /* 눌러서 건너뛰기 — 기다리기 싫은 사람에게 */
  wrap.addEventListener('click', function () {
    if (running) { skip = true; }
    else play();
  });
  wrap.style.cursor = 'pointer';
  wrap.title = '눌러서 건너뛰기';

  /* 화면 밖으로 나가면 멈춘다 */
  document.addEventListener('visibilitychange', function () {
    visible = !document.hidden;
    if (visible && !running) play();
  });

  if (window.IntersectionObserver) {
    new IntersectionObserver(function (es) {
      visible = es[0].isIntersecting && !document.hidden;
      if (visible && !running) play();
      if (!visible) clearTimeout(timer);
    }, {threshold: 0.1}).observe(wrap);
  }

  play();
})();
