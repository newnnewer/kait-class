<?php
/* admin/notices.php — 1.17.0 부터는 공지사항(notices.php) 하나로 합쳤다.
   교사가 공지사항을 열면 비공개 공지까지 보이고 공개 · 고정 · 수정 · 삭제 버튼이 함께 보인다.
   예전 주소 · 즐겨찾기 · 고쳐 쓴 화면의 링크가 깨지지 않게 이 파일은 넘겨 주기만 한다. */
declare(strict_types=1);
require_once __DIR__ . '/../guard.php';
$u = me();
/* 관리자 주소로 들어왔으니 교사 화면으로 보여 준다 */
if (is_admin($u)) $_SESSION['admin_view'] = true;
$qs = (string)($_SERVER['QUERY_STRING'] ?? '');
header('Location: ../notices.php' . ($qs !== '' ? '?' . $qs : ''));
exit;
