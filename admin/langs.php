<?php
/* admin/langs.php — 운영 · 언어
   Judge0 가 채점할 수 있는 언어 중에서 학생에게 열어 줄 것을 고른다. */
declare(strict_types=1);
require_once __DIR__ . '/../guard.php';
require_once __DIR__ . '/../judge0.php';
require_once __DIR__ . '/../layout.php';
$u = need_admin('../');

$msg = ''; $err = '';

/* Judge0 이름에서 우리 설정을 짐작한다. 맞지 않으면 화면에서 고치면 된다.
   editor 는 편집기의 문법 모드 이름이다. */
function guess_lang(string $name): array {
  $n = strtolower($name);
  $t = [
    'python'      => ['py',   'Python3',     'python'],
    'c++'         => ['cpp',  'C++',         'cpp'],
    'c#'          => ['cs',   'C#',          'csharp'],
    'java'        => ['java', 'Java',        'java'],
    'javascript'  => ['js',   'JavaScript',  'javascript'],
    'typescript'  => ['ts',   'TypeScript',  'javascript'],
    'kotlin'      => ['kt',   'Kotlin',      'kotlin'],
    'go'          => ['go',   'Go',          'go'],
    'rust'        => ['rs',   'Rust',        'rust'],
    'ruby'        => ['rb',   'Ruby',        'ruby'],
    'php'         => ['php',  'PHP',         'php'],
    'swift'       => ['swift','Swift',       'swift'],
    'pascal'      => ['pas',  'Pascal',      'pascal'],
    'sql'         => ['sql',  'SQL',         'sql'],
    'bash'        => ['sh',   'Bash',        'shell'],
    'r '          => ['r',    'R',           'r'],
  ];
  foreach ($t as $needle => $v) {
    if (str_contains($n, $needle)) return ['key' => $v[0], 'label' => $v[1], 'editor' => $v[2]];
  }
  /* C 는 C++ · C# 과 겹치므로 마지막에 본다 */
  if (preg_match('/^c\s*\(/', $n)) return ['key' => 'c', 'label' => 'C', 'editor' => 'c'];
  $k = preg_replace('/[^a-z0-9]/', '', explode('(', $n)[0]);
  return ['key' => substr($k, 0, 12) ?: 'lang', 'label' => trim(explode('(', $name)[0]), 'editor' => ''];
}

$do = (string)($_POST['do'] ?? '');

if ($do === 'add') {
  $jid  = (int)($_POST['judge0_id'] ?? 0);
  $name = trim((string)($_POST['judge0_name'] ?? ''));
  if (!$jid) { $err = '언어를 고르세요.'; }
  else {
    $g = guess_lang($name);
    /* 짧은 이름이 겹치면 뒤에 숫자를 붙인다 */
    $key = $g['key']; $i = 2;
    while (one("SELECT 1 x FROM languages WHERE lang_key = ?", [$key])) $key = $g['key'] . $i++;
    $sort = (int)col("SELECT COALESCE(MAX(sort), -1) + 1 FROM languages");
    db()->prepare("INSERT INTO languages(lang_key,judge0_id,label,editor,opts,active,sort)
                   VALUES(?,?,?,?,'',0,?)")
        ->execute([$key, $jid, $g['label'], $g['editor'], $sort]);
    $msg = $g['label'] . ' 을(를) 더했습니다. 내용을 확인한 뒤 켜세요.';
  }
}

if ($do === 'save') {
  $rows = (array)($_POST['L'] ?? []);
  tx(function (PDO $d) use ($rows) {
    $up = $d->prepare("UPDATE languages SET label=?, editor=?, opts=?, active=?, sort=? WHERE lang_key=?");
    $del = $d->prepare("DELETE FROM languages WHERE lang_key=?");
    foreach ($rows as $key => $r) {
      if (!empty($r['del'])) { $del->execute([(string)$key]); continue; }
      $up->execute([
        trim((string)($r['label'] ?? '')) ?: (string)$key,
        trim((string)($r['editor'] ?? '')),
        trim((string)($r['opts'] ?? '')),
        !empty($r['active']) ? 1 : 0,
        (int)($r['sort'] ?? 0),
        (string)$key,
      ]);
    }
  });
  $msg = '저장했습니다.';
}

$mine = all("SELECT * FROM languages ORDER BY sort, lang_key");
$used = [];
foreach (all("SELECT lang, COUNT(*) n FROM submissions GROUP BY lang") as $r) $used[$r['lang']] = (int)$r['n'];

/* Judge0 에 무엇이 있는지 물어본다 */
$avail = []; $j0err = '';
$res = j0_request('GET', '/languages');
if ($res['ok'] && is_array($res['data'])) {
  $have = array_column($mine, 'judge0_id');
  foreach ($res['data'] as $l) {
    if (in_array((int)$l['id'], array_map('intval', $have), true)) continue;
    $avail[] = ['id' => (int)$l['id'], 'name' => (string)$l['name']];
  }
  usort($avail, fn($a, $b) => strcasecmp($a['name'], $b['name']));
} else {
  $j0err = $res['error'] ?: ('Judge0 응답 오류 (HTTP ' . $res['http'] . ')');
}

page_head(['title' => '언어', 'root' => '../', 'user' => $u, 'nav' => 'ops']);
?>
<div class="wrap">

  <div class="phead"><h1>운영</h1></div>
  <?= ops_tabs('langs') ?>

  <?php if ($msg): ?><div class="note ok"><?= h($msg) ?></div><?php endif; ?>
  <?php if ($err): ?><div class="note err"><?= h($err) ?></div><?php endif; ?>
  <?php if ($j0err): ?>
    <div class="note err">Judge0 목록을 가져오지 못했습니다: <?= h($j0err) ?></div>
  <?php endif; ?>

  <div class="phead"><h2 class="subhead2">쓰는 언어</h2>
    <span class="sub">켠 것만 학생 화면에 나옵니다</span>
  </div>

  <form method="post">
    <input type="hidden" name="do" value="save">
    <div class="scrollx">
      <table class="list sets">
        <thead>
          <tr>
            <th class="center" style="width:58px">켜기</th>
            <th style="width:90px">짧은 이름</th>
            <th style="width:170px">보일 이름</th>
            <th class="center" style="width:74px">Judge0</th>
            <th style="width:140px">편집기 문법</th>
            <th style="width:170px">컴파일 옵션</th>
            <th class="center" style="width:70px">순서</th>
            <th class="center" style="width:76px">제출</th>
            <th class="center" style="width:70px">지우기</th>
          </tr>
        </thead>
        <tbody>
        <?php foreach ($mine as $l): $k = (string)$l['lang_key']; ?>
          <tr class="<?= (int)$l['active'] ? '' : 'dim' ?>">
            <td class="center">
              <input type="checkbox" name="L[<?= h($k) ?>][active]" value="1" <?= (int)$l['active'] ? 'checked' : '' ?>>
            </td>
            <td class="num"><?= h($k) ?></td>
            <td><input type="text" name="L[<?= h($k) ?>][label]" value="<?= h($l['label']) ?>"></td>
            <td class="center num small"><?= (int)$l['judge0_id'] ?></td>
            <td><input class="code" type="text" name="L[<?= h($k) ?>][editor]" value="<?= h($l['editor']) ?>"
                       placeholder="python"></td>
            <td><input class="code" type="text" name="L[<?= h($k) ?>][opts]" value="<?= h($l['opts']) ?>"
                       placeholder="-lm"></td>
            <td class="center"><input class="code" type="number" name="L[<?= h($k) ?>][sort]"
                       value="<?= (int)$l['sort'] ?>" style="width:60px"></td>
            <td class="center num small"><?= number_format($used[$k] ?? 0) ?></td>
            <td class="center">
              <?php if (empty($used[$k])): ?>
                <label class="chk" style="justify-content:center">
                  <input type="checkbox" name="L[<?= h($k) ?>][del]" value="1"></label>
              <?php else: ?>
                <span class="small muted">—</span>
              <?php endif; ?>
            </td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
    </div>

    <p class="small muted" style="margin-top:12px">
      <b>편집기 문법</b>은 색칠에 쓰는 이름입니다. 비워 두면 색칠 없이 그냥 글자로 보입니다.
      <b>컴파일 옵션</b>은 Judge0 에 그대로 넘깁니다. C 에서 <code>math.h</code> 링크 오류가 나면
      <code>-lm</code> 을 넣으세요.
      제출 기록이 있는 언어는 지울 수 없습니다. 끄기만 하면 목록에서 감춰지고 기록은 남습니다.
    </p>

    <div class="actions">
      <button class="btn primary" type="submit">저장</button>
    </div>
  </form>

  <!-- ── 추가 ─────────────────────────────── -->
  <div class="sec">
    <h2>언어 추가</h2>
    <p class="desc">
      Judge0 가 채점할 수 있는 언어입니다. 더하면 꺼진 상태로 들어오니, 내용을 확인하고 켜세요.
    </p>
    <?php if (!$avail): ?>
      <div class="note info"><?= $j0err ? 'Judge0 에 연결되면 목록이 보입니다.' : '더할 수 있는 언어가 없습니다.' ?></div>
    <?php else: ?>
      <form method="post" class="inline">
        <input type="hidden" name="do" value="add">
        <select name="judge0_id" id="j0sel" style="max-width:340px" required>
          <option value="">— 고르세요 —</option>
          <?php foreach ($avail as $a): ?>
            <option value="<?= (int)$a['id'] ?>" data-name="<?= h($a['name']) ?>"><?= h($a['name']) ?></option>
          <?php endforeach; ?>
        </select>
        <input type="hidden" name="judge0_name" id="j0name">
        <button class="btn" type="submit">더하기</button>
      </form>
      <script>
        var sel = document.getElementById('j0sel');
        sel.addEventListener('change', function () {
          document.getElementById('j0name').value =
            sel.options[sel.selectedIndex].getAttribute('data-name') || '';
        });
      </script>
    <?php endif; ?>
  </div>

</div>
<?php page_foot(); ?>
