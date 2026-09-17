<?php
/* admin/submissions.php — 평가 제출 기록과 입력 통계

   평가에서는 제출할 때 키 입력 수, 붙여넣기 시도, 편집에 걸린 시간을 함께 저장한다.
   붙여넣기 차단은 완벽하지 않다(개발자 도구를 열면 뚫린다). 그래서 막는 것만이 아니라
   기록을 남겨 두고, 눈에 띄는 것을 선생님이 확인할 수 있게 하는 것이 목적이다.

   여기 표시는 '증거'가 아니라 '살펴볼 만한 것'이다. 판단은 사람이 한다. */
declare(strict_types=1);
require_once __DIR__ . '/../guard.php';
require_once __DIR__ . '/../layout.php';
$u = need_admin('../');

$setId = (int)($_GET['set_id'] ?? 0);
$set   = $setId ? one("SELECT * FROM sets WHERE id=?", [$setId]) : null;
if (!$set) {
  /* 묶음 고르기 */
  $sets = all("SELECT id, set_type, title FROM sets ORDER BY id DESC");
  page_head(['title' => '제출 기록', 'root' => '../', 'user' => $u, 'nav' => 'assessments']);
  echo '<div class="wrap"><div class="phead"><h1>제출 기록</h1></div>';
  if (!$sets) echo '<div class="empty">먼저 수업이나 평가를 만드세요.</div>';
  else {
    echo '<table class="list"><tbody>';
    foreach ($sets as $s) {
      echo '<tr><td style="width:70px"><span class="v v-wait">' . h(SET_TYPE_NAME[$s['set_type']]) . '</span></td>'
         . '<td class="title"><a href="?set_id=' . (int)$s['id'] . '">' . h($s['title']) . '</a></td></tr>';
    }
    echo '</tbody></table>';
  }
  echo '</div>'; page_foot(); exit;
}

$fUser = trim((string)($_GET['user'] ?? ''));
$fProb = (int)($_GET['problem_id'] ?? 0);
$fUid  = (int)($_GET['user_id'] ?? 0);
$only  = (string)($_GET['only'] ?? '');   /* '' | flag */

/* 무엇을 '살펴볼 것'으로 볼지는 화면에서 정한다.
   편집기의 자동완성이나 문제의 성격에 따라 적절한 값이 달라지므로
   코드에 박아 두지 않고 그때그때 바꿔 가며 볼 수 있게 한다. */
const DEF_RATIO = 0.5;   /* 키 입력 ÷ 코드 길이 */
const DEF_SECPC = 0.1;   /* 코드 한 글자당 입력 시간(초) */
$ratioMin = $_GET['ratio'] !== null && $_GET['ratio'] !== '' ? (float)$_GET['ratio'] : DEF_RATIO;
$secPerCh = $_GET['sec'] !== null && $_GET['sec'] !== ''     ? (float)$_GET['sec']   : DEF_SECPC;
$ratioMin = max(0.0, min(5.0, $ratioMin));
$secPerCh = max(0.0, min(5.0, $secPerCh));

$where = ["s.set_id = :sid"]; $args = [':sid' => $setId];
if ($fUser !== '') { $where[] = "(us.login_id LIKE :us OR us.name LIKE :us)"; $args[':us'] = '%' . $fUser . '%'; }
if ($fProb)        { $where[] = "s.problem_id = :pid"; $args[':pid'] = $fProb; }
if ($fUid)         { $where[] = "s.user_id = :uid";    $args[':uid'] = $fUid; }

$rows = all("SELECT s.id, s.user_id, s.problem_id, s.lang, s.verdict, s.state,
                    s.keystrokes, s.paste_blocked, s.edit_ms, s.created_at,
                    LENGTH(s.source_code) AS code_len,
                    us.login_id, us.name AS uname, p.prob_no, p.title
             FROM submissions s
             JOIN users us ON us.id = s.user_id
             JOIN problems p ON p.id = s.problem_id
             WHERE " . implode(' AND ', $where) . "
             ORDER BY s.id DESC LIMIT 1000", $args);

/* 살펴볼 만한 것을 표시한다 */
function flags(array $r, float $ratioMin, float $secPerCh): array {
  $f = [];
  $len  = (int)$r['code_len'];
  $keys = $r['keystrokes'] !== null ? (int)$r['keystrokes'] : null;
  $ms   = $r['edit_ms'] !== null ? (int)$r['edit_ms'] : null;

  if ((int)$r['paste_blocked'] > 0) $f[] = ['붙여넣기 시도 ' . (int)$r['paste_blocked'] . '회', 'bad'];
  /* 코드가 아주 짧으면 비율이 흔들리므로 30자 아래는 보지 않는다 */
  if ($ratioMin > 0 && $keys !== null && $len > 30 && $keys < $len * $ratioMin) {
    $f[] = ['키 입력 적음', 'bad'];
  }
  if ($secPerCh > 0 && $ms !== null && $len > 30 && $ms < $len * $secPerCh * 1000) {
    $f[] = ['입력 시간 짧음', 'warn'];
  }
  return $f;
}
$flagged = 0;
foreach ($rows as $r) if (flags($r, $ratioMin, $secPerCh)) $flagged++;
if ($only === 'flag') {
  $rows = array_values(array_filter($rows, fn($r) => flags($r, $ratioMin, $secPerCh)));
}

/* CSV */
if (($_GET['csv'] ?? '') === '1') {
  while (ob_get_level() > 0) ob_end_clean();
  header('Content-Type: text/csv; charset=utf-8');
  header('Content-Disposition: attachment; filename="submissions-' . $setId . '.csv"');
  echo "\xEF\xBB\xBF";
  $out = fopen('php://output', 'w');
  fputcsv($out, ['제출번호','아이디','이름','문제','판정','언어','코드 길이','키 입력','타자 비율',
                 '붙여넣기 시도','편집 시간(초)','제출 시각','표시'], ',', '"', '\\');
  foreach ($rows as $r) {
    $ratio = $r['keystrokes'] !== null && (int)$r['code_len'] > 0
           ? round((int)$r['keystrokes'] / (int)$r['code_len'], 2) : '';
    fputcsv($out, [
      $r['id'], $r['login_id'], $r['uname'], $r['prob_no'], $r['verdict'] ?? '',
      lang_label($r['lang']), $r['code_len'], $r['keystrokes'] ?? '', $ratio,
      (int)$r['paste_blocked'],
      $r['edit_ms'] !== null ? round((int)$r['edit_ms'] / 1000) : '',
      $r['created_at'],
      implode(' / ', array_column(flags($r, $ratioMin, $secPerCh), 0)),
    ], ',', '"', '\\');
  }
  fclose($out); exit;
}

$problems = all("SELECT p.id, p.prob_no, p.title FROM set_problems sp
                 JOIN problems p ON p.id = sp.problem_id
                 WHERE sp.set_id = ? ORDER BY sp.sort, sp.id", [$setId]);
$isAssess = $set['set_type'] === 'assessment';

page_head(['title' => $set['title'] . ' 제출 기록', 'root' => '../', 'user' => $u,
            'nav' => $isAssess ? 'assessments' : 'lessons']);
?>
<div class="wrap">

  <div class="phead">
    <h1><?= h($set['title']) ?></h1>
    <span class="sub">제출 <?= number_format(count($rows)) ?>건<?= $flagged ? ' · 살펴볼 것 ' . $flagged . '건' : '' ?></span>
    <div class="grow"></div>
    <a class="btn" href="progress.php?id=<?= $setId ?>">현황</a>
    <a class="btn" href="?<?= h(http_build_query($_GET + ['csv' => 1])) ?>">CSV</a>
  </div>

  <?php if ($isAssess): ?>
    <p class="small muted" style="margin:-10px 0 18px">
      아래 표시는 증거가 아니라 살펴볼 만한 신호입니다. 붙여넣기 차단은 완벽하지 않으므로
      숫자만으로 판단하지 마시고, 필요하면 학생에게 직접 확인하세요.
    </p>
  <?php endif; ?>

  <form class="searchbar" method="get">
    <input type="hidden" name="set_id" value="<?= $setId ?>">
    <input type="text" name="user" value="<?= h($fUser) ?>" placeholder="아이디 또는 이름" style="max-width:170px">
    <select name="problem_id">
      <option value="0">전체 문제</option>
      <?php foreach ($problems as $p): ?>
        <option value="<?= (int)$p['id'] ?>" <?= $fProb === (int)$p['id'] ? 'selected' : '' ?>>
          <?= (int)$p['prob_no'] ?> · <?= h($p['title']) ?>
        </option>
      <?php endforeach; ?>
    </select>
    <label class="chk"><input type="checkbox" name="only" value="flag" <?= $only === 'flag' ? 'checked' : '' ?>>
      살펴볼 것만</label>
    <button class="btn" type="submit">찾기</button>
    <?php if ($fUser !== '' || $fProb || $only || $fUid || isset($_GET['ratio']) || isset($_GET['sec'])): ?>
      <a class="btn" href="?set_id=<?= $setId ?>">초기화</a>
    <?php endif; ?>

    <span class="sepline"></span>
    <label class="chk" title="키 입력 수 ÷ 코드 길이. 이 값보다 낮으면 표시합니다.">
      키 입력 기준 비율
      <input class="code" type="number" name="ratio" step="0.05" min="0" max="5"
             value="<?= h(rtrim(rtrim(number_format($ratioMin, 2), '0'), '.')) ?>" style="width:72px">
    </label>
    <label class="chk" title="코드 한 글자당 입력 시간(초). 이 값보다 짧으면 표시합니다.">
      글자당 시간
      <input class="code" type="number" name="sec" step="0.05" min="0" max="5"
             value="<?= h(rtrim(rtrim(number_format($secPerCh, 2), '0'), '.')) ?>" style="width:72px">
      <span class="small muted">초</span>
    </label>
  </form>

  <?php if (!$rows): ?>
    <div class="empty">조건에 맞는 제출이 없습니다.</div>
  <?php else: ?>
    <div class="scrollx">
      <table class="list grid">
        <thead>
          <tr>
            <th style="width:60px">번호</th>
            <th style="width:100px">아이디</th>
            <th style="width:90px">이름</th>
            <th class="center" style="width:62px">문제</th>
            <th class="center" style="width:86px">판정</th>
            <th class="center" style="width:70px">코드</th>
            <th class="center" style="width:70px">키 입력</th>
            <th class="center" style="width:64px">비율</th>
            <th class="center" style="width:78px">입력 시간</th>
            <th style="min-width:170px">표시</th>
            <th class="center" style="width:120px">제출 시각</th>
          </tr>
        </thead>
        <tbody>
        <?php foreach ($rows as $r):
          $len   = (int)$r['code_len'];
          $keys  = $r['keystrokes'] !== null ? (int)$r['keystrokes'] : null;
          $ratio = ($keys !== null && $len > 0) ? $keys / $len : null;
          $ms    = $r['edit_ms'] !== null ? (int)$r['edit_ms'] : null;
          $fl    = flags($r, $ratioMin, $secPerCh);
        ?>
          <tr class="<?= $fl ? 'flagged' : '' ?>">
            <td class="num"><a class="codelink" href="../results.php?id=<?= (int)$r['id'] ?>"><?= (int)$r['id'] ?></a></td>
            <td class="num"><a href="../user.php?id=<?= rawurlencode($r['login_id']) ?>"><?= h($r['login_id']) ?></a></td>
            <td class="small"><?= h($r['uname']) ?></td>
            <td class="center num"><?= (int)$r['prob_no'] ?></td>
            <td class="center"><?= verdict_badge($r['verdict'], $r['state']) ?></td>
            <td class="center num small"><?= number_format($len) ?></td>
            <td class="center num small"><?= $keys !== null ? number_format($keys) : '—' ?></td>
            <td class="center num small <?= ($ratio !== null && $ratioMin > 0 && $ratio < $ratioMin) ? 'c-part' : '' ?>">
              <?= $ratio !== null ? number_format($ratio, 2) : '—' ?>
            </td>
            <td class="center num small">
              <?= $ms !== null ? gmdate($ms >= 3600000 ? 'H:i:s' : 'i:s', (int)($ms / 1000)) : '—' ?>
            </td>
            <td>
              <?php foreach ($fl as [$label, $kind]): ?>
                <span class="v <?= $kind === 'bad' ? 'v-WA' : 'v-CE' ?>"><?= h($label) ?></span>
              <?php endforeach; ?>
            </td>
            <td class="center num small"><?= h(substr((string)$r['created_at'], 5, 14)) ?></td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
    </div>

    <p class="small muted" style="margin-top:14px">
      <b>비율</b>은 키 입력 수를 코드 길이로 나눈 값입니다. 손으로 치면 보통 1 이상이고,
      지우고 고치면 더 올라갑니다. 지금은 <b><?= h(rtrim(rtrim(number_format($ratioMin, 2), '0'), '.')) ?></b> 미만,
      글자당 <b><?= h(rtrim(rtrim(number_format($secPerCh, 2), '0'), '.')) ?></b>초 미만을 표시하고 있습니다.
      숫자를 바꿔 가며 몇 건이 걸리는지 보고 기준을 잡으세요. 0 을 넣으면 그 기준은 보지 않습니다.
      코드가 30자 이하면 비율이 크게 흔들리므로 표시하지 않습니다.
    </p>
  <?php endif; ?>

</div>
<?php page_foot(); ?>
