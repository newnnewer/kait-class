<?php
/* set.php — 수업 또는 평가 하나를 열어 문제 목록과 내 진행률을 본다 */
declare(strict_types=1);
require_once __DIR__ . '/guard.php';
require_once __DIR__ . '/layout.php';
$u = need_login();

$sid = (int)($_GET['id'] ?? 0);
$s = student_set_or_null($u, $sid);
if (!$s) { header('Location: problems.php'); exit; }

$isAssess = $s['set_type'] === 'assessment';
$state = set_state($s);
$open  = set_open($s);

$items = all("SELECT sp.problem_id, sp.required_ac, p.prob_no, p.title,
                     (SELECT COUNT(*) FROM testcases t WHERE t.problem_id=p.id) AS tc_cnt
              FROM set_problems sp JOIN problems p ON p.id=sp.problem_id
              WHERE sp.set_id=? ORDER BY sp.sort, sp.id", [$sid]);

/* 내 통과 횟수 — 이 묶음 안에서 낸 것만 센다.
   세는 규칙은 ac_count_in_set() 과 같아야 한다. 예전에 여기만 다른 식을 써서
   문제 화면과 목록의 숫자가 어긋난 적이 있다. */
$prog = set_my_progress((int)$u['id'], $sid, $isAssess);
$myAc = $prog['ac'];
$myTry = [];
foreach (all("SELECT problem_id, COUNT(*) n FROM submissions
              WHERE user_id=? AND set_id=? GROUP BY problem_id", [$u['id'], $sid]) as $r) {
  $myTry[(int)$r['problem_id']] = (int)$r['n'];
}

$doneCnt = $prog['done'];

page_head(['title' => $s['title'], 'root' => '', 'user' => $u,
            'nav' => $isAssess ? 'assessments' : 'lessons']);
?>
<div class="wrap">

  <div class="phead">
    <h1><?= h($s['title']) ?></h1>
    <span class="v <?= $state === 'open' ? 'v-open' : 'v-wait' ?>"><?= h(SET_STATE_NAME[$state]) ?></span>
    <div class="grow"></div>
    <a class="btn" href="<?= $isAssess ? 'assessments.php' : 'lessons.php' ?>">목록</a>
  </div>

  <div class="limits">
    <?php $per = period_text($s); if ($per !== ''): ?>
      <span>기간 <b><?= h($per) ?></b></span>
    <?php endif; ?>
    <span>문제 <b><?= count($items) ?>개</b></span>
    <span>완료 <b><?= $doneCnt ?> / <?= count($items) ?></b></span>
  </div>

  <?php if ($isAssess): ?>
    <div class="note info">
      코드를 직접 입력하여 문제마다 정해진 횟수만큼 통과(AC)해야 평가가 완료됩니다.
    </div>
  <?php endif; ?>

  <?php if (!$open): ?>
    <div class="note err">
      <?= $state === 'before' ? '아직 시작 전입니다.' : '종료되었습니다.' ?>
      문제는 볼 수 있지만 제출은 할 수 없습니다.
    </div>
  <?php endif; ?>

  <?php if (!$items): ?>
    <div class="empty">담긴 문제가 없습니다.</div>
  <?php else: ?>
    <table class="list">
      <thead>
        <tr>
          <th style="width:64px">상태</th>
          <th style="width:76px">번호</th>
          <th>제목</th>
          <?php if ($isAssess): ?><th style="width:160px">진행</th><?php endif; ?>
        </tr>
      </thead>
      <tbody>
      <?php foreach ($items as $it):
        $pid  = (int)$it['problem_id'];
        $need = set_need($isAssess, (int)$it['required_ac']);
        $ac   = $myAc[$pid] ?? 0;
        $done = $ac >= $need;
      ?>
        <tr>
          <td>
            <?php if ($done): ?><span class="v v-AC">✓</span>
            <?php elseif (($myTry[$pid] ?? 0) > 0): ?><span class="v v-WA">…</span>
            <?php endif; ?>
          </td>
          <td class="num"><?= (int)$it['prob_no'] ?></td>
          <td class="title">
            <a href="problem.php?no=<?= (int)$it['prob_no'] ?>&set=<?= $sid ?>"><?= h($it['title']) ?></a>
            <?php if ((int)$it['tc_cnt'] === 0): ?><span class="small muted">(준비 중)</span><?php endif; ?>
          </td>
          <?php if ($isAssess): ?>
            <td>
              <div class="prog">
                <div class="bar"><span style="width:<?= (int)min(100, $need ? $ac / $need * 100 : 0) ?>%"></span></div>
                <span class="num small"><?= $ac ?> / <?= $need ?>회</span>
              </div>
            </td>
          <?php endif; ?>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
  <?php endif; ?>

</div>
<?php page_foot(); ?>
