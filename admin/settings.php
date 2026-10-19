<?php
/* ═══════════════════════════════════════════════
   admin/settings.php — 운영 > 설정

   설치한 학교가 웹 화면에서 바꾸는 값들.
   DB 경로나 Judge0 주소처럼 환경에 매인 것은 여기가 아니라 config.php 에 있다.
   ═══════════════════════════════════════════════ */
declare(strict_types=1);
require_once __DIR__ . '/../guard.php';
require_once __DIR__ . '/../layout.php';
require_once __DIR__ . '/../ai_lib.php';
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

if (DEMO_MODE && $_SERVER['REQUEST_METHOD'] === 'POST') {
  $err[] = DEMO_BLOCKED;
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {

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
    setting_set('play_menu',    empty($_POST['play_menu']) ? '0' : '1');
    /* AI 도우미. 키 입력란이 비어 있으면 저장된 키를 그대로 둔다
       (저장된 키를 화면에 다시 채워 보내지 않으려고) */
    setting_set('ai_on',    empty($_POST['ai_on']) ? '0' : '1');
    $aiModel = (string)($_POST['ai_model'] ?? '');
    setting_set('ai_model', isset(AI_MODELS[$aiModel]) ? $aiModel : AI_DEFAULT_MODEL);
    setting_set('ai_limit', (string)max(0, (int)preg_replace('/[^0-9]/', '', (string)($_POST['ai_limit'] ?? '0'))));
    $aiKey = trim((string)($_POST['ai_key'] ?? ''));
    if (!empty($_POST['ai_key_drop'])) setting_set('ai_key', '');
    elseif ($aiKey !== '') setting_set('ai_key', $aiKey);
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
      <label>KAIT-PLAY (코딩 게임)</label>
      <?php if (play_installed()): ?>
        <div class="chips">
          <label class="chip">
            <input type="checkbox" name="play_menu" value="1" <?= $v('play_menu') === '1' ? 'checked' : '' ?>>
            <span>위쪽 메뉴에 KAIT-PLAY 링크 보이기</span>
          </label>
        </div>
        <div class="small muted">누르면 새 탭에서 <a href="/play/" target="_blank" rel="noopener">/play/</a> 가 열립니다.
          학생은 계정 없이 닉네임으로 들어갑니다. 교사 화면은 <a href="/play/teacher" target="_blank" rel="noopener">/play/teacher</a>
          — 비밀번호는 KAIT-CLASS 관리자 비밀번호와 <b>따로</b>입니다.</div>
      <?php else: ?>
        <input type="hidden" name="play_menu" value="<?= h(setting('play_menu')) ?>">
        <div class="small muted">이 서버에는 설치되어 있지 않습니다.
          소스 폴더에서 <code>sudo bash play/install.sh</code> 로 설치할 수 있습니다.</div>
      <?php endif; ?>
    </div>

    <div class="field" id="ai">
      <label>AI 도우미 (교사용)</label>
      <?php $aiU = ai_usage(); $aiMasked = ai_key_masked(); ?>
      <div class="chips">
        <label class="chip">
          <input type="checkbox" name="ai_on" value="1" <?= $v('ai_on') === '1' ? 'checked' : '' ?>>
          <span>교사 화면 오른쪽 아래에 AI 도우미 단추 보이기</span>
        </label>
      </div>
      <div class="aiset">
        <label for="ai_model" class="small">모델</label>
        <select id="ai_model" name="ai_model">
          <?php foreach (AI_MODELS as $mk => $mv): ?>
            <option value="<?= h($mk) ?>" <?= ai_model() === $mk ? 'selected' : '' ?>><?= h($mv['label']) ?></option>
          <?php endforeach; ?>
        </select>

        <label for="ai_key" class="small">API 키</label>
        <div class="aiset-row">
          <input type="password" id="ai_key" name="ai_key" autocomplete="off"
                 placeholder="<?= $aiMasked !== '' ? h($aiMasked) . ' (바꿀 때만 입력)' : 'sk-ant-…' ?>">
          <button class="btn" type="button" id="ai_test">연결 테스트</button>
        </div>
        <?php if ($aiMasked !== ''): ?>
          <label class="chip small"><input type="checkbox" name="ai_key_drop" value="1"><span>저장된 키 지우기</span></label>
        <?php endif; ?>
        <div class="small" id="ai_test_out" aria-live="polite"></div>

        <label for="ai_limit" class="small">월 한도</label>
        <div class="aiset-row">
          <input type="text" id="ai_limit" name="ai_limit" inputmode="numeric" style="max-width:120px"
                 value="<?= h($v('ai_limit')) ?>"> <span class="small">원 · 0 이면 한도 없음</span>
        </div>
        <div class="small muted">이번 달(<?= h($aiU['m']) ?>) 약 <b><?= number_format(ai_krw($aiU['usd'])) ?>원</b> · 질문 <?= number_format($aiU['n']) ?>회</div>
      </div>
      <div class="small muted">
        키는 <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener">Anthropic 콘솔</a>에서 만들고,
        요금은 그 계정에 청구됩니다. 키는 이 서버에만 저장되고 화면에는 앞뒤 몇 글자만 보입니다.
        한도·사용량은 1달러 = <?= number_format(AI_KRW_PER_USD) ?>원으로 어림한 값입니다.<br>
        AI 에는 질문과 조회 결과(제출 코드 포함)가 보내집니다. <b>학생 이름과 아이디는 보내지 않습니다</b> —
        화면에 보일 때만 이름으로 바뀝니다. 대화는 서버에 남지 않고 브라우저 탭을 닫으면 사라집니다.
        모든 교사 계정이 도우미를 쓸 수 있습니다.
      </div>
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
<script>
/* 연결 테스트 — 입력란에 새 키가 있으면 그것으로, 없으면 저장된 키로 */
document.getElementById('ai_test').addEventListener('click', async (ev) => {
  const btn = ev.currentTarget, out = document.getElementById('ai_test_out');
  btn.disabled = true; out.className = 'small muted'; out.textContent = '확인하는 중…';
  try {
    const r = await fetch('../ai.php?action=test', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({key: document.getElementById('ai_key').value, model: document.getElementById('ai_model').value})
    });
    const j = await r.json();
    out.className = 'small ' + (j.ok ? 'ok-text' : 'bad-text');
    out.textContent = j.ok ? j.msg + ' 키를 새로 썼다면 저장을 눌러야 반영됩니다.' : j.error;
  } catch (e) {
    out.className = 'small bad-text'; out.textContent = '서버가 응답하지 않습니다.';
  } finally { btn.disabled = false; }
});
</script>
<?php page_foot(); ?>
