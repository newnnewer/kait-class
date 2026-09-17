<?php
/* results.php — 채점 결과 (수업·자유 풀이만. 평가 제출은 제외한다) */
declare(strict_types=1);
require_once __DIR__ . '/guard.php';
require_once __DIR__ . '/layout.php';
$u = me();

/* 한 건 자세히 보기 — 코드는 본인 것(과 관리자)만 */
$detailId = (int)($_GET['id'] ?? 0);
$detail = null;
if ($detailId) {
  $detail = one("SELECT s.*, p.prob_no, p.title, us.login_id, us.name AS uname, st.set_type
                 FROM submissions s
                 JOIN problems p ON p.id = s.problem_id
                 JOIN users us ON us.id = s.user_id
                 LEFT JOIN sets st ON st.id = s.set_id
                 WHERE s.id = ?", [$detailId]);
  /* 평가 제출도 목록과 같은 자리에서 보인다. 다만 코드는 아래에서 본인·관리자만 볼 수 있다. */
}

/* 로그인하지 않은 사람에게는 누가 제출했는지 보여주지 않는다.
   아이디를 가려도 검색이 열려 있으면 한 글자씩 맞춰 알아낼 수 있기 때문이다. */
$fUser    = $u ? trim((string)($_GET['user'] ?? '')) : '';
$fProb    = trim((string)($_GET['prob'] ?? ''));
$fVerdict = trim((string)($_GET['verdict'] ?? ''));
$fLang    = trim((string)($_GET['lang'] ?? ''));
$mineOnly = $u && isset($_GET['mine']);

$where = [];
$args  = [];
if ($mineOnly)        { $where[] = "s.user_id = :uid";        $args[':uid'] = $u['id']; }
if ($fUser !== '')    { $where[] = "(us.login_id LIKE :us OR us.name LIKE :us)"; $args[':us'] = '%'.$fUser.'%'; }
if ($fProb !== '')    { $where[] = "CAST(p.prob_no AS TEXT) = :pn"; $args[':pn'] = $fProb; }
if ($fVerdict !== '') { $where[] = "s.verdict = :vd";         $args[':vd'] = $fVerdict; }
if ($fLang !== '')    { $where[] = "s.lang = :lg";            $args[':lg'] = $fLang; }

$rows = all("SELECT s.id, s.lang, s.state, s.verdict, s.passed_count, s.total_count,
                    s.max_time, s.max_memory, s.created_at, s.user_id,
                    p.prob_no, p.title, us.login_id, us.name AS uname
             FROM submissions s
             JOIN problems p ON p.id = s.problem_id
             JOIN users us ON us.id = s.user_id
             LEFT JOIN sets st ON st.id = s.set_id
             " . ($where ? 'WHERE ' . implode(' AND ', $where) : '') . "
             ORDER BY s.id DESC LIMIT 200", $args);

page_head(['title' => '채점 결과', 'root' => '', 'user' => $u, 'nav' => 'results']);
?>
<div class="wrap">

  <div class="phead">
    <h1>채점 결과</h1>
    <span class="sub">최근 <?= count($rows) ?>건</span>
  </div>

  <?php if ($detail): ?>
    <?php $canSeeCode = $u && ((int)$detail['user_id'] === (int)$u['id'] || $u['role'] === 'admin'); ?>
    <div class="detail">
      <div class="dhead">
        <span class="pno"><?= (int)$detail['prob_no'] ?></span>
        <b><?= h($detail['title']) ?></b>
        <?= verdict_badge($detail['verdict'], $detail['state']) ?>
        <span class="small muted">
          <?php if ($u): ?><?= h($detail['login_id']) ?> · <?php endif; ?>
          <?= h(lang_label($detail['lang'])) ?> ·
          <?= h($detail['created_at']) ?>
        </span>
        <div class="grow"></div>
        <?php if ($u && $u['role'] === 'admin'): ?>
          <form method="post" action="admin/judge.php" style="display:inline"
                onsubmit="return confirm('이 제출을 다시 채점할까요?')">
            <input type="hidden" name="do" value="run">
            <input type="hidden" name="submission_id" value="<?= (int)$detail['id'] ?>">
            <input type="hidden" name="problem_id" value="<?= (int)$detail['problem_id'] ?>">
            <button class="btn sm" type="submit">재채점</button>
          </form>
        <?php endif; ?>
        <a class="btn sm" href="results.php">닫기</a>
      </div>
      <?php if ($canSeeCode): ?>
        <pre class="codeview"><?= h($detail['source_code']) ?></pre>
        <?php if (trim((string)$detail['compile_msg']) !== ''): ?>
          <div class="cap">메시지</div>
          <pre class="codeview msg"><?= h($detail['compile_msg']) ?></pre>
        <?php endif; ?>
      <?php else: ?>
        <p class="small muted" style="padding:14px 16px">
          <?= $u ? '다른 사람의 코드는 볼 수 없습니다. 판정과 실행 기록만 공개됩니다.'
                 : '코드를 보려면 로그인해야 합니다. 본인이 제출한 코드만 볼 수 있습니다.' ?>
        </p>
      <?php endif; ?>
    </div>
  <?php endif; ?>

  <form class="searchbar" method="get">
    <input type="text" name="prob" value="<?= h($fProb) ?>" placeholder="문제 번호" style="max-width:110px">
    <?php if ($u): ?>
      <input type="text" name="user" value="<?= h($fUser) ?>" placeholder="아이디 또는 이름" style="max-width:170px">
    <?php endif; ?>
    <select name="verdict">
      <option value="">전체 판정</option>
      <?php foreach (VERDICT_NAME as $k => $v): ?>
        <option value="<?= h($k) ?>" <?= $fVerdict === $k ? 'selected' : '' ?>><?= h($k . ' · ' . $v) ?></option>
      <?php endforeach; ?>
    </select>
    <select name="lang">
      <option value="">전체 언어</option>
      <?php foreach (langs() as $k => $L): ?>
        <option value="<?= h($k) ?>" <?= $fLang === $k ? 'selected' : '' ?>><?= h($L['label']) ?></option>
      <?php endforeach; ?>
    </select>
    <?php if ($u): ?>
      <label class="chk"><input type="checkbox" name="mine" value="1" <?= $mineOnly ? 'checked' : '' ?>> 내 것만</label>
    <?php endif; ?>
    <button class="btn" type="submit">찾기</button>
  </form>

  <?php if (!$rows): ?>
    <div class="empty">조건에 맞는 제출이 없습니다.</div>
  <?php else: ?>
    <table class="list">
      <thead>
        <tr>
          <th style="width:64px">번호</th>
          <?php if ($u): ?><th style="width:110px">사용자</th><?php endif; ?>
          <th style="width:70px">문제</th>
          <th>제목</th>
          <th style="width:96px">판정</th>
          <th class="right" style="width:78px">시간</th>
          <th class="right" style="width:90px">메모리</th>
          <th style="width:78px">언어</th>
          <th class="right" style="width:130px">제출 시각</th>
        </tr>
      </thead>
      <tbody>
      <?php foreach ($rows as $r): ?>
        <tr class="<?= ($u && (int)$r['user_id'] === (int)$u['id']) ? 'me' : '' ?>">
          <td class="num"><?= (int)$r['id'] ?></td>
          <?php if ($u): ?>
            <td class="num"><a href="user.php?id=<?= rawurlencode($r['login_id']) ?>"><?= h($r['login_id']) ?></a></td>
          <?php endif; ?>
          <td class="num"><?= (int)$r['prob_no'] ?></td>
          <td class="title"><a href="problem.php?no=<?= (int)$r['prob_no'] ?>"><?= h($r['title']) ?></a></td>
          <td><?= verdict_badge($r['verdict'], $r['state']) ?></td>
          <td class="right num"><?= $r['max_time'] !== null
                ? number_format((float)$r['max_time'], 3) : '' ?></td>
          <td class="right num"><?= $r['max_memory'] ? number_format((int)$r['max_memory']) : '' ?></td>
          <td class="num">
            <?php $canView = $u && ((int)$r['user_id'] === (int)$u['id'] || $u['role'] === 'admin'); ?>
            <?php if ($canView): ?>
              <a class="codelink" href="?id=<?= (int)$r['id'] ?>" title="코드 보기"><?= h(lang_label($r['lang'])) ?></a>
            <?php else: ?>
              <?= h(lang_label($r['lang'])) ?>
            <?php endif; ?>
          </td>
          <td class="right num"><?= h(substr((string)$r['created_at'], 2)) ?></td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
  <?php endif; ?>

</div>
<?php page_foot(); ?>
