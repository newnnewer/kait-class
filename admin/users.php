<?php
/* admin/users.php — 회원 관리 (새 디자인)
   저장·삭제 동작은 기존 api.php 를 그대로 쓴다. 화면만 새로 짠 것이다. */
declare(strict_types=1);
require_once __DIR__ . '/../guard.php';
require_once __DIR__ . '/../layout.php';
$me = need_admin('../');

$groups = groups_all();

/* 필터는 주소에 남는다 — 새로고침해도 북마크해도 그대로다 */
$q       = trim((string)($_GET['q'] ?? ''));
$gsel    = (string)($_GET['group'] ?? '');     /* '' 전체 | '0' 미배정 | 반 id */
$roleSel = (string)($_GET['role'] ?? '');      /* '' | admin | student */

/* 승인 대기 — 직접 가입해서 아직 승인받지 못한 계정.
   아래 본 목록에는 넣지 않는다. 섞이면 승인해야 할 것이 묻힌다. */
$pending = all("SELECT id, login_id, name, created_at
                FROM users WHERE approved = 0 ORDER BY id DESC");

$sql = "SELECT u.id, u.login_id, u.name, u.role, u.created_at, u.group_id, u.source,
               g.name AS group_name
        FROM users u LEFT JOIN groups g ON g.id = u.group_id
        WHERE u.approved = 1";
$args = [];
if ($q !== '') { $sql .= " AND (u.login_id LIKE ? OR u.name LIKE ?)"; $args[] = "%$q%"; $args[] = "%$q%"; }
if ($gsel === '0')    $sql .= " AND u.group_id IS NULL";
elseif ($gsel !== '') { $sql .= " AND u.group_id = ?"; $args[] = (int)$gsel; }
if ($roleSel !== '')  { $sql .= " AND u.role = ?"; $args[] = $roleSel; }
$sql .= " ORDER BY u.role DESC, g.sort, g.name, u.login_id";

$users    = all($sql, $args);
$total    = (int)col("SELECT COUNT(*) FROM users");
$filtered = ($q !== '' || $gsel !== '' || $roleSel !== '');

page_head(['title' => '회원', 'root' => '../', 'user' => $me, 'nav' => 'ops']);
?>
<div class="wrap">

  <div class="phead">
    <h1>운영</h1>
    <div class="grow"></div>
  </div>

  <?= ops_tabs('users') ?>

  <?php if ($pending): ?>
    <div class="card" style="margin-bottom:18px">
      <h3 style="margin:0 0 4px">승인 대기 <?= count($pending) ?>명</h3>
      <p class="small muted" style="margin:0 0 12px">
        직접 가입한 계정입니다. 승인하기 전에는 로그인되지 않습니다.
        반은 없으므로 수업·평가에는 들어가지 못하고 문제만 풀 수 있습니다.
      </p>
      <table class="list">
        <thead>
          <tr>
            <th style="width:160px">아이디</th>
            <th style="width:160px">닉네임</th>
            <th class="center" style="width:110px">신청일</th>
            <th class="center">관리</th>
          </tr>
        </thead>
        <tbody>
        <?php foreach ($pending as $w): $wj = h(json_encode($w['login_id'])); ?>
          <tr>
            <td class="mono"><?= h($w['login_id']) ?></td>
            <td><?= h($w['name']) ?></td>
            <td class="center num small"><?= h(substr((string)$w['created_at'], 2, 8)) ?></td>
            <td class="rowbtns center">
              <button class="btn sm primary" type="button"
                      onclick="approveUser(<?= (int)$w['id'] ?>, <?= $wj ?>)">승인</button>
              <button class="btn sm danger" type="button"
                      onclick="rejectUser(<?= (int)$w['id'] ?>, <?= $wj ?>)">거절</button>
            </td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
    </div>
  <?php endif; ?>

  <div class="phead">
    <h2 class="subhead2">회원</h2>
    <span class="sub">
      전체 <?= $total ?>명<?= $filtered ? ' · 조건에 맞는 ' . count($users) . '명' : '' ?>
    </span>
  </div>

  <!-- ── 찾기 ───────────────────────────────── -->
  <form class="searchbar" method="get">
    <input type="search" name="q" value="<?= h($q) ?>" placeholder="아이디 또는 이름">
    <select name="group">
      <option value="">반 — 전체</option>
      <option value="0" <?= $gsel === '0' ? 'selected' : '' ?>>미배정</option>
      <?php foreach ($groups as $g): ?>
        <option value="<?= (int)$g['id'] ?>" <?= $gsel === (string)$g['id'] ? 'selected' : '' ?>>
          <?= h($g['name']) ?> (<?= (int)$g['member_cnt'] ?>)
        </option>
      <?php endforeach; ?>
    </select>
    <select name="role">
      <option value="">권한 — 전체</option>
      <option value="student" <?= $roleSel === 'student' ? 'selected' : '' ?>>학생</option>
      <option value="admin"   <?= $roleSel === 'admin'   ? 'selected' : '' ?>>관리자</option>
    </select>
    <button class="btn" type="submit">찾기</button>
    <?php if ($filtered): ?><a class="btn" href="users.php">초기화</a><?php endif; ?>
  </form>

  <!-- ── 자주 쓰지 않는 것은 접어 둔다 ───────── -->
  <details class="panel">
    <summary>반 관리 <span class="muted"><?= count($groups) ?>개</span></summary>
    <div class="panel-b">
      <div class="inline">
        <input type="text" id="newGroup" placeholder="예) 1학년 3반" style="max-width:220px">
        <button class="btn" type="button" onclick="saveGroup(0)">반 추가</button>
      </div>
      <?php if (!$groups): ?>
        <p class="small muted" style="margin:12px 0 0">
          반을 만들면 학생을 배정하고, 수업·평가를 그 반에만 열 수 있습니다.
        </p>
      <?php else: ?>
        <div class="grouplist">
          <?php foreach ($groups as $g): ?>
            <div class="grouprow">
              <a class="gname" href="?group=<?= (int)$g['id'] ?>"><?= h($g['name']) ?></a>
              <span class="num small muted"><?= (int)$g['member_cnt'] ?>명</span>
              <div class="grow"></div>
              <button class="btn sm" type="button"
                      onclick="renameGroup(<?= (int)$g['id'] ?>, <?= h(json_encode($g['name'])) ?>)">이름</button>
              <button class="btn sm danger" type="button"
                      onclick="delGroup(<?= (int)$g['id'] ?>, <?= h(json_encode($g['name'])) ?>)">삭제</button>
            </div>
          <?php endforeach; ?>
        </div>
      <?php endif; ?>
    </div>
  </details>

  <details class="panel">
    <summary>학생 일괄 등록</summary>
    <div class="panel-b">
      <div class="field">
        <label for="bulkCsv">한 줄에 한 명씩 — 아이디, 비밀번호, 이름, 반</label>
        <textarea id="bulkCsv" class="code" rows="6"
placeholder="10101,pass1234,김코딩,1학년 1반
10102,pass1234,이알고,1학년 1반
10103,pass1234,박파이"></textarea>
        <p class="small muted" style="margin:6px 0 0">
          쉼표나 탭으로 구분합니다. 엑셀에서 여러 열을 복사해 붙여넣어도 됩니다.
          없는 반 이름은 새로 만들어지고, 이미 있는 아이디는 건너뜁니다.
        </p>
      </div>
      <div class="inline">
        <label class="small" style="font-weight:600">반 열이 비었을 때 넣을 반</label>
        <input type="text" id="bulkGroup" placeholder="비워두면 미배정" style="max-width:200px">
        <button class="btn primary" type="button" id="btnBulk">등록</button>
        <span class="small" id="bulkMsg"></span>
      </div>
    </div>
  </details>

  <!-- ── 목록 ───────────────────────────────── -->
  <?php if (!$users): ?>
    <div class="empty">조건에 맞는 회원이 없습니다.</div>
  <?php else: ?>
    <div class="bulkbar">
      <label class="chk"><input type="checkbox" id="chkAll"> 전체 선택</label>
      <span class="small muted" id="pickCount">선택 0명</span>
      <div class="grow"></div>
      <span class="small muted">선택한 학생을</span>
      <select id="moveGroup" style="width:auto">
        <option value="0">미배정</option>
        <?php foreach ($groups as $g): ?>
          <option value="<?= (int)$g['id'] ?>"><?= h($g['name']) ?></option>
        <?php endforeach; ?>
      </select>
      <button class="btn" type="button" onclick="moveSelected()">이 반으로 옮기기</button>
    </div>

    <table class="list users">
      <thead>
        <tr>
          <th style="width:34px"></th>
          <th style="width:130px">아이디</th>
          <th style="width:130px">이름</th>
          <th class="center" style="width:130px">반</th>
          <th class="center" style="width:80px">권한</th>
          <th class="center" style="width:100px">가입일</th>
          <th class="center" style="width:260px">관리</th>
        </tr>
      </thead>
      <tbody>
      <?php foreach ($users as $u):
              $j = h(json_encode($u['login_id']));
              /* 자기 자신과 최초 관리자는 권한 변경·삭제 대상이 아니다.
                 버튼을 지우면 줄마다 단추 수가 달라져 표가 어긋나 보이므로,
                 자리는 그대로 두고 비활성으로 보여 준다. 이유는 툴팁으로 알린다. */
              $locked  = ((int)$u['id'] === (int)$me['id']) || is_root_admin((int)$u['id']);
              $lockWhy = !$locked ? ''
                       : (((int)$u['id'] === (int)$me['id'])
                          ? '자기 자신의 권한은 바꾸거나 삭제할 수 없습니다'
                          : '최초 관리자 계정은 권한을 바꾸거나 삭제할 수 없습니다');
              $off = $locked ? ' disabled title="' . h($lockWhy) . '"' : '';
      ?>
        <tr class="<?= $u['role'] === 'admin' ? 'isadmin' : '' ?>">
          <td>
            <?php if ($u['role'] === 'student'): ?>
              <input type="checkbox" class="pick" value="<?= (int)$u['id'] ?>">
            <?php endif; ?>
          </td>
          <td class="num"><a href="../user.php?id=<?= rawurlencode($u['login_id']) ?>"><?= h($u['login_id']) ?></a></td>
          <td><?= h($u['name']) ?></td>
          <td class="center small">
            <?php if ($u['role'] !== 'student'): ?><span class="muted">—</span>
            <?php elseif ($u['group_name'] !== null): ?>
              <a href="?group=<?= (int)$u['group_id'] ?>"><?= h($u['group_name']) ?></a>
            <?php elseif (($u['source'] ?? '') === 'signup'): ?>
              <span class="small muted" title="직접 가입한 회원입니다. 반이 없습니다.">가입 회원</span>
            <?php else: ?><span class="muted">미배정</span><?php endif; ?>
          </td>
          <td class="center">
            <?php if ($u['role'] === 'admin'): ?>
              <span class="v v-wait">관리자</span>
            <?php else: ?><span class="small muted">학생</span><?php endif; ?>
          </td>
          <td class="center num small"><?= h(substr((string)$u['created_at'], 2, 8)) ?></td>
          <td class="rowbtns">
            <?php if ($u['role'] === 'admin'): ?>
              <button class="btn sm" type="button"<?= $off ?>
                      onclick="setRole(<?= (int)$u['id'] ?>, <?= $j ?>, 'student')">학생으로</button>
            <?php else: ?>
              <button class="btn sm" type="button"<?= $off ?>
                      onclick="setRole(<?= (int)$u['id'] ?>, <?= $j ?>, 'admin')">관리자로</button>
            <?php endif; ?>
            <button class="btn sm" type="button"
                    onclick="resetPw(<?= (int)$u['id'] ?>, <?= $j ?>)">비밀번호</button>
            <button class="btn sm danger" type="button"<?= $off ?>
                    onclick="delUser(<?= (int)$u['id'] ?>, <?= $j ?>)">삭제</button>
          </td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
  <?php endif; ?>

</div>

<script src="<?= asset('judge.js', '../') ?>"></script>
<script>
/* ── 반 ── */
async function saveGroup(id){
  const name = id ? '' : $('newGroup').value;
  if (!id && !name.trim()) { $('newGroup').focus(); return; }
  try { await api('group_save', {id, name}); location.reload(); }
  catch(e){ alert(e.message); }
}
async function renameGroup(id, name){
  const v = prompt('반 이름을 바꿉니다', name);
  if (!v || v === name) return;
  try { await api('group_save', {id, name: v}); location.reload(); }
  catch(e){ alert(e.message); }
}
function delGroup(id, name){
  apiThenReload('group_delete', {id},
    `[${name}] 반을 삭제할까요?\n소속 학생은 미배정으로 바뀌고, 이 반만 대상으로 하던 수업·평가는 전체 공개가 됩니다.`);
}

/* ── 일괄 등록 ── */
$('btnBulk').onclick = async () => {
  const msg = $('bulkMsg');
  msg.textContent = '등록 중…'; msg.className = 'small muted';
  try {
    const j = await api('users_bulk', {csv: $('bulkCsv').value, group: $('bulkGroup').value});
    msg.textContent = `${j.made}명 등록` + (j.skipped.length ? ` · 건너뜀 ${j.skipped.length}건: ${j.skipped.join(', ')}` : '');
    msg.className = j.made ? 'small ok-text' : 'small bad-text';
    if (j.made) setTimeout(() => location.reload(), 900);
  } catch(e){ msg.textContent = e.message; msg.className = 'small bad-text'; }
};

/* ── 개별 ── */
function setRole(id, loginId, role){
  apiThenReload('user_set_role', {id, role}, role === 'admin'
    ? `[${loginId}] 계정을 관리자로 올릴까요?\n관리자는 회원·문제·수업·평가를 모두 관리할 수 있습니다.`
    : `[${loginId}] 계정의 관리자 권한을 내릴까요?`);
}
async function resetPw(id, loginId){
  const pw = prompt(`[${loginId}] 새 비밀번호 (4자 이상)`);
  if (!pw) return;
  try { await api('user_setpw', {id, pw}); alert('비밀번호를 바꿨습니다.'); }
  catch(e){ alert(e.message); }
}
/* ── 가입 승인 ── */
function approveUser(id, loginId){
  apiThenReload('user_approve', {id}, `[${loginId}] 계정을 승인할까요?\n승인하면 바로 로그인할 수 있습니다.`);
}
function rejectUser(id, loginId){
  apiThenReload('user_delete', {id},
    `[${loginId}] 가입을 거절할까요?\n계정이 삭제됩니다. 본인이 다시 가입할 수는 있습니다.`);
}

function delUser(id, loginId){
  apiThenReload('user_delete', {id},
    `[${loginId}] 계정을 삭제할까요?\n이 학생의 제출 기록도 함께 사라집니다.`);
}

/* ── 여러 명 ── */
(function(){
  const all = $('chkAll');
  if (!all) return;
  const picks = () => [...document.querySelectorAll('.pick:checked')];
  const refresh = () => { $('pickCount').textContent = `선택 ${picks().length}명`; };
  all.onchange = () => {
    document.querySelectorAll('.pick').forEach(c => c.checked = all.checked);
    refresh();
  };
  document.querySelectorAll('.pick').forEach(c => c.addEventListener('change', refresh));
  window.moveSelected = function(){
    const ids = picks().map(c => +c.value);
    if (!ids.length) { alert('옮길 학생을 먼저 선택하세요.'); return; }
    const sel = $('moveGroup');
    apiThenReload('users_set_group_bulk', {ids, group_id: +sel.value},
      `${ids.length}명을 [${sel.options[sel.selectedIndex].text}] 으로 옮길까요?`);
  };
})();
</script>
<?php page_foot(); ?>
