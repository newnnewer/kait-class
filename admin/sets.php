<?php
/* admin/sets.php — 1.17.0 부터는 수업(lessons.php) · 평가(assessments.php) 목록 하나로 합쳤다.
   교사가 목록을 열면 잠그기 · 현황 · 수정 · 기록 · 복사 · 삭제 버튼이 함께 보인다.
   예전 주소 · 즐겨찾기 · 고쳐 쓴 화면의 링크가 깨지지 않게 이 파일은 넘겨 주기만 한다. */
declare(strict_types=1);
require_once __DIR__ . '/../guard.php';
$u = me();
/* 관리자 주소로 들어왔으니 교사 화면으로 보여 준다 */
if (is_admin($u)) $_SESSION['admin_view'] = true;
header('Location: ../' . (($_GET['type'] ?? '') === 'assessment' ? 'assessments.php' : 'lessons.php'));
exit;
