<?php
/* user.php — 한 학생의 활동

   누가 보느냐에 따라 보이는 것이 다르다.
     남이 볼 때  : 푼 문제와 분류별 성취, 최근 제출까지
     본인·선생님 : 여기에 못 푼 문제, 정답률, 평가 현황이 더해진다
   못 푼 문제와 정답률을 감추는 이유는, 많이 틀리면서 끝까지 푸는 태도가
   숫자로는 나쁘게 보이기 때문이다. 그것 때문에 제출을 망설이게 하고 싶지 않다. */
declare(strict_types=1);
require __DIR__ . '/guard.php';
require __DIR__ . '/layout.php';
$me = need_login();   /* 로그인하지 않으면 볼 수 없다 — 채점 결과에서 아이디를 가린 것과 같은 이유 */

$who = trim((string)($_GET['id'] ?? ''));
$t = $who !== ''
   ? one("SELECT u.*, g.name AS group_name FROM users u LEFT JOIN groups g ON g.id = u.group_id
          WHERE u.login_id = ?", [$who])
   : one("SELECT u.*, g.name AS group_name FROM users u LEFT JOIN groups g ON g.id = u.group_id
          WHERE u.id = ?", [$me['id']]);
if (!$t) { header('Location: results.php'); exit; }

$isSelf  = (int)$t['id'] === (int)$me['id'];
$isAdmin = $me['role'] === 'admin';
$full    = $isSelf || $isAdmin;   /* 자세히 볼 수 있는가 */
$uid     = (int)$t['id'];

/* ── 요약 ── */
$solved  = (int)col("SELECT COUNT(DISTINCT problem_id) FROM submissions
                     WHERE user_id=? AND verdict='AC'", [$uid]);
$subs    = (int)col("SELECT COUNT(*) FROM submissions WHERE user_id=? AND state='done'", [$uid]);
$acSubs  = (int)col("SELECT COUNT(*) FROM submissions WHERE user_id=? AND verdict='AC'", [$uid]);
$lastAt  = (string)col("SELECT created_at FROM submissions WHERE user_id=? ORDER BY id DESC LIMIT 1", [$uid]);
$langUse = all("SELECT lang, COUNT(*) n FROM submissions WHERE user_id=? GROUP BY lang ORDER BY n DESC", [$uid]);

/* ── 푼 문제 ── */
$solvedList = all("SELECT p.prob_no, p.title, MIN(s.created_at) AS first_at
                   FROM submissions s JOIN problems p ON p.id = s.problem_id
                   WHERE s.user_id=? AND s.verdict='AC' AND p.active=1
                   GROUP BY p.id ORDER BY p.prob_no", [$uid]);

/* ── 분류별 ── */
$byTag = all("SELECT tg.name,
                     COUNT(DISTINCT pt.problem_id) AS total,
                     COUNT(DISTINCT CASE WHEN EXISTS(
                       SELECT 1 FROM submissions s
                        WHERE s.user_id = :uid AND s.problem_id = pt.problem_id AND s.verdict='AC'
                     ) THEN pt.problem_id END) AS solved
              FROM tags tg
              JOIN problem_tags pt ON pt.tag_id = tg.id
              JOIN problems p ON p.id = pt.problem_id AND p.active = 1
              GROUP BY tg.id HAVING total > 0 ORDER BY tg.name", [':uid' => $uid]);

/* ── 못 푼 문제 (본인·선생님만) ── */
$stuck = $full ? all("SELECT p.prob_no, p.title, COUNT(*) AS tries, MAX(s.created_at) AS last_at
                      FROM submissions s JOIN problems p ON p.id = s.problem_id
                      WHERE s.user_id=? AND p.active=1
                        AND NOT EXISTS(SELECT 1 FROM submissions a
                                       WHERE a.user_id=s.user_id AND a.problem_id=s.problem_id
                                         AND a.verdict='AC')
                      GROUP BY p.id ORDER BY last_at DESC", [$uid]) : [];

/* ── 최근 제출 ── */
$recent = all("SELECT s.id, s.verdict, s.state, s.lang, s.max_time, s.created_at, s.user_id,
                      p.prob_no, p.title
               FROM submissions s JOIN problems p ON p.id = s.problem_id
               WHERE s.user_id=? ORDER BY s.id DESC LIMIT 20", [$uid]);

/* ── 평가 현황 (본인·선생님만) ── */
$assess = [];
if ($full) {
  foreach (all("SELECT DISTINCT st.id, st.title FROM submissions s
                JOIN sets st ON st.id = s.set_id
                WHERE s.user_id=? AND st.set_type='assessment' ORDER BY st.id DESC", [$uid]) as $a) {
    $pg = set_my_progress((int)$uid, (int)$a['id'], true);
    $assess[] = ['title' => $a['title'], 'id' => (int)$a['id'],
                 'done' => $pg['done'], 'total' => $pg['total']];
  }
}

$name = $t['name'] !== '' ? $t['name'] : $t['login_id'];
page_head(['title' => $name . ' 님의 활동', 'root' => '', 'user' => $me, 'nav' => '']);
?>
<div class="wrap">

  <div class="phead">
    <h1><?= h($name) ?></h1>
    <span class="sub pno"><?= h($t['login_id']) ?></span>
    <?php if ($t['group_name'] && $full): ?>
      <span class="sub"><?= h($t['group_name']) ?></span>
    <?php endif; ?>
    <?php if ($t['role'] === 'admin'): ?><span class="v v-wait">관리자</span><?php endif; ?>
    <div class="grow"></div>
    <?php if ($isAdmin && !$isSelf): ?>
      <a class="btn" href="admin/users.php?q=<?= rawurlencode($t['login_id']) ?>">회원 관리</a>
    <?php endif; ?>
  </div>

  <div class="statgrid">
    <div class="stat">
      <div class="k">푼 문제</div>
      <div class="v ok"><?= number_format($solved) ?></div>
      <div class="s">서로 다른 문제</div>
    </div>
    <?php if ($full): ?>
      <div class="stat">
        <div class="k">제출</div>
        <div class="v"><?= number_format($subs) ?></div>
        <div class="s">맞은 제출 <?= number_format($acSubs) ?>건</div>
      </div>
      <div class="stat">
        <div class="k">정답률</div>
        <div class="v"><?= $subs ? number_format($acSubs / $subs * 100, 1) . '%' : '—' ?></div>
        <div class="s">제출 기준</div>
      </div>
    <?php endif; ?>
    <div class="stat">
      <div class="k">마지막 활동</div>
      <div class="v" style="font-size:18px"><?= $lastAt ? h(substr($lastAt, 2, 8)) : '—' ?></div>
      <div class="s">
        <?php foreach ($langUse as $l): ?>
          <?= h(lang_label($l['lang'])) ?> <?= (int)$l['n'] ?>&nbsp;
        <?php endforeach; ?>
      </div>
    </div>
  </div>

  <!-- ── 분류별 ── -->
  <?php if ($byTag): ?>
    <div class="sec">
      <h2>분류별</h2>
      <div class="tagbars">
        <?php foreach ($byTag as $b): $r = (int)$b['total'] ? (int)$b['solved'] / (int)$b['total'] : 0; ?>
          <a class="tagbar" href="problems.php?tag=<?= rawurlencode($b['name']) ?>">
            <span class="tb-name"><?= h($b['name']) ?></span>
            <span class="bar"><span style="width:<?= (int)round($r * 100) ?>%"></span></span>
            <span class="tb-num num small"><?= (int)$b['solved'] ?> / <?= (int)$b['total'] ?></span>
          </a>
        <?php endforeach; ?>
      </div>
    </div>
  <?php endif; ?>

  <!-- ── 평가 현황 ── -->
  <?php if ($full && $assess): ?>
    <div class="sec">
      <h2>평가</h2>
      <table class="list">
        <tbody>
        <?php foreach ($assess as $a): ?>
          <tr>
            <td class="title"><?= h($a['title']) ?></td>
            <td class="right num" style="width:120px">
              <span class="v <?= $a['total'] && $a['done'] >= $a['total'] ? 'v-AC' : 'v-wait' ?>">
                <?= $a['done'] ?> / <?= $a['total'] ?>
              </span>
            </td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
    </div>
  <?php endif; ?>

  <!-- ── 못 푼 문제 ── -->
  <?php if ($full && $stuck): ?>
    <div class="sec">
      <h2>아직 못 푼 문제 <span class="small muted"><?= count($stuck) ?>개</span></h2>
      <p class="desc">제출은 했지만 아직 통과하지 못한 문제입니다.</p>
      <table class="list">
        <thead>
          <tr><th style="width:76px">번호</th><th>제목</th>
              <th class="center" style="width:80px">시도</th>
              <th class="center" style="width:110px">마지막</th></tr>
        </thead>
        <tbody>
        <?php foreach ($stuck as $s): ?>
          <tr>
            <td class="num"><?= (int)$s['prob_no'] ?></td>
            <td class="title"><a href="problem.php?no=<?= (int)$s['prob_no'] ?>"><?= h($s['title']) ?></a></td>
            <td class="center num"><?= (int)$s['tries'] ?>회</td>
            <td class="center num small"><?= h(substr((string)$s['last_at'], 2, 8)) ?></td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
    </div>
  <?php endif; ?>

  <!-- ── 푼 문제 ── -->
  <div class="sec">
    <h2>푼 문제 <span class="small muted"><?= count($solvedList) ?>개</span></h2>
    <?php if (!$solvedList): ?>
      <p class="small muted">아직 푼 문제가 없습니다.</p>
    <?php else: ?>
      <div class="solvedlist">
        <?php foreach ($solvedList as $s): ?>
          <a class="solved" href="problem.php?no=<?= (int)$s['prob_no'] ?>" title="<?= h($s['title']) ?>">
            <?= (int)$s['prob_no'] ?>
          </a>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>
  </div>

  <!-- ── 최근 제출 ── -->
  <div class="sec">
    <h2>최근 제출</h2>
    <?php if (!$recent): ?>
      <p class="small muted">아직 제출한 적이 없습니다.</p>
    <?php else: ?>
      <table class="list">
        <thead>
          <tr><th class="center" style="width:76px">번호</th><th>제목</th>
              <th class="center" style="width:96px">판정</th>
              <th class="center" style="width:80px">언어</th>
              <th class="center" style="width:78px">시간</th>
              <th class="center" style="width:120px">제출 시각</th></tr>
        </thead>
        <tbody>
        <?php foreach ($recent as $r): ?>
          <tr>
            <td class="center num"><?= (int)$r['prob_no'] ?></td>
            <td class="title"><a href="problem.php?no=<?= (int)$r['prob_no'] ?>"><?= h($r['title']) ?></a></td>
            <td class="center"><?= verdict_badge($r['verdict'], $r['state']) ?></td>
            <td class="center num small">
              <?php if ($full): ?>
                <a class="codelink" href="results.php?id=<?= (int)$r['id'] ?>"><?= h(lang_label($r['lang'])) ?></a>
              <?php else: ?><?= h(lang_label($r['lang'])) ?><?php endif; ?>
            </td>
            <td class="center num small"><?= $r['max_time'] !== null ? number_format((float)$r['max_time'], 3) : '' ?></td>
            <td class="center num small"><?= h(substr((string)$r['created_at'], 5, 11)) ?></td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
    <?php endif; ?>
  </div>

</div>
<?php page_foot(); ?>
