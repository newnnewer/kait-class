<?php
/* ═══════════════════════════════════════════════
   test.php — 학생 화면이 아직 없을 때 채점을 시험해 보는 도구 (CLI 전용)

   쓰는 법:
     php test.php 1001 py sol.py      제출하고 결과가 나올 때까지 기다린다
     php test.php --queue             대기열 상태를 본다
     php test.php --last 10           최근 제출 10건
   ═══════════════════════════════════════════════ */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/lib.php';

$argv0 = $argv[1] ?? '';

/* ── 대기열 상태 ── */
if ($argv0 === '--queue') {
  foreach (all("SELECT state, COUNT(*) n FROM submissions GROUP BY state") as $r) {
    printf("%-9s %d\n", $r['state'], $r['n']);
  }
  exit;
}

/* ── 최근 제출 ── */
if ($argv0 === '--last') {
  $n = max(1, (int)($argv[2] ?? 10));
  $rows = all("SELECT s.id, p.prob_no, u.login_id, s.lang, s.state, s.verdict,
                      s.passed_count, s.total_count, s.max_time, s.created_at
               FROM submissions s
               JOIN problems p ON p.id = s.problem_id
               JOIN users u ON u.id = s.user_id
               ORDER BY s.id DESC LIMIT $n");
  printf("%-5s %-6s %-10s %-4s %-9s %-5s %-8s %-7s %s\n",
         'ID','문제','사용자','언어','상태','판정','통과','시간','제출시각');
  foreach ($rows as $r) {
    printf("%-5d %-6d %-10s %-4s %-9s %-5s %-8s %-7s %s\n",
      $r['id'], $r['prob_no'], $r['login_id'], $r['lang'], $r['state'],
      $r['verdict'] ?? '-',
      ($r['passed_count'] ?? '-') . '/' . ($r['total_count'] ?? '-'),
      $r['max_time'] !== null ? number_format((float)$r['max_time'], 3) : '-',
      $r['created_at']);
  }
  exit;
}

/* ── 제출 ── */
$probNo = (int)($argv[1] ?? 0);
$lang   = (string)($argv[2] ?? '');
$file   = (string)($argv[3] ?? '');

if (!$probNo || !isset(langs()[$lang]) || $file === '') {
  fwrite(STDERR, "사용법: php test.php <문제번호> <py|c> <소스파일>\n"
               . "        php test.php --queue\n"
               . "        php test.php --last [건수]\n");
  exit(1);
}
if (!is_readable($file)) { fwrite(STDERR, "파일을 읽을 수 없습니다: $file\n"); exit(1); }

$p = one("SELECT id, title FROM problems WHERE prob_no=?", [$probNo]);
if (!$p) { fwrite(STDERR, "문제 {$probNo} 번이 없습니다\n"); exit(1); }

$tc = (int)col("SELECT COUNT(*) FROM testcases WHERE problem_id=?", [$p['id']]);
if (!$tc) { fwrite(STDERR, "문제 {$probNo} 번에 테스트케이스가 없습니다\n"); exit(1); }

$u = one("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1");
$src = (string)file_get_contents($file);

db()->prepare("INSERT INTO submissions(user_id,problem_id,set_id,lang,source_code,source_hash,
               state,created_at,queued_at) VALUES(?,?,NULL,?,?,?, 'pending', ?,?)")
    ->execute([$u['id'], $p['id'], $lang, $src, source_hash($src), now(), now()]);
$sid = (int)db()->lastInsertId();

echo "제출 #{$sid} — {$probNo} {$p['title']} / {$lang} / 테스트케이스 {$tc}개\n";
echo "결과 기다리는 중";

for ($i = 0; $i < 120; $i++) {
  usleep(500000);
  echo '.';
  $r = one("SELECT state, verdict, passed_count, total_count, max_time, max_memory,
                   compile_msg, fail_seq FROM submissions WHERE id=?", [$sid]);
  if ($r['state'] === 'done' || $r['state'] === 'error') {
    echo "\n\n";
    echo "판정      : {$r['verdict']} (" . (VERDICT_NAME[$r['verdict']] ?? '') . ")\n";
    echo "통과      : {$r['passed_count']} / {$r['total_count']}\n";
    if ($r['fail_seq']) echo "실패 케이스: #{$r['fail_seq']}\n";
    echo "시간      : " . number_format((float)$r['max_time'], 3) . " 초\n";
    echo "메모리    : {$r['max_memory']} KB\n";
    if (trim((string)$r['compile_msg']) !== '') {
      echo "메시지    :\n" . rtrim((string)$r['compile_msg']) . "\n";
    }
    exit($r['verdict'] === 'AC' ? 0 : 2);
  }
}
echo "\n시간이 너무 걸립니다. 워커가 돌고 있는지 확인하세요: systemctl status judge-worker\n";
exit(1);
