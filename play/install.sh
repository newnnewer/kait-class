#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  KAIT-PLAY 설치 · 업데이트  (KAIT-CLASS 가 이미 설치된 서버에서)
#
#  보통은 따로 실행할 일이 없습니다. KAIT-CLASS 의 install.sh 가 이 파일을 불러
#  함께 설치합니다 (sudo bash install.sh --no-play 로 빼고 설치할 수 있음).
#
#  이 파일을 직접 쓰는 때
#    · KAIT-PLAY 만 새 버전으로 바꿀 때 (KAIT-CLASS 전체를 다시 설치하지 않고)
#    · KAIT-CLASS 1.1 이하가 설치된 서버에 KAIT-PLAY 를 더할 때
#
#      cd ~/kait-class-버전          # 소스를 푼 폴더
#      sudo bash play/install.sh
#
#  하는 일 (여러 번 실행해도 안전)
#    1) KAIT-CLASS · Docker 확인
#    2) 예전 이름(코딩 대항전, /opt/coding-game)으로 설치된 것이 있으면 자료를 옮기고 정리
#    3) 소스를 /opt/kait-play 에 복사 (data/ 와 .env 는 그대로 둠)
#    4) 게임 서버를 만들어 띄움 (Docker, 127.0.0.1:3100 에서만 열림)
#    5) nginx 에 연결: /etc/nginx/kait-class.d/kait-play.conf → 주소/play/
#    6) 접속 확인
# ═══════════════════════════════════════════════════════════════
set -Eeuo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR=/opt/kait-play
OLD_DIR=/opt/coding-game                       # v0.8 까지의 설치 위치
NGINX_SITE=/etc/nginx/sites-available/kait-class
SLOT_DIR=/etc/nginx/kait-class.d               # KAIT-CLASS 가 비워 둔 '추가 프로그램 자리'
SLOT_INCLUDE="include $SLOT_DIR/*.conf;"
NGINX_CONF_FILE="$SLOT_DIR/kait-play.conf"
KC_STATE=/var/lib/kait-class-install           # KAIT-CLASS 설치 상태 (도메인 등)
KC_DATA=/var/www/kait-class-data               # KAIT-CLASS 자료 폴더 (메뉴 표시용 표시 파일을 둠)
BACKUP_DIR=/root/kait-play-backup

if [[ -t 1 ]]; then
  B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; C=$'\e[36m'; N=$'\e[0m'
else
  B=; G=; Y=; R=; C=; N=
fi
say()  { printf '\n%s▶ %s%s\n' "$Y$B" "$*" "$N"; }
ok()   { printf '  %s✔%s %s\n' "$G" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
die()  { printf '  %s✘ %s%s\n' "$R$B" "$*" "$N"; exit 1; }

[[ $EUID -eq 0 ]] || die "관리자 권한이 필요합니다: sudo bash play/install.sh"
[[ -f "$SRC/docker-compose.yml" && -f "$SRC/server/index.js" ]] || die "KAIT-PLAY 소스가 아닙니다: $SRC"
[[ "$SRC" != "$APP_DIR" ]] || die "$APP_DIR 안에서 실행하지 마세요. 소스를 푼 폴더의 play/install.sh 를 실행하세요."

# 윈도에서 고친 파일의 줄 끝(CRLF) 정리
sed -i 's/\r$//' "$SRC"/*.sh "$SRC"/deploy/*.sh "$SRC"/.env.example 2>/dev/null || true

env_get() { [[ -f "$1" ]] || return 0; grep -E "^$2=" "$1" | tail -1 | cut -d= -f2- | tr -d '\r"' || true; }

# ── 1. 확인 ──────────────────────────────────────────────────────
say "1. KAIT-CLASS · Docker 확인"
[[ -f "$NGINX_SITE" ]] || die "KAIT-CLASS 가 설치되어 있지 않습니다 ($NGINX_SITE 없음). KAIT-CLASS 를 먼저 설치하세요."
command -v nginx  > /dev/null || die "nginx 가 없습니다. KAIT-CLASS 를 먼저 설치하세요."
command -v docker > /dev/null || die "Docker 가 없습니다. KAIT-CLASS 를 먼저 설치하세요."
docker compose version > /dev/null 2>&1 || die "docker compose 가 없습니다. KAIT-CLASS 를 먼저 설치하세요."
command -v rsync  > /dev/null || die "rsync 가 없습니다: sudo apt install -y rsync"
command -v curl   > /dev/null || die "curl 이 없습니다: sudo apt install -y curl"
ok "$(docker --version)"
ok "KAIT-PLAY v$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$SRC/package.json" | head -1)"

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)

# ── 2. 예전 설치(코딩 대항전) 옮기기 ─────────────────────────────
#   v0.8 까지는 /opt/coding-game 에 'coding-battle' 컨테이너로, 주소는 /game/ 이었다.
#   자료(data/: 게임 기록 · 바꾼 교사 비밀번호 · 문제 은행)와 .env 를 가져오고,
#   예전 컨테이너 · nginx 연결을 정리한다. 예전 폴더는 지우지 않고 이름만 바꿔 둔다.
if [[ -d "$OLD_DIR" ]]; then
  say "2. 예전 설치(코딩 대항전, $OLD_DIR) 옮기기"
  mkdir -p "$APP_DIR"
  if [[ -f "$OLD_DIR/data/game.db" && ! -f "$APP_DIR/data/game.db" ]]; then
    # 옮기는 동안 기록이 바뀌지 않게 먼저 멈춘다
    docker rm -f coding-battle > /dev/null 2>&1 || true
    cp -a "$OLD_DIR/data" "$APP_DIR/"
    ok "자료(data/) 옮김 — 게임 기록 · 교사 비밀번호 · 문제 은행"
  fi
  if [[ -f "$OLD_DIR/.env" && ! -f "$APP_DIR/.env" ]]; then
    # BASE_PATH 는 이제 쓰지 않는다 (주소는 언제나 /play/)
    grep -vE '^BASE_PATH=' "$OLD_DIR/.env" > "$APP_DIR/.env" || true
    ok "설정(.env) 옮김 — 처음 비밀번호 · 최대 인원 · 포트"
  fi
  docker rm -f coding-battle > /dev/null 2>&1 || true
  docker image rm coding-battle:latest > /dev/null 2>&1 || true
  # 예전 nginx 연결: 사이트 설정 안의 include 한 줄과 snippets 파일
  if grep -q 'snippets/coding-game.conf' "$NGINX_SITE"; then
    cp -a "$NGINX_SITE" "$BACKUP_DIR/kait-class.$STAMP"
    sed -i '/snippets\/coding-game\.conf/d' "$NGINX_SITE"
    ok "예전 nginx 연결(/game/) 뺌 — 원본 백업 $BACKUP_DIR/kait-class.$STAMP"
  fi
  rm -f /etc/nginx/snippets/coding-game.conf
  # 매일 백업 예약(crontab)이 예전 경로를 가리키면 새 경로로
  if crontab -l 2>/dev/null | grep -q "$OLD_DIR/deploy/backup.sh"; then
    crontab -l 2>/dev/null | sed "s#$OLD_DIR/deploy/backup.sh#$APP_DIR/deploy/backup.sh#g" | crontab -
    ok "자동 백업 예약을 새 경로로 바꿈"
  fi
  mv "$OLD_DIR" "$OLD_DIR.old-$STAMP"
  ok "예전 폴더는 $OLD_DIR.old-$STAMP 로 남겨 둠 (확인 뒤 지워도 됩니다)"
else
  say "2. 예전 설치 없음 — 건너뜀"
fi

# ── 3. 소스 복사 ─────────────────────────────────────────────────
say "3. 소스를 $APP_DIR 에 복사"
mkdir -p "$APP_DIR"
# --delete: 새 버전에서 사라진 파일을 지운다. data/ · .env 는 건드리지 않는다.
rsync -a --delete \
  --exclude='/data/' --exclude='/.env' --exclude='/node_modules/' --exclude='/*.tgz' \
  "$SRC/" "$APP_DIR/"
cd "$APP_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
  ok ".env 를 새로 만들었어요"
else
  sed -i 's/\r$//' .env
  ok ".env 는 그대로 씁니다"
fi
# 관리자(교사) 처음 비밀번호: 비어 있으면 무작위로 만든다
NEWPW=""
if [[ -z "$(env_get .env ADMIN_PASSWORD)" ]]; then
  NEWPW=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 12 || true)
  if grep -qE '^ADMIN_PASSWORD=' .env; then sed -i "s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=$NEWPW/" .env
  else printf '\nADMIN_PASSWORD=%s\n' "$NEWPW" >> .env; fi
  # KAIT-CLASS 설치가 부른 경우: 설치 끝 화면에서 한 번 보여 주도록 남겨 둔다 (보여 준 뒤 지움)
  if [[ "${KAIT_CLASS_INSTALL:-}" == "1" ]]; then
    mkdir -p "$KC_STATE"; echo "$NEWPW" > "$KC_STATE/play_newpw"; chmod 600 "$KC_STATE/play_newpw"
  fi
  printf '\n  %s★ 교사 화면 처음 비밀번호를 만들었어요:  %s%s\n' "$Y$B" "$NEWPW" "$N"
fi
chmod 600 .env
GAME_PORT=$(env_get .env GAME_PORT); GAME_PORT=${GAME_PORT:-3100}
[[ "$GAME_PORT" =~ ^[0-9]+$ ]] || die ".env 의 GAME_PORT 가 숫자가 아닙니다: $GAME_PORT"
mkdir -p data
chown 1000:1000 data            # 컨테이너 안의 node 사용자(1000)가 쓸 수 있게
ok "소스 복사 완료 (자료 폴더 $APP_DIR/data 유지)"

# ── 4. 게임 서버 ─────────────────────────────────────────────────
say "4. 게임 서버 만들기 · 띄우기 (처음에는 1~3분)"
if ss -tlnH "sport = :$GAME_PORT" | grep -q . && ! docker ps --format '{{.Names}}' | grep -qx kait-play; then
  die "$GAME_PORT 번 포트를 다른 프로그램이 쓰고 있습니다. $APP_DIR/.env 의 GAME_PORT 를 바꾼 뒤 다시 실행하세요."
fi
docker compose up -d --build --remove-orphans
docker image prune -f > /dev/null 2>&1 || true
for i in $(seq 1 40); do
  curl -fsS "http://127.0.0.1:$GAME_PORT/play/healthz" > /dev/null 2>&1 && break
  sleep 1
  [[ $i -eq 40 ]] && { docker compose logs --tail 40; die "게임 서버가 대답하지 않습니다 (위 기록 확인)"; }
done
ok "게임 서버 동작: $(curl -fsS "http://127.0.0.1:$GAME_PORT/play/healthz")"

# ── 5. nginx 연결 ────────────────────────────────────────────────
say "5. nginx 에 /play/ 연결"
mkdir -p "$SLOT_DIR"
cp -a "$NGINX_SITE" "$BACKUP_DIR/kait-class.$STAMP.before-play" 2>/dev/null || true
[[ -f "$NGINX_CONF_FILE" ]] && cp -a "$NGINX_CONF_FILE" "$BACKUP_DIR/kait-play.conf.$STAMP"

cat > "$NGINX_CONF_FILE" <<EOF
# KAIT-PLAY — play/install.sh 가 만든 파일 (다시 설치하면 덮어쓴다)
# 주소/play/ 로 들어온 요청을 게임 서버(127.0.0.1:$GAME_PORT)로 넘긴다.
# KAIT-CLASS 사이트 설정의 server 블록 안에서 include 된다 (http · https 모두).
location = /play { return 301 /play/; }
location ^~ /play/ {
    proxy_pass http://127.0.0.1:$GAME_PORT;
    proxy_http_version 1.1;
    # 실시간 연결(WebSocket)
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_buffering off;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
}
# 예전 주소(/game/)로 들어오면 새 주소로
location = /game { return 301 /play/; }
location ^~ /game/ { rewrite ^/game/(.*)\$ /play/\$1 permanent; }
EOF

# KAIT-CLASS 1.2 부터는 사이트 설정에 '추가 프로그램 자리'가 들어 있다.
# 1.1 이하라면 server 블록마다 server_name 줄 뒤에 그 한 줄을 넣는다
# (KAIT-CLASS 를 1.2 이상으로 업데이트하면 설치 스크립트가 알아서 넣어 준다).
SITE_CHANGED=0
if ! grep -qF "$SLOT_INCLUDE" "$NGINX_SITE"; then
  cp -a "$NGINX_SITE" "$BACKUP_DIR/kait-class.$STAMP"
  sed -i "/^\s*server_name\s/a\\    $SLOT_INCLUDE   # 추가 프로그램 자리 (KAIT-PLAY)" "$NGINX_SITE"
  grep -qF "$SLOT_INCLUDE" "$NGINX_SITE" || die "사이트 설정에서 server_name 줄을 찾지 못했습니다: $NGINX_SITE"
  SITE_CHANGED=1
  warn "KAIT-CLASS 1.1 이하의 사이트 설정에 연결 한 줄을 넣었습니다 (원본 $BACKUP_DIR/kait-class.$STAMP)"
fi

# 많은 인원(학생 한 명이 연결 2개): nginx 연결 수 한도를 4096 으로 (이미 크면 그대로)
NGX_MAIN=/etc/nginx/nginx.conf
NGX_CHANGED=0
cur=$(sed -n 's/^\s*worker_connections\s\+\([0-9]\+\);.*/\1/p' "$NGX_MAIN" | head -1)
if [[ -n "$cur" && "$cur" -lt 4096 ]] || ! grep -qE '^\s*worker_rlimit_nofile\s' "$NGX_MAIN"; then
  cp -a "$NGX_MAIN" "$BACKUP_DIR/nginx.conf.$STAMP"
  [[ -n "$cur" && "$cur" -lt 4096 ]] && sed -i "s/^\(\s*worker_connections\s\+\)[0-9]\+;/\14096;/" "$NGX_MAIN"
  grep -qE '^\s*worker_rlimit_nofile\s' "$NGX_MAIN" || sed -i '0,/^\s*worker_processes\s.*;/s//&\nworker_rlimit_nofile 8192;/' "$NGX_MAIN"
  NGX_CHANGED=1
fi

if nginx -t > /tmp/kait-play-nginx-test.txt 2>&1; then
  systemctl reload nginx
  ok "nginx 연결 완료: 주소/play/  →  127.0.0.1:$GAME_PORT"
  (( NGX_CHANGED )) && ok "nginx 연결 수 한도 4096 (원본 $BACKUP_DIR/nginx.conf.$STAMP)"
else
  cat /tmp/kait-play-nginx-test.txt
  warn "nginx 설정 검사 실패 → 원래대로 되돌립니다."
  (( SITE_CHANGED )) && cp -a "$BACKUP_DIR/kait-class.$STAMP" "$NGINX_SITE"
  (( NGX_CHANGED ))  && cp -a "$BACKUP_DIR/nginx.conf.$STAMP" "$NGX_MAIN"
  if [[ -f "$BACKUP_DIR/kait-play.conf.$STAMP" ]]; then cp -a "$BACKUP_DIR/kait-play.conf.$STAMP" "$NGINX_CONF_FILE"; else rm -f "$NGINX_CONF_FILE"; fi
  nginx -t > /dev/null 2>&1 && systemctl reload nginx || true
  die "nginx 에 연결하지 못했습니다 (위 오류 확인)"
fi

# KAIT-CLASS 상단 메뉴에 'KAIT-PLAY' 가 보이도록 표시 파일을 둔다 (KAIT-CLASS 1.2 이상에서 씀)
if [[ -d "$KC_DATA" ]]; then
  printf '{"path":"/play/","version":"%s"}\n' "$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)" > "$KC_DATA/play.json"
  chown www-data:www-data "$KC_DATA/play.json" 2>/dev/null || true
fi

# ── 6. 확인 ──────────────────────────────────────────────────────
say "6. nginx 를 거쳐 접속 확인"
# nginx 가 새 설정을 읽는 데 잠깐 걸리므로 몇 번 다시 본다
for i in $(seq 1 10); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1/play/healthz" || true)
  [[ "$code" == 200 || "$code" == 301 || "$code" == 302 ]] && break
  sleep 1
done
case "$code" in
  200)     ok "http://127.0.0.1/play/ 접속됨" ;;
  301|302) ok "https 로 넘기고 있어요 (KAIT-CLASS 의 https 설정) — 도메인 주소로 접속해 보세요" ;;
  *)       die "nginx 를 거친 접속이 안 됩니다 (응답 $code). 'nginx -t' 와 /var/log/nginx/error.log 를 확인하세요." ;;
esac

DOMAIN=$( [[ -s "$KC_STATE/domains" ]] && awk '{print $1}' "$KC_STATE/domains" || true )
if [[ -n "$DOMAIN" && -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
  URL="https://$DOMAIN/play/"
else
  IP=$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
  URL="http://$IP/play/"
fi

echo
printf '  %s학생 주소:  %s%s\n' "$C$B" "$URL" "$N"
printf '  %s교사 화면:  %steacher%s\n' "$C$B" "$URL" "$N"
if [[ -n "$NEWPW" ]]; then
  printf '  %s교사 처음 비밀번호:  %s   ← 지금 적어 두세요 (교사 화면에서 바꿀 수 있어요)%s\n' "$Y$B" "$NEWPW" "$N"
else
  echo "  교사 비밀번호: 교사 화면에서 바꾼 비밀번호 (바꾼 적이 없으면: sudo grep ADMIN_PASSWORD $APP_DIR/.env)"
fi
echo "  비밀번호를 잊었을 때: sudo docker exec kait-play node scripts/admin-password.js"
echo "  기록 보기: cd $APP_DIR && sudo docker compose logs -f"
