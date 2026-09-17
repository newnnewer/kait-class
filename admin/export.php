<?php
/* admin/export.php — 고른 문제를 FPS XML 파일로 내려받는다 */
declare(strict_types=1);
require_once __DIR__ . '/../guard.php';
require_once __DIR__ . '/../fps.php';
$u = need_admin('../');

$ids = array_values(array_filter(array_map('intval', (array)($_POST['ids'] ?? $_GET['ids'] ?? []))));
if (!$ids && !empty($_POST['all'])) {
  $ids = array_map('intval', array_column(all("SELECT id FROM problems ORDER BY prob_no"), 'id'));
}
if (!$ids) { header('Location: problems.php'); exit; }

$xml = fps_export($ids);

$name = count($ids) === 1
  ? 'problem-' . (int)col("SELECT prob_no FROM problems WHERE id=?", [$ids[0]]) . '.xml'
  : 'problems-' . date('Ymd') . '-' . count($ids) . '.xml';

while (ob_get_level() > 0) ob_end_clean();
header('Content-Type: application/xml; charset=utf-8');
header('Content-Disposition: attachment; filename="' . $name . '"');
header('Content-Length: ' . strlen($xml));
echo $xml;
