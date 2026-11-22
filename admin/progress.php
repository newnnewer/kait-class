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

/* ── 살펴볼 점 (2.1.0) — 엄격 모드 평가의 접속 · 화면 이탈 기록 ──
   기록이 있을 때(또는 엄격 모드가 켜져 있을 때)만 보인다. */
$watch = $isAssess ? set_watch($id) : [];
$showWatch = $isAssess && ($watch || (int)($s['strict'] ?? 0) === 1);
/* 이름을 찾을 표 — 대상 반 학생 + 기록에만 있는 사람(반이 바뀐 학생 등) */
$who = [];
foreach ($students as $st) $who[(int)$st['id']] = $st;
$miss = array_diff(array_keys($watch), array_keys($who));
if ($miss) {
  foreach (all("SELECT u.id, u.login_id, u.name, g.name AS group_name FROM users u
                LEFT JOIN groups g ON g.id = u.group_id
                WHERE u.id IN (" . implode(',', array_map('intval', $miss)) . ")") as $r) $who[(int)$r['id']] = $r;
}

/* 한 학생의 기록을 시간순으로 (살펴볼 점에서 이름을 누르면) */
$evUid = (int)($_GET['ev'] ?? 0);
if ($evUid && $isAssess) {
  $ev = all("SELECT kind, at, ms, ip, device FROM set_events WHERE set_id=? AND user_id=? ORDER BY id", [$id, $evUid]);
  $me2 = $who[$evUid] ?? one("SELECT id, login_id, name FROM users WHERE id=?", [$evUid]);
  $sharedDevs = [];   /* 이 학생의 기기 가운데 다른 계정도 쓴 것 → 그 계정들 */
  foreach (all("SELECT DISTINCT e.device, e.user_id FROM set_events e
                WHERE e.set_id=? AND e.user_id<>? AND e.device<>''
                  AND e.device IN (SELECT device FROM set_events WHERE set_id=? AND user_id=?)", [$id, $evUid, $id, $evUid]) as $r) {
    $sharedDevs[$r['device']][] = (int)$r['user_id'];
  }
  page_head(['title' => $s['title'] . ' 기록', 'root' => '../', 'user' => $u, 'nav' => 'assessments']);
  ?>
  <div class="wrap">
    <div class="phead">
      <h1><?= h(($me2['name'] ?? '') . ' (' . ($me2['login_id'] ?? '?') . ')') ?></h1>
      <span class="sub"><?= h($s['title']) ?> · 접속 · 화면 이탈 기록 <?= count($ev) ?>건</span>
      <div class="grow"></div>
      <a class="btn" href="submissions.php?set_id=<?= $id ?>&user_id=<?= $evUid ?>">제출 기록</a>
      <a class="btn" href="progress.php?id=<?= $id ?>#watch">현황</a>
    </div>
    <?php if (!$ev): ?>
      <div class="empty">기록이 없습니다.</div>
    <?php else: ?>
      <table class="list">
        <thead><tr><th style="width:300px">시각</th><th style="width:130px">내용</th><th>자세히</th>
                   <th style="width:150px">IP</th><th style="width:110px">기기</th></tr></thead>
        <tbody>
        <?php foreach ($ev as $e): $sh = $sharedDevs[$e['device']] ?? []; ?>
          <tr>
            <td class="num small"><?= h(substr((string)$e['at'], 0, 19)) ?>
              <span class="muted"><?= h(enter_text($s, (string)$e['at'])) ?></span></td>
            <td>
              <?php if ($e['kind'] === 'enter'): ?><span class="v v-wait">입장</span>
              <?php elseif ($e['kind'] === 'away'): ?><span class="v v-open">화면 이탈</span>
              <?php else: ?><span class="v v-WA">접속 끊김</span><?php endif; ?>
            </td>
            <td class="small">
              <?php if ($e['kind'] === 'away'): ?>떠나 있던 시간 <b><?= h(ms_text((int)$e['ms'])) ?></b>
              <?php elseif ($e['kind'] === 'kick'): ?>다른 곳에서 이 계정으로 로그인해서, 이 접속(이 IP · 기기)이 끊겼습니다
              <?php else: ?>평가에 들어옴<?php endif; ?>
              <?php if ($sh): ?>
                <span class="v v-WA">같은 기기</span>
                <?php foreach ($sh as $o): ?>
                  <a href="?id=<?= $id ?>&ev=<?= $o ?>"><?= h(($who[$o]['name'] ?? '') . '(' . ($who[$o]['login_id'] ?? $o) . ')') ?></a>
                <?php endforeach; ?>
              <?php endif; ?>
            </td>
            <td class="num small"><?= h($e['ip']) ?></td>
            <td class="num small" title="<?= h($e['device']) ?>"><?= h(substr((string)$e['device'], 0, 6)) ?></td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
      <p class="small muted" style="margin-top:14px">
        기기는 브라우저에 심어 둔 무작위 값의 앞 6자리입니다. 같은 값이면 같은 브라우저를 쓴 것입니다.
        화면 이탈은 문제 화면이 가려지거나 다른 창을 누른 시간이며, 어디로 갔는지는 알 수 없습니다.
      </p>
    <?php endif; ?>
  </div>
  <?php
  page_foot(); exit;
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
  if ($showWatch) array_push($head, '첫 입장', '첫 입장 시각', '화면 이탈(번)', '화면 이탈(초)', '가장 긴 이탈(초)', '접속 끊김(번)', 'IP 수', '기기 수', '같은 기기를 쓴 계정');
  fputcsv($out, $head, ',', '"', '\\');
  foreach ($students as $st) {
    $row = [$st['group_name'] ?? '', $st['login_id'], $st['name']];
    foreach ($problems as $p) $row[] = $st['ac'][(int)$p['problem_id']];
    if ($showWatch) {
      $x = $watch[(int)$st['id']] ?? null;
      array_push($row, enter_text($s, (string)($x['first_at'] ?? '')), (string)($x['first_at'] ?? ''), $x['away_n'] ?? 0, (int)round(($x['away_ms'] ?? 0) / 1000), (int)round(($x['away_max'] ?? 0) / 1000),
                 $x['kick'] ?? 0, count($x['ips'] ?? []), count($x['devs'] ?? []),
                 implode(' ', array_map(fn($o) => (string)($who[$o]['login_id'] ?? $o), $x['shared'] ?? [])));
    }
    fputcsv($out, $row, ',', '"', '\\');
  }
  fclose($out);
  exit;
}

page_head(['title' => $s['title'] . ' 현황', 'root' => '../', 'user' => $u,
            'nav' => $isAssess ? 'assessments' : 'lessons']);
?>
<div class="wrap" id="pgWrap">

  <div class="phead">
    <h1><?= h($s['title']) ?></h1>
    <span class="sub">
      <?= h(SET_TYPE_NAME[$s['set_type']]) ?> · 학생 <?= count($students) ?>명 · 문제 <?= count($problems) ?>개
      <?php if ($isAssess && $problems): ?> · 모두 완료 <?= $doneCnt ?>명<?php endif; ?>
    </span>
    <span class="sub" id="pgTime"></span>
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
              <th class="center" title="<?= h($p['title']) ?> — 누르면 새 탭에서 문제를 엽니다">
                <a class="plink" href="../problem.php?no=<?= (int)$p['prob_no'] ?>&set=<?= $id ?>" target="_blank" rel="noopener"><?= (int)$p['prob_no'] ?></a>
                <?php if ($isAssess): ?><div class="need">/<?= (int)$p['required_ac'] ?></div><?php endif; ?>
              </th>
            <?php endforeach; ?>
          </tr>
        </thead>
        <tbody>
        <?php foreach ($students as $st): ?>
          <tr>
            <td class="small muted"><?= h($st['group_name'] ?? '') ?></td>
            <td class="num"><a href="submissions.php?set_id=<?= $id ?>&user_id=<?= (int)$st['id'] ?>" title="이 학생의 제출 기록"><?= h($st['login_id']) ?></a></td>
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

  <?php if ($showWatch): ?>
    <!-- ── 살펴볼 점 (2.1.0) — 엄격 모드의 접속 · 화면 이탈 기록. 위 표와 함께 10초마다 새로 읽는다 ── -->
    <div class="sec" id="watch">
      <h2>살펴볼 점</h2>
      <p class="desc">
        엄격 모드에서 쌓인 기록입니다. 부정행위의 증거가 아니라 <b>확인해 볼 정황</b>입니다 — 이름을 누르면 시간순 기록이 나옵니다.
        <?php if ((int)($s['strict'] ?? 0) !== 1): ?> (지금은 엄격 모드가 꺼져 있어 새 기록은 쌓이지 않습니다.)<?php endif; ?>
      </p>
      <?php if (!$watch): ?>
        <div class="empty">아직 기록이 없습니다. 학생이 이 평가에 들어오면 나타납니다.</div>
      <?php else:
        /* 살펴볼 것이 많은 학생이 위로: 같은 기기 → 끊김 → 이탈 시간 */
        $ids = array_keys($watch);
        usort($ids, fn($a, $b) =>
          [count($watch[$b]['shared']) > 0, $watch[$b]['kick'], $watch[$b]['away_ms']]
          <=> [count($watch[$a]['shared']) > 0, $watch[$a]['kick'], $watch[$a]['away_ms']]);
      ?>
        <div class="scrollx">
        <table class="list">
          <thead>
            <tr>
              <th style="width:90px">반</th>
              <th style="width:110px">아이디</th>
              <th style="width:100px">이름</th>
              <th style="width:190px" title="이 평가에 처음 들어온 때. 다른 학생보다 눈에 띄게 늦으면 살펴보세요">입장</th>
              <th style="width:210px" title="문제 화면을 떠났다 돌아온 횟수 · 떠나 있던 시간의 합 (가장 긴 한 번)">화면 이탈</th>
              <th title="같은 브라우저에서 이 평가에 들어온 다른 계정">같은 기기를 쓴 계정</th>
              <th class="center" style="width:90px" title="다른 곳에서 로그인해 먼저 접속이 끊긴 횟수">접속 끊김</th>
              <th class="center" style="width:110px" title="이 평가에 들어온 IP 수 · 기기(브라우저) 수">IP · 기기</th>
            </tr>
          </thead>
          <tbody>
          <?php foreach ($ids as $uid): $x = $watch[$uid]; $p = $who[$uid] ?? []; ?>
            <tr>
              <td class="small muted"><?= h($p['group_name'] ?? '') ?></td>
              <td class="num"><a href="?id=<?= $id ?>&ev=<?= $uid ?>" title="시간순 기록"><?= h($p['login_id'] ?? (string)$uid) ?></a></td>
              <td class="small"><a href="?id=<?= $id ?>&ev=<?= $uid ?>" title="시간순 기록"><?= h($p['name'] ?? '') ?></a></td>
              <td class="small" title="<?= h($x['first_at']) ?>">
                <?php if ($x['first_at'] !== ''): ?>
                  <b><?= h(enter_text($s, $x['first_at'])) ?></b>
                  <?php if ($x['enter_n'] > 1): ?>
                    <div class="muted" title="<?= h($x['last_at']) ?>">다시 들어옴 <?= $x['enter_n'] - 1 ?>번 · 마지막 <?= h(enter_text($s, $x['last_at'])) ?></div>
                  <?php endif; ?>
                <?php endif; ?>
              </td>
              <td class="small">
                <?php if ($x['away_n']): ?>
                  <b><?= $x['away_n'] ?>번</b> · <?= h(ms_text($x['away_ms'])) ?>
                  <span class="muted">(가장 긴 <?= h(ms_text($x['away_max'])) ?>)</span>
                <?php else: ?><span class="muted">없음</span><?php endif; ?>
              </td>
              <td class="small">
                <?php if ($x['shared']): ?>
                  <span class="v v-WA">같은 기기</span>
                  <?php foreach ($x['shared'] as $o): ?>
                    <a href="?id=<?= $id ?>&ev=<?= $o ?>"><?= h(($who[$o]['name'] ?? '') . '(' . ($who[$o]['login_id'] ?? $o) . ')') ?></a>
                  <?php endforeach; ?>
                <?php endif; ?>
              </td>
              <td class="center num"><?php if ($x['kick']): ?><span class="v v-WA"><?= $x['kick'] ?>번</span><?php endif; ?></td>
              <td class="center num small">
                <?php $ni = count($x['ips']); $nd = count($x['devs']); ?>
                <span class="<?= $ni > 1 ? 'v v-WA' : '' ?>" title="<?= h(implode(', ', $x['ips'])) ?>"><?= $ni ?></span>
                · <span class="<?= $nd > 1 ? 'v v-WA' : '' ?>"><?= $nd ?></span>
              </td>
            </tr>
          <?php endforeach; ?>
          </tbody>
        </table>
        </div>
        <p class="small muted" style="margin-top:14px">
          <b>입장</b> 이 평가에 처음 들어온 때(다시 들어옴 = 새로 로그인했거나 다른 기기 · IP 로 들어온 횟수). 다른 학생보다 눈에 띄게 늦게 들어온 계정은 살펴보세요 —
          다른 브라우저나 시크릿 창으로 남의 계정에 들어오면 &lsquo;같은 기기&rsquo;로는 잡히지 않지만 입장 시각은 남습니다.
          <b>화면 이탈</b> 문제 화면이 가려지거나 다른 창을 누른 시간(1초 미만은 적지 않음). 어디로 갔는지는 알 수 없고, 알림 창이나 실수로 누른 것도 들어갑니다.
          <b>같은 기기</b> 같은 브라우저로 두 계정이 이 평가에 들어온 경우 — 시크릿 창이나 다른 브라우저를 쓰면 잡히지 않습니다.
          <b>접속 끊김</b> 같은 계정으로 다른 곳에서 로그인한 횟수. <b>IP · 기기</b> 2 이상이면 여러 곳에서 들어온 것입니다.
        </p>
      <?php endif; ?>
    </div>
  <?php endif; ?>

</div>

<script>
/* 10초마다 풀이 현황을 새로 읽어 온다 — 수업 중 띄워 두고 F5 없이 보려는 것.
   페이지 전체가 아니라 본문만 바꿔 끼워 깜빡임·스크롤 튐이 없다.
   다른 탭을 보는 동안에는 쉬었다가, 돌아오면 바로 한 번 읽는다.
   제목 옆에는 마지막으로 읽어 온 시각을 '16:03:20 풀이 현황' 처럼 적는다. */
(function () {
  var EVERY = 10000, timer = null, busy = false, stopped = false;

  function two(n) { return (n < 10 ? '0' : '') + n; }
  function stamp() {
    var t = document.getElementById('pgTime'), d = new Date();
    if (t) t.textContent = two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()) + ' 풀이 현황';
  }
  function stop(msg) {
    stopped = true; clearTimeout(timer);
    var t = document.getElementById('pgTime');
    if (t) { t.textContent = msg; t.style.color = 'var(--bad)'; }
  }

  function refresh() {
    if (busy || stopped || document.hidden) return;
    busy = true;
    fetch(location.href, { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) {
        /* 로그인이 풀리면 로그인 화면으로 돌려보내진다 — 그 화면을 표 자리에 끼우지 않는다 */
        if (r.redirected || !r.ok) throw new Error('login');
        return r.text();
      })
      .then(function (html) {
        var d = document.createElement('div');
        d.innerHTML = html;
        var nw = d.querySelector('#pgWrap'), ow = document.getElementById('pgWrap');
        if (!nw || !ow) throw new Error('login');
        var sx = ow.querySelector('.scrollx'), left = sx ? sx.scrollLeft : 0;
        ow.innerHTML = nw.innerHTML;
        var sx2 = ow.querySelector('.scrollx'); if (sx2) sx2.scrollLeft = left;
        stamp();
      })
      .catch(function (e) {
        if (e && e.message === 'login') stop('로그인이 필요합니다 — 새로고침하세요');
        /* 잠깐 연결이 끊긴 것이면 시각을 그대로 두고 다음 차례에 다시 읽는다 */
      })
      .then(function () { busy = false; });
  }

  function loop() {
    clearTimeout(timer);
    if (stopped) return;
    timer = setTimeout(function () { refresh(); loop(); }, EVERY);
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && !stopped) { refresh(); loop(); }
  });

  stamp();
  loop();
})();
</script>
<?php page_foot(); ?>
