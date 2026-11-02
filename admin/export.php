<?php
/* admin/export.php — 고른 문제를 FPS XML 파일로 내려받는다 */
declare(strict_types=1);
require_once __DIR__ . '/../guard.php';
require_once __DIR__ . '/../fps.php';
$u = need_admin('../');

$ids = array_values(array_filter(array_map('intval', (array)($_POST['ids'] ?? $_GET['ids'] ?? []))));

/* 번호로 내보내기 (1.17.0) — 문제 모음의 번호 칸. "1001-1010, 1015" 처럼 범위도 된다.
   없는 번호가 섞이면 아무것도 내보내지 않고 문제 모음으로 돌아가 알린다. */
if (isset($_POST['nos'])) {
  $r = resolve_prob_nos((string)$_POST['nos']);
  $back = function (string $err): never {
    $_SESSION['flash'] = ['msg' => '', 'err' => $err];
    header('Location: ../problems.php'); exit;
  };
  if ($r['bad'])   $back('없는 번호가 있어 내보내지 않았습니다: ' . implode(', ', $r['bad']));
  if (!$r['found']) $back('내보낼 문제 번호를 넣으세요. (예: 1001-1010, 1015)');
  $ids = array_map(fn($p) => (int)$p['problem_id'], $r['found']);
}

if (!$ids && !empty($_POST['all'])) {
  $ids = array_map('intval', array_column(all("SELECT id FROM problems ORDER BY prob_no"), 'id'));
}
if (!$ids) { header('Location: ../problems.php'); exit; }

$xml = fps_export($ids);

$name = count($ids) === 1
  ? 'problem-' . (int)col("SELECT prob_no FROM problems WHERE id=?", [$ids[0]]) . '.xml'
  : 'problems-' . date('Ymd') . '-' . count($ids) . '.xml';

while (ob_get_level() > 0) ob_end_clean();
header('Content-Type: application/xml; charset=utf-8');
header('Content-Disposition: attachment; filename="' . $name . '"');
header('Content-Length: ' . strlen($xml));
echo $xml;
