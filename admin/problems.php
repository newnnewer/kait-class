<?php
/* admin/problems.php — 문제 목록 */
declare(strict_types=1);
require_once __DIR__ . '/../guard.php';
require_once __DIR__ . '/../layout.php';
$u = need_admin('../');

$q    = trim((string)($_GET['q'] ?? ''));
$tag  = trim((string)($_GET['tag'] ?? ''));
$msg  = '';
$err  = '';

/* 목록에서 바로 열고 잠그기 — 여러 개를 한꺼번에도 된다 */
$do = (string)($_POST['do'] ?? '');
if ($do === 'open' || $do === 'lock') {
  $ids = array_values(array_filter(array_map('intval', (array)($_POST['ids'] ?? []))));
  if (!$ids) {
    $msg = '문제를 먼저 고르세요.';
  } else {
    $on = $do === 'open' ? 1 : 0;
    tx(function (PDO $d) use ($ids, $on) {
      $st = $d->prepare("UPDATE problems SET active = ? WHERE id = ?");
      foreach ($ids as $id) $st->execute([$on, $id]);
    });
    $msg = count($ids) . '개를 ' . ($on ? '열었습니다.' : '잠갔습니다.');
  }
}

/* 선택한 문제로 수업·평가 만들기 —
   여기서 묶음을 만들지는 않는다. 고른 번호를 편집 화면에 넘겨, 거기서 이름·기간·공개 대상을
   정하고 저장할 때 만들어진다. 중간에 그만두어도 빈 묶음이 남지 않는다. */
if ($do === 'mkset') {
  $ids = array_values(array_filter(array_map('intval', (array)($_POST['ids'] ?? []))));
  if (!$ids) {
    $err = '문제를 먼저 고르세요.';
  } else {
    $ph  = implode(',', array_fill(0, count($ids), '?'));
    $nos = array_map(fn($r) => (int)$r['prob_no'],
                     all("SELECT prob_no FROM problems WHERE id IN ($ph) ORDER BY prob_no", $ids));
    $type = ($_POST['set_type'] ?? '') === 'assessment' ? 'assessment' : 'lesson';
    header('Location: set.php?type=' . $type . '&nos=' . implode(',', $nos)); exit;
  }
}

/* 선택한 문제 삭제 —
   수업·평가에 들어 있는 문제는 지울 수 없다. 하나라도 그런 것이 있으면 아무것도 지우지 않는다.
   (정말 지우려면 그 수업·평가에서 먼저 뺀다.)
   제출 기록은 문제와 함께 지운다. 남겨 두면 어느 문제의 제출인지 알 수 없어진다. */
if ($do === 'delete') {
  $ids = array_values(array_filter(array_map('intval', (array)($_POST['ids'] ?? []))));
  if (!$ids) {
    $err = '문제를 먼저 고르세요.';
  } else {
    $ph    = implode(',', array_fill(0, count($ids), '?'));
    $inSet = all("SELECT DISTINCT p.prob_no,
                         (SELECT GROUP_CONCAT(s.title, ', ') FROM set_problems sp2
                            JOIN sets s ON s.id = sp2.set_id WHERE sp2.problem_id = p.id) AS sets
                  FROM problems p JOIN set_problems sp ON sp.problem_id = p.id
                  WHERE p.id IN ($ph) ORDER BY p.prob_no", $ids);
    if ($inSet) {
      $lines = array_map(fn($r) => $r['prob_no'] . '번 (' . $r['sets'] . ')', $inSet);
      $err = '수업·평가에 쓰이고 있어 삭제하지 않았습니다 — ' . implode(' · ', $lines)
           . '. 먼저 그 수업·평가에서 뺀 뒤 다시 시도하세요.';
    } else {
      $subs = (int)col("SELECT COUNT(*) FROM submissions WHERE problem_id IN ($ph)", $ids);
      tx(function (PDO $d) use ($ids) {
        $st = [
          $d->prepare("DELETE FROM submissions   WHERE problem_id = ?"),
          $d->prepare("DELETE FROM runs          WHERE problem_id = ?"),
          $d->prepare("DELETE FROM testcases     WHERE problem_id = ?"),
          $d->prepare("DELETE FROM problem_tags  WHERE problem_id = ?"),
          $d->prepare("DELETE FROM problems      WHERE id = ?"),
        ];
        foreach ($ids as $id) foreach ($st as $q1) $q1->execute([$id]);
      });
      $msg = count($ids) . '개를 삭제했습니다.'
           . ($subs ? ' 제출 기록 ' . number_format($subs) . '건도 함께 지웠습니다.' : '');
    }
  }
}

$sql = "SELECT p.id, p.prob_no, p.title, p.time_limit, p.memory_limit, p.active,
               (SELECT COUNT(*) FROM testcases t WHERE t.problem_id = p.id) AS tc_cnt,
               (SELECT COUNT(*) FROM submissions s WHERE s.problem_id = p.id) AS sub_cnt
        FROM problems p";
$args = [];
$where = [];
if ($q !== '') {
  $where[] = "(p.title LIKE :q OR CAST(p.prob_no AS TEXT) LIKE :q)";
  $args[':q'] = '%' . $q . '%';
}
if ($tag !== '') {
  $where[] = "EXISTS(SELECT 1 FROM problem_tags pt JOIN tags tg ON tg.id = pt.tag_id
                     WHERE pt.problem_id = p.id AND tg.name = :tag)";
  $args[':tag'] = $tag;
}
if ($where) $sql .= " WHERE " . implode(' AND ', $where);
$sql .= " ORDER BY p.prob_no";

$all   = all($sql, $args);
$total = count($all);
$per   = 50;
$pages = max(1, (int)ceil($total / $per));
$page  = max(1, min($pages, (int)($_GET['p'] ?? 1)));
$rows  = array_slice($all, ($page - 1) * $per, $per);
$tmap  = tags_map();
$alltg = tags_all();

page_head(['title' => '문제 관리', 'root' => '../', 'user' => $u, 'nav' => 'problems']);
?>
<div class="wrap">

  <div class="phead">
    <h1>문제 관리</h1>
    <span class="sub"><?= number_format($total) ?>개</span>
    <div class="grow"></div>
    <a class="btn" href="stats.php">통계</a>
    <a class="btn" href="renumber.php">번호 일괄 수정</a>
    <a class="btn" href="import.php">가져오기</a>
    <a class="btn primary" href="problem.php">새 문제</a>
  </div>

  <?php if ($msg): ?><div class="note ok"><?= h($msg) ?></div><?php endif; ?>
  <?php if ($err): ?><div class="note bad"><?= h($err) ?></div><?php endif; ?>

  <form class="searchbar" method="get">
    <input type="text" name="q" value="<?= h($q) ?>" placeholder="번호 또는 제목">
    <select name="tag">
      <option value="">전체 분류</option>
      <?php foreach ($alltg as $t): ?>
        <option value="<?= h($t['name']) ?>" <?= $tag === $t['name'] ? 'selected' : '' ?>>
          <?= h($t['name']) ?> (<?= (int)$t['use_cnt'] ?>)
        </option>
      <?php endforeach; ?>
    </select>
    <button class="btn" type="submit">찾기</button>
    <?php if ($q !== '' || $tag !== ''): ?>
      <a class="btn" href="problems.php">초기화</a>
    <?php endif; ?>
  </form>

  <?php if (!$rows): ?>
    <div class="empty">
      <?= ($q !== '' || $tag !== '') ? '조건에 맞는 문제가 없습니다.' : '아직 등록된 문제가 없습니다.' ?>
    </div>
  <?php else: ?>
    <form method="post" action="export.php" id="expform">
    <div class="bulkbar">
      <label class="chk"><input type="checkbox" id="chkAll"> 전체 선택</label>
      <span class="small muted" id="pickCount">선택 0개</span>
      <div class="grow"></div>
      <button class="btn" type="submit" formaction="problems.php" name="do" value="open">열기</button>
      <button class="btn" type="submit" formaction="problems.php" name="do" value="lock">잠그기</button>
      <span class="sepline"></span>
      <button class="btn" type="submit">선택한 문제 내보내기</button>
      <button class="btn" type="submit" name="all" value="1">전체 내보내기</button>
      <span class="sepline"></span>
      <button class="btn" type="submit" formaction="problems.php" name="do" value="mkset"
              onclick="this.form.set_type.value='lesson'">수업 만들기</button>
      <button class="btn" type="submit" formaction="problems.php" name="do" value="mkset"
              onclick="this.form.set_type.value='assessment'">평가 만들기</button>
      <span class="sepline"></span>
      <button class="btn danger" type="submit" formaction="problems.php" name="do" value="delete"
              onclick="return confirmDelete()">삭제</button>
    </div>
    <input type="hidden" name="set_type" value="lesson">
    <table class="list">
      <thead>
        <tr>
          <th style="width:34px"></th>
          <th class="center" style="width:62px">상태</th>
          <th style="width:80px">번호</th>
          <th>제목</th>
          <th style="width:240px">분류</th>
          <th class="center" style="width:90px">테스트</th>
          <th class="center nowrap" style="width:86px">수정</th>
          <th class="right" style="width:70px">제출</th>
          <th class="right" style="width:110px">제한</th>
        </tr>
      </thead>
      <tbody>
      <?php foreach ($rows as $r): $pid = (int)$r['id']; ?>
        <tr class="<?= (int)$r['active'] ? '' : 'dim' ?>">
          <td><input type="checkbox" class="pick" name="ids[]" value="<?= $pid ?>"
                     data-no="<?= (int)$r['prob_no'] ?>" data-sub="<?= (int)$r['sub_cnt'] ?>"></td>
          <td class="center">
            <?php if ((int)$r['active']): ?><span class="v v-AC">열림</span>
            <?php else: ?><span class="v v-wait">잠김</span><?php endif; ?>
          </td>
          <td class="num"><?= (int)$r['prob_no'] ?></td>
          <td class="title"><a href="../problem.php?no=<?= (int)$r['prob_no'] ?>"><?= h($r['title']) ?></a></td>
          <td>
            <?php foreach ($tmap[$pid] ?? [] as $tn): ?>
              <a class="tag" href="?tag=<?= rawurlencode($tn) ?>"><?= h($tn) ?></a>
            <?php endforeach; ?>
          </td>
          <td class="center num">
            <a class="codelink" href="testcases.php?id=<?= $pid ?>" title="테스트케이스 관리">
              <?php if ((int)$r['tc_cnt'] === 0): ?>
                <span style="color:var(--bad)">없음</span>
              <?php else: ?>
                <?= (int)$r['tc_cnt'] ?>개
              <?php endif; ?>
            </a>
          </td>
          <td class="center nowrap"><a class="btn sm" href="problem.php?id=<?= $pid ?>">수정</a></td>
          <td class="right num"><?= (int)$r['sub_cnt'] ?></td>
          <td class="right num"><?= rtrim(rtrim(number_format((float)$r['time_limit'], 1), '0'), '.') ?>초 / <?= (int)round($r['memory_limit'] / 1000) ?>MB</td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
    <?= pager($page, $pages) ?>
    </form>
  <?php endif; ?>

</div>

<script>
(function(){
  var all = document.getElementById('chkAll');
  if (!all) return;
  var picks = function(){ return document.querySelectorAll('.pick:checked'); };
  var refresh = function(){
    document.getElementById('pickCount').textContent = '선택 ' + picks().length + '개';
  };
  all.addEventListener('change', function(){
    document.querySelectorAll('.pick').forEach(function(c){ c.checked = all.checked; });
    refresh();
  });
  document.querySelectorAll('.pick').forEach(function(c){ c.addEventListener('change', refresh); });

  /* 삭제는 되돌릴 수 없다. 무엇이 사라지는지 보여 주고 '삭제' 를 직접 치게 한다.
     (수업·평가에 쓰이는 문제인지는 서버가 다시 확인해 막는다) */
  window.confirmDelete = function(){
    var picked = Array.prototype.slice.call(picks());
    if (!picked.length) { alert('삭제할 문제를 먼저 선택하세요.'); return false; }
    var nos = picked.slice(0, 10).map(function(c){ return c.dataset.no + '번'; }).join(', ')
            + (picked.length > 10 ? ' 외 ' + (picked.length - 10) + '개' : '');
    var subs = picked.reduce(function(a, c){ return a + (+c.dataset.sub || 0); }, 0);
    var ans = prompt(
      '문제 ' + picked.length + '개를 삭제합니다.\n' + nos + '\n\n'
      + (subs ? '학생 제출 기록 ' + subs + '건도 함께 사라집니다. ' : '')
      + '되돌릴 수 없습니다.\n계속하려면 아래에 삭제 라고 입력하세요.');
    if (ans === null) return false;
    if (ans.trim() !== '삭제') { alert('삭제하지 않았습니다.'); return false; }
    return true;
  };
})();
</script>
<?php page_foot(); ?>
