<?php
/* index.php — 첫 화면. 로그인하지 않아도 볼 수 있다. */
declare(strict_types=1);
require __DIR__ . '/guard.php';
require __DIR__ . '/layout.php';
$u = me();

/* 로그인 전 첫 화면은 제목판이 커서, 공지를 4개까지만 보여야
   1920×1080 화면에서 스크롤 없이 들어온다. */
$notices = notices_public($u ? 6 : 4);

$lessons = $u ? array_slice(array_filter(sets_for_student($u, 'lesson'),
                  fn($s) => set_state($s) !== 'after'), 0, 5) : [];
$assess  = $u ? array_slice(array_filter(sets_for_student($u, 'assessment'),
                  fn($s) => set_state($s) !== 'after'), 0, 5) : [];

page_head(['title' => '', 'root' => '', 'user' => $u, 'nav' => '']);
?>
<?php
  $site   = site_name();
  $heroOn = setting('hero_on') === '1';
  /* 첫 화면 제목판 (1.17.0) — 화면 끝까지 꽉 차는 띠. 이름은 본문 폭 안에 놓인다.
     연출을 켜 두면 hero.js 가 픽토그램으로 이름을 만들고, 이 글자는 화면 읽기 프로그램용으로만 남는다.
     연출을 껐거나 자바스크립트가 없으면 이 글자가 그대로 보인다. */
?>
<section class="hero<?= $u ? ' small' : '' ?><?= $heroOn ? ' anim' : '' ?>" id="hero"
         <?= $heroOn ? 'title="마우스를 대 보거나 눌러 보세요"' : '' ?>>
  <?php if ($heroOn): ?><canvas aria-hidden="true"></canvas><?php endif; ?>
  <h1 class="heroname"><?= h($site) ?></h1>
</section>

<div class="wrap home">

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
