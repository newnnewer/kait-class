<?php
/* tags.php — 출처·분류 모아 보기 */
declare(strict_types=1);
require_once __DIR__ . '/guard.php';
require_once __DIR__ . '/layout.php';
$u = me();

$rows = all("SELECT t.name, COUNT(pt.problem_id) AS cnt,
                    (SELECT COUNT(DISTINCT s.problem_id) FROM submissions s
                      JOIN problem_tags pt2 ON pt2.problem_id = s.problem_id
                      WHERE pt2.tag_id = t.id AND s.user_id = :uid AND s.verdict='AC') AS my_ac
             FROM tags t
             LEFT JOIN problem_tags pt ON pt.tag_id = t.id
             GROUP BY t.id ORDER BY t.name", [':uid' => $u['id'] ?? 0]);

page_head(['title' => '출처·분류', 'root' => '', 'user' => $u, 'nav' => 'tags']);
?>
<div class="wrap">
  <div class="phead">
    <h1>출처 · 분류</h1>
    <span class="sub"><?= count($rows) ?>개</span>
  </div>

  <?php if (!$rows): ?>
    <div class="empty">아직 분류가 없습니다.</div>
  <?php else: ?>
    <table class="list">
      <thead>
        <tr><th>이름</th><th class="right" style="width:110px">문제 수</th>
            <?php if ($u): ?><th class="right" style="width:130px">내가 푼 문제</th><?php endif; ?></tr>
      </thead>
      <tbody>
      <?php foreach ($rows as $r): ?>
        <tr>
          <td class="title"><a href="problems.php?tag=<?= rawurlencode($r['name']) ?>"><?= h($r['name']) ?></a></td>
          <td class="right num"><?= (int)$r['cnt'] ?></td>
          <?php if ($u): ?><td class="right num"><?= (int)$r['my_ac'] ?></td><?php endif; ?>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
  <?php endif; ?>
</div>
<?php page_foot(); ?>
