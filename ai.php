<?php
/* ═══════════════════════════════════════════════
   ai.php — 교사용 AI 도우미의 JSON 엔드포인트 (1.8.0)
     chat        질문 하나에 답한다 (도구를 여러 번 쓸 수 있다)
     create_set  초안 카드의 [생성] — 서버가 다시 검사하고 잠긴 채 만든다
     test        운영 › 설정의 '연결 테스트'
   로직은 ai_lib.php 에 있다.
   ═══════════════════════════════════════════════ */
declare(strict_types=1);
require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/layout.php';   /* site_name() */
require_once __DIR__ . '/ai_lib.php';

ob_start();
set_exception_handler(function (Throwable $e) {
  error_log('[ai] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
  while (ob_get_level() > 0) ob_end_clean();
  if (!headers_sent()) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
  }
  echo json_encode(['ok' => false, 'error' => '처리 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.'], JSON_UNESCAPED_UNICODE);
});

db();
$u = require_admin();

/* 다른 사이트가 숨은 폼으로 이 주소를 부르지 못하게 한다.
   폼은 Content-Type 을 application/json 으로 보낼 수 없다. */
if ($_SERVER['REQUEST_METHOD'] !== 'POST'
    || !str_starts_with(strtolower((string)($_SERVER['CONTENT_TYPE'] ?? '')), 'application/json')) {
  jerr('잘못된 요청입니다.', 400);
}

$action = (string)($_GET['action'] ?? '');
$in = body();

/* 대화 하나가 도구를 여러 번 부르면 PHP 기본 30초를 넘을 수 있다 */
@set_time_limit(AI_TIME_BUDGET + 20);
/* 세션 잠금을 풀어 둔다. 답을 기다리는 동안 같은 선생님의 다른 화면이 멈추지 않게 */
if (session_status() === PHP_SESSION_ACTIVE) session_write_close();

try {
  switch ($action) {

    case 'chat': {
      if (!ai_enabled()) jerr(DEMO_MODE ? DEMO_BLOCKED : 'AI 도우미가 꺼져 있습니다. 운영 › 설정에서 켜세요.', 403);
      if (ai_over_limit()) jerr('이번 달 사용 한도(' . number_format(ai_limit_krw()) . '원)에 이르렀습니다. 운영 › 설정에서 한도를 바꿀 수 있습니다.', 429);
      $hist = is_array($in['history'] ?? null) ? $in['history'] : [];
      $page = is_array($in['page'] ?? null) ? $in['page'] : [];
      $page = ['path' => mb_substr((string)($page['path'] ?? ''), 0, 300),
               'title' => mb_substr((string)($page['title'] ?? ''), 0, 200)];
      jout(['ok' => true] + ai_chat($hist, $page));
    }

    case 'create_set': {
      if (!ai_enabled()) jerr('AI 도우미가 꺼져 있습니다.', 403);
      $draft = is_array($in['draft'] ?? null) ? $in['draft'] : [];
      $id = ai_create_set($draft);
      $type = (string)col("SELECT set_type FROM sets WHERE id = ?", [$id]);
      jout(['ok' => true, 'id' => $id, 'type' => SET_TYPE_NAME[$type] ?? '',
            'url' => 'admin/set.php?id=' . $id]);
    }

    case 'test': {
      if (DEMO_MODE) jerr(DEMO_BLOCKED, 403);
      /* 입력란에 새로 쓴 키가 있으면 그것으로, 없으면 저장된 키로 */
      $key = trim((string)($in['key'] ?? '')) ?: ai_key();
      $model = (string)($in['model'] ?? '');
      if (!isset(AI_MODELS[$model])) $model = ai_model();
      if ($key === '') jerr('API 키를 입력하세요.');
      $r = ai_test($key, $model);
      jout(['ok' => true, 'msg' => '연결되었습니다 (' . $r['model'] . ').']);
    }

    default:
      jerr('알 수 없는 요청입니다.', 404);
  }
} catch (AiError $e) {
  jerr($e->getMessage(), 502);
}
