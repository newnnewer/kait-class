'use strict';
// 문제 은행 저장소 (6단계) — DB(data/game.db)의 problems 표
//   · 처음 켤 때 표가 비어 있으면 problems/bank.txt 를 한 번 가져온다. 그 뒤로는 DB만 쓴다
//     (코드를 다시 올려도 교사 화면에서 고친 문제가 지워지지 않게. bank.txt 를 고쳐 올려도 반영되지 않음)
//   · 교사 화면: 목록 · 한 문제 고치기/지우기 · 붙여넣기로 추가(미리보기 → 추가) · bank.txt 형식으로 내려받기
//   · 바뀐 문제는 다음에 시작하는 게임부터 (진행 중인 게임은 시작할 때 받은 문제 그대로)

const { parseBank, sameKey, TAGS } = require('./parser');

const HANGUL = /[ㄱ-ㆎ가-힣]/;
const MAX_CODE = 200;      // 일반 문제 한 줄 길이 (입력칸 최대 길이와 같음)
const MAX_BOSS_CODE = 1200;

function cleanTags(tags) {
  const list = Array.isArray(tags) ? tags : [];
  return TAGS.filter(t => list.includes(t)); // 늘 같은 순서
}

class ProblemStore {
  /** db: server/db.js 가 연 저장소, bankFile: 처음 가져올 문제 은행 파일 내용(문자열) */
  constructor(db, initialText) {
    this.db = db;
    const sql = db.sql;
    sql.exec(`
      CREATE TABLE IF NOT EXISTS problems (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,            -- normal / boss
        title TEXT,
        code TEXT NOT NULL,
        input TEXT,
        answers TEXT,                  -- JSON 배열 (보스)
        tags TEXT NOT NULL,            -- JSON 배열
        key TEXT NOT NULL,             -- 같은 문제 비교용 (띄어쓰기 없앤 코드, 보스는 + 제목)
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS problems_key ON problems(kind, key);
    `);
    this.q = {
      count: sql.prepare('SELECT COUNT(*) AS n FROM problems'),
      all: sql.prepare('SELECT * FROM problems ORDER BY id'),
      one: sql.prepare('SELECT * FROM problems WHERE id = ?'),
      byKey: sql.prepare('SELECT * FROM problems WHERE kind = ? AND key = ?'),
      insert: sql.prepare('INSERT INTO problems(kind, title, code, input, answers, tags, key, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)'),
      update: sql.prepare('UPDATE problems SET title = ?, code = ?, input = ?, answers = ?, tags = ?, key = ?, updated_at = ? WHERE id = ?'),
      setTags: sql.prepare('UPDATE problems SET tags = ?, updated_at = ? WHERE id = ?'),
      remove: sql.prepare('DELETE FROM problems WHERE id = ?'),
    };
    this.cache = null;
    this.onChange = () => {};
    this.imported = 0;
    if (this.q.count.get().n === 0 && initialText) {
      const r = this.addText(initialText, true);
      this.imported = r.added;
      if (r.errors.length) console.warn('[문제 은행] 처음 가져올 때 확인할 곳:', r.errors.slice(0, 10));
    }
  }

  static rowOut(r) {
    const o = { id: r.id, kind: r.kind, code: r.code, tags: JSON.parse(r.tags) };
    if (r.kind === 'boss') Object.assign(o, { title: r.title, input: r.input, answers: JSON.parse(r.answers || '[]') });
    return o;
  }

  /** 게임이 쓰는 문제 은행 { normal:[{id,code,tags}], boss:[{id,title,code,input,answers,tags}] } */
  bank() {
    if (!this.cache) {
      const normal = [], boss = [];
      for (const r of this.q.all.all()) (r.kind === 'boss' ? boss : normal).push(ProblemStore.rowOut(r));
      this.cache = { normal, boss };
    }
    return this.cache;
  }

  /** 방 만들기 화면이 태그별 문제 수를 세는 데 쓰는 정보 (코드·정답은 빼고 태그만) */
  bankTags() {
    const b = this.bank();
    return { normal: b.normal.map(x => x.tags), boss: b.boss.map(x => x.tags) };
  }

  changed() { this.cache = null; this.onChange(); }

  /** 한 문제 검사 → { ok, p } 또는 { ok:false, error } */
  static validate(kind, f) {
    const tags = cleanTags(f.tags);
    if (!tags.length) return { ok: false, error: '태그를 하나 이상 고르세요' };
    if (kind === 'normal') {
      const code = String(f.code || '').trim();
      if (!code) return { ok: false, error: '코드를 넣어 주세요' };
      if (/\n/.test(code)) return { ok: false, error: '일반 문제는 한 줄이어야 해요' };
      if (code.length > MAX_CODE) return { ok: false, error: `코드가 너무 길어요 (${MAX_CODE}자까지)` };
      if (HANGUL.test(code)) return { ok: false, error: '코드에 한글을 쓸 수 없어요 (게임이 한글 입력을 막아요)' };
      return { ok: true, p: { kind, title: null, code, input: null, answers: null, tags, key: sameKey(code) } };
    }
    const title = String(f.title || '').trim();
    const code = String(f.code || '').replace(/\r\n?/g, '\n').replace(/\s+$/, '').replace(/^\n+/, '');
    const answers = (Array.isArray(f.answers) ? f.answers : String(f.answers || '').split('|')).map(a => String(a).trim()).filter(Boolean);
    const input = f.input == null || String(f.input).trim() === '' ? null : String(f.input).trim();
    if (!title) return { ok: false, error: '보스 제목을 넣어 주세요' };
    if (!code.trim()) return { ok: false, error: '코드를 넣어 주세요' };
    if (code.length > MAX_BOSS_CODE) return { ok: false, error: '코드가 너무 길어요' };
    if ((code.match(/___/g) || []).length > 1) return { ok: false, error: '빈칸(___)은 한 문제에 하나만 넣을 수 있어요' };
    if (!answers.length) return { ok: false, error: '정답을 하나 이상 넣어 주세요 (여러 개는 | 로 나눠요)' };
    if (HANGUL.test(code) || answers.some(a => HANGUL.test(a))) return { ok: false, error: '코드·정답에 한글을 쓸 수 없어요 (게임이 한글 입력을 막아요)' };
    // 보스는 코드가 같아도 제목(묻는 것)이 다르면 다른 문제 (예: n ___ 10 → % / //)
    return { ok: true, p: { kind, title, code, input, answers, tags, key: sameKey(code) + '|' + sameKey(title) } };
  }

  /** 한 문제 고치기 */
  update(id, f) {
    const row = this.q.one.get(Number(id));
    if (!row) return { ok: false, error: '없는 문제예요 (이미 지웠을 수 있어요)' };
    const v = ProblemStore.validate(row.kind, f || {});
    if (!v.ok) return v;
    const p = v.p;
    const dup = this.q.byKey.get(p.kind, p.key);
    if (dup && dup.id !== row.id) return { ok: false, error: `같은 코드의 문제가 이미 있어요 (${dup.kind === 'boss' ? '보스 "' + dup.title + '"' : dup.code})` };
    this.q.update.run(p.title, p.code, p.input, p.answers ? JSON.stringify(p.answers) : null, JSON.stringify(p.tags), p.key, Date.now(), row.id);
    this.changed();
    return { ok: true, problem: ProblemStore.rowOut(this.q.one.get(row.id)) };
  }

  remove(id) {
    const r = this.q.remove.run(Number(id));
    if (!r.changes) return { ok: false, error: '없는 문제예요' };
    this.changed();
    return { ok: true };
  }

  /**
   * 붙여넣기로 추가 — apply=false 면 미리보기만.
   * 이미 있는 문제(띄어쓰기 무시 비교)는 새로 넣지 않고 태그만 더한다.
   */
  addText(text, apply) {
    const parsed = parseBank(String(text || ''));
    const out = { ok: true, added: 0, merged: 0, same: 0, errors: parsed.errors.slice(), newNormal: [], newBoss: [], mergedList: [] };
    const now = Date.now();
    const items = parsed.normal.map(x => ({ kind: 'normal', f: x })).concat(parsed.boss.map(x => ({ kind: 'boss', f: x })));
    // 붙여넣기에 '[보스 문제]' 가 빠진 흔한 실수 안내
    if (!items.length && !out.errors.length) out.errors.push('추가할 문제를 찾지 못했어요 (형식을 확인해 주세요)');
    const run = () => {
      for (const { kind, f } of items) {
        const v = ProblemStore.validate(kind, f);
        if (!v.ok) { out.errors.push(`${kind === 'boss' ? '보스 "' + (f.title || '') + '"' : f.code}: ${v.error}`); continue; }
        const p = v.p;
        const old = this.q.byKey.get(kind, p.key);
        if (old) {
          const tags = JSON.parse(old.tags);
          const more = p.tags.filter(t => !tags.includes(t));
          if (!more.length) { out.same += 1; continue; }
          out.merged += 1;
          out.mergedList.push({ code: old.kind === 'boss' ? old.title : old.code, add: more });
          if (apply) this.q.setTags.run(JSON.stringify(cleanTags(tags.concat(more))), now, old.id);
          continue;
        }
        out.added += 1;
        if (kind === 'boss') out.newBoss.push({ title: p.title, tags: p.tags, blank: p.code.includes('___') });
        else out.newNormal.push({ code: p.code, tags: p.tags });
        if (apply) this.q.insert.run(kind, p.title, p.code, p.input, p.answers ? JSON.stringify(p.answers) : null, JSON.stringify(p.tags), p.key, now);
      }
    };
    if (apply) {
      this.db.sql.exec('BEGIN');
      try { run(); this.db.sql.exec('COMMIT'); } catch (e) { this.db.sql.exec('ROLLBACK'); throw e; }
      if (out.added || out.merged) this.changed();
    } else run();
    // 미리보기 목록은 너무 길지 않게
    out.newNormal = out.newNormal.slice(0, 200);
    out.newBoss = out.newBoss.slice(0, 100);
    out.mergedList = out.mergedList.slice(0, 100);
    return out;
  }

  /** 문제 은행 전체를 bank.txt 형식으로 (백업 · 다른 서버로 옮기기) */
  exportText() {
    const b = this.bank();
    const lines = ['// KAIT-PLAY 문제 은행 (// 로 시작하는 줄은 설명이라 무시돼요)',
      `// 내려받은 때: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · 일반 ${b.normal.length}개 · 보스 ${b.boss.length}개`, '', '[일반 문제]'];
    // 같은 태그 묶음끼리 모아 "# 태그" 한 줄 아래에
    const groups = new Map();
    for (const p of b.normal) {
      const k = p.tags.join(', ');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p.code);
    }
    for (const [k, codes] of groups) { lines.push('', '# ' + k, ...codes); }
    lines.push('', '[보스 문제]', '// "=== 제목 # 태그" 로 시작. 코드 안의 ___ = 빈칸 (없으면 출력 결과 맞히기).');
    for (const p of b.boss) {
      lines.push('', `=== ${p.title} # ${p.tags.join(', ')}`, p.code);
      if (p.input != null) lines.push('입력: ' + p.input);
      lines.push('정답: ' + p.answers.join(' | '));
    }
    return lines.join('\n') + '\n';
  }
}

module.exports = { ProblemStore };
