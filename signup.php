<?php
/* ═══════════════════════════════════════════════
   signup.php — 회원가입 (학교 밖에서 온 사람용)

   우리 학교 학생은 이 화면을 쓰지 않는다. 운영 > 회원에서 일괄 등록한다.
   여기로 만든 계정은
     · 반이 없다   → 공개 대상이 '지정한 반'인 수업·평가에는 들어가지 못한다
     · 승인 전이다 → 관리자가 승인해야 로그인된다
   ═══════════════════════════════════════════════ */
declare(strict_types=1);
require __DIR__ . '/lib.php';
require __DIR__ . '/layout.php';
db();

/* 가입을 열어 두지 않았으면 이 화면 자체가 없다 */
if (setting('signup_on') !== '1') { header('Location: login.php'); exit; }
if (me()) { header('Location: index.php'); exit; }

$err  = '';
$done = isset($_GET['done']);

/* 아이디는 영문으로 시작하게 한다.
   학교 학생 아이디가 학번(10101 같은 숫자)이라, 숫자로 시작하는 가입을 허용하면
   아직 등록하지 않은 학번을 외부인이 먼저 차지할 수 있다. */
const SIGNUP_ID_RE = '/^[A-Za-z][A-Za-z0-9_.-]{3,19}$/';

if (!$done && $_SERVER['REQUEST_METHOD'] === 'POST') {
  $id   = trim((string)($_POST['id'] ?? ''));
  $nick = trim((string)($_POST['nick'] ?? ''));
  $pw   = (string)($_POST['pw'] ?? '');
  $pw2  = (string)($_POST['pw2'] ?? '');

  if (!preg_match(SIGNUP_ID_RE, $id)) {
    $err = '아이디는 영문으로 시작하는 4~20자여야 합니다. 영문·숫자·밑줄·점·붙임표만 쓸 수 있습니다.';
  } elseif ($nick === '' || ustrlen($nick) > 20) {
    $err = '닉네임을 20자 이내로 입력하세요.';
  } elseif (ustrlen($pw) < 4) {
    $err = '비밀번호는 4자 이상이어야 합니다.';
  } elseif ($pw !== $pw2) {
    $err = '비밀번호가 서로 다릅니다.';
  } elseif (one("SELECT 1 FROM users WHERE login_id = ?", [$id])) {
    $err = '이미 쓰이고 있는 아이디입니다.';
  } else {
    try {
      db()->prepare("INSERT INTO users(login_id, pw_hash, name, role, group_id, source, approved, created_at)
                     VALUES(?,?,?,'student',NULL,'signup',0,?)")
          ->execute([$id, password_hash($pw, PASSWORD_DEFAULT), $nick, now()]);
      header('Location: signup.php?done=1'); exit;
    } catch (PDOException $e) {
      /* 같은 아이디로 동시에 눌린 경우 — UNIQUE 제약이 잡아 준다 */
      $err = '이미 쓰이고 있는 아이디입니다.';
    }
  }
}

page_head(['title' => '회원가입', 'root' => '', 'user' => null, 'nav' => '']);
?>
<div class="wrap loginwrap">
  <?php if ($done): ?>
    <div class="logincard">
      <h1>가입 신청을 받았습니다</h1>
      <p class="small" style="margin:14px 0 0">
        관리자가 승인하면 로그인할 수 있습니다.
        승인 전에는 아이디와 비밀번호가 맞아도 들어가지지 않습니다.
      </p>
      <p style="margin:20px 0 0"><a class="btn primary big" href="index.php">첫 화면으로</a></p>
    </div>
  <?php else: ?>
    <form class="logincard" method="post" action="signup.php">
      <h1>회원가입</h1>
      <p class="small muted" style="margin:0 0 18px">
        <b>우리 학교 학생은 가입하지 않습니다.</b> 학교에서 받은 아이디로 로그인하세요.<br>
        가입한 계정은 반이 없어서 수업·평가에는 들어갈 수 없고, 문제는 자유롭게 풀 수 있습니다.<br>
        <b>관리자가 승인한 뒤부터 쓸 수 있습니다.</b>
      </p>

      <div class="field">
        <label for="sid">아이디</label>
        <input type="text" id="sid" name="id" autocomplete="username" autocapitalize="off"
               autofocus value="<?= h((string)($_POST['id'] ?? '')) ?>">
        <div class="small muted">영문으로 시작하는 4~20자.</div>
      </div>
      <div class="field">
        <label for="snick">닉네임</label>
        <input type="text" id="snick" name="nick" value="<?= h((string)($_POST['nick'] ?? '')) ?>">
        <div class="small muted">채점 결과 목록에 이 이름이 보입니다. 실명을 쓰지 않아도 됩니다.</div>
      </div>
      <div class="field">
        <label for="spw">비밀번호</label>
        <input type="password" id="spw" name="pw" autocomplete="new-password">
      </div>
      <div class="field">
        <label for="spw2">비밀번호 확인</label>
        <input type="password" id="spw2" name="pw2" autocomplete="new-password">
      </div>

      <?php if ($err): ?><div class="note err"><?= h($err) ?></div><?php endif; ?>

      <button class="btn primary big" type="submit">가입 신청</button>
      <p class="small muted" style="margin:16px 0 0; text-align:center">
        이메일은 받지 않습니다. 비밀번호를 잊으면 관리자에게 문의하세요.
      </p>
    </form>
  <?php endif; ?>
</div>
<?php page_foot(); ?>
