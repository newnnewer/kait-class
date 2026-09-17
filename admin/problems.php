<?php
/* admin/problems.php — 문제 목록 */
declare(strict_types=1);
require_once __DIR__ . '/../guard.php';
require_once __DIR__ . '/../layout.php';
$u = need_admin('../');

$q    = trim((string)($_GET['q'] ?? ''));
$tag  = trim((string)($_GET['tag'] ?? ''));
$msg  = '';

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
    </div>
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
          <td><input type="checkbox" class="pick" name="ids[]" value="<?= $pid ?>"></td>
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
})();
</script>
<?php page_foot(); ?>
