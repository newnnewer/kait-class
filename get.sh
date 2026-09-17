#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  KAIT-CLASS 한 줄 설치
#
#      wget -qO- https://raw.githubusercontent.com/newnnewer/kait-class/main/get.sh | sudo bash
#
#  도메인·https 까지 한 번에 (옵션은 install.sh 와 같다):
#      wget -qO- https://raw.githubusercontent.com/newnnewer/kait-class/main/get.sh \
#        | sudo bash -s -- --domain class.example.kr --email 나@example.com
#
#  하는 일
#    1. GitHub 의 최신 릴리스 소스를 내려받아 홈 폴더에 푼다 (~/kait-class-버전)
#    2. 그 폴더에서 install.sh 를 실행한다
#  재부팅 뒤에는 안내대로 그 폴더에서 sudo bash install.sh 를 치면 이어진다.
#
#  ★ 새로 깐 우분투에는 curl 도 unzip 도 없다. wget 과 python3 만 쓴다.
# ═══════════════════════════════════════════════════════════════
set -Eeuo pipefail

REPO="${KAIT_REPO:-newnnewer/kait-class}"

# 내려받는 도중에 끊겨도 반쪽짜리 스크립트가 실행되지 않도록 전체를 함수로 감싼다
main() {
  local OWNER HOME_DIR TAG VER DEST WORK INNER

  if [[ $EUID -ne 0 ]]; then
    echo "관리자 권한이 필요합니다. 명령 끝을 'sudo bash' 로 적었는지 확인하세요."
    exit 1
  fi
  for c in wget python3; do
    command -v "$c" > /dev/null || { echo "$c 이(가) 없습니다: sudo apt install -y $c"; exit 1; }
  done

  # 소스를 둘 곳: sudo 를 쓴 사용자의 홈 (root 로 바로 접속했으면 /root)
  # /tmp 는 재부팅하면 지워지므로 쓰지 않는다.
  OWNER="${SUDO_USER:-root}"
  HOME_DIR=$(getent passwd "$OWNER" | cut -d: -f6 || true)
  [[ -n "$HOME_DIR" && -d "$HOME_DIR" ]] || HOME_DIR=/root

  echo "KAIT-CLASS 최신 버전을 확인합니다…"
  # releases/latest 는 최신 릴리스 주소(…/releases/tag/v1.2.3)로 넘겨 준다. 그 주소에서 이름을 읽는다.
  # (GitHub API 는 IP 하나에 시간당 60번 제한이 있어, 학교처럼 여럿이 한 IP 를 쓰면 막힐 수 있다)
  TAG=$(wget -S --spider --max-redirect=0 "https://github.com/$REPO/releases/latest" 2>&1 \
        | awk 'tolower($1)=="location:" {print $2}' | sed -n 's#.*/releases/tag/##p' | tr -d '\r' | head -n 1 || true)
  if [[ -z "$TAG" ]]; then
    echo "최신 릴리스를 찾지 못했습니다. 인터넷 연결을 확인하거나, 아래에서 zip 을 직접 받으세요."
    echo "    https://github.com/$REPO/releases"
    exit 1
  fi
  VER="${TAG#v}"
  DEST="$HOME_DIR/kait-class-$VER"
  echo "버전 $VER → $DEST"

  if [[ -f "$DEST/install.sh" ]]; then
    echo "이미 내려받은 폴더가 있어 그대로 씁니다."
  else
    WORK=$(mktemp -d)
    trap 'rm -rf "$WORK"' EXIT
    wget -q -O "$WORK/src.zip" "https://github.com/$REPO/archive/refs/tags/$TAG.zip" \
      || { echo "소스를 내려받지 못했습니다."; exit 1; }
    python3 -m zipfile -e "$WORK/src.zip" "$WORK/x"
    # GitHub 가 만든 zip 은 안에 폴더가 하나 있다 (예: kait-class-1.0.0)
    INNER=$(find "$WORK/x" -mindepth 1 -maxdepth 1 -type d | head -n 1)
    [[ -n "$INNER" && -f "$INNER/install.sh" ]] || { echo "내려받은 소스에 install.sh 가 없습니다."; exit 1; }
    rm -rf "$DEST"
    mv "$INNER" "$DEST"
    chown -R "$OWNER": "$DEST" 2>/dev/null || true
    rm -rf "$WORK"
    trap - EXIT
  fi

  [[ "${KAIT_GET_DRYRUN:-}" == "1" ]] && { echo "(시험 실행: 여기까지)"; exit 0; }

  cd "$DEST"
  # 이 스크립트는 파이프로 들어오므로, install.sh 가 표준 입력을 건드리지 않게 막는다
  # (재부팅 질문은 install.sh 가 터미널에서 직접 읽는다)
  exec bash install.sh "$@" < /dev/null
}

main "$@"
