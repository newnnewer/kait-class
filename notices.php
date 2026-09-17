<?php
/* notices.php — 공지사항 목록 (로그인하지 않아도 볼 수 있다) */
declare(strict_types=1);
require __DIR__ . '/guard.php';
require __DIR__ . '/layout.php';
$u = me();

$all   = notices_public();
$total = count($all);
$per   = 20;
$pages = max(1, (int)ceil($total / $per));
$page  = max(1, min($pages, (int)($_GET['p'] ?? 1)));
$rows  = array_slice($all, ($page - 1) * $per, $per);

page_head(['title' => '공지사항', 'root' => '', 'user' => $u, 'nav' => 'notices']);
?>
<div class="wrap narrow">

  <div class="phead">
    <h1>공지사항</h1>
    <span class="sub"><?= number_format($total) ?>건</span>
    <div class="grow"></div>
    <?php if ($u && $u['role'] === 'admin'): ?>
      <a class="btn" href="admin/notices.php">관리</a>
    <?php endif; ?>
  </div>

  <?php if (!$rows): ?>
    <div class="empty">아직 공지가 없습니다.</div>
  <?php else: ?>
    <table class="list">
      <thead>
        <tr><th>제목</th><th class="center" style="width:110px">작성일</th></tr>
      </thead>
      <tbody>
      <?php foreach ($rows as $r): ?>
        <tr>
          <td class="title">
            <?php if ((int)$r['pinned']): ?><span class="v v-AC">공지</span> <?php endif; ?>
            <a href="notice.php?id=<?= (int)$r['id'] ?>"><?= h($r['title']) ?></a>
          </td>
          <td class="center num small"><?= h(substr((string)$r['created_at'], 0, 10)) ?></td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
    <?= pager($page, $pages) ?>
  <?php endif; ?>

</div>
<?php page_foot(); ?>
