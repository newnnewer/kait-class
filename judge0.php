<?php
/* ═══════════════════════════════════════════════
   judge0.php — Judge0 와 이야기하는 부분만 모아둔 파일.

   Judge0 는 "코드를 안전하게 실행하고 결과를 돌려주는" 일만 한다.
   맞았는지 틀렸는지 판정하는 것은 우리 쪽(judge-worker.php)의 몫이다.
   ═══════════════════════════════════════════════ */

/* Judge0 CE 의 기본 배치 상한. 이보다 많으면 나눠 보낸다. */
const J0_BATCH = 20;

/* 잠깐 바쁜 것과 진짜 실패를 구분한다.
   대기열이 꽉 찼다(503)는 것은 잘못된 제출이 아니라 "지금은 못 받는다"는 뜻이므로,
   실패로 처리해 버리면 학생이 낸 답이 사라진다. 되돌렸다 다시 보내야 한다. */
class Judge0Busy extends RuntimeException {}

/* 다시 시도하면 될 응답인지 */
function j0_retryable(int $http): bool {
  return $http === 0 || in_array($http, [429, 500, 502, 503, 504], true);
}

/* Judge0 상태 코드 */
const J0_QUEUE = 1, J0_PROCESSING = 2, J0_ACCEPTED = 3, J0_WRONG = 4,
      J0_TLE = 5, J0_CE = 6, J0_RE_FIRST = 7, J0_RE_LAST = 12,
      J0_INTERNAL = 13, J0_EXEC_FORMAT = 14;

function j0_request(string $method, string $path, ?array $payload = null): array {
  $ch = curl_init(JUDGE0_URL . $path);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_TIMEOUT        => 30,
  ]);
  if ($payload !== null) {
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
  }
  $body = curl_exec($ch);
  $err  = curl_error($ch);
  $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);

  if ($body === false) return ['ok' => false, 'http' => 0, 'data' => null, 'error' => $err];
  $data = json_decode($body, true);
  if ($data === null) {
    return ['ok' => false, 'http' => $http, 'data' => null,
            'error' => '응답 해석 실패: ' . substr((string)$body, 0, 200)];
  }
  return ['ok' => $http >= 200 && $http < 300, 'http' => $http, 'data' => $data, 'error' => ''];
}

/* 테스트케이스마다 하나씩, 코드를 Judge0 에 넘긴다.
   기대 출력은 보내지 않는다 — 비교는 우리가 직접 해야
   "줄 끝 공백 무시" 같은 우리 규칙을 적용할 수 있다.
   @return string[] 토큰 목록 (순서는 $cases 와 같다)
   @throws RuntimeException */
function j0_submit(string $sourceCode, string $langKey, array $cases,
                   float $cpuLimit, int $memLimit): array {
  $L = langs()[$langKey] ?? null;
  if ($L === null) {
    /* 방금 켠 언어일 수 있으므로 목록을 다시 읽어 본 뒤에 판단한다 */
    $L = langs(false)[$langKey] ?? null;
    if ($L === null || (int)($L['active'] ?? 0) === 0) {
      throw new RuntimeException('지원하지 않는 언어: ' . $langKey);
    }
  }
  $langId = (int)$L['id'];

  $tokens = [];
  foreach (array_chunk($cases, J0_BATCH) as $chunk) {
    $subs = [];
    foreach ($chunk as $c) {
      $subs[] = [
        'language_id'     => $langId,
        'source_code'     => base64_encode($sourceCode),
        'stdin'           => base64_encode((string)$c['input']),
        'cpu_time_limit'  => $cpuLimit,
        'wall_time_limit' => min(20.0, $cpuLimit + 3.0),  /* 입력 대기로 멈추는 경우 대비 */
        'memory_limit'    => $memLimit,
      ];
      if (($L['opts'] ?? '') !== '') {
        $subs[count($subs) - 1]['compiler_options'] = $L['opts'];
      }
    }
    $r = j0_request('POST', '/submissions/batch?base64_encoded=true', ['submissions' => $subs]);
    if (!$r['ok'] || !is_array($r['data'])) {
      $why = $r['error'] ?: 'HTTP ' . $r['http'];
      if (j0_retryable($r['http'])) throw new Judge0Busy($why);
      throw new RuntimeException('제출 실패: ' . $why);
    }
    foreach ($r['data'] as $one) {
      if (empty($one['token'])) {
        throw new RuntimeException('토큰을 받지 못했습니다: ' . json_encode($one, JSON_UNESCAPED_UNICODE));
      }
      $tokens[] = $one['token'];
    }
  }
  if (count($tokens) !== count($cases)) {
    throw new RuntimeException('토큰 개수가 테스트케이스와 다릅니다');
  }
  return $tokens;
}

/* 토큰으로 결과를 가져온다. 아직 채점 중인 것도 그대로 돌려준다.
   @return array[] $tokens 와 같은 순서
   @throws RuntimeException */
function j0_fetch(array $tokens): array {
  $fields = 'token,status_id,stdout,stderr,compile_output,message,time,memory';
  $out = [];
  foreach (array_chunk($tokens, J0_BATCH) as $chunk) {
    $r = j0_request('GET', '/submissions/batch?base64_encoded=true&tokens='
                            . implode(',', $chunk) . '&fields=' . $fields);
    if (!$r['ok'] || !isset($r['data']['submissions'])) {
      $why = $r['error'] ?: 'HTTP ' . $r['http'];
      if (j0_retryable($r['http'])) throw new Judge0Busy($why);
      throw new RuntimeException('결과 조회 실패: ' . $why);
    }
    foreach ($r['data']['submissions'] as $s) $out[] = $s;
  }
  return $out;
}

/* Judge0 가 돌려준 base64 필드를 문자열로 */
function j0_text($v): string {
  return $v === null || $v === '' ? '' : (string)base64_decode((string)$v, true);
}

/* 아직 결과가 안 나온 상태인지 */
function j0_pending(array $s): bool {
  $st = (int)($s['status_id'] ?? 0);
  return $st === J0_QUEUE || $st === J0_PROCESSING || $st === 0;
}
