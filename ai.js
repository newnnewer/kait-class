/* ═══════════════════════════════════════════════
   ai.js — 교사용 AI 도우미 팝업 (1.8.0)

   layout.php 가 교사 화면에만, 도우미를 켜 두었을 때만 불러온다.
   · 오른쪽 아래 단추 → 팝업. [넓게]를 누르면 화면 오른쪽에 세로로 길게 붙는다.
   · 대화는 이 탭의 sessionStorage 에만 둔다. 화면을 옮겨도 이어지고, 탭을 닫으면 사라진다.
     (KAIT-CLASS 는 화면마다 페이지를 새로 불러오므로 메모리에만 두면 매번 사라진다)
   · 학생 이름은 서버가 <span class="ai-u"> 로 감싸 보낸다. [이름 가리기]는 CSS 로 바꿔 끼운다.
   · 팝업은 저절로 열리지 않는다. 수업 중 화면을 띄워 둔 상태일 수 있으므로. Esc 로 바로 닫힌다.
   ═══════════════════════════════════════════════ */
(function () {
  'use strict';
  const CFG = window.KAIT_AI;
  if (!CFG) return;

  const KEY = 'kait-ai-v1';
  const EXAMPLES = [
    '이 수업에서 가장 많이 틀린 문제는?',
    '이번 주 수업에서 문제를 많이 푼 학생 5명',
    '이 평가 제대로 만들어졌는지 점검해 줘',
    '반복문 문제 5개로 내일 1교시 수업 만들어 줘',
  ];

  /* ── 상태 ─────────────────────────────────────── */
  let S = { open: false, wide: false, anon: false, msgs: [] };
  try { Object.assign(S, JSON.parse(sessionStorage.getItem(KEY) || '{}')); } catch (_) {}
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(S)); } catch (_) {} };
  let busy = false;

  /* 답을 기다리는 중에 화면을 옮기면 요청이 끊긴다. 남은 질문을 실패로 표시해 둔다 */
  const lastMsg = S.msgs[S.msgs.length - 1];
  if (lastMsg && lastMsg.role === 'user' && !lastMsg.failed) {
    lastMsg.failed = true;
    S.msgs.push({ role: 'error', text: '답을 받기 전에 화면을 옮겨 이 질문은 끊겼습니다. 다시 물어봐 주세요.' });
    save();
  }

  /* ── 뼈대 ─────────────────────────────────────── */
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const icon = (d) => `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const I = {
    bot:   icon('<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M9 16h6"/>'),
    eye:   icon('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    eyeOff:icon('<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.3 3.9M6.1 6.9C3.6 8.6 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.4-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
    wide:  icon('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>'),
    narrow:icon('<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>'),
    reset: icon('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
    close: icon('<path d="M6 6l12 12M18 6L6 18"/>'),
    send:  icon('<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>'),
    chat:  '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/></svg>',
  };

  const fab = el('button', 'ai-fab');
  fab.type = 'button';
  fab.innerHTML = I.chat;
  fab.title = 'AI 도우미';
  fab.setAttribute('aria-label', 'AI 도우미 열기');

  const panel = el('section', 'ai-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'AI 도우미');
  panel.innerHTML = `
    <header class="ai-head">
      <span class="ai-logo">${I.bot}</span>
      <b>AI 도우미</b>
      <span class="ai-grow"></span>
      <button type="button" class="ai-ib" data-act="anon"></button>
      <button type="button" class="ai-ib" data-act="wide"></button>
      <button type="button" class="ai-ib" data-act="reset" title="새 대화" aria-label="새 대화">${I.reset}</button>
      <button type="button" class="ai-ib" data-act="close" title="닫기 (Esc)" aria-label="닫기">${I.close}</button>
    </header>
    <div class="ai-body" aria-live="polite"></div>
    <form class="ai-foot">
      <div class="ai-inrow">
        <textarea rows="1" placeholder="질문을 입력하세요 (Enter 전송, Shift+Enter 줄바꿈)"></textarea>
        <button type="submit" class="ai-send" aria-label="보내기">${I.send}</button>
      </div>
      <div class="ai-fine"></div>
    </form>`;
  document.body.append(fab, panel);

  const body = panel.querySelector('.ai-body');
  const ta   = panel.querySelector('textarea');
  const form = panel.querySelector('form');
  const fine = panel.querySelector('.ai-fine');
  const btnAnon = panel.querySelector('[data-act=anon]');
  const btnWide = panel.querySelector('[data-act=wide]');

  function applyChrome() {
    panel.classList.toggle('on', S.open);
    panel.classList.toggle('wide', S.wide);
    panel.classList.toggle('anon', S.anon);
    fab.classList.toggle('on', S.open);
    fab.setAttribute('aria-expanded', S.open ? 'true' : 'false');
    btnAnon.innerHTML = S.anon ? I.eyeOff : I.eye;
    btnAnon.title = S.anon ? '이름 보이기' : '이름 가리기 (화면을 띄워 둘 때)';
    btnAnon.setAttribute('aria-label', btnAnon.title);
    btnAnon.classList.toggle('pressed', S.anon);
    btnWide.innerHTML = S.wide ? I.narrow : I.wide;
    btnWide.title = S.wide ? '작게 보기' : '넓게 보기';
    btnWide.setAttribute('aria-label', btnWide.title);
  }

  function setOpen(v) {
    S.open = v; save(); applyChrome();
    if (v) { scrollEnd(); setTimeout(() => ta.focus(), 30); }
    else fab.focus();
  }

  /* ── 그리기 ───────────────────────────────────── */
  const scrollEnd = () => { body.scrollTop = body.scrollHeight; };

  function renderEmpty() {
    const box = el('div', 'ai-empty');
    box.append(el('b', '', '무엇을 도와드릴까요?'));
    box.append(el('p', '', '수업·평가의 통계를 묻거나, 수업·평가를 만들고 점검할 수 있습니다. 지금 보는 화면을 참고해 답합니다.'));
    const list = el('div', 'ai-ex');
    for (const q of EXAMPLES) {
      const b = el('button', '', q); b.type = 'button';
      b.addEventListener('click', () => { ta.value = q; ta.focus(); autosize(); });
      list.append(b);
    }
    box.append(list);
    body.append(box);
  }

  function renderSteps(steps) {
    const qs = (steps || []).filter((s) => s.tool === 'query' || s.tool === 'check_set');
    if (!qs.length) return null;
    const d = el('details', 'ai-steps');
    d.append(el('summary', '', `조회 ${qs.length}건 보기`));
    for (const s of qs) {
      const row = el('div', 'ai-step' + (s.error ? ' bad' : ''));
      row.append(el('div', 'ai-step-p', (s.purpose || s.tool) + (s.rows != null ? ` · ${s.rows}행` : '')));
      if (s.sql) row.append(el('pre', '', s.sql));
      if (s.error) row.append(el('div', 'ai-step-e', s.error));
      d.append(row);
    }
    return d;
  }

  function renderDraft(m, i, dr) {
    const card = el('div', 'ai-draft');
    const head = el('div', 'ai-draft-h');
    head.append(el('span', 'ai-tag ' + (dr.set_type === 'assessment' ? 'is-assess' : 'is-lesson'),
                   dr.set_type === 'assessment' ? '평가' : '수업'));
    head.append(el('b', '', dr.title));
    card.append(head);

    const dl = el('dl');
    const add = (k, v) => { dl.append(el('dt', '', k), el('dd', '', v)); };
    add('대상', dr.visibility === 'all' ? '모든 회원' : (dr.groups || []).join(', '));
    add('기간', (dr.start_at || '제한 없음') + ' ~ ' + (dr.end_at || '제한 없음'));
    add('언어', (dr.langs || []).join(', '));
    const opts = [];
    if (dr.no_paste) opts.push('붙여넣기 막음');
    opts.push(dr.show_diff ? '틀리면 기대 출력 보임' : '기대 출력 숨김');
    add('설정', opts.join(' · '));
    card.append(dl);

    const ol = el('ol', 'ai-draft-p');
    for (const p of dr.problems || []) {
      ol.append(el('li', '', `${p.prob_no} ${p.title}` + (dr.set_type === 'assessment' ? ` (정답 ${p.required_ac}회)` : '')));
    }
    card.append(ol);
    for (const w of dr.warnings || []) card.append(el('div', 'ai-warn', w));

    const act = el('div', 'ai-draft-a');
    if (dr._created) {
      act.append(el('span', 'ok-text', '만들었습니다 · 잠긴 상태'));
      const a = el('a', '', '열어 보기 →'); a.href = CFG.root + dr._created; act.append(a);
    } else if (dr._dropped) {
      act.append(el('span', 'muted', '취소했습니다'));
    } else {
      const mk = el('button', 'btn sm primary', '생성'); mk.type = 'button';
      const no = el('button', 'btn sm', '취소');         no.type = 'button';
      const msg = el('span', 'small bad-text');
      mk.addEventListener('click', async () => {
        mk.disabled = no.disabled = true; msg.textContent = '';
        try {
          const j = await post('create_set', { draft: dr });
          dr._created = j.url; save(); render();
        } catch (e) {
          msg.textContent = e.message; mk.disabled = no.disabled = false;
        }
      });
      no.addEventListener('click', () => { dr._dropped = true; save(); render(); });
      act.append(mk, no, msg);
    }
    card.append(act);
    return card;
  }

  /* 초안이 여러 개면 한꺼번에 만든다. 하나씩 차례로 보내고, 실패한 것은 카드에 남겨 둔다 */
  function renderBulk(m) {
    const left = (m.drafts || []).filter((d) => !d._created && !d._dropped);
    if (left.length < 2) return null;
    const row = el('div', 'ai-bulk');
    const b = el('button', 'btn sm primary', `모두 생성 (${left.length}개)`); b.type = 'button';
    const msg = el('span', 'small');
    b.addEventListener('click', async () => {
      if (!confirm(`초안 ${left.length}개를 모두 만들까요? 잠긴 상태로 만들어집니다.`)) return;
      b.disabled = true;
      let ok = 0; const fails = [];
      for (const dr of left) {
        msg.textContent = `만드는 중… ${ok + fails.length + 1}/${left.length}`;
        try { const j = await post('create_set', { draft: dr }); dr._created = j.url; ok++; }
        catch (e) { fails.push(dr.title + ': ' + e.message); }
        save();
      }
      render();
      if (fails.length) alert(`${ok}개를 만들었고 ${fails.length}개는 실패했습니다.\n\n` + fails.join('\n'));
    });
    row.append(b, msg);
    return row;
  }

  function render() {
    body.textContent = '';
    if (!S.msgs.length) renderEmpty();
    S.msgs.forEach((m, i) => {
      if (m.role === 'user') {
        body.append(el('div', 'ai-q' + (m.failed ? ' failed' : ''), m.text));
      } else if (m.role === 'error') {
        body.append(el('div', 'ai-err', m.text));
      } else {
        const a = el('div', 'ai-a');
        const h = el('div', 'ai-md');
        h.innerHTML = m.html;   /* 서버가 안전 모드로 렌더한 것 */
        a.append(h);
        (m.drafts || []).forEach((dr) => a.append(renderDraft(m, i, dr)));
        const bulk = renderBulk(m);
        if (bulk) a.append(bulk);
        const st = renderSteps(m.steps);
        if (st) a.append(st);
        body.append(a);
      }
    });
    if (busy) {
      const w = el('div', 'ai-wait');
      w.innerHTML = '<span class="ai-dots"><i></i><i></i><i></i></span> <span class="t">생각하는 중</span>';
      body.append(w);
    }
    scrollEnd();
  }

  /* ── 서버 ─────────────────────────────────────── */
  async function post(action, data) {
    let r, j;
    try {
      r = await fetch(CFG.url + '?action=' + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
        body: JSON.stringify(data),
      });
    } catch (_) { throw new Error('서버에 연결하지 못했습니다.'); }
    try { j = await r.json(); } catch (_) { throw new Error('서버 응답을 읽지 못했습니다 (' + r.status + '). 답이 너무 오래 걸렸을 수 있습니다.'); }
    if (!j.ok) throw new Error(j.error || '요청을 처리하지 못했습니다.');
    return j;
  }

  async function ask(text) {
    if (busy) return;
    text = text.trim();
    if (!text) return;
    S.msgs.push({ role: 'user', text });
    busy = true; save(); render();

    /* 기다리는 시간을 보여 준다 — 스트리밍이 없으므로 멈춘 것처럼 보이지 않게 */
    const t0 = Date.now();
    const tick = setInterval(() => {
      const t = body.querySelector('.ai-wait .t');
      const s = Math.floor((Date.now() - t0) / 1000);
      if (t) t.textContent = s < 4 ? '생각하는 중' : `조회하고 정리하는 중 · ${s}초`;
    }, 1000);

    const history = S.msgs
      .filter((m) => (m.role === 'user' && !m.failed) || m.role === 'assistant')
      .map((m) => ({ role: m.role, text: m.text }));
    const page = { path: location.pathname.replace(/^.*?\/(admin\/)?([^/]*)$/, '$1$2') + location.search, title: document.title };

    try {
      const j = await post('chat', { history, page });
      S.msgs.push({ role: 'assistant', text: j.text, html: j.html, steps: j.steps, drafts: j.drafts });
      showCost(j.cost);
    } catch (e) {
      S.msgs[S.msgs.length - 1].failed = true;
      S.msgs.push({ role: 'error', text: e.message });
    } finally {
      clearInterval(tick);
      busy = false; save(); render();
      ta.focus();
    }
  }

  function showCost(c) {
    if (!c) return;
    S.cost = c; save(); renderFine();
  }
  function renderFine() {
    const c = S.cost;
    fine.textContent = 'AI 답은 틀릴 수 있습니다. 대화는 서버에 저장하지 않습니다.'
      + (c ? ` · 이번 달 약 ${Number(c.month_krw).toLocaleString()}원` + (c.limit_krw ? ` / ${Number(c.limit_krw).toLocaleString()}원` : '') : '');
  }

  /* ── 입력 ─────────────────────────────────────── */
  function autosize() {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  }
  ta.addEventListener('input', autosize);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy) return;
    const v = ta.value; ta.value = ''; autosize();
    ask(v);
  });

  fab.addEventListener('click', () => setOpen(!S.open));
  panel.querySelector('.ai-head').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'close') setOpen(false);
    if (act === 'wide')  { S.wide = !S.wide; save(); applyChrome(); scrollEnd(); }
    if (act === 'anon')  { S.anon = !S.anon; save(); applyChrome(); }
    if (act === 'reset') {
      if (busy) return;
      if (S.msgs.length && !confirm('대화를 지우고 새로 시작할까요?')) return;
      S.msgs = []; save(); render(); ta.focus();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.open) setOpen(false);
  });

  applyChrome(); renderFine(); render();
})();
