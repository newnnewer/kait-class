<?php
/* ═══════════════════════════════════════════════
   home_theme.php — 테마(아케이드 · 터미널)의 첫 화면 (2.0.0)

   index.php 가 테마를 쓰는 사이트에서만 불러온다. 기본 테마의 첫 화면은 index.php 에 그대로 있다.
   화면을 채우는 큰 그림 위에 소개글(운영 > 설정)과 갈 곳 몇 개만 둔다.

     로그인 전  화면 가득 — 소개글 · [문제 풀러 가기] [로그인] [KAIT-PLAY] · 최근 공지 한 줄
     로그인 후  높이를 줄이고 — 소개글 · 지금 할 수업 하나 · 평가 하나 · 최근 공지 한 줄 · 작은 단추

   index.php 가 넘겨 주는 것: $u · $site · $heroOn · $notices · $lessons · $assess
   배경 움직임은 home.js (연출을 꺼 두면 그림 없이 바탕색만). 모양은 themes/<테마>.css.
   ═══════════════════════════════════════════════ */
declare(strict_types=1);

$T    = site_theme();
$msg  = trim(setting('home_msg'));
$big  = $msg !== '' ? $msg : $site;          /* 소개글을 비워 두면 사이트 이름을 크게 */
$play = play_menu_on();
$n1   = $notices[0] ?? null;
/* 지금 열려 있는 것을 먼저, 없으면 곧 시작할 것 */
$pick = function (array $sets) {
  foreach ($sets as $s) if (set_state($s) === 'open') return $s;
  return $sets[0] ?? null;
};
$l1 = $u ? $pick(array_values($lessons)) : null;
$a1 = $u ? $pick(array_values($assess))  : null;
/* 터미널의 명령 줄 머리말: 아이디@사이트:~$ */
$host = preg_match('/^[A-Za-z0-9._-]+$/', $site) ? strtolower($site) : 'kait-class';
$tp   = '<span class="tp">' . h(($u['login_id'] ?? 'guest') . '@' . $host) . ':~$</span> ';
?>
<section class="thome <?= $u ? 'half' : 'full' ?>" id="thome">
  <?php if ($heroOn): ?><canvas aria-hidden="true"></canvas><?php endif; ?>
  <div class="thome-in">

    <?php if ($T === 'terminal'): ?>
      <div class="tline" aria-hidden="true"><?= $tp ?>cat welcome</div>
      <?php if ($msg !== '' && !$u): ?><pre class="tlogo" aria-hidden="true"></pre><?php endif; ?>
    <?php elseif ($msg !== ''): ?>
      <span class="tbrand"><?= h($site) ?></span>
    <?php endif; ?>

    <h1 class="tmsg" aria-label="<?= h($big) ?>"><span class="tmsg-t" aria-hidden="true"><?= h($big) ?></span><?php
      if ($T === 'terminal'): ?><span class="tcur" aria-hidden="true"></span><?php endif; ?></h1>

    <?php if (!$u): ?>
      <div class="tcta">
        <a class="tbtn go" href="problems.php">문제 풀러 가기</a>
        <a class="tbtn" href="login.php">로그인</a>
        <?php if ($play): ?><a class="tbtn pl" href="/play/" target="_blank" rel="noopener">KAIT-PLAY</a><?php endif; ?>
      </div>
    <?php else: ?>
      <?php if ($l1 || $a1): ?>
        <?php if ($T === 'terminal'): ?><div class="tline gap" aria-hidden="true"><?= $tp ?>ls 진행중/</div><?php endif; ?>
        <div class="tgo">
          <?php foreach ([['수업', 'lessons', $l1], ['평가', 'assessments', $a1]] as [$lab, $ik, $s]): if (!$s) continue; ?>
            <a class="tgocard is-<?= $ik ?>" href="set.php?id=<?= (int)$s['id'] ?>">
              <span class="tgo-ic"><?= icon($ik) ?></span>
              <span class="tgo-b">
                <span class="tgo-k"><?= $lab ?> · <?= h(SET_STATE_NAME[set_state($s)]) ?></span>
                <span class="tgo-n"><?= h($s['title']) ?></span>
              </span>
              <span class="tgo-a" aria-hidden="true">▶</span>
            </a>
          <?php endforeach; ?>
        </div>
      <?php else: /* 지금 할 수업 · 평가가 없으면 문제 모음으로 */ ?>
        <div class="tcta">
          <a class="tbtn go" href="problems.php">문제 풀러 가기</a>
        </div>
      <?php endif; ?>
    <?php endif; ?>

    <?php if ($n1): ?>
      <div class="tfeed">
        <?php if ($T === 'terminal' && !$u): ?><div class="tline" aria-hidden="true"><?= $tp ?>tail -1 공지</div><?php endif; ?>
        <a class="tnote" href="notice.php?id=<?= (int)$n1['id'] ?>">
          <span class="tlab">공지</span>
          <span class="tnote-t"><?= h($n1['title']) ?></span>
          <span class="tnote-d"><?= h(substr((string)$n1['created_at'], 5, 5)) ?></span>
        </a>
      </div>
    <?php endif; ?>

    <?php if ($u): ?>
      <div class="tlinks">
        <?php if ($l1 || $a1): ?><a class="tbtn sm" href="problems.php">문제 모음</a><?php endif; ?>
        <a class="tbtn sm" href="user.php">나의 활동</a>
        <a class="tbtn sm" href="notices.php">공지사항</a>
        <?php if ($play): ?><a class="tbtn sm pl" href="/play/" target="_blank" rel="noopener">KAIT-PLAY</a><?php endif; ?>
      </div>
    <?php endif; ?>

  </div>
</section>
<?php if ($heroOn): ?>
<script>window.SITE_NAME = <?= json_encode($site, JSON_UNESCAPED_UNICODE) ?>;</script>
<script src="<?= asset('home.js') ?>"></script>
<?php endif; ?>
