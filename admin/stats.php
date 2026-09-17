<?php
/* admin/stats.php — 문제별 통계
   어떤 문제에서 학생들이 막히는지 본다. 문제를 다듬는 근거로 쓴다. */
declare(strict_types=1);
require_once __DIR__ . '/../guard.php';
require_once __DIR__ . '/../layout.php';
$u = need_admin('../');

$sort = (string)($_GET['sort'] ?? 'no');
$dir  = ($_GET['dir'] ?? 'asc') === 'desc' ? 'desc' : 'asc';
$tag  = trim((string)($_GET['tag'] ?? ''));

/* 한 번에 모아 온다. 문제마다 따로 세면 문제 수만큼 조회가 나간다. */
$rows = all("
  SELECT p.id, p.prob_no, p.title, p.active,
         (SELECT COUNT(*) FROM testcases t WHERE t.problem_id = p.id) AS tc_cnt,
         (SELECT COUNT(*) FROM submissions s
           WHERE s.problem_id = p.id AND s.state = 'done') AS sub_cnt,
         (SELECT COUNT(*) FROM submissions s
           WHERE s.problem_id = p.id AND s.verdict = 'AC') AS ac_cnt,
         (SELECT COUNT(DISTINCT s.user_id) FROM submissions s
           WHERE s.problem_id = p.id) AS tried_users,
         (SELECT COUNT(DISTINCT s.user_id) FROM submissions s
           WHERE s.problem_id = p.id AND s.verdict = 'AC') AS solved_users
  FROM problems p
  " . ($tag !== '' ? "WHERE EXISTS(SELECT 1 FROM problem_tags pt JOIN tags tg ON tg.id = pt.tag_id
                                   WHERE pt.problem_id = p.id AND tg.name = :tag)" : "") . "
  ORDER BY p.prob_no", $tag !== '' ? [':tag' => $tag] : []);

/* 비율을 덧붙인다 */
foreach ($rows as &$r) {
  $r['ac_rate']    = $r['sub_cnt']    ? $r['ac_cnt'] / $r['sub_cnt'] : null;        /* 제출 기준 */
  $r['user_rate']  = $r['tried_users'] ? $r['solved_users'] / $r['tried_users'] : null; /* 사람 기준 */
  $r['per_solver'] = $r['solved_users'] ? $r['sub_cnt'] / $r['solved_users'] : null;    /* 푼 사람당 제출 */
}
unset($r);

$key = [
  'no' => 'prob_no', 'sub' => 'sub_cnt', 'ac' => 'ac_cnt',
  'rate' => 'ac_rate', 'users' => 'tried_users', 'solved' => 'solved_users',
  'urate' => 'user_rate', 'tries' => 'per_solver',
][$sort] ?? 'prob_no';

usort($rows, function ($a, $b) use ($key, $dir) {
  $x = $a[$key]; $y = $b[$key];
  /* 값이 없는 것은 늘 뒤로 보낸다 */
  if ($x === null && $y === null) return $a['prob_no'] <=> $b['prob_no'];
  if ($x === null) return 1;
  if ($y === null) return -1;
  $c = $x <=> $y;
  return $dir === 'desc' ? -$c : $c;
});

$tmap  = tags_map();
$alltg = tags_all();

function th(string $k, string $label, string $sort, string $dir): string {
  $next = ($sort === $k && $dir === 'asc') ? 'desc' : 'asc';
  $q = $_GET; $q['sort'] = $k; $q['dir'] = $next;
  $mark = $sort === $k ? ($dir === 'asc' ? ' ▲' : ' ▼') : '';
  return '<a href="?' . h(http_build_query($q)) . '">' . h($label) . $mark . '</a>';
}
function pct(?float $v): string {
  return $v === null ? '<span class="muted">—</span>' : number_format($v * 100, 1) . '%';
}

page_head(['title' => '문제 통계', 'root' => '../', 'user' => $u, 'nav' => 'problems']);
?>
<div class="wrap">

  <div class="phead">
    <h1>문제 통계</h1>
    <span class="sub"><?= count($rows) ?>문제</span>
    <div class="grow"></div>
    <a class="btn" href="problems.php">문제 관리</a>
  </div>

  <form class="searchbar" method="get">
    <input type="hidden" name="sort" value="<?= h($sort) ?>">
    <input type="hidden" name="dir" value="<?= h($dir) ?>">
    <select name="tag">
      <option value="">전체 분류</option>
      <?php foreach ($alltg as $t): ?>
        <option value="<?= h($t['name']) ?>" <?= $tag === $t['name'] ? 'selected' : '' ?>>
          <?= h($t['name']) ?> (<?= (int)$t['use_cnt'] ?>)
        </option>
      <?php endforeach; ?>
    </select>
    <button class="btn" type="submit">보기</button>
    <?php if ($tag !== ''): ?><a class="btn" href="stats.php">초기화</a><?php endif; ?>
  </form>

  <?php if (!$rows): ?>
    <div class="empty">문제가 없습니다.</div>
  <?php else: ?>
    <div class="scrollx">
      <table class="list sets">
        <thead>
          <tr>
            <th class="center" style="width:76px"><?= th('no', '번호', $sort, $dir) ?></th>
            <th style="min-width:200px">제목</th>
            <th class="center" style="width:74px"><?= th('sub', '제출', $sort, $dir) ?></th>
            <th class="center" style="width:74px"><?= th('ac', '정답', $sort, $dir) ?></th>
            <th class="center" style="width:92px"><?= th('rate', '정답률', $sort, $dir) ?></th>
            <th class="center" style="width:82px"><?= th('users', '시도자', $sort, $dir) ?></th>
            <th class="center" style="width:82px"><?= th('solved', '해결자', $sort, $dir) ?></th>
            <th class="center" style="width:92px"><?= th('urate', '해결 비율', $sort, $dir) ?></th>
            <th class="center" style="width:100px"><?= th('tries', '평균 시도', $sort, $dir) ?></th>
          </tr>
        </thead>
        <tbody>
        <?php foreach ($rows as $r): $pid = (int)$r['id']; ?>
          <tr class="<?= (int)$r['active'] ? '' : 'dim' ?>">
            <td class="center num"><?= (int)$r['prob_no'] ?></td>
            <td class="title">
              <a href="../problem.php?no=<?= (int)$r['prob_no'] ?>"><?= h($r['title']) ?></a>
              <?php if ((int)$r['tc_cnt'] === 0): ?>
                <span class="small" style="color:var(--bad)">(테스트케이스 없음)</span>
              <?php endif; ?>
            </td>
            <td class="center num"><?= number_format((int)$r['sub_cnt']) ?></td>
            <td class="center num"><?= number_format((int)$r['ac_cnt']) ?></td>
            <td class="center num <?= ($r['ac_rate'] !== null && $r['ac_rate'] < 0.2) ? 'c-part' : '' ?>">
              <?= pct($r['ac_rate']) ?>
            </td>
            <td class="center num"><?= number_format((int)$r['tried_users']) ?></td>
            <td class="center num"><?= number_format((int)$r['solved_users']) ?></td>
            <td class="center num <?= ($r['user_rate'] !== null && $r['user_rate'] < 0.5) ? 'c-part' : '' ?>">
              <?= pct($r['user_rate']) ?>
            </td>
            <td class="center num">
              <?= $r['per_solver'] === null ? '<span class="muted">—</span>'
                : number_format($r['per_solver'], 1) . '회' ?>
            </td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
    </div>

    <p class="small muted" style="margin-top:14px">
      <b>정답률</b>은 제출 중 맞은 비율입니다. 한 학생이 여러 번 내면 그만큼 낮아지므로,
      문제가 어려운지는 <b>해결 비율</b>(시도한 학생 중 결국 푼 학생의 비율)로 보는 편이 낫습니다.
      <b>평균 시도</b>는 푼 학생 한 명이 평균 몇 번 냈는지입니다. 이 값이 크면 설명이 모호하거나
      까다로운 예외가 있다는 신호일 수 있습니다.
    </p>
  <?php endif; ?>

</div>
<?php page_foot(); ?>
