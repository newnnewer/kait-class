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
const DEFAULT_AC      = 3;        // 평가 기본 요구 AC 횟수 (2.1.0 부터 3, 그전 2)

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

/* 이 제출의 '어디가 다른가' (기대한 출력과 내 출력 비교) 정보 (보여 줄 게 없으면 null).
   제출 직후(api.php poll)와 채점 결과 상세 보기(results.php)가 같은 것을 쓴다 (1.5.0). */
function diff_for_submission(array $s): ?array {
  if (($s['verdict'] ?? '') !== 'WA' || ($s['fail_expected'] ?? null) === null || !diff_allowed($s)) return null;
  $d = diff_view($s['fail_expected'], $s['fail_output']);
  if ($d['mode'] !== 'toolong') {
    $inRaw = (string)$s['fail_input'];
    $d['input'] = mb_strlen($inRaw) > DIFF_FULL_CHARS ? mb_substr($inRaw, 0, DIFF_FULL_CHARS) . "\n…" : $inRaw;
  }
  return $d;
}

/* diff_for_submission() 결과를 HTML 로 — judge.js 의 diffHtml() 과 같은 모양 */
function diff_html(array $d): string {
  if ($d['mode'] === 'toolong') {
    return '<div class="diffbox"><p class="dnote only">출력이 너무 길어 비교를 보여주지 않습니다.</p></div>';
  }
  $lines = function (array $rows, bool $more1, bool $more2): string {
    $s = '<div class="dlines">';
    if ($more1) $s .= '<div class="dmore">…</div>';
    foreach ($rows as $r) {
      $s .= '<div class="dline' . ($r['d'] ? ' on' : '') . '"><span class="dn">' . (int)$r['n'] . '</span>'
          . '<span class="dt">' . ($r['t'] === '' ? '<i>(빈 줄)</i>' : h($r['t'])) . '</span></div>';
    }
    if (!$rows) $s .= '<div class="dline"><span class="dn"></span><span class="dt"><i>(출력 없음)</i></span></div>';
    if ($more2) $s .= '<div class="dmore">…</div>';
    return $s . '</div>';
  };
  /* 문구 (1.6.1): 입력 칸이 있을 때만 '아래 입력에 대한' 을 붙인다 */
  $hasIn = ($d['input'] ?? '') !== '';
  $h = '<div class="diffbox"><div class="dhead">' . ($hasIn ? '아래 입력에 대한 ' : '') . '출력 결과가 '
     . ($d['line'] ? (int)$d['line'] . '번째 줄부터 ' : '') . '다릅니다.</div>';
  if ($hasIn) {
    $h .= '<div class="dsec"><div class="dcap">입력</div><pre class="dpre">' . h($d['input']) . '</pre></div>';
  }
  $h .= '<div class="dcols">'
      . '<div class="dsec"><div class="dcap">기대한 출력<span class="small muted"> ' . (int)$d['exp_n'] . '줄</span></div>'
      . $lines($d['exp'], $d['before'], $d['after']) . '</div>'
      . '<div class="dsec"><div class="dcap">내 출력<span class="small muted"> ' . (int)$d['got_n'] . '줄</span></div>'
      . $lines($d['got'], $d['before'], $d['after']) . '</div></div>';
  if ($d['mode'] === 'window') $h .= '<p class="dnote">출력이 길어 다른 부분 앞뒤만 보여줍니다.</p>';
  return $h . '</div>';
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
  /* 초까지 비교한다 (2.1.0). 종료가 10:50 이면 10:50:00 부터는 종료 — 그 순간부터 제출을 받지 않는다.
     (그전에는 분 단위로 비교해 10:50:59 까지 받았다.) 시작이 10:00 이면 10:00:00 부터 진행 중.
     종료 전에 들어온 제출은 채점이 밀려 종료 뒤에 끝나도 그대로 채점된다 — 워커는 기간을 보지 않는다. */
  $now   = date('Y-m-d H:i:s');
  $start = set_time_sec($s['start_at'] ?? null);
  $end   = set_time_sec($s['end_at'] ?? null);
  if ($start !== '' && $now <  $start) return 'before';
  if ($end   !== '' && $now >= $end)   return 'after';
  return 'open';
}
/* 저장된 시각('YYYY-MM-DD HH:MM', 옛 자료는 T 구분자나 초가 있을 수 있다)을 초까지 있는 꼴로 */
function set_time_sec(?string $s): string {
  $s = dt_norm($s);
  if ($s === '') return '';
  return strlen($s) >= 19 ? substr($s, 0, 19) : substr($s, 0, 16) . ':00';
}
const SET_STATE_NAME = ['before' => '시작전', 'open' => '진행중', 'after' => '종료'];

/* ── 평가의 남은 시간 (2.1.0) ────────────────────
   평가의 문제 목록과 문제 화면에 '남은 시간 1일 2시간 3분 4초'를 보여 준다 (시작 전이면 '시작까지 …').
   시작 시각 · 종료 시각이 되면 화면을 한 번 새로 읽는다 — 평가는 기간 밖에서 문제를 가리기 때문이다.
   학생 컴퓨터의 시계가 아니라 서버가 센 남은 초를 내려 주고 화면이 1초씩 줄인다.
   평가 도중 교사가 종료 시각을 바꿔도 따라가도록 화면이 1분마다 api.php?action=set_clock 로 다시 맞춘다.

   종료 시각이 10:50 이면 10:50:00 을 0 으로 센다. 서버(set_state)도 같은 순간부터 제출을 받지 않는다. */
function set_clock(array $s): array {
  $st = set_state($s); $sec = null;
  $at = $st === 'before' ? dt_norm($s['start_at'] ?? null)
      : ($st === 'open'  ? dt_norm($s['end_at'] ?? null) : '');
  if ($at !== '') {
    $t = strtotime(set_time_sec($at));
    if ($t !== false) $sec = max(0, $t - time());
  }
  return ['state' => $st, 'sec' => $sec];
}
/* 초를 '1일 2시간 3분 4초' 꼴로 — 앞쪽의 0 인 단위는 뺀다 (화면의 스크립트도 같은 꼴) */
function clock_text(int $s): string {
  $d = intdiv($s, 86400); $h = intdiv($s % 86400, 3600); $m = intdiv($s % 3600, 60); $c = $s % 60;
  $a = [];
  if ($d)             $a[] = $d . '일';
  if ($d || $h)       $a[] = $h . '시간';
  if ($d || $h || $m) $a[] = $m . '분';
  $a[] = $c . '초';
  return implode(' ', $a);
}
/* 남은 시간 표시 한 조각 + 그것을 움직이는 스크립트. 한 화면에 한 번만 넣는다.
   평가가 아니거나 보여 줄 것이 없으면(종료 시각이 없는 진행 중 · 이미 종료) 빈 문자열. */
function set_clock_tag(array $s): string {
  if (($s['set_type'] ?? '') !== 'assessment') return '';
  $c = set_clock($s);
  if ($c['sec'] === null) return '';
  $label = $c['state'] === 'before' ? '시작까지' : '남은 시간';
  $soon  = $c['state'] === 'open' && $c['sec'] <= 300;
  $html  = '<span class="setclock' . ($soon ? ' soon' : '') . '" id="setClock" data-set="' . (int)$s['id'] . '"'
         . ' data-state="' . h($c['state']) . '" data-sec="' . (int)$c['sec'] . '">'
         . $label . ' <b>' . h(clock_text((int)$c['sec'])) . '</b></span>';
  $js = <<<'JS'
<script>
/* 평가의 남은 시간 (2.1.0) — 서버가 준 남은 초를 1초씩 줄이고, 1분마다(그리고 이 탭으로 돌아올 때) 다시 맞춘다 */
(function () {
  var el = document.getElementById('setClock');
  if (!el) return;
  var state = el.dataset.state, left = parseInt(el.dataset.sec, 10), t0 = Date.now(), asked = false;
  function txt(s) {
    var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), c = s % 60, a = [];
    if (d) a.push(d + '일');
    if (d || h) a.push(h + '시간');
    if (d || h || m) a.push(m + '분');
    a.push(c + '초');
    return a.join(' ');
  }
  function draw() {
    if (state === 'open' && isNaN(left)) { el.hidden = true; return; }      /* 종료 시각이 없어졌다 */
    var s = isNaN(left) ? 0 : Math.max(0, left - Math.floor((Date.now() - t0) / 1000));
    if (state === 'before' && s > 0) {
      el.innerHTML = '시작까지 <b>' + txt(s) + '</b>'; el.classList.remove('soon');
    } else if (state === 'before') {
      /* 시작 시각이 됐다 — 문제가 나오도록 한 번 새로 읽는다 */
      reloadOnce();
      return;
    } else if (state === 'open' && s > 0) {
      el.innerHTML = '남은 시간 <b>' + txt(s) + '</b>'; el.classList.toggle('soon', s <= 300);
    } else {
      el.innerHTML = '<b>종료되었습니다</b>'; el.classList.add('soon');
      /* 평가는 끝나면 문제를 볼 수 없다 — 서버에 정말 끝났는지 한 번 물어보고(그사이 연장됐을 수 있다)
         끝났으면 화면을 새로 읽어 문제를 가린다. 제출은 이미 서버가 막고 있다. */
      if (state === 'open' && !asked) { asked = true; sync(); }
      else if (state === 'after') reloadOnce();
    }
    el.hidden = false;
  }
  function reloadOnce() {
    var k = 'kc.clockReload', last = 0;
    try { last = parseInt(sessionStorage.getItem(k), 10) || 0; } catch (e) {}
    if (Date.now() - last > 15000) { try { sessionStorage.setItem(k, String(Date.now())); } catch (e) {} location.reload(); }
  }
  function sync() {
    if (document.hidden) return;
    fetch(window.API + '?action=set_clock&id=' + el.dataset.set, { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) return;
        state = j.state; left = (j.sec === null ? NaN : j.sec); t0 = Date.now();
        if (state === 'open' && !isNaN(left) && left > 2) asked = false;     /* 연장됐다 — 다음 종료 때 다시 확인 */
        /* 화면이 서버보다 한두 초 먼저 0 에 닿은 경우 — 잠깐 뒤에 한 번 더 물어본다 */
        if (state === 'open' && !isNaN(left) && left <= 2) setTimeout(function () { asked = false; draw(); }, 1500);
        draw();
      })
      .catch(function () {});
  }
  draw();
  setInterval(draw, 1000);
  setInterval(sync, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) sync(); });
})();
</script>
JS;
  return $html . $js;
}

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

/* 평가는 기간(시작 ~ 종료) 밖에서 문제 목록과 문제 내용을 학생에게 보여 주지 않는다 (2.1.0).
   시작 전에 미리 읽거나 끝난 뒤에 다시 보는 것을 막는다. 수업은 기간 밖에도 볼 수 있고(예습 · 복습),
   교사(관리자)는 언제나 본다. 평가 화면 · 문제 화면 · 실행이 모두 이 함수로 판단한다.
   주의: 문제 모음에 열려 있는 문제는 평가를 거치지 않고 볼 수 있다 — 가리려면 문제를 잠가야 한다. */
function set_hidden_for(?array $u, array $s): bool {
  return ($s['set_type'] ?? '') === 'assessment' && !is_admin($u) && set_state($s) !== 'open';
}

/* 기간 밖(종료 뒤)의 평가에서 낸 제출은 학생에게 코드를 보여 주지 않는다 (2.1.0).
   문제를 가리는 것과 같은 기준(set_hidden_for)이라, 종료 시각을 미루면 문제와 코드가 함께 다시 보인다.
   판정 · 시각 · 문제 번호는 그대로 보인다. 교사는 언제나 본다. 수업 · 자유 풀이의 제출은 해당 없음.
   $r 에는 set_id · set_type · set_start · set_end (sets 의 start_at · end_at) 가 있어야 한다. */
function sub_code_hidden(?array $u, array $r): bool {
  if (empty($r['set_id']) || ($r['set_type'] ?? '') !== 'assessment') return false;
  return set_hidden_for($u, ['set_type' => 'assessment',
                             'start_at' => $r['set_start'] ?? null, 'end_at' => $r['set_end'] ?? null]);
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
  if (set_hidden_for($u, $set)) return false;      /* 기간 밖의 평가로는 잠긴 문제를 볼 수 없다 (2.1.0) */
  return (bool)one("SELECT 1 x FROM set_problems WHERE set_id=? AND problem_id=?",
                   [$setId, $p['id']]);
}

/* problem_visible() 을 목록용 SQL 조건으로 (1.6.2).
   이 사람이 볼 수 있는 문제 = 열린 문제 + (관리자는 모두) + 자기가 참여하는 수업·평가에 담긴 잠긴 문제.
   $owner 를 주면 그 열(예: s.user_id)이 보는 사람 자신인 행도 보여 준다 — 내 제출은 언제나 내가 본다.
   숫자만 끼워 넣으므로(정수 변환) 자리 표시자 없이 어느 쿼리에나 붙일 수 있다. */
function problem_visible_sql(?array $u, string $p = 'p', string $owner = ''): string {
  if (is_admin($u)) return '1';
  if (!$u) return "$p.active = 1";
  $uid = (int)$u['id'];
  $gid = isset($u['group_id']) && $u['group_id'] !== null ? (string)(int)$u['group_id'] : 'NULL';
  return "($p.active = 1"
       . ($owner !== '' ? " OR $owner = $uid" : '')
       . " OR EXISTS(SELECT 1 FROM set_problems vsp JOIN sets vs ON vs.id = vsp.set_id
                      WHERE vsp.problem_id = $p.id AND vs.active = 1
                        AND (vs.visibility = 'all'
                             OR EXISTS(SELECT 1 FROM set_targets vt WHERE vt.set_id = vs.id AND vt.group_id = $gid))))";
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

/* 이 사람이 지금 이 묶음에서 제출할 수 있는지 — 관리자는 언제나 (1.5.0) */
function set_open_for(?array $u, array $s): bool { return is_admin($u) || set_open($s); }

/* 관리자가 학생에게는 닫혀 있는 묶음을 볼 때 띄우는 안내 (열려 있으면 빈 문자열) */
function admin_preview_note(?array $u, array $s): string {
  if (!is_admin($u) || set_open($s)) return '';
  $why = set_locked($s) ? '잠겨 있어 학생에게 보이지 않습니다'
       : (set_state($s) === 'before' ? '시작 전이라 학생은 아직 제출할 수 없습니다'
                                     : '종료되어 학생은 제출할 수 없습니다');
  $who = $s['set_type'] === 'assessment' ? '평가는' : '수업은';
  return '<div class="note admin-preview"><b>관리자 미리보기</b> · 이 ' . $who . ' ' . $why . '. 관리자는 들어와서 풀어 볼 수 있습니다.</div>';
}

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

function is_admin(?array $u): bool { return $u !== null && ($u['role'] ?? '') === 'admin'; }

/* 교사 화면인지 (1.17.0) — 교사 계정이면서 '학생 화면으로 보기'를 켜지 않았을 때.
   문제 모음 · 수업 · 평가 · 공지사항은 학생과 교사가 같은 주소를 쓰고,
   교사 화면일 때만 관리 버튼과 정보를 더 보여 준다.
   ★ 권한이 아니라 '무엇을 보여 줄지'만 정한다. 관리 동작(POST)은 언제나 is_admin() 으로 확인한다. */
function teacher_view(?array $u): bool {
  return is_admin($u) && (bool)($_SESSION['admin_view'] ?? true);
}
function admin_user_id(int $uid): bool { return (string)col("SELECT role FROM users WHERE id=?", [$uid]) === 'admin'; }

/* 관리자는 모든 수업·평가를 본다 — 잠긴 것 · 반이 다른 것 · 기간 밖의 것까지 (1.5.0).
   학생에게 열기 전에 미리 풀어 볼 수 있게 하려는 것. */
function sets_for_student(array $u, string $type): array {
  if (is_admin($u)) {
    return all("SELECT s.*,
                  (SELECT COUNT(*) FROM set_problems sp WHERE sp.set_id = s.id) AS problem_cnt
                FROM sets s WHERE s.set_type = :ty " . SET_ORDER_SQL, [':ty' => $type]);
  }
  return all("SELECT s.*,
                (SELECT COUNT(*) FROM set_problems sp WHERE sp.set_id = s.id) AS problem_cnt
              FROM sets s
              WHERE s.set_type = :ty AND s.active = 1
                AND " . SET_VISIBLE_SQL . " " . SET_ORDER_SQL,
             [':ty' => $type, ':gid' => $u['group_id']]);
}

/* 이 학생이 이 묶음을 볼 수 있으면 묶음 정보를, 아니면 null */
function student_set_or_null(array $u, int $sid): ?array {
  if (is_admin($u)) return one("SELECT s.* FROM sets s WHERE s.id = ?", [$sid]);
  return one("SELECT s.* FROM sets s
              WHERE s.id = :sid AND s.active = 1
                AND " . SET_VISIBLE_SQL,
             [':sid' => $sid, ':gid' => $u['group_id']]);
}

/* ── 평가 입장 확인 (2.1.0) ─────────────────────
   평가마다 '허용 IP'와 '입장 코드'를 둘 수 있다 (sets.allow_ips · sets.entry_code).
   둘 다 비어 있으면 아무것도 확인하지 않는다. 수업에는 쓰지 않고, 교사(관리자)는 확인하지 않는다.
   평가 화면 · 문제 화면 · 제출 · 실행이 모두 set_gate() 하나로 판단한다 —
   화면에서만 막으면 요청을 직접 보내 지나갈 수 있기 때문이다. */

/* 서버가 본 접속 IP. 프록시를 거치지 않는 설치(nginx → PHP)를 기준으로 한다. */
function client_ip(): string {
  $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
  if (stripos($ip, '::ffff:') === 0 && strpos($ip, '.') !== false) $ip = substr($ip, 7);   /* IPv4 를 IPv6 꼴로 받은 경우 */
  return $ip;
}

/* 허용 IP 목록을 항목으로 나눈다. 쓸 수 있는 꼴:
     203.0.113.7        한 주소 (IPv6 도 됨)
     203.0.113.*        앞부분이 같은 주소 모두
     203.0.113.0/24     범위 (IPv4)
   돌려주는 값: ['ok' => 알아들은 항목, 'bad' => 못 알아들은 항목] */
function ip_list(?string $csv): array {
  $ok = []; $bad = [];
  foreach (preg_split('/[\s,]+/', (string)$csv, -1, PREG_SPLIT_NO_EMPTY) as $e) {
    if (strlen($e) > 45) { $bad[] = $e; continue; }
    if (filter_var($e, FILTER_VALIDATE_IP) !== false)                      $ok[$e] = true;
    elseif (preg_match('/^\d{1,3}(\.\d{1,3}){0,2}\.\*$/', $e))              $ok[$e] = true;
    elseif (preg_match('/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/', $e, $m)
            && filter_var($m[1], FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false && (int)$m[2] <= 32) $ok[$e] = true;
    else $bad[] = $e;
    if (count($ok) >= 30) break;
  }
  return ['ok' => array_keys($ok), 'bad' => $bad];
}

/* 이 IP 가 목록에 드는가. 목록이 비어 있으면 누구나 된다. */
function ip_allowed(string $ip, ?string $csv): bool {
  $list = ip_list($csv)['ok'];
  if (!$list) return true;
  if ($ip === '') return false;
  $bin = @inet_pton($ip);
  foreach ($list as $e) {
    if (substr($e, -2) === '.*') {
      if (strpos($ip, substr($e, 0, -1)) === 0) return true;
    } elseif (strpos($e, '/') !== false) {
      [$net, $bits] = explode('/', $e, 2);
      $a = ip2long($ip); $n = ip2long($net); $bits = (int)$bits;
      if ($a !== false && $n !== false) {
        $mask = $bits === 0 ? 0 : (~0 << (32 - $bits)) & 0xFFFFFFFF;
        if (($a & $mask) === ($n & $mask)) return true;
      }
    } else {
      $b = @inet_pton($e);
      if ($bin !== false && $b !== false && $bin === $b) return true;
    }
  }
  return false;
}

/* 이 로그인에서 이 평가의 입장 코드를 맞게 넣었는지. 코드를 바꾸면 다시 넣어야 한다. */
function set_code_mark(array $set): string {
  return sha1((int)$set['id'] . '|' . (string)($set['entry_code'] ?? ''));
}
function set_code_ok(array $set): bool {
  if (trim((string)($set['entry_code'] ?? '')) === '') return true;
  return (($_SESSION['set_code'][(int)$set['id']] ?? '') === set_code_mark($set));
}
/* 학생이 넣은 코드를 확인하고, 맞으면 이 로그인에 적어 둔다 */
function set_code_try(array $set, string $code): bool {
  if (!hash_equals(trim((string)($set['entry_code'] ?? '')), trim($code))) return false;
  $_SESSION['set_code'][(int)$set['id']] = set_code_mark($set);
  return true;
}

/* ── 엄격 모드 (2.1.0) ──────────────────────────
   평가 설정의 '엄격 모드'(sets.strict)를 켜면 세 가지가 함께 켜진다.
     1) 동시 접속 제한 — 나중에 로그인한 쪽만 유효하다. 먼저 접속은 이 평가 안에서 끊긴다.
     2) 접속 기록      — 들어올 때 IP 와 기기 표시를 적는다 (같은 기기를 쓴 다른 계정을 찾는 데 쓴다).
     3) 화면 이탈 기록 — 문제 화면을 떠났다 돌아오면 떠나 있던 시간을 적는다.
   막는 것은 1) 뿐이고 나머지는 기록이다. 현황 화면이 이 기록을 보여 준다. 교사(관리자)는 대상이 아니다. */
function set_strict(array $set): bool {
  return ($set['set_type'] ?? '') === 'assessment' && (int)($set['strict'] ?? 0) === 1;
}

/* 이 접속이 이 계정의 마지막 로그인인가.
   업데이트 전에 로그인해 표시가 없는 접속은 회원 표도 비어 있어 통과한다 — 다시 로그인하는 순간부터 가려진다. */
function login_is_latest(array $u): bool {
  $db = (string)col("SELECT COALESCE(login_token,'') FROM users WHERE id = ?", [$u['id']]);
  return hash_equals($db, (string)($_SESSION['login_token'] ?? ''));
}

/* 브라우저에 심어 두는 기기 표시. 없으면 새로 만든다 (머리글을 보내기 전에 불러야 한다).
   시크릿 창이나 다른 브라우저를 쓰면 달라지므로 증거가 아니라 정황이다. */
function device_token(): string {
  $t = (string)($_COOKIE['kc_dev'] ?? '');
  if (preg_match('/^[a-f0-9]{24}$/', $t)) return $t;
  $t = bin2hex(random_bytes(12));
  if (!headers_sent()) {
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
          || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    setcookie('kc_dev', $t, ['expires' => time() + 400 * 86400, 'path' => '/', 'samesite' => 'Lax',
                              'httponly' => true, 'secure' => $https]);
  }
  $_COOKIE['kc_dev'] = $t;
  return $t;
}

function set_event(int $sid, int $uid, string $kind, int $ms = 0, string $ip = '', string $dev = ''): void {
  db()->prepare("INSERT INTO set_events(set_id,user_id,kind,at,ms,ip,device) VALUES(?,?,?,?,?,?,?)")
     ->execute([$sid, $uid, $kind, now(), $ms, $ip, $dev]);
}

/* 엄격 모드 평가에 들어온 것을 적는다. 같은 접속 · 같은 IP · 같은 기기면 한 번만 적는다. */
function set_enter_note(array $u, array $set): void {
  if (is_admin($u) || !set_strict($set)) return;
  $sid = (int)$set['id']; $ip = client_ip(); $dev = device_token();
  $mark = $ip . '|' . $dev;
  if (($_SESSION['set_in'][$sid] ?? '') === $mark) return;
  $_SESSION['set_in'][$sid] = $mark;
  set_event($sid, (int)$u['id'], 'enter', 0, $ip, $dev);
}

/* 현황 화면의 '살펴볼 점' — 엄격 모드 평가에서 쌓인 기록을 학생별로 모은다.
   돌려주는 값: [user_id => ['away_n','away_ms','away_max','kick','ips' => [...], 'devs' => [...],
                             'shared' => [같은 기기를 쓴 다른 user_id ...],
                             'enter_n' 입장 기록 수, 'first_at' 첫 입장 시각, 'last_at' 마지막 입장 시각]]
   기록이 하나도 없는 학생은 들어 있지 않다. */
function set_watch(int $sid): array {
  $w = [];
  $blank = ['away_n' => 0, 'away_ms' => 0, 'away_max' => 0, 'kick' => 0, 'ips' => [], 'devs' => [], 'shared' => [],
            'enter_n' => 0, 'first_at' => '', 'last_at' => ''];
  foreach (all("SELECT user_id, kind, COUNT(*) n, COALESCE(SUM(ms),0) ms, COALESCE(MAX(ms),0) mx,
                       MIN(at) first_at, MAX(at) last_at
                FROM set_events WHERE set_id = ? GROUP BY user_id, kind", [$sid]) as $r) {
    $uid = (int)$r['user_id'];
    $w[$uid] ??= $blank;
    if ($r['kind'] === 'away') { $w[$uid]['away_n'] = (int)$r['n']; $w[$uid]['away_ms'] = (int)$r['ms']; $w[$uid]['away_max'] = (int)$r['mx']; }
    if ($r['kind'] === 'kick') { $w[$uid]['kick'] = (int)$r['n']; }
    if ($r['kind'] === 'enter') { $w[$uid]['enter_n'] = (int)$r['n']; $w[$uid]['first_at'] = (string)$r['first_at']; $w[$uid]['last_at'] = (string)$r['last_at']; }
  }
  $byDev = [];
  foreach (all("SELECT DISTINCT user_id, ip, device FROM set_events WHERE set_id = ?", [$sid]) as $r) {
    $uid = (int)$r['user_id'];
    $w[$uid] ??= $blank;
    if ($r['ip'] !== '')     $w[$uid]['ips'][$r['ip']] = true;
    if ($r['device'] !== '') { $w[$uid]['devs'][$r['device']] = true; $byDev[$r['device']][$uid] = true; }
  }
  foreach ($w as $uid => &$x) {
    $sh = [];
    foreach (array_keys($x['devs']) as $d) foreach (array_keys($byDev[$d]) as $o) if ($o !== $uid) $sh[$o] = true;
    $x['shared'] = array_keys($sh);
    $x['ips']    = array_keys($x['ips']);
    $x['devs']   = array_keys($x['devs']);
  }
  unset($x);
  return $w;
}
/* 입장 시각을 '시작 후 1분 23초' 꼴로 (2.1.0) — 평가에 시작 시각이 없으면 시:분:초 그대로.
   다른 학생보다 눈에 띄게 늦게 들어온 계정을 찾는 데 쓴다. */
function enter_text(array $set, string $at): string {
  if ($at === '') return '';
  $start = set_time_sec($set['start_at'] ?? null);
  $t = strtotime($at);
  if ($start === '' || $t === false || strtotime($start) === false) return substr($at, 11, 8);
  $d = $t - strtotime($start);
  return $d >= 0 ? '시작 후 ' . clock_text($d) : '시작 ' . clock_text(-$d) . ' 전';
}
/* 밀리초를 '1분 23초' 꼴로 */
function ms_text(int $ms): string {
  $s = (int)round($ms / 1000);
  if ($s < 60) return $s . '초';
  if ($s < 3600) return intdiv($s, 60) . '분 ' . ($s % 60) . '초';
  return intdiv($s, 3600) . '시간 ' . intdiv($s % 3600, 60) . '분';
}

/* 이 학생이 지금 이 평가에 들어올 수 있는가.
   들어올 수 있으면 null, 아니면 ['why' => 'ip' | 'kick' | 'code', 'msg' => 학생에게 보일 말]. */
function set_gate(array $u, array $set): ?array {
  if (is_admin($u) || ($set['set_type'] ?? '') !== 'assessment') return null;
  if (!ip_allowed(client_ip(), (string)($set['allow_ips'] ?? ''))) {
    return ['why' => 'ip', 'msg' => '이 평가는 정해진 장소에서만 응시할 수 있습니다.'];
  }
  if (set_strict($set) && !login_is_latest($u)) {
    $sid = (int)$set['id'];
    if (empty($_SESSION['set_kick'][$sid])) {          /* 끊긴 사실은 접속마다 한 번만 적는다 */
      $_SESSION['set_kick'][$sid] = 1;
      set_event($sid, (int)$u['id'], 'kick', 0, client_ip(), device_token());
    }
    return ['why' => 'kick', 'msg' => '이 계정으로 다른 곳에서 로그인해서, 이 접속으로는 평가를 계속할 수 없습니다.'];
  }
  if (!set_code_ok($set)) {
    return ['why' => 'code', 'msg' => '입장 코드를 넣어야 응시할 수 있습니다.'];
  }
  return null;
}

/* ── 사용 금지 단어 (2.1.0) ──────────────────────
   수업 · 평가에 담긴 문제마다 '이 문제에서는 쓸 수 없는 단어'를 정한다 (set_problems.banned).
   예) 정렬 문제에서 sort, sorted.

   글자를 찾는 단순한 검사다. 언어를 가리지 않고, 주석 · 문자열 안의 단어도 걸린다 —
   '이 단어는 코드 어디에도 쓰면 안 된다'가 규칙이다. 돌려서 쓰는 방법
   (getattr(a, 'so' + 'rt') 등)까지 막지는 못한다. 억제가 목적이다. */

/* 입력한 글자를 단어 목록으로. 쉼표 · 빈칸 · 줄바꿈으로 나누고 겹치는 것은 뺀다. */
function banned_list(?string $csv): array {
  $out = [];
  foreach (preg_split('/[\s,]+/u', (string)$csv, -1, PREG_SPLIT_NO_EMPTY) as $w) {
    if (strlen($w) > 40) continue;
    $out[$w] = true;
    if (count($out) >= 30) break;
  }
  return array_keys($out);
}
/* 저장할 모양으로 — 'sort, sorted' */
function banned_norm(?string $csv): string { return implode(', ', banned_list($csv)); }

/* 코드에 금지 단어가 있으면 처음 걸린 단어를, 없으면 null.
   단어 단위 · 대소문자 구분: 단어의 앞뒤가 이름에 쓰는 글자(영문자 · 숫자 · 밑줄)가 아닐 때만 걸린다.
   sort 금지 → a.sort() · sort(a) 는 걸리고 sorted · my_sort 는 안 걸린다.
   기호(**, % 등)처럼 이름 글자로 시작 · 끝나지 않는 쪽은 경계를 보지 않는다. */
function banned_hit(string $code, array $words): ?string {
  foreach ($words as $w) {
    $w = (string)$w;
    if ($w === '') continue;
    $re = (preg_match('/^[A-Za-z0-9_]/', $w) ? '(?<![A-Za-z0-9_])' : '')
        . preg_quote($w, '/')
        . (preg_match('/[A-Za-z0-9_]$/', $w) ? '(?![A-Za-z0-9_])' : '');
    if (preg_match('/' . $re . '/', $code)) return $w;
  }
  return null;
}

/* 이 묶음의 이 문제에서 금지한 단어 목록 */
function set_banned(int $sid, int $pid): array {
  return banned_list((string)col("SELECT banned FROM set_problems WHERE set_id=? AND problem_id=?", [$sid, $pid]));
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
