<?php
/* login.php — 로그인. 예전에는 index.php 가 이 일을 했지만,
   이제 첫 화면은 소개를 겸하므로 로그인만 따로 뗀다. */
declare(strict_types=1);
require __DIR__ . '/lib.php';
require __DIR__ . '/layout.php';
db();

$err = '';
$next = (string)($_GET['next'] ?? $_POST['next'] ?? '');
/* 열린 리다이렉트 방지: 같은 사이트 안의 경로만 허용 */
if ($next !== '' && !preg_match('#^/[^/\\\\]#', $next)) $next = '';

function after_login(array $u, string $next): string {
  if ($next !== '') return $next;
  return $u['role'] === 'admin' ? 'admin/problems.php' : 'index.php';
}

if ($u = me()) { header('Location: ' . after_login($u, $next)); exit; }

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $loginId = trim((string)($_POST['id'] ?? ''));
  $left = login_locked($loginId);

  if ($left > 0) {
    /* 비밀번호를 계속 찍어보는 것을 막는다. 계정 단위라 다른 학생은 영향이 없다. */
    $err = '로그인 시도가 너무 잦습니다. ' . (int)ceil($left / 60) . '분 뒤에 다시 해 주세요.';
  } else {
    $row = one("SELECT * FROM users WHERE login_id = ?", [$loginId]);
    $okPw = $row && password_verify((string)($_POST['pw'] ?? ''), $row['pw_hash']);
    login_record($loginId, $okPw);

    if ($okPw && (int)$row['approved'] !== 1) {
      /* 가입은 했지만 아직 승인 전. 들여보낸 뒤 아무것도 못 하게 하는 것보다
         이유를 알려 주고 막는 편이 덜 헷갈린다. */
      $err = '아직 승인되지 않은 계정입니다. 관리자가 승인하면 쓸 수 있습니다.';
    } elseif ($okPw) {
      session_regenerate_id(true);
      $_SESSION['uid'] = $row['id'];
      header('Location: ' . after_login($row, $next));
      exit;
    } else {
      $err = '아이디 또는 비밀번호가 맞지 않습니다.';
    }
  }
}

page_head(['title' => '로그인', 'root' => '', 'user' => null, 'nav' => '']);
?>
<div class="wrap loginwrap">
  <form class="logincard" method="post" action="login.php">
    <h1>로그인</h1>
    <input type="hidden" name="next" value="<?= h($next) ?>">

    <div class="field">
      <label for="loginId">아이디</label>
      <input type="text" id="loginId" name="id" autocomplete="username" autocapitalize="off"
             autofocus value="<?= h((string)($_POST['id'] ?? '')) ?>">
    </div>
    <div class="field">
      <label for="loginPw">비밀번호</label>
      <input type="password" id="loginPw" name="pw" autocomplete="current-password">
    </div>

    <?php if ($err): ?><div class="note err"><?= h($err) ?></div><?php endif; ?>

    <button class="btn primary big" type="submit">로그인</button>
    <p class="small muted" style="margin:16px 0 0; text-align:center">
      아이디는 학교에서 받은 것을 씁니다. 비밀번호를 잊었으면 선생님께 말씀하세요.
    </p>
    <?php if (setting('signup_on') === '1'): ?>
      <p class="small" style="margin:10px 0 0; text-align:center">
        학교 밖에서 오셨나요? <a href="signup.php">회원가입</a>
      </p>
    <?php endif; ?>
  </form>
</div>
<?php page_foot(); ?>
