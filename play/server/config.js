'use strict';
// 설정은 모두 환경 변수로 받는다 (docker-compose.yml 에서 정함)

function normBase(v) {
  v = String(v || '').trim();
  if (!v || v === '/') return '';
  if (!v.startsWith('/')) v = '/' + v;
  return v.replace(/\/+$/, '');
}

module.exports = {
  // 게임 서버가 듣는 포트 (컨테이너 안)
  port: parseInt(process.env.PORT || '3000', 10),
  // 주소 앞부분. KAIT-CLASS 와 함께 설치하면 언제나 /play (docker-compose.yml 에서 고정)
  //             혼자 돌려 볼 때 비워 두면 주소 맨 앞(/)에서 열림
  basePath: normBase(process.env.BASE_PATH),
  // 문제 은행 파일
  bankFile: process.env.BANK_FILE || require('path').join(__dirname, '..', 'problems', 'bank.txt'),
  // 연결이 끊긴 사람을 판에 남겨 두는 시간 (새로고침·잠깐 끊김 대비)
  graceMs: parseInt(process.env.GRACE_MS || '60000', 10),
  // 학생 방: 서버 전체 최대 방 수 / 같은 브라우저가 방을 다시 만들 수 있기까지
  maxRooms: parseInt(process.env.MAX_ROOMS || '60', 10),
  createGapMs: parseInt(process.env.CREATE_GAP_MS || '60000', 10),
  // 시작하지 않은 방이 닫히기까지 / 게임 중 아무도 입력하지 않으면 경고까지 · 경고 뒤 종료까지
  waitCloseMs: parseInt(process.env.WAIT_CLOSE_MS || '600000', 10),
  idleMs: parseInt(process.env.IDLE_MS || '60000', 10),
  idleWarnMs: parseInt(process.env.IDLE_WARN_MS || '15000', 10),
  // 동시에 접속할 수 있는 최대 인원 (서버 보호)
  maxPlayers: parseInt(process.env.MAX_PLAYERS || '300', 10),
  // 관리자(교사) 비밀번호 — .env 의 ADMIN_PASSWORD (없으면 교사 화면에 로그인할 수 없음)
  adminPassword: process.env.ADMIN_PASSWORD || '',
  // 저장소 파일 (게임 기록 · 설정)
  dbFile: process.env.DB_FILE || require('path').join(__dirname, '..', 'data', 'game.db'),
  // 게임 시작 카운트다운 (학생 방 · 수업 게임 모두, v0.7.6). 0 이면 바로 시작 (자동 시험용)
  countdownMs: parseInt(process.env.COUNTDOWN_MS || '5000', 10),
  // 체험(데모) 서버 (.env 의 DEMO=1): 교사 비밀번호 바꾸기를 막고 화면에 '체험 서버' 표시 (v0.10.0)
  demo: /^(1|true|yes|on)$/i.test(String(process.env.DEMO || '').trim()),
  // 수업 게임: 이만큼 아무 일이 없으면 자동으로 닫힘 (3시간)
  classIdleMs: parseInt(process.env.CLASS_IDLE_MS || String(3 * 3600 * 1000), 10),
};
