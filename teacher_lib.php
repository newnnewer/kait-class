<?php
/* teacher_lib.php — 문제 모음 · 수업 · 평가 · 공지사항의 교사 화면 (1.17.0)

   예전에는 같은 목록이 학생용(problems.php 등)과 관리용(admin/problems.php 등)으로 나뉘어,
   학생 화면에서 보다가 고치려면 관리자 화면으로 옮겨 가야 했다.
   이제 주소는 하나이고, 교사 화면일 때(teacher_view()) 이 파일의 화면을 그린다.
   학생 · 로그인하지 않은 사람의 화면은 각 파일의 원래 코드 그대로다.

   ★ 관리 동작(POST)은 '보기'와 상관없이 is_admin() 으로 다시 확인한다.
     problems.php 같은 화면은 로그인하지 않아도 열리므로, 확인을 빠뜨리면 누구나 지울 수 있게 된다.
   ★ 함수만 들어 있다. 주소로 직접 열면 아무것도 하지 않는다. */
declare(strict_types=1);

if (realpath((string)($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) {
  http_response_code(404); exit;
}

/* 지금 주소(검색 · 분류 · 쪽 번호 포함) — 버튼을 처리한 뒤 같은 화면으로 돌아오게 */
function teacher_self(string $page): string {
  $qs = (string)($_SERVER['QUERY_STRING'] ?? '');
  return $page . ($qs !== '' ? '?' . $qs : '');
}

/* 관리 동작은 교사만. 아니면 아무것도 하지 않고 목록으로 돌려보낸다. */
function teacher_need_admin(?array $u, string $back): void {
  if (!is_admin($u)) { header('Location: ' . $back); exit; }
}

/* ═══ 문제 모음 ═══════════════════════════════════════
   (예전 admin/problems.php 의 내용. 링크만 루트 기준으로 바꿨다) */

function teacher_problems_post(?array $u): void {
  teacher_need_admin($u, 'problems.php');
  $do  = (string)($_POST['do'] ?? '');
  $ids = array_values(array_filter(array_map('intval', (array)($_POST['ids'] ?? []))));
  $msg = ''; $err = '';

  if (!in_array($do, ['open', 'lock', 'mkset', 'delete'], true)) {
    redirect_with('', '알 수 없는 동작입니다.');
  }
  if (!$ids) redirect_with('', '문제를 먼저 고르세요.');

  /* 목록에서 바로 열고 잠그기 — 여러 개를 한꺼번에도 된다 */
  if ($do === 'open' || $do === 'lock') {
    $on = $do === 'open' ? 1 : 0;
    tx(function (PDO $d) use ($ids, $on) {
      $st = $d->prepare("UPDATE problems SET active = ? WHERE id = ?");
      foreach ($ids as $id) $st->execute([$on, $id]);
    });
    $msg = count($ids) . '개를 ' . ($on ? '열었습니다.' : '잠갔습니다.');
  }

  /* 선택한 문제로 수업 · 평가 만들기 —
     여기서 묶음을 만들지는 않는다. 고른 번호를 편집 화면에 넘겨, 거기서 이름 · 기간 · 공개 대상을
     정하고 저장할 때 만들어진다. 중간에 그만두어도 빈 묶음이 남지 않는다. */
  if ($do === 'mkset') {
    $ph   = implode(',', array_fill(0, count($ids), '?'));
    $nos  = array_map(fn($r) => (int)$r['prob_no'],
                      all("SELECT prob_no FROM problems WHERE id IN ($ph) ORDER BY prob_no", $ids));
    $type = ($_POST['set_type'] ?? '') === 'assessment' ? 'assessment' : 'lesson';
    header('Location: admin/set.php?type=' . $type . '&nos=' . implode(',', $nos)); exit;
  }

  /* 선택한 문제 삭제 —
     수업 · 평가에 들어 있는 문제는 지울 수 없다. 하나라도 그런 것이 있으면 아무것도 지우지 않는다.
     (정말 지우려면 그 수업 · 평가에서 먼저 뺀다.)
     제출 기록은 문제와 함께 지운다. 남겨 두면 어느 문제의 제출인지 알 수 없어진다. */
  if ($do === 'delete') {
    $ph    = implode(',', array_fill(0, count($ids), '?'));
    $inSet = all("SELECT DISTINCT p.prob_no,
                         (SELECT GROUP_CONCAT(s.title, ', ') FROM set_problems sp2
                            JOIN sets s ON s.id = sp2.set_id WHERE sp2.problem_id = p.id) AS sets
                  FROM problems p JOIN set_problems sp ON sp.problem_id = p.id
                  WHERE p.id IN ($ph) ORDER BY p.prob_no", $ids);
    if ($inSet) {
      $lines = array_map(fn($r) => $r['prob_no'] . '번 (' . $r['sets'] . ')', $inSet);
      $err = '수업 · 평가에 쓰이고 있어 삭제하지 않았습니다 — ' . implode(' · ', $lines)
           . '. 먼저 그 수업 · 평가에서 뺀 뒤 다시 시도하세요.';
    } else {
      $subs = (int)col("SELECT COUNT(*) FROM submissions WHERE problem_id IN ($ph)", $ids);
      tx(function (PDO $d) use ($ids) {
        $st = [
          $d->prepare("DELETE FROM submissions   WHERE problem_id = ?"),
          $d->prepare("DELETE FROM runs          WHERE problem_id = ?"),
          $d->prepare("DELETE FROM testcases     WHERE problem_id = ?"),
          $d->prepare("DELETE FROM problem_tags  WHERE problem_id = ?"),
          $d->prepare("DELETE FROM problems      WHERE id = ?"),
        ];
        foreach ($ids as $id) foreach ($st as $q1) $q1->execute([$id]);
      });
      $msg = count($ids) . '개를 삭제했습니다.'
           . ($subs ? ' 제출 기록 ' . number_format($subs) . '건도 함께 지웠습니다.' : '');
    }
  }
  /* 처리한 뒤에는 같은 주소로 다시 이동 — 새로고침해도 다시 실행되지 않게 */
  redirect_with($msg, $err);
}

function teacher_problems_page(array $u): void {
  [$msg, $err] = flash_take();
  $q     = trim((string)($_GET['q'] ?? ''));
  $tag   = trim((string)($_GET['tag'] ?? ''));
  $state = (string)($_GET['state'] ?? '');   /* '' | open | locked — 교사 화면에만 */

  $sql = "SELECT p.id, p.prob_no, p.title, p.time_limit, p.memory_limit, p.active,
                 (SELECT COUNT(*) FROM testcases t WHERE t.problem_id = p.id) AS tc_cnt,
                 (SELECT COUNT(*) FROM submissions s WHERE s.problem_id = p.id) AS sub_cnt
          FROM problems p";
  $args = []; $where = [];
  if ($q !== '') {
    $where[] = "(p.title LIKE :q OR CAST(p.prob_no AS TEXT) LIKE :q)";
    $args[':q'] = '%' . $q . '%';
  }
  if ($tag !== '') {
    $where[] = "EXISTS(SELECT 1 FROM problem_tags pt JOIN tags tg ON tg.id = pt.tag_id
                       WHERE pt.problem_id = p.id AND tg.name = :tag)";
    $args[':tag'] = $tag;
  }
  if ($state === 'open')   $where[] = "p.active = 1";
  if ($state === 'locked') $where[] = "p.active = 0";
  if ($where) $sql .= " WHERE " . implode(' AND ', $where);
  $sql .= " ORDER BY p.prob_no";

  $all    = all($sql, $args);
  $total  = count($all);
  $locked = count(array_filter($all, fn($r) => !(int)$r['active']));
  $per    = 50;
  $pages  = max(1, (int)ceil($total / $per));
  $page   = max(1, min($pages, (int)($_GET['p'] ?? 1)));
  $rows   = array_slice($all, ($page - 1) * $per, $per);
  $tmap   = tags_map();
  $alltg  = tags_all();
  $self   = teacher_self('problems.php');

  page_head(['title' => '문제 모음', 'root' => '', 'user' => $u, 'nav' => 'problems']);
?>
<div class="wrap">

  <div class="phead">
    <h1>문제 모음</h1>
    <span class="sub"><?= number_format($total) ?>문제<?= $locked ? ' · 잠김 ' . number_format($locked) . '개' : '' ?></span>
    <div class="grow"></div>
    <a class="btn" href="admin/stats.php">통계</a>
    <a class="btn" href="admin/renumber.php">번호 일괄 수정</a>
    <a class="btn" href="admin/import.php">가져오기</a>
    <a class="btn primary" href="admin/problem.php">새 문제</a>
  </div>

  <?php if ($msg): ?><div class="note ok"><?= h($msg) ?></div><?php endif; ?>
  <?php if ($err): ?><div class="note bad"><?= h($err) ?></div><?php endif; ?>

  <form class="searchbar" method="get">
    <input type="text" name="q" value="<?= h($q) ?>" placeholder="번호 또는 제목">
    <select name="tag">
      <option value="">전체 분류</option>
      <?php foreach ($alltg as $t): ?>
        <option value="<?= h($t['name']) ?>" <?= $tag === $t['name'] ? 'selected' : '' ?>>
          <?= h($t['name']) ?> (<?= (int)$t['use_cnt'] ?>)
        </option>
      <?php endforeach; ?>
    </select>
    <select name="state">
      <option value="">열림 · 잠김 모두</option>
      <option value="open"   <?= $state === 'open'   ? 'selected' : '' ?>>열린 문제</option>
      <option value="locked" <?= $state === 'locked' ? 'selected' : '' ?>>잠긴 문제</option>
    </select>
    <button class="btn" type="submit">찾기</button>
    <?php if ($q !== '' || $tag !== '' || $state !== ''): ?>
      <a class="btn" href="problems.php">초기화</a>
    <?php endif; ?>
  </form>

  <?php if (!$rows): ?>
    <div class="empty">
      <?= ($q !== '' || $tag !== '' || $state !== '') ? '조건에 맞는 문제가 없습니다.' : '아직 등록된 문제가 없습니다.' ?>
    </div>
  <?php else: ?>
    <form method="post" action="admin/export.php" id="expform">
    <div class="bulkbar">
      <label class="chk"><input type="checkbox" id="chkAll"> 전체 선택</label>
      <span class="small muted" id="pickCount">선택 0개</span>
      <div class="grow"></div>
      <?php /* 두 줄로 고정 (1.17.0) — 윗줄은 고른 문제에 하는 일, 아랫줄은 내보내기 */ ?>
      <button class="btn" type="submit" formaction="<?= h($self) ?>" name="do" value="open">열기</button>
      <button class="btn" type="submit" formaction="<?= h($self) ?>" name="do" value="lock">잠그기</button>
      <span class="sepline"></span>
      <button class="btn" type="submit" formaction="<?= h($self) ?>" name="do" value="mkset"
              onclick="this.form.set_type.value='lesson'">수업 만들기</button>
      <button class="btn" type="submit" formaction="<?= h($self) ?>" name="do" value="mkset"
              onclick="this.form.set_type.value='assessment'">평가 만들기</button>
      <span class="sepline"></span>
      <button class="btn danger" type="submit" formaction="<?= h($self) ?>" name="do" value="delete"
              onclick="return confirmDelete()">삭제</button>
      <span class="brk"></span>
      <div class="grow"></div>
      <span class="small muted">내보내기</span>
      <button class="btn" type="submit">선택한 문제</button>
      <button class="btn" type="submit" name="all" value="1">전체</button>
      <span class="sepline"></span>
      <?php /* 번호로 내보내기 — 아래의 따로 된 폼(nosform)으로 보낸다.
               같은 폼에 두면 번호 칸에서 Enter 를 칠 때 맨 앞 버튼(열기)이 눌린다. */ ?>
      <input class="code nosin" type="text" name="nos" form="nosform" placeholder="1001-1010, 1015"
             aria-label="내보낼 문제 번호" title="번호를 쉼표로, 범위는 1001-1010 처럼">
      <button class="btn" type="submit" form="nosform">번호로</button>
    </div>
    <input type="hidden" name="set_type" value="lesson">
    <table class="list tprobs">
      <thead>
        <tr>
          <th style="width:34px"></th>
          <th class="center" style="width:62px">상태</th>
          <th style="width:80px">번호</th>
          <th>제목</th>
          <th style="width:170px">분류</th>
          <th class="center" style="width:70px">테스트</th>
          <th class="right" style="width:70px">제출</th>
          <th class="right" style="width:110px">제한</th>
        </tr>
      </thead>
      <tbody>
      <?php foreach ($rows as $r): $pid = (int)$r['id']; ?>
        <tr class="<?= (int)$r['active'] ? '' : 'dim' ?>">
          <td><input type="checkbox" class="pick" name="ids[]" value="<?= $pid ?>"
                     data-no="<?= (int)$r['prob_no'] ?>" data-sub="<?= (int)$r['sub_cnt'] ?>"></td>
          <td class="center">
            <?php if ((int)$r['active']): ?><span class="v v-AC">열림</span>
            <?php else: ?><span class="v v-wait">잠김</span><?php endif; ?>
          </td>
          <td class="num"><?= (int)$r['prob_no'] ?></td>
          <td class="title"><a href="problem.php?no=<?= (int)$r['prob_no'] ?>"><?= h($r['title']) ?></a></td>
          <td>
            <?php foreach ($tmap[$pid] ?? [] as $tn): ?>
              <a class="tag" href="?tag=<?= rawurlencode($tn) ?>"><?= h($tn) ?></a>
            <?php endforeach; ?>
          </td>
          <td class="center num">
            <a class="codelink" href="admin/testcases.php?id=<?= $pid ?>" title="테스트케이스 관리">
              <?php if ((int)$r['tc_cnt'] === 0): ?>
                <span style="color:var(--bad)">없음</span>
              <?php else: ?>
                <?= (int)$r['tc_cnt'] ?>개
              <?php endif; ?>
            </a>
          </td>
          <td class="right num"><?= (int)$r['sub_cnt'] ?></td>
          <td class="right num"><?= rtrim(rtrim(number_format((float)$r['time_limit'], 1), '0'), '.') ?>초 / <?= (int)round($r['memory_limit'] / 1000) ?>MB</td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
    <?= pager($page, $pages) ?>
    </form>
    <form method="post" action="admin/export.php" id="nosform"></form>
  <?php endif; ?>

</div>

<script>
(function(){
  var all = document.getElementById('chkAll');
  if (!all) return;
  var picks = function(){ return document.querySelectorAll('.pick:checked'); };
  var refresh = function(){
    document.getElementById('pickCount').textContent = '선택 ' + picks().length + '개';
  };
  all.addEventListener('change', function(){
    document.querySelectorAll('.pick').forEach(function(c){ c.checked = all.checked; });
    refresh();
  });
  document.querySelectorAll('.pick').forEach(function(c){ c.addEventListener('change', refresh); });

  /* 삭제는 되돌릴 수 없다. 무엇이 사라지는지 보여 주고 '삭제' 를 직접 치게 한다.
     (수업 · 평가에 쓰이는 문제인지는 서버가 다시 확인해 막는다) */
  window.confirmDelete = function(){
    var picked = Array.prototype.slice.call(picks());
    if (!picked.length) { alert('삭제할 문제를 먼저 선택하세요.'); return false; }
    var nos = picked.slice(0, 10).map(function(c){ return c.dataset.no + '번'; }).join(', ')
            + (picked.length > 10 ? ' 외 ' + (picked.length - 10) + '개' : '');
    var subs = picked.reduce(function(a, c){ return a + (+c.dataset.sub || 0); }, 0);
    var ans = prompt(
      '문제 ' + picked.length + '개를 삭제합니다.\n' + nos + '\n\n'
      + (subs ? '학생 제출 기록 ' + subs + '건도 함께 사라집니다. ' : '')
      + '되돌릴 수 없습니다.\n계속하려면 아래에 삭제 라고 입력하세요.');
    if (ans === null) return false;
    if (ans.trim() !== '삭제') { alert('삭제하지 않았습니다.'); return false; }
    return true;
  };
})();
</script>
<?php
  page_foot();
}

/* ═══ 수업 · 평가 ═════════════════════════════════════
   (예전 admin/sets.php 의 내용을 학생 목록과 같은 카드 모양으로) */

function teacher_sets_post(?array $u, string $type): void {
  teacher_need_admin($u, $type === 'assessment' ? 'assessments.php' : 'lessons.php');
  /* 열기 · 잠그기는 '뒤집기'가 아니라 원하는 상태를 직접 받는다 (1.5.0).
     처리한 뒤에는 같은 주소로 다시 이동해, 새로고침해도 다시 실행되지 않게 한다. */
  $do  = (string)($_POST['do'] ?? '');
  $sid = (int)($_POST['id'] ?? 0);
  $msg = ''; $err = '';

  $target = $sid ? one("SELECT * FROM sets WHERE id=?", [$sid]) : null;
  if (!$target) {
    $err = '없는 항목입니다.';
  } elseif ($do === 'open' || $do === 'lock') {
    db()->prepare("UPDATE sets SET active = ? WHERE id=?")->execute([$do === 'open' ? 1 : 0, $sid]);
    $msg = $do === 'lock'
         ? '잠갔습니다. 학생에게 보이지 않습니다.'
         : '열었습니다. 학생에게 보입니다.';
  } elseif ($do === 'copy') {
    $newId = tx(function (PDO $d) use ($target, $sid) {
      /* 복사본은 잠긴 채로 만든다. 기간과 문제를 손본 뒤 직접 열게 한다. */
      $d->prepare("INSERT INTO sets(set_type,title,start_at,end_at,active,langs,show_diff,visibility,no_paste,created_at)
                   VALUES(?,?,?,?,0,?,?,?,?,?)")
        ->execute([$target['set_type'], $target['title'] . ' (복사)',
                   $target['start_at'], $target['end_at'], $target['langs'] ?? 'py,c',
                   (int)($target['show_diff'] ?? 1), $target['visibility'] ?? 'groups',
                   (int)($target['no_paste'] ?? 0), now()]);
      $nid = (int)$d->lastInsertId();
      $d->prepare("INSERT INTO set_targets(set_id,group_id)
                   SELECT ?, group_id FROM set_targets WHERE set_id=?")->execute([$nid, $sid]);
      $d->prepare("INSERT INTO set_problems(set_id,problem_id,required_ac,sort)
                   SELECT ?, problem_id, required_ac, sort FROM set_problems WHERE set_id=?")
        ->execute([$nid, $sid]);
      return $nid;
    });
    header('Location: admin/set.php?id=' . (int)$newId); exit;
  } elseif ($do === 'delete') {
    $used = (int)col("SELECT COUNT(*) FROM submissions WHERE set_id=?", [$sid]);
    if ($used) {
      $err = '제출 기록이 ' . $used . '건 있어 삭제할 수 없습니다. 잠가서 감추세요.';
    } else {
      tx(function (PDO $d) use ($sid) {
        $d->prepare("DELETE FROM set_problems WHERE set_id=?")->execute([$sid]);
        $d->prepare("DELETE FROM set_targets  WHERE set_id=?")->execute([$sid]);
        $d->prepare("DELETE FROM sets WHERE id=?")->execute([$sid]);
      });
      $msg = '삭제했습니다.';
    }
  } else {
    $err = '알 수 없는 동작입니다.';
  }
  redirect_with($msg, $err);
}

/* 카드 하나 — 학생 카드와 같은 모양에 정보와 버튼을 더한다.
   제목을 누르면 그 수업 · 평가의 문제 목록(set.php), 현황표는 [현황] 버튼. */
function teacher_set_item(array $r): void {
  $st     = set_state($r);
  $locked = set_locked($r);
  $id     = (int)$r['id'];
  $per    = period_text($r);
?>
  <div class="setrow tset<?= ($locked || $st === 'after') ? ' off' : '' ?>">
    <div class="sinfo">
      <a class="stitle" href="set.php?id=<?= $id ?>"><?= h($r['title']) ?></a>
      <div class="smeta">
        <?php if ($per !== ''): ?><?= h($per) ?> &middot; <?php endif; ?>
        문제 <?= (int)$r['problem_cnt'] ?>개 &middot; <?= (int)$r['student_cnt'] ?>명 &middot;
        <?php if (($r['visibility'] ?? 'groups') === 'all'): ?>모든 회원
        <?php elseif ($r['targets']): ?><?= h($r['targets']) ?>
        <?php else: /* 반을 하나도 고르지 않았다 — 아무에게도 보이지 않는다 */ ?>
          <span class="bad-text" title="공개할 반이 없어 학생에게 보이지 않습니다">대상 없음</span>
        <?php endif; ?>
      </div>
    </div>
    <?php /* 버튼은 두 묶음 (1.17.0) — [상태 · 잠그기 · 현황] | [수정 · 기록 · 복사 · 삭제] */ ?>
    <div class="tbtns">
      <span class="tgrp">
        <?php if ($locked): ?>
          <span class="v v-wait" title="학생에게 보이지 않습니다">잠김</span>
        <?php else: ?>
          <span class="v <?= $st === 'open' ? 'v-open' : ($st === 'after' ? 'v-WA' : 'v-wait') ?>"><?= h(SET_STATE_NAME[$st]) ?></span>
        <?php endif; ?>
        <form method="post">
          <input type="hidden" name="id" value="<?= $id ?>">
          <button class="btn sm <?= $locked ? 'primary' : '' ?>" name="do" value="<?= $locked ? 'open' : 'lock' ?>" type="submit">
            <?= $locked ? '열기' : '잠그기' ?>
          </button>
        </form>
        <a class="btn sm" href="admin/progress.php?id=<?= $id ?>">현황</a>
      </span>
      <span class="sepline"></span>
      <span class="tgrp">
        <a class="btn sm" href="admin/set.php?id=<?= $id ?>">수정</a>
        <a class="btn sm" href="admin/submissions.php?set_id=<?= $id ?>">기록</a>
        <form method="post" onsubmit="return confirm('복사할까요? 복사본은 잠긴 상태로 만들어집니다.')">
          <input type="hidden" name="id" value="<?= $id ?>">
          <button class="btn sm" name="do" value="copy" type="submit">복사</button>
        </form>
        <form method="post" onsubmit="return confirm('삭제할까요? 되돌릴 수 없습니다.')">
          <input type="hidden" name="id" value="<?= $id ?>">
          <button class="btn sm danger" name="do" value="delete" type="submit">삭제</button>
        </form>
      </span>
    </div>
  </div>
<?php }

function teacher_sets_page(array $u, string $type): void {
  [$msg, $err] = flash_take();
  $name = SET_TYPE_NAME[$type];
  $rows = all("SELECT s.*,
                 (SELECT COUNT(*) FROM set_problems sp WHERE sp.set_id = s.id) AS problem_cnt,
                 (SELECT GROUP_CONCAT(g.name, ', ') FROM set_targets t
                   JOIN groups g ON g.id = t.group_id WHERE t.set_id = s.id) AS targets,
                 (SELECT COUNT(*) FROM users us
                   WHERE us.role='student' AND us.approved = 1 AND (
                     s.visibility = 'all'
                     OR us.group_id IN (SELECT group_id FROM set_targets t3 WHERE t3.set_id = s.id)
                 )) AS student_cnt
               FROM sets s WHERE s.set_type = ? " . SET_ORDER_SQL, [$type]);

  /* 진행 중 · 시작 전은 위에, 종료된 것은 접어 둔다 (학생 목록과 같게) */
  $live = []; $done = [];
  foreach ($rows as $r) { if (set_state($r) === 'after') $done[] = $r; else $live[] = $r; }

  page_head(['title' => $name, 'root' => '', 'user' => $u,
             'nav' => $type === 'assessment' ? 'assessments' : 'lessons']);
?>
<div class="wrap narrow tsets">
  <div class="phead">
    <h1><?= h($name) ?></h1>
    <span class="sub">참여할 <?= h($name) ?><?= $type === 'assessment' ? '를' : '을' ?> 고르세요.</span>
    <div class="grow"></div>
    <a class="btn primary" href="admin/set.php?type=<?= h($type) ?>">새 <?= h($name) ?></a>
  </div>

  <?php if ($msg): ?><div class="note ok"><?= h($msg) ?></div><?php endif; ?>
  <?php if ($err): ?><div class="note err"><?= h($err) ?></div><?php endif; ?>

  <?php if (!$rows): ?>
    <div class="empty">아직 만든 <?= h($name) ?><?= $type === 'assessment' ? '가' : '이' ?> 없습니다.</div>
  <?php else: ?>
    <?php if ($live): ?>
      <div class="setlist">
        <?php foreach ($live as $r) teacher_set_item($r); ?>
      </div>
    <?php else: ?>
      <div class="empty">진행 중인 <?= h($name) ?><?= $type === 'assessment' ? '가' : '이' ?> 없습니다.</div>
    <?php endif; ?>

    <?php if ($done): ?>
      <details class="donebox"<?= $live ? '' : ' open' ?>>
        <summary>종료된 <?= h($name) ?> <?= count($done) ?>개 보기</summary>
        <div class="setlist">
          <?php foreach ($done as $r) teacher_set_item($r); ?>
        </div>
      </details>
    <?php endif; ?>
  <?php endif; ?>
</div>
<?php
  page_foot();
}

/* ═══ 공지사항 ═════════════════════════════════════════
   (예전 admin/notices.php 의 내용) */

function teacher_notices_post(?array $u): void {
  teacher_need_admin($u, 'notices.php');
  $do = (string)($_POST['do'] ?? '');
  $id = (int)($_POST['id'] ?? 0);
  $msg = ''; $err = '';
  $n = $id ? one("SELECT * FROM notices WHERE id=?", [$id]) : null;
  if (!$n) { $err = '없는 공지입니다.'; }
  /* 공개 · 고정도 원하는 상태를 직접 받고, 처리한 뒤 다시 이동한다 (1.5.0 — 새로고침하면 다시 뒤집히던 문제) */
  elseif ($do === 'show' || $do === 'hide') {
    db()->prepare("UPDATE notices SET active = ? WHERE id=?")->execute([$do === 'show' ? 1 : 0, $id]);
    $msg = $do === 'hide' ? '비공개로 바꿨습니다.' : '공개했습니다.';
  } elseif ($do === 'pin' || $do === 'unpin') {
    db()->prepare("UPDATE notices SET pinned = ? WHERE id=?")->execute([$do === 'pin' ? 1 : 0, $id]);
    $msg = $do === 'unpin' ? '상단 고정을 풀었습니다.' : '상단에 고정했습니다.';
  } elseif ($do === 'delete') {
    db()->prepare("DELETE FROM notices WHERE id=?")->execute([$id]);
    $msg = '삭제했습니다.';
  } else {
    $err = '알 수 없는 동작입니다.';
  }
  redirect_with($msg, $err);
}

function teacher_notices_page(array $u): void {
  [$msg, $err] = flash_take();
  $all   = all("SELECT n.*, u.login_id FROM notices n
                LEFT JOIN users u ON u.id = n.author_id
                ORDER BY n.pinned DESC, n.id DESC");
  $total  = count($all);
  $hidden = count(array_filter($all, fn($r) => !(int)$r['active']));
  $per    = 30;
  $pages  = max(1, (int)ceil($total / $per));
  $page   = max(1, min($pages, (int)($_GET['p'] ?? 1)));
  $rows   = array_slice($all, ($page - 1) * $per, $per);

  page_head(['title' => '공지사항', 'root' => '', 'user' => $u, 'nav' => 'notices']);
?>
<div class="wrap">

  <div class="phead">
    <h1>공지사항</h1>
    <span class="sub"><?= number_format($total) ?>건<?= $hidden ? ' · 비공개 ' . $hidden . '건' : '' ?></span>
    <div class="grow"></div>
    <a class="btn primary" href="admin/notice.php">새 공지</a>
  </div>

  <?php if ($msg): ?><div class="note ok"><?= h($msg) ?></div><?php endif; ?>
  <?php if ($err): ?><div class="note err"><?= h($err) ?></div><?php endif; ?>

  <?php if (!$rows): ?>
    <div class="empty">아직 공지가 없습니다.</div>
  <?php else: ?>
    <div class="scrollx">
      <table class="list sets">
        <thead>
          <tr>
            <th style="min-width:220px">제목</th>
            <th class="center" style="width:78px">공개</th>
            <th class="center" style="width:78px">고정</th>
            <th class="center" style="width:110px">작성일</th>
            <th class="center" style="width:100px">작성자</th>
            <th style="width:250px"></th>
          </tr>
        </thead>
        <tbody>
        <?php foreach ($rows as $r): ?>
          <tr class="<?= (int)$r['active'] ? '' : 'dim' ?>">
            <td class="title"><a href="notice.php?id=<?= (int)$r['id'] ?>"><?= h($r['title']) ?></a></td>
            <td class="center">
              <?php if ((int)$r['active']): ?><span class="v v-AC">공개</span>
              <?php else: ?><span class="v v-wait">비공개</span><?php endif; ?>
            </td>
            <td class="center"><?= (int)$r['pinned'] ? '<span class="v v-AC">고정</span>' : '' ?></td>
            <td class="center num small"><?= h(substr((string)$r['created_at'], 2, 8)) ?></td>
            <td class="center num small"><?= h($r['login_id'] ?? '') ?></td>
            <td class="rowbtns">
              <form method="post">
                <input type="hidden" name="id" value="<?= (int)$r['id'] ?>">
                <button class="btn sm" name="do" value="<?= (int)$r['active'] ? 'hide' : 'show' ?>" type="submit">
                  <?= (int)$r['active'] ? '비공개' : '공개' ?></button>
              </form>
              <form method="post">
                <input type="hidden" name="id" value="<?= (int)$r['id'] ?>">
                <button class="btn sm" name="do" value="<?= (int)$r['pinned'] ? 'unpin' : 'pin' ?>" type="submit">
                  <?= (int)$r['pinned'] ? '고정 해제' : '고정' ?></button>
              </form>
              <a class="btn sm" href="admin/notice.php?id=<?= (int)$r['id'] ?>">수정</a>
              <form method="post" onsubmit="return confirm('삭제할까요? 되돌릴 수 없습니다.')">
                <input type="hidden" name="id" value="<?= (int)$r['id'] ?>">
                <button class="btn sm danger" name="do" value="delete" type="submit">삭제</button>
              </form>
            </td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
    </div>
    <?= pager($page, $pages) ?>
  <?php endif; ?>

</div>
<?php
  page_foot();
}
