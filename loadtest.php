<?php
/* ═══════════════════════════════════════════════
   loadtest.php — 동시 접속 부하 시험 (CLI 전용)

   실제 브라우저가 하는 것과 같은 순서로 HTTP 요청을 보낸다.
     제출(POST api.php?action=submit) → 결과 조회(GET …&action=poll) 반복

   웹 계층(nginx·PHP-FPM·SQLite 쓰기)과 채점 계층(워커·Judge0)을
   함께 지나가므로, 어디가 먼저 막히는지 볼 수 있다.

   쓰는 법 — 반드시 웹과 같은 계정으로 돌린다:
     sudo -u www-data php loadtest.php --setup --users=100
     sudo -u www-data php loadtest.php --run --users=100 --problem=1024 --rounds=1
     sudo -u www-data php loadtest.php --cleanup

   시험용 계정은 loadtest0001 … 형태로 만들어지고 cleanup 으로 모두 지운다.
   ═══════════════════════════════════════════════ */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/lib.php';

/* ── 옵션 ─────────────────────────────────────── */
$opt = getopt('', ['setup', 'run', 'cleanup', 'users::', 'problem::', 'rounds::',
                   'lang::', 'base::', 'session-path::', 'help']);
if (isset($opt['help']) || (!isset($opt['setup']) && !isset($opt['run']) && !isset($opt['cleanup']))) {
  fwrite(STDERR, <<<TXT
사용법:
  --setup   --users=100                    시험용 계정과 세션을 만든다
  --run     --users=100 --problem=1024     동시에 제출시킨다
            --rounds=1 --lang=py
  --cleanup                                시험용 계정과 제출 기록을 지운다

  --base=http://127.0.0.1                  요청 보낼 주소 (기본값)
  --session-path=/var/lib/php/sessions     PHP 세션 폴더

TXT);
  exit(1);
}

$N       = max(1, (int)($opt['users']   ?? 30));
$rounds  = max(1, (int)($opt['rounds']  ?? 1));
$probNo  = (int)($opt['problem'] ?? 0);
$lang    = (string)($opt['lang'] ?? 'py');
$base    = rtrim((string)($opt['base'] ?? 'http://127.0.0.1'), '/');
$sessDir = (string)($opt['session-path'] ?? '/var/lib/php/sessions');
$mapFile = '/tmp/loadtest-sessions.json';

const PREFIX = 'loadtest';

function say(string $s): void { fwrite(STDOUT, $s . "\n"); }

/* ─────────────────────────────────────────────────
   준비 — 계정과 세션 만들기
   로그인 화면을 거치지 않고 세션 파일을 직접 쓴다.
   PHP-FPM 이 읽는 폴더에 같은 형식으로 넣으면 로그인한 것과 같다.
   ───────────────────────────────────────────────── */
if (isset($opt['setup'])) {
  if (!is_dir($sessDir) || !is_writable($sessDir)) {
    fwrite(STDERR, "세션 폴더에 쓸 수 없습니다: $sessDir\n"
                 . "www-data 계정으로 실행했는지 확인하세요:\n"
                 . "  sudo -u www-data php loadtest.php --setup --users=$N\n");
    exit(1);
  }

  $pw = password_hash(bin2hex(random_bytes(8)), PASSWORD_DEFAULT);
  $map = [];

  tx(function (PDO $d) use ($N, $pw) {
    $ins = $d->prepare("INSERT OR IGNORE INTO users(login_id,pw_hash,name,role,created_at)
                        VALUES(?,?,?,'student',?)");
    for ($i = 1; $i <= $N; $i++) {
      $id = sprintf('%s%04d', PREFIX, $i);
      $ins->execute([$id, $pw, '부하시험' . $i, now()]);
    }
  });

  for ($i = 1; $i <= $N; $i++) {
    $loginId = sprintf('%s%04d', PREFIX, $i);
    $uid = (int)col("SELECT id FROM users WHERE login_id=?", [$loginId]);
    $sid = bin2hex(random_bytes(16));
    /* PHP 세션 파일 형식: key|타입:값; */
    $payload = 'uid|i:' . $uid . ';';
    file_put_contents($sessDir . '/sess_' . $sid, $payload);
    @chmod($sessDir . '/sess_' . $sid, 0600);
    $map[$loginId] = ['uid' => $uid, 'sid' => $sid];
  }
  file_put_contents($mapFile, json_encode($map));
  say("계정 {$N}개와 세션을 만들었습니다. (" . $mapFile . ")");
  exit;
}

/* ─────────────────────────────────────────────────
   정리
   ───────────────────────────────────────────────── */
if (isset($opt['cleanup'])) {
  $ids = array_column(all("SELECT id FROM users WHERE login_id LIKE ?", [PREFIX . '%']), 'id');
  if ($ids) {
    $in = implode(',', array_map('intval', $ids));
    $subs = (int)col("SELECT COUNT(*) FROM submissions WHERE user_id IN ($in)");
    db()->exec("DELETE FROM submissions WHERE user_id IN ($in)");
    db()->exec("DELETE FROM users WHERE id IN ($in)");
    say("계정 " . count($ids) . "개, 제출 {$subs}건을 지웠습니다.");
  } else {
    say("지울 시험 계정이 없습니다.");
  }
  if (is_file($mapFile)) {
    foreach (json_decode((string)file_get_contents($mapFile), true) ?: [] as $v) {
      @unlink($sessDir . '/sess_' . $v['sid']);
    }
    @unlink($mapFile);
  }
  db()->exec("VACUUM");
  say("정리했습니다.");
  exit;
}

/* ─────────────────────────────────────────────────
   실행
   ───────────────────────────────────────────────── */
if (!is_file($mapFile)) { fwrite(STDERR, "먼저 --setup 을 실행하세요\n"); exit(1); }
$map = json_decode((string)file_get_contents($mapFile), true);
$users = array_slice(array_values($map), 0, $N);
if (count($users) < $N) { fwrite(STDERR, "세션이 부족합니다. --setup --users=$N 을 다시 실행하세요\n"); exit(1); }

$p = $probNo ? one("SELECT id, title FROM problems WHERE prob_no=?", [$probNo])
             : one("SELECT p.id, p.title FROM problems p
                    WHERE (SELECT COUNT(*) FROM testcases t WHERE t.problem_id=p.id) > 0
                    ORDER BY p.prob_no LIMIT 1");
if (!$p) { fwrite(STDERR, "테스트케이스가 있는 문제를 찾지 못했습니다\n"); exit(1); }
$pid   = (int)$p['id'];
$tcCnt = (int)col("SELECT COUNT(*) FROM testcases WHERE problem_id=?", [$pid]);

/* 학생마다 조금씩 다른 코드를 보낸다 — 캐시 효과를 피하려고 */
function make_source(string $lang, int $i): string {
  if ($lang === 'c') {
    return "#include <stdio.h>\n/* run {$i} */\nint main(){int a,b;"
         . "if(scanf(\"%d %d\",&a,&b)==2)printf(\"%d\",a+b);return 0;}\n";
  }
  return "# run {$i}\nimport sys\nd=sys.stdin.read().split()\n"
       . "print(sum(int(x) for x in d) if d else 0)\n";
}

say(str_repeat('─', 62));
say("문제      : {$probNo} {$p['title']} (테스트케이스 {$tcCnt}개)");
say("동시 사용자: {$N}명 · 회차 {$rounds} · 언어 {$lang}");
say("주소      : {$base}");
say(str_repeat('─', 62));

$queueStart = (int)col("SELECT COUNT(*) FROM submissions WHERE state IN ('pending','judging')");
if ($queueStart > 0) say("주의: 대기열에 이미 {$queueStart}건이 남아 있습니다.");

$allSubmitTimes = [];
$submitted = [];
$errors = [];

for ($r = 1; $r <= $rounds; $r++) {
  if ($r > 1) {
    say("");
    say("제출 간격 제한(" . SUBMIT_COOLDOWN . "초)을 기다립니다…");
    sleep(SUBMIT_COOLDOWN + 1);
  }

  $mh = curl_multi_init();
  $handles = [];
  $t0 = microtime(true);

  foreach ($users as $i => $u) {
    $body = json_encode([
      'problem_id' => $pid, 'set_id' => null, 'lang' => $lang,
      'source' => make_source($lang, $r * 1000 + $i),
      'keystrokes' => 120 + $i, 'edit_ms' => 60000 + $i * 37,
    ]);
    $ch = curl_init($base . '/api.php?action=submit');
    curl_setopt_array($ch, [
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_POST           => true,
      CURLOPT_POSTFIELDS     => $body,
      CURLOPT_HTTPHEADER     => ['Content-Type: application/json',
                                 'Cookie: PHPSESSID=' . $u['sid']],
      CURLOPT_TIMEOUT        => 60,
    ]);
    curl_multi_add_handle($mh, $ch);
    $handles[] = $ch;
  }

  /* 전부 동시에 출발시킨다 */
  do {
    $status = curl_multi_exec($mh, $running);
    if ($running) curl_multi_select($mh, 0.05);
  } while ($running && $status === CURLM_OK);

  $okCnt = 0;
  foreach ($handles as $ch) {
    $body = curl_multi_getcontent($ch);
    $ms   = curl_getinfo($ch, CURLINFO_TOTAL_TIME) * 1000;
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $allSubmitTimes[] = $ms;
    $j = json_decode((string)$body, true);
    if ($code === 200 && !empty($j['ok']) && !empty($j['id'])) {
      $submitted[] = (int)$j['id']; $okCnt++;
    } else {
      $errors[] = 'HTTP ' . $code . ' ' . substr((string)$body, 0, 120);
    }
    curl_multi_remove_handle($mh, $ch);
    curl_close($ch);
  }
  curl_multi_close($mh);

  $burst = microtime(true) - $t0;
  say(sprintf("%d회차 · 접수 %d/%d · 전부 접수까지 %.2f초", $r, $okCnt, $N, $burst));
}

/* ── 접수 응답 시간 ── */
sort($allSubmitTimes);
$pick = fn(float $q) => $allSubmitTimes[min(count($allSubmitTimes) - 1,
                                            (int)floor(count($allSubmitTimes) * $q))];
say("");
say("[접수 응답 시간]  중앙값 " . sprintf('%.0f', $pick(0.5)) . "ms"
  . " · 상위 5% " . sprintf('%.0f', $pick(0.95)) . "ms"
  . " · 최대 " . sprintf('%.0f', end($allSubmitTimes)) . "ms");

if ($errors) {
  say("");
  say("[접수 실패 " . count($errors) . "건]");
  foreach (array_slice(array_count_values($errors), 0, 5, true) as $msg => $cnt) {
    say("  ({$cnt}회) " . $msg);
  }
}

if (!$submitted) { say("접수된 제출이 없어 여기서 멈춥니다."); exit(1); }

/* ── 채점이 끝날 때까지 기다리며 처리 속도를 잰다 ── */
say("");
say("채점을 기다립니다…");
$in = implode(',', $submitted);
$judgeStart = microtime(true);
$lastDone = 0;

while (true) {
  $done = (int)col("SELECT COUNT(*) FROM submissions
                    WHERE id IN ($in) AND state IN ('done','error')");
  $el = microtime(true) - $judgeStart;
  if ($done !== $lastDone) {
    printf("\r  %d / %d 완료  (%.1f초, 초당 %.1f건)   ", $done, count($submitted), $el,
           $el > 0 ? $done / $el : 0);
    $lastDone = $done;
  }
  if ($done >= count($submitted)) break;
  if ($el > 600) { say("\n10분이 지나 중단합니다."); break; }
  usleep(400000);
}
$judgeTime = microtime(true) - $judgeStart;
say("");

/* ── 결과 ── */
$rows = all("SELECT verdict, COUNT(*) n FROM submissions WHERE id IN ($in) GROUP BY verdict");
$stat = one("SELECT AVG(max_time) avg_t, MAX(max_time) max_t, MAX(max_memory) max_m
             FROM submissions WHERE id IN ($in)");

say(str_repeat('─', 62));
say(sprintf("채점 %d건 · %.1f초 · 초당 %.1f건 · 케이스 실행 %d회",
            count($submitted), $judgeTime,
            $judgeTime > 0 ? count($submitted) / $judgeTime : 0,
            count($submitted) * $tcCnt));
$parts = [];
foreach ($rows as $r2) $parts[] = ($r2['verdict'] ?? 'null') . ' ' . $r2['n'];
say("판정: " . implode(' · ', $parts));
say(sprintf("실행 시간 평균 %.3f초 · 최대 %.3f초 · 메모리 최대 %s KB",
            (float)$stat['avg_t'], (float)$stat['max_t'], number_format((int)$stat['max_m'])));
say(str_repeat('─', 62));
say("");
say("끝나면 정리하세요:  sudo -u www-data php loadtest.php --cleanup");
