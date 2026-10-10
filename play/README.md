# KAIT-PLAY (팀 블록 점령 코딩 게임)

팀원이 한 판을 함께 쓰는 블록 점령 코딩 게임입니다. 키보드로만 움직이고, 블록을 점유해 코드를 타이핑합니다.

- **KAIT-CLASS 와 함께 설치**됩니다 (KAIT-CLASS `install.sh` 14단계). 주소는 언제나 KAIT-CLASS 주소 뒤의 `/play/`.
- KAIT-PLAY 만 설치 · 업데이트: KAIT-CLASS 소스 폴더에서 `sudo bash play/install.sh`
- 설치 · 운영 안내: [deploy/INSTALL.md](deploy/INSTALL.md)
- 현재 버전: **v0.13.0** — 학생끼리 팀 대전(**대전방**, 2~4팀 × 1~8명) · 준비(레디) · 15초 자동 시작 · 방장 옮기기 · 내보내기 · 단축키 Ctrl+Enter(준비 · 시작) · Alt+Q(나가기) · 학생 방 점유 · 보스 · 페널티 고정 · 로비 두 칸(대전방 | 협동방) · 캐릭터 8종 × 8색 · 닉네임 단어 40 × 40(앞부분 겹치지 않게) · 이름 '조' → '팀', 수업 게임 → 수업방 (임시)
- v0.12.0 — 입력란 흐린 글씨(따옴표 밖 빈칸 무시 · 틀린 글자 빨강) · 집결 보스를 Delete · Backspace 로 각자 잡기(8초) · 방해 아이템 대상 팀 고르기 · 팀 선택 잠그기 · 무작위로 섞기 · 전광판 순위 변동 그래프 · 점유 시간 10~30초(기본 20) · 방패 7.5% · 혼란 · 방향 반전 15초 · 소리 크게
- v0.11.0 — 아이템 확률 조정(페널티 15% · 방해 20% · 방패 15%) · 대기실과 게임 중 배경음(Ctrl+S 로 켜고 끄기) · 방장에게 입장 알림음 · 시작 단축키 Ctrl+Enter · 봇 표시 강화
- v0.9.0 — KAIT-CLASS 1.2 에 이식. 주소 `/game/` → `/play/`, 설치 위치 `/opt/kait-play`, 컨테이너 `kait-play`,
  브라우저 저장 `cg.` → `kp.`(예전 값은 한 번 옮김), 화면 아래 저작권 표기, 쓰지 않는 글꼴(Black Han Sans) 정리
- 이전: v0.8.0 — 이름을 KAIT-PLAY로 바꾸고(예전 이름: 코딩 대항전) 색상을 KAIT-CLASS에 맞춤 · v0.8.1: 부하 시험 도구 보강
- 교사 화면: `/play/teacher` (처음 비밀번호는 `/opt/kait-play/.env` 의 `ADMIN_PASSWORD`, KAIT-CLASS 관리자 비밀번호와 따로)

## 폴더 구성

```
play/
├─ install.sh            설치 · 업데이트 (KAIT-CLASS 가 설치된 서버에서)
├─ LICENSE               PolyForm Noncommercial 1.0.0
├─ server/
│  ├─ index.js            서버 시작, 접속 처리 (Socket.IO)
│  ├─ config.js           설정 (환경 변수)
│  ├─ players.js          접속한 사람 목록 (브라우저 열쇠 → 사람)
│  ├─ nick.js             무작위 닉네임, 캐릭터·색 목록
│  ├─ rng.js              씨앗이 같으면 같은 결과가 나오는 난수
│  ├─ game/board.js       판 만들기 (블록 수 24~144, 12의 배수)
│  ├─ game/match.js       경기 한 판 — 점유 · 보스 · 아이템 · 제한 시간 · 방치 경고 · 결과
│  ├─ rooms/lobby.js      로비 — 방 목록 · 방 만들기(1분 1개, 최대 60개)
│  ├─ rooms/room.js       학생 방 — 대기실 ↔ 경기, 방장 이양, 10분 미시작 종료
│  ├─ rooms/settings.js   방 설정 선택지와 검사 (학생 방 · 수업방)
│  ├─ classes/hub.js      수업방 모음 — 방 코드(숫자 4자리) · 코드 찍어 보기 막기 · 학생 방 허용 스위치
│  ├─ classes/classgame.js 수업방 — 팀 편성 · 같은 씨앗의 여러 판 · 고정 보스 일정 · 일시정지 · 순위 · 기록
│  ├─ classes/bot.js      봇 (팀 인원 맞추기용, 서버 안에서 일반 블록만 풂)
│  ├─ admin/auth.js       관리자 로그인 (처음 비밀번호 .env → 바꾸면 DB에 암호화 저장 · 5번 틀리면 1분 잠금)
│  ├─ db.js               저장소 (node:sqlite → data/game.db: 게임 기록 · 설정)
│  ├─ game/items.js       아이템 목록과 확률 (도움 · 페널티 15% · 방해 20% · 방패 15%)
│  ├─ game/grade.js       채점 (따옴표 밖 띄어쓰기 무시, 문자열 안은 정확히, ' " 같게)
│  ├─ problems/store.js   문제 은행 저장소 (DB · 처음 한 번 bank.txt 가져오기 · 고치기 · 붙여넣기 · 내려받기)
│  └─ problems/parser.js  문제 은행 형식 해석기
├─ public/                브라우저 화면
│  ├─ index.html · css/ · fonts/ (글꼴 모두 내장)
│  ├─ teacher.html · css/teacher.css · js/teacher.js   교사 화면
│  ├─ board.html · css/board.css · js/board.js         전광판 (프로젝터용, 1920×1080 무대)
│  ├─ js/sound.js · sounds.html                          소리 (Web Audio 합성) · 소리 미리듣기
│  └─ js/ app.js · avatar.js · shared/move.js (이동 규칙: 서버와 같이 씀)
├─ problems/bank.txt      문제 은행 (일반 483 · 보스 160)
├─ scripts/bots.js        가상 학생
├─ test/                  자동 시험 (npm test)
├─ deploy/                설치 · 운영 안내 · 백업 · 연습 서버에 올리기(bat)
├─ Dockerfile · docker-compose.yml · .env.example
```

## 원칙

- 판정(이동·점유·정답·아이템)은 모두 서버가 합니다. 브라우저는 보여 주기와 키 입력만 담당합니다.
- 주소 앞부분(`BASE_PATH`)은 설정값이지만, KAIT-CLASS 와 함께 설치하면 언제나 `/play` 입니다 (docker-compose.yml).
- 브라우저 저장소 이름은 모두 `kp.`로 시작합니다 (v0.8 까지 `cg.`). 같은 주소의 KAIT-CLASS와 섞이지 않게 하기 위해서입니다.
- 진행 중인 게임은 서버 메모리에만 있습니다. 서버를 재시작하면 사라집니다.

## 내 PC에서 돌려 보기 (Node.js 22 이상)

```bash
npm install
BASE_PATH=/play PORT=3100 ADMIN_PASSWORD=test npm start   # http://localhost:3100/play/ · 교사: /play/teacher
npm test
FORCE_ITEM=freeze npm start   # 시험용: 보스를 맞히면 늘 이 아이템
node scripts/bots.js 5 http://localhost:3100/play
node scripts/bots.js 12 http://localhost:3100/play --class 1234   # 수업방에 가상 학생
```

Windows PowerShell에서는 이렇게 실행합니다: `$env:BASE_PATH="/play"; $env:PORT="3100"; $env:ADMIN_PASSWORD="test"; npm start`

## 이용 조건

KAIT-CLASS 와 같은 **[PolyForm Noncommercial 1.0.0](LICENSE)** 입니다. © 2026 한국정보교사연합회(KAIT) · newnnewer.
학교의 수업 · 교육활동과 교사 · 개인의 비상업 운영에 쓸 수 있고, 상업적 이용은 할 수 없습니다.
화면 아래쪽(입장 · 로비 · 교사 화면)의 **저작권 표기를 지울 수 없습니다.** 자세한 내용은 저장소의 [이용 조건 안내](../LICENSE-안내.md).

| 부품 | 쓰임 | 라이선스 |
|---|---|---|
| [Socket.IO](https://socket.io/) | 실시간 연결 | MIT |
| [Pretendard](https://github.com/orioncactus/pretendard) | 본문 · 제목 글꼴 | SIL OFL 1.1 |
| [JetBrains Mono](https://www.jetbrains.com/lp/mono/) | 코드 글꼴 | SIL OFL 1.1 |
| [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) | 숫자 표시 글꼴 | SIL OFL 1.1 |
| [Archivo](https://fonts.google.com/specimen/Archivo) | 로고 글꼴 (로고 글자만 잘라 넣음) | SIL OFL 1.1 |
| [Node.js](https://nodejs.org/) | 게임 서버 (Docker 이미지 `node:22-alpine`) | MIT |
