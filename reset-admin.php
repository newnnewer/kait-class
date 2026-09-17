<?php
/* ═══════════════════════════════════════════════
   reset-admin.php — 최초 관리자 비밀번호 되돌리기 (터미널 전용)

   관리자 비밀번호를 잊었을 때 쓴다. 웹 화면에서는 쓸 수 없고,
   서버에 접속할 수 있는 사람만 실행할 수 있다.

       sudo -u www-data php reset-admin.php
       sudo -u www-data php reset-admin.php --id=admin2

   ★ www-data 로 실행해야 한다. root 로 돌리면 DB 파일 소유권이 어긋나
     웹에서 쓰기가 막힌다.
   ═══════════════════════════════════════════════ */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

require_once __DIR__ . '/lib.php';

/* 어느 계정인가 — 기본은 최초 관리자(id=1) */
$wantId = null;
foreach ($argv as $a) {
  if (str_starts_with($a, '--id=')) $wantId = substr($a, 5);
}

$u = $wantId === null
   ? one("SELECT id, login_id, name, role FROM users WHERE id = 1")
   : one("SELECT id, login_id, name, role FROM users WHERE login_id = ?", [$wantId]);

if (!$u) {
  fwrite(STDERR, $wantId === null
    ? "최초 관리자 계정을 찾지 못했습니다.\n"
    : "[$wantId] 계정이 없습니다.\n");
  exit(1);
}

echo "계정: {$u['login_id']} ({$u['name']}, {$u['role']})\n";

/* 비밀번호는 화면에 보이지 않게 받는다 */
function ask_hidden(string $prompt): string {
  echo $prompt;
  if (function_exists('shell_exec') && stripos(PHP_OS, 'WIN') === false) {
    @shell_exec('stty -echo 2>/dev/null');
    $v = rtrim((string)fgets(STDIN), "\r\n");
    @shell_exec('stty echo 2>/dev/null');
    echo "\n";
    return $v;
  }
  return rtrim((string)fgets(STDIN), "\r\n");
}

$pw1 = ask_hidden('새 비밀번호 (4자 이상): ');
if (ustrlen($pw1) < 4) { fwrite(STDERR, "너무 짧습니다.\n"); exit(1); }
$pw2 = ask_hidden('한 번 더: ');
if ($pw1 !== $pw2)      { fwrite(STDERR, "두 번 입력한 값이 다릅니다.\n"); exit(1); }

db()->prepare("UPDATE users SET pw_hash = ?, role = 'admin', approved = 1 WHERE id = ?")
    ->execute([password_hash($pw1, PASSWORD_DEFAULT), (int)$u['id']]);

/* 잠겨 있었다면 함께 풀어 준다 — 여러 번 틀려서 잠긴 상태로 남기 쉽다 */
db()->prepare("DELETE FROM login_attempts WHERE login_id = ?")->execute([$u['login_id']]);

echo "바꿨습니다. [{$u['login_id']}] 로 로그인하세요.\n";
