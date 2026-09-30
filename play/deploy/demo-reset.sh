#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  KAIT-PLAY 체험 서버 — 스냅샷(되돌아갈 기준) 뜨기 · 되돌리기
#
#  KAIT-CLASS 체험 서버의 매일 되돌리기에 KAIT-PLAY 자료(교사 비밀번호 · 문제 은행 ·
#  지난 기록 · 설정 = /opt/kait-play/data/game.db)도 함께 되돌린다.
#
#  한 번만 (지금 상태를 기준으로 삼기 · 매일 되돌리기에 붙이기):
#      sudo bash play/deploy/demo-reset.sh setup
#  기준을 새로 뜨고 싶을 때 (문제 은행을 고친 뒤 등):
#      sudo bash /usr/local/sbin/kait-play-demo-reset.sh snapshot
#  지금 바로 되돌려 보기:
#      sudo bash /usr/local/sbin/kait-play-demo-reset.sh restore
#
#  setup 이 하는 일
#    1) 이 파일을 /usr/local/sbin/kait-play-demo-reset.sh 로 복사
#    2) 지금의 game.db 를 /root/kait-play-snapshot/ 에 뜬다 (게임 서버를 몇 초 멈춤)
#    3) 기존 kait-class-restore.service(매일 새벽 4시)가 끝난 뒤 KAIT-PLAY 도 되돌리도록
#       systemd 덧붙임 파일을 둔다 — 기존 스크립트 · 타이머는 고치지 않는다
#
#  되돌리면 게임 서버가 다시 켜지므로 그때 진행 중인 게임 · 열린 수업 게임은 사라진다 (새벽 4시).
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

APP=/opt/kait-play
SNAP=/root/kait-play-snapshot
SELF=/usr/local/sbin/kait-play-demo-reset.sh
CLASS_UNIT=kait-class-restore.service
DROPIN_DIR=/etc/systemd/system/$CLASS_UNIT.d
CONTAINER=kait-play

[[ $EUID -eq 0 ]] || { echo "관리자 권한이 필요합니다: sudo bash $0 ${1:-}"; exit 1; }
[[ -f "$APP/docker-compose.yml" ]] || { echo "KAIT-PLAY 가 설치되어 있지 않습니다 ($APP)"; exit 1; }

# 게임 서버를 멈춘 동안 실패해도 반드시 다시 켠다
restart_on_exit() { trap 'docker start '"$CONTAINER"' > /dev/null 2>&1 || (cd '"$APP"' && docker compose up -d)' EXIT; }

snapshot() {
  [[ -f "$APP/data/game.db" ]] || { echo "자료 파일이 없습니다: $APP/data/game.db"; exit 1; }
  restart_on_exit
  docker stop "$CONTAINER" > /dev/null
  mkdir -p "$SNAP"; chmod 700 "$SNAP"
  cp -a "$APP/data/game.db" "$SNAP/game.db"
  echo "KAIT-PLAY 스냅샷 완료 $(date '+%F %T') → $SNAP/game.db"
}

restore() {
  [[ -f "$SNAP/game.db" ]] || { echo "떠 둔 자료가 없습니다: $SNAP/game.db (먼저 snapshot)"; exit 1; }
  restart_on_exit
  docker stop "$CONTAINER" > /dev/null
  rm -f "$APP/data/game.db" "$APP/data/game.db-wal" "$APP/data/game.db-shm" "$APP/data/game.db-journal"
  cp -a "$SNAP/game.db" "$APP/data/game.db"
  chown 1000:1000 "$APP/data/game.db"      # 컨테이너 안의 node 사용자
  echo "KAIT-PLAY 되돌림 완료 $(date '+%F %T')"
}

setup() {
  install -m 700 "$0" "$SELF"
  snapshot
  if systemctl cat "$CLASS_UNIT" > /dev/null 2>&1; then
    mkdir -p "$DROPIN_DIR"
    cat > "$DROPIN_DIR/kait-play.conf" <<EOF
# KAIT-PLAY 체험 서버: KAIT-CLASS 를 되돌린 뒤 KAIT-PLAY 자료도 되돌린다 (demo-reset.sh setup 이 만듦)
[Service]
ExecStartPost=$SELF restore
EOF
    systemctl daemon-reload
    echo "매일 되돌리기에 붙였습니다: $DROPIN_DIR/kait-play.conf"
    systemctl list-timers kait-class-restore.timer --no-pager 2>/dev/null | head -3 || true
  else
    echo "주의: $CLASS_UNIT 가 없어 매일 되돌리기에 붙이지 못했습니다."
    echo "      스냅샷만 떴습니다. 되돌리기는 'sudo $SELF restore' 로 직접 하세요."
  fi
}

case "${1:-}" in
  setup)    setup ;;
  snapshot) snapshot ;;
  restore)  restore ;;
  *) echo "사용법: sudo bash $0 setup | snapshot | restore"; exit 1 ;;
esac
