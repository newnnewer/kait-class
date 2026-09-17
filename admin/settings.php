<?php
/* ═══════════════════════════════════════════════
   admin/settings.php — 운영 > 설정

   설치한 학교가 웹 화면에서 바꾸는 값들.
   DB 경로나 Judge0 주소처럼 환경에 매인 것은 여기가 아니라 config.php 에 있다.
   ═══════════════════════════════════════════════ */
declare(strict_types=1);
require_once __DIR__ . '/../guard.php';
require_once __DIR__ . '/../layout.php';
$me = need_admin('../');

/* 사이트 이름 길이는 글자 수가 아니라 표시 폭으로 잰다.
   한글은 고정폭 글꼴에서 두 칸을 차지해서, 글자 수로 재면
   첫 화면 연출의 코드 줄이 화면 밖으로 나간다. */
function display_width(string $s): int {
  $w = 0;
  foreach (preg_split('//u', $s, -1, PREG_SPLIT_NO_EMPTY) as $ch) {
    $w += preg_match('/[\x{1100}-\x{115F}\x{2E80}-\x{A4CF}\x{AC00}-\x{D7A3}\x{F900}-\x{FAFF}\x{FE30}-\x{FE6F}\x{FF00}-\x{FF60}\x{FFE0}-\x{FFE6}]/u', $ch) ? 2 : 1;
  }
  return $w;
}
const SITE_NAME_MAX_WIDTH = 40;   /* 영문 40자 = 한글 20자 */

/* 로고·파비콘 저장 위치. 문제 이미지와 섞이지 않게 따로 둔다. */
const SITE_IMG_DIR = 'site';

/* 올린 이미지를 저장하고 예전 파일을 지운다. 파일 이름을 돌려준다. */
function save_site_image(array $f, string $key, array &$err): ?string {
  if (($f['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) return null;   /* 안 골랐으면 그대로 */
  if ($f['error'] !== UPLOAD_ERR_OK)      { $err[] = '파일을 받지 못했습니다.'; return null; }
  if ($f['size'] > 2 * 1024 * 1024)       { $err[] = '이미지는 2MB까지 올릴 수 있습니다.'; return null; }

  $info = @getimagesize($f['tmp_name']);
  $ext = match ($info['mime'] ?? '') {
    'image/png' => 'png', 'image/jpeg' => 'jpg',
    'image/gif' => 'gif', 'image/webp' => 'webp',
    default => null,
  };
  if ($ext === null) { $err[] = 'PNG · JPG · GIF · WEBP 만 올릴 수 있습니다.'; return null; }

  $dir = UPLOAD_DIR . '/' . SITE_IMG_DIR;
  if (!is_dir($dir) && !@mkdir($dir, 0775, true)) { $err[] = '업로드 폴더를 만들지 못했습니다.'; return null; }

  /* 이름에 임의의 값을 넣는다. 같은 이름으로 덮어쓰면 캐시 때문에 예전 그림이 남는다. */
  $name = $key . '_' . bin2hex(random_bytes(5)) . '.' . $ext;
  if (!@move_uploaded_file($f['tmp_name'], $dir . '/' . $name)) { $err[] = '파일을 저장하지 못했습니다.'; return null; }
  @chmod($dir . '/' . $name, 0644);

  /* 예전 것 지우기 */
  $old = trim(setting($key));
  if ($old !== '' && is_file($dir . '/' . $old)) @unlink($dir . '/' . $old);

  return $name;
}

function drop_site_image(string $key): void {
  $old = trim(setting($key));
  if ($old !== '') {
    $abs = UPLOAD_DIR . '/' . SITE_IMG_DIR . '/' . $old;
    if (is_file($abs)) @unlink($abs);
  }
  setting_set($key, '');
}

$err = [];
$saved = false;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {

  /* 지우기 단추는 저장과 따로 논다 */
  if (($_POST['drop'] ?? '') === 'logo')    { drop_site_image('logo');    header('Location: settings.php?saved=1'); exit; }
  if (($_POST['drop'] ?? '') === 'favicon') { drop_site_image('favicon'); header('Location: settings.php?saved=1'); exit; }

  $name = trim((string)($_POST['site_name'] ?? ''));
  if ($name === '') {
    $err[] = '사이트 이름을 입력하세요.';
  } elseif (display_width($name) > SITE_NAME_MAX_WIDTH) {
    $err[] = '사이트 이름이 너무 깁니다. 한글 20자(영문 40자) 이내로 써 주세요.';
  } elseif (preg_match('/["\'\\\\\n\r]/', $name)) {
    /* 첫 화면 연출이 이 이름을 코드 문자열 안에 넣는다.
       따옴표가 섞이면 실행되지 않는 코드가 화면에 뜬다. */
    $err[] = '사이트 이름에 따옴표(" \')와 역슬래시(\\)는 쓸 수 없습니다.';
  }

  $logoName = save_site_image($_FILES['logo']    ?? [], 'logo',    $err);
  $favName  = save_site_image($_FILES['favicon'] ?? [], 'favicon', $err);

  if (!$err) {
    setting_set('site_name',    $name);
    setting_set('hero_on',      empty($_POST['hero_on'])   ? '0' : '1');
    setting_set('signup_on',    empty($_POST['signup_on']) ? '0' : '1');
    setting_set('footer_extra', nl_clean((string)($_POST['footer_extra'] ?? '')));
    if ($logoName !== null) setting_set('logo',    $logoName);
    if ($favName  !== null) setting_set('favicon', $favName);
    header('Location: settings.php?saved=1'); exit;
  }
}

$saved = isset($_GET['saved']);

/* 화면에 보일 값 — 방금 입력한 것이 있으면 그것을, 아니면 저장된 것을 */
$v = fn(string $k) => (string)($_POST[$k] ?? setting($k));

page_head(['title' => '설정', 'root' => '../', 'user' => $me, 'nav' => 'ops']);
?>
<div class="wrap">
  <h2 class="phead">운영</h2>
  <?= ops_tabs('settings') ?>

  <?php if ($saved): ?><div class="note ok">저장했습니다.</div><?php endif; ?>
  <?php foreach ($err as $e): ?><div class="note bad"><?= h($e) ?></div><?php endforeach; ?>

  <form method="post" enctype="multipart/form-data">

    <div class="field">
      <label for="site_name">사이트 이름</label>
      <input type="text" id="site_name" name="site_name" style="max-width:320px"
             value="<?= h($v('site_name')) ?>" required autofocus>
      <div class="small muted">화면 위쪽과 브라우저 탭에 보입니다. 한글 20자 이내.
        로고를 올리면 위쪽에는 로고가 대신 보이지만, 탭 제목에는 이 이름이 쓰입니다.</div>
    </div>

    <div class="row">
      <div class="field">
        <label>로고</label>
        <?php $logo = site_image_url('logo', '../'); ?>
        <?php if ($logo !== ''): ?>
          <div style="margin-bottom:8px"><img src="<?= $logo ?>" alt="로고" style="height:32px"></div>
        <?php endif; ?>
        <input type="file" name="logo" accept="image/png,image/jpeg,image/gif,image/webp">
        <?php if ($logo !== ''): ?>
          <button class="btn sm" type="submit" name="drop" value="logo"
                  onclick="return confirm('로고를 지울까요? 사이트 이름이 글자로 보이게 됩니다.')">지우기</button>
        <?php endif; ?>
        <div class="small muted">배경이 투명한 PNG 를 권합니다. 세로 64px 이상, 가로세로 비율 4:1 이내.
          화면에서는 세로 26px 로 줄여 보여 줍니다.</div>
      </div>

      <div class="field">
        <label>파비콘</label>
        <?php $fav = site_image_url('favicon', '../'); ?>
        <?php if ($fav !== ''): ?>
          <div style="margin-bottom:8px"><img src="<?= $fav ?>" alt="파비콘" style="height:24px"></div>
        <?php endif; ?>
        <input type="file" name="favicon" accept="image/png,image/jpeg,image/gif,image/webp">
        <?php if ($fav !== ''): ?>
          <button class="btn sm" type="submit" name="drop" value="favicon"
                  onclick="return confirm('파비콘을 지울까요?')">지우기</button>
        <?php endif; ?>
        <div class="small muted">브라우저 탭에 보이는 작은 그림입니다. 정사각형 PNG, 64×64 이상.</div>
      </div>
    </div>

    <div class="field">
      <label>첫 화면</label>
      <div class="chips">
        <label class="chip">
          <input type="checkbox" name="hero_on" value="1" <?= $v('hero_on') === '1' ? 'checked' : '' ?>>
          <span>코드가 한 글자씩 쳐지는 연출 보여주기</span>
        </label>
      </div>
      <div class="small muted">일부 컴퓨터에서 멈추는 일이 보고되어 있습니다. 이상하면 꺼 두세요.</div>
    </div>

    <div class="field">
      <label>회원가입</label>
      <div class="chips">
        <label class="chip">
          <input type="checkbox" name="signup_on" value="1" <?= $v('signup_on') === '1' ? 'checked' : '' ?>>
          <span>누구나 가입할 수 있게 하기</span>
        </label>
      </div>
      <div class="small muted">가입한 계정은 <b>반이 없고</b>, 관리자가 승인해야 쓸 수 있습니다.
        반이 없으므로 공개 대상이 &lsquo;지정한 반&rsquo;인 수업·평가에는 들어가지 못합니다.
        우리 학교 학생은 이 기능 대신 <a href="users.php">운영 &gt; 회원</a>에서 일괄 등록하세요.</div>
    </div>

    <div class="field">
      <label for="footer_extra">꼬리말 추가</label>
      <textarea id="footer_extra" name="footer_extra" rows="4"
                placeholder="예) KAIT중학교·문의 admin@example.kr"><?= h($v('footer_extra')) ?></textarea>
      <div class="small muted">화면 맨 아래에 붙습니다. 마크다운을 쓸 수 있습니다.
        프로그램·라이선스 표기는 그 아래에 항상 함께 나옵니다.</div>
    </div>

    <div class="field">
      <button class="btn primary" type="submit">저장</button>
    </div>
  </form>
</div>
<?php page_foot(); ?>
