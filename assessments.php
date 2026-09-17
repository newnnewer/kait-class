<?php
/* assessments.php — 학생에게 보이는 평가 목록 */
declare(strict_types=1);
require_once __DIR__ . '/guard.php';
require_once __DIR__ . '/layout.php';
$u = need_login();

$sets = sets_for_student($u, 'assessment');

/* 내가 손댄 묶음 (제출이 하나라도 있으면 '참여 중', 전부 완료했으면 '완료') */
$myTouch = [];
foreach (all("SELECT set_id, COUNT(*) n FROM submissions
              WHERE user_id = ? AND set_id IS NOT NULL GROUP BY set_id", [$u['id']]) as $r) {
  $myTouch[(int)$r['set_id']] = (int)$r['n'];
}

/* 진행 중·시작 전은 위에, 종료된 것은 접어 둔다 */
$live = []; $done = [];
foreach ($sets as $s) { if (set_state($s) === 'after') $done[] = $s; else $live[] = $s; }

function set_item(array $s, array $myTouch, array $u): void {
  $touched = !empty($myTouch[(int)$s['id']]);
  $allDone = false;
  if ($touched) {
    $pg = set_my_progress((int)$u['id'], (int)$s['id'], $s['set_type'] === 'assessment');
    $allDone = $pg['total'] > 0 && $pg['done'] >= $pg['total'];
  }
?>
  <a class="setrow <?= set_state($s) === 'after' ? 'off' : '' ?>" href="set.php?id=<?= (int)$s['id'] ?>">
    <div class="sinfo">
      <div class="stitle"><?= h($s['title']) ?></div>
      <div class="smeta">
        <?php $per = period_text($s); if ($per !== ''): ?><?= h($per) ?> &middot; <?php endif; ?>
        문제 <?= (int)$s['problem_cnt'] ?>개
      </div>
    </div>
    <div class="sbadges">
      <?php if ($allDone): ?>
        <span class="v v-AC">완료</span>
      <?php elseif ($touched): ?>
        <span class="v v-wait">참여 중</span>
      <?php endif; ?>
      <?php $st = set_state($s); ?>
      <span class="v <?= $st === 'open' ? 'v-open' : ($st === 'after' ? 'v-WA' : 'v-wait') ?>">
        <?= h(SET_STATE_NAME[$st]) ?>
      </span>
    </div>
  </a>
<?php }

page_head(['title' => '평가', 'root' => '', 'user' => $u, 'nav' => 'assessments']);
?>
<div class="wrap narrow">
  <div class="phead">
    <h1>평가</h1>
    <span class="sub">참여할 평가를 고르세요.</span>
  </div>

  <?php if (!$sets): ?>
    <div class="empty">아직 열린 평가가 없습니다.</div>
  <?php else: ?>
    <?php if ($live): ?>
      <div class="setlist">
        <?php foreach ($live as $s) set_item($s, $myTouch, $u); ?>
      </div>
    <?php else: ?>
      <div class="empty">진행 중인 평가가 없습니다.</div>
    <?php endif; ?>

    <?php if ($done): ?>
      <details class="donebox"<?= $live ? '' : ' open' ?>>
        <summary>종료된 평가 <?= count($done) ?>개 보기</summary>
        <div class="setlist">
          <?php foreach ($done as $s) set_item($s, $myTouch, $u); ?>
        </div>
      </details>
    <?php endif; ?>
  <?php endif; ?>
</div>
<?php page_foot(); ?>
