<?php
/* admin/notice.php — 공지 쓰기·고치기 */
declare(strict_types=1);
require_once __DIR__ . '/../guard.php';
require_once __DIR__ . '/../layout.php';
$u = need_admin('../');

$id  = (int)($_GET['id'] ?? 0);
$err = ''; $msg = '';

if (($_POST['do'] ?? '') === 'save') {
  $title  = trim((string)($_POST['title'] ?? ''));
  $body   = nl_clean($_POST['body'] ?? '');
  $pinned = !empty($_POST['pinned']) ? 1 : 0;
  $active = !empty($_POST['active']) ? 1 : 0;

  if ($title === '') $err = '제목을 입력하세요.';
  else {
    try {
      $newId = tx(function (PDO $d) use ($id, $title, $body, $pinned, $active, $u) {
        if ($id) {
          $d->prepare("UPDATE notices SET title=?, body=?, pinned=?, active=?, updated_at=? WHERE id=?")
            ->execute([$title, $body, $pinned, $active, now(), $id]);
          return $id;
        }
        $d->prepare("INSERT INTO notices(title,body,pinned,active,author_id,created_at,updated_at)
                     VALUES(?,?,?,?,?,?,?)")
          ->execute([$title, $body, $pinned, $active, $u['id'], now(), now()]);
        return (int)$d->lastInsertId();
      });
      header('Location: notice.php?id=' . (int)$newId . '&saved=1'); exit;
    } catch (Throwable $e) {
      $err = '저장하지 못했습니다: ' . $e->getMessage();
    }
  }
}

if (isset($_GET['saved'])) $msg = '저장했습니다.';

if ($id) {
  $n = one("SELECT * FROM notices WHERE id = ?", [$id]);
  if (!$n) { header('Location: notices.php'); exit; }
} else {
  $n = ['title' => '', 'body' => '', 'pinned' => 0, 'active' => 1];
}
if (($_POST['do'] ?? '') === 'save' && $err !== '') {
  $n = ['title' => (string)($_POST['title'] ?? ''), 'body' => (string)($_POST['body'] ?? ''),
        'pinned' => !empty($_POST['pinned']) ? 1 : 0, 'active' => !empty($_POST['active']) ? 1 : 0];
}

page_head(['title' => $id ? '공지 수정' : '새 공지', 'root' => '../', 'user' => $u, 'nav' => 'notices']);
?>
<div class="wrap">

  <div class="phead">
    <h1><?= $id ? '공지 수정' : '새 공지' ?></h1>
    <div class="grow"></div>
    <a class="btn" href="notices.php">목록</a>
  </div>

  <?php if ($err): ?><div class="note err"><?= h($err) ?></div><?php endif; ?>
  <?php if ($msg): ?><div class="note ok"><?= h($msg) ?></div><?php endif; ?>

  <?php if ($id): ?>
    <form method="post" id="delform"><input type="hidden" name="do" value="delete"></form>
  <?php endif; ?>

  <form method="post">
    <input type="hidden" name="do" value="save">

    <div class="field">
      <label for="title">제목</label>
      <input type="text" id="title" name="title" value="<?= h($n['title']) ?>" required autofocus>
    </div>

    <div class="field">
      <label for="body">내용 <span class="hint">문제 설명과 같은 마크다운입니다.</span></label>
      <div class="mdtools">
        <button class="btn sm" type="button" id="imgBtn">이미지 넣기</button>
        <input type="file" id="imgFile" accept="image/*" hidden>
        <span class="status" id="imgStatus"></span>
      </div>
      <div class="mdedit">
        <div>
          <div class="cap">입력</div>
          <textarea id="body" name="body" rows="18"><?= h($n['body']) ?></textarea>
        </div>
        <div>
          <div class="cap">미리보기</div>
          <div class="mdprev md" id="mdprev"></div>
        </div>
      </div>
    </div>

    <div class="field">
      <div class="chips">
        <label class="chip"><input type="checkbox" name="active" value="1" <?= (int)$n['active'] ? 'checked' : '' ?>>
          <span>학생에게 공개</span></label>
        <label class="chip"><input type="checkbox" name="pinned" value="1" <?= (int)$n['pinned'] ? 'checked' : '' ?>>
          <span>목록 맨 위에 고정</span></label>
      </div>
    </div>

    <div class="actions">
      <button class="btn primary" type="submit">저장</button>
      <a class="btn" href="notices.php">취소</a>
      <div class="grow"></div>
      <?php if ($id): ?>
        <a class="btn" href="../notice.php?id=<?= $id ?>">보기</a>
      <?php endif; ?>
    </div>
  </form>

</div>

<script>
(function(){
  var apiUrl = window.API;
  var ta = document.getElementById('body'), prev = document.getElementById('mdprev');
  var timer = null, last = null;

  function render(){
    if (ta.value === last) return;
    last = ta.value;
    fetch(apiUrl + '?action=preview', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({src: ta.value})
    }).then(function(r){ return r.json(); })
      .then(function(j){ if (j && j.ok) prev.innerHTML = j.html; })
      .catch(function(){});
  }
  ta.addEventListener('input', function(){ clearTimeout(timer); timer = setTimeout(render, 400); });
  render();

  var btn = document.getElementById('imgBtn'),
      file = document.getElementById('imgFile'),
      st = document.getElementById('imgStatus');
  btn.addEventListener('click', function(){ file.click(); });
  file.addEventListener('change', function(){
    if (!file.files.length) return;
    var fd = new FormData(); fd.append('file', file.files[0]);
    st.textContent = '올리는 중…';
    fetch(apiUrl + '?action=upload_image', {method:'POST', body: fd})
      .then(function(r){ return r.json(); })
      .then(function(j){
        if (!j || !j.ok) { st.textContent = (j && j.error) || '실패했습니다'; return; }
        var snippet = '\n![](' + j.url + ')\n';
        var s = ta.selectionStart, e = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + snippet + ta.value.slice(e);
        ta.selectionStart = ta.selectionEnd = s + snippet.length;
        ta.focus(); st.textContent = '넣었습니다'; last = null; render();
        setTimeout(function(){ st.textContent = ''; }, 2000);
      })
      .catch(function(){ st.textContent = '실패했습니다'; });
    file.value = '';
  });
})();
</script>
<?php page_foot(); ?>
