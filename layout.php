<?php
/* ═══════════════════════════════════════════════
   layout.php — 채점 시스템 화면의 공통 껍데기.
   기존 layout.php(타자 연습)는 그대로 두고, 새 화면은 이 파일을 쓴다.

     page_head(['title'=>…, 'root'=>…, 'user'=>…, 'nav'=>'problems'])
     … 내용 …
     page_foot();

   nav 값 — 학생: problems | tags | results | lessons | assessments
            관리자: a_problems | a_sets | a_progress
   ═══════════════════════════════════════════════ */

require_once __DIR__ . '/Parsedown.php';

/* 마크다운 → HTML.
   문제 설명은 관리자만 작성하므로 HTML 태그를 그대로 허용한다
   (글자 색·크기처럼 마크다운에 없는 표현을 쓸 수 있게). */
function md(?string $src): string {
  static $pd = null;
  if ($pd === null) { $pd = new Parsedown(); $pd->setBreaksEnabled(true); }
  return $pd->text((string)$src);
}

/* ★ 정적 자원 주소에 파일이 바뀐 시각을 붙인다.
   js/css 는 이름이 그대로라 브라우저가 예전 것을 계속 쓴다.
   실제로 judge.js 를 고친 뒤 캐시된 옛 파일 때문에 회원 관리가 전부 멎은 적이 있다.
   고칠 때마다 값이 달라지므로 새로 받아 가고, 안 바뀌면 캐시를 그대로 쓴다. */
function asset(string $path, string $root = ''): string {
  $file = __DIR__ . '/' . ltrim($path, '/');
  $v = is_file($file) ? filemtime($file) : time();
  return h($root . $path) . '?v=' . $v;
}

/* 화면에 보일 사이트 이름. 운영 > 설정에서 바꾼다.
   비어 있으면 프로그램 이름을 그대로 쓴다. */
function site_name(): string {
  $n = trim(setting('site_name'));
  return $n !== '' ? $n : APP_NAME;
}

/* 로고·파비콘은 uploads/site/ 에 둔다. 값이 비면 올리지 않은 것이다. */
function site_image_url(string $key, string $root = ''): string {
  $f = trim(setting($key));
  if ($f === '') return '';
  $abs = UPLOAD_DIR . '/site/' . $f;
  if (!is_file($abs)) return '';
  return h($root . 'uploads/site/' . $f) . '?v=' . filemtime($abs);
}

/* 메뉴는 학생과 관리자가 같다. 가는 곳만 다르다.
   [이름, 학생이 갈 곳, 관리자가 갈 곳, 로그인 없이 볼 수 있는지, 관리자 전용인지] */
const JNAV = [
  'notices'     => ['공지사항',   'notices.php',     'admin/notices.php',              true,  false],
  'problems'    => ['문제 모음',  'problems.php',    'admin/problems.php',             true,  false],
  'tags'        => ['출처·분류',  'tags.php',        'tags.php',                        true,  false],
  'results'     => ['채점 결과',  'results.php',     'results.php',                     true,  false],
  'lessons'     => ['수업',      'lessons.php',     'admin/sets.php?type=lesson',     false, false],
  'assessments' => ['평가',      'assessments.php', 'admin/sets.php?type=assessment', false, false],
  'ops'         => ['운영',      '',                'admin/users.php',                false, true],
];

/* 운영 화면 안의 갈래.
   콘텐츠(문제·수업·평가)가 아니라 시스템을 다루는 것들을 여기 모은다. */
const OPS_TABS = [
  'users'    => ['회원',  'users.php'],
  'judge'    => ['채점',  'judge.php'],
  'langs'    => ['언어',  'langs.php'],
  'settings' => ['설정',  'settings.php'],
];
function ops_tabs(string $cur): string {
  $out = '<div class="tabbar">';
  foreach (OPS_TABS as $k => [$label, $href]) {
    $out .= '<a class="' . ($cur === $k ? 'on' : '') . '" href="' . h($href) . '">' . h($label) . '</a>';
  }
  return $out . '</div>';
}

/* 로그인하지 않은 사람에게 학번을 그대로 보여주지 않는다.
   10101 이 1학년 1반 1번이라는 것은 학교 사람이면 안다. */
function mask_id(string $s): string {
  $n = mb_strlen($s);
  if ($n <= 2) return str_repeat('*', $n);
  $keep = $n <= 4 ? 1 : 3;
  return mb_substr($s, 0, $keep) . str_repeat('*', $n - $keep);
}

function page_head(array $o): void {
  $root  = $o['root'] ?? '';
  $u     = $o['user'] ?? null;
  $nav   = $o['nav'] ?? '';
  $site  = site_name();
  $title = ($o['title'] ?? '') !== '' ? $o['title'] . ' · ' . $site : $site;
  $isAdmin  = ($u['role'] ?? '') === 'admin';
  /* admin/ 아래 화면은 언제나 관리자 메뉴, 그 밖에서는 세션에 기억된 선택을 따른다 */
  $inAdminDir  = ($o['root'] ?? '') === '../';
  $isAdminArea = $isAdmin && ($inAdminDir || ($_SESSION['admin_view'] ?? true));
  $here = $_SERVER['REQUEST_URI'] ?? '/';
  ?><!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= h($title) ?></title>
<?php $fav = site_image_url('favicon', $root); if ($fav !== ''): ?>
<link rel="icon" href="<?= $fav ?>">
<?php endif; ?>
<link rel="stylesheet" href="<?= asset('style.css', $root) ?>">
<script>window.API = <?= json_encode($root . 'api.php') ?>;</script>
</head>
<body>

<header class="top">
  <div class="top-in">
    <?php $logo = site_image_url('logo', $root); ?>
    <a class="brand<?= $logo !== '' ? ' haslogo' : '' ?>" href="<?= h($root) ?>index.php">
      <?php if ($logo !== ''): ?><img src="<?= $logo ?>" alt="<?= h($site) ?>">
      <?php else: ?><?= h($site) ?><?php endif; ?>
    </a>
    <nav class="mainnav">
      <?php foreach (JNAV as $k => [$label, $sHref, $aHref, $guestOk, $adminOnly]): ?>
        <?php
          if (!$u && !$guestOk) continue;
          if ($adminOnly && ($u['role'] ?? '') !== 'admin') continue;
          $href = ($isAdminArea && $aHref !== '') ? $aHref : $sHref;
          if ($href === '') continue;
        ?>
        <a class="<?= $nav === $k ? 'on' : '' ?>" href="<?= h($root . $href) ?>"><?= h($label) ?></a>
      <?php endforeach; ?>
    </nav>
    <?php if ($u): ?>
      <a class="who" href="<?= h($root) ?>user.php"
         ><b><?= h($u['name'] !== '' ? $u['name'] : $u['login_id']) ?></b><span class="sub2">(나의 활동)</span></a>
      <div class="util">
        <?php if ($isAdmin): ?>
          <?php if ($isAdminArea): ?>
            <a href="<?= h($root) ?>index.php?view=student">학생 화면</a>
          <?php else: ?>
            <a class="viewmark" href="<?= h($root) ?>admin/problems.php?view=admin">관리자로 돌아가기</a>
          <?php endif; ?>
        <?php endif; ?>
        <a href="<?= h($root) ?>password.php">비밀번호</a>
        <a href="<?= h($root) ?>logout.php">로그아웃</a>
      </div>
    <?php else: ?>
      <a class="btn sm primary" href="<?= h($root) ?>login.php?next=<?= rawurlencode($here) ?>">로그인</a>
    <?php endif; ?>
  </div>
</header>
<?php
}

/* 페이지 링크. 현재 주소의 다른 조건(검색·분류)은 그대로 유지한다. */
function pager(int $page, int $pages, string $param = 'p'): string {
  if ($pages <= 1) return '';
  $q = $_GET; unset($q[$param]);
  $url = fn(int $n) => '?' . http_build_query($q + [$param => $n]);

  $out = '<nav class="pager">';
  $out .= $page > 1
    ? '<a class="btn sm" href="' . h($url($page - 1)) . '">이전</a>'
    : '<span class="btn sm" aria-disabled="true">이전</span>';

  /* 현재 쪽 앞뒤 두 개씩, 처음과 끝은 항상 */
  $show = [1, $pages];
  for ($i = $page - 2; $i <= $page + 2; $i++) if ($i >= 1 && $i <= $pages) $show[] = $i;
  $show = array_values(array_unique($show)); sort($show);

  $prev = 0;
  foreach ($show as $n) {
    if ($prev && $n > $prev + 1) $out .= '<span class="gap">…</span>';
    $out .= $n === $page
      ? '<span class="btn sm on">' . $n . '</span>'
      : '<a class="btn sm" href="' . h($url($n)) . '">' . $n . '</a>';
    $prev = $n;
  }

  $out .= $page < $pages
    ? '<a class="btn sm" href="' . h($url($page + 1)) . '">다음</a>'
    : '<span class="btn sm" aria-disabled="true">다음</span>';
  return $out . '</nav>';
}

/* 꼬리말.
   위쪽은 설치한 학교가 운영 > 설정에서 채우는 자리,
   아래쪽은 프로그램과 라이선스 표기다.

   ★ 아래쪽은 설정으로 지울 수 없게 해 두었다.
     KAIT-CLASS 자체의 저작권 표기는 라이선스(PolyForm Noncommercial)의 조건이다.
     Pretendard(OFL 1.1) · CodeMirror(MIT) · Parsedown(MIT) 은
     모두 저작권 표시를 요구하고, Judge0 는 GPL 이다.
     지울 수 있게 만들면 라이선스를 어기는 길을 열어 주는 셈이 된다. */
function page_foot(string $root = ''): void {
  $extra = trim(setting('footer_extra'));
  ?>
<footer class="foot">
  <div class="foot-in">
    <?php if ($extra !== ''): ?>
      <div class="foot-extra"><?= md($extra) ?></div>
    <?php endif; ?>
    <div class="small foot-app">
      <span title="v<?= h(APP_VERSION) ?>"><?= h(APP_NAME) ?> v<?= h(app_version_short()) ?></span>
      <span class="sep">·</span>
      © <?= h(APP_COPYRIGHT_YEAR) ?>
      <?php foreach (APP_OWNERS as $i => $o): $mail = str_starts_with($o['url'], 'mailto:'); ?><?= $i ? ' · ' : ' ' ?><a href="<?= h($o['url']) ?>"<?= $mail ? ' title="메일 보내기"' : ' target="_blank" rel="noopener"' ?>><?= h($o['name']) ?></a><?php endforeach; ?>
      <span class="sep">·</span>
      <a href="<?= h(APP_LICENSE_URL) ?>" target="_blank" rel="noopener" title="<?= h(APP_LICENSE_NAME) ?>">비상업 라이선스</a>
      <span class="sep">·</span>
      소스 <a href="<?= h(APP_REPO) ?>" target="_blank" rel="noopener"><?= h(preg_replace('#^https?://#', '', APP_REPO)) ?></a>
    </div>
    <div class="small foot-lic">
      글꼴 <a href="https://github.com/orioncactus/pretendard" target="_blank" rel="noopener">Pretendard</a> (SIL OFL 1.1)
      <span class="sep">·</span>
      편집기 <a href="https://codemirror.net/5/" target="_blank" rel="noopener">CodeMirror 5</a> (MIT)
      <span class="sep">·</span>
      마크다운 <a href="https://github.com/erusev/parsedown" target="_blank" rel="noopener">Parsedown</a> (MIT)
      <span class="sep">·</span>
      채점 <a href="https://judge0.com/" target="_blank" rel="noopener">Judge0</a> (GPL)
    </div>
  </div>
</footer>
</body>
</html>
<?php }

/* 판정 배지.
   색만으로 구분하면 색각 이상이 있는 학생이 알아보기 어렵다.
   그래서 기호와 글자를 항상 함께 붙인다. */
const VERDICT_MARK = [
  'AC' => '✓', 'WA' => '✕', 'TLE' => '⏱', 'MLE' => '▣',
  'RE' => '⚠', 'CE' => '⚠', 'IE' => '⚠',
];
function verdict_badge(?string $v, ?string $state = null): string {
  if ($state === 'pending' || $state === 'judging') {
    return '<span class="v v-wait">◌ 채점 중</span>';
  }
  if ($v === null || $v === '') return '<span class="v v-wait">-</span>';
  $label = VERDICT_NAME[$v] ?? $v;
  $mark  = VERDICT_MARK[$v] ?? '';
  return '<span class="v v-' . h($v) . '" title="' . h($label) . '">'
       . h($mark . ' ' . $v) . '</span>';
}
