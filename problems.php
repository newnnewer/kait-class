<?php
/* problems.php — 전체 문제 목록 (학생 첫 화면) */
declare(strict_types=1);
require_once __DIR__ . '/guard.php';
require_once __DIR__ . '/layout.php';
$u = me();   /* 로그인하지 않아도 볼 수 있다 */

$q     = trim((string)($_GET['q'] ?? ''));
$tag   = trim((string)($_GET['tag'] ?? ''));
$only  = (string)($_GET['only'] ?? '');   /* '' | 'todo' | 'solved' */

$sql = "SELECT p.id, p.prob_no, p.title,
               (SELECT COUNT(*) FROM testcases t WHERE t.problem_id = p.id) AS tc_cnt,
               (SELECT COUNT(DISTINCT s.user_id) FROM submissions s
                 WHERE s.problem_id = p.id AND s.verdict='AC') AS solver_cnt,
               (SELECT COUNT(*) FROM submissions s
                 WHERE s.problem_id = p.id AND s.user_id = :uid AND s.verdict='AC') AS my_ac,
               (SELECT COUNT(*) FROM submissions s
                 WHERE s.problem_id = p.id AND s.user_id = :uid) AS my_try
        FROM problems p";
$args  = [':uid' => $u['id'] ?? 0];
$where = ["p.active = 1"];   /* 잠긴 문제는 목록에 나오지 않는다 */
if ($q !== '') { $where[] = "(p.title LIKE :q OR CAST(p.prob_no AS TEXT) LIKE :q)"; $args[':q'] = '%' . $q . '%'; }
if ($tag !== '') {
  $where[] = "EXISTS(SELECT 1 FROM problem_tags pt JOIN tags tg ON tg.id=pt.tag_id
                     WHERE pt.problem_id=p.id AND tg.name=:tag)";
  $args[':tag'] = $tag;
}
$sql .= " WHERE " . implode(' AND ', $where);
$sql .= " ORDER BY p.prob_no";

$rows = all($sql, $args);
if ($only === 'todo')   $rows = array_values(array_filter($rows, fn($r) => !(int)$r['my_ac']));
if ($only === 'solved') $rows = array_values(array_filter($rows, fn($r) =>  (int)$r['my_ac']));

/* 페이지 나누기 */
$total = count($rows);
$per   = 50;
$pages = max(1, (int)ceil($total / $per));
$page  = max(1, min($pages, (int)($_GET['p'] ?? 1)));
$rows  = array_slice($rows, ($page - 1) * $per, $per);

$tmap  = tags_map();
$alltg = tags_all();
$solvedCnt = (int)col("SELECT COUNT(DISTINCT problem_id) FROM submissions
                       WHERE user_id = ? AND verdict = 'AC'", [$u['id'] ?? 0]);

page_head(['title' => '문제 모음', 'root' => '', 'user' => $u, 'nav' => 'problems']);
?>
<div class="wrap">

  <div class="phead">
    <h1>문제 모음</h1>
    <span class="sub"><?= number_format($total) ?>문제<?= $u ? ' · 내가 푼 문제 ' . $solvedCnt . '개' : '' ?></span>
  </div>

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
    <?php if ($u): ?>
      <select name="only">
        <option value="">전체</option>
        <option value="todo"   <?= $only === 'todo'   ? 'selected' : '' ?>>안 푼 문제</option>
        <option value="solved" <?= $only === 'solved' ? 'selected' : '' ?>>푼 문제</option>
      </select>
    <?php endif; ?>
    <button class="btn" type="submit">찾기</button>
    <?php if ($q !== '' || $tag !== '' || $only !== ''): ?>
      <a class="btn" href="problems.php">초기화</a>
    <?php endif; ?>
  </form>

  <?php if (!$rows): ?>
    <div class="empty">조건에 맞는 문제가 없습니다.</div>
  <?php else: ?>
    <table class="list">
      <thead>
        <tr>
          <?php if ($u): ?><th style="width:64px">상태</th><?php endif; ?>
          <th style="width:76px">번호</th>
          <th>제목</th>
          <th style="width:230px">분류</th>
          <th class="right" style="width:90px">푼 사람</th>
        </tr>
      </thead>
      <tbody>
      <?php foreach ($rows as $r): $pid = (int)$r['id']; ?>
        <tr>
          <?php if ($u): ?>
            <td>
              <?php if ((int)$r['my_ac']): ?><span class="v v-AC">✓</span>
              <?php elseif ((int)$r['my_try']): ?><span class="v v-WA">…</span><?php endif; ?>
            </td>
          <?php endif; ?>
          <td class="num"><?= (int)$r['prob_no'] ?></td>
          <td class="title">
            <a href="problem.php?no=<?= (int)$r['prob_no'] ?>"><?= h($r['title']) ?></a>
            <?php if ((int)$r['tc_cnt'] === 0): ?>
              <span class="small muted">(준비 중)</span>
            <?php endif; ?>
          </td>
          <td>
            <?php foreach ($tmap[$pid] ?? [] as $tn): ?>
              <a class="tag" href="?tag=<?= rawurlencode($tn) ?>"><?= h($tn) ?></a>
            <?php endforeach; ?>
          </td>
          <td class="right num"><?= (int)$r['solver_cnt'] ?></td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
    <?= pager($page, $pages) ?>
  <?php endif; ?>

</div>
<?php page_foot(); ?>
