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

/* ── 평가 입장 확인 (2.1.0) — 허용 IP · 입장 코드 ──
   통과하지 못하면 문제 목록 대신 안내(또는 코드 입력 칸)만 보여 준다. */
$codeErr = '';
if (($_POST['do'] ?? '') === 'enter') {
  if (set_code_try($s, (string)($_POST['entry_code'] ?? ''))) {
    header('Location: set.php?id=' . $sid); exit;
  }
  usleep(400000);                       /* 마구 넣어 보기를 늦춘다 */
  $codeErr = '입장 코드가 맞지 않습니다.';
}
$gate = set_gate($u, $s);
if ($gate) {
  page_head(['title' => $s['title'], 'root' => '', 'user' => $u, 'nav' => 'assessments']);
  ?>
  <div class="wrap">
    <div class="phead">
      <h1><?= h($s['title']) ?></h1>
      <div class="grow"></div>
      <a class="btn" href="assessments.php">목록</a>
    </div>
    <?php if ($gate['why'] === 'ip'): ?>
      <div class="note err">
        <?= h($gate['msg']) ?>
        <div class="small">지금 접속한 곳의 IP: <b><?= h(client_ip()) ?></b> — 응시 장소가 맞는데도 이 안내가 보이면 선생님께 이 숫자를 알려 주세요.</div>
      </div>
    <?php elseif ($gate['why'] === 'kick'): ?>
      <div class="note err">
        <?= h($gate['msg']) ?>
        <div class="small">이 평가는 한 계정을 한 곳에서만 쓸 수 있습니다. 계속하려면 여기서 다시 로그인하세요 — 그러면 다른 쪽 접속이 끊깁니다.</div>
      </div>
      <p><a class="btn primary" href="logout.php">다시 로그인</a></p>
    <?php else: ?>
      <?php if ($codeErr): ?><div class="note err"><?= h($codeErr) ?></div><?php endif; ?>
      <form method="post" class="gatebox">
        <input type="hidden" name="do" value="enter">
        <label for="entry_code">입장 코드</label>
        <p class="small muted">선생님이 알려 준 코드를 넣으면 평가가 열립니다.</p>
        <div class="gaterow">
          <input type="text" id="entry_code" name="entry_code" class="code" maxlength="40"
                 autocomplete="off" autocapitalize="off" spellcheck="false" required autofocus>
          <button class="btn primary" type="submit">들어가기</button>
        </div>
      </form>
    <?php endif; ?>
  </div>
  <?php
  page_foot(); exit;
}

/* ── 평가는 기간 밖에서 문제를 보여 주지 않는다 (2.1.0) ──
   시작 전에는 이름 · 기간 · '시작까지 남은 시간'만, 종료 뒤에는 끝났다는 안내와 내 완료 수만 보인다.
   시작 시각이 되면 남은 시간 스크립트가 화면을 새로 읽어 문제가 나타난다. 수업과 교사 계정은 해당 없음. */
if (set_hidden_for($u, $s)) {
  $hState = set_state($s);
  $hCnt   = (int)col("SELECT COUNT(*) FROM set_problems WHERE set_id=?", [$sid]);
  $hDone  = $hState === 'after' ? set_my_progress((int)$u['id'], $sid, true)['done'] : 0;
  page_head(['title' => $s['title'], 'root' => '', 'user' => $u, 'nav' => 'assessments']);
  ?>
  <div class="wrap">
    <div class="phead">
      <h1><?= h($s['title']) ?></h1>
      <span class="v v-wait"><?= h(SET_STATE_NAME[$hState]) ?></span>
      <div class="grow"></div>
      <a class="btn" href="assessments.php">목록</a>
    </div>
    <div class="limits">
      <?php $per = period_text($s); if ($per !== ''): ?><span>기간 <b><?= h($per) ?></b></span><?php endif; ?>
      <span>문제 <b><?= $hCnt ?>개</b></span>
      <?php if ($hState === 'after'): ?><span>완료 <b><?= $hDone ?> / <?= $hCnt ?></b></span><?php endif; ?>
      <?= set_clock_tag($s) ?>
    </div>
    <?php if ($hState === 'before'): ?>
      <div class="note info">아직 시작 전입니다. 시작 시각이 되면 이 화면에 문제가 나타납니다.</div>
    <?php else: ?>
      <div class="note info">종료된 평가입니다. 문제는 더 이상 볼 수 없습니다.</div>
    <?php endif; ?>
  </div>
  <?php
  page_foot(); exit;
}
set_enter_note($u, $s);     /* 엄격 모드 — 들어온 IP · 기기를 적는다 (2.1.0) */

$state = set_state($s);
$open  = set_open_for($u, $s);

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
    <?php if (teacher_view($u)): /* 교사 화면에만 (1.17.0) */ ?>
      <a class="btn" href="admin/progress.php?id=<?= (int)$s['id'] ?>">현황</a>
      <a class="btn" href="admin/set.php?id=<?= (int)$s['id'] ?>">수정</a>
    <?php endif; ?>
    <a class="btn" href="<?= $isAssess ? 'assessments.php' : 'lessons.php' ?>">목록</a>
  </div>

  <div class="limits">
    <?php $per = period_text($s); if ($per !== ''): ?>
      <span>기간 <b><?= h($per) ?></b></span>
    <?php endif; ?>
    <span>문제 <b><?= count($items) ?>개</b></span>
    <span>완료 <b><?= $doneCnt ?> / <?= count($items) ?></b></span>
    <?= set_clock_tag($s) /* 평가의 남은 시간 (2.1.0) */ ?>
  </div>

  <?php if ($isAssess): ?>
    <div class="note info">
      코드를 직접 입력하여 문제마다 정해진 횟수만큼 통과(AC)해야 평가가 완료됩니다.
      <?php if (set_strict($s)): ?>
        <div class="small"><b>이 평가는 접속 기록과 화면 이탈 기록이 남습니다.</b>
          문제를 푸는 동안 다른 창이나 탭으로 가면 떠나 있던 시간이 기록되고, 한 계정은 한 곳에서만 쓸 수 있습니다.</div>
      <?php endif; ?>
    </div>
  <?php endif; ?>

  <?= admin_preview_note($u, $s) ?>
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
