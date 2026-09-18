<?php
/* ═══════════════════════════════════════════════
   api.php — 채점 시스템의 JSON 엔드포인트.
   기존 api.php(타자 연습)는 건드리지 않는다.
   ═══════════════════════════════════════════════ */
declare(strict_types=1);
require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/layout.php';   // md()
require_once __DIR__ . '/judge0.php';    // 실행 결과 상태 코드
/* 무슨 일이 있어도 JSON 으로 응답한다.
   예외가 그대로 새어 나가면 PHP 오류 HTML 이 응답에 섞이고,
   브라우저가 그것을 JSON 으로 읽지 못해 "서버가 응답하지 않습니다" 가 뜬다. */
ob_start();
set_exception_handler(function (Throwable $e) {
  error_log('[api] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
  while (ob_get_level() > 0) ob_end_clean();
  $busy = is_busy_error($e);
  if (!headers_sent()) {
    http_response_code($busy ? 503 : 500);
    header('Content-Type: application/json; charset=utf-8');
  }
  echo json_encode([
    'ok'    => false,
    'error' => $busy
      ? '다른 학생의 저장이 끝나기를 기다리는 중입니다.'
      : '처리 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.',
    'retry' => true,
  ], JSON_UNESCAPED_UNICODE);
});
register_shutdown_function(function () {
  $e = error_get_last();
  if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
    while (ob_get_level() > 0) ob_end_clean();
    if (!headers_sent()) {
      http_response_code(500);
      header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode(['ok' => false, 'error' => '처리 중 문제가 생겼습니다.', 'retry' => true], JSON_UNESCAPED_UNICODE);
  }
});

db();

$action = $_GET['action'] ?? ($_POST['action'] ?? '');

/* 요청 본문(JSON). 회원·반 관리 액션이 $in 으로 읽는다.
   파일 업로드처럼 본문이 JSON 이 아닌 요청에서는 빈 배열이 된다. */
$in = body();

switch ($action) {

  /* 마크다운 미리보기 — 서버에서 렌더해 편집 화면과 실제 화면을 일치시킨다 */
  case 'preview': {
    require_admin();
    $src = body()['src'] ?? '';
    jout(['ok' => true, 'html' => md(is_string($src) ? $src : '')]);
  }

  /* 문제 설명에 넣을 이미지 업로드 */
  case 'upload_image': {
    require_admin();
    if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
      jerr('파일을 받지 못했습니다');
    }
    $f = $_FILES['file'];
    if ($f['size'] > 4 * 1024 * 1024) jerr('이미지는 4MB까지 올릴 수 있습니다');

    /* 확장자가 아니라 실제 내용으로 판별한다 */
    $info = @getimagesize($f['tmp_name']);
    $ext = match ($info['mime'] ?? '') {
      'image/png'  => 'png',
      'image/jpeg' => 'jpg',
      'image/gif'  => 'gif',
      'image/webp' => 'webp',
      default      => null,
    };
    if ($ext === null) jerr('PNG · JPG · GIF · WEBP 만 올릴 수 있습니다');

    $sub = 'uploads/problems/' . date('Ym');
    $dir = UPLOAD_DIR . '/problems/' . date('Ym');
    if (!is_dir($dir) && !@mkdir($dir, 0775, true)) jerr('업로드 폴더를 만들지 못했습니다', 500);

    $name = date('d') . '_' . bin2hex(random_bytes(6)) . '.' . $ext;
    if (!@move_uploaded_file($f['tmp_name'], $dir . '/' . $name)) jerr('파일을 저장하지 못했습니다', 500);
    @chmod($dir . '/' . $name, 0644);

    jout(['ok' => true, 'url' => '/' . $sub . '/' . $name]);
  }

  /* ── 학생: 코드 제출 ──────────────────────────
     기록만 남기고 즉시 응답한다. 실제 채점은 judge-worker.php 가 한다.
     이 분리 덕분에 100명이 몰려도 PHP 프로세스가 묶이지 않는다. */
  case 'submit': {
    $me = require_login();
    $b  = body();

    $pid   = (int)($b['problem_id'] ?? 0);
    $lang  = (string)($b['lang'] ?? '');
    $src   = nl_clean($b['source'] ?? '');
    $setId = isset($b['set_id']) && $b['set_id'] !== null ? (int)$b['set_id'] : null;

    if (!isset(langs()[$lang]))       jerr('지원하지 않는 언어입니다');
    if (trim($src) === '')          jerr('코드를 입력하세요');
    if (strlen($src) > 64 * 1024)   jerr('코드가 너무 깁니다 (64KB 이내)');

    $p = one("SELECT id, prob_no, active FROM problems WHERE id = ?", [$pid]);
    if (!$p) jerr('문제를 찾을 수 없습니다', 404);
    if (!problem_visible($me, $p, $setId)) jerr('지금은 제출할 수 없는 문제입니다', 403);

    $tcCnt = (int)col("SELECT COUNT(*) FROM testcases WHERE problem_id = ?", [$pid]);
    if ($tcCnt === 0) jerr('이 문제는 아직 채점 준비가 되지 않았습니다');

    /* 묶음 안에서 낸 제출인지 확인한다.
       화면에서 막는 것만으로는 부족하다 — 요청을 직접 보낼 수 있으므로
       볼 수 있는 묶음인지, 기간이 열려 있는지, 그 묶음의 문제가 맞는지 서버가 확인한다. */
    if ($setId !== null) {
      $set = student_set_or_null($me, $setId);
      if (!$set) jerr('참여할 수 없는 수업·평가입니다', 403);
      if (!one("SELECT 1 x FROM set_problems WHERE set_id=? AND problem_id=?", [$setId, $pid])) {
        jerr('이 수업·평가에 없는 문제입니다', 403);
      }
      if (!set_open($set)) {
        jerr(set_state($set) === 'before' ? '아직 시작 전입니다' : '종료되었습니다', 403);
      }
      $allow = set_langs($set);
      if (!in_array($lang, $allow, true)) {
        $names = array_map('lang_label', $allow);
        jerr('이 평가에서는 ' . implode(', ', $names) . ' 로만 제출할 수 있습니다', 403);
      }
    }

    /* 연타 방지 — 마지막 제출로부터 최소 간격 */
    $last = col("SELECT created_at FROM submissions WHERE user_id = ? ORDER BY id DESC LIMIT 1",
                [$me['id']]);
    if ($last) {
      $wait = SUBMIT_COOLDOWN - (time() - strtotime((string)$last));
      if ($wait > 0) jerr($wait . '초 뒤에 다시 제출할 수 있습니다', 429);
    }

    $sid = tx(function (PDO $d) use ($me, $pid, $setId, $lang, $src, $b) {
      $d->prepare("INSERT INTO submissions(user_id,problem_id,set_id,lang,source_code,source_hash,
                   state,keystrokes,paste_blocked,edit_ms,created_at,queued_at)
                   VALUES(?,?,?,?,?,?, 'pending', ?,?,?, ?,?)")
        ->execute([
          $me['id'], $pid, $setId, $lang, $src, source_hash($src),
          isset($b['keystrokes'])    ? (int)$b['keystrokes']    : null,
          isset($b['paste_blocked']) ? (int)$b['paste_blocked'] : 0,
          isset($b['edit_ms'])       ? (int)$b['edit_ms']       : null,
          now(), now(),
        ]);
      return (int)$d->lastInsertId();
    });

    jout(['ok' => true, 'id' => $sid]);
  }

  /* ── 학생: 채점 결과 확인 (화면이 1초마다 물어본다) ── */
  case 'poll': {
    $me = require_login();
    $sid = (int)($_GET['id'] ?? 0);

    $s = one("SELECT s.*, st.set_type
              FROM submissions s
              LEFT JOIN sets st ON st.id = s.set_id
              WHERE s.id = ?", [$sid]);
    if (!$s) jerr('제출을 찾을 수 없습니다', 404);
    if ((int)$s['user_id'] !== (int)$me['id'] && $me['role'] !== 'admin') {
      jerr('내 제출만 볼 수 있습니다', 403);
    }

    $done = in_array($s['state'], ['done', 'error'], true);
    $out = [
      'ok'      => true,
      'id'      => (int)$s['id'],
      'state'   => $s['state'],
      'done'    => $done,
      'verdict' => $s['verdict'],
      'label'   => $s['verdict'] ? (VERDICT_NAME[$s['verdict']] ?? $s['verdict']) : null,
      'time'    => $s['max_time']   !== null ? (float)$s['max_time']   : null,
      'memory'  => $s['max_memory'] !== null ? (int)$s['max_memory']   : null,
      'message' => $s['compile_msg'],
    ];
    /* 테스트케이스가 몇 개인지, 몇 개를 통과했는지, 몇 번째에서 틀렸는지는
       학생에게 내려보내지 않는다. 화면에서 감추는 것만으로는 부족하고
       (개발자 도구로 응답을 볼 수 있다) 응답 자체에 담지 않아야 한다.
       테스트케이스 구성이 역추적되는 것을 막기 위해서다. */
    if ($me['role'] === 'admin') {
      $out['passed']   = $s['passed_count'] !== null ? (int)$s['passed_count'] : null;
      $out['total']    = $s['total_count']  !== null ? (int)$s['total_count']  : null;
      $out['fail_seq'] = $s['fail_seq']     !== null ? (int)$s['fail_seq']     : null;
    }

    /* 틀렸을 때 처음 어긋난 케이스를 보여준다.
       몇 번째 케이스인지는 알리지 않는다. */
    if ($s['verdict'] === 'WA' && $s['fail_expected'] !== null && diff_allowed($s)) {
      $d = diff_view($s['fail_expected'], $s['fail_output']);
      if ($d['mode'] !== 'toolong') {
        $inRaw = (string)$s['fail_input'];
        $d['input'] = mb_strlen($inRaw) > DIFF_FULL_CHARS
                    ? mb_substr($inRaw, 0, DIFF_FULL_CHARS) . "\n…"
                    : $inRaw;
      }
      $out['diff'] = $d;
    }

    /* 평가라면 진행률을 함께 보낸다. 통과할 때마다 화면이 다음 회차를 안내한다. */
    if ($s['set_type'] === 'assessment' && (int)$s['user_id'] === (int)$me['id']) {
      $needAc = (int)col("SELECT required_ac FROM set_problems WHERE set_id=? AND problem_id=?",
                         [$s['set_id'], $s['problem_id']]);
      $out['assess'] = [
        'ac'   => ac_count_in_set((int)$me['id'], (int)$s['problem_id'], (int)$s['set_id']),
        'need' => $needAc,
      ];
    }

    jout($out);
  }

  /* ── 학생: 직접 실행 ─────────────────────────
     자기가 정한 입력으로 코드를 돌려만 본다. 채점이 아니므로
     테스트케이스와 무관하고, 기록도 제출과 다른 표에 남는다. */
  case 'run': {
    $me = require_login();
    $b  = body();

    $pid  = (int)($b['problem_id'] ?? 0);
    $lang = (string)($b['lang'] ?? '');
    $src  = nl_clean($b['source'] ?? '');
    $in   = nl_clean($b['stdin'] ?? '');

    if (!isset(langs()[$lang])) jerr('지원하지 않는 언어입니다');
    if (trim($src) === '')      jerr('코드를 입력하세요');
    if (strlen($src) > 64 * 1024) jerr('코드가 너무 깁니다 (64KB 이내)');
    if (mb_strlen($in) > RUN_MAX_STDIN) jerr('입력이 너무 깁니다');

    $p = $pid ? one("SELECT id, active FROM problems WHERE id = ?", [$pid]) : null;
    if ($pid && !$p) jerr('문제를 찾을 수 없습니다', 404);
    /* 잠긴 문제를 실행 통로로 들여다보지 못하게 한다 */
    if ($p && !problem_visible($me, $p, isset($b['set_id']) ? (int)$b['set_id'] : null)) {
      jerr('지금은 실행할 수 없는 문제입니다', 403);
    }

    $last = col("SELECT created_at FROM runs WHERE user_id = ? ORDER BY id DESC LIMIT 1", [$me['id']]);
    if ($last) {
      $wait = RUN_COOLDOWN - (time() - strtotime((string)$last));
      if ($wait > 0) jerr($wait . '초 뒤에 다시 실행할 수 있습니다', 429);
    }

    $rid = tx(function (PDO $d) use ($me, $pid, $lang, $src, $in) {
      $d->prepare("INSERT INTO runs(user_id,problem_id,lang,source_code,stdin,state,created_at,queued_at)
                   VALUES(?,?,?,?,?, 'pending', ?,?)")
        ->execute([$me['id'], $pid ?: null, $lang, $src, $in, now(), now()]);
      return (int)$d->lastInsertId();
    });

    jout(['ok' => true, 'id' => $rid]);
  }

  /* ── 학생: 실행 결과 확인 ── */
  case 'run_poll': {
    $me  = require_login();
    $rid = (int)($_GET['id'] ?? 0);

    $r = one("SELECT * FROM runs WHERE id = ?", [$rid]);
    if (!$r) jerr('실행 기록을 찾을 수 없습니다', 404);
    if ((int)$r['user_id'] !== (int)$me['id'] && $me['role'] !== 'admin') {
      jerr('내 실행만 볼 수 있습니다', 403);
    }

    $done = in_array($r['state'], ['done', 'error'], true);
    $st   = (int)($r['status_id'] ?? 0);

    /* 실행 결과를 짧은 말로 옮긴다. 채점이 아니므로 맞고 틀림은 말하지 않는다. */
    $label = match (true) {
      $r['state'] === 'error'          => '실행하지 못했습니다',
      $st === J0_ACCEPTED              => '실행했습니다',
      $st === J0_CE                    => '컴파일 오류',
      $st === J0_TLE                   => '시간 초과',
      $st >= J0_RE_FIRST && $st <= J0_RE_LAST => '실행 중 오류',
      $st === J0_INTERNAL || $st === J0_EXEC_FORMAT => '실행 오류',
      default                          => null,
    };

    jout([
      'ok'      => true,
      'id'      => (int)$r['id'],
      'done'    => $done,
      'ok_run'  => $st === J0_ACCEPTED,
      'label'   => $label,
      'stdout'  => $r['stdout'],
      'stderr'  => $r['stderr'],
      'message' => trim((string)$r['compile_msg']) !== '' ? $r['compile_msg'] : $r['message'],
      'time'    => $r['time']   !== null ? (float)$r['time']   : null,
      'memory'  => $r['memory'] !== null ? (int)$r['memory']   : null,
    ]);
  }

  /* ═══════════ 관리자: 회원·반 ═══════════ */

  case 'users_bulk': {
    require_admin();
    // 한 줄에 하나씩: 아이디,비밀번호,이름,반   (쉼표 또는 탭 구분, 반은 선택)
    $made = 0; $skip = [];
    $st = db()->prepare("INSERT INTO users(login_id, pw_hash, name, role, group_id, created_at) VALUES(?,?,?,'student',?,?)");
    $fallback = trim((string)($in['group'] ?? ''));      // 4번째 열이 비었을 때 쓸 기본 반
    foreach (preg_split('/\r\n|\r|\n/', $in['csv'] ?? '') as $line) {
      $line = trim($line);
      if ($line === '') continue;
      $c = array_map('trim', preg_split('/[,\t]/', $line));
      if (count($c) < 2 || $c[0] === '' || $c[1] === '') { $skip[] = $line . ' (형식 오류)'; continue; }
      $gname = ($c[3] ?? '') !== '' ? $c[3] : $fallback;
      try {
        $st->execute([$c[0], password_hash($c[1], PASSWORD_DEFAULT), $c[2] ?? '', group_id_by_name($gname), now()]);
        $made++;
      } catch (PDOException $e) { $skip[] = $c[0] . ' (이미 존재)'; }
    }
    jout(['ok' => true, 'made' => $made, 'skipped' => $skip]);
  }
  case 'user_delete': {
    $adm = require_admin();
    $id = (int)($in['id'] ?? 0);
    if ($id === $adm['id'])  jerr('자기 자신은 삭제할 수 없습니다');
    if (is_root_admin($id))  jerr('최초 관리자 계정은 삭제할 수 없습니다');
    db()->prepare("DELETE FROM users WHERE id = ?")->execute([$id]);
    jout(['ok' => true]);
  }
  /* 이름만 바꾼다. 아이디는 학생이 로그인에 쓰는 값이라 바꾸지 않는다. */
  case 'user_set_name': {
    require_admin();
    $id   = (int)($in['id'] ?? 0);
    $name = trim((string)($in['name'] ?? ''));
    if ($name === '')            jerr('이름을 입력하세요');
    if (mb_strlen($name) > 30)   jerr('이름이 너무 깁니다 (30자까지)');
    if (!one("SELECT 1 FROM users WHERE id = ?", [$id])) jerr('없는 회원입니다');
    db()->prepare("UPDATE users SET name = ? WHERE id = ?")->execute([$name, $id]);
    jout(['ok' => true, 'name' => $name]);
  }
  case 'user_set_role': {
    $adm = require_admin();
    $id = (int)($in['id'] ?? 0);
    $role = ($in['role'] ?? '') === 'admin' ? 'admin' : 'student';
    if ($role !== 'admin') {
      if ($id === $adm['id']) jerr('자기 자신의 관리자 권한은 해제할 수 없습니다');
      if (is_root_admin($id)) jerr('최초 관리자 계정의 권한은 해제할 수 없습니다');
    }
    db()->prepare("UPDATE users SET role = ? WHERE id = ?")->execute([$role, $id]);
    jout(['ok' => true]);
  }
  /* 가입 승인. 거절은 user_delete 를 그대로 쓴다 —
     승인 대기 계정은 제출 기록이 없으므로 지워도 잃을 것이 없다. */
  case 'user_approve': {
    require_admin();
    $id = (int)($in['id'] ?? 0);
    db()->prepare("UPDATE users SET approved = 1 WHERE id = ? AND approved = 0")->execute([$id]);
    jout(['ok' => true]);
  }
  case 'user_setpw': {
    require_admin();
    $pw = $in['pw'] ?? '';
    if (ustrlen($pw) < 4) jerr('비밀번호는 4자 이상이어야 합니다');
    db()->prepare("UPDATE users SET pw_hash = ? WHERE id = ?")
        ->execute([password_hash($pw, PASSWORD_DEFAULT), (int)($in['id'] ?? 0)]);
    jout(['ok' => true]);
  }
  case 'user_set_group': {
    require_admin();
    $gid = (int)($in['group_id'] ?? 0);
    db()->prepare("UPDATE users SET group_id = ? WHERE id = ?")
        ->execute([$gid > 0 ? $gid : null, (int)($in['id'] ?? 0)]);
    jout(['ok' => true]);
  }
  /* 목록에서 체크한 학생들을 한 반으로 몰아넣기 */
  case 'users_set_group_bulk': {
    require_admin();
    $ids = array_map('intval', (array)($in['ids'] ?? []));
    if (!$ids) jerr('학생을 먼저 선택하세요');
    $gid = (int)($in['group_id'] ?? 0);
    tx(function (PDO $d) use ($ids, $gid) {
      $st = $d->prepare("UPDATE users SET group_id = ? WHERE id = ? AND role = 'student'");
      foreach ($ids as $id) $st->execute([$gid > 0 ? $gid : null, $id]);
    });
    jout(['ok' => true, 'n' => count($ids)]);
  }

  /* 선택한 학생을 한꺼번에 지운다. 제출 기록도 함께 사라진다 (users 의 ON DELETE CASCADE).
     자기 자신과 최초 관리자는 건너뛴다. 관리자 계정은 골라지지 않는다. */
  case 'users_delete_bulk': {
    $adm = require_admin();
    $ids = array_values(array_filter(array_map('intval', (array)($in['ids'] ?? []))));
    if (!$ids) jerr('학생을 먼저 선택하세요');
    $kept = [];
    $done = tx(function (PDO $d) use ($ids, $adm, &$kept) {
      $n = 0;
      $find = $d->prepare("SELECT id, login_id, role FROM users WHERE id = ?");
      $del  = $d->prepare("DELETE FROM users WHERE id = ?");
      foreach ($ids as $id) {
        $find->execute([$id]);
        $row = $find->fetch();
        if (!$row) continue;
        if ((int)$row['id'] === (int)$adm['id'] || is_root_admin((int)$row['id']) || $row['role'] !== 'student') {
          $kept[] = $row['login_id'];
          continue;
        }
        $del->execute([$id]);
        $n++;
      }
      return $n;
    });
    jout(['ok' => true, 'n' => $done, 'kept' => $kept]);
  }

  /* ═══════════ 관리자: 반 ═══════════ */
  case 'group_save': {
    require_admin();
    $name = trim((string)($in['name'] ?? ''));
    if ($name === '') jerr('반 이름을 입력하세요');
    $id = (int)($in['id'] ?? 0);
    try {
      if ($id > 0) db()->prepare("UPDATE groups SET name = ? WHERE id = ?")->execute([$name, $id]);
      else db()->prepare("INSERT INTO groups(name, sort, created_at) VALUES(?,0,?)")->execute([$name, now()]);
    } catch (PDOException $e) { jerr('같은 이름의 반이 이미 있습니다'); }
    jout(['ok' => true]);
  }
  case 'group_delete': {
    require_admin();
    $id = (int)($in['id'] ?? 0);
    tx(function (PDO $d) use ($id) {
      $d->prepare("UPDATE users SET group_id = NULL WHERE group_id = ?")->execute([$id]);
      $d->prepare("DELETE FROM groups WHERE id = ?")->execute([$id]);
    });
    jout(['ok' => true]);
  }

  default:
    jerr('알 수 없는 요청입니다: ' . $action, 404);
}
