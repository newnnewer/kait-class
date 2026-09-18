<?php
/* admin/sets.php — 수업·평가 묶음 목록 (잠그기 · 수정 · 복사 · 삭제) */
declare(strict_types=1);
require_once __DIR__ . '/../guard.php';
require_once __DIR__ . '/../layout.php';
$u = need_admin('../');

$type     = ($_GET['type'] ?? '') === 'assessment' ? 'assessment' : 'lesson';
$showDone = !empty($_GET['done']);
$msg = ''; $err = '';

/* ── 목록에서 바로 하는 동작 ─────────────────── */
$do  = (string)($_POST['do'] ?? '');
$sid = (int)($_POST['id'] ?? 0);

if ($do && $sid) {
  $target = one("SELECT * FROM sets WHERE id=?", [$sid]);
  if (!$target) {
    $err = '없는 항목입니다.';
  } elseif ($do === 'toggle') {
    db()->prepare("UPDATE sets SET active = 1 - active WHERE id=?")->execute([$sid]);
    $msg = (int)$target['active'] === 1
         ? '잠갔습니다. 학생에게 보이지 않습니다.'
         : '열었습니다. 학생에게 보입니다.';
  } elseif ($do === 'copy') {
    $newId = tx(function (PDO $d) use ($target, $sid) {
      /* 복사본은 잠긴 채로 만든다. 기간과 문제를 손본 뒤 직접 열게 한다. */
      $d->prepare("INSERT INTO sets(set_type,title,start_at,end_at,active,langs,show_diff,visibility,no_paste,created_at)
                   VALUES(?,?,?,?,0,?,?,?,?,?)")
        ->execute([$target['set_type'], $target['title'] . ' (복사)',
                   $target['start_at'], $target['end_at'], $target['langs'] ?? 'py,c',
                   (int)($target['show_diff'] ?? 1), $target['visibility'] ?? 'groups',
                   (int)($target['no_paste'] ?? 0), now()]);
      $nid = (int)$d->lastInsertId();
      $d->prepare("INSERT INTO set_targets(set_id,group_id)
                   SELECT ?, group_id FROM set_targets WHERE set_id=?")->execute([$nid, $sid]);
      $d->prepare("INSERT INTO set_problems(set_id,problem_id,required_ac,sort)
                   SELECT ?, problem_id, required_ac, sort FROM set_problems WHERE set_id=?")
        ->execute([$nid, $sid]);
      return $nid;
    });
    header('Location: set.php?id=' . (int)$newId); exit;
  } elseif ($do === 'delete') {
    $used = (int)col("SELECT COUNT(*) FROM submissions WHERE set_id=?", [$sid]);
    if ($used) {
      $err = '제출 기록이 ' . $used . '건 있어 삭제할 수 없습니다. 잠가서 감추세요.';
    } else {
      tx(function (PDO $d) use ($sid) {
        $d->prepare("DELETE FROM set_problems WHERE set_id=?")->execute([$sid]);
        $d->prepare("DELETE FROM set_targets  WHERE set_id=?")->execute([$sid]);
        $d->prepare("DELETE FROM sets WHERE id=?")->execute([$sid]);
      });
      $msg = '삭제했습니다.';
    }
  }
}

/* ── 목록 ────────────────────────────────────── */
$rows = all("SELECT s.*,
               (SELECT COUNT(*) FROM set_problems sp WHERE sp.set_id = s.id) AS problem_cnt,
               (SELECT COUNT(*) FROM submissions sb WHERE sb.set_id = s.id) AS sub_cnt,
               (SELECT GROUP_CONCAT(g.name, ', ') FROM set_targets t
                 JOIN groups g ON g.id = t.group_id WHERE t.set_id = s.id) AS targets,
               (SELECT COUNT(*) FROM users us
                 WHERE us.role='student' AND us.approved = 1 AND (
                   s.visibility = 'all'
                   OR us.group_id IN (SELECT group_id FROM set_targets t3 WHERE t3.set_id = s.id)
               )) AS student_cnt
             FROM sets s WHERE s.set_type = ? " . SET_ORDER_SQL, [$type]);

$live = []; $done = [];
foreach ($rows as $r) { if (set_state($r) === 'after') $done[] = $r; else $live[] = $r; }
$shown = $showDone ? array_merge($live, $done) : $live;

/* 한 줄을 그리는 부분 */
function set_row(array $r, string $type): void {
  $st = set_state($r);
  $locked = set_locked($r); ?>
  <tr class="<?= $locked ? 'dim' : '' ?>">
    <td class="title">
      <a href="progress.php?id=<?= (int)$r['id'] ?>"><?= h($r['title']) ?></a>
      <?php if ($locked): ?><span class="lockmark" title="잠김">🔒</span><?php endif; ?>
    </td>
    <td class="num small nowrap center"><?= h(period_text($r)) ?></td>
    <td class="small center"><?php
      if (($r['visibility'] ?? 'groups') === 'all') {
        echo '모든 회원';
      } elseif ($r['targets']) {
        echo h($r['targets']);
      } else {
        /* 반을 하나도 고르지 않았다 — 아무에게도 보이지 않는다.
           편집 화면에서 막고 있지만, 반을 지우면 이 상태가 될 수 있다. */
        echo '<span class="bad-text" title="공개할 반이 없어 학생에게 보이지 않습니다">대상 없음</span>';
      }
    ?></td>
    <td class="center">
      <?php if ($locked): ?><span class="v v-wait">잠김</span>
      <?php else: ?>
        <span class="v <?= $st === 'open' ? 'v-AC' : 'v-wait' ?>"><?= h(SET_STATE_NAME[$st]) ?></span>
      <?php endif; ?>
    </td>
    <td class="center num"><?= (int)$r['problem_cnt'] ?></td>
    <td class="center num"><?= (int)$r['student_cnt'] ?></td>
    <td class="rowbtns">
      <form method="post">
        <input type="hidden" name="id" value="<?= (int)$r['id'] ?>">
        <button class="btn sm <?= $locked ? 'primary' : '' ?>" name="do" value="toggle" type="submit">
          <?= $locked ? '열기' : '잠그기' ?>
        </button>
      </form>
      <a class="btn sm" href="set.php?id=<?= (int)$r['id'] ?>">수정</a>
      <a class="btn sm" href="submissions.php?set_id=<?= (int)$r['id'] ?>">기록</a>
      <form method="post" onsubmit="return confirm('복사할까요? 복사본은 잠긴 상태로 만들어집니다.')">
        <input type="hidden" name="id" value="<?= (int)$r['id'] ?>">
        <button class="btn sm" name="do" value="copy" type="submit">복사</button>
      </form>
      <form method="post" onsubmit="return confirm('삭제할까요? 되돌릴 수 없습니다.')">
        <input type="hidden" name="id" value="<?= (int)$r['id'] ?>">
        <button class="btn sm danger" name="do" value="delete" type="submit">삭제</button>
      </form>
    </td>
  </tr>
<?php }

page_head(['title' => SET_TYPE_NAME[$type], 'root' => '../', 'user' => $u,
            'nav' => $type === 'assessment' ? 'assessments' : 'lessons']);
?>
<div class="wrap">

  <div class="phead">
    <h1><?= h(SET_TYPE_NAME[$type]) ?></h1>
    <div class="grow"></div>
    <a class="btn primary" href="set.php?type=<?= h($type) ?>">새 <?= h(SET_TYPE_NAME[$type]) ?></a>
  </div>

  <?php if ($msg): ?><div class="note ok"><?= h($msg) ?></div><?php endif; ?>
  <?php if ($err): ?><div class="note err"><?= h($err) ?></div><?php endif; ?>

  <?php if (!$shown && !$done): ?>
    <div class="empty">아직 만든 <?= h(SET_TYPE_NAME[$type]) ?>이 없습니다.</div>
  <?php else: ?>
    <?php if ($shown): ?>
      <div class="scrollx">
        <table class="list sets">
          <thead>
            <tr>
              <th style="min-width:200px">제목</th>
              <th class="center" style="width:168px">기간</th>
              <th class="center" style="width:104px">공개 대상</th>
              <th class="center" style="width:74px">상태</th>
              <th class="center" style="width:52px">문제</th>
              <th class="center" style="width:52px">학생</th>
              <th style="width:232px"></th>
            </tr>
          </thead>
          <tbody>
            <?php foreach ($shown as $r) set_row($r, $type); ?>
          </tbody>
        </table>
      </div>
    <?php else: ?>
      <div class="empty">진행 중인 <?= h(SET_TYPE_NAME[$type]) ?>이 없습니다.</div>
    <?php endif; ?>

    <?php if ($done): ?>
      <p style="margin-top:16px">
        <a class="btn sm" href="?type=<?= h($type) ?><?= $showDone ? '' : '&done=1' ?>">
          <?= $showDone ? '종료된 항목 감추기' : '종료된 항목 ' . count($done) . '개 함께 보기' ?>
        </a>
      </p>
    <?php endif; ?>
  <?php endif; ?>

</div>
<?php page_foot(); ?>
