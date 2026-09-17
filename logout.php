<?php
/* logout.php — 로그아웃하고 첫 화면으로 보낸다. */
declare(strict_types=1);
require_once __DIR__ . '/lib.php';

$_SESSION = [];

/* 세션 쿠키도 함께 지운다. 이것을 빼면 세션 자료만 비고 쿠키가 남아
   브라우저가 계속 같은 세션 번호를 들고 다닌다. */
if (ini_get('session.use_cookies')) {
  $p = session_get_cookie_params();
  setcookie(session_name(), '', [
    'expires'  => time() - 42000,
    'path'     => $p['path'],
    'domain'   => $p['domain'],
    'secure'   => $p['secure'],
    'httponly' => $p['httponly'],
    'samesite' => $p['samesite'] ?? 'Lax',
  ]);
}

session_destroy();

header('Location: index.php');
exit;
