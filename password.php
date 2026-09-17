<?php
/* password.php — 비밀번호 변경 */
declare(strict_types=1);
require __DIR__ . '/guard.php';
require __DIR__ . '/layout.php';
$u = need_login();

$err = ''; $msg = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $cur = (string)($_POST['cur'] ?? '');
  $pw  = (string)($_POST['pw'] ?? '');
  $pw2 = (string)($_POST['pw2'] ?? '');

  $row = one("SELECT pw_hash FROM users WHERE id = ?", [$u['id']]);
  if (!$row || !password_verify($cur, $row['pw_hash'])) {
    $err = '지금 비밀번호가 맞지 않습니다.';
  } elseif (ustrlen($pw) < 4) {
    $err = '새 비밀번호는 4자 이상이어야 합니다.';
  } elseif ($pw !== $pw2) {
    $err = '새 비밀번호와 확인이 서로 다릅니다.';
  } elseif ($pw === $cur) {
    $err = '지금 쓰는 것과 다른 비밀번호를 정하세요.';
  } else {
    db()->prepare("UPDATE users SET pw_hash = ? WHERE id = ?")
        ->execute([password_hash($pw, PASSWORD_DEFAULT), $u['id']]);
    $msg = '비밀번호를 바꿨습니다.';
  }
}

page_head(['title' => '비밀번호 변경', 'root' => '', 'user' => $u, 'nav' => '']);
?>
<div class="wrap loginwrap">
  <div class="logincard">
    <h1>비밀번호 변경</h1>
    <p class="small muted" style="text-align:center; margin:-14px 0 20px">
      <?= h($u['login_id']) ?> 계정
    </p>

    <?php if ($err): ?><div class="note err"><?= h($err) ?></div><?php endif; ?>
    <?php if ($msg): ?><div class="note ok"><?= h($msg) ?></div><?php endif; ?>

    <form method="post">
      <div class="field">
        <label for="cur">지금 비밀번호</label>
        <input type="password" id="cur" name="cur" autocomplete="current-password" autofocus>
      </div>
      <div class="field">
        <label for="pw">새 비밀번호 <span class="hint">4자 이상</span></label>
        <input type="password" id="pw" name="pw" autocomplete="new-password">
      </div>
      <div class="field">
        <label for="pw2">새 비밀번호 확인</label>
        <input type="password" id="pw2" name="pw2" autocomplete="new-password">
      </div>

      <button class="btn primary big" type="submit">바꾸기</button>
    </form>

    <p style="text-align:center; margin:16px 0 0">
      <a class="small" href="index.php">돌아가기</a>
    </p>
  </div>
</div>
<?php page_foot(); ?>
