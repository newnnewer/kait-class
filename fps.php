<?php
/* ═══════════════════════════════════════════════
   fps.php — 문제를 FPS(Free Problem Set) XML 로 주고받는다.

   왜 FPS 인가:
     HustOJ 를 비롯한 여러 문제 풀이 시스템이 읽을 수 있는 형식이다.
     예전에 만들어 둔 문제 세트를 그대로 가져올 수 있고,
     내보낸 파일이 우리 시스템 밖에서도 쓸모가 있다.

   FPS 가 담지 못하는 것(문제 번호·태그·마크다운 원본)은
   <kaitclass> 라는 우리만의 칸에 넣는다. 다른 프로그램은 모르는 칸이므로 그냥 무시한다.
   예전에 <sjcode> 로 내보낸 파일도 계속 읽을 수 있게 해 두었다.
   이미지는 FPS 표준의 <img><base64> 에 담아 파일 하나로 끝낸다.
   ═══════════════════════════════════════════════ */

require_once __DIR__ . '/layout.php';   /* md() */

const FPS_VERSION = '1.2';

/* CDATA 안에 ]]> 가 들어가면 조각이 깨진다. 쪼개서 붙인다. */
function fps_cdata(?string $s): string {
  return '<![CDATA[' . str_replace(']]>', ']]]]><![CDATA[>', (string)$s) . ']]>';
}

/* 본문에서 우리 서버에 올린 이미지 경로를 찾아낸다 */
function fps_find_images(string ...$texts): array {
  $found = [];
  foreach ($texts as $t) {
    if (preg_match_all('#/uploads/problems/[0-9]{6}/[A-Za-z0-9_.\-]+#', (string)$t, $m)) {
      foreach ($m[0] as $src) $found[$src] = true;
    }
  }
  return array_keys($found);
}

/* ═══ 내보내기 ═══════════════════════════════════ */
function fps_export(array $problemIds): string {
  $out  = '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
  $out .= '<fps version="' . FPS_VERSION . '" url="https://github.com/zhblue/freeproblemset/">' . "\n";
  $out .= '  <generator name="' . h(APP_NAME) . '" url="' . h(APP_REPO) . '"/>' . "\n";

  foreach ($problemIds as $pid) {
    $pid = (int)$pid;
    $p = one("SELECT * FROM problems WHERE id = ?", [$pid]);
    if (!$p) continue;

    $tags = tags_of($pid);
    $tcs  = all("SELECT input, expected, is_sample FROM testcases
                 WHERE problem_id = ? ORDER BY seq, id", [$pid]);

    $out .= "  <item>\n";
    $out .= '    <title>' . fps_cdata($p['title']) . "</title>\n";
    $out .= '    <time_limit unit="s">' . fps_cdata((string)(float)$p['time_limit']) . "</time_limit>\n";
    $out .= '    <memory_limit unit="mb">' . fps_cdata((string)(int)round($p['memory_limit'] / 1000)) . "</memory_limit>\n";

    /* 설명은 다른 프로그램도 읽을 수 있게 HTML 로 넣고,
       마크다운 원본은 아래 <kaitclass> 에 따로 담아 우리끼리는 손실 없이 오간다. */
    $out .= '    <description>' . fps_cdata(md($p['description'])) . "</description>\n";
    $out .= '    <input>'  . fps_cdata(md($p['input_desc']))  . "</input>\n";
    $out .= '    <output>' . fps_cdata(md($p['output_desc'])) . "</output>\n";

    foreach ($tcs as $t) {
      if ((int)$t['is_sample']) {
        $out .= '    <sample_input>'  . fps_cdata($t['input'])    . "</sample_input>\n";
        $out .= '    <sample_output>' . fps_cdata($t['expected']) . "</sample_output>\n";
      }
    }
    foreach ($tcs as $t) {
      $out .= '    <test_input>'  . fps_cdata($t['input'])    . "</test_input>\n";
      $out .= '    <test_output>' . fps_cdata($t['expected']) . "</test_output>\n";
    }

    $out .= '    <hint>'   . fps_cdata('') . "</hint>\n";
    $out .= '    <source>' . fps_cdata(implode(', ', $tags)) . "</source>\n";

    /* 이미지 — 파일 하나로 끝나도록 본문에 함께 싣는다 */
    foreach (fps_find_images($p['description'], $p['input_desc'], $p['output_desc']) as $src) {
      $abs = __DIR__ . $src;   /* 이 파일이 문서 루트에 있다 */
      if (!is_file($abs) || filesize($abs) > 4 * 1024 * 1024) continue;
      $out .= "    <img>\n";
      $out .= '      <src>' . fps_cdata($src) . "</src>\n";
      $out .= '      <base64>' . base64_encode((string)file_get_contents($abs)) . "</base64>\n";
      $out .= "    </img>\n";
    }

    /* 우리만 쓰는 칸 — 다른 프로그램은 무시한다 */
    $out .= '    <kaitclass prob_no="' . (int)$p['prob_no'] . '">' . "\n";
    $out .= '      <tags>' . fps_cdata(implode(', ', $tags)) . "</tags>\n";
    $out .= '      <description_md>' . fps_cdata($p['description']) . "</description_md>\n";
    $out .= '      <input_md>'       . fps_cdata($p['input_desc'])  . "</input_md>\n";
    $out .= '      <output_md>'      . fps_cdata($p['output_desc']) . "</output_md>\n";
    $out .= '      <memory_limit_kb>' . (int)$p['memory_limit'] . "</memory_limit_kb>\n";
    foreach ($tcs as $t) {
      $out .= '      <case sample="' . ((int)$t['is_sample'] ? '1' : '0') . '"/>' . "\n";
    }
    $out .= "    </kaitclass>\n";
    $out .= "  </item>\n";
  }

  $out .= "</fps>\n";
  return $out;
}

/* ═══ 가져오기 ═══════════════════════════════════
   @return array{0: array<int,array>, 1: string[]}  문제 목록과 경고 */
function fps_parse(string $xml): array {
  $warn = [];
  $prev = libxml_use_internal_errors(true);
  $doc  = simplexml_load_string($xml, 'SimpleXMLElement', LIBXML_NOCDATA | LIBXML_PARSEHUGE);
  libxml_use_internal_errors($prev);
  if ($doc === false) return [[], ['XML 을 읽지 못했습니다. 형식을 확인하세요.']];

  $items = $doc->item ?? [];
  $problems = [];

  foreach ($items as $it) {
    /* 옛 파일은 <sjcode> 로 되어 있다. 둘 다 받는다. */
    $sj = $it->kaitclass ?? $it->sjcode ?? null;

    /* 설명 — 우리가 내보낸 것이면 마크다운 원본이 있다 */
    $desc = $sj && isset($sj->description_md) ? (string)$sj->description_md : (string)($it->description ?? '');
    $inD  = $sj && isset($sj->input_md)       ? (string)$sj->input_md       : (string)($it->input ?? '');
    $outD = $sj && isset($sj->output_md)      ? (string)$sj->output_md      : (string)($it->output ?? '');

    /* 이미지 — 새 경로에 저장하고 본문의 옛 경로를 바꿔 준다 */
    $imgs = [];
    foreach (($it->img ?? []) as $img) {
      $src = trim((string)($img->src ?? ''));
      $b64 = preg_replace('/\s+/', '', (string)($img->base64 ?? ''));
      if ($src === '' || $b64 === '') continue;
      $bin = base64_decode($b64, true);
      if ($bin === false || strlen($bin) > 4 * 1024 * 1024) { $warn[] = '이미지 하나를 건너뛰었습니다.'; continue; }
      $imgs[] = ['src' => $src, 'bin' => $bin];
    }

    /* 테스트케이스 — 샘플 먼저, 그다음 나머지 */
    $tcs = [];
    $si = $it->sample_input ?? [];  $so = $it->sample_output ?? [];
    for ($i = 0; $i < count($si); $i++) {
      $tcs[] = ['input' => (string)$si[$i], 'expected' => (string)($so[$i] ?? ''), 'is_sample' => 1];
    }
    $ti = $it->test_input ?? [];    $to = $it->test_output ?? [];
    for ($i = 0; $i < count($ti); $i++) {
      $in = (string)$ti[$i]; $ex = (string)($to[$i] ?? '');
      /* 샘플과 똑같은 것이 test 로 또 들어 있는 경우가 흔하다 — 한 번만 넣는다 */
      $dupe = false;
      foreach ($tcs as $t) {
        if ($t['input'] === $in && $t['expected'] === $ex) { $dupe = true; break; }
      }
      if (!$dupe) $tcs[] = ['input' => $in, 'expected' => $ex, 'is_sample' => 0];
    }

    /* 제한 */
    $tl = (float)((string)($it->time_limit ?? '2'));
    if ((string)($it->time_limit['unit'] ?? 's') === 'ms') $tl /= 1000;
    $tl = max(0.2, min(15.0, $tl ?: 2.0));

    if ($sj && isset($sj->memory_limit_kb)) {
      $ml = (int)$sj->memory_limit_kb;
    } else {
      $ml = (int)((string)($it->memory_limit ?? '128'));
      if ((string)($it->memory_limit['unit'] ?? 'mb') !== 'kb') $ml *= 1000;
    }
    $ml = max(16000, min(512000, $ml ?: 128000));

    $tags = $sj && isset($sj->tags) ? (string)$sj->tags : (string)($it->source ?? '');

    /* 다른 시스템에서 온 파일에도 \r 이 섞여 있을 수 있다 */
    foreach ($tcs as &$t) {
      $t['input'] = nl_clean($t['input']);
      $t['expected'] = nl_clean($t['expected']);
    }
    unset($t);

    $problems[] = [
      'prob_no'      => $sj ? (int)($sj['prob_no'] ?? 0) : 0,
      'title'        => trim((string)($it->title ?? '')) ?: '(제목 없음)',
      'description'  => nl_clean($desc),
      'input_desc'   => nl_clean($inD),
      'output_desc'  => nl_clean($outD),
      'time_limit'   => $tl,
      'memory_limit' => $ml,
      'tags'         => $tags,
      'testcases'    => $tcs,
      'images'       => $imgs,
    ];
  }

  if (!$problems) $warn[] = '가져올 문제를 찾지 못했습니다.';
  return [$problems, $warn];
}

/* 이미지를 저장하고, 본문 안의 옛 경로를 새 경로로 바꾼다 */
function fps_store_images(array &$p): array {
  $warn = [];
  if (!$p['images']) return $warn;

  $sub = 'uploads/problems/' . date('Ym');
  $dir = UPLOAD_DIR . '/problems/' . date('Ym');
  if (!is_dir($dir) && !@mkdir($dir, 0775, true)) {
    return ['이미지 폴더를 만들지 못해 이미지를 건너뛰었습니다.'];
  }

  foreach ($p['images'] as $img) {
    $ext = match (@getimagesizefromstring($img['bin'])['mime'] ?? '') {
      'image/png'  => 'png',  'image/jpeg' => 'jpg',
      'image/gif'  => 'gif',  'image/webp' => 'webp',
      default      => null,
    };
    if ($ext === null) { $warn[] = '알 수 없는 형식의 이미지를 건너뛰었습니다.'; continue; }

    $name = date('d') . '_' . bin2hex(random_bytes(6)) . '.' . $ext;
    if (@file_put_contents($dir . '/' . $name, $img['bin']) === false) {
      $warn[] = '이미지를 저장하지 못했습니다.'; continue;
    }
    @chmod($dir . '/' . $name, 0644);

    $new = '/' . $sub . '/' . $name;
    foreach (['description', 'input_desc', 'output_desc'] as $f) {
      $p[$f] = str_replace($img['src'], $new, $p[$f]);
    }
  }
  return $warn;
}

/* 문제 하나를 저장한다.
   $mode: 'new' 새 번호로 추가 · 'keep' 번호 유지(겹치면 건너뜀) · 'overwrite' 번호 유지(겹치면 덮어씀)
   @return array{0:string, 1:int}  결과('made'|'updated'|'skipped')와 문제 번호 */
function fps_save_problem(array $p, string $mode): array {
  $wanted = (int)$p['prob_no'];
  $exists = $wanted > 0 ? one("SELECT id FROM problems WHERE prob_no = ?", [$wanted]) : null;

  if ($mode === 'new' || $wanted <= 0) {
    $no = next_prob_no(db());
    $target = null;
  } elseif ($exists && $mode === 'skip') {
    return ['skipped', $wanted];
  } elseif ($exists && $mode === 'overwrite') {
    $no = $wanted; $target = (int)$exists['id'];
  } elseif ($exists) {
    return ['skipped', $wanted];
  } else {
    $no = $wanted; $target = null;
  }

  $pid = tx(function (PDO $d) use ($p, $no, $target) {
    if ($target) {
      $d->prepare("UPDATE problems SET prob_no=?, title=?, description=?, input_desc=?,
                   output_desc=?, time_limit=?, memory_limit=? WHERE id=?")
        ->execute([$no, $p['title'], $p['description'], $p['input_desc'],
                   $p['output_desc'], $p['time_limit'], $p['memory_limit'], $target]);
      $id = $target;
    } else {
      /* 가져온 문제는 잠긴 채로 둔다. 확인한 뒤 목록에서 연다. */
      $d->prepare("INSERT INTO problems(prob_no,title,description,input_desc,output_desc,
                   time_limit,memory_limit,active,created_at)
                   VALUES(?,?,?,?,?,?,?,0,?)")
        ->execute([$no, $p['title'], $p['description'], $p['input_desc'],
                   $p['output_desc'], $p['time_limit'], $p['memory_limit'], now()]);
      $id = (int)$d->lastInsertId();
    }
    $d->prepare("DELETE FROM testcases WHERE problem_id=?")->execute([$id]);
    $ins = $d->prepare("INSERT INTO testcases(problem_id,seq,input,expected,is_sample) VALUES(?,?,?,?,?)");
    $seq = 1;
    foreach ($p['testcases'] as $t) $ins->execute([$id, $seq++, $t['input'], $t['expected'], $t['is_sample']]);
    return $id;
  });

  if (trim((string)$p['tags']) !== '') sync_tags((int)$pid, (string)$p['tags']);
  return [$target ? 'updated' : 'made', $no];
}
