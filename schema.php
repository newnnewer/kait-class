<?php
/* ═══════════════════════════════════════════════
   schema.php — DB 표 정의. 이 파일 하나만 보면 구조를 전부 알 수 있다.

   lib.php 의 db() 가 PRAGMA user_version 과 SCHEMA_VERSION 을 비교해
   다를 때만 ensure_schema() 를 부른다. 요청마다 돌지 않는다.

   모두 CREATE TABLE IF NOT EXISTS 이므로 몇 번 불러도 안전하다.
   ═══════════════════════════════════════════════ */
declare(strict_types=1);

/* 첫 관리자 계정.
   ★ 비밀번호는 정해 두지 않는다. 소스가 공개되어 있으므로 정해 둔 비밀번호는
     누구나 알 수 있다. 처음 만들 때 아무도 모르는 무작위 값을 넣고,
     설치한 사람이 터미널에서 reset-admin.php 로 직접 정한다. */
const FIRST_ADMIN_ID = 'admin';

function ensure_schema(PDO $p): void {
  $fresh = !schema_has_table($p, 'users');

  /* ── 사람 ──────────────────────────────────────
     groups 를 먼저 만든다 (users 가 참조한다).

     source  일괄 등록·관리자가 만든 계정은 'admin',
             직접 가입한 계정은 'signup'. 가입 계정은 반이 없고
             name 칸에 실명 대신 닉네임이 들어간다.
     approved 가입 계정은 0 으로 생기고 관리자가 승인해야 1 이 된다.
             승인 전에는 로그인 자체를 막는다 — 로그인은 되는데
             아무것도 못 하는 상태가 더 헷갈리기 때문이다. */
  $p->exec("
    CREATE TABLE IF NOT EXISTS groups(
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users(
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      login_id TEXT UNIQUE NOT NULL,
      pw_hash  TEXT NOT NULL,
      name     TEXT NOT NULL DEFAULT '',
      role     TEXT NOT NULL DEFAULT 'student',   -- 'student' | 'admin'
      group_id INTEGER REFERENCES groups(id),
      source   TEXT    NOT NULL DEFAULT 'admin',  -- 'admin' | 'signup'
      approved INTEGER NOT NULL DEFAULT 1,        -- 0 이면 승인 대기
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_pending ON users(approved, id DESC);
  ");

  /* ── 문제 ──────────────────────────────────────
     prob_no 는 화면에 보이는 번호다. id 와 따로 두어
     번호를 바꿔도 제출 기록이 따라가지 않게 한다.

     show_diff  틀렸을 때 입력·기대 출력·내 출력을 보여줄지.
                기대 출력을 보여주면 입력이 어느 정도 역추적되므로
                변별이 필요한 문제에서는 끌 수 있다.
     active     0 이면 목록에 없고 주소로도 못 들어간다.
                단, 그 문제가 담긴 수업·평가 참여자는 ?set=N 으로 볼 수 있다.
                새로 만들거나 가져온 문제는 잠긴 상태로 생긴다. */
  $p->exec("
    CREATE TABLE IF NOT EXISTS problems(
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      prob_no INTEGER UNIQUE NOT NULL,
      title   TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      input_desc  TEXT NOT NULL DEFAULT '',
      output_desc TEXT NOT NULL DEFAULT '',
      time_limit   REAL    NOT NULL DEFAULT 2.0,
      memory_limit INTEGER NOT NULL DEFAULT 128000,
      active    INTEGER NOT NULL DEFAULT 1,
      show_diff INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tags(
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS problem_tags(
      problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
      tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY(problem_id, tag_id)
    );

    /* 테스트케이스 개수가 그대로 채점 비용에 곱해진다.
       케이스 하나당 CPU 약 0.5초 — 5개 안팎으로 맞추는 것이
       코어를 두 배로 늘리는 것과 같은 효과다. */
    CREATE TABLE IF NOT EXISTS testcases(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
      seq        INTEGER NOT NULL DEFAULT 0,
      input      TEXT NOT NULL DEFAULT '',
      expected   TEXT NOT NULL DEFAULT '',
      is_sample  INTEGER NOT NULL DEFAULT 0   -- 1 이면 문제에 예시로 공개
    );
    CREATE INDEX IF NOT EXISTS idx_tc_problem ON testcases(problem_id, seq);
  ");

  /* ── 문제 묶음 (수업 / 평가) ────────────────────
     visibility  'groups' 면 set_targets 에 적힌 반만 본다.
                 반이 한 건도 없으면 아무도 못 본다 — 편집 화면에서
                 반을 고르지 않으면 저장을 막으므로 그런 상태는 생기지 않는다.
                 'all' 이면 외부 가입 회원을 포함한 모든 회원이 본다.
     no_paste    붙여넣기를 막을지. 수업은 0, 평가는 1 로 만든다.
                 평가에서 붙여넣기를 허용하면 required_ac 는 1 로 고정한다 —
                 같은 코드를 여러 번 붙여넣어 횟수를 채울 수 있기 때문이다. */
  $p->exec("
    CREATE TABLE IF NOT EXISTS sets(
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      set_type TEXT NOT NULL DEFAULT 'lesson',     -- 'lesson' | 'assessment'
      title    TEXT NOT NULL,
      start_at TEXT,                               -- NULL 이면 그 방향 제한 없음
      end_at   TEXT,
      active     INTEGER NOT NULL DEFAULT 1,       -- 0 이면 학생에게 안 보임
      langs      TEXT    NOT NULL DEFAULT 'py,c',  -- 쓸 수 있는 언어 (쉼표 구분)
      show_diff  INTEGER NOT NULL DEFAULT 1,
      visibility TEXT    NOT NULL DEFAULT 'groups',-- 'groups' | 'all'
      no_paste   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS set_targets(
      set_id   INTEGER NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      PRIMARY KEY(set_id, group_id)
    );

    CREATE TABLE IF NOT EXISTS set_problems(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      set_id      INTEGER NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
      problem_id  INTEGER NOT NULL REFERENCES problems(id),
      required_ac INTEGER NOT NULL DEFAULT 2,   -- 평가에서만 의미
      sort        INTEGER NOT NULL DEFAULT 0,
      UNIQUE(set_id, problem_id)
    );
  ");

  /* ── 제출 ──────────────────────────────────────
     웹은 여기 한 줄 남기고 즉시 응답한다. 채점은 상주 워커가 한다.
     채점을 기다리며 PHP 프로세스가 묶이면 수십 건만 쌓여도 사이트가 느려진다.

     priority   0=학생 제출, 1=재채점. 재채점을 뒤로 밀어
                수업 중에 돌려도 학생이 기다리지 않게 한다.
     queued_at  대기열에 들어간 시각. 제출 시각과 따로 둔다 —
                어제 낸 제출을 오늘 재채점할 때 '이미 오래 기다렸다'고
                잘못 판단해 즉시 포기하던 문제가 있었다.
     keystrokes 평가 증빙. 수업·자유 풀이에서는 NULL. */
  $p->exec("
    CREATE TABLE IF NOT EXISTS submissions(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      problem_id INTEGER NOT NULL REFERENCES problems(id),
      set_id     INTEGER REFERENCES sets(id) ON DELETE SET NULL,  -- NULL = 자유 풀이

      lang        TEXT NOT NULL,        -- languages.lang_key
      source_code TEXT NOT NULL,
      source_hash TEXT NOT NULL,

      state   TEXT NOT NULL DEFAULT 'pending',  -- pending | judging | done | error
      verdict TEXT,                             -- AC WA TLE MLE RE CE IE

      passed_count INTEGER,
      total_count  INTEGER,
      max_time     REAL,
      max_memory   INTEGER,
      compile_msg  TEXT,
      fail_seq     INTEGER,             -- 처음 실패한 케이스 번호 (관리자만)
      tokens       TEXT,                -- Judge0 토큰 JSON

      keystrokes    INTEGER,
      paste_blocked INTEGER NOT NULL DEFAULT 0,
      edit_ms       INTEGER,

      priority  INTEGER NOT NULL DEFAULT 0,
      queued_at TEXT,

      fail_input TEXT, fail_expected TEXT, fail_output TEXT,

      created_at TEXT NOT NULL,
      judged_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sub_state  ON submissions(state, id);
    CREATE INDEX IF NOT EXISTS idx_sub_mine   ON submissions(user_id, problem_id, verdict);
    CREATE INDEX IF NOT EXISTS idx_sub_recent ON submissions(id DESC);
    CREATE INDEX IF NOT EXISTS idx_sub_set    ON submissions(set_id, user_id, problem_id);
  ");

  /* 학생이 자기 입력으로 코드를 돌려보는 '직접 실행'.
     제출과 같은 표에 넣으면 채점 결과 목록·문제별 제출 수·평가 통과 횟수에
     모두 섞인다. 걸러낼 곳이 한 군데라도 빠지면 성적이 어긋난다.
     오래 둘 이유도 없어서 워커가 하루 지난 것을 지운다. */
  $p->exec("
    CREATE TABLE IF NOT EXISTS runs(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      problem_id INTEGER,
      lang       TEXT NOT NULL,
      source_code TEXT NOT NULL,
      stdin      TEXT NOT NULL DEFAULT '',
      state      TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | error
      status_id  INTEGER,
      stdout TEXT, stderr TEXT, compile_msg TEXT, message TEXT,
      time   REAL, memory INTEGER,
      token  TEXT,
      created_at TEXT NOT NULL, queued_at TEXT, finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_run_state ON runs(state, id);
    CREATE INDEX IF NOT EXISTS idx_run_user  ON runs(user_id, id);
  ");

  /* ── 운영 ──────────────────────────────────────
     languages   Judge0 가 60개 넘는 언어를 채점할 수 있으므로
                 코드에 박지 않고 화면에서 열고 닫는다.
     login_attempts
                 학교는 공인 IP 하나를 온 학생이 함께 쓴다.
                 IP 로 막으면 한 명 때문에 전교생이 막히므로 계정으로 센다.
     settings    이름-값 쌍. 설정이 늘어도 표를 고칠 필요가 없다.
                 값이 없으면 코드의 기본값을 쓴다 (lib.php 의 setting()). */
  $p->exec("
    CREATE TABLE IF NOT EXISTS languages(
      lang_key  TEXT PRIMARY KEY,            -- py, c, cpp …
      judge0_id INTEGER NOT NULL,
      label     TEXT NOT NULL,               -- 화면에 보일 이름
      editor    TEXT NOT NULL DEFAULT '',    -- 편집기 문법 모드
      opts      TEXT NOT NULL DEFAULT '',    -- 컴파일 옵션 (예: -lm)
      active    INTEGER NOT NULL DEFAULT 1,
      sort      INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS notices(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title  TEXT NOT NULL,
      body   TEXT NOT NULL DEFAULT '',       -- 마크다운
      pinned INTEGER NOT NULL DEFAULT 0,     -- 1 이면 목록 맨 위
      active INTEGER NOT NULL DEFAULT 1,     -- 0 이면 학생에게 안 보임
      author_id INTEGER,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notice_list ON notices(active, pinned DESC, id DESC);

    CREATE TABLE IF NOT EXISTS login_attempts(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login_id TEXT NOT NULL,
      ip TEXT NOT NULL DEFAULT '',
      ok INTEGER NOT NULL DEFAULT 0,
      at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_login_try ON login_attempts(login_id, at);

    CREATE TABLE IF NOT EXISTS settings(
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );
  ");

  /* 처음 만들 때만 넣는 것 ------------------------------------ */

  if ((int)$p->query("SELECT COUNT(*) FROM languages")->fetchColumn() === 0) {
    $p->exec("INSERT INTO languages(lang_key,judge0_id,label,editor,opts,active,sort) VALUES
              ('py', 71, 'Python3', 'python', '', 1, 0),
              ('c',  50, 'C(GCC)',  'c',      '', 1, 1)");
  }

  if ($fresh) {
    $p->prepare("INSERT INTO users(login_id, pw_hash, name, role, source, approved, created_at)
                 VALUES(?,?,?,'admin','admin',1,?)")
      ->execute([
        FIRST_ADMIN_ID,
        password_hash(bin2hex(random_bytes(24)), PASSWORD_DEFAULT),
        '관리자',
        date('Y-m-d H:i:s'),
      ]);
  }

  $p->exec('PRAGMA user_version = ' . SCHEMA_VERSION);
}

function schema_has_table(PDO $p, string $t): bool {
  $st = $p->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?");
  $st->execute([$t]);
  $r = (bool)$st->fetch();
  $st->closeCursor();
  return $r;
}
