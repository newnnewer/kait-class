<?php
/* admin/testcases.php — 한 문제의 테스트케이스만 다루는 화면.
   문항 편집과 나누어 둔다. 성격이 다른 작업이고, 한 화면에 저장 버튼이
   둘 있으면 고치던 내용이 날아가기 쉽기 때문이다. */
declare(strict_types=1);
require_once __DIR__ . '/../guard.php';
require_once __DIR__ . '/../layout.php';
$u = need_admin('../');

$id = (int)($_GET['id'] ?? 0);
$p  = $id ? one("SELECT id, prob_no, title FROM problems WHERE id = ?", [$id]) : null;
if (!$p) { header('Location: problems.php'); exit; }

$err = ''; $msg = ''; $warn = [];

/* ═══ ZIP 읽기 ═══════════════════════════════════
   받아들이는 이름: 1.in / 1.out · 1.in / 1.a · input1.txt / output1.txt
   폴더 안에 들어 있어도 되고, 맥 압축 부산물은 무시한다. */
function read_tc_zip(ZipArchive $zip): array {
  $inputs = []; $outputs = []; $warn = []; $skipped = 0;

  for ($i = 0; $i < $zip->numFiles; $i++) {
    $stat = $zip->statIndex($i);
    $path = $stat['name'];
    if (substr($path, -1) === '/') continue;
    if (str_contains($path, '__MACOSX/')) continue;
    $base = basename($path);
    if ($base === '' || $base[0] === '.') continue;
    if ($stat['size'] > 2 * 1024 * 1024) { $skipped++; continue; }

    $lower = strtolower($base);
    if (preg_match('/^(.*)\.in$/', $lower, $m))              { $key = $m[1]; $kind = 'in'; }
    elseif (preg_match('/^(.*)\.(out|a|ans)$/', $lower, $m)) { $key = $m[1]; $kind = 'out'; }
    elseif (preg_match('/^input(.*)\.txt$/', $lower, $m))    { $key = $m[1]; $kind = 'in'; }
    elseif (preg_match('/^output(.*)\.txt$/', $lower, $m))   { $key = $m[1]; $kind = 'out'; }
    else { $skipped++; continue; }

    $body = nl_clean((string)$zip->getFromIndex($i));
    if ($kind === 'in') $inputs[$key] = $body; else $outputs[$key] = $body;
  }

  /* 1, 2, 10 순서로 정렬한다. PHP 는 '1' 같은 배열 키를 정수로 바꾸므로 되돌린다. */
  $keys = array_map('strval', array_keys($inputs));
  usort($keys, function (string $a, string $b) {
    $na = preg_replace('/\D/', '', $a);
    $nb = preg_replace('/\D/', '', $b);
    if ($na !== '' && $nb !== '' && $na !== $nb) return (int)$na <=> (int)$nb;
    return strnatcasecmp($a, $b);
  });

  $pairs = [];
  foreach ($keys as $k) {
    if (!isset($outputs[$k])) { $warn[] = $k . ' 의 출력 파일이 없어 건너뜁니다.'; continue; }
    $pairs[] = ['input' => $inputs[$k], 'expected' => $outputs[$k], 'is_sample' => 0];
    unset($outputs[$k]);
  }
  foreach (array_keys($outputs) as $k) $warn[] = (string)$k . ' 의 입력 파일이 없어 건너뜁니다.';
  if ($skipped) $warn[] = '알 수 없는 파일 ' . $skipped . '개는 무시했습니다.';
  return [$pairs, $warn];
}

/* ═══ 저장 ═══════════════════════════════════════
   화면에 입력한 것과 ZIP 을 한 번에 처리한다. 저장 버튼은 하나뿐이다. */
if (($_POST['do'] ?? '') === 'save') {
  $mode = ($_POST['zip_mode'] ?? 'replace') === 'append' ? 'append' : 'replace';

  /* 화면에서 온 것 */
  $rows = [];
  foreach ((array)($_POST['tc'] ?? []) as $t) {
    if (!empty($t['del'])) continue;
    $in = nl_clean($t['input'] ?? '');
    $ex = nl_clean($t['expected'] ?? '');
    if (trim($in) === '' && trim($ex) === '') continue;
    $rows[] = ['input' => $in, 'expected' => $ex,
               'is_sample' => !empty($t['is_sample']) ? 1 : 0];
  }

  /* ZIP 에서 온 것 */
  $fromZip = [];
  $hasZip = isset($_FILES['zip']) && ($_FILES['zip']['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK;
  if ($hasZip) {
    if ($_FILES['zip']['size'] > 30 * 1024 * 1024) {
      $err = 'ZIP 은 30MB까지 올릴 수 있습니다.';
    } elseif (!class_exists('ZipArchive')) {
      $err = 'php-zip 확장이 없습니다. apt install php8.4-zip 후 재시작하세요.';
    } else {
      $zip = new ZipArchive();
      if ($zip->open($_FILES['zip']['tmp_name']) !== true) {
        $err = 'ZIP 을 열지 못했습니다.';
      } else {
        [$fromZip, $warn] = read_tc_zip($zip);
        $zip->close();
        if (!$fromZip) $err = '짝이 맞는 파일을 찾지 못했습니다. 1.in / 1.out 형식인지 확인하세요.';
      }
    }
  } elseif (($_FILES['zip']['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
    $err = 'ZIP 파일을 받지 못했습니다. 크기가 너무 클 수 있습니다.';
  }

  if ($err === '') {
    $final = ($hasZip && $mode === 'replace') ? $fromZip : array_merge($rows, $fromZip);

    if (count($final) > 100) {
      $final = array_slice($final, 0, 100);
      $warn[] = '테스트케이스는 100개까지만 등록합니다.';
    }
    /* 샘플이 하나도 없으면 첫 번째를 샘플로 둔다. 학생에게 보여줄 예시가 필요하다. */
    if ($final && !array_filter($final, fn($t) => (int)$t['is_sample'])) {
      $final[0]['is_sample'] = 1;
      if ($hasZip) $warn[] = '첫 번째를 샘플로 공개했습니다. 필요하면 바꾸세요.';
    }

    try {
      tx(function (PDO $d) use ($id, $final) {
        $d->prepare("DELETE FROM testcases WHERE problem_id = ?")->execute([$id]);
        $ins = $d->prepare("INSERT INTO testcases(problem_id,seq,input,expected,is_sample)
                            VALUES(?,?,?,?,?)");
        $seq = 1;
        foreach ($final as $t) $ins->execute([$id, $seq++, $t['input'], $t['expected'], $t['is_sample']]);
      });
      $_SESSION['jtc_msg']  = count($final) . '개를 저장했습니다.';
      $_SESSION['jtc_warn'] = $warn;
      header('Location: testcases.php?id=' . $id); exit;
    } catch (Throwable $e) {
      $err = '저장하지 못했습니다: ' . $e->getMessage();
    }
  }
}

if (isset($_SESSION['jtc_msg'])) {
  $msg  = (string)$_SESSION['jtc_msg'];
  $warn = (array)($_SESSION['jtc_warn'] ?? []);
  unset($_SESSION['jtc_msg'], $_SESSION['jtc_warn']);
}

/* 화면에 채울 값 — 저장에 실패했으면 입력하던 것을 되돌려준다 */
if (($_POST['do'] ?? '') === 'save' && $err !== '') {
  $tcs = [];
  foreach ((array)($_POST['tc'] ?? []) as $t) {
    if (!empty($t['del'])) continue;
    $tcs[] = ['input' => (string)($t['input'] ?? ''), 'expected' => (string)($t['expected'] ?? ''),
              'is_sample' => !empty($t['is_sample']) ? 1 : 0];
  }
} else {
  $tcs = all("SELECT input, expected, is_sample FROM testcases
              WHERE problem_id = ? ORDER BY seq, id", [$id]);
}

page_head(['title' => $p['prob_no'] . ' 테스트케이스', 'root' => '../',
            'user' => $u, 'nav' => 'problems']);
?>
<div class="wrap">

  <div class="phead">
    <span class="pno" style="font-size:19px"><?= (int)$p['prob_no'] ?></span>
    <h1><?= h($p['title']) ?></h1>
    <span class="sub">테스트케이스 <?= count($tcs) ?>개</span>
    <div class="grow"></div>
    <a class="btn" href="problem.php?id=<?= $id ?>">문항 수정</a>
    <a class="btn" href="problems.php">목록</a>
  </div>

  <?php if ($err): ?><div class="note err"><?= h($err) ?></div><?php endif; ?>
  <?php if ($msg): ?><div class="note ok"><?= h($msg) ?></div><?php endif; ?>
  <?php foreach ($warn as $w): ?><div class="note info"><?= h($w) ?></div><?php endforeach; ?>

  <form method="post" enctype="multipart/form-data" id="tcform">
    <input type="hidden" name="do" value="save">

    <!-- ── ZIP 가져오기 ───────────────────────── -->
    <div class="tcupload">
      <div class="cap">ZIP 으로 가져오기</div>
      <p class="small muted">
        <code>1.in</code> · <code>1.out</code> 처럼 짝을 이룬 파일을 압축해 올리면 번호 순서대로 읽습니다.
        <code>input1.txt</code> · <code>output1.txt</code> 형식도 됩니다. 폴더 안에 있어도 찾아냅니다.
      </p>
      <div class="tcupload-row">
        <input type="file" name="zip" accept=".zip">
        <select name="zip_mode" style="width:auto">
          <option value="replace">ZIP 내용으로 전부 바꾸기</option>
          <option value="append">아래 목록 뒤에 더하기</option>
        </select>
        <span class="small muted">아래 저장을 누르면 함께 반영됩니다.</span>
      </div>
    </div>

    <!-- ── 직접 입력 ──────────────────────────── -->
    <div class="sec">
      <h2>테스트케이스</h2>
      <p class="desc">
        위에서부터 순서대로 채점합니다. 샘플로 표시한 것만 학생에게 예시로 보입니다.
        출력을 비교할 때 줄 끝 공백과 마지막 줄바꿈 차이는 무시합니다.
      </p>

      <div id="tcList">
        <?php foreach ($tcs as $i => $t): ?>
          <div class="tc <?= (int)$t['is_sample'] ? 'sample' : '' ?>">
            <div class="tc-head">
              <span class="n">#<span class="idx"><?= $i + 1 ?></span></span>
              <label><input type="checkbox" name="tc[<?= $i ?>][is_sample]" value="1"
                     <?= (int)$t['is_sample'] ? 'checked' : '' ?>> 샘플로 공개</label>
              <div class="grow"></div>
              <button class="btn sm danger tcDel" type="button">삭제</button>
            </div>
            <div class="tc-body">
              <div>
                <div class="cap">입력</div>
                <textarea name="tc[<?= $i ?>][input]" rows="4"><?= h($t['input']) ?></textarea>
              </div>
              <div>
                <div class="cap">기대 출력</div>
                <textarea name="tc[<?= $i ?>][expected]" rows="4"><?= h($t['expected']) ?></textarea>
              </div>
            </div>
          </div>
        <?php endforeach; ?>
      </div>

      <button class="btn" type="button" id="tcAdd">테스트케이스 추가</button>

      <?php if (!$tcs): ?>
        <div class="note info" style="margin-top:14px">
          테스트케이스가 하나도 없으면 이 문제는 채점할 수 없습니다.
        </div>
      <?php endif; ?>
    </div>

    <div class="actions">
      <button class="btn primary" type="submit">저장</button>
      <a class="btn" href="problems.php">취소</a>
      <div class="grow"></div>
      <a class="btn" href="judge.php?problem_id=<?= $id ?>"
         title="테스트케이스를 고쳤다면 이미 낸 제출을 다시 채점해야 합니다">재채점</a>
    </div>
  </form>

</div>

<script>
(function(){
  var list = document.getElementById('tcList');
  var seq  = <?= count($tcs) ?>;

  function renumber(){
    var i = 1;
    list.querySelectorAll('.tc').forEach(function(el){ el.querySelector('.idx').textContent = i++; });
  }

  document.getElementById('tcAdd').addEventListener('click', function(){
    var n = seq++;
    var d = document.createElement('div');
    d.className = 'tc';
    d.innerHTML =
      '<div class="tc-head">' +
        '<span class="n">#<span class="idx"></span></span>' +
        '<label><input type="checkbox" name="tc[' + n + '][is_sample]" value="1"> 샘플로 공개</label>' +
        '<div class="grow"></div>' +
        '<button class="btn sm danger tcDel" type="button">삭제</button>' +
      '</div>' +
      '<div class="tc-body">' +
        '<div><div class="cap">입력</div>' +
          '<textarea name="tc[' + n + '][input]" rows="4"></textarea></div>' +
        '<div><div class="cap">기대 출력</div>' +
          '<textarea name="tc[' + n + '][expected]" rows="4"></textarea></div>' +
      '</div>';
    list.appendChild(d);
    renumber();
    d.querySelector('textarea').focus();
  });

  list.addEventListener('click', function(ev){
    if (!ev.target.classList.contains('tcDel')) return;
    ev.target.closest('.tc').remove();
    renumber();
  });

  list.addEventListener('change', function(ev){
    if (ev.target.type !== 'checkbox') return;
    ev.target.closest('.tc').classList.toggle('sample', ev.target.checked);
  });
})();
</script>
<?php page_foot(); ?>
