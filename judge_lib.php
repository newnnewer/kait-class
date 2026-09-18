<?php
/* ═══════════════════════════════════════════════
   judge_lib.php — 채점 관련 상수와 헬퍼
   표 정의는 schema.php 에 있다. 이 파일은 lib.php 가 require 한다.

   [용어]
   set        문제 묶음. set_type 으로 '수업(lesson)'과 '평가(assessment)'를 구분한다.
   testcase   문제별 입력/기대출력 쌍. is_sample=1 이면 학생에게 예시로 보여준다.
   submission 학생의 제출 한 건. set_id 가 NULL 이면 '문제 모음'에서 자유롭게 푼 것.
   ═══════════════════════════════════════════════ */

/* ── 채점 설정 ─────────────────────────────────── */
/* JUDGE0_URL 은 config.php 에서 읽어 lib.php 가 define 한다 */
const SUBMIT_COOLDOWN = 5;        // 제출 간 최소 간격(초)
const RUN_COOLDOWN    = 3;        // 직접 실행 간 최소 간격(초)
const RUN_MAX_OUTPUT  = 20000;    // 화면에 돌려줄 출력 길이 상한(자)
const RUN_MAX_STDIN   = 10000;    // 입력 길이 상한(자)
const DEFAULT_AC      = 2;        // 평가 기본 요구 AC 횟수

/* 쓸 수 있는 언어. 운영 > 언어 화면에서 관리한다.

   한 요청 안에서 여러 번 부르므로 읽어 두고 재사용한다.
   다만 채점 워커는 며칠씩 떠 있는 상주 프로세스라, 그대로 두면
   언어를 새로 켜도 워커만 옛 목록을 붙들고 있게 된다.
   (실제로 C++ 을 켠 뒤 워커를 재시작하지 않아 제출이 전부 실패한 적이 있다.)
   그래서 CLI 에서는 잠깐만 들고 있다가 다시 읽는다. */
const LANGS_TTL = 20;   /* 상주 프로세스에서 목록을 다시 읽는 간격 (초) */

function langs(bool $onlyActive = true): array {
  static $cache = [];
  static $at = 0;
  $k = $onlyActive ? 'on' : 'all';

  if (PHP_SAPI === 'cli' && time() - $at > LANGS_TTL) { $cache = []; $at = time(); }
  if (isset($cache[$k])) return $cache[$k];

  $rows = all("SELECT lang_key, judge0_id, label, editor, opts, active, sort
               FROM languages" . ($onlyActive ? " WHERE active = 1" : "") . "
               ORDER BY sort, lang_key");
  $out = [];
  foreach ($rows as $r) {
    $out[$r['lang_key']] = [
      'id'     => (int)$r['judge0_id'],
      'label'  => (string)$r['label'],
      'editor' => (string)$r['editor'],
      'opts'   => (string)$r['opts'],
      'active' => (int)$r['active'],
      'sort'   => (int)$r['sort'],
    ];
  }
  return $cache[$k] = $out;
}

/* 꺼진 언어라도 이름은 보여줘야 한다 — 예전 제출 기록에 남아 있기 때문이다. */
function lang_label(?string $key): string {
  if ($key === null || $key === '') return '';
  $all = langs(false);
  return $all[$key]['label'] ?? $key;
}

/* 판정 코드 → 화면 표시 */
const VERDICT_NAME = [
  'AC'  => '맞았습니다',
  'WA'  => '틀렸습니다',
  'TLE' => '시간 초과',
  'MLE' => '메모리 초과',
  'RE'  => '런타임 오류',
  'CE'  => '컴파일 오류',
  'IE'  => '채점 오류',
];

/* 브라우저는 <textarea> 의 줄바꿈을 \r\n 으로 보낸다(HTML 규격).
   \r 이 테스트케이스에 섞이면 파이썬 input() 이 그것까지 읽어 들여
   멀쩡한 코드가 틀린 답이 된다. 들어오는 길목에서 모두 걷어낸다. */
function nl_clean(?string $s): string {
  return str_replace(["\r\n", "\r"], "\n", (string)$s);
}

/* 출력 비교 — 줄 끝 공백과 마지막 개행 차이는 무시한다.
   학생 코드가 print 로 개행을 남기는 게 보통이라, 이 처리가 없으면
   맞는 답도 계속 틀렸다고 나온다. */
function output_norm(?string $s): string {
  $s = str_replace("\r\n", "\n", (string)$s);
  $lines = array_map('rtrim', explode("\n", $s));
  return rtrim(implode("\n", $lines), "\n");
}
function outputs_match(?string $got, ?string $want): bool {
  return output_norm($got) === output_norm($want);
}

/* ═══ 틀렸을 때 보여줄 차이 ═══════════════════
   처음 틀린 테스트케이스의 입력·기대 출력·내 출력을 나란히 보여준다.
   몇 번째 케이스인지는 알리지 않는다. */
const DIFF_STORE_MAX  = 20000;   /* 저장해 둘 글자 수 상한 */
const DIFF_TOO_LONG   = 100000;  /* 이보다 길면 아예 보여주지 않는다 */
const DIFF_FULL_LINES = 20;      /* 이 이내면 통째로 보여준다 */
const DIFF_FULL_CHARS = 2000;
const DIFF_CTX_BEFORE = 3;       /* 길면 다른 지점 앞뒤로 이만큼만 */
const DIFF_CTX_AFTER  = 5;

/* 저장할 때 너무 긴 것을 잘라 둔다 */
function diff_store(?string $s): ?string {
  if ($s === null) return null;
  return mb_strlen($s) > DIFF_STORE_MAX ? mb_substr($s, 0, DIFF_STORE_MAX) : $s;
}

/* 화면에 보여줄 모양으로 다듬는다.
   비교는 채점과 같은 규칙(줄 끝 공백·마지막 개행 무시)을 쓴다. */
function diff_view(?string $expected, ?string $got): array {
  $exp = str_replace("\r\n", "\n", (string)$expected);
  $out = str_replace("\r\n", "\n", (string)$got);

  if (mb_strlen($exp) > DIFF_TOO_LONG || mb_strlen($out) > DIFF_TOO_LONG) {
    return ['mode' => 'toolong'];
  }

  $e = explode("\n", rtrim($exp, "\n"));
  $g = explode("\n", rtrim($out, "\n"));

  /* 처음 갈리는 줄 찾기 */
  $first = null;
  $n = max(count($e), count($g));
  for ($i = 0; $i < $n; $i++) {
    $a = isset($e[$i]) ? rtrim($e[$i]) : null;
    $b = isset($g[$i]) ? rtrim($g[$i]) : null;
    if ($a !== $b) { $first = $i; break; }
  }

  $short = count($e) <= DIFF_FULL_LINES && count($g) <= DIFF_FULL_LINES
        && mb_strlen($exp) <= DIFF_FULL_CHARS && mb_strlen($out) <= DIFF_FULL_CHARS;

  $from = 0; $to = $n - 1; $mode = 'full';
  if (!$short) {
    $mode = 'window';
    $c = $first ?? 0;
    $from = max(0, $c - DIFF_CTX_BEFORE);
    $to   = min($n - 1, $c + DIFF_CTX_AFTER);
  }

  $pack = function (array $lines) use ($from, $to, $first) {
    $rows = [];
    for ($i = $from; $i <= $to; $i++) {
      if (!isset($lines[$i])) break;
      $rows[] = ['n' => $i + 1, 't' => $lines[$i], 'd' => ($first !== null && $i === $first)];
    }
    return $rows;
  };

  return [
    'mode'   => $mode,
    'line'   => $first !== null ? $first + 1 : null,
    'exp'    => $pack($e),
    'got'    => $pack($g),
    'before' => $from > 0,
    'after'  => $to < $n - 1,
    'exp_n'  => count($e),
    'got_n'  => count($g),
  ];
}

/* 이 제출에 차이를 보여줘도 되는지 */
function diff_allowed(array $sub): bool {
  $p = one("SELECT show_diff FROM problems WHERE id = ?", [$sub['problem_id']]);
  if (!$p || (int)$p['show_diff'] === 0) return false;
  if (!empty($sub['set_id'])) {
    $s = one("SELECT show_diff FROM sets WHERE id = ?", [$sub['set_id']]);
    if ($s && (int)$s['show_diff'] === 0) return false;
  }
  return true;
}

/* 소스 코드 지문 — 공백만 다른 코드를 같은 것으로 보지는 않는다.
   (들여쓰기를 바꾸는 것도 다시 친 것이므로) */
function source_hash(string $code): string {
  return hash('sha256', str_replace("\r\n", "\n", $code));
}

/* ═══ 수업 · 평가 묶음 ═══════════════════════════ */

const SET_TYPE_NAME = ['lesson' => '수업', 'assessment' => '평가'];

/* ★ 날짜·시각은 반드시 이 함수를 거쳐 저장한다.
   브라우저의 datetime-local 입력은 "2026-09-15T09:00" 처럼 가운데를 T 로 보낸다.
   반면 서버는 date('Y-m-d H:i') 로 "2026-09-15 09:00" 을 만든다.
   기간 판정은 문자열 비교로 하는데 공백(0x20)이 'T'(0x54)보다 작으므로,
   T 가 섞인 채로 저장하면 같은 날 시작하는 묶음이 온종일 '시작 전'이 되고
   자정이 지나서야 열린다. 날짜가 다른 경우에는 멀쩡해 보여서 찾기 어려웠다. */
function dt_norm(?string $s): string {
  $s = trim((string)$s);
  return $s === '' ? '' : str_replace('T', ' ', $s);
}

/* 기간 상태. start_at/end_at 이 비어 있으면 그 방향으로는 제한이 없다. */
function set_state(array $s): string {
  $now   = date('Y-m-d H:i');
  $start = dt_norm($s['start_at'] ?? null);   /* 옛 자료에 T 가 남아 있어도 안전하게 */
  $end   = dt_norm($s['end_at'] ?? null);
  if ($start !== '' && $now < $start) return 'before';
  if ($end   !== '' && $now > $end)   return 'after';
  return 'open';
}
const SET_STATE_NAME = ['before' => '시작전', 'open' => '진행중', 'after' => '종료'];

/* 목록에서 쓰는 짧은 날짜 — 연도를 뺀다. 한 해 안에서 쓰는 화면이라 연도가 자리만 차지한다.
   해가 바뀐 항목은 헷갈리지 않게 두 자리 연도를 붙인다. */
function fmt_dt_short(?string $s): string {
  if (!$s) return '';
  $t = substr(str_replace('T', ' ', $s), 0, 16);      // YYYY-MM-DD HH:MM
  return substr($t, 0, 4) === date('Y') ? substr($t, 5) : substr($t, 2);
}

function set_locked(array $s): bool { return (int)($s['active'] ?? 1) === 0; }

/* ═══ 로그인 시도 제한 ═══════════════════════════
   계정 하나를 두고 비밀번호를 계속 찍어보는 것을 막는다.
   같은 학교 학생들이 IP 를 공유하므로 IP 로는 막지 않는다. */
const LOGIN_WINDOW = 600;   /* 살펴보는 시간 (초) */
const LOGIN_MAX    = 10;    /* 이 횟수를 넘기면 잠근다 */
const LOGIN_LOCK   = 300;   /* 잠기는 시간 (초) */

/* 잠겨 있으면 남은 초, 아니면 0 */
function login_locked(string $loginId): int {
  if ($loginId === '') return 0;
  $since = date('Y-m-d H:i:s', time() - LOGIN_WINDOW);
  $n = (int)col("SELECT COUNT(*) FROM login_attempts
                 WHERE login_id = ? AND ok = 0 AND at >= ?", [$loginId, $since]);
  if ($n < LOGIN_MAX) return 0;

  $last = (string)col("SELECT at FROM login_attempts
                       WHERE login_id = ? AND ok = 0 ORDER BY id DESC LIMIT 1", [$loginId]);
  $left = LOGIN_LOCK - (time() - strtotime($last));
  return max(0, $left);
}

function login_record(string $loginId, bool $ok): void {
  db()->prepare("INSERT INTO login_attempts(login_id, ip, ok, at) VALUES(?,?,?,?)")
      ->execute([mb_substr($loginId, 0, 60), (string)($_SERVER['REMOTE_ADDR'] ?? ''), $ok ? 1 : 0, now()]);
  /* 성공하면 그 계정의 실패 기록을 지워 잠금을 푼다 */
  if ($ok) {
    db()->prepare("DELETE FROM login_attempts WHERE login_id = ? AND ok = 0")->execute([$loginId]);
  }
  /* 오래된 기록은 쌓아둘 이유가 없다 */
  if (random_int(1, 50) === 1) {
    db()->prepare("DELETE FROM login_attempts WHERE at < ?")
        ->execute([date('Y-m-d H:i:s', time() - 86400 * 30)]);
  }
}

/* 학생에게 보여줄 공지 목록 */
function notices_public(int $limit = 0): array {
  $sql = "SELECT id, title, pinned, created_at FROM notices
          WHERE active = 1 ORDER BY pinned DESC, id DESC";
  if ($limit > 0) $sql .= " LIMIT " . (int)$limit;
  return all($sql);
}

/* 이 사람이 이 문제를 볼 수 있는지.
   잠긴 문제라도 자기가 참여하는 수업·평가에 담겨 있으면 볼 수 있다.
   그래야 평소에는 감춰 두었다가 평가 때만 여는 운영이 가능하다. */
function problem_visible(?array $u, array $p, ?int $setId = null): bool {
  if ((int)($p['active'] ?? 1) === 1) return true;
  if ($u && ($u['role'] ?? '') === 'admin') return true;
  if (!$u || !$setId) return false;
  $set = student_set_or_null($u, $setId);
  if (!$set) return false;
  return (bool)one("SELECT 1 x FROM set_problems WHERE set_id=? AND problem_id=?",
                   [$setId, $p['id']]);
}

/* 기간을 한 줄로. 한쪽만 정했으면 그쪽만, 둘 다 없으면 빈 문자열. */
function period_text(array $s): string {
  $a = fmt_dt_short($s['start_at'] ?? null);
  $b = fmt_dt_short($s['end_at'] ?? null);
  if ($a === '' && $b === '') return '';
  return trim($a . ' ~ ' . $b);
}

/* 학생이 지금 이 묶음에서 문제를 풀 수 있는지 */
function set_open(array $s): bool { return !set_locked($s) && set_state($s) === 'open'; }

/* ── 공개 범위 ─────────────────────────────────
   visibility = 'groups'  set_targets 에 적힌 반만 본다.
                          반을 하나도 고르지 않으면 아무도 못 본다.
                          (편집 화면에서 하나 이상 고르게 막으므로 그런 상태는 안 생긴다)
   visibility = 'all'     직접 가입한 외부 회원을 포함해 모든 회원이 본다.

   ★ 예전에는 '대상 반이 없으면 전체 공개' 였다. 회원가입이 생기면서
     그 규칙은 위험해졌다 — 반을 안 고른 평가가 외부 회원에게 그대로 열린다.
     그래서 고르지 않은 것은 '아직 아무에게도'로 뜻을 뒤집었다. */
/* 수업·평가 목록의 차례.
   끝나는 날이 먼 것일수록 위에 둔다. 끝나는 날을 정하지 않은 것(계속 열려 있는 것)이 가장 위.
   같으면 나중에 만든 것을 위에. 학생 목록과 관리자 목록이 같은 차례를 쓴다. */
const SET_ORDER_SQL =
  "ORDER BY (NULLIF(s.end_at, '') IS NULL) DESC, s.end_at DESC, s.id DESC";

const SET_VISIBLE_SQL =
  "( s.visibility = 'all'
     OR EXISTS(SELECT 1 FROM set_targets t WHERE t.set_id = s.id AND t.group_id = :gid) )";

function sets_for_student(array $u, string $type): array {
  return all("SELECT s.*,
                (SELECT COUNT(*) FROM set_problems sp WHERE sp.set_id = s.id) AS problem_cnt
              FROM sets s
              WHERE s.set_type = :ty AND s.active = 1
                AND " . SET_VISIBLE_SQL . " " . SET_ORDER_SQL,
             [':ty' => $type, ':gid' => $u['group_id']]);
}

/* 이 학생이 이 묶음을 볼 수 있으면 묶음 정보를, 아니면 null */
function student_set_or_null(array $u, int $sid): ?array {
  return one("SELECT s.* FROM sets s
              WHERE s.id = :sid AND s.active = 1
                AND " . SET_VISIBLE_SQL,
             [':sid' => $sid, ':gid' => $u['group_id']]);
}

/* 평가에서 이 학생이 이 문제를 몇 번 통과했는지.
   같은 코드로 통과한 것도 그대로 센다 — 붙여넣기가 막혀 있으므로
   다시 냈다는 것은 다시 쳤다는 뜻이고, 그것이 애초의 목적이다.
   (source_hash 는 계속 저장한다. 관리자가 이상한 패턴을 확인할 때 쓴다.) */
function ac_count_in_set(int $uid, int $pid, int $sid): int {
  return (int)col("SELECT COUNT(*) FROM submissions
                   WHERE user_id = ? AND problem_id = ? AND set_id = ? AND verdict = 'AC'",
                  [$uid, $pid, $sid]);
}

/* 문제 하나를 '완료'로 치는 통과 횟수. 수업은 한 번, 평가는 문제마다 정한 횟수. */
function set_need(bool $isAssess, int $requiredAc): int {
  return $isAssess ? max(1, $requiredAc) : 1;
}

/* 이 학생의 묶음 진행 — 문제별 통과 횟수와 완료 문제 수.
   완료 판정은 반드시 이 함수 하나로 한다 (묶음 화면·목록·학생 활동이 같이 쓴다).
   세는 규칙은 ac_count_in_set() 과 같다: 이 묶음 안에서 받은 AC 수. */
function set_my_progress(int $uid, int $sid, bool $isAssess): array {
  $ac = [];
  foreach (all("SELECT problem_id, COUNT(*) n FROM submissions
                WHERE user_id=? AND set_id=? AND verdict='AC' GROUP BY problem_id",
               [$uid, $sid]) as $r) {
    $ac[(int)$r['problem_id']] = (int)$r['n'];
  }
  $done = 0; $total = 0;
  foreach (all("SELECT problem_id, required_ac FROM set_problems WHERE set_id=?", [$sid]) as $it) {
    $total++;
    if (($ac[(int)$it['problem_id']] ?? 0) >= set_need($isAssess, (int)$it['required_ac'])) $done++;
  }
  return ['ac' => $ac, 'done' => $done, 'total' => $total];
}

/* 이 묶음에서 쓸 수 있는 언어 키 목록. 값이 이상하면 전체를 허용한다. */
function set_langs(?array $s): array {
  $on  = langs();
  $raw = $s['langs'] ?? '';
  $out = [];
  foreach (explode(',', (string)$raw) as $k) {
    $k = trim($k);
    if ($k !== '' && isset($on[$k]) && !in_array($k, $out, true)) $out[] = $k;
  }
  return $out ?: array_keys($on);
}

/* 관리자 현황표: 묶음에 속한 문제들 × 대상 학생들 × 통과 횟수 */
function set_progress(int $sid): array {
  $problems = all("SELECT sp.problem_id, sp.required_ac, p.prob_no, p.title
                   FROM set_problems sp JOIN problems p ON p.id = sp.problem_id
                   WHERE sp.set_id = ? ORDER BY sp.sort, sp.id", [$sid]);

  /* 현황표에 올릴 학생 — 공개 범위와 같은 규칙을 쓴다.
     'all' 이면 승인된 학생 전부, 아니면 대상 반 학생만. */
  $vis = (string)col("SELECT visibility FROM sets WHERE id = ?", [$sid]);
  $students = $vis === 'all'
    ? all("SELECT u.id, u.login_id, u.name, g.name AS group_name
           FROM users u LEFT JOIN groups g ON g.id = u.group_id
           WHERE u.role = 'student' AND u.approved = 1
           ORDER BY g.sort, u.login_id")
    : all("SELECT u.id, u.login_id, u.name, g.name AS group_name
           FROM users u LEFT JOIN groups g ON g.id = u.group_id
           WHERE u.role = 'student' AND u.approved = 1
             AND u.group_id IN (SELECT group_id FROM set_targets WHERE set_id = ?)
           ORDER BY g.sort, u.login_id", [$sid]);

  /* 통과 횟수를 한 번에 읽어 온다 (학생 수 × 문제 수만큼 조회하지 않으려고) */
  $map = [];
  foreach (all("SELECT user_id, problem_id, COUNT(*) AS n
                FROM submissions WHERE set_id = ? AND verdict = 'AC'
                GROUP BY user_id, problem_id", [$sid]) as $r) {
    $map[(int)$r['user_id']][(int)$r['problem_id']] = (int)$r['n'];
  }
  /* 제출은 했으나 아직 통과 못 한 경우도 구분해서 보여준다 */
  $tried = [];
  foreach (all("SELECT user_id, problem_id, COUNT(*) AS n
                FROM submissions WHERE set_id = ? GROUP BY user_id, problem_id", [$sid]) as $r) {
    $tried[(int)$r['user_id']][(int)$r['problem_id']] = (int)$r['n'];
  }

  foreach ($students as &$st) {
    $st['ac'] = []; $st['try'] = [];
    foreach ($problems as $p) {
      $pid = (int)$p['problem_id'];
      $st['ac'][$pid]  = $map[(int)$st['id']][$pid]   ?? 0;
      $st['try'][$pid] = $tried[(int)$st['id']][$pid] ?? 0;
    }
  }
  unset($st);
  return ['problems' => $problems, 'students' => $students];
}
