<?php
/* index.php — 첫 화면. 로그인하지 않아도 볼 수 있다. */
declare(strict_types=1);
require __DIR__ . '/guard.php';
require __DIR__ . '/layout.php';
$u = me();

$probCnt  = (int)col("SELECT COUNT(*) FROM problems");
$solveCnt = (int)col("SELECT COUNT(*) FROM submissions WHERE verdict='AC'");

/* 로그인 전 첫 화면은 제목판이 커서, 공지를 4개까지만 보여야
   1920×1080 화면에서 스크롤 없이 들어온다. */
$notices = notices_public($u ? 6 : 4);

$lessons = $u ? array_slice(array_filter(sets_for_student($u, 'lesson'),
                  fn($s) => set_state($s) !== 'after'), 0, 5) : [];
$assess  = $u ? array_slice(array_filter(sets_for_student($u, 'assessment'),
                  fn($s) => set_state($s) !== 'after'), 0, 5) : [];

page_head(['title' => '', 'root' => '', 'user' => $u, 'nav' => '']);
?>
<div class="wrap home">

  <?php
    $site   = site_name();
    $heroOn = setting('hero_on') === '1';
    /* ★ str_split 은 바이트로 자른다. 한글 이름이면 글자가 깨진다.
       preg_split 으로 글자 단위로 나눈다. */
    $chars  = preg_split('//u', $site, -1, PREG_SPLIT_NO_EMPTY);
  ?>
  <section class="hero <?= $u ? 'small' : '' ?>">
    <?php if ($heroOn): ?>
    <div class="codeplay" id="codeplay">
      <div class="cpwin">
        <div class="cpbar"><i></i><i></i><i></i><b id="cpLang">Python3</b></div>
        <pre class="cpcode"><code id="cpCode"></code><i class="cpcaret"></i></pre>
      </div>
      <div class="cparrow">실행</div>
      <h1 id="cpTitle"><?php foreach ($chars as $ch): ?><span><?= h($ch) ?></span><?php endforeach; ?></h1>
    </div>
    <?php else: ?>
      <h1 class="heroname"><?= h($site) ?></h1>
    <?php endif; ?>
    <p><b>컴퓨팅 사고력</b>이 자라는 특별한 프로그래밍 수업</p>
    <?php if (!$u): ?>
      <div class="herobtns">
        <a class="btn primary big" href="problems.php">문제 보러 가기</a>
        <a class="btn big" href="login.php">로그인</a>
      </div>
      <p class="small muted" style="margin-top:14px">
        문제 <?= number_format($probCnt) ?>개 · 지금까지 맞은 제출 <?= number_format($solveCnt) ?>건
      </p>
    <?php endif; ?>
  </section>

  <div class="homecols">
    <section class="homecol">
      <h2>공지사항 <a class="more" href="notices.php">더보기</a></h2>
      <div class="homebody">
        <?php if (!$notices): ?>
          <p class="small muted">아직 공지가 없습니다.</p>
        <?php else: foreach ($notices as $n): ?>
          <a class="homeitem" href="notice.php?id=<?= (int)$n['id'] ?>">
            <?php if ((int)$n['pinned']): ?><span class="v v-AC">공지</span><?php endif; ?>
            <span class="t"><?= h($n['title']) ?></span>
            <span class="small muted nowrap"><?= h(substr((string)$n['created_at'], 5, 5)) ?></span>
          </a>
        <?php endforeach; endif; ?>
      </div>
    </section>

    <section class="homecol">
      <h2>수업<?= $u ? ' <a class="more" href="lessons.php">더보기</a>' : '' ?></h2>
      <div class="homebody">
        <?php if (!$u): ?>
          <p class="small muted">로그인하면 참여할 수업이 보입니다.</p>
        <?php elseif (!$lessons): ?>
          <p class="small muted">진행 중인 수업이 없습니다.</p>
        <?php else: foreach ($lessons as $s): ?>
          <a class="homeitem" href="set.php?id=<?= (int)$s['id'] ?>">
            <span class="t"><?= h($s['title']) ?></span>
            <span class="v <?= set_state($s) === 'open' ? 'v-open' : 'v-wait' ?>">
              <?= h(SET_STATE_NAME[set_state($s)]) ?></span>
          </a>
        <?php endforeach; endif; ?>
      </div>
    </section>

    <section class="homecol">
      <h2>평가<?= $u ? ' <a class="more" href="assessments.php">더보기</a>' : '' ?></h2>
      <div class="homebody">
        <?php if (!$u): ?>
          <p class="small muted">로그인하면 참여할 평가가 보입니다.</p>
        <?php elseif (!$assess): ?>
          <p class="small muted">진행 중인 평가가 없습니다.</p>
        <?php else: foreach ($assess as $s): ?>
          <a class="homeitem" href="set.php?id=<?= (int)$s['id'] ?>">
            <span class="t"><?= h($s['title']) ?></span>
            <span class="v <?= set_state($s) === 'open' ? 'v-open' : 'v-wait' ?>">
              <?= h(SET_STATE_NAME[set_state($s)]) ?></span>
          </a>
        <?php endforeach; endif; ?>
      </div>
    </section>
  </div>

</div>
<?php if ($heroOn): ?>
<script>window.SITE_NAME = <?= json_encode($site, JSON_UNESCAPED_UNICODE) ?>;</script>
<script src="<?= asset('hero.js') ?>"></script>
<?php endif; ?>
<?php page_foot(); ?>
