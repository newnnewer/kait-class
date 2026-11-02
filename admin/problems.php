<?php
/* admin/problems.php — 1.17.0 부터는 문제 모음(problems.php) 하나로 합쳤다.
   교사가 문제 모음을 열면 열기 · 잠그기 · 내보내기 · 수업/평가 만들기 · 삭제 버튼이 함께 보인다.
   예전 주소 · 즐겨찾기 · 고쳐 쓴 화면의 링크가 깨지지 않게 이 파일은 넘겨 주기만 한다. */
declare(strict_types=1);
require_once __DIR__ . '/../guard.php';
$u = me();
/* 관리자 주소로 들어왔으니 교사 화면으로 보여 준다 */
if (is_admin($u)) $_SESSION['admin_view'] = true;
$qs = (string)($_SERVER['QUERY_STRING'] ?? '');
header('Location: ../problems.php' . ($qs !== '' ? '?' . $qs : ''));
exit;
