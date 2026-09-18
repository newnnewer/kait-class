<?php
/* ═══════════════════════════════════════════════
   lib.php — 공통: DB 연결 · 세션 · 헬퍼

   표 정의는 schema.php 에, 채점 관련 상수와 함수는 judge_lib.php 에 있다.
   data/ 폴더에 쓰기 권한이 있어야 한다.
   ═══════════════════════════════════════════════ */
declare(strict_types=1);

/* ── 설정 읽기 ───────────────────────────────────
   설치 환경에 따라 달라지는 값만 config.php 에 둔다.
   없으면 무엇을 해야 하는지 알려 주고 멈춘다 — 빈 화면보다 낫다. */
$cfgFile = __DIR__ . '/config.php';
if (!is_file($cfgFile)) {
  $msg = "설정 파일이 없습니다.\n\n"
       . "config.sample.php 를 config.php 로 복사한 뒤 안의 값을 고쳐 주세요.\n\n"
       . "    cp config.sample.php config.php\n";
  if (PHP_SAPI === 'cli') { fwrite(STDERR, $msg); exit(1); }
  http_response_code(500);
  header('Content-Type: text/plain; charset=utf-8');
  echo $msg;
  exit;
}
$CFG = require $cfgFile;
if (!is_array($CFG)) $CFG = [];

/* 설정에 빠진 값은 기본값으로 채운다 — 옛 config.php 로도 돌아가게 */
$CFG += [
  'db_path'    => dirname(__DIR__) . '/kait-class-data/kait-class.db',
  'log_path'   => dirname(__DIR__) . '/kait-class-data/php-error.log',
  'judge0_url' => 'http://127.0.0.1:2358',
  'timezone'   => 'Asia/Seoul',
];

date_default_timezone_set((string)$CFG['timezone']);

define('DB_PATH',    (string)$CFG['db_path']);
define('DATA_DIR',   dirname((string)$CFG['db_path']));   /* 워커 표시 파일 등이 여기 쌓인다 */
define('JUDGE0_URL', rtrim((string)$CFG['judge0_url'], '/'));

/* 문제 설명에 넣는 이미지. 웹에서 보여야 하므로 문서 루트 안에 있어야 하고,
   이미 저장된 설명들이 /uploads/... 주소를 그대로 담고 있으므로 옮기지 않는다. */
define('UPLOAD_DIR', __DIR__ . '/uploads');

/* 스키마를 바꿀 때마다 1씩 올린다. DB 에 기록된 값과 같으면 점검을 건너뛴다. */
define('SCHEMA_VERSION', 1);

/* ── 프로그램 신원 ───────────────────────────────
   설치한 학교가 정하는 '사이트 이름'과는 다르다.
   사이트 이름은 운영 > 설정에서 바꾸고, 이것은 프로그램 자체의 이름이다.
   저장소 이름이 바뀌면 여기만 고치면 된다. */
const APP_NAME    = 'KAIT-CLASS';
const APP_VERSION = '1.1.0';   // 주.부.수 (유의적 버전). 꼬리말에는 앞 두 자리만 나간다
const APP_REPO    = 'https://github.com/newnnewer/kait-class';

/* ── 저작권과 라이선스 ───────────────────────────
   KAIT 와 문광식의 공동 저작물. PolyForm Noncommercial 1.0.0.
   ★ 라이선스(Required Notice)에 따라 이 표기는 지우면 안 된다.
     꼬리말에 나가며 운영 > 설정으로도 지울 수 없다. 원문은 저장소의 LICENSE.
   ※ 화면에는 실명 대신 아이디(newnnewer)를 쓰고 메일 링크를 건다.
     LICENSE 의 Required Notice 에는 실명(문광식 Moon Kwangsik)을 그대로 둔다. 같은 사람이다. */
const APP_COPYRIGHT_YEAR = '2026';
const APP_OWNERS = [
  ['name' => '한국정보교사연합회(KAIT)', 'url' => 'https://kait.re.kr'],
  ['name' => 'newnnewer',                'url' => 'mailto:newnnewer@gmail.com'],
];
const APP_LICENSE_NAME = 'PolyForm Noncommercial 1.0.0';
const APP_LICENSE_URL  = 'https://polyformproject.org/licenses/noncommercial/1.0.0';

/* 화면에 보이는 짧은 버전: '0.9.0' → '0.9' */
function app_version_short(): string {
  return implode('.', array_slice(explode('.', APP_VERSION), 0, 2));
}

/* 워커는 CLI 로 돌아간다. 거기서 세션을 열면 안 된다. */
if (PHP_SAPI !== 'cli' && session_status() === PHP_SESSION_NONE) {
  /* https 로 들어왔으면 로그인 쿠키를 https 에서만 보내게 한다.
     (같은 서버를 집 안에서 http://IP 로 열 때는 그대로 동작한다) */
  $https = ($_SERVER['HTTPS'] ?? '') !== '' && ($_SERVER['HTTPS'] ?? '') !== 'off';
  session_set_cookie_params(['samesite' => 'Lax', 'httponly' => true, 'secure' => $https]);
  session_start();
}

require_once __DIR__ . '/schema.php';
require_once __DIR__ . '/judge_lib.php';

/* PHP 오류가 화면(=JSON 응답)으로 새어 나가지 않게 하고 파일에 남긴다.
   오류 HTML 이 응답에 섞이면 브라우저가 JSON 파싱에 실패해
   "서버가 응답하지 않습니다" 로 보이게 된다. */
ini_set('display_errors', '0');
ini_set('log_errors', '1');
ini_set('error_log', (string)$CFG['log_path']);

function db(): PDO {
  static $pdo = null;
  if ($pdo) return $pdo;
  @mkdir(dirname(DB_PATH), 0775, true);
  $pdo = new PDO('sqlite:' . DB_PATH);
  $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
  $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

  /* ★ 동시 접속 대비 — 한 반이 같이 쓰면 쓰기가 겹친다.
     기본값이 0 이라 다른 요청이 쓰는 중이면 기다리지 않고 바로 실패했다.
     10초까지 기다리게 하면 사실상 충돌이 사라진다. */
  $pdo->exec('PRAGMA busy_timeout = 10000');
  $pdo->exec('PRAGMA foreign_keys = ON');

  /* 저널 모드 변경은 배타적 잠금을 잡는다. 이미 WAL 이면 건드리지 않는다. */
  if (strtolower((string)$pdo->query('PRAGMA journal_mode')->fetchColumn()) !== 'wal') {
    $pdo->exec('PRAGMA journal_mode = WAL');
  }
  /* WAL 에서는 NORMAL 로도 안전하고, 쓰기가 훨씬 빠르다. */
  $pdo->exec('PRAGMA synchronous = NORMAL');

  /* 스키마 점검은 버전이 다를 때만. 요청마다 CREATE TABLE 을 돌리지 않는다. */
  if ((int)$pdo->query('PRAGMA user_version')->fetchColumn() !== SCHEMA_VERSION) {
    ensure_schema($pdo);
  }
  return $pdo;
}

/* ── 조회 ─────────────────────────────────────────
   ★ 읽기 커서를 반드시 닫고 값을 돌려준다.
   SELECT 를 열어둔 채 쓰기를 하면 SQLite 가 읽기 스냅숏을 붙잡고 있다고 판단해
   busy_timeout 을 무시하고 즉시 "database is locked" 로 실패한다.
   여러 학생이 동시에 쓰는 환경에서 이것이 오류의 가장 큰 원인이었다. */
function one(string $sql, array $args = []): ?array {
  $st = db()->prepare($sql);
  $st->execute($args);
  $r = $st->fetch();
  $st->closeCursor();
  return $r === false ? null : $r;
}
function all(string $sql, array $args = []): array {
  $st = db()->prepare($sql);
  $st->execute($args);
  $r = $st->fetchAll();
  $st->closeCursor();
  return $r;
}
function col(string $sql, array $args = []) {
  $st = db()->prepare($sql);
  $st->execute($args);
  $v = $st->fetchColumn();
  $st->closeCursor();
  return $v;
}

/* 쓰기는 BEGIN IMMEDIATE 로 감싼다. 쓰기 잠금을 처음부터 잡으므로
   busy_timeout 이 제대로 적용되고, 충돌해도 몇 번 다시 시도한다. */
function tx(callable $fn) {
  $d = db();
  for ($i = 0; $i < 5; $i++) {
    $open = false;
    try {
      $d->exec('BEGIN IMMEDIATE');
      $open = true;
      $r = $fn($d);
      $d->exec('COMMIT');
      return $r;
    } catch (Throwable $e) {
      if ($open) { try { $d->exec('ROLLBACK'); } catch (Throwable $x) {} }
      if (!is_busy_error($e) || $i === 4) throw $e;
      usleep(random_int(40000, 160000) * ($i + 1));
    }
  }
  return null;
}

/* 잠금 충돌처럼 잠시 뒤 다시 하면 되는 오류인지 */
function is_busy_error(Throwable $e): bool {
  $m = $e->getMessage();
  return stripos($m, 'locked') !== false || stripos($m, 'busy') !== false;
}

/* ── 설정 ─────────────────────────────────────────
   settings 표에 값이 없으면 여기 기본값을 쓴다.
   한 요청 안에서는 한 번만 읽는다. */
const SETTING_DEFAULTS = [
  'site_name'    => '',       // 비면 APP_NAME 을 쓴다 (layout.php 의 site_name())
  'logo'         => '',       // uploads/ 아래 파일명. 비면 사이트 이름을 글자로 보여준다
  'favicon'      => '',
  'hero_on'      => '1',      // 첫 화면 코드 타이핑 연출
  'signup_on'    => '0',      // 회원가입 허용
  'footer_extra' => '',       // 관리자가 넣는 추가 안내 (마크다운)
];

function settings_all(): array {
  static $cache = null;
  if ($cache !== null) return $cache;
  $cache = SETTING_DEFAULTS;
  foreach (all("SELECT key, value FROM settings") as $r) {
    $cache[$r['key']] = $r['value'];
  }
  return $cache;
}
function setting(string $key): string {
  $s = settings_all();
  return (string)($s[$key] ?? '');
}
function setting_set(string $key, string $value): void {
  db()->prepare("INSERT INTO settings(key, value) VALUES(?, ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      ->execute([$key, $value]);
}

/* ── 잡다한 헬퍼 ─────────────────────────────────── */
function ustrlen(string $s): int {
  if (function_exists('mb_strlen')) return mb_strlen($s);
  preg_match_all('/./us', $s, $m);
  return count($m[0]);
}
function now(): string { return date('Y-m-d H:i:s'); }
function h(?string $s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
function fmt_dt(?string $s): string { return $s ? substr(str_replace('T', ' ', $s), 0, 16) : ''; }

function jout(array $a): never {
  /* 버퍼에 남은 경고 문구 등을 버리고 순수한 JSON 만 내보낸다 */
  while (ob_get_level() > 0) ob_end_clean();
  if (!headers_sent()) header('Content-Type: application/json; charset=utf-8');
  echo json_encode($a, JSON_UNESCAPED_UNICODE);
  exit;
}
/* $retry = true 면 브라우저가 잠시 뒤 자동으로 다시 시도한다 */
function jerr(string $m, int $code = 400, bool $retry = false): never {
  if (!headers_sent()) http_response_code($code);
  jout(['ok' => false, 'error' => $m, 'retry' => $retry]);
}

function body(): array {
  $d = json_decode(file_get_contents('php://input') ?: '{}', true);
  return is_array($d) ? $d : [];
}

/* ── 로그인 ───────────────────────────────────────
   approved 는 가입 계정의 승인 여부다. 승인 전 계정은 로그인 단계에서
   막으므로 여기까지 오지 않지만, 세션이 살아 있는 동안 관리자가
   승인을 거둘 수 있으므로 함께 읽어 둔다. */
function me(): ?array {
  if (empty($_SESSION['uid'])) return null;
  return one("SELECT id, login_id, name, role, group_id, source, approved
              FROM users WHERE id = ?", [$_SESSION['uid']]);
}
/* 최초 관리자 — schema.php 가 처음 만든 계정(id=1).
   이 계정의 권한을 내리거나 지우는 것은 막는다.
   관리자를 전부 없애 버리면 DB 를 직접 고치지 않는 한 되돌릴 방법이 없다.
   로그인 아이디는 바꿀 수 있으므로 이름이 아니라 id 로 판별한다. */
function is_root_admin(int $id): bool { return $id === 1; }

function require_login(): array { $u = me(); if (!$u) jerr('로그인이 필요합니다', 401); return $u; }
function require_admin(): array { $u = require_login(); if ($u['role'] !== 'admin') jerr('관리자 권한이 필요합니다', 403); return $u; }

/* ── 반(그룹) ─────────────────────────────────── */
function groups_all(): array {
  return all("SELECT g.*, (SELECT COUNT(*) FROM users u WHERE u.group_id = g.id) AS member_cnt
              FROM groups g ORDER BY g.sort, g.name");
}
/* 이름으로 반을 찾고, 없으면 만든다. */
function group_id_by_name(string $name): ?int {
  $name = trim($name);
  if ($name === '') return null;
  if ($r = one("SELECT id FROM groups WHERE name = ?", [$name])) return (int)$r['id'];
  db()->prepare("INSERT INTO groups(name, sort, created_at) VALUES(?,0,?)")->execute([$name, now()]);
  return (int)db()->lastInsertId();
}

/* ── 태그 ─────────────────────────────────────── */
function tags_all(): array {
  return all("SELECT t.*, (SELECT COUNT(*) FROM problem_tags pt WHERE pt.tag_id = t.id) AS use_cnt
              FROM tags t ORDER BY t.name");
}
function tags_of(int $problemId): array {
  return array_column(all("SELECT t.name FROM problem_tags pt JOIN tags t ON t.id = pt.tag_id
                           WHERE pt.problem_id = ? ORDER BY t.name", [$problemId]), 'name');
}
/* 문항 목록 전체의 태그를 한 번에 — N+1 쿼리 방지 */
function tags_map(): array {
  $rows = all("SELECT pt.problem_id, t.name FROM problem_tags pt JOIN tags t ON t.id = pt.tag_id ORDER BY t.name");
  $m = [];
  foreach ($rows as $r) $m[(int)$r['problem_id']][] = $r['name'];
  return $m;
}
/* "반복문, 조건문" → 태그를 만들고 문항에 연결. 목록에 없는 기존 연결은 끊는다. */
function sync_tags(int $problemId, string $csv): void {
  $names = [];
  foreach (preg_split('/[,\n]+/', $csv) as $t) {
    $t = trim($t);
    if ($t !== '' && !in_array($t, $names, true)) $names[] = $t;
  }
  $ids = [];
  foreach ($names as $n) {
    $r = one("SELECT id FROM tags WHERE name = ?", [$n]);
    if ($r) { $ids[] = (int)$r['id']; continue; }
    db()->prepare("INSERT INTO tags(name, created_at) VALUES(?,?)")->execute([$n, now()]);
    $ids[] = (int)db()->lastInsertId();
  }
  tx(function (PDO $d) use ($problemId, $ids) {
    $d->prepare("DELETE FROM problem_tags WHERE problem_id = ?")->execute([$problemId]);
    $link = $d->prepare("INSERT OR IGNORE INTO problem_tags(problem_id, tag_id) VALUES(?,?)");
    foreach ($ids as $tid) $link->execute([$problemId, $tid]);
    $d->exec("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM problem_tags)");
  });
}

/* ── 문제 번호 ───────────────────────────────────
   prob_no 는 화면에 보이는 번호. id 와 따로 둔다. */
function next_prob_no(PDO $p): int {
  $m = col("SELECT MAX(prob_no) FROM problems");
  return $m === null || $m === false ? 1001 : (int)$m + 1;
}

/* "1001, 1002 1005" → 문제 목록. 없는 번호와 중복 번호를 갈라 돌려준다. */
function resolve_prob_nos(string $nos): array {
  $wanted = [];
  foreach (preg_split('/[,\s]+/', trim($nos)) as $tok) {
    if ($tok === '') continue;
    if (!ctype_digit($tok)) return ['found' => [], 'bad' => [$tok], 'dup' => []];
    $wanted[] = (int)$tok;
  }
  if (!$wanted) return ['found' => [], 'bad' => [], 'dup' => []];
  $ph = implode(',', array_fill(0, count($wanted), '?'));
  $byNo = [];
  foreach (all("SELECT id AS problem_id, prob_no, title FROM problems WHERE prob_no IN ($ph)", $wanted) as $r)
    $byNo[(int)$r['prob_no']] = $r;
  $found = $bad = $dup = $seen = [];
  foreach ($wanted as $no) {
    if (!isset($byNo[$no])) { $bad[] = $no; continue; }
    if (isset($seen[$no]))  { $dup[] = $no; continue; }
    $seen[$no] = true;
    $found[] = $byNo[$no];
  }
  return ['found' => $found, 'bad' => $bad, 'dup' => $dup];
}
