/* ═══════════════════════════════════════════════
   화면들이 함께 쓰는 최소한의 도우미.
   window.API 는 layout.php 가 심어 준다.
   ═══════════════════════════════════════════════ */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 한 반이 동시에 쓰면 저장이 잠깐 밀릴 수 있다.
   그런 일시적인 실패는 학생에게 보여주지 말고 조용히 다시 시도한다.
   서버가 retry:true 를 주거나, 응답이 JSON 이 아니거나, 연결이 끊긴 경우가 대상. */
async function api(action, data, tries = 4){
  let lastMsg = '요청을 처리하지 못했습니다';

  for (let attempt = 1; attempt <= tries; attempt++){
    let j = null, netFail = false;

    try{
      const r = await fetch(window.API + '?action=' + action, {
        method:'POST',
        headers:{'Content-Type':'application/json','X-Requested-With':'fetch'},
        body: JSON.stringify(data || {})
      });
      const text = await r.text();
      try{
        j = JSON.parse(text);
      }catch(_){
        /* JSON 이 아니면 서버가 오류 페이지를 보낸 것 — 다시 시도할 값어치가 있다 */
        j = { ok:false, error:'서버가 응답하지 않습니다', retry:true };
      }
    }catch(_){
      netFail = true;
    }

    if (netFail){
      lastMsg = '연결이 불안정합니다';
    } else if (j.ok){
      return j;
    } else {
      lastMsg = j.error || lastMsg;
      /* 권한 없음·기간 지남처럼 다시 해도 소용없는 오류는 즉시 알린다 */
      if (!j.retry) throw new Error(lastMsg);
    }

    if (attempt < tries){
      /* 모두가 같은 순간에 몰리지 않도록 간격을 조금씩 흩어 준다 */
      await sleep(300 * attempt + Math.random() * 300);
    }
  }
  throw new Error(lastMsg);
}

/* 목록에서 흔히 쓰는 꼴: 확인 → API 호출 → 페이지 새로고침 */
async function apiThenReload(action, data, confirmMsg){
  if (confirmMsg && !confirm(confirmMsg)) return;
  try{ await api(action, data); location.reload(); }
  catch(e){ alert(e.message); }
}

/* ═══════════════════════════════════════════════
   judge.js — 코드 입력란과 제출 처리

   문제 화면과 평가 화면이 같이 쓴다.

   두 가지를 따로 본다 — 예전에는 하나로 묶여 있어 수업에서는 붙여넣기를
   막을 방법이 아예 없었다.
     data-assess  = "1"  평가다. 통과 횟수를 세고 회차를 관리한다
     data-nopaste = "1"  붙여넣기와 드래그 앤 드롭을 막는다
                         (평가는 언제나, 수업은 묶음 설정에 따라)

   키 입력 수·편집 시간·막힌 붙여넣기 횟수는 언제나 함께 보낸다.
   붙여넣기를 허용한 묶음에서도 기록은 남겨 두어야 나중에 확인할 수 있다.
   ═══════════════════════════════════════════════ */
(function () {
  var box = document.getElementById('submitBox');
  if (!box) return;

  var apiUrl   = window.API;
  var pid      = parseInt(box.dataset.problem, 10);
  var setId    = box.dataset.set ? parseInt(box.dataset.set, 10) : null;
  var assess   = box.dataset.assess === '1';
  var noPaste  = box.dataset.nopaste === '1';
  /* 안내 문구는 서버가 내려 준다 — 수업과 평가가 다르게 나가야 한다 */
  var pasteWhy = box.dataset.pastemsg || '붙여넣기를 할 수 없습니다. 직접 입력하세요.';
  var ta       = document.getElementById('code');
  var langSel  = document.getElementById('lang');
  var btn      = document.getElementById('submitBtn');
  var out      = document.getElementById('result');
  var pasteMsg = document.getElementById('pasteMsg');
  var after    = document.getElementById('afterBtns');

  var keystrokes = 0, pasteBlocked = 0, startedAt = Date.now(), timer = null;

  /* ═══ 편집기 ═══════════════════════════════════
     CodeMirror 를 textarea 위에 씌운다. 스크립트가 안 뜨면 평범한 textarea 가
     그대로 남아 학생이 코드를 쓸 수 있다 — 평가 중에 입력조차 못 하는 일을 막는다. */
  var ed = null;

  var MODE = {
    python:'text/x-python', c:'text/x-csrc', cpp:'text/x-c++src',
    java:'text/x-java', csharp:'text/x-csharp', kotlin:'text/x-kotlin',
    javascript:'text/javascript', typescript:'text/typescript',
    go:'text/x-go', rust:'text/x-rustsrc', ruby:'text/x-ruby',
    swift:'text/x-swift', pascal:'text/x-pascal', sql:'text/x-sql',
    shell:'text/x-sh', r:'text/x-rsrc'
  };
  function modeOf(langKey) {
    var m = (window.LANG_MODES || {})[langKey] || '';
    return MODE[m] || null;      /* 모르는 언어는 색칠 없이 그냥 글자로 */
  }

  function getCode() { return ed ? ed.getValue() : ta.value; }
  function setCode(v) { if (ed) ed.setValue(v); else ta.value = v; }

  /* 입력란을 비우고 되돌리기(Ctrl+Z) 기록까지 지운다.
     기록이 남으면 Ctrl+Z 한 번에 방금 낸 코드가 통째로 돌아와,
     다시 치지 않고 회차를 채울 수 있다. */
  function resetCode() {
    if (ed) {
      ed.setValue('');
      ed.clearHistory();
    } else {
      /* 편집기가 뜨지 않은 경우: 브라우저 입력칸의 되돌리기 기록은 지울 방법이 없어
         같은 입력칸을 새것으로 바꿔 끼운다 (붙여넣기 차단 등 이벤트는 다시 붙인다) */
      var fresh = ta.cloneNode(false);
      fresh.value = '';
      ta.parentNode.replaceChild(fresh, ta);
      ta = fresh;
      bindTextarea();
    }
  }
  function focusCode() { if (ed) ed.focus(); else ta.focus(); }

  function countKey(e) {
    if (e.key && (e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace')) keystrokes++;
  }
  function blockPaste(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (e) e.codemirrorIgnore = true;
    pasteBlocked++;
    if (pasteMsg) {
      pasteMsg.textContent = pasteWhy;
      clearTimeout(pasteMsg._t);
      pasteMsg._t = setTimeout(function () { pasteMsg.textContent = ''; }, 3000);
    }
  }

  if (window.CodeMirror) {
    ed = CodeMirror.fromTextArea(ta, {
      lineNumbers: true,
      mode: modeOf(langSel.value),
      indentUnit: 4, tabSize: 4, indentWithTabs: false,
      matchBrackets: true, autoCloseBrackets: true, styleActiveLine: true,
      lineWrapping: false,
      extraKeys: {
        Tab: function (cm) {
          if (cm.somethingSelected()) cm.indentSelection('add');
          else cm.execCommand('insertSoftTab');
        },
        'Shift-Tab': function (cm) { cm.indentSelection('subtract'); },
        'Ctrl-Enter': function () { btn.click(); },
        'Cmd-Enter':  function () { btn.click(); }
      }
    });
    ed.on('keydown', function (cm, e) { countKey(e); });
    if (noPaste) {
      ed.on('paste', function (cm, e) { blockPaste(e); });
      ed.on('drop',  function (cm, e) { blockPaste(e); });
    }
  }

  /* textarea 에 거는 이벤트. 편집기가 있든 없든 건다.
     되돌리기 기록을 지우려고 입력칸을 새것으로 바꿔 끼울 때 다시 부른다 (resetCode). */
  function bindTextarea() {
    if (!ed) {
      /* 편집기가 없을 때의 최소 동작: Tab 은 공백 네 칸 */
      ta.addEventListener('keydown', function (e) {
        if (e.key !== 'Tab') return;
        e.preventDefault();
        var s = ta.selectionStart, t = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + '    ' + ta.value.slice(t);
        ta.selectionStart = ta.selectionEnd = s + 4;
      });
    }
    ta.addEventListener('keydown', countKey);
    if (noPaste) {
      ta.addEventListener('paste', blockPaste);
      ta.addEventListener('drop',  blockPaste);
    }
    /* 편집기가 없을 때를 위한 Ctrl+Enter */
    ta.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); btn.click(); }
    });
  }
  bindTextarea();

  /* ── 글자 크기 ── */
  (function () {
    var box2 = document.getElementById('fsBtns');
    if (!box2) return;
    box2.hidden = false;
    var size = 13.5;
    try { size = parseFloat(localStorage.getItem('edFontSize')) || 13.5; } catch (e) {}

    function apply() {
      size = Math.max(11, Math.min(24, size));
      document.documentElement.style.setProperty('--edfs', size + 'px');
      ta.style.fontSize = size + 'px';
      if (ed) ed.refresh();
      try { localStorage.setItem('edFontSize', String(size)); } catch (e) {}
    }
    document.getElementById('fsUp').addEventListener('click', function () { size += 1; apply(); });
    document.getElementById('fsDown').addEventListener('click', function () { size -= 1; apply(); });
    apply();
  })();

  /* 언어를 바꾸면 문법 색칠도 따라간다. 코드는 저장하지 않으므로 그대로 둔다. */
  langSel.addEventListener('change', function () {
    if (ed) ed.setOption('mode', modeOf(langSel.value));
  });

  /* ── 결과 표시 ── */
  function show(html) { out.innerHTML = html; out.hidden = false; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* 평가에서 통과했을 때 — 다음 회차를 위해 입력란을 비운다.
     붙여넣기가 막혀 있으므로, 비우면 다시 손으로 쳐야 한다.
     학생이 자기 코드를 확인할 시간을 주려고 자동으로 지우지 않고 버튼을 둔다. */
  function nextRound() {
    resetCode();
    keystrokes = 0; pasteBlocked = 0; startedAt = Date.now();
    out.hidden = true; out.innerHTML = '';
    if (after) after.innerHTML = '';
    btn.disabled = false;
    focusCode();
  }

  function renderResult(j) {
    var mark = {AC:'✓', WA:'✕', TLE:'⏱', MLE:'▣', RE:'⚠', CE:'⚠', IE:'⚠'}[j.verdict] || '';
    var h = '<div class="rbox ' + (j.verdict === 'AC' ? 'ok' : 'bad') + '">';
    h += '<div class="rhead"><span class="v v-' + esc(j.verdict) + '">'
       + esc(mark + ' ' + j.verdict) + '</span> <b>' + esc(j.label) + '</b></div>';

    var meta = [];
    if (j.time !== null) meta.push(j.time.toFixed(3) + ' 초');
    if (j.memory) meta.push(j.memory.toLocaleString() + ' KB');
    if (meta.length) h += '<div class="rmeta">' + esc(meta.join('  ·  ')) + '</div>';

    if (j.message && j.message.trim() !== '') {
      h += '<pre class="rmsg">' + esc(j.message.trim()) + '</pre>';
    }

    /* 평가에서 통과했을 때 회차 진행 상황을 함께 적는다 */
    if (assess && j.verdict === 'AC' && j.assess) {
      h += '<div class="rmeta">' + j.assess.ac + ' / ' + j.assess.need + '회 통과</div>';
    }

    /* 틀렸을 때 어긋난 자리를 보여준다 */
    if (j.diff) h += diffHtml(j.diff);

    h += '</div>';
    show(h);
  }

  /* 입력 · 기대 출력 · 내 출력을 나란히.
     처음 갈리는 줄에 표시를 해서 눈에 들어오게 한다. */
  function diffHtml(d) {
    if (d.mode === 'toolong') {
      return '<div class="rlab">어디가 다른가</div>'
           + '<p class="dnote">출력이 너무 길어 비교를 보여주지 않습니다.</p>';
    }

    function lines(rows, more1, more2) {
      var s = '<div class="dlines">';
      if (more1) s += '<div class="dmore">…</div>';
      rows.forEach(function (r) {
        s += '<div class="dline' + (r.d ? ' on' : '') + '">'
           + '<span class="dn">' + r.n + '</span>'
           + '<span class="dt">' + (r.t === '' ? '<i>(빈 줄)</i>' : esc(r.t)) + '</span></div>';
      });
      if (!rows.length) s += '<div class="dline"><span class="dn"></span><span class="dt"><i>(출력 없음)</i></span></div>';
      if (more2) s += '<div class="dmore">…</div>';
      return s + '</div>';
    }

    var h = '<div class="diffbox">';
    h += '<div class="dhead">어디가 다른가';
    if (d.line) h += ' <span class="small muted">' + d.line + '번째 줄부터 다릅니다</span>';
    h += '</div>';

    if (d.input !== undefined && d.input !== null && d.input !== '') {
      h += '<div class="dsec"><div class="dcap">입력</div>'
         + '<pre class="dpre">' + esc(d.input) + '</pre></div>';
    }
    h += '<div class="dcols">'
       + '<div class="dsec"><div class="dcap">기대한 출력'
       + '<span class="small muted"> ' + d.exp_n + '줄</span></div>'
       + lines(d.exp, d.before, d.after) + '</div>'
       + '<div class="dsec"><div class="dcap">내 출력'
       + '<span class="small muted"> ' + d.got_n + '줄</span></div>'
       + lines(d.got, d.before, d.after) + '</div>'
       + '</div>';

    if (d.mode === 'window') {
      h += '<p class="dnote">출력이 길어 다른 부분 앞뒤만 보여줍니다.</p>';
    }
    return h + '</div>';
  }

  /* 통과한 뒤에는 제출 버튼을 잠그고, 다음에 할 일을 그 옆에 띄운다.
     평가에서 같은 코드를 그대로 다시 눌러 회차를 채우는 것을 막기 위해서다. */
  function afterAC(a) {
    btn.disabled = true;
    if (!after) return;
    if (a.ac >= a.need) {
      after.innerHTML = '<a class="btn primary" href="set.php?id=' + setId + '">문제 목록으로</a>'
        + '<span class="small muted">' + a.need + '회를 모두 통과했습니다</span>';
    } else {
      after.innerHTML = '<button class="btn primary" type="button" id="nextBtn">다음 회차 시작</button>'
        + '<span class="small muted">코드를 처음부터 다시 입력합니다</span>';
      document.getElementById('nextBtn').addEventListener('click', nextRound);
    }
  }

  /* ── 결과가 나올 때까지 물어본다 ── */
  function poll(id, tries) {
    fetch(apiUrl + '?action=poll&id=' + id)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { show('<div class="note err">' + esc(j.error) + '</div>'); btn.disabled = false; return; }
        if (!j.done) {
          if (tries > 180) {
            show('<div class="note err">채점이 너무 오래 걸립니다. 선생님께 알려주세요.</div>');
            btn.disabled = false; return;
          }
          setTimeout(function () { poll(id, tries + 1); }, 1000);
          return;
        }
        renderResult(j);
        if (assess && j.verdict === 'AC' && j.assess) afterAC(j.assess);
        else btn.disabled = false;
        /* 채점이 끝나면 목록을 새로 읽어 최근 제출에 반영한다 */
        if (window.refreshMySubs) window.refreshMySubs();
      })
      .catch(function () {
        setTimeout(function () { poll(id, tries + 1); }, 2000);
      });
  }

  /* ── 제출 ── */
  btn.addEventListener('click', function () {
    if (getCode().trim() === '') { show('<div class="note err">코드를 입력하세요.</div>'); return; }
    btn.disabled = true;
    if (after) after.innerHTML = '';
    show('<div class="rbox wait"><div class="rhead"><span class="v v-wait">◌ 채점 중</span>'
       + ' <b>제출했습니다</b></div></div>');

    fetch(apiUrl + '?action=submit', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        problem_id: pid, set_id: setId, lang: langSel.value, source: getCode(),
        keystrokes: keystrokes, paste_blocked: pasteBlocked,
        edit_ms: Date.now() - startedAt
      })
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { show('<div class="note err">' + esc(j.error) + '</div>'); btn.disabled = false; return; }
        poll(j.id, 0);
      })
      .catch(function () {
        show('<div class="note err">제출하지 못했습니다. 잠시 뒤 다시 시도하세요.</div>');
        btn.disabled = false;
      });
  });


  /* ═══ 직접 실행 ═══════════════════════════════════
     학생이 자기 입력으로 코드를 돌려 본다. 채점이 아니므로 판정을 말하지 않고,
     테스트케이스도 건드리지 않는다. */
  (function () {
    var toggle = document.getElementById('runToggle');
    var rbox   = document.getElementById('runBox');
    var rin    = document.getElementById('runInput');
    var rbtn   = document.getElementById('runBtn');
    var rout   = document.getElementById('runResult');
    if (!toggle || !rbox) return;

    toggle.addEventListener('click', function () {
      rbox.hidden = !rbox.hidden;
      toggle.classList.toggle('on', !rbox.hidden);
      if (!rbox.hidden) rin.focus();
    });

    function rshow(html) { rout.innerHTML = html; rout.hidden = false; }

    function render(j) {
      var cls = j.ok_run ? 'ok' : 'bad';
      var h = '<div class="rbox ' + cls + '">';
      h += '<div class="rhead"><b>' + esc(j.label || '실행 결과') + '</b>';
      var meta = [];
      if (j.time !== null)  meta.push(j.time.toFixed(3) + ' 초');
      if (j.memory)         meta.push(j.memory.toLocaleString() + ' KB');
      if (meta.length) h += '<span class="small muted">' + esc(meta.join('  ·  ')) + '</span>';
      h += '</div>';

      if (j.stdout !== null && j.stdout !== '') {
        h += '<div class="rlab">출력</div><pre class="rmsg">' + esc(j.stdout) + '</pre>';
      } else if (j.ok_run) {
        h += '<div class="rlab">출력</div><pre class="rmsg empty">(출력이 없습니다)</pre>';
      }
      if (j.stderr && j.stderr.trim() !== '') {
        h += '<div class="rlab">오류 출력</div><pre class="rmsg">' + esc(j.stderr) + '</pre>';
      }
      if (j.message && j.message.trim() !== '') {
        h += '<div class="rlab">메시지</div><pre class="rmsg">' + esc(j.message.trim()) + '</pre>';
      }
      h += '</div>';
      rshow(h);
    }

    function poll(id, tries) {
      fetch(apiUrl + '?action=run_poll&id=' + id)
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j.ok) { rshow('<div class="note err">' + esc(j.error) + '</div>'); rbtn.disabled = false; return; }
          if (!j.done) {
            if (tries > 120) {
              rshow('<div class="note err">실행이 너무 오래 걸립니다.</div>');
              rbtn.disabled = false; return;
            }
            setTimeout(function () { poll(id, tries + 1); }, 700);
            return;
          }
          render(j);
          rbtn.disabled = false;
        })
        .catch(function () { setTimeout(function () { poll(id, tries + 1); }, 1500); });
    }

    rbtn.addEventListener('click', function () {
      if (getCode().trim() === '') { rshow('<div class="note err">코드를 입력하세요.</div>'); return; }
      rbtn.disabled = true;
      rshow('<div class="rbox wait"><div class="rhead"><b>실행 중…</b></div></div>');

      fetch(apiUrl + '?action=run', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          problem_id: pid, set_id: setId, lang: langSel.value,
          source: getCode(), stdin: rin.value
        })
      })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j.ok) { rshow('<div class="note err">' + esc(j.error) + '</div>'); rbtn.disabled = false; return; }
          poll(j.id, 0);
        })
        .catch(function () {
          rshow('<div class="note err">실행을 시작하지 못했습니다.</div>');
          rbtn.disabled = false;
        });
    });
  })();

})();
