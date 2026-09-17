<?php
/* admin/notices.php — 공지 관리 */
declare(strict_types=1);
require_once __DIR__ . '/../guard.php';
require_once __DIR__ . '/../layout.php';
$u = need_admin('../');

$msg = ''; $err = '';
$do  = (string)($_POST['do'] ?? '');
$id  = (int)($_POST['id'] ?? 0);

if ($do && $id) {
  $n = one("SELECT * FROM notices WHERE id=?", [$id]);
  if (!$n) { $err = '없는 공지입니다.'; }
  elseif ($do === 'toggle') {
    db()->prepare("UPDATE notices SET active = 1 - active WHERE id=?")->execute([$id]);
    $msg = (int)$n['active'] ? '비공개로 바꿨습니다.' : '공개했습니다.';
  } elseif ($do === 'pin') {
    db()->prepare("UPDATE notices SET pinned = 1 - pinned WHERE id=?")->execute([$id]);
    $msg = (int)$n['pinned'] ? '상단 고정을 풀었습니다.' : '상단에 고정했습니다.';
  } elseif ($do === 'delete') {
    db()->prepare("DELETE FROM notices WHERE id=?")->execute([$id]);
    $msg = '삭제했습니다.';
  }
}

$all   = all("SELECT n.*, u.login_id FROM notices n
              LEFT JOIN users u ON u.id = n.author_id
              ORDER BY n.pinned DESC, n.id DESC");
$total = count($all);
$per   = 30;
$pages = max(1, (int)ceil($total / $per));
$page  = max(1, min($pages, (int)($_GET['p'] ?? 1)));
$rows  = array_slice($all, ($page - 1) * $per, $per);

page_head(['title' => '공지 관리', 'root' => '../', 'user' => $u, 'nav' => 'notices']);
?>
<div class="wrap">

  <div class="phead">
    <h1>공지사항</h1>
    <span class="sub"><?= number_format($total) ?>건</span>
    <div class="grow"></div>
    <a class="btn primary" href="notice.php">새 공지</a>
  </div>

  <?php if ($msg): ?><div class="note ok"><?= h($msg) ?></div><?php endif; ?>
  <?php if ($err): ?><div class="note err"><?= h($err) ?></div><?php endif; ?>

  <?php if (!$rows): ?>
    <div class="empty">아직 공지가 없습니다.</div>
  <?php else: ?>
    <div class="scrollx">
      <table class="list sets">
        <thead>
          <tr>
            <th style="min-width:220px">제목</th>
            <th class="center" style="width:78px">공개</th>
            <th class="center" style="width:78px">고정</th>
            <th class="center" style="width:110px">작성일</th>
            <th class="center" style="width:100px">작성자</th>
            <th style="width:250px"></th>
          </tr>
        </thead>
        <tbody>
        <?php foreach ($rows as $r): ?>
          <tr class="<?= (int)$r['active'] ? '' : 'dim' ?>">
            <td class="title"><a href="../notice.php?id=<?= (int)$r['id'] ?>"><?= h($r['title']) ?></a></td>
            <td class="center">
              <?php if ((int)$r['active']): ?><span class="v v-AC">공개</span>
              <?php else: ?><span class="v v-wait">비공개</span><?php endif; ?>
            </td>
            <td class="center"><?= (int)$r['pinned'] ? '<span class="v v-AC">고정</span>' : '' ?></td>
            <td class="center num small"><?= h(substr((string)$r['created_at'], 2, 8)) ?></td>
            <td class="center num small"><?= h($r['login_id'] ?? '') ?></td>
            <td class="rowbtns">
              <form method="post">
                <input type="hidden" name="id" value="<?= (int)$r['id'] ?>">
                <button class="btn sm" name="do" value="toggle" type="submit">
                  <?= (int)$r['active'] ? '비공개' : '공개' ?></button>
              </form>
              <form method="post">
                <input type="hidden" name="id" value="<?= (int)$r['id'] ?>">
                <button class="btn sm" name="do" value="pin" type="submit">
                  <?= (int)$r['pinned'] ? '고정 해제' : '고정' ?></button>
              </form>
              <a class="btn sm" href="notice.php?id=<?= (int)$r['id'] ?>">수정</a>
              <form method="post" onsubmit="return confirm('삭제할까요? 되돌릴 수 없습니다.')">
                <input type="hidden" name="id" value="<?= (int)$r['id'] ?>">
                <button class="btn sm danger" name="do" value="delete" type="submit">삭제</button>
              </form>
            </td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
    </div>
    <?= pager($page, $pages) ?>
  <?php endif; ?>

</div>
<?php page_foot(); ?>
