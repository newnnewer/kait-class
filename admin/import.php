<?php
/* admin/import.php — FPS XML(또는 그것을 담은 ZIP)에서 문제를 가져온다 */
declare(strict_types=1);
require_once __DIR__ . '/../guard.php';
require_once __DIR__ . '/../fps.php';
$u = need_admin('../');

$err = ''; $warn = []; $done = null;
$mode = (string)($_POST['mode'] ?? 'new');
if (!in_array($mode, ['new', 'skip', 'overwrite'], true)) $mode = 'new';

if (($_POST['do'] ?? '') === 'import') {
  $upErr = $_FILES['file']['error'] ?? UPLOAD_ERR_NO_FILE;
  if ($upErr !== UPLOAD_ERR_OK) {
    $err = ($upErr === UPLOAD_ERR_INI_SIZE || $upErr === UPLOAD_ERR_FORM_SIZE)
         ? '파일이 서버가 받을 수 있는 크기를 넘었습니다.'
         : '파일을 받지 못했습니다.';
  } elseif ($_FILES['file']['size'] > 40 * 1024 * 1024) {
    $err = '40MB까지 올릴 수 있습니다.';
  } elseif (!function_exists('simplexml_load_string')) {
    $err = 'php-xml 확장이 없습니다. apt install php8.4-xml 후 재시작하세요.';
  } else {
    /* XML 여러 개를 모아 읽는다 (ZIP 이면 안의 xml 을 전부) */
    $docs = [];
    $tmp  = $_FILES['file']['tmp_name'];
    $isZip = strtolower(pathinfo((string)$_FILES['file']['name'], PATHINFO_EXTENSION)) === 'zip';

    if ($isZip) {
      if (!class_exists('ZipArchive')) {
        $err = 'php-zip 확장이 없습니다.';
      } else {
        $zip = new ZipArchive();
        if ($zip->open($tmp) !== true) { $err = 'ZIP 을 열지 못했습니다.'; }
        else {
          for ($i = 0; $i < $zip->numFiles; $i++) {
            $n = $zip->getNameIndex($i);
            if (str_contains($n, '__MACOSX/')) continue;
            if (strtolower(pathinfo($n, PATHINFO_EXTENSION)) !== 'xml') continue;
            $docs[] = (string)$zip->getFromIndex($i);
          }
          $zip->close();
          if (!$docs) $err = 'ZIP 안에서 XML 을 찾지 못했습니다.';
        }
      }
    } else {
      $docs[] = (string)file_get_contents($tmp);
    }

    if ($err === '') {
      $made = 0; $updated = 0; $skipped = [];
      foreach ($docs as $xml) {
        [$problems, $w] = fps_parse($xml);
        $warn = array_merge($warn, $w);
        foreach ($problems as $p) {
          $warn = array_merge($warn, fps_store_images($p));
          try {
            [$res, $no] = fps_save_problem($p, $mode);
            if ($res === 'made') $made++;
            elseif ($res === 'updated') $updated++;
            else $skipped[] = $no . '번';
          } catch (Throwable $e) {
            $warn[] = $p['title'] . ' — 저장 실패: ' . $e->getMessage();
          }
        }
      }
      $done = ['made' => $made, 'updated' => $updated, 'skipped' => $skipped];
      $warn = array_slice(array_unique($warn), 0, 12);
    }
  }
}

page_head(['title' => '문제 가져오기', 'root' => '../', 'user' => $u, 'nav' => 'problems']);
?>
<div class="wrap narrow">

  <div class="phead">
    <h1>문제 가져오기</h1>
    <div class="grow"></div>
    <a class="btn" href="problems.php">목록</a>
  </div>

  <?php if ($err): ?><div class="note err"><?= h($err) ?></div><?php endif; ?>

  <?php if ($done): ?>
    <div class="note ok">
      새로 <?= $done['made'] ?>개<?= $done['updated'] ? ' · 덮어쓴 것 ' . $done['updated'] . '개' : '' ?>
      <?= $done['skipped'] ? ' · 건너뛴 것 ' . count($done['skipped']) . '개' : '' ?>
    </div>
    <?php if ($done['skipped']): ?>
      <div class="note info">번호가 이미 있어 건너뛰었습니다: <?= h(implode(', ', array_slice($done['skipped'], 0, 30))) ?></div>
    <?php endif; ?>
    <?php if ($done['made'] || $done['updated']): ?>
      <p><a class="btn primary" href="problems.php">문제 목록에서 확인</a></p>
    <?php endif; ?>
  <?php endif; ?>

  <?php foreach ($warn as $w): ?><div class="note info"><?= h($w) ?></div><?php endforeach; ?>

  <form method="post" enctype="multipart/form-data">
    <input type="hidden" name="do" value="import">

    <div class="field">
      <label for="file">파일</label>
      <input type="file" id="file" name="file" accept=".xml,.zip" required>
      <p class="small muted" style="margin:6px 0 0">
        FPS 형식의 XML 파일을 올립니다. HustOJ 에서 쓰던 문제 세트도 그대로 들어옵니다.
        XML 여러 개를 압축한 ZIP 도 됩니다.
      </p>
    </div>

    <div class="field">
      <label>문제 번호를 어떻게 할까요</label>
      <div class="chips">
        <label class="chip"><input type="radio" name="mode" value="new" <?= $mode === 'new' ? 'checked' : '' ?>>
          <span>새 번호로 추가</span></label>
        <label class="chip"><input type="radio" name="mode" value="skip" <?= $mode === 'skip' ? 'checked' : '' ?>>
          <span>원래 번호 유지 · 겹치면 건너뛰기</span></label>
        <label class="chip"><input type="radio" name="mode" value="overwrite" <?= $mode === 'overwrite' ? 'checked' : '' ?>>
          <span>원래 번호 유지 · 겹치면 덮어쓰기</span></label>
      </div>
      <p class="small muted" style="margin:8px 0 0">
        덮어쓰기를 고르면 같은 번호의 문제 내용과 테스트케이스가 모두 바뀝니다. 제출 기록은 그대로 남습니다.
      </p>
    </div>

    <div class="actions">
      <button class="btn primary" type="submit">가져오기</button>
      <a class="btn" href="problems.php">취소</a>
    </div>
  </form>

</div>
<?php page_foot(); ?>
