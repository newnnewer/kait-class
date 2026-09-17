<?php
/* problem.php — 문제를 읽고 코드를 제출하는 화면
   ?no=1001            문제 모음에서 자유롭게 풀기
   ?no=1001&set=3      수업 또는 평가 안에서 풀기 */
declare(strict_types=1);
require_once __DIR__ . '/guard.php';
require_once __DIR__ . '/layout.php';
$u = me();   /* 문제는 로그인하지 않아도 볼 수 있다 */

$no = (int)($_GET['no'] ?? 0);
$p  = one("SELECT * FROM problems WHERE prob_no = ?", [$no]);
if (!$p) { header('Location: problems.php'); exit; }
$pid = (int)$p['id'];

/* 잠긴 문제는 관리자와, 그 문제가 담긴 수업·평가 참여자만 볼 수 있다 */
if (!problem_visible($u, $p, !empty($_GET['set']) ? (int)$_GET['set'] : null)) {
  header('Location: problems.php'); exit;
}

/* ── 묶음 안에서 들어온 경우 ─────────────────── */
$set = null; $isAssess = false; $need = 0; $canSubmit = true; $setId = null;
/* 붙여넣기 차단 — 평가는 언제나 막고, 수업은 묶음마다 정한다.
   묶음 밖에서 자유롭게 푸는 경우는 막지 않는다. */
$noPaste = false;
if ($u && !empty($_GET['set'])) {
  $set = student_set_or_null($u, (int)$_GET['set']);
  if ($set) {
    $sp = one("SELECT required_ac FROM set_problems WHERE set_id=? AND problem_id=?",
              [$set['id'], $pid]);
    if (!$sp) { $set = null; }                    /* 이 묶음의 문제가 아니다 */
    else {
      $setId     = (int)$set['id'];
      $isAssess  = $set['set_type'] === 'assessment';
      $noPaste   = $isAssess || (int)($set['no_paste'] ?? 0) === 1;
      $need      = $isAssess ? (int)$sp['required_ac'] : 1;
      $canSubmit = set_open($set);
    }
  }
}

/* 묶음 안이면 그 묶음에서 허용한 언어만, 아니면 전체 */
$allowLangs = $set ? set_langs($set) : array_keys(langs());

/* 편집기 문법 모드 — 운영 > 언어에서 정한 값을 그대로 넘긴다 */
$langModes = [];
foreach (langs() as $k => $L) $langModes[$k] = $L['editor'];

$samples = all("SELECT input, expected FROM testcases
                WHERE problem_id = ? AND is_sample = 1 ORDER BY seq, id", [$pid]);
$hasTc   = (int)col("SELECT COUNT(*) FROM testcases WHERE problem_id = ?", [$pid]) > 0;
$tags    = tags_of($pid);

/* 내 제출 — 묶음 안이면 그 묶음 것만, 아니면 수업·자유 풀이만 */
$mine = []; $myAc = 0; $solved = false;
if (!$u) {
  /* 로그인하지 않았으면 개인 기록이 없다 */
} elseif ($setId) {
  $mine = all("SELECT id, lang, state, verdict, max_time, created_at
               FROM submissions WHERE user_id=? AND problem_id=? AND set_id=?
               ORDER BY id DESC LIMIT 10", [$u['id'], $pid, $setId]);
  $myAc = ac_count_in_set((int)$u['id'], $pid, $setId);
} else {
  $mine = all("SELECT id, lang, state, verdict, max_time, created_at
               FROM submissions WHERE user_id=? AND problem_id=?
               ORDER BY id DESC LIMIT 10", [$u['id'], $pid]);
}
if ($u) {
  $solved = (bool)col("SELECT 1 FROM submissions WHERE user_id=? AND problem_id=? AND verdict='AC' LIMIT 1",
                      [$u['id'], $pid]);
}

page_head(['title' => $p['prob_no'] . '. ' . $p['title'], 'root' => '', 'user' => $u,
            'nav' => $set ? ($isAssess ? 'assessments' : 'lessons') : 'problems']);
?>
<div class="wrap">

  <div class="phead">
    <span class="pno" style="font-size:20px"><?= (int)$p['prob_no'] ?></span>
    <h1><?= h($p['title']) ?></h1>
    <?php if ($isAssess): ?>
    <?php elseif ($solved): ?>
      <span class="v v-AC">✓ 해결</span>
    <?php endif; ?>
    <div class="grow"></div>
    <a class="btn" href="<?= $set ? 'set.php?id=' . $setId : 'problems.php' ?>">목록</a>
  </div>

  <?php if ((int)$p['active'] === 0): ?>
    <div class="note info">이 문제는 잠겨 있어 문제 모음에 보이지 않습니다.</div>
  <?php endif; ?>

  <div class="limits">
    <span>시간 제한 <b><?= rtrim(rtrim(number_format((float)$p['time_limit'], 1), '0'), '.') ?>초</b></span>
    <span>메모리 제한 <b><?= (int)round($p['memory_limit'] / 1000) ?>MB</b></span>
    <?php foreach ($tags as $t): ?>
      <a class="tag" href="problems.php?tag=<?= rawurlencode($t) ?>"><?= h($t) ?></a>
    <?php endforeach; ?>
  </div>

  <div class="split">
    <!-- ── 왼쪽: 문제 ── -->
    <section class="pane">
      <h2 class="ph"><span class="emo" aria-hidden="true">📝</span>문제 설명</h2>
      <div class="md"><?= md($p['description']) ?></div>

      <?php if (trim((string)$p['input_desc']) !== ''): ?>
        <h2 class="ph"><span class="emo" aria-hidden="true">📥</span>입력</h2>
        <div class="md"><?= md($p['input_desc']) ?></div>
      <?php endif; ?>

      <?php if (trim((string)$p['output_desc']) !== ''): ?>
        <h2 class="ph"><span class="emo" aria-hidden="true">📤</span>출력</h2>
        <div class="md"><?= md($p['output_desc']) ?></div>
      <?php endif; ?>

      <?php if ($samples): ?>
        <h2 class="ph"><span class="emo" aria-hidden="true">💡</span>예시</h2>
        <?php foreach ($samples as $i => $s): ?>
          <div class="sample">
            <div class="sblock">
              <div class="cap">
                입력 <?= count($samples) > 1 ? $i + 1 : '' ?>
                <button class="copybtn" type="button" title="복사" aria-label="입력 복사">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
                     stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
                </button>
              </div>
              <pre><?= h($s['input']) ?></pre>
            </div>
            <div class="sblock">
              <div class="cap">
                출력 <?= count($samples) > 1 ? $i + 1 : '' ?>
                <button class="copybtn" type="button" title="복사" aria-label="출력 복사">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
                     stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
                </button>
              </div>
              <pre><?= h($s['expected']) ?></pre>
            </div>
          </div>
        <?php endforeach; ?>
      <?php endif; ?>
    </section>

    <!-- ── 오른쪽: 제출 ── -->
    <section class="pane">
      <?php if ($isAssess): ?>
        <div class="note <?= $myAc >= $need ? 'ok' : 'info' ?>" id="acNote">
          <?php if ($myAc >= $need): ?>
            <b><?= $need ?>회</b> 모두 통과 완료
          <?php else: ?>
            통과 조건 <b><?= $need ?>회</b> 중 <b><?= $myAc ?>회</b> 통과하였습니다.
          <?php endif; ?>
        </div>
      <?php endif; ?>

      <?php if (!$u): ?>
        <div class="loginbox">
          <b>문제를 풀려면 로그인해야 합니다.</b>
          <p class="small muted">문제와 채점 결과는 누구나 볼 수 있지만, 제출은 회원만 가능합니다.</p>
          <a class="btn primary" href="login.php?next=<?= rawurlencode($_SERVER['REQUEST_URI'] ?? '/') ?>">로그인</a>
        </div>
      <?php elseif (!$hasTc): ?>
        <div class="note err">이 문제는 아직 채점 준비가 되지 않았습니다.</div>
      <?php elseif (!$canSubmit): ?>
        <div class="note err">
          <?= set_state($set) === 'before' ? '아직 시작 전이라' : '종료되어' ?>
          제출할 수 없습니다.
        </div>
      <?php else: ?>
        <div id="submitBox" data-problem="<?= $pid ?>"
             data-set="<?= $setId !== null ? $setId : '' ?>"
             data-assess="<?= $isAssess ? '1' : '0' ?>"
             data-nopaste="<?= $noPaste ? '1' : '0' ?>"
             data-pastemsg="<?= h($isAssess
                 ? '이 평가에서는 붙여넣기를 할 수 없습니다. 직접 입력하세요.'
                 : '이 수업에서는 붙여넣기를 할 수 없습니다. 직접 입력하세요.') ?>">
          <div class="subhead">
            <label for="lang">언어</label>
            <select id="lang" style="width:auto">
              <?php foreach ($allowLangs as $k): ?>
                <option value="<?= h($k) ?>"><?= h(langs()[$k]['label']) ?></option>
              <?php endforeach; ?>
            </select>
            <div class="grow"></div>
            <span class="fsbtns" id="fsBtns" hidden>
              <button class="btn sm" type="button" id="fsDown" title="글자 작게">−</button>
              <button class="btn sm" type="button" id="fsUp" title="글자 크게">＋</button>
            </span>
            <span class="small muted">Ctrl + Enter 로도 제출</span>
          </div>

          <?php
            /* 편집기가 비어 있을 때만 보이는 안내.
               실제로 붙여넣기를 시도한 순간에는 아래 pasteMsg 가 알려 준다. */
            $ph = !$noPaste ? '여기에 코드를 작성하세요'
                : ($isAssess ? '이 평가에서는 붙여넣기를 할 수 없습니다. 직접 입력하세요.'
                             : '이 수업에서는 붙여넣기를 할 수 없습니다. 직접 입력하세요.');
          ?>
          <textarea id="code" class="editor" spellcheck="false"
                    placeholder="<?= h($ph) ?>"></textarea>
          <div class="small warnmsg" id="pasteMsg"></div>

          <div class="btnrow">
            <button class="btn primary" id="submitBtn" type="button">제출하기</button>
            <span id="afterBtns"></span>
            <div class="grow"></div>
            <button class="btn" id="runToggle" type="button">직접 실행</button>
          </div>
          <div id="result" hidden></div>

          <!-- ── 직접 실행 ─────────────────────────
               채점이 아니라 내가 정한 입력으로 돌려만 보는 것. -->
          <div class="runbox" id="runBox" hidden>
            <div class="cap">입력</div>
            <textarea id="runInput" class="code" rows="4" spellcheck="false"
                      placeholder="여기에 입력값을 넣고 실행하면, 내 코드가 무엇을 출력하는지 볼 수 있습니다"></textarea>
            <div class="btnrow" style="margin-top:10px">
              <button class="btn" id="runBtn" type="button">실행</button>
              <span class="small muted">채점이 아닙니다. 맞았는지는 알려주지 않습니다.</span>
            </div>
            <div id="runResult" hidden></div>
          </div>
        </div>
      <?php endif; ?>

      <?php if ($u): ?>
      <div class="sec" id="mySubs">
        <h2><span class="emo" aria-hidden="true">📋</span>내 제출</h2>
        <?php if (!$mine): ?>
          <p class="small muted">아직 제출한 적이 없습니다.</p>
        <?php else: ?>
          <table class="list compact">
            <tbody>
            <?php foreach ($mine as $m): ?>
              <tr>
                <td class="num"><?= substr((string)$m['created_at'], 5, 11) ?></td>
                <td><?= verdict_badge($m['verdict'], $m['state']) ?></td>
                <td class="num"><a class="codelink" href="results.php?id=<?= (int)$m['id'] ?>"><?= h(lang_label($m['lang'])) ?></a></td>
                <td class="num right"><?= $m['max_time'] !== null
                      ? number_format((float)$m['max_time'], 3) . 's' : '' ?></td>
              </tr>
            <?php endforeach; ?>
            </tbody>
          </table>
        <?php endif; ?>
      </div>
      <?php endif; ?>
    </section>
  </div>

</div>

<script>
/* 예제 입출력 복사 */
document.querySelectorAll('.copybtn').forEach(function (b) {
  b.addEventListener('click', function () {
    var text = b.closest('.sblock').querySelector('pre').textContent;
    var done = function () {
      b.classList.add('done');
      setTimeout(function () { b.classList.remove('done'); }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {});
    } else {
      /* http 로 접속하면 clipboard API 가 막힌다 — 옛 방식으로 대신한다 */
      var t = document.createElement('textarea');
      t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); done(); } catch (e) {}
      document.body.removeChild(t);
    }
  });
});

/* 채점이 끝나면 내 제출 목록과 진행률만 새로 읽어 온다 */
window.refreshMySubs = function () {
  fetch(location.href).then(function (r) { return r.text(); }).then(function (html) {
    var d = document.createElement('div');
    d.innerHTML = html;
    var a = d.querySelector('#mySubs'), b = document.getElementById('mySubs');
    if (a && b) b.innerHTML = a.innerHTML;
    var ph = d.querySelector('.phead'), me = document.querySelector('.phead');
    if (ph && me) me.innerHTML = ph.innerHTML;
    var an = d.querySelector('#acNote'), ao = document.getElementById('acNote');
    if (an && ao) { ao.innerHTML = an.innerHTML; ao.className = an.className; }
  }).catch(function () {});
};
</script>
<script>window.LANG_MODES = <?= json_encode($langModes, JSON_UNESCAPED_UNICODE) ?>;</script>
<link rel="stylesheet" href="<?= asset('cm/cm.css') ?>">
<script src="<?= asset('cm/cm.js') ?>"></script>
<script src="<?= asset('judge.js') ?>"></script>
<?php page_foot(); ?>
