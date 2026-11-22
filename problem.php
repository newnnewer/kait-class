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

/* 기간 밖의 평가 안에서는 문제를 보여 주지 않는다 (2.1.0) — 평가 화면으로 돌려보낸다.
   (문제 모음에 열려 있는 문제를 평가 없이 여는 것은 여기서 막지 않는다. 가리려면 문제를 잠근다.) */
if ($u && !empty($_GET['set'])) {
  $hs = student_set_or_null($u, (int)$_GET['set']);
  if ($hs && set_hidden_for($u, $hs)
      && one("SELECT 1 x FROM set_problems WHERE set_id=? AND problem_id=?", [(int)$hs['id'], $pid])) {
    header('Location: set.php?id=' . (int)$hs['id']); exit;
  }
}

/* 잠긴 문제는 관리자와, 그 문제가 담긴 수업·평가 참여자만 볼 수 있다 */
if (!problem_visible($u, $p, !empty($_GET['set']) ? (int)$_GET['set'] : null)) {
  header('Location: problems.php'); exit;
}

/* 교사 화면 버튼의 열기 · 잠그기 (1.17.0) — 교사만. 처리한 뒤 같은 주소로 다시 이동한다 */
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
  $do = (string)($_POST['do'] ?? '');
  if (!is_admin($u) || ($do !== 'open' && $do !== 'lock')) { header('Location: problems.php'); exit; }
  db()->prepare("UPDATE problems SET active = ? WHERE id = ?")->execute([$do === 'open' ? 1 : 0, $pid]);
  redirect_with($do === 'open' ? '열었습니다. 문제 모음에 보입니다.'
                               : '잠갔습니다. 문제 모음에 보이지 않습니다.');
}
$tv = teacher_view($u);
[$flashMsg, $flashErr] = $tv ? flash_take() : ['', ''];

/* ── 묶음 안에서 들어온 경우 ─────────────────── */
$set = null; $isAssess = false; $need = 0; $canSubmit = true; $setId = null;
$banned = [];   /* 이 묶음에서 이 문제에 쓸 수 없는 단어 (2.1.0) */
/* 붙여넣기 차단 — 평가는 언제나 막고, 수업은 묶음마다 정한다.
   묶음 밖에서 자유롭게 푸는 경우는 막지 않는다. */
$noPaste = false;
if ($u && !empty($_GET['set'])) {
  $set = student_set_or_null($u, (int)$_GET['set']);
  if ($set) {
    $sp = one("SELECT required_ac, banned FROM set_problems WHERE set_id=? AND problem_id=?",
              [$set['id'], $pid]);
    if (!$sp) { $set = null; }                    /* 이 묶음의 문제가 아니다 */
    elseif (set_gate($u, $set)) {                 /* 허용 IP · 입장 코드 (2.1.0) — 평가 화면에서 확인받고 온다 */
      header('Location: set.php?id=' . (int)$set['id']); exit;
    }
    else {
      $setId     = (int)$set['id'];
      $isAssess  = $set['set_type'] === 'assessment';
      $noPaste   = $isAssess || (int)($set['no_paste'] ?? 0) === 1;
      $need      = $isAssess ? (int)$sp['required_ac'] : 1;
      $canSubmit = set_open_for($u, $set);
      $banned    = banned_list((string)($sp['banned'] ?? ''));
      set_enter_note($u, $set);                    /* 엄격 모드 — 들어온 IP · 기기를 적는다 (2.1.0) */
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

/* 예시 입력 · 출력을 좌우로 놓을지 — 둘 다 가장 긴 줄이 반 칸에 들어갈 때만 (입력이 없으면 위아래 그대로).
   고정폭 글꼴이라 글자 폭으로 잰다 (한글은 2칸). 24칸 = style.css 의 .sample pre 15px 기준 반 칸. */
$sampleSide = function (array $s): bool {
  if (trim((string)$s['input']) === '') return false;
  foreach ([$s['input'], $s['expected']] as $t) {
    foreach (preg_split('/\R/u', (string)$t) ?: [] as $ln) {
      if (mb_strwidth(rtrim($ln), 'UTF-8') > 24) return false;
    }
  }
  return true;
};
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
    <?php if ($tv): /* 교사 화면에만 (1.17.0) — 제출 기록은 수업 · 평가 안이면 그 묶음의 기록, 아니면 채점 결과 */ ?>
      <div class="tbtns">
        <a class="btn" href="admin/problem.php?id=<?= $pid ?>">수정</a>
        <a class="btn" href="admin/testcases.php?id=<?= $pid ?>">테스트케이스</a>
        <a class="btn" href="<?= $setId ? 'admin/submissions.php?set_id=' . $setId . '&amp;problem_id=' . $pid
                                         : 'results.php?prob=' . (int)$p['prob_no'] ?>">제출 기록</a>
        <form method="post">
          <button class="btn<?= (int)$p['active'] ? '' : ' primary' ?>" type="submit" name="do"
                  value="<?= (int)$p['active'] ? 'lock' : 'open' ?>"><?= (int)$p['active'] ? '잠그기' : '열기' ?></button>
        </form>
      </div>
    <?php endif; ?>
    <a class="btn" href="<?= $set ? 'set.php?id=' . $setId : 'problems.php' ?>">목록</a>
  </div>

  <?php if ($flashMsg): ?><div class="note ok"><?= h($flashMsg) ?></div><?php endif; ?>
  <?php if ($flashErr): ?><div class="note err"><?= h($flashErr) ?></div><?php endif; ?>

  <?php if ((int)$p['active'] === 0 && teacher_view($u)): /* 교사 화면에만 (2.1.0) — 학생에게는 풀이와 상관없는 말이다 */ ?>
    <div class="note info">이 문제는 잠겨 있어 문제 모음에 보이지 않습니다.</div>
  <?php endif; ?>

  <div class="limits">
    <span>시간 제한 <b><?= rtrim(rtrim(number_format((float)$p['time_limit'], 1), '0'), '.') ?>초</b></span>
    <span>메모리 제한 <b><?= (int)round($p['memory_limit'] / 1000) ?>MB</b></span>
    <?php foreach ($tags as $t): ?>
      <a class="tag"<?= tag_attr($t) ?> href="problems.php?tag=<?= rawurlencode($t) ?>"><?= h($t) ?></a>
    <?php endforeach; ?>
  </div>

  <div class="split">
    <!-- ── 왼쪽: 문제 ── -->
    <section class="pane">
      <h2 class="ph"><?= icon('desc', '📝') ?>문제 설명</h2>
      <div class="md"><?= md($p['description']) ?></div>

      <?php if (trim((string)$p['input_desc']) !== ''): ?>
        <h2 class="ph"><?= icon('input', '📥') ?>입력 설명</h2>
        <div class="md"><?= md($p['input_desc']) ?></div>
      <?php endif; ?>

      <?php if (trim((string)$p['output_desc']) !== ''): ?>
        <h2 class="ph"><?= icon('output', '📤') ?>출력 설명</h2>
        <div class="md"><?= md($p['output_desc']) ?></div>
      <?php endif; ?>

      <?php if ($samples): ?>
        <h2 class="ph"><?= icon('example', '💡') ?>입/출력 예시</h2>
        <?php foreach ($samples as $i => $s): ?>
          <div class="sample<?= $sampleSide($s) ? ' side' : '' ?>">
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

    <!-- ── 오른쪽: 제출 — 스크롤해도 화면 위쪽에 붙어 있다 (.pane.stick) ── -->
    <section class="pane stick">
      <?php $clock = $set ? set_clock_tag($set) : ''; if ($clock !== ''): /* 평가의 남은 시간 (2.1.0) */ ?>
        <div class="clockbar"><?= $clock ?></div>
      <?php endif; ?>
      <?php
        /* 통과 조건 안내는 2회 이상일 때만 (2.1.0) — 1회면 '통과하면 끝'이라 따로 말하지 않는다.
           엄격 모드의 화면 이탈 안내는 같은 상자의 둘째 줄. 통과 조건이 없으면 그 줄만 나온다. */
        $showNeed   = $isAssess && $need > 1;
        $showStrict = $isAssess && $set && set_strict($set);
      ?>
      <?php if ($showNeed || $showStrict): ?>
        <div class="note <?= ($showNeed && $myAc >= $need) ? 'ok' : 'info' ?>" id="acNote">
          <?php if ($showNeed): ?>
            <?php if ($myAc >= $need): ?>
              <b><?= $need ?>회</b> 모두 통과 완료
            <?php else: ?>
              통과 조건 <b><?= $need ?>회</b> 중 <b><?= $myAc ?>회</b> 통과하였습니다.
            <?php endif; ?>
          <?php endif; ?>
          <?php if ($showStrict): ?>
            <?php if (is_admin($u)): ?>
              <div class="<?= $showNeed ? 'small' : '' ?>">엄격 모드 평가입니다. 선생님 계정은 화면 이탈을 기록하지 않습니다 — 학생 계정으로 로그인해야 확인할 수 있습니다.</div>
            <?php else:
              /* 지금까지 이 평가에서 남은 이탈 기록. 이탈이 있었으면 짧은 한 줄로 바꾼다 —
                 돌아올 때마다 judge.js 가 같은 문구로 이 줄을 고쳐 쓴다 (두 곳의 문구를 같이 고칠 것). */
              $aw = one("SELECT COUNT(*) n, COALESCE(SUM(ms),0) ms FROM set_events
                         WHERE set_id=? AND user_id=? AND kind='away'", [$setId, $u['id']]); ?>
              <div class="<?= $showNeed ? 'small' : '' ?>" id="awayLine" data-n="<?= (int)$aw['n'] ?>" data-ms="<?= (int)$aw['ms'] ?>"><?=
                (int)$aw['n']
                  ? '지금까지 화면을 떠나 있었던 시간 <b>' . h(ms_text((int)$aw['ms'])) . '(' . (int)$aw['n'] . '번)</b>가 기록되었습니다.'
                  : '이 화면을 떠나 다른 창 · 탭으로 가면 떠나 있던 시간이 기록됩니다.' ?></div>
            <?php endif; ?>
          <?php endif; ?>
        </div>
      <?php endif; ?>

      <?php if ($banned): ?>
        <div class="note info bannednote">
          <b>사용 금지</b>
          <?php foreach ($banned as $w): ?><code><?= h($w) ?></code><?php endforeach; ?>
          <span class="small">이 단어가 코드에 있으면 제출 · 실행할 수 없습니다. (주석 · 문자열 안도 포함)</span>
        </div>
      <?php endif; ?>
      <?php if ($set): ?><?= admin_preview_note($u, $set) ?><?php endif; ?>
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
             data-strict="<?= ($set && set_strict($set) && !is_admin($u)) ? '1' : '0' ?>"
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
              <span class="fsval" id="fsVal" title="코드창 글자 크기"></span>
              <button class="btn sm" type="button" id="fsUp" title="글자 크게">＋</button>
            </span>
          </div>

          <?php
            /* 편집기가 비어 있을 때만 보이는 안내.
               실제로 붙여넣기를 시도한 순간에는 아래 pasteMsg 가 알려 준다. */
            $ph = !$noPaste ? '여기에 코드를 작성하세요'
                : ($isAssess ? '이 평가에서는 붙여넣기를 할 수 없습니다. 직접 입력하세요.'
                             : '이 수업에서는 붙여넣기를 할 수 없습니다. 직접 입력하세요.');
            /* 단축키 안내도 여기에 (여러 줄 — 편집기가 줄바꿈 그대로 보여 준다) */
            $ph .= "\n제출하기: Ctrl + Enter\n실행하기: Ctrl + Shift + Enter";
          ?>
          <!-- 코드창 + 버튼 줄을 한 테두리 안에 — 코드와 입력·출력 사이를 줄인다 -->
          <div class="edframe" id="edFrame">
            <textarea id="code" class="editor" spellcheck="false"
                      placeholder="<?= h($ph) ?>"></textarea>
            <div class="btnrow edbar">
              <button class="btn primary" id="submitBtn" type="button">제출하기</button>
              <span id="afterBtns"></span>
              <button class="btn" id="runToggle" type="button" aria-expanded="false" aria-controls="runBox">실행하기</button>
              <span class="small muted runhint" id="runHint" hidden>채점이 아니며, 맞았는지 알려주지 않습니다.</span>
              <span class="small warnmsg" id="pasteMsg"></span>
            </div>
          </div>
          <div id="result" hidden></div>

          <!-- ── 직접 실행 ─────────────────────────
               채점이 아니라 내가 정한 입력으로 돌려만 보는 것.
               처음 [실행하기]를 누르면 첫 번째 입력 예시를 채워 곧바로 실행하고,
               그 뒤로는 버튼이 [실행]으로 바뀌어 누를 때마다 실행만 한다 (닫히지 않음).
               [입력] [출력] 상자를 나란히 두어 코드와 결과가 한 화면에 들어오게 한다. -->
          <div class="runbox" id="runBox" hidden
               data-sample="<?= h($samples ? (string)$samples[0]['input'] : '') ?>">
            <div class="iobox">
              <div class="iohead">
                <label class="cap" for="runInput">입력</label>
                <span class="small muted">입력값을 지정할 수 있습니다.</span>
              </div>
              <textarea id="runInput" class="code" rows="4" spellcheck="false"></textarea>
            </div>
            <div class="iobox">
              <div class="iohead runhead">
                <span class="cap">출력</span>
                <span class="runstat" id="runStatus" aria-live="polite"></span>
              </div>
              <pre class="runout" id="runOut"></pre>
            </div>
            <!-- 시간 · 메모리는 출력 상자 아래 오른쪽 — 제목 줄이 한 줄로 끝나 입력·출력 상자 높이가 맞는다 -->
            <div class="runmeta" id="runMeta"></div>
            <div class="runerr" id="runErr" hidden>
              <div class="cap">오류</div>
              <pre class="runout"></pre>
            </div>
          </div>
        </div>
      <?php endif; ?>

      <?php if ($u): ?>
      <div class="sec" id="mySubs">
        <h2><?= icon('subs', '📋') ?>내 제출</h2>
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
