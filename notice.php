<?php
/* notice.php — 공지 하나 읽기 */
declare(strict_types=1);
require __DIR__ . '/guard.php';
require __DIR__ . '/layout.php';
$u = me();

$id = (int)($_GET['id'] ?? 0);
$n  = one("SELECT * FROM notices WHERE id = ?", [$id]);
$isAdmin = $u && $u['role'] === 'admin';
if (!$n || (!(int)$n['active'] && !$isAdmin)) { header('Location: notices.php'); exit; }

/* 앞뒤 글 — 목록 순서와 같게 (고정 먼저, 그다음 최신순) */
$list = notices_public();
$idx = null;
foreach ($list as $i => $r) if ((int)$r['id'] === $id) { $idx = $i; break; }
$prev = ($idx !== null && $idx > 0) ? $list[$idx - 1] : null;
$next = ($idx !== null && $idx < count($list) - 1) ? $list[$idx + 1] : null;

page_head(['title' => $n['title'], 'root' => '', 'user' => $u, 'nav' => 'notices']);
?>
<div class="wrap narrow">

  <article class="notice">
    <header>
      <h1>
        <?php if ((int)$n['pinned']): ?><span class="v v-AC">공지</span> <?php endif; ?>
        <?= h($n['title']) ?>
      </h1>
      <div class="nmeta">
        <?= h(substr((string)$n['created_at'], 0, 16)) ?>
        <?php if ($n['updated_at'] !== $n['created_at']): ?>
          <span class="sep">·</span>수정 <?= h(substr((string)$n['updated_at'], 0, 16)) ?>
        <?php endif; ?>
        <?php if (!(int)$n['active']): ?>
          <span class="sep">·</span><span class="v v-wait">비공개</span>
        <?php endif; ?>
      </div>
    </header>
    <div class="md nbody"><?= md($n['body']) ?></div>
  </article>

  <nav class="nnav">
    <?php if ($prev): ?>
      <a href="notice.php?id=<?= (int)$prev['id'] ?>">← <?= h($prev['title']) ?></a>
    <?php else: ?><span></span><?php endif; ?>
    <?php if ($next): ?>
      <a href="notice.php?id=<?= (int)$next['id'] ?>"><?= h($next['title']) ?> →</a>
    <?php else: ?><span></span><?php endif; ?>
  </nav>

  <div class="actions">
    <a class="btn" href="notices.php">목록</a>
    <div class="grow"></div>
    <?php if ($isAdmin): ?>
      <a class="btn" href="admin/notice.php?id=<?= $id ?>">수정</a>
    <?php endif; ?>
  </div>

</div>
<?php page_foot(); ?>
