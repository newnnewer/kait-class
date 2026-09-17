<?php
/* admin/judge.php — 운영 · 채점
   채점이 제대로 돌고 있는지 보고, 잘못 채점된 것을 다시 돌린다. */
declare(strict_types=1);
require_once __DIR__ . '/../guard.php';
require_once __DIR__ . '/../layout.php';
$u = need_admin('../');

$msg = ''; $err = '';

/* ── 재채점 ───────────────────────────────────
   기록은 그대로 두고 판정만 지운다. 소스 코드와 제출 시각, 입력 통계는
   성적의 근거이므로 손대지 않는다. 상태만 pending 으로 되돌리면 워커가 집어간다. */
function recheck_where(array $o): array {
  $w = []; $a = [];
  if (!empty($o['problem_id'])) { $w[] = "s.problem_id = ?"; $a[] = (int)$o['problem_id']; }
  if (!empty($o['submission_id'])) { $w[] = "s.id = ?"; $a[] = (int)$o['submission_id']; }
  if (!empty($o['set_id'])) { $w[] = "s.set_id = ?"; $a[] = (int)$o['set_id']; }
  if (($o['scope'] ?? '') === 'ie') $w[] = "(s.verdict = 'IE' OR s.state = 'error')";
  if (!empty($o['days'])) {
    $w[] = "s.created_at >= ?";
    $a[] = date('Y-m-d H:i:s', time() - 86400 * (int)$o['days']);
  }
  /* 아직 채점 중인 것은 건드리지 않는다 */
  $w[] = "s.state IN ('done','error')";
  return [$w ? implode(' AND ', $w) : '1=1', $a];
}

$form = [
  'problem_id' => (int)($_POST['problem_id'] ?? $_GET['problem_id'] ?? 0),
  'set_id'     => (int)($_POST['set_id'] ?? 0),
  'scope'      => (string)($_POST['scope'] ?? 'all'),
  'days'       => (int)($_POST['days'] ?? 0),
];
$preview = null;

$do = (string)($_POST['do'] ?? '');
if ($do === 'count' || $do === 'run') {
  if (!$form['problem_id'] && empty($_POST['submission_id'])) {
    $err = '문제를 고르세요.';
  } else {
    $o = $form + ['submission_id' => (int)($_POST['submission_id'] ?? 0)];
    [$where, $args] = recheck_where($o);
    $n = (int)col("SELECT COUNT(*) FROM submissions s WHERE $where", $args);

    if ($do === 'count') {
      $preview = $n;
      if ($n === 0) $err = '조건에 맞는 제출이 없습니다.';
    } else {
      if ($n === 0) { $err = '조건에 맞는 제출이 없습니다.'; }
      else {
        db()->prepare("UPDATE submissions SET state='pending', priority=1, queued_at=?,
                       verdict=NULL, passed_count=NULL, total_count=NULL,
                       max_time=NULL, max_memory=NULL, compile_msg=NULL,
                       fail_seq=NULL, tokens=NULL, judged_at=NULL,
                       fail_input=NULL, fail_expected=NULL, fail_output=NULL
                       WHERE id IN (SELECT s.id FROM submissions s WHERE $where)")
            ->execute(array_merge([now()], $args));
        $msg = $n . '건을 다시 채점합니다. 학생이 지금 내는 제출이 먼저 처리되고, 그다음 순서로 돌아갑니다.';
      }
    }
  }
}

/* ── 대기열 상태 ─────────────────────────────── */
$state = [];
foreach (all("SELECT state, COUNT(*) n FROM submissions GROUP BY state") as $r) {
  $state[$r['state']] = (int)$r['n'];
}
$pending  = ($state['pending'] ?? 0) + ($state['judging'] ?? 0);
$waitFrom = (string)col("SELECT COALESCE(queued_at, created_at) FROM submissions
                         WHERE state IN ('pending','judging') ORDER BY id LIMIT 1");

$hbFile = DATA_DIR . '/worker.heartbeat';
$hb     = is_file($hbFile) ? (int)filemtime($hbFile) : 0;
$hbAge  = $hb ? time() - $hb : null;
$alive  = $hbAge !== null && $hbAge < 60;

$recent = (int)col("SELECT COUNT(*) FROM submissions
                    WHERE judged_at >= ?", [date('Y-m-d H:i:s', time() - 3600)]);
$ieCnt  = (int)col("SELECT COUNT(*) FROM submissions WHERE verdict='IE' OR state='error'");

$problems = all("SELECT id, prob_no, title FROM problems ORDER BY prob_no");
$sets     = all("SELECT id, set_type, title FROM sets ORDER BY id DESC");

page_head(['title' => '채점', 'root' => '../', 'user' => $u, 'nav' => 'ops']);
?>
<div class="wrap">

  <div class="phead"><h1>운영</h1></div>
  <?= ops_tabs('judge') ?>

  <?php if ($msg): ?><div class="note ok"><?= h($msg) ?></div><?php endif; ?>
  <?php if ($err): ?><div class="note err"><?= h($err) ?></div><?php endif; ?>

  <!-- ── 대기열 ───────────────────────────── -->
  <div class="phead"><h2 class="subhead2">채점 상태</h2>
    <div class="grow"></div>
    <a class="btn sm" href="judge.php">새로고침</a>
  </div>

  <?php if (!$alive): ?>
    <div class="note err">
      채점 워커가 멈춘 것 같습니다<?= $hbAge !== null ? ' (마지막 신호 ' . (int)($hbAge / 60) . '분 전)' : '' ?>.
      서버에서 확인하세요: <code>systemctl status judge-worker</code>
    </div>
  <?php endif; ?>

  <div class="statgrid">
    <div class="stat">
      <div class="k">워커</div>
      <div class="v <?= $alive ? 'ok' : 'bad' ?>"><?= $alive ? '정상' : '멈춤' ?></div>
      <div class="s"><?= $hbAge !== null ? $hbAge . '초 전 신호' : '신호 없음' ?></div>
    </div>
    <div class="stat">
      <div class="k">대기 중</div>
      <div class="v <?= $pending > 50 ? 'warn' : '' ?>"><?= number_format($pending) ?></div>
      <div class="s">
        <?= $waitFrom ? '가장 오래 기다린 것 ' . max(0, (int)((time() - strtotime($waitFrom)) / 60)) . '분' : '없음' ?>
      </div>
    </div>
    <div class="stat">
      <div class="k">최근 1시간</div>
      <div class="v"><?= number_format($recent) ?></div>
      <div class="s">채점 완료</div>
    </div>
    <div class="stat">
      <div class="k">채점 오류</div>
      <div class="v <?= $ieCnt ? 'bad' : '' ?>"><?= number_format($ieCnt) ?></div>
      <div class="s">누적 IE</div>
    </div>
  </div>

  <!-- ── 재채점 ───────────────────────────── -->
  <div class="sec">
    <h2>재채점</h2>
    <p class="desc">
      테스트케이스를 고쳤거나 채점이 오류로 끝났을 때 씁니다.
      제출한 코드와 시각, 입력 통계는 그대로 두고 판정만 다시 계산합니다.
      학생이 지금 내는 제출이 먼저 처리되므로 수업 중에 돌려도 됩니다.
    </p>

    <form method="post">
      <div class="row">
        <div class="field" style="flex:2">
          <label for="problem_id">문제</label>
          <select id="problem_id" name="problem_id" required>
            <option value="">— 고르세요 —</option>
            <?php foreach ($problems as $p): ?>
              <option value="<?= (int)$p['id'] ?>" <?= $form['problem_id'] === (int)$p['id'] ? 'selected' : '' ?>>
                <?= (int)$p['prob_no'] ?> · <?= h($p['title']) ?>
              </option>
            <?php endforeach; ?>
          </select>
        </div>
        <div class="field">
          <label for="scope">대상</label>
          <select id="scope" name="scope">
            <option value="all" <?= $form['scope'] === 'all' ? 'selected' : '' ?>>모든 제출</option>
            <option value="ie"  <?= $form['scope'] === 'ie'  ? 'selected' : '' ?>>채점 오류(IE)만</option>
          </select>
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label for="set_id">수업·평가 <span class="hint">고르지 않으면 전체</span></label>
          <select id="set_id" name="set_id">
            <option value="0">— 전체 —</option>
            <?php foreach ($sets as $s): ?>
              <option value="<?= (int)$s['id'] ?>" <?= $form['set_id'] === (int)$s['id'] ? 'selected' : '' ?>>
                [<?= h(SET_TYPE_NAME[$s['set_type']]) ?>] <?= h($s['title']) ?>
              </option>
            <?php endforeach; ?>
          </select>
        </div>
        <div class="field">
          <label for="days">기간 <span class="hint">최근 며칠</span></label>
          <select id="days" name="days">
            <option value="0"  <?= $form['days'] === 0  ? 'selected' : '' ?>>전체 기간</option>
            <option value="1"  <?= $form['days'] === 1  ? 'selected' : '' ?>>최근 1일</option>
            <option value="7"  <?= $form['days'] === 7  ? 'selected' : '' ?>>최근 7일</option>
            <option value="30" <?= $form['days'] === 30 ? 'selected' : '' ?>>최근 30일</option>
          </select>
        </div>
      </div>

      <?php if ($preview !== null && $preview > 0): ?>
        <div class="note info">
          조건에 맞는 제출이 <b><?= number_format($preview) ?>건</b>입니다.
          되돌릴 수 없으니 숫자를 확인하고 진행하세요.
        </div>
        <div class="actions" style="margin-top:10px">
          <button class="btn primary" type="submit" name="do" value="run"
                  onclick="return confirm('<?= (int)$preview ?>건을 다시 채점합니다. 진행할까요?')">
            <?= number_format($preview) ?>건 재채점
          </button>
          <button class="btn" type="submit" name="do" value="count">다시 세기</button>
        </div>
      <?php else: ?>
        <div class="actions" style="margin-top:10px">
          <button class="btn" type="submit" name="do" value="count">대상 세어보기</button>
        </div>
      <?php endif; ?>
    </form>
  </div>

</div>
<?php page_foot(); ?>
