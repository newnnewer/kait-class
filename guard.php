<?php
/* guard.php — 페이지 맨 위에서 로그인·권한을 확인하고, 아니면 되돌려 보낸다.
   $root 은 문서 루트까지의 상대 경로. 루트 파일은 '', admin/ 안은 '../'. */
require_once __DIR__ . '/lib.php';
db();

/* 관리자 화면 / 학생 화면 전환.
   전에는 파일이 admin/ 안에 있는지로 판단해서, 루트에 있는 화면
   (첫 화면·출처분류·채점결과)으로 가면 학생 메뉴로 돌아가 버렸다.
   이제는 선택을 세션에 기억한다. 권한과는 무관하다.
   1.17.0 부터 문제 모음 · 수업 · 평가 · 공지사항은 교사와 학생이 같은 화면을 쓰고,
   이 선택은 그 화면에 교사용 버튼 · 정보를 보여 줄지를 정한다 (teacher_view()). */
if (isset($_GET['view'])) {
  $_SESSION['admin_view'] = ($_GET['view'] === 'admin');
}

function need_login(string $root = ''): array {
  $u = me();
  if (!$u) {
    $next = rawurlencode($_SERVER['REQUEST_URI'] ?? '');
    header('Location: ' . $root . 'login.php?next=' . $next);
    exit;
  }
  return $u;
}

function need_admin(string $root = ''): array {
  $u = need_login($root);
  if ($u['role'] !== 'admin') { header('Location: ' . $root . 'index.php'); exit; }
  return $u;
}
