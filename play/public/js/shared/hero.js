/* KAIT-PLAY 1.1.0 — 결과 화면의 승리 · 패배 포즈 · MVP (학생 결과 화면 · 전광판이 같이 쓴다, 사용자가 시안을 고름 2026-10-23)
 *   CGHero.mvp(members, game, team)  → { nick, kind, color, title, why } | null   (사람만, 점수 0 이면 없음)
 *       블록 러시: 깬 블록 + 보스 × 3   · 플립 배틀: 뒤집기 + 아이템 블록 × 3
 *       칭호는 잘한 쪽에 맞춰 고르고, 같은 닉네임이면 어느 화면에서나 같은 칭호 (닉네임으로 고름)
 *   CGHero.avatar(p, mood, size)     포즈 캐릭터 <span class="hav p-win|p-lose|p-draw">
 *   CGHero.confetti(box, n)          색종이
 *   CGHero.cloud()                   패배 먹구름 (빗물은 어두운 파랑 — 사용자 결정)
 *   필요한 것: window.CGAvatar (avatar.js) · css/titlecard.css */
(function () {
  'use strict';
  var TITLES = {
    blocks: ['블록 파괴왕', '키보드 폭주기관차', '타자의 신', '손가락 번개', '블록 브레이커', '쉬지 않는 손가락'],
    boss: ['보스 사냥꾼', '보스 킬러', '전설의 용사', '보스 전문가'],
    flips: ['뒤집기 장인', '뒤집기 머신', '색칠 대장', '판 뒤집는 자'],
    items: ['아이템 수집가', '선물 사냥꾼', '🎁 도둑'],
    red: '빨강의 지배자', blue: '파랑의 지배자'
  };
  function hash(s) { var h = 7; s = String(s || ''); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
  function pick(list, nick) { return list[hash(nick) % list.length]; }

  function mvp(members, game, team) {
    var best = null, bestScore = 0;
    (members || []).forEach(function (p) {
      if (p.bot) return;
      var sc = game === 'flip' ? (p.solved || 0) + (p.items || 0) * 3 : (p.solved || 0) + (p.bosses || 0) * 3;
      if (sc > bestScore) { bestScore = sc; best = p; }
    });
    if (!best) return null;
    var title, why;
    if (game === 'flip') {
      var it = best.items || 0;
      if (it >= 2) title = pick(TITLES.items, best.nick);
      else title = hash(best.nick) % 5 === 0 ? (team === 2 ? TITLES.blue : TITLES.red) : pick(TITLES.flips, best.nick);
      why = '뒤집기 ' + (best.solved || 0) + (it ? ' · 아이템 블록 ' + it : '');
    } else {
      var bo = best.bosses || 0;
      title = bo >= 2 && bo * 3 >= (best.solved || 0) * 0.6 ? pick(TITLES.boss, best.nick) : pick(TITLES.blocks, best.nick);
      why = '블록 ' + (best.solved || 0) + (bo ? ' · 보스 ' + bo : '');
    }
    return { nick: best.nick, kind: best.kind, color: best.color, title: title, why: why };
  }

  function avatar(p, mood, size) {
    var s = document.createElement('span');
    s.className = 'hav' + (mood ? ' p-' + mood : '');
    if (size) { s.style.width = size + 'px'; s.style.height = size + 'px'; }
    s.innerHTML = window.CGAvatar ? window.CGAvatar.svg(p.kind, p.color, mood) : '';
    return s;
  }

  function confetti(box, n) {
    var c = document.createElement('div');
    c.className = 'hconfetti';
    var COL = ['#FFD23F', '#45B1F5', '#FF5C8A', '#3DDC97', '#C9A2FF'];
    for (var i = 0; i < (n || 26); i++) {
      var p = document.createElement('i');
      p.style.left = (Math.random() * 100) + '%';
      p.style.background = COL[i % COL.length];
      p.style.animationDuration = (1.8 + Math.random() * 1.6) + 's';
      p.style.animationDelay = (-Math.random() * 3) + 's';
      c.appendChild(p);
    }
    box.appendChild(c);
    return c;
  }

  // 먹구름 — 구름은 회색, 빗물은 어두운 파랑 (이모지 🌧️ 는 빗물이 너무 밝아서 직접 그림)
  function cloud() {
    var s = document.createElement('span');
    s.className = 'hcloud';
    s.innerHTML = '<svg viewBox="0 0 48 40" width="100%" height="100%" aria-hidden="true">' +
      '<path d="M12 22 C5 22 4 13 11 12 C12 5 22 3 26 9 C30 5 39 7 38 14 C45 14 45 22 38 22 Z" fill="#8E9AB8" stroke="#2A3352" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<path d="M14 15 C15 12 18 11 20 11.5" stroke="#B8C2DA" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
      '<g class="rain" fill="#3D5F9C"><path d="M15 26 q-1.4 3 0 4 q1.4 -1 0 -4 Z"/><path d="M24 28 q-1.4 3 0 4 q1.4 -1 0 -4 Z"/><path d="M33 26 q-1.4 3 0 4 q1.4 -1 0 -4 Z"/></g></svg>';
    return s;
  }

  window.CGHero = { mvp: mvp, avatar: avatar, confetti: confetti, cloud: cloud, TITLES: TITLES };
})();
