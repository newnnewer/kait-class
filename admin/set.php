<?php
/* admin/set.php — 수업·평가 묶음 만들기·고치기 */
declare(strict_types=1);
require_once __DIR__ . '/../guard.php';
require_once __DIR__ . '/../layout.php';
$u = need_admin('../');

$id   = (int)($_GET['id'] ?? 0);
$err  = '';
$msg  = '';
$warn = [];

/* ── 삭제 ─────────────────────────────────────── */
if ($id && ($_POST['do'] ?? '') === 'delete') {
  $used = (int)col("SELECT COUNT(*) FROM submissions WHERE set_id = ?", [$id]);
  if ($used) {
    $err = '제출 기록이 ' . $used . '건 있어 삭제할 수 없습니다. 잠금으로 닫아 두세요.';
  } else {
    $type = (string)col("SELECT set_type FROM sets WHERE id = ?", [$id]);
    tx(function (PDO $d) use ($id) {
      $d->prepare("DELETE FROM set_problems WHERE set_id = ?")->execute([$id]);
      $d->prepare("DELETE FROM set_targets  WHERE set_id = ?")->execute([$id]);
      $d->prepare("DELETE FROM sets WHERE id = ?")->execute([$id]);
    });
    header('Location: sets.php?type=' . urlencode($type)); exit;
  }
}

/* ── 순서 바꾸기 ──────────────────────────────
   저장을 거치지 않고 바로 반영한다. 한 칸씩 옮기는 일이라 그 편이 자연스럽다. */
if ($id && in_array($_POST['do'] ?? '', ['up', 'down'], true)) {
  $spId = (int)($_POST['sp_id'] ?? 0);
  $items = all("SELECT id FROM set_problems WHERE set_id=? ORDER BY sort, id", [$id]);
  $order = array_map(fn($r) => (int)$r['id'], $items);
  $pos   = array_search($spId, $order, true);

  if ($pos !== false) {
    $swap = $_POST['do'] === 'up' ? $pos - 1 : $pos + 1;
    if ($swap >= 0 && $swap < count($order)) {
      [$order[$pos], $order[$swap]] = [$order[$swap], $order[$pos]];
      tx(function (PDO $d) use ($order, $id) {
        $st = $d->prepare("UPDATE set_problems SET sort=? WHERE id=? AND set_id=?");
        foreach ($order as $i => $spid) $st->execute([$i, $spid, $id]);
      });
    }
  }
  header('Location: set.php?id=' . $id . '#problems'); exit;
}

/* ── 저장 ─────────────────────────────────────── */
if (($_POST['do'] ?? '') === 'save') {
  $type   = ($_POST['set_type'] ?? '') === 'assessment' ? 'assessment' : 'lesson';
  $title  = trim((string)($_POST['title'] ?? ''));
  $start  = dt_norm((string)($_POST['start_at'] ?? ''));   /* T 구분자를 공백으로 */
  $end    = dt_norm((string)($_POST['end_at'] ?? ''));
  $groups = array_map('intval', (array)($_POST['groups'] ?? []));
  $vis    = ($_POST['visibility'] ?? '') === 'all' ? 'all' : 'groups';
  /* 평가는 언제나 막는다. 수업만 고를 수 있다. */
  $noPaste = $type === 'assessment' ? 1 : (empty($_POST['no_paste']) ? 0 : 1);
  $showDiff = !empty($_POST['show_diff']) ? 1 : 0;
  $langs  = array_values(array_filter((array)($_POST['langs'] ?? []),
                                      fn($k) => isset(langs()[$k])));
  if (!$langs) $err = '사용할 언어를 하나 이상 고르세요.';
  $langCsv = implode(',', $langs);
  $addNos = (string)($_POST['add_nos'] ?? '');

  if ($title === '') $err = '이름을 입력하세요.';

  /* ★ '지정한 반'인데 반을 하나도 고르지 않으면 아무에게도 안 보인다.
     저장은 되고 학생 화면에서만 조용히 사라지므로, 여기서 막는다. */
  if ($err === '' && $vis === 'groups' && !$groups) {
    $err = '공개할 반을 하나 이상 고르세요. (모든 회원에게 열려면 위에서 그쪽을 고르세요)';
  }

  if ($err === '') {
    try {
      $newId = tx(function (PDO $d) use ($id, $type, $title, $start, $end, $groups, $langCsv, $showDiff, $vis, $noPaste) {
        /* 열림·잠김은 여기서 건드리지 않는다. 목록의 잠그기·열기 버튼으로만 바꾼다.
           새로 만든 것은 잠긴 채로 시작해, 준비가 끝난 뒤 직접 열게 한다. */
        if ($id) {
          $d->prepare("UPDATE sets SET set_type=?, title=?, start_at=?, end_at=?, langs=?, show_diff=?, visibility=?, no_paste=? WHERE id=?")
            ->execute([$type, $title, $start ?: null, $end ?: null, $langCsv, $showDiff, $vis, $noPaste, $id]);
          $sid = $id;
        } else {
          $d->prepare("INSERT INTO sets(set_type,title,start_at,end_at,active,langs,show_diff,visibility,no_paste,created_at)
                       VALUES(?,?,?,?,0,?,?,?,?,?)")
            ->execute([$type, $title, $start ?: null, $end ?: null, $langCsv, $showDiff, $vis, $noPaste, now()]);
          $sid = (int)$d->lastInsertId();
        }
        $d->prepare("DELETE FROM set_targets WHERE set_id=?")->execute([$sid]);
        $ins = $d->prepare("INSERT OR IGNORE INTO set_targets(set_id,group_id) VALUES(?,?)");
        foreach ($groups as $g) $ins->execute([$sid, $g]);
        return $sid;
      });
      $id = (int)$newId;

      /* 기존 문제: 삭제 · 요구 횟수 · 순서 */
      $keep = (array)($_POST['sp'] ?? []);
      /* 순서는 지금 저장된 것을 기준으로 삼는다.
         폼이 오는 차례에 기대면 필드가 하나만 어긋나도 순서가 흐트러진다. */
      $cur = array_map(fn($r) => (int)$r['id'],
             all("SELECT id FROM set_problems WHERE set_id=? ORDER BY sort, id", [$id]));

      tx(function (PDO $d) use ($keep, $id, $cur) {
        $del = $d->prepare("DELETE FROM set_problems WHERE id=? AND set_id=?");
        $upd = $d->prepare("UPDATE set_problems SET required_ac=?, sort=? WHERE id=? AND set_id=?");
        $sort = 0;
        foreach ($cur as $spId) {
          $row = $keep[$spId] ?? $keep[(string)$spId] ?? null;
          if ($row === null) { $sort++; continue; }   /* 폼에 없던 것은 건드리지 않는다 */
          /* 빼기로 표시한 것은 여기서 실제로 지운다 */
          if (!empty($row['del'])) { $del->execute([$spId, $id]); continue; }
          $need = max(1, min(20, (int)($row['required_ac'] ?? 1)));
          $upd->execute([$need, $sort++, $spId, $id]);
        }
      });

      /* 문제 추가 */
      if (trim($addNos) !== '') {
        $r = resolve_prob_nos($addNos);
        if ($r['bad']) $warn[] = '없는 번호: ' . implode(', ', $r['bad']);
        if ($r['dup']) $warn[] = '중복 입력: ' . implode(', ', $r['dup']);
        $maxSort = (int)col("SELECT COALESCE(MAX(sort),-1) FROM set_problems WHERE set_id=?", [$id]);
        $defaultAc = max(1, min(20, (int)($_POST['default_ac'] ?? DEFAULT_AC)));
        tx(function (PDO $d) use ($r, $id, &$maxSort, $defaultAc) {
          $ins = $d->prepare("INSERT OR IGNORE INTO set_problems(set_id,problem_id,required_ac,sort)
                              VALUES(?,?,?,?)");
          foreach ($r['found'] as $p) $ins->execute([$id, $p['problem_id'], $defaultAc, ++$maxSort]);
        });
        /* 테스트케이스가 없는 문제는 채점이 안 되므로 미리 알려 준다 */
        foreach ($r['found'] as $p) {
          if ((int)col("SELECT COUNT(*) FROM testcases WHERE problem_id=?", [$p['problem_id']]) === 0) {
            $warn[] = $p['prob_no'] . '번은 테스트케이스가 없어 채점되지 않습니다.';
          }
        }
      }

      $_SESSION['jset_warn'] = $warn;
      header('Location: set.php?id=' . $id . '&saved=1'); exit;
    } catch (Throwable $e) {
      $err = '저장하지 못했습니다: ' . $e->getMessage();
    }
  }
}

if (isset($_GET['saved'])) {
  $msg  = '저장했습니다.';
  $warn = (array)($_SESSION['jset_warn'] ?? []);
  unset($_SESSION['jset_warn']);
}

/* ── 화면 값 ──────────────────────────────────── */
if ($id) {
  $s = one("SELECT * FROM sets WHERE id=?", [$id]);
  if (!$s) { header('Location: sets.php'); exit; }
  $items = all("SELECT sp.id, sp.problem_id, sp.required_ac, sp.sort,
                       p.prob_no, p.title,
                       (SELECT COUNT(*) FROM testcases t WHERE t.problem_id=p.id) AS tc_cnt
                FROM set_problems sp JOIN problems p ON p.id=sp.problem_id
                WHERE sp.set_id=? ORDER BY sp.sort, sp.id", [$id]);
  $sel = array_map('intval', array_column(all("SELECT group_id FROM set_targets WHERE set_id=?", [$id]), 'group_id'));
} else {
  $s = ['set_type' => (($_GET['type'] ?? '') === 'assessment' ? 'assessment' : 'lesson'),
        'title' => '', 'start_at' => '', 'end_at' => '', 'active' => 0, 'langs' => 'py,c',
        'visibility' => 'groups', 'no_paste' => 0,
        'show_diff' => 1];
  $items = [];
  $sel = [];
}

/* 문제 관리에서 '수업·평가 만들기'로 넘어온 경우: 고른 번호를 아래 '문제 번호로 추가'에 채워 둔다.
   저장을 눌러야 실제로 만들어진다. */
$preNos = '';
if (!$id && ($_GET['nos'] ?? '') !== '') {
  $preNos = implode(', ', array_slice(
    array_unique(array_filter(array_map('intval', preg_split('/[^0-9]+/', (string)$_GET['nos'])))), 0, 300));
}
$isAssess = $s['set_type'] === 'assessment';
$groups = groups_all();

page_head(['title' => ($id ? '수정' : '새로 만들기'), 'root' => '../', 'user' => $u,
            'nav' => $isAssess ? 'assessments' : 'lessons']);
?>
<div class="wrap">

  <div class="phead">
    <h1><?= $id ? h($s['title']) : '새 ' . h(SET_TYPE_NAME[$s['set_type']]) ?></h1>
    <div class="grow"></div>
    <?php if ($id): ?><a class="btn" href="progress.php?id=<?= $id ?>">현황 보기</a><?php endif; ?>
    <a class="btn" href="sets.php?type=<?= h($s['set_type']) ?>">목록</a>
  </div>

  <?php if ($err): ?><div class="note err"><?= h($err) ?></div><?php endif; ?>
  <?php if ($msg): ?><div class="note ok"><?= h($msg) ?></div><?php endif; ?>
  <?php foreach ($warn as $w): ?><div class="note info"><?= h($w) ?></div><?php endforeach; ?>

  <?php if ($id): ?>
    <!-- 삭제·순서는 별도 폼이다. 폼은 겹칠 수 없으므로 밖에 두고 버튼에서 form 속성으로 가리킨다. -->
    <form method="post" id="delform"><input type="hidden" name="do" value="delete"></form>
    <form method="post" id="ordform"><input type="hidden" name="sp_id" id="ordsp" value=""></form>
  <?php endif; ?>

  <form method="post">
    <input type="hidden" name="do" value="save">

    <div class="row">
      <div class="field" style="max-width:150px">
        <label for="set_type">종류</label>
        <select id="set_type" name="set_type">
          <option value="lesson"     <?= !$isAssess ? 'selected' : '' ?>>수업</option>
          <option value="assessment" <?=  $isAssess ? 'selected' : '' ?>>평가</option>
        </select>
      </div>
      <div class="field" style="flex:3">
        <label for="title">이름</label>
        <input type="text" id="title" name="title" value="<?= h($s['title']) ?>"
               placeholder="예) 3차시 반복문" required autofocus>
      </div>
    </div>

    <div class="row">
      <div class="field">
        <label for="start_at">시작</label>
        <input type="datetime-local" id="start_at" name="start_at" style="max-width:260px"
               value="<?= h(str_replace(' ', 'T', (string)$s['start_at'])) ?>">
      </div>
      <div class="field">
        <label for="end_at">종료</label>
        <input type="datetime-local" id="end_at" name="end_at" style="max-width:260px"
               value="<?= h(str_replace(' ', 'T', (string)$s['end_at'])) ?>">
      </div>
    </div>

    <div class="field">
      <label>사용 언어</label>
      <div class="chips">
        <?php $selLang = set_langs($s); foreach (langs() as $k => $L): ?>
          <label class="chip">
            <input type="checkbox" name="langs[]" value="<?= h($k) ?>"
                   <?= in_array($k, $selLang, true) ? 'checked' : '' ?>>
            <span><?= h($L['label']) ?></span>
          </label>
        <?php endforeach; ?>
      </div>
    </div>

    <div class="field">
      <label>틀렸을 때</label>
      <div class="chips">
        <label class="chip">
          <input type="checkbox" name="show_diff" value="1" <?= (int)($s['show_diff'] ?? 1) ? 'checked' : '' ?>>
          <span>어디가 다른지 보여주기</span>
        </label>
      </div>
    </div>

    <div class="field">
      <label>코드 입력</label>
      <?php $npNow = (int)($_POST['no_paste'] ?? $s['no_paste'] ?? 0) === 1; ?>
      <div class="chips">
        <label class="chip">
          <input type="checkbox" id="noPaste" name="no_paste" value="1"
                 <?= ($npNow || $isAssess) ? 'checked' : '' ?> <?= $isAssess ? 'disabled' : '' ?>>
          <span>붙여넣기 막기</span>
        </label>
      </div>
      <div class="small muted" id="noPasteWhy">
        학생이 코드를 직접 치게 합니다. 완벽한 차단은 아니고, 억제와 적발이 목적입니다.
        <b>평가는 언제나 막습니다.</b>
      </div>
    </div>

    <div class="field">
      <label>공개 대상</label>
      <?php $visNow = ($_POST['visibility'] ?? $s['visibility'] ?? 'groups') === 'all' ? 'all' : 'groups'; ?>
      <div class="chips">
        <label class="chip">
          <input type="radio" name="visibility" value="groups" <?= $visNow === 'groups' ? 'checked' : '' ?>>
          <span>지정한 반</span>
        </label>
        <label class="chip">
          <input type="radio" name="visibility" value="all" <?= $visNow === 'all' ? 'checked' : '' ?>>
          <span>모든 회원</span>
        </label>
      </div>
      <div class="small muted">&lsquo;모든 회원&rsquo;에는 직접 가입한 외부 회원도 포함됩니다.
        모든 반에만 열려면 &lsquo;지정한 반&rsquo;을 고르고 아래에서 반을 전부 체크하세요.</div>
    </div>

    <div class="field">
      <label>대상 반</label>
      <div class="chips">
        <?php foreach ($groups as $g): ?>
          <label class="chip">
            <input type="checkbox" name="groups[]" value="<?= (int)$g['id'] ?>"
                   <?= in_array((int)$g['id'], $sel, true) ? 'checked' : '' ?>>
            <span><?= h($g['name']) ?> <span class="muted">(<?= (int)$g['member_cnt'] ?>)</span></span>
          </label>
        <?php endforeach; ?>
        <?php if (!$groups): ?><span class="small muted">등록된 반이 없습니다.</span><?php endif; ?>
      </div>
    </div>

    <!-- ── 문제 ─────────────────────────────── -->
    <div class="sec" id="problems">
      <h2>문제</h2>

      <?php if ($items): ?>
        <table class="list setitems">
          <thead>
            <tr>
              <th class="center" style="width:74px">순서</th>
              <th style="width:76px">번호</th>
              <th>제목</th>
              <?php if ($isAssess): ?><th class="center" style="width:110px">필요 통과</th><?php endif; ?>
              <th class="center" style="width:110px">테스트케이스</th>
              <th class="center" style="width:84px">빼기</th>
            </tr>
          </thead>
          <tbody>
          <?php foreach ($items as $i => $it): $sp = (int)$it['id']; ?>
            <tr>
              <td class="center nowrap ordbtns">
                <button class="btn sm" type="submit" form="ordform" name="do" value="up"
                        onclick="document.getElementById('ordsp').value=<?= $sp ?>"
                        <?= $i === 0 ? 'disabled' : '' ?> title="위로">▲</button>
                <button class="btn sm" type="submit" form="ordform" name="do" value="down"
                        onclick="document.getElementById('ordsp').value=<?= $sp ?>"
                        <?= $i === count($items) - 1 ? 'disabled' : '' ?> title="아래로">▼</button>
              </td>
              <td class="num"><?= (int)$it['prob_no'] ?></td>
              <td class="title"><a href="problem.php?id=<?= (int)$it['problem_id'] ?>"><?= h($it['title']) ?></a></td>
              <?php if ($isAssess): ?>
                <td class="center"><input class="code" type="number" min="1" max="20" style="width:70px"
                           name="sp[<?= $sp ?>][required_ac]" value="<?= (int)$it['required_ac'] ?>"></td>
              <?php else: ?>
                <input type="hidden" name="sp[<?= $sp ?>][required_ac]" value="<?= (int)$it['required_ac'] ?>">
              <?php endif; ?>
              <td class="center num">
                <?php if ((int)$it['tc_cnt'] === 0): ?>
                  <span style="color:var(--bad)">없음</span>
                <?php else: ?><?= (int)$it['tc_cnt'] ?>개<?php endif; ?>
              </td>
              <td class="center">
                <label class="chk delmark" style="justify-content:center">
                  <input type="checkbox" name="sp[<?= $sp ?>][del]" value="1"> 빼기
                </label>
              </td>
            </tr>
          <?php endforeach; ?>
          </tbody>
        </table>
        <p class="small muted" style="margin-top:10px">
          순서는 ▲▼ 를 누르면 바로 바뀝니다. 빼기로 표시한 문제는 <b>저장</b>을 눌러야 실제로 빠집니다.
        </p>
      <?php else: ?>
        <div class="note info">아직 담긴 문제가 없습니다.</div>
      <?php endif; ?>

      <?php if ($preNos !== ''): ?>
        <div class="note info">
          문제 관리에서 고른 문제를 아래에 담았습니다.
          위에서 이름·기간·공개 대상을 정하고 저장하면 만들어집니다.
        </div>
      <?php endif; ?>

      <div class="row" style="margin-top:16px">
        <div class="field" style="flex:3">
          <label for="add_nos">문제 번호로 추가</label>
          <input class="code" type="text" id="add_nos" name="add_nos" placeholder="1001, 1003 1007"
                 value="<?= h($preNos) ?>">
        </div>
        <?php if ($isAssess): ?>
          <div class="field" style="max-width:170px">
            <label for="default_ac">추가할 때 필요 통과</label>
            <input class="code" type="number" id="default_ac" name="default_ac"
                   min="1" max="20" value="<?= DEFAULT_AC ?>">
          </div>
        <?php endif; ?>
      </div>
    </div>

    <div class="actions">
      <button class="btn primary" type="submit">저장</button>
      <a class="btn" href="sets.php?type=<?= h($s['set_type']) ?>">취소</a>
      <div class="grow"></div>
      <?php if ($id): ?>
        <button class="btn danger" type="submit" form="delform"
                onclick="return confirm('삭제할까요? 되돌릴 수 없습니다.')">삭제</button>
      <?php endif; ?>
    </div>
  </form>

</div>
<script>
/* 종류를 평가로 바꾸면 붙여넣기 차단은 켜진 채 고정된다.
   저장할 때 서버가 다시 판단하므로 이 스크립트는 보이는 것만 맞춘다. */
(function () {
  var sel = document.getElementById('set_type'), np = document.getElementById('noPaste');
  if (!sel || !np) return;
  var lessonState = np.checked && !np.disabled;
  function sync() {
    var isA = sel.value === 'assessment';
    if (isA) { lessonState = np.disabled ? lessonState : np.checked; np.checked = true; }
    else     { np.checked = lessonState; }
    np.disabled = isA;
  }
  sel.addEventListener('change', sync);
  sync();
})();
</script>
<?php page_foot(); ?>
