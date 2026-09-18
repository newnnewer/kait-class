<?php
/* admin/problem.php — 문제 등록·수정 (+ 테스트케이스) */
declare(strict_types=1);
require_once __DIR__ . '/../guard.php';
require_once __DIR__ . '/../layout.php';
$u = need_admin('../');

$id  = (int)($_GET['id'] ?? 0);
$msg = '';
$err = '';

/* ── 삭제 ─────────────────────────────────────
   수업·평가에 들어 있으면 지울 수 없다 (먼저 그 수업·평가에서 뺀다).
   제출 기록은 문제와 함께 지운다. 남겨 두면 어느 문제의 제출인지 알 수 없어진다. */
if ($id && ($_POST['do'] ?? '') === 'delete') {
  $sets = all("SELECT s.title FROM set_problems sp JOIN sets s ON s.id = sp.set_id
               WHERE sp.problem_id = ?", [$id]);
  if ($sets) {
    $err = '수업·평가에 쓰이고 있어 삭제할 수 없습니다 — '
         . implode(', ', array_column($sets, 'title'))
         . '. 먼저 그 수업·평가에서 뺀 뒤 다시 시도하세요.';
  } else {
    tx(function (PDO $d) use ($id) {
      $d->prepare("DELETE FROM submissions  WHERE problem_id = ?")->execute([$id]);
      $d->prepare("DELETE FROM runs         WHERE problem_id = ?")->execute([$id]);
      $d->prepare("DELETE FROM testcases    WHERE problem_id = ?")->execute([$id]);
      $d->prepare("DELETE FROM problem_tags WHERE problem_id = ?")->execute([$id]);
      $d->prepare("DELETE FROM problems     WHERE id = ?")->execute([$id]);
    });
    header('Location: problems.php'); exit;
  }
}
$subCnt = $id ? (int)col("SELECT COUNT(*) FROM submissions WHERE problem_id = ?", [$id]) : 0;


/* ── 저장 ───────────────────────────────────── */
if (($_POST['do'] ?? '') === 'save') {
  $probNo = (int)($_POST['prob_no'] ?? 0);
  $title  = trim((string)($_POST['title'] ?? ''));
  $desc   = nl_clean($_POST['description'] ?? '');
  $inD    = nl_clean($_POST['input_desc'] ?? '');
  $outD   = nl_clean($_POST['output_desc'] ?? '');
  $showDiff = !empty($_POST['show_diff']) ? 1 : 0;
  $tl     = max(0.2, min(15.0, (float)($_POST['time_limit'] ?? 2.0)));
  $ml     = max(16000, min(512000, (int)($_POST['memory_limit'] ?? 128000)));
  $tagCsv = (string)($_POST['tags'] ?? '');

  if ($title === '')  $err = '제목을 입력하세요.';
  elseif ($probNo <= 0) $err = '문제 번호를 입력하세요.';
  else {
    $dupe = one("SELECT id FROM problems WHERE prob_no = ? AND id <> ?", [$probNo, $id]);
    if ($dupe) $err = '문제 번호 ' . $probNo . ' 는 이미 쓰이고 있습니다.';
  }

  if ($err === '') {
    try {
      $newId = tx(function (PDO $d) use ($id, $probNo, $title, $desc, $inD, $outD, $tl, $ml, $showDiff) {
        if ($id) {
          $d->prepare("UPDATE problems SET prob_no=?, title=?, description=?, input_desc=?,
                       output_desc=?, time_limit=?, memory_limit=?, show_diff=? WHERE id=?")
            ->execute([$probNo, $title, $desc, $inD, $outD, $tl, $ml, $showDiff, $id]);
          $pid = $id;
        } else {
          /* 새 문제는 잠긴 채로 만든다. 테스트케이스까지 갖춘 뒤 목록에서 연다. */
          $d->prepare("INSERT INTO problems(prob_no,title,description,input_desc,output_desc,
                       time_limit,memory_limit,active,show_diff,created_at)
                       VALUES(?,?,?,?,?,?,?,0,?,?)")
            ->execute([$probNo, $title, $desc, $inD, $outD, $tl, $ml, $showDiff, now()]);
          $pid = (int)$d->lastInsertId();
        }
        return $pid;
      });
      sync_tags((int)$newId, $tagCsv);
      /* 새로 만든 문제는 테스트케이스가 없으니 바로 그 화면으로 보낸다 */
      if (!$id) { header('Location: testcases.php?id=' . (int)$newId); exit; }
      header('Location: problem.php?id=' . (int)$newId . '&saved=1'); exit;
    } catch (Throwable $e) {
      $err = '저장하지 못했습니다: ' . $e->getMessage();
    }
  }
}

$warn = [];
if (isset($_GET['saved'])) {
  $warn = (array)($_SESSION['jp_warn'] ?? []);
  unset($_SESSION['jp_warn']);
  $msg = $warn ? array_shift($warn) : '저장했습니다.';
}

/* ── 화면에 채울 값 ─────────────────────────── */
if ($id) {
  $p = one("SELECT * FROM problems WHERE id = ?", [$id]);
  if (!$p) { header('Location: problems.php'); exit; }
  $tcCnt  = (int)col("SELECT COUNT(*) FROM testcases WHERE problem_id = ?", [$id]);
  $tagCsv = implode(', ', tags_of($id));
} else {
  $p = ['prob_no' => next_prob_no(db()), 'title' => '', 'description' => '',
        'input_desc' => '', 'output_desc' => '', 'time_limit' => 2.0, 'memory_limit' => 128000,
        'show_diff' => 1];
  $tcCnt  = 0;
  $tagCsv = '';
}
/* 저장에 실패했으면 사용자가 입력한 값을 그대로 되돌려준다 */
if (($_POST['do'] ?? '') === 'save' && $err !== '') {
  $p = array_merge($p, [
    'prob_no' => (int)($_POST['prob_no'] ?? 0), 'title' => (string)($_POST['title'] ?? ''),
    'description' => (string)($_POST['description'] ?? ''),
    'input_desc' => (string)($_POST['input_desc'] ?? ''),
    'output_desc' => (string)($_POST['output_desc'] ?? ''),
    'time_limit' => (float)($_POST['time_limit'] ?? 2), 'memory_limit' => (int)($_POST['memory_limit'] ?? 128000),
    'show_diff' => !empty($_POST['show_diff']) ? 1 : 0,
  ]);
  $tagCsv = (string)($_POST['tags'] ?? '');
}

page_head(['title' => $id ? '문제 수정' : '새 문제', 'root' => '../', 'user' => $u, 'nav' => 'problems']);
?>
<div class="wrap">

  <div class="phead">
    <h1><?= $id ? '문제 수정' : '새 문제' ?></h1>
    <?php if ($id): ?><span class="sub pno"><?= (int)$p['prob_no'] ?></span><?php endif; ?>
    <div class="grow"></div>
    <a class="btn" href="problems.php">목록</a>
  </div>

  <?php if ($err): ?><div class="note err"><?= h($err) ?></div><?php endif; ?>
  <?php if ($msg): ?><div class="note ok"><?= h($msg) ?></div><?php endif; ?>
  <?php foreach ($warn as $w): ?><div class="note info"><?= h($w) ?></div><?php endforeach; ?>

  <?php if ($id): ?>
    <!-- 삭제는 별도 폼이다. 폼은 겹칠 수 없으므로 밖에 두고 버튼에서 form 속성으로 가리킨다. -->
    <form method="post" id="delform"><input type="hidden" name="do" value="delete"></form>
  <?php endif; ?>

  <form method="post" id="pform">
    <input type="hidden" name="do" value="save">

    <div class="row">
      <div class="field" style="max-width:150px">
        <label for="prob_no">문제 번호</label>
        <input class="code" type="number" id="prob_no" name="prob_no" value="<?= (int)$p['prob_no'] ?>" required>
      </div>
      <div class="field" style="flex:3">
        <label for="title">제목</label>
        <input type="text" id="title" name="title" value="<?= h($p['title']) ?>" required autofocus>
      </div>
    </div>

    <div class="field">
      <label for="description">문제 설명 <span class="hint">마크다운. 코드는 백틱 3개로 감쌉니다.</span></label>
      <div class="mdtools">
        <button class="btn sm" type="button" id="imgBtn">이미지 넣기</button>
        <input type="file" id="imgFile" accept="image/*" hidden>
        <span class="status" id="imgStatus"></span>
      </div>
      <div class="mdedit">
        <div>
          <div class="cap">입력</div>
          <textarea id="description" name="description" rows="16"><?= h($p['description']) ?></textarea>
        </div>
        <div>
          <div class="cap">미리보기</div>
          <div class="mdprev md" id="mdprev"></div>
        </div>
      </div>
    </div>

    <div class="row">
      <div class="field">
        <label for="input_desc">입력 설명</label>
        <textarea id="input_desc" name="input_desc" rows="4"><?= h($p['input_desc']) ?></textarea>
      </div>
      <div class="field">
        <label for="output_desc">출력 설명</label>
        <textarea id="output_desc" name="output_desc" rows="4"><?= h($p['output_desc']) ?></textarea>
      </div>
    </div>

    <div class="row">
      <div class="field" style="max-width:150px">
        <label for="time_limit">시간 제한 <span class="hint">초</span></label>
        <input class="code" type="number" step="0.1" min="0.2" max="15" id="time_limit"
               name="time_limit" value="<?= h(rtrim(rtrim(number_format((float)$p['time_limit'], 1), '0'), '.')) ?>">
      </div>
      <div class="field" style="max-width:170px">
        <label for="memory_limit">메모리 제한 <span class="hint">KB</span></label>
        <input class="code" type="number" step="1000" min="16000" max="512000" id="memory_limit"
               name="memory_limit" value="<?= (int)$p['memory_limit'] ?>">
      </div>
      <div class="field">
        <label for="tags">출처 · 분류 <span class="hint">쉼표로 구분</span></label>
        <input type="text" id="tags" name="tags" value="<?= h($tagCsv) ?>" placeholder="반복문, 정보올림피아드">
      </div>
    </div>

    <div class="field">
      <div class="chips">
        <label class="chip">
          <input type="checkbox" name="show_diff" value="1" <?= (int)($p['show_diff'] ?? 1) ? 'checked' : '' ?>>
          <span>틀렸을 때 어디가 다른지 보여주기</span>
        </label>
      </div>
      <p class="small muted" style="margin:8px 0 0">
        처음 틀린 테스트케이스의 입력·기대 출력·학생 출력을 나란히 보여줍니다.
        변별이 필요한 문제라면 꺼 두세요.
      </p>
    </div>

    <div class="sec">
      <h2>테스트케이스</h2>
      <?php if ($id): ?>
        <p class="desc">테스트케이스는 따로 관리합니다.</p>
        <a class="btn" href="testcases.php?id=<?= $id ?>">
          테스트케이스 <?= $tcCnt ?>개 관리
        </a>
        <?php if ($tcCnt === 0): ?>
          <div class="note info" style="margin-top:14px">
            테스트케이스가 하나도 없으면 이 문제는 채점할 수 없습니다.
          </div>
        <?php endif; ?>
      <?php else: ?>
        <p class="desc">문항을 저장하면 테스트케이스를 등록할 수 있습니다.</p>
      <?php endif; ?>
    </div>

    <div class="actions">
      <button class="btn primary" type="submit">저장</button>
      <a class="btn" href="problems.php">취소</a>
      <div class="grow"></div>
      <?php if ($id): ?>
        <button class="btn danger" type="submit" form="delform"
                onclick="return confirmDelProblem(<?= $subCnt ?>)">문제 삭제</button>
      <?php endif; ?>
    </div>
  </form>

</div>

<script>
/* 삭제는 되돌릴 수 없다. 제출 기록이 함께 사라지는 경우에는 '삭제' 를 직접 치게 한다. */
function confirmDelProblem(subs){
  if (!subs) return confirm('이 문제를 삭제할까요? 되돌릴 수 없습니다.');
  var ans = prompt('이 문제를 삭제합니다.\n\n학생 제출 기록 ' + subs + '건도 함께 사라집니다. '
                 + '되돌릴 수 없습니다.\n계속하려면 아래에 삭제 라고 입력하세요.');
  if (ans === null) return false;
  if (ans.trim() !== '삭제') { alert('삭제하지 않았습니다.'); return false; }
  return true;
}
(function(){
  var apiUrl = window.API;

  /* ── 마크다운 미리보기 (서버 렌더와 동일하게 맞추려고 서버에 물어본다) ── */
  var ta = document.getElementById('description'),
      prev = document.getElementById('mdprev'), timer = null, last = null;

  function render(){
    var src = ta.value;
    if (src === last) return;
    last = src;
    fetch(apiUrl + '?action=preview', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({src: src})
    }).then(function(r){ return r.json(); })
      .then(function(j){ if (j && j.ok) prev.innerHTML = j.html; })
      .catch(function(){});
  }
  ta.addEventListener('input', function(){
    clearTimeout(timer); timer = setTimeout(render, 400);
  });
  render();

  /* ── 이미지 업로드 → 커서 위치에 마크다운 삽입 ── */
  var btn = document.getElementById('imgBtn'),
      file = document.getElementById('imgFile'),
      st = document.getElementById('imgStatus');

  btn.addEventListener('click', function(){ file.click(); });
  file.addEventListener('change', function(){
    if (!file.files.length) return;
    var fd = new FormData();
    fd.append('file', file.files[0]);
    st.textContent = '올리는 중…';
    fetch(apiUrl + '?action=upload_image', {method:'POST', body: fd})
      .then(function(r){ return r.json(); })
      .then(function(j){
        if (!j || !j.ok) { st.textContent = (j && j.error) || '실패했습니다'; return; }
        var snippet = '\n![](' + j.url + ')\n';
        var s = ta.selectionStart, e = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + snippet + ta.value.slice(e);
        ta.selectionStart = ta.selectionEnd = s + snippet.length;
        ta.focus(); st.textContent = '넣었습니다';
        last = null; render();
        setTimeout(function(){ st.textContent = ''; }, 2000);
      })
      .catch(function(){ st.textContent = '실패했습니다'; });
    file.value = '';
  });

})();
</script>
<?php page_foot(); ?>
