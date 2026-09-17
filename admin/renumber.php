<?php
/* ═══════════════════════════════════════════════
   admin/renumber.php — 문제 번호 일괄 수정

   1) 현재 번호 목록을 복사해 스프레드시트에 붙인다 (현재 번호 · 새 번호, 두 열)
   2) 새 번호 열만 고쳐서 다시 붙여넣는다 → 미리보기
   3) 적용

   - 첫 열(현재 번호)로 문제를 찾는다. 제목은 쓰지 않는다.
   - 붙여넣지 않은 문제는 번호가 그대로다.
   - 하나라도 잘못되면 아무것도 바꾸지 않는다.
   - 제출·수업·평가는 내부 id 로 이어져 있어 번호가 바뀌어도 따라간다.
     번호로 건 링크(problem.php?no=…)만 따라가지 않는다.
   ═══════════════════════════════════════════════ */
declare(strict_types=1);
require_once __DIR__ . '/../guard.php';
require_once __DIR__ . '/../layout.php';
$u = need_admin('../');

const RENUM_MAX = 9999999;

/* 붙여넣은 글을 검사한다.
   돌려주는 값: ['errors' => [...], 'changes' => [현재번호 => 새번호] (실제로 바뀌는 것만)] */
function renum_check(string $text): array {
  $errors = [];
  $map    = [];            // 현재 번호 => 새 번호 (붙여넣은 줄 전부)
  $lineNo = 0;

  foreach (preg_split('/\r\n|\r|\n/', $text) as $line) {
    $lineNo++;
    $line = trim($line);
    if ($line === '') continue;
    $c = array_map('trim', preg_split('/[,\t]/', $line));
    $old = $c[0] ?? '';
    $new = $c[1] ?? '';

    if (!preg_match('/^\d+$/', $old)) { $errors[] = "{$lineNo}번째 줄: 현재 번호 '{$old}' 가 숫자가 아닙니다."; continue; }
    if ($new === '')                  { $errors[] = "{$lineNo}번째 줄: 새 번호가 비어 있습니다."; continue; }
    if (!preg_match('/^\d+$/', $new)) { $errors[] = "{$lineNo}번째 줄: 새 번호 '{$new}' 가 숫자가 아닙니다."; continue; }
    $o = (int)$old; $n = (int)$new;
    if ($n < 1 || $n > RENUM_MAX)     { $errors[] = "{$lineNo}번째 줄: 새 번호 {$n} 은(는) 1 ~ " . RENUM_MAX . " 사이여야 합니다."; continue; }
    if (isset($map[$o]))              { $errors[] = "{$lineNo}번째 줄: 현재 번호 {$o} 이(가) 두 번 적혀 있습니다."; continue; }
    $map[$o] = $n;
  }

  if (!$map && !$errors) $errors[] = '붙여넣은 내용이 없습니다.';

  /* 지금 DB 의 번호 */
  $exist = [];
  foreach (all("SELECT prob_no FROM problems") as $r) $exist[(int)$r['prob_no']] = true;

  foreach ($map as $o => $n) {
    if (!isset($exist[$o])) $errors[] = "현재 번호 {$o} 인 문제가 없습니다.";
  }

  /* 바뀐 뒤의 전체 번호에서 겹치는 것이 있는지.
     붙여넣지 않은 문제는 지금 번호를 그대로 쓴다. */
  $final = [];   // 새 번호 => [그 번호가 될 현재 번호들]
  foreach (array_keys($exist) as $o) {
    $final[$map[$o] ?? $o][] = $o;
  }
  foreach ($final as $n => $olds) {
    if (count($olds) < 2) continue;
    sort($olds);
    $who = implode(', ', array_map(function ($o) use ($map) {
      return isset($map[$o]) ? "{$o}번" : "{$o}번(붙여넣지 않음)";
    }, $olds));
    $errors[] = "새 번호 {$n} 이(가) 겹칩니다 — {$who}";
  }

  $changes = [];
  foreach ($map as $o => $n) if ($o !== $n) $changes[$o] = $n;
  ksort($changes);
  return ['errors' => $errors, 'changes' => $changes];
}

$text   = nl_clean((string)($_POST['text'] ?? ''));
$do     = (string)($_POST['do'] ?? '');
$result = null;
$msg    = '';
$fail   = '';

if ($do === 'preview' || $do === 'apply') {
  $result = renum_check($text);

  if ($do === 'apply' && !$result['errors'] && $result['changes']) {
    $changes = $result['changes'];
    try {
      tx(function (PDO $d) use ($changes) {
        /* 번호를 맞바꾸면 한 줄씩 바꾸는 도중에 잠시 겹쳐 DB 가 거부한다.
           바뀌는 문제를 모두 임시 번호(음수, -id)로 옮긴 뒤 새 번호를 준다. */
        $ids = [];
        $get = $d->prepare("SELECT id FROM problems WHERE prob_no = ?");
        foreach ($changes as $o => $n) {
          $get->execute([$o]);
          $id = $get->fetchColumn();
          if ($id === false) throw new RuntimeException("현재 번호 {$o} 인 문제가 없습니다.");
          $ids[(int)$id] = $n;
        }
        $tmp = $d->prepare("UPDATE problems SET prob_no = -id WHERE id = ?");
        foreach (array_keys($ids) as $id) $tmp->execute([$id]);
        $set = $d->prepare("UPDATE problems SET prob_no = ? WHERE id = ?");
        foreach ($ids as $id => $n) $set->execute([$n, $id]);
      });
      header('Location: renumber.php?done=' . count($changes));
      exit;
    } catch (Throwable $e) {
      error_log('[renumber] ' . $e->getMessage());
      $fail = '적용하지 못했습니다. 아무것도 바뀌지 않았습니다. 목록을 새로 복사해 다시 시도하세요.';
      $do = 'preview';
    }
  }
}
if (isset($_GET['done'])) $msg = (int)$_GET['done'] . '개 문제의 번호를 바꿨습니다.';

/* 복사용 목록: 현재 번호 [탭] 새 번호(처음엔 같은 값) */
$nos  = array_map('intval', array_column(all("SELECT prob_no FROM problems ORDER BY prob_no"), 'prob_no'));
$list = implode("\n", array_map(function ($n) { return $n . "\t" . $n; }, $nos));

/* 미리보기에서 제목을 함께 보여 준다 (확인용) */
$titles = [];
if ($result && $result['changes']) {
  $ph = implode(',', array_fill(0, count($result['changes']), '?'));
  foreach (all("SELECT prob_no, title FROM problems WHERE prob_no IN ($ph)", array_keys($result['changes'])) as $r) {
    $titles[(int)$r['prob_no']] = $r['title'];
  }
}

/* 번호로 건 링크가 몇 군데 있는지 — 번호를 바꾸면 따라가지 않는다 */
$linkCnt = 0;
if ($result && $result['changes'] && !$result['errors']) {
  $linkCnt = (int)col("SELECT COUNT(*) FROM notices WHERE body LIKE '%problem.php?no=%'")
           + (int)col("SELECT COUNT(*) FROM problems
                       WHERE description LIKE '%problem.php?no=%'
                          OR input_desc  LIKE '%problem.php?no=%'
                          OR output_desc LIKE '%problem.php?no=%'");
}

page_head(['title' => '문제 번호 일괄 수정', 'root' => '../', 'user' => $u, 'nav' => 'problems']);
?>
<div class="wrap narrow">

  <div class="phead">
    <h1>문제 번호 일괄 수정</h1>
    <span class="sub"><?= number_format(count($nos)) ?>개</span>
    <div class="grow"></div>
    <a class="btn" href="problems.php">문제 관리로</a>
  </div>

  <?php if ($msg): ?><div class="note ok"><?= h($msg) ?></div><?php endif; ?>
  <?php if ($fail): ?><div class="note err"><?= h($fail) ?></div><?php endif; ?>

  <?php if ($result && $result['errors']): ?>
    <div class="note err">
      아래 문제가 있어 아무것도 바꾸지 않았습니다.
      <ul class="renum-errs">
        <?php foreach (array_slice($result['errors'], 0, 30) as $e): ?><li><?= h($e) ?></li><?php endforeach; ?>
        <?php if (count($result['errors']) > 30): ?><li>… 외 <?= count($result['errors']) - 30 ?>건</li><?php endif; ?>
      </ul>
    </div>
  <?php endif; ?>

  <?php if ($result && !$result['errors'] && $do === 'preview'): ?>
    <?php if (!$result['changes']): ?>
      <div class="note info">바뀌는 번호가 없습니다.</div>
    <?php else: ?>
      <div class="panel renum-preview">
        <div class="panel-b">
          <h2 style="margin-top:0">미리보기 — <?= count($result['changes']) ?>개가 바뀝니다</h2>
          <div class="renum-scroll">
            <table class="list compact">
              <thead><tr><th style="width:90px">현재</th><th style="width:30px"></th><th style="width:90px">새 번호</th><th>제목 (확인용)</th></tr></thead>
              <tbody>
              <?php foreach ($result['changes'] as $o => $n): ?>
                <tr>
                  <td class="num"><?= $o ?></td><td class="muted">→</td>
                  <td class="num"><b><?= $n ?></b></td>
                  <td><?= h($titles[$o] ?? '') ?></td>
                </tr>
              <?php endforeach; ?>
              </tbody>
            </table>
          </div>
          <p class="small muted">
            제출 기록과 수업·평가 구성은 번호가 바뀌어도 그대로 따라갑니다.
            다만 <b>번호로 걸어 둔 링크</b>(<code>problem.php?no=…</code>)와 학생이 저장해 둔 주소는 따라가지 않습니다.
            <?php if ($linkCnt): ?>
              <br><span class="warnmsg">공지사항·문제 설명 <?= $linkCnt ?>곳에 이런 링크가 있습니다. 적용한 뒤 확인하세요.</span>
            <?php endif; ?>
          </p>
          <form method="post" class="inline">
            <input type="hidden" name="text" value="<?= h($text) ?>">
            <button class="btn primary" type="submit" name="do" value="apply">적용</button>
            <span class="small muted">아래에서 고쳐 다시 미리보기를 해도 됩니다.</span>
          </form>
        </div>
      </div>
    <?php endif; ?>
  <?php endif; ?>

  <!-- ── 1. 현재 번호 복사 ── -->
  <section class="sec">
    <h2>1. 현재 번호 복사</h2>
    <p class="small muted" style="margin-top:0">
      두 열(현재 번호 · 새 번호)로 되어 있습니다. 스프레드시트에 붙여넣고 <b>두 번째 열만</b> 고치세요.
      첫 번째 열은 고치면 안 됩니다.
    </p>
    <textarea id="renumList" class="code" rows="8" readonly><?= h($list) ?></textarea>
    <div class="inline" style="margin-top:8px">
      <button class="btn" type="button" id="renumCopy">복사</button>
      <span class="small" id="renumCopyMsg"></span>
    </div>
  </section>

  <!-- ── 2. 고친 목록 붙여넣기 ── -->
  <section class="sec">
    <h2>2. 고친 목록 붙여넣기</h2>
    <form method="post">
      <div class="field">
        <textarea name="text" class="code" rows="10"
                  placeholder="1001&#9;1001&#10;1002&#9;1003&#10;1003&#9;1002"><?= h($text) ?></textarea>
        <p class="small muted" style="margin:6px 0 0">
          한 줄에 하나씩 — 현재 번호, 새 번호 (탭이나 쉼표로 구분).
          바꿀 줄만 붙여넣어도 됩니다. 붙여넣지 않은 문제는 번호가 그대로입니다.
          번호가 하나라도 겹치면 아무것도 바꾸지 않습니다.
        </p>
      </div>
      <button class="btn primary" type="submit" name="do" value="preview">미리보기</button>
    </form>
  </section>
</div>

<script>
document.getElementById('renumCopy').addEventListener('click', function () {
  var ta  = document.getElementById('renumList');
  var msg = document.getElementById('renumCopyMsg');
  var ok  = function () { msg.textContent = '복사했습니다. 스프레드시트에 붙여넣으세요.'; };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(ta.value).then(ok).catch(fallback);
  } else {
    fallback();
  }
  /* http 로 접속하면 clipboard API 가 막힌다 — 옛 방식으로 대신한다 */
  function fallback() {
    ta.focus(); ta.select();
    try { document.execCommand('copy'); ok(); }
    catch (e) { msg.textContent = 'Ctrl+C 로 복사하세요.'; }
  }
});
</script>
<?php page_foot();
