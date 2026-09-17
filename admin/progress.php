<?php
/* admin/progress.php — 수업·평가 진행 현황 */
declare(strict_types=1);
require_once __DIR__ . '/../guard.php';
require_once __DIR__ . '/../layout.php';
$u = need_admin('../');

$id = (int)($_GET['id'] ?? 0);
if (!$id) {
  /* 묶음을 고르는 화면 */
  $sets = all("SELECT id, set_type, title, start_at FROM sets
               ORDER BY COALESCE(start_at, created_at) DESC, id DESC");
  page_head(['title' => '제출 현황', 'root' => '../', 'user' => $u, 'nav' => 'lessons']);
  echo '<div class="wrap"><div class="phead"><h1>제출 현황</h1></div>';
  if (!$sets) {
    echo '<div class="empty">먼저 수업이나 평가를 만드세요.</div>';
  } else {
    echo '<table class="list"><tbody>';
    foreach ($sets as $s) {
      echo '<tr><td style="width:70px"><span class="v v-wait">' . h(SET_TYPE_NAME[$s['set_type']]) . '</span></td>'
         . '<td class="title"><a href="progress.php?id=' . (int)$s['id'] . '">' . h($s['title']) . '</a></td>'
         . '<td class="right num small">' . h(fmt_dt($s['start_at'])) . '</td></tr>';
    }
    echo '</tbody></table>';
  }
  echo '</div>';
  page_foot();
  exit;
}

$s = one("SELECT * FROM sets WHERE id=?", [$id]);
if (!$s) { header('Location: progress.php'); exit; }

$isAssess = $s['set_type'] === 'assessment';
$pg = set_progress($id);
$problems = $pg['problems'];
$students = $pg['students'];

/* 완료한 학생 수 (평가에서만 의미가 있다) */
$doneCnt = 0;
foreach ($students as $st) {
  $ok = count($problems) > 0;
  foreach ($problems as $p) {
    if ($st['ac'][(int)$p['problem_id']] < (int)$p['required_ac']) { $ok = false; break; }
  }
  if ($ok) $doneCnt++;
}

/* CSV 내려받기 */
if (($_GET['csv'] ?? '') === '1') {
  while (ob_get_level() > 0) ob_end_clean();
  header('Content-Type: text/csv; charset=utf-8');
  header('Content-Disposition: attachment; filename="progress-' . $id . '.csv"');
  echo "\xEF\xBB\xBF";   /* 엑셀에서 한글이 깨지지 않게 */
  $out = fopen('php://output', 'w');
  $head = ['반', '아이디', '이름'];
  foreach ($problems as $p) $head[] = $p['prob_no'] . ($isAssess ? ' (/' . (int)$p['required_ac'] . ')' : '');
  fputcsv($out, $head, ',', '"', '\\');
  foreach ($students as $st) {
    $row = [$st['group_name'] ?? '', $st['login_id'], $st['name']];
    foreach ($problems as $p) $row[] = $st['ac'][(int)$p['problem_id']];
    fputcsv($out, $row, ',', '"', '\\');
  }
  fclose($out);
  exit;
}

page_head(['title' => $s['title'] . ' 현황', 'root' => '../', 'user' => $u,
            'nav' => $isAssess ? 'assessments' : 'lessons']);
?>
<div class="wrap">

  <div class="phead">
    <h1><?= h($s['title']) ?></h1>
    <span class="sub">
      <?= h(SET_TYPE_NAME[$s['set_type']]) ?> · 학생 <?= count($students) ?>명 · 문제 <?= count($problems) ?>개
      <?php if ($isAssess && $problems): ?> · 모두 완료 <?= $doneCnt ?>명<?php endif; ?>
    </span>
    <div class="grow"></div>
    <a class="btn" href="submissions.php?set_id=<?= $id ?>">제출 기록</a>
    <a class="btn" href="?id=<?= $id ?>&csv=1">CSV 내려받기</a>
    <a class="btn" href="set.php?id=<?= $id ?>">설정</a>
  </div>

  <?php if (!$problems): ?>
    <div class="empty">담긴 문제가 없습니다.</div>
  <?php elseif (!$students): ?>
    <div class="empty">대상 학생이 없습니다.</div>
  <?php else: ?>
    <div class="scrollx">
      <table class="list grid">
        <thead>
          <tr>
            <th style="width:90px">반</th>
            <th style="width:110px">아이디</th>
            <th style="width:100px">이름</th>
            <?php foreach ($problems as $p): ?>
              <th class="center" title="<?= h($p['title']) ?>">
                <?= (int)$p['prob_no'] ?>
                <?php if ($isAssess): ?><div class="need">/<?= (int)$p['required_ac'] ?></div><?php endif; ?>
              </th>
            <?php endforeach; ?>
          </tr>
        </thead>
        <tbody>
        <?php foreach ($students as $st): ?>
          <tr>
            <td class="small muted"><?= h($st['group_name'] ?? '') ?></td>
            <td class="num"><?= h($st['login_id']) ?></td>
            <td class="small"><?= h($st['name']) ?></td>
            <?php foreach ($problems as $p):
              $pid  = (int)$p['problem_id'];
              $ac   = (int)$st['ac'][$pid];
              $try  = (int)$st['try'][$pid];
              $need = $isAssess ? (int)$p['required_ac'] : 1;
              $cls  = $ac >= $need ? 'c-done' : ($ac > 0 ? 'c-part' : ($try ? 'c-try' : ''));
            ?>
              <td class="center num <?= $cls ?>">
                <?php if ($try): ?>
                  <a href="submissions.php?set_id=<?= $id ?>&user_id=<?= (int)$st['id'] ?>&problem_id=<?= $pid ?>"
                     title="이 학생의 제출 기록">
                <?php endif; ?>
                <?php if ($ac >= $need): ?>✓<?php if ($isAssess && $ac > $need): ?><sup><?= $ac ?></sup><?php endif; ?>
                <?php elseif ($ac > 0): ?><?= $ac ?>
                <?php elseif ($try): ?>·
                <?php endif; ?>
                <?php if ($try): ?></a><?php endif; ?>
              </td>
            <?php endforeach; ?>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
    </div>
    <p class="small muted" style="margin-top:14px">
      ✓ 완료 · 숫자는 통과 횟수 · · 은 제출은 했으나 아직 통과 못 함 · 빈 칸은 제출 없음
    </p>
  <?php endif; ?>

</div>
<?php page_foot(); ?>
