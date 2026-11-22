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
    header('Location: ../' . ($type === 'assessment' ? 'assessments.php' : 'lessons.php')); exit;
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
  /* 부정행위 방지 (2.1.0) — 평가에서만 쓴다. 수업으로 저장하면 값은 남지만 쓰이지 않는다. */
  $ipl      = ip_list((string)($_POST['allow_ips'] ?? ''));
  $allowIps = implode(', ', $ipl['ok']);
  $entry    = mb_substr(trim((string)($_POST['entry_code'] ?? '')), 0, 40);
  $strict   = !empty($_POST['strict']) ? 1 : 0;

  if ($title === '') $err = '이름을 입력하세요.';

  /* '지정한 반'인데 반을 하나도 고르지 않으면 아무 학생에게도 안 보인다.
     2.1.0 부터 막지 않는다 — 미리 만들어 두고 감춰 두려는 경우가 있다.
     대신 저장한 뒤 알려 주고(아래 $warn), 목록에도 '대상 없음'으로 보인다. */
  $noTarget = $vis === 'groups' && !$groups;

  if ($err === '') {
    try {
      $newId = tx(function (PDO $d) use ($id, $type, $title, $start, $end, $groups, $langCsv, $showDiff, $vis, $noPaste, $allowIps, $entry, $strict) {
        /* 열림·잠김은 여기서 건드리지 않는다. 목록의 잠그기·열기 버튼으로만 바꾼다.
           새로 만든 것은 잠긴 채로 시작해, 준비가 끝난 뒤 직접 열게 한다. */
        if ($id) {
          $d->prepare("UPDATE sets SET set_type=?, title=?, start_at=?, end_at=?, langs=?, show_diff=?, visibility=?, no_paste=?,
                              allow_ips=?, entry_code=?, strict=? WHERE id=?")
            ->execute([$type, $title, $start ?: null, $end ?: null, $langCsv, $showDiff, $vis, $noPaste, $allowIps, $entry, $strict, $id]);
          $sid = $id;
        } else {
          $d->prepare("INSERT INTO sets(set_type,title,start_at,end_at,active,langs,show_diff,visibility,no_paste,created_at,
                                        allow_ips,entry_code,strict)
                       VALUES(?,?,?,?,0,?,?,?,?,?,?,?,?)")
            ->execute([$type, $title, $start ?: null, $end ?: null, $langCsv, $showDiff, $vis, $noPaste, now(), $allowIps, $entry, $strict]);
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
        $upd = $d->prepare("UPDATE set_problems SET required_ac=?, sort=?, banned=? WHERE id=? AND set_id=?");
        $sort = 0;
        foreach ($cur as $spId) {
          $row = $keep[$spId] ?? $keep[(string)$spId] ?? null;
          if ($row === null) { $sort++; continue; }   /* 폼에 없던 것은 건드리지 않는다 */
          /* 빼기로 표시한 것은 여기서 실제로 지운다 */
          if (!empty($row['del'])) { $del->execute([$spId, $id]); continue; }
          $need = max(1, min(20, (int)($row['required_ac'] ?? 1)));
          $upd->execute([$need, $sort++, banned_norm((string)($row['banned'] ?? '')), $spId, $id]);
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

      if ($noTarget) $warn[] = '대상 반을 고르지 않아 학생에게는 보이지 않습니다.';
      if ($ipl['bad']) $warn[] = '허용 IP 에서 알아볼 수 없는 항목을 뺐습니다: ' . implode(', ', $ipl['bad']);
      if ($type === 'assessment' && $ipl['ok'] && !ip_allowed(client_ip(), $allowIps)) {
        $warn[] = '지금 이 컴퓨터의 IP(' . client_ip() . ')는 허용 IP 에 들어 있지 않습니다. 학생들이 응시할 곳의 IP 가 맞는지 확인하세요.';
      }
      /* 입장을 가려 놓은 평가에 열린 문제가 담겨 있으면 알려 준다 (2.1.0).
         문제 모음에 열려 있는 문제는 평가를 거치지 않고도 볼 수 있어, 허용 IP · 입장 코드가 가리지 못하고
         엄격 모드의 기록도 남지 않는다. 기간을 정한 평가도 같다 — 기간 밖에는 문제를 가리는데, 열린 문제는 그대로 보인다. */
      if ($type === 'assessment' && ($allowIps !== '' || $entry !== '' || $strict || $start !== '' || $end !== '')) {
        $openNos = array_column(all("SELECT p.prob_no FROM set_problems sp JOIN problems p ON p.id = sp.problem_id
                                     WHERE sp.set_id = ? AND p.active = 1 ORDER BY sp.sort, sp.id", [$id]), 'prob_no');
        if ($openNos) {
          $warn[] = implode(', ', array_slice($openNos, 0, 20)) . (count($openNos) > 20 ? ' 등 ' . count($openNos) . '개' : '번')
                  . ' 문제는 문제 모음에 열려 있어 평가 밖에서도 볼 수 있습니다. 가리려면 문제 모음에서 그 문제를 잠그세요.';
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
  if (!$s) { header('Location: ../lessons.php'); exit; }
  $items = all("SELECT sp.id, sp.problem_id, sp.required_ac, sp.sort, sp.banned,
                       p.prob_no, p.title,
                       (SELECT COUNT(*) FROM testcases t WHERE t.problem_id=p.id) AS tc_cnt
                FROM set_problems sp JOIN problems p ON p.id=sp.problem_id
                WHERE sp.set_id=? ORDER BY sp.sort, sp.id", [$id]);
  $sel = array_map('intval', array_column(all("SELECT group_id FROM set_targets WHERE set_id=?", [$id]), 'group_id'));
} else {
  $s = ['set_type' => (($_GET['type'] ?? '') === 'assessment' ? 'assessment' : 'lesson'),
        'title' => '', 'start_at' => '', 'end_at' => '', 'active' => 0, 'langs' => 'py,c',
        'visibility' => 'groups', 'no_paste' => 0,
        'show_diff' => 1, 'allow_ips' => '', 'entry_code' => '', 'strict' => 0];
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
    <a class="btn" href="../<?= $s['set_type'] === 'assessment' ? 'assessments' : 'lessons' ?>.php">목록</a>
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

    <!-- 2.1.0 — 설정을 묶음으로 나눔: 기본 · 대상 · 풀이 환경 · (평가) 부정행위 방지 · 문제.
         항목 이름과 저장 방식은 그대로다. -->
    <div class="sec setgrp first">
      <h2>기본</h2>
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
    </div>

    <div class="sec setgrp">
      <h2>대상</h2>
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
        <div class="small muted">&lsquo;지정한 반&rsquo;에서 반을 하나도 고르지 않으면 어떤 학생에게도 보이지 않습니다.</div>
      </div>
    </div>

    <div class="sec setgrp">
      <h2>풀이 환경</h2>
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
    </div>

    <!-- ── 부정행위 방지 (2.1.0) — 평가에서만 보인다. 종류를 바꾸면 아래 스크립트가 보이기 · 숨기기를 맞춘다. ── -->
    <div class="sec setgrp" id="guardGrp" <?= $isAssess ? '' : 'hidden' ?>>
      <h2>부정행위 방지</h2>
      <div class="field">
        <label>엄격 모드</label>
        <div class="chips">
          <label class="chip">
            <input type="checkbox" name="strict" value="1" <?= (int)($_POST['strict'] ?? $s['strict'] ?? 0) === 1 ? 'checked' : '' ?>>
            <span>엄격 모드 켜기</span>
          </label>
        </div>
        <div class="small muted">
          세 가지가 함께 켜집니다. <b>한 계정은 한 곳에서만</b>(다른 곳에서 로그인하면 먼저 접속이 끊김) ·
          <b>접속 기록</b>(IP · 기기 — 같은 기기를 쓴 다른 계정을 찾음) · <b>화면 이탈 기록</b>(문제 화면을 떠나 있던 시간).
          기록은 <b>현황</b> 화면에서 봅니다. 학생에게는 기록이 남는다고 알려 줍니다.
        </div>
      </div>
      <div class="row">
        <div class="field" style="flex:2">
          <label for="allow_ips">허용 IP <span class="small muted" style="font-weight:400">비워 두면 어디서나 응시할 수 있습니다</span></label>
          <div class="iprow">
            <input type="text" class="code" id="allow_ips" name="allow_ips" maxlength="600" autocomplete="off"
                   value="<?= h((string)($_POST['allow_ips'] ?? $s['allow_ips'] ?? '')) ?>" placeholder="예) 203.0.113.7, 203.0.113.*">
            <button class="btn" type="button" id="ipMine" data-ip="<?= h(client_ip()) ?>">지금 내 IP 넣기</button>
          </div>
          <div class="small muted">
            적어 둔 곳에서만 평가에 들어오고 제출할 수 있습니다. 쉼표로 여러 개,
            <code>203.0.113.*</code> 처럼 앞부분만 적어도 됩니다.
            지금 이 컴퓨터의 IP 는 <b><?= h(client_ip()) ?></b> 입니다 — 학생 컴퓨터와 같은 곳(교실)에서 누르세요.
          </div>
        </div>
        <div class="field" style="max-width:260px">
          <label for="entry_code">입장 코드 <span class="small muted" style="font-weight:400">비워 두면 묻지 않습니다</span></label>
          <input type="text" class="code" id="entry_code" name="entry_code" maxlength="40" autocomplete="off"
                 value="<?= h((string)($_POST['entry_code'] ?? $s['entry_code'] ?? '')) ?>" placeholder="예) 7426">
          <div class="small muted">평가를 시작할 때 교실에서 알려 주세요. 학생은 로그인할 때마다 한 번 넣습니다.</div>
        </div>
      </div>
      <div class="small muted">선생님 계정은 허용 IP · 입장 코드를 확인하지 않습니다. 학생 계정으로 들어가야 확인할 수 있습니다.</div>
    </div>

    <!-- ── 문제 ─────────────────────────────── -->
    <div class="sec setgrp" id="problems">
      <h2>문제</h2>

      <?php if ($items): ?>
        <table class="list setitems">
          <thead>
            <tr>
              <th class="center" style="width:74px">순서</th>
              <th style="width:76px">번호</th>
              <th>제목</th>
              <th style="width:230px">사용 금지</th>
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
              <td><input class="code" type="text" name="sp[<?= $sp ?>][banned]" maxlength="300"
                         value="<?= h((string)$it['banned']) ?>" placeholder="예) sort, sorted" autocomplete="off"></td>
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
          순서는 ▲▼ 를 누르면 바로 바뀝니다. 빼기로 표시한 문제는 <b>저장</b>을 눌러야 실제로 빠집니다.<br>
          <b>사용 금지</b>에 적은 단어(쉼표로 여러 개)가 코드에 있으면 그 문제는 제출 · 실행할 수 없습니다.
          단어 단위로 찾으므로 <code>sort</code> 를 적어도 <code>sorted</code> 는 걸리지 않습니다 — 둘 다 막으려면 둘 다 적으세요.
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
          <label for="add_nos">문제 번호로 추가 <span class="hint">1010-1015 처럼 범위도 됩니다</span></label>
          <input class="code" type="text" id="add_nos" name="add_nos" placeholder="1001, 1003, 1010-1015"
                 value="<?= h($preNos) ?>">
        </div>
        <?php if ($isAssess): ?>
          <div class="field" style="max-width:230px">
            <label for="default_ac">추가할 문제의 필요 통과 횟수</label>
            <input class="code" type="number" id="default_ac" name="default_ac"
                   min="1" max="20" value="<?= DEFAULT_AC ?>">
          </div>
        <?php endif; ?>
      </div>
    </div>

    <div class="actions">
      <button class="btn primary" type="submit">저장</button>
      <a class="btn" href="../<?= $s['set_type'] === 'assessment' ? 'assessments' : 'lessons' ?>.php">취소</a>
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
/* 부정행위 방지 묶음은 평가일 때만 보인다 (2.1.0). [지금 내 IP 넣기]는 서버가 본 내 IP 를 칸에 더한다. */
(function () {
  var sel = document.getElementById('set_type'), grp = document.getElementById('guardGrp');
  if (sel && grp) {
    var show = function () { grp.hidden = sel.value !== 'assessment'; };
    sel.addEventListener('change', show); show();
  }
  var btn = document.getElementById('ipMine'), box = document.getElementById('allow_ips');
  if (btn && box) btn.addEventListener('click', function () {
    var ip = btn.getAttribute('data-ip') || '';
    if (!ip) return;
    var cur = box.value.split(/[\s,]+/).filter(Boolean);
    if (cur.indexOf(ip) < 0) cur.push(ip);
    box.value = cur.join(', ');
    box.focus();
  });
})();
</script>
<?php page_foot(); ?>
