#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  KAIT-CLASS 설치 스크립트
#
#  사용법 (소스를 푼 폴더에서):
#      sudo bash install.sh
#
#  도메인과 https(SSL)를 붙일 때 (한 번만, 이후에는 기억한다):
#      sudo bash install.sh --domain class.example.kr --email 나@example.com
#  도메인을 떼고 http 로 돌아갈 때:
#      sudo bash install.sh --no-domain
#
#  ● 설치는 두 번에 나뉜다.
#    1단계에서 커널 부팅 설정(cgroup v1)을 바꾸므로 재부팅이 필요하다.
#    재부팅한 뒤 똑같은 명령을 한 번 더 실행하면 이어서 진행된다.
#  ● 몇 번을 다시 실행해도 안전하다. 이미 된 단계는 건너뛴다.
#    새 버전 소스로 실행하면 업데이트가 된다 (config.php·uploads/·DB 는 유지).
#  ● 대상: Ubuntu 24.04 LTS (무선을 쓴다면 Desktop 판)
#
#  원본 절차: 설치절차.md
# ═══════════════════════════════════════════════════════════════
set -Eeuo pipefail

# ── 고정 값 ─────────────────────────────────────────────────────
JUDGE0_VER="1.13.1"
JUDGE0_DIR="/opt/judge0-v${JUDGE0_VER}"
JUDGE0_ZIP_URL="https://github.com/judge0/judge0/releases/download/v${JUDGE0_VER}/judge0-v${JUDGE0_VER}.zip"
WEB_ROOT="/var/www/html"
DATA_DIR="/var/www/kait-class-data"
PHP_VER="8.3"
NGINX_SITE="/etc/nginx/sites-available/kait-class"
GRUB_DROPIN="/etc/default/grub.d/99-kait-class.cfg"
LOGIND_DROPIN="/etc/systemd/logind.conf.d/99-kait-class.conf"
STATE_DIR="/var/lib/kait-class-install"
LOG="/var/log/kait-class-install.log"
CGROUP_PARAM="systemd.unified_cgroup_hierarchy=0"
ACME_ROOT="/var/www/letsencrypt"
CERTBOT_HOOK="/etc/letsencrypt/renewal-hooks/deploy/kait-class-nginx.sh"
TOTAL=14

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_USER="${SUDO_USER:-}"
export DEBIAN_FRONTEND=noninteractive
APT=(apt-get -y -q -o DPkg::Lock::Timeout=600
     -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)

# ── 화면 출력 ───────────────────────────────────────────────────
if [[ -t 1 ]]; then
  B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; C=$'\e[36m'; N=$'\e[0m'
else
  B=; G=; Y=; R=; C=; N=
fi
STEP_NO=0
CUR_STEP=""

line() { printf '%s\n' "────────────────────────────────────────────────────────"; }

# 단계 안에서 사용자에게 남길 말. 단계가 끝난 뒤 한꺼번에 보여 준다.
note() { echo "$*" >> "$STATE_DIR/notes"; }
# 단계 결과를 '완료' 대신 다른 말로 표시할 때
result() { echo "$*" > "$STATE_DIR/result"; }

fail() {
  printf '\n\n%s  ✗ 실패: %s%s\n\n' "$R$B" "$CUR_STEP" "$N"
  echo "  마지막 기록:"
  tail -n 15 "$LOG" 2>/dev/null | sed 's/^/    │ /'
  echo
  echo "  전체 기록: $LOG"
  echo "  원인을 고친 뒤 같은 명령을 다시 실행하면 이어서 진행합니다."
  echo "      cd \"$SRC\""
  echo "      sudo bash install.sh"
  echo
  exit 1
}

# run_step "제목" 함수
#   함수의 출력은 기록 파일로만 가고, 화면에는 경과 시간만 보인다.
run_step() {
  CUR_STEP="$1"; shift
  STEP_NO=$((STEP_NO + 1))
  : > "$STATE_DIR/notes"; rm -f "$STATE_DIR/result"
  printf '\n===== [%d/%d] %s  (%s) =====\n' "$STEP_NO" "$TOTAL" "$CUR_STEP" "$(date '+%F %T')" >> "$LOG"

  local label; label=$(printf '  [%2d/%d] %s ' "$STEP_NO" "$TOTAL" "$CUR_STEP")
  printf '%s' "$label"

  ( set -Eeuo pipefail; "$@" ) >> "$LOG" 2>&1 &
  local pid=$! t0=$SECONDS
  if [[ -t 1 ]]; then
    while kill -0 "$pid" 2>/dev/null; do
      printf '\r%s%s… %d초%s' "$label" "$C" $((SECONDS - t0)) "$N"
      sleep 1
    done
  fi
  if ! wait "$pid"; then
    printf -- '----- 실패 (%d초) -----\n' $((SECONDS - t0)) >> "$LOG"
    fail
  fi
  printf -- '----- 끝 (%d초) -----\n' $((SECONDS - t0)) >> "$LOG"

  local res="완료" col="$G"
  [[ -s "$STATE_DIR/result" ]] && res="$(cat "$STATE_DIR/result")"
  # '!' 로 시작하는 결과는 "멈추지는 않지만 잘 안 된 것" — 노란색으로
  if [[ "$res" == '!'* ]]; then res="${res#!}"; col="$Y$B"; fi
  printf '\r%s%s%s%s          \n' "$label" "$col" "$res" "$N"
  if [[ -s "$STATE_DIR/notes" ]]; then
    sed "s/^/          ${Y}※${N} /" "$STATE_DIR/notes"
  fi
}

# ── 재부팅 뒤 안내 (사용자 .bashrc 에 잠시 넣었다가 설치가 끝나면 뺀다) ──
REMIND_BEGIN="# >>> kait-class-install >>>"
REMIND_END="# <<< kait-class-install <<<"

user_bashrc() {
  # sudo 로 실행했으면 그 사용자, root 로 바로 접속했으면(클라우드) root
  local who="${RUN_USER:-root}"
  local home; home=$(getent passwd "$who" | cut -d: -f6)
  [[ -n "$home" && -f "$home/.bashrc" ]] || return 1
  echo "$home/.bashrc"
}

remind_add() {
  local rc; rc=$(user_bashrc) || return 0
  remind_remove
  cat >> "$rc" <<EOF
$REMIND_BEGIN
printf '\n\e[1;33m[KAIT-CLASS] 설치가 아직 끝나지 않았습니다. 아래 두 줄을 입력하세요.\e[0m\n'
printf '    cd "%s"\n    sudo bash install.sh\n\n' "$SRC"
$REMIND_END
EOF
}

remind_remove() {
  local rc; rc=$(user_bashrc) || return 0
  sed -i "/^$REMIND_BEGIN\$/,/^$REMIND_END\$/d" "$rc"
}

is_ssh_session() {
  local pid=$$ comm
  while [[ -n "$pid" && "$pid" -gt 1 ]]; do
    comm=$(ps -o comm= -p "$pid" 2>/dev/null | tr -d ' ')
    [[ "$comm" == sshd* ]] && return 0
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
  done
  return 1
}

# SSH 가 실제로 쓰는 포트 목록. 22 가 아닐 수 있다 (클라우드에서 흔하다).
ssh_ports() {
  {
    # Ubuntu 24.04 는 ssh.socket 이 포트를 잡고 있을 수 있다
    if systemctl is-active --quiet ssh.socket 2>/dev/null; then
      systemctl show ssh.socket -p Listen --value | grep -oE ':[0-9]+ \(Stream\)' | grep -oE '[0-9]+'
    fi
    if systemctl is-active --quiet ssh 2>/dev/null || systemctl is-active --quiet sshd 2>/dev/null; then
      sshd -T 2>/dev/null | awk '$1=="port"{print $2}'
    fi
    # 마지막 확인: sshd 프로세스가 실제로 듣고 있는 포트
    ss -Hltnp 2>/dev/null | awk '/"sshd"/{n=split($4,a,":"); print a[n]}'
  } | grep -E '^[0-9]+$' | sort -un
}

# ═══════════════════════════════════════════════════════════════
#  1단계
# ═══════════════════════════════════════════════════════════════

net_fail() {
  echo "오류 내용: $1"
  echo
  echo "github.com 에 접속하지 못했습니다. 흔한 원인:"
  echo "  - 학교·기관 와이파이: 브라우저에서 로그인(인증)해야 인터넷이 열리는 경우"
  echo "  - 'certificate' 오류: 기관 보안 장비가 HTTPS 를 검사하는 경우 → 다른 망에서 설치"
  echo "  - 'resolve' 오류: DNS 문제 → 와이파이를 껐다 켜 보기"
  echo "  - 연결 시간 초과: 방화벽이 github.com 을 막는 경우"
  exit 1
}

step_check() {
  . /etc/os-release
  echo "OS: $PRETTY_NAME"
  if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "24.04" ]]; then
    echo "Ubuntu 24.04 가 아닙니다: $PRETTY_NAME"
    exit 1
  fi
  # 채점 엔진(Judge0) 이미지는 인텔·AMD(x86_64)용만 있다
  local arch; arch=$(uname -m)
  if [[ "$arch" != "x86_64" ]]; then
    echo "이 컴퓨터의 CPU 종류($arch)에서는 채점 엔진이 동작하지 않습니다. 인텔·AMD(x86_64) 컴퓨터가 필요합니다."
    exit 1
  fi
  for f in lib.php schema.php config.sample.php judge-worker.php judge-worker.service; do
    [[ -f "$SRC/$f" ]] || { echo "소스 파일이 없습니다: $SRC/$f"; exit 1; }
  done
  # ★ /tmp 는 재부팅하면 비워진다. 1단계 뒤 재부팅하면 소스가 사라져 이어서 설치할 수 없다.
  case "$SRC" in
    /tmp|/tmp/*|/var/tmp|/var/tmp/*|/dev/shm|/dev/shm/*|/run/*)
      echo "소스가 임시 폴더($SRC)에 있습니다."
      echo "이 폴더는 재부팅하면 지워져서, 중간 재부팅 뒤 설치를 이어갈 수 없습니다."
      echo "zip 을 홈 폴더로 옮겨 다시 풀고 거기서 실행하세요. 예:"
      echo "    mv <zip 파일> ~ && cd ~"
      echo "    python3 -m zipfile -e <zip 파일> ."
      echo "    cd kait-class && sudo bash install.sh"
      exit 1 ;;
  esac
  if [[ "$SRC" == "$WEB_ROOT" || "$SRC" == "$WEB_ROOT"/* ]]; then
    echo "소스를 $WEB_ROOT 안에 풀면 안 됩니다. 홈 폴더 등에 풀어 주세요."
    exit 1
  fi
  # ★ 새로 깐 우분투 데스크톱에는 curl 이 없다 (wget 은 있다).
  #   curl 은 다음 단계에서 설치되므로 여기서는 있는 것을 쓴다.
  echo "인터넷 연결 확인"
  local err=""
  if command -v curl > /dev/null; then
    err=$(curl -fsS --max-time 15 -o /dev/null https://github.com 2>&1) || net_fail "$err"
  elif command -v wget > /dev/null; then
    err=$(wget -nv --spider --timeout=15 --tries=1 https://github.com 2>&1) || net_fail "$err"
  else
    echo "curl 과 wget 이 모두 없어 인터넷 연결을 확인할 수 없습니다."
    echo "    sudo apt install -y curl"
    exit 1
  fi
  echo "인터넷 연결 정상"
  echo "CPU $(nproc)코어 · 메모리 $(free -h | awk '/^Mem/{print $2}') · 디스크 여유 $(df -h / | awk 'NR==2{print $4}')"
  local free_gb; free_gb=$(df -BG / | awk 'NR==2{gsub("G","",$4); print $4}')
  local mem_mb; mem_mb=$(awk '/^MemTotal/{print int($2/1024)}' /proc/meminfo)
  if (( mem_mb < 3500 )); then note "메모리가 ${mem_mb}MB 입니다. 100명 이상이 동시에 참가하는 대회를 열려면 4GB 이상을 권합니다."; fi
  if (( free_gb < 20 )); then note "디스크 여유가 ${free_gb}GB 입니다. 채점 엔진 이미지에 20GB 이상을 권합니다."; fi
}

step_base() {
  if [[ -f "$STATE_DIR/base.done" ]]; then
    "${APT[@]}" update
    "${APT[@]}" install curl wget git unzip rsync ca-certificates openssl
    result "완료 (이미 설치됨, 확인만)"
    return
  fi
  "${APT[@]}" update
  "${APT[@]}" upgrade
  "${APT[@]}" install curl wget git unzip rsync ca-certificates openssl
  touch "$STATE_DIR/base.done"
}

step_power() {
  # 절전 자체를 막는다 (모든 기계). 서버가 잠들면 안 된다.
  systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target

  if compgen -G "/sys/class/power_supply/BAT*" > /dev/null; then
    # 노트북: 덮개를 닫아도 동작하게. 다음 부팅부터 적용된다.
    # (여기서 logind 를 재시작하면 데스크톱 세션이 끊길 수 있어 하지 않는다.
    #  잠자기를 위에서 막았으므로 지금 덮개를 닫아도 잠들지 않는다.)
    mkdir -p "$(dirname "$LOGIND_DROPIN")"
    cat > "$LOGIND_DROPIN" <<'EOF'
# KAIT-CLASS: 노트북을 서버로 쓰기 위해 덮개를 닫아도 잠들지 않게 한다
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
EOF
    note "노트북입니다. 전원 어댑터를 늘 꽂아 두세요."
    result "완료 (노트북 설정 포함)"
  fi

  if command -v powerprofilesctl > /dev/null; then
    powerprofilesctl set performance || echo "성능 모드를 지원하지 않는 기계"
  fi
}

step_cgroup() {
  local fs; fs=$(stat -fc %T /sys/fs/cgroup)
  echo "현재 cgroup: $fs"
  echo "부팅 인자: $(cat /proc/cmdline)"

  if [[ "$fs" == "tmpfs" ]]; then
    result "완료 (cgroup v1 확인)"
    return
  fi

  if grep -qw "$CGROUP_PARAM" /proc/cmdline; then
    # 인자는 들어갔는데 v1 이 아니다 → 이 systemd 가 v1 을 지원하지 않는다
    echo "부팅 인자가 적용됐는데도 cgroup v1 이 아닙니다 ($fs)."
    echo "systemd 버전: $(systemctl --version | head -1)"
    exit 1
  fi

  command -v update-grub > /dev/null || { echo "update-grub 이 없습니다 (GRUB 를 쓰지 않는 기계)."; exit 1; }

  # /etc/default/grub 원본은 건드리지 않고 별도 파일로 덧붙인다.
  # grub.d 의 파일은 원본 뒤에 읽히므로 클라우드 이미지의 설정도 덮어쓰지 않는다.
  mkdir -p "$(dirname "$GRUB_DROPIN")"
  cat > "$GRUB_DROPIN" <<EOF
# KAIT-CLASS: 채점 엔진(Judge0)의 격리 기능이 cgroup v1 을 필요로 한다
GRUB_CMDLINE_LINUX_DEFAULT="\${GRUB_CMDLINE_LINUX_DEFAULT} $CGROUP_PARAM"
EOF
  update-grub
  touch "$STATE_DIR/need_reboot"
  result "완료 (재부팅 필요)"
}

# ═══════════════════════════════════════════════════════════════
#  2단계
# ═══════════════════════════════════════════════════════════════

step_docker() {
  if dpkg -s docker-ce > /dev/null 2>&1 && docker compose version > /dev/null 2>&1; then
    systemctl enable --now docker
    docker compose version
    result "완료 (이미 설치됨)"
    return
  fi
  if command -v snap > /dev/null && snap list docker > /dev/null 2>&1; then
    echo "snap 으로 설치된 docker 가 있습니다. 'sudo snap remove docker' 후 다시 실행하세요."
    exit 1
  fi
  # 우분투 기본 저장소의 docker 와는 함께 설치할 수 없다
  local p
  for p in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
    if dpkg -s "$p" > /dev/null 2>&1; then "${APT[@]}" remove "$p"; fi
  done

  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  "${APT[@]}" update
  "${APT[@]}" install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  docker run --rm hello-world
  docker compose version
}

step_firewall() {
  "${APT[@]}" install ufw
  ufw allow 80/tcp
  ufw allow 443/tcp
  # SSH 는 설치하지 않는다. 다만 이미 SSH 로 쓰고 있는 기계라면
  # 방화벽을 켜는 순간 접속이 끊기므로 SSH 가 쓰는 포트를 열어 둔다.
  local ports port
  ports=$(ssh_ports || true)
  for port in $ports; do
    ufw allow "$port/tcp"
  done
  if [[ -n "$ports" ]]; then
    note "SSH 가 켜져 있어 SSH 포트($(echo $ports | tr ' ' ','))도 열어 두었습니다."
  elif is_ssh_session; then
    echo "SSH 로 접속 중인데 SSH 포트를 찾지 못했습니다."
    echo "방화벽을 켜면 접속이 끊길 수 있어 중단합니다."
    echo "SSH 포트를 직접 열고(sudo ufw allow <포트>/tcp) 다시 실행하세요."
    exit 1
  fi
  ufw --force enable
  ufw status verbose
}

step_judge0() {
  if [[ ! -f "$JUDGE0_DIR/docker-compose.yml" ]]; then
    local tmp; tmp=$(mktemp -d)
    wget -q -O "$tmp/judge0.zip" "$JUDGE0_ZIP_URL"
    unzip -oq "$tmp/judge0.zip" -d /opt
    rm -rf "$tmp"
  fi
  cd "$JUDGE0_DIR"

  # 비밀번호: 비어 있을 때만 만든다.
  # 이미 값이 있으면 절대 바꾸지 않는다 — DB 볼륨이 옛 비밀번호를 기억하고 있다.
  local k
  for k in POSTGRES_PASSWORD REDIS_PASSWORD; do
    if grep -qE "^${k}=\s*$" judge0.conf; then
      sed -i -E "s/^${k}=\s*$/${k}=$(openssl rand -hex 16)/" judge0.conf
      echo "$k 생성"
    else
      echo "$k 기존 값 유지"
    fi
  done
  # ★ 600 으로 막으면 안 된다. server·workers 컨테이너는 안에서 root 가 아닌
  #   judge0 사용자로 이 파일을 직접 읽는다. 못 읽으면 DB 비밀번호를 몰라 계속 죽는다.
  #   (db·redis 는 docker 가 root 로 읽어 넘겨주므로 600 이어도 떠서 원인이 가려진다)
  chmod 644 judge0.conf

  # ★ 채점 엔진을 바깥에 열지 않는다. 이게 빠지면 누구나 이 서버에서 코드를 실행할 수 있다.
  sed -i -E 's/^(\s*-\s*)"2358:2358"/\1"127.0.0.1:2358:2358"/' docker-compose.yml
  if ! grep -q '"127.0.0.1:2358:2358"' docker-compose.yml \
     || grep -E '^\s*-\s*"?2358:2358' docker-compose.yml; then
    echo "docker-compose.yml 의 포트를 127.0.0.1 로 묶지 못했습니다. 중단합니다."
    exit 1
  fi

  # 이미 떠 있던 설치인지 (다시 실행한 경우)
  local existed; existed=$(docker compose ps -aq server)

  echo "이미지 내려받기"
  docker compose pull
  docker compose up -d db redis
  sleep 10
  docker compose up -d

  # 다시 실행한 경우: 설정이 바뀌었을 수 있으니 server·workers 가 새로 읽게 한다.
  # (처음 설치할 때는 막 뜬 컨테이너를 건드리지 않는다)
  if [[ -n "$existed" ]]; then
    docker compose restart server workers
  fi

  echo "채점 엔진 응답 대기"
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 5 http://127.0.0.1:2358/about; then echo; break; fi
    sleep 5
  done
  curl -fsS --max-time 5 http://127.0.0.1:2358/about > /dev/null \
    || { docker compose ps
         docker compose logs --tail 20 db redis workers
         echo "----- server 기록 -----"
         docker compose logs --no-log-prefix --tail 12 server
         echo "채점 엔진(server)이 응답하지 않습니다. 바로 위 server 기록을 확인하세요."
         exit 1; }
  docker compose ps

  # 바깥 주소로는 열려 있지 않은지 확인
  local ip; ip=$(hostname -I | awk '{print $1}')
  if [[ -n "$ip" ]] && curl -fsS --max-time 3 "http://$ip:2358/about" > /dev/null 2>&1; then
    echo "채점 엔진이 $ip:2358 로 열려 있습니다. 중단합니다."
    exit 1
  fi
}

judge_try() {  # judge_try 언어ID 코드
  local body
  body=$(printf '{"source_code":%s,"language_id":%s}' "$2" "$1")
  curl -fsS --max-time 60 -X POST \
    'http://127.0.0.1:2358/submissions?base64_encoded=false&wait=true' \
    -H 'Content-Type: application/json' -d "$body"
}

step_judge_test() {
  local py c out ok pair
  py='"print(1+2)"'
  c='"#include <stdio.h>\nint main(){printf(\"3\\n\");return 0;}"'
  for pair in "71:$py" "50:$c"; do
    ok=0
    for _ in 1 2 3 4 5; do
      out=$(judge_try "${pair%%:*}" "${pair#*:}" || true)
      echo "언어 ${pair%%:*}: $out"
      if grep -q '"description":"Accepted"' <<< "$out" && grep -q '"stdout":"3\\n"' <<< "$out"; then
        ok=1; break
      fi
      sleep 5
    done
    if (( ok == 0 )); then
      echo "--- cgroup: $(stat -fc %T /sys/fs/cgroup)"
      (cd "$JUDGE0_DIR" && docker compose logs --tail 30 workers) || true
      echo "채점 시험 실패 (언어 ${pair%%:*}). 대개 cgroup v1 이 적용되지 않은 경우입니다."
      exit 1
    fi
  done
  result "완료 (Python · C 정답 확인)"
}

step_web_pkg() {
  # 80번을 다른 웹서버가 쓰고 있으면 nginx 가 뜨지 않는다
  if systemctl is-active --quiet apache2 2>/dev/null; then
    echo "apache2 가 실행 중입니다. 'sudo systemctl disable --now apache2' 후 다시 실행하세요."
    exit 1
  fi
  "${APT[@]}" install nginx \
    php${PHP_VER}-fpm php${PHP_VER}-cli php${PHP_VER}-sqlite3 php${PHP_VER}-mbstring \
    php${PHP_VER}-curl php${PHP_VER}-xml php${PHP_VER}-zip
  systemctl enable --now nginx php${PHP_VER}-fpm
  php -v
}

step_source() {
  mkdir -p "$DATA_DIR"
  chown -R www-data:www-data "$DATA_DIR"
  chmod 775 "$DATA_DIR"

  mkdir -p "$WEB_ROOT"

  # ★ 아래 복사는 새 소스에 없는 파일을 지운다.
  #   DB 가 웹 폴더 안에 있는 옛 설치라면 DB 가 지워지므로, 아무것도 하지 않고 멈춘다.
  if [[ -f "$WEB_ROOT/config.php" ]]; then
    local dbp
    dbp=$(cd "$WEB_ROOT" && php -r '$c = @include "config.php"; echo is_array($c) ? ($c["db_path"] ?? "") : "";' 2>/dev/null || true)
    dbp=$(realpath -m "$dbp" 2>/dev/null || echo "$dbp")
    echo "config.php 의 DB 경로: ${dbp:-(읽지 못함)}"
    if [[ -z "$dbp" ]]; then
      echo "기존 config.php 에서 DB 경로를 읽지 못했습니다. 안전을 위해 중단합니다."
      exit 1
    fi
    if [[ "$dbp" == "$WEB_ROOT"/* ]]; then
      echo "DB 가 웹 폴더 안에 있습니다: $dbp"
      echo "이대로 진행하면 DB 가 지워집니다. 아무것도 바꾸지 않고 중단합니다."
      echo "DB 를 $DATA_DIR 로 옮기고 config.php 의 db_path 를 고친 뒤 다시 실행하세요."
      exit 1
    fi
  fi
  local stray
  stray=$(find "$WEB_ROOT" -type f \( -name '*.db' -o -name '*.sqlite' -o -name '*.sqlite3' \) \
            ! -path "$WEB_ROOT/uploads/*" -print -quit 2>/dev/null || true)
  if [[ -n "$stray" ]]; then
    echo "웹 폴더 안에 DB 파일이 있습니다: $stray"
    echo "이대로 진행하면 지워질 수 있어 중단합니다. 웹 폴더 밖으로 옮긴 뒤 다시 실행하세요."
    exit 1
  fi

  # 우리 것이 아닌 파일이 들어 있으면 지우지 않고 옆으로 옮겨 둔다
  if [[ ! -f "$WEB_ROOT/lib.php" ]] && \
     [[ -n "$(find "$WEB_ROOT" -mindepth 1 -maxdepth 1 ! -name 'index.nginx-debian.html' ! -name 'index.html' -print -quit)" ]]; then
    local bak; bak="${WEB_ROOT}.bak-$(date +%Y%m%d-%H%M%S)"
    mv "$WEB_ROOT" "$bak"
    mkdir -p "$WEB_ROOT"
    note "$WEB_ROOT 에 있던 파일을 $bak 로 옮겼습니다."
  fi

  # --delete: 이름이 바뀌거나 사라진 옛 파일을 지운다 (업데이트할 때 중요).
  # 제외 목록에 있는 것은 웹 루트에 복사하지 않고, 이미 있으면 지우지도 않는다.
  local upgrade=0
  [[ -f "$WEB_ROOT/lib.php" ]] && upgrade=1
  rsync -a --delete \
    --exclude='/install.sh' \
    --exclude='/get.sh' \
    --exclude='/docs/' \
    --exclude='/judge-worker.service' \
    --exclude='/README*' \
    --exclude='/LICENSE*' \
    --exclude='/*.md' \
    --exclude='/.git*' \
    --exclude='/config.php' \
    --exclude='/uploads/' \
    "$SRC/" "$WEB_ROOT/"

  if [[ ! -f "$WEB_ROOT/config.php" ]]; then
    cp "$SRC/config.sample.php" "$WEB_ROOT/config.php"
  else
    echo "config.php 기존 파일 유지"
  fi
  mkdir -p "$WEB_ROOT/uploads"
  chown -R www-data:www-data "$WEB_ROOT"
  chmod 640 "$WEB_ROOT/config.php"

  (( upgrade )) && result "완료 (기존 설치 위에 업데이트, 설정·업로드 유지)"
  return 0
}

# ── 도메인·SSL ──────────────────────────────────────────────────
#   --domain 으로 받은 값은 $STATE_DIR 에 저장해 두고, 다음 실행부터 그대로 쓴다.
#   그래야 업데이트할 때 nginx 설정을 새로 써도 https 가 유지된다.

saved_domains() { [[ -s "$STATE_DIR/domains" ]] && cat "$STATE_DIR/domains" || true; }
saved_email()   { [[ -s "$STATE_DIR/email"   ]] && cat "$STATE_DIR/email"   || true; }
primary_domain() { saved_domains | awk '{print $1}'; }

# 인증서가 저장된 도메인을 모두 담고 있는가
cert_covers() {
  local d="$1" crt="/etc/letsencrypt/live/$1/fullchain.pem" x
  [[ -f "$crt" && -f "/etc/letsencrypt/live/$d/privkey.pem" ]] || return 1
  local sans; sans=$(openssl x509 -in "$crt" -noout -ext subjectAltName 2>/dev/null) || return 1
  for x in $(saved_domains); do
    grep -qE "DNS:${x//./\\.}(,|\$)" <<< "$sans" || return 1
  done
  # 이미 만료된 인증서는 없는 것으로 본다
  openssl x509 -in "$crt" -noout -checkend 0 > /dev/null 2>&1
}

# https 로 서비스할 수 있는 상태인가
ssl_ready() {
  local d; d=$(primary_domain)
  [[ -n "$d" ]] && cert_covers "$d"
}

# nginx server 블록의 공통 부분 (http 전용일 때와 https 일 때 같다)
nginx_body() {
  cat <<EOF
    root $WEB_ROOT;
    index index.php index.html;

    client_max_body_size 20M;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    location / {
        try_files \$uri \$uri/ =404;
    }

    location ~ \.php\$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php${PHP_VER}-fpm.sock;
    }

    # 업로드 폴더에서는 PHP 를 실행하지 않는다.
    # 이미지인 척 올린 PHP 파일이 실행되는 것을 막는다.
    location ^~ /uploads/ {
        location ~ \.php\$ { deny all; }
    }

    # 글꼴과 편집기는 오래 캐시해도 된다
    location ~ ^/(fonts|cm)/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location = /robots.txt { log_not_found off; access_log off; }
    location ~ /\.  { deny all; }
EOF
}

# 인증서 발급·갱신 때 Let's Encrypt 가 들여다보는 곳.
# ^~ 라서 위의 "점으로 시작하는 경로 막기"보다 먼저 걸린다.
nginx_acme() {
  cat <<EOF
    location ^~ /.well-known/acme-challenge/ {
        root $ACME_ROOT;
        default_type text/plain;
    }
EOF
}

write_nginx_conf() {
  mkdir -p "$ACME_ROOT"
  if ! ssl_ready; then
    {
      echo "# KAIT-CLASS — install.sh 가 만든 파일 (다시 설치하면 덮어쓴다)"
      echo "# http 전용$( [[ -n "$(primary_domain)" ]] && echo " (도메인 $(primary_domain) 의 인증서를 아직 받지 못함)")"
      echo "server {"
      echo "    listen 80 default_server;"
      echo "    listen [::]:80 default_server;"
      echo "    server_name _;"
      echo
      nginx_acme
      echo
      nginx_body
      echo "}"
    } > "$NGINX_SITE"
    return
  fi

  local d names map_hosts=""
  d=$(primary_domain)
  names=$(saved_domains)
  for x in $names; do map_hosts+="    $x 1;"$'\n'; done
  cat > "$NGINX_SITE" <<EOF
# KAIT-CLASS — install.sh 가 만든 파일 (다시 설치하면 덮어쓴다)
# https: $names

# ── http 로 들어온 요청을 https 로 넘길지 정한다 ──
#   · 인증서 확인 요청(/.well-known/acme-challenge/)은 넘기지 않는다
#   · 집·학교 안(내부 IP)에서 IP 주소로 들어오면 넘기지 않는다
#     (공유기가 바깥 주소로 되돌아 들어오는 것을 못 하는 경우에도 접속되게)
#   · 그 밖에는 모두 https://$d 로 넘긴다
geo \$kait_lan {
    default 0;
    127.0.0.0/8 1;
    10.0.0.0/8 1;
    172.16.0.0/12 1;
    192.168.0.0/16 1;
    ::1 1;
    fc00::/7 1;
    fe80::/10 1;
}
map \$host \$kait_is_domain {
    default 0;
$map_hosts}
map \$uri \$kait_acme {
    default 0;
    "~^/\.well-known/acme-challenge/" 1;
}
map "\$kait_acme\$kait_lan\$kait_is_domain" \$kait_redirect {
    default 1;
    "~^1" 0;
    "010" 0;
}

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    if (\$kait_redirect) {
        return 301 https://$d\$request_uri;
    }

$(nginx_acme)

$(nginx_body)
}

server {
    listen 443 ssl http2 default_server;
    listen [::]:443 ssl http2 default_server;
    server_name $names;

    ssl_certificate     /etc/letsencrypt/live/$d/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$d/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:KAITSSL:10m;
    ssl_session_timeout 1d;

$(nginx_body)
}
EOF
}

step_nginx() {
  write_nginx_conf
  ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/kait-class
  rm -f /etc/nginx/sites-enabled/default
  cat "$NGINX_SITE"
  nginx -t
  systemctl reload nginx
  ssl_ready && result "완료 (https)"
  return 0
}

# 이 서버의 공인 IP (바깥에서 보이는 주소)
public_ip() {
  local u ip
  for u in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
    ip=$(curl -4 -fsS --max-time 8 "$u" 2>/dev/null | tr -d '[:space:]') || continue
    [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && { echo "$ip"; return 0; }
  done
  return 1
}

# SSL 을 못 붙였을 때: 설치는 멈추지 않고 http 로 계속한다.
ssl_give_up() {
  echo "SSL 포기: $*"
  printf '%s\n' "$@" > "$STATE_DIR/ssl_error"
  result "!받지 못함 — 사이트는 http 로 계속 동작 (끝에 안내)"
  exit 0
}

step_ssl() {
  rm -f "$STATE_DIR/ssl_error"
  local d names email
  d=$(primary_domain); names=$(saved_domains); email=$(saved_email)
  if [[ -z "$d" ]]; then
    echo "도메인이 없어 건너뜀"
    result "건너뜀 (도메인 없음, http 로 운영)"
    return 0
  fi

  "${APT[@]}" install certbot
  mkdir -p "$ACME_ROOT" "$(dirname "$CERTBOT_HOOK")"
  # 인증서가 갱신되면 nginx 가 새 인증서를 읽게 한다
  cat > "$CERTBOT_HOOK" <<'EOF'
#!/bin/sh
# KAIT-CLASS — 인증서가 갱신되면 nginx 가 새 인증서를 읽게 한다
systemctl reload nginx
EOF
  chmod 755 "$CERTBOT_HOOK"
  systemctl enable --now certbot.timer 2>/dev/null || true

  if ssl_ready; then
    local until; until=$(openssl x509 -in "/etc/letsencrypt/live/$d/fullchain.pem" -noout -enddate | cut -d= -f2)
    echo "인증서 있음: $until"
    # 30일 안에 만료되면 지금 갱신 (평소에는 우분투가 알아서 한다)
    if openssl x509 -in "/etc/letsencrypt/live/$d/fullchain.pem" -noout -checkend $((30*86400)) > /dev/null; then
      result "완료 (인증서 있음, 만료 $(date -d "$until" +%F), 자동 갱신)"
      return 0
    fi
    echo "30일 안에 만료 → 갱신 시도"
  fi

  # ── 사전 확인: 도메인이 이 서버를 가리키는가 ──
  local x ips pub
  pub=$(public_ip || true)
  echo "이 서버의 공인 IP: ${pub:-알 수 없음}"
  for x in $names; do
    ips=$(getent ahostsv4 "$x" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' || true)
    echo "$x → ${ips:-(없음)}"
    if [[ -z "$ips" ]]; then
      ssl_give_up "도메인 $x 의 주소를 찾지 못했습니다." \
                  "도메인 관리 화면에서 A 레코드를 ${pub:-이 서버의 공인 IP} 로 만들었는지 확인하세요." \
                  "방금 바꿨다면 퍼지는 데 몇 분~몇 시간 걸립니다. 조금 뒤 다시 실행하세요."
    fi
    if [[ -n "$pub" && " $ips" != *" $pub "* ]]; then
      ssl_give_up "도메인 $x 이(가) 다른 곳(${ips% })을 가리킵니다. 이 서버의 공인 IP 는 $pub 입니다." \
                  "도메인 관리 화면에서 A 레코드를 $pub 로 바꾸세요." \
                  "방금 바꿨다면 퍼지는 데 몇 분~몇 시간 걸립니다. 조금 뒤 다시 실행하세요."
    fi
  done

  # ── 인증서 받기 ──
  local args=() out
  for x in $names; do args+=(-d "$x"); done
  set +e
  out=$(certbot certonly --webroot -w "$ACME_ROOT" --cert-name "$d" "${args[@]}" \
          --email "$email" --agree-tos --no-eff-email --non-interactive \
          --keep-until-expiring --expand 2>&1)
  local rc=$?
  set -e
  echo "$out"
  if (( rc != 0 )); then
    if grep -qiE 'too many|rateLimited' <<< "$out"; then
      ssl_give_up "Let's Encrypt 발급 횟수 제한에 걸렸습니다." \
                  "한 시간쯤 뒤(여러 번 실패했다면 하루 뒤) 다시 실행하세요."
    elif grep -qiE 'NXDOMAIN|DNS problem|no valid A' <<< "$out"; then
      ssl_give_up "Let's Encrypt 가 도메인 주소를 찾지 못했습니다." \
                  "도메인 연결(A 레코드)을 확인하고, 방금 바꿨다면 조금 뒤 다시 실행하세요."
    elif grep -qiE 'Timeout during connect|Connection refused|Connection reset' <<< "$out"; then
      ssl_give_up "바깥에서 이 서버의 80번 포트로 들어오지 못했습니다." \
                  "공유기라면 80·443번 포트포워딩이 이 컴퓨터($(hostname -I | awk '{print $1}'))를 가리키는지," \
                  "클라우드라면 콘솔 방화벽에서 80·443번이 열려 있는지 확인하세요." \
                  "일부 가정용 인터넷은 80번을 막기도 합니다."
    elif grep -qiE 'Invalid response|unauthorized' <<< "$out"; then
      ssl_give_up "바깥에서 80번으로 들어온 요청이 이 서버가 아닌 곳으로 갔습니다." \
                  "공유기 포트포워딩이 옛 기기를 가리키고 있지 않은지 확인하세요." \
                  "(이 컴퓨터의 내부 IP: $(hostname -I | awk '{print $1}'))"
    else
      ssl_give_up "인증서를 받지 못했습니다. 자세한 내용은 기록 파일을 보세요." \
                  "    sudo less $LOG"
    fi
  fi

  # ── https 설정으로 바꾸고 확인 ──
  ssl_ready || { echo "인증서를 받았다는데 파일이 맞지 않습니다."; exit 1; }
  step_nginx
  sleep 1
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
           --resolve "$d:443:127.0.0.1" "https://$d/")
  echo "https://$d/ → $code"
  [[ "$code" == "200" ]] || { echo "https 첫 화면이 열리지 않습니다 ($code)."; exit 1; }
  local until; until=$(openssl x509 -in "/etc/letsencrypt/live/$d/fullchain.pem" -noout -enddate | cut -d= -f2)
  result "완료 (https://$d, 만료 $(date -d "$until" +%F), 자동 갱신)"
}

step_worker() {
  install -m 0644 "$SRC/judge-worker.service" /etc/systemd/system/judge-worker.service
  systemctl daemon-reload
  systemctl enable judge-worker
  # 업데이트일 수 있으므로 늘 다시 띄워 새 코드를 읽게 한다
  systemctl restart judge-worker
  sleep 3
  systemctl is-active judge-worker
  journalctl -u judge-worker -n 20 --no-pager
}

step_final() {
  local code
  # 첫 접속 때 DB 가 만들어진다
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 http://127.0.0.1/)
  echo "첫 화면: $code"
  [[ "$code" == "200" ]] || { tail -n 20 "$DATA_DIR/php-error.log" 2>/dev/null || true; echo "첫 화면이 열리지 않습니다 ($code)."; exit 1; }

  [[ -f "$DATA_DIR/kait-class.db" ]] || { echo "DB 파일이 만들어지지 않았습니다."; exit 1; }
  [[ "$(stat -c %U "$DATA_DIR/kait-class.db")" == "www-data" ]] \
    || { echo "DB 파일 소유자가 www-data 가 아닙니다."; exit 1; }

  # 웹으로 열리면 안 되는 것들 → 404 여야 한다
  local f
  for f in judge-worker.php reset-admin.php test.php loadtest.php install.sh get.sh judge-worker.service README.md; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1/$f")
    echo "/$f → $code"
    [[ "$code" == "404" ]] || { echo "/$f 가 404 가 아닙니다."; exit 1; }
  done
  # config.php 는 PHP 로 실행되어 아무것도 내보내지 않아야 한다
  [[ -z "$(curl -s --max-time 10 http://127.0.0.1/config.php)" ]] \
    || { echo "config.php 내용이 웹으로 보입니다."; exit 1; }

  # https 로 운영 중이면: 바깥에서 도메인으로 http 로 오면 https 로 넘기는지, https 가 열리는지
  if ssl_ready; then
    local d; d=$(primary_domain)
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
             --resolve "$d:443:127.0.0.1" "https://$d/")
    echo "https://$d/ → $code"
    [[ "$code" == "200" ]] || { echo "https 첫 화면이 열리지 않습니다 ($code)."; exit 1; }
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
             --resolve "$d:80:127.0.0.1" "http://$d/")
    echo "http://$d/ → $code"
    [[ "$code" == "301" ]] || { echo "http 로 들어온 요청을 https 로 넘기지 않습니다 ($code)."; exit 1; }
  fi

  systemctl is-active --quiet judge-worker || { echo "채점 워커가 멈춰 있습니다."; exit 1; }
}

# ═══════════════════════════════════════════════════════════════
#  실행
# ═══════════════════════════════════════════════════════════════

usage() {
  cat <<'EOF'
사용법 (소스를 푼 폴더에서):
    sudo bash install.sh                  설치·업데이트
    sudo bash install.sh --domain 도메인 --email 메일
                                          도메인과 https(SSL) 붙이기
    sudo bash install.sh --no-domain      도메인을 떼고 http 로 돌아가기

  --domain 은 여러 번 쓸 수 있습니다 (첫 번째가 대표 주소).
    예) --domain class.example.kr --domain www.class.example.kr
  메일은 인증서가 곧 만료될 때 Let's Encrypt 가 알려 주는 데만 쓰입니다.
  도메인은 기억해 두므로, 다음 업데이트부터는 옵션 없이 실행하면 됩니다.
EOF
}

ARG_DOMAINS=()
ARG_EMAIL=""
ARG_NO_DOMAIN=0
while (( $# )); do
  case "$1" in
    --domain)    [[ -n "${2:-}" ]] || { echo "--domain 뒤에 도메인을 적으세요."; exit 1; }
                 ARG_DOMAINS+=("$2"); shift 2 ;;
    --domain=*)  ARG_DOMAINS+=("${1#*=}"); shift ;;
    --email)     [[ -n "${2:-}" ]] || { echo "--email 뒤에 메일 주소를 적으세요."; exit 1; }
                 ARG_EMAIL="$2"; shift 2 ;;
    --email=*)   ARG_EMAIL="${1#*=}"; shift ;;
    --no-domain) ARG_NO_DOMAIN=1; shift ;;
    -h|--help)   usage; exit 0 ;;
    *)           echo "알 수 없는 옵션: $1"; echo; usage; exit 1 ;;
  esac
done

# 도메인 모양 검사 (https:// 나 / 를 붙여 적는 실수를 걸러낸다)
for i in "${!ARG_DOMAINS[@]}"; do
  x="${ARG_DOMAINS[$i],,}"
  if [[ ! "$x" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]]; then
    echo "도메인 모양이 아닙니다: ${ARG_DOMAINS[$i]}"
    echo "https:// 나 / 없이 이름만 적으세요. 예) --domain class.example.kr"
    exit 1
  fi
  ARG_DOMAINS[$i]="$x"
done
if [[ -n "$ARG_EMAIL" && ! "$ARG_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then
  echo "메일 주소 모양이 아닙니다: $ARG_EMAIL"
  exit 1
fi
if (( ARG_NO_DOMAIN )) && (( ${#ARG_DOMAINS[@]} )); then
  echo "--domain 과 --no-domain 은 함께 쓸 수 없습니다."
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "관리자 권한이 필요합니다. 아래처럼 실행하세요."
  echo "    sudo bash install.sh"
  exit 1
fi

mkdir -p "$STATE_DIR"
touch "$LOG"; chmod 600 "$LOG"

# 도메인·메일 저장. 메일은 처음 도메인을 붙일 때 반드시 받는다.
if (( ARG_NO_DOMAIN )); then
  rm -f "$STATE_DIR/domains" "$STATE_DIR/ssl_error"
elif (( ${#ARG_DOMAINS[@]} )); then
  if [[ -z "$ARG_EMAIL" && -z "$(saved_email)" ]]; then
    echo "도메인을 붙이려면 메일 주소도 함께 적어야 합니다."
    echo "    sudo bash install.sh --domain ${ARG_DOMAINS[0]} --email 나@example.com"
    echo "(인증서가 곧 만료될 때 Let's Encrypt 가 알려 주는 데만 쓰입니다)"
    exit 1
  fi
  # 같은 이름을 두 번 적었으면 한 번만
  printf '%s\n' "${ARG_DOMAINS[@]}" | awk '!seen[$0]++' | paste -sd' ' > "$STATE_DIR/domains"
fi
[[ -n "$ARG_EMAIL" ]] && echo "$ARG_EMAIL" > "$STATE_DIR/email"
printf '\n\n########## 설치 시작 %s (소스: %s) ##########\n' "$(date '+%F %T')" "$SRC" >> "$LOG"

echo
line
printf '  %sKAIT-CLASS 설치%s\n' "$B" "$N"
if [[ -f "$STATE_DIR/phase1.done" ]]; then
  echo "  지난번에 하던 설치를 이어서 진행합니다."
else
  echo "  컴퓨팅 사고력이 자라는 특별한 프로그래밍 수업"
  echo "  처음 설치는 10~30분 걸립니다. 중간에 재부팅이 한 번 있습니다."
fi
[[ -n "$(primary_domain)" ]] && echo "  도메인: $(saved_domains)"
(( ARG_NO_DOMAIN )) && echo "  도메인을 떼고 http 로 돌아갑니다."
echo "  기록: $LOG"
line

rm -f "$STATE_DIR/need_reboot"
run_step "설치 환경 확인"              step_check
run_step "기본 패키지"                 step_base
run_step "서버용 전원 설정"            step_power
run_step "채점 격리 설정 (cgroup v1)"  step_cgroup
touch "$STATE_DIR/phase1.done"

if [[ -f "$STATE_DIR/need_reboot" ]]; then
  remind_add
  echo
  line
  printf '  %s1단계가 끝났습니다. 재부팅이 필요합니다.%s\n' "$B" "$N"
  echo
  if is_ssh_session; then
    echo "  재부팅하면 SSH 접속이 끊깁니다. 1~2분 뒤 다시 접속해서"
    echo "  아래 두 줄을 그대로 입력하세요."
  else
    echo "  재부팅한 뒤 터미널을 열고 아래 두 줄을 그대로 입력하세요."
  fi
  echo "  같은 명령이지만 이번에는 이어서 나머지를 설치합니다."
  echo
  printf '      %scd "%s"%s\n' "$C" "$SRC" "$N"
  printf '      %ssudo bash install.sh%s\n' "$C" "$N"
  echo
  echo "  (잊어도 괜찮습니다. 설치가 끝날 때까지 터미널을 열거나 접속하면 이 안내가 다시 나옵니다.)"
  line
  if [[ -r /dev/tty ]] && { : < /dev/tty; } 2>/dev/null; then
    printf '  지금 재부팅할까요? [Y/n] '
    read -r ans < /dev/tty || ans="n"
    if [[ -z "$ans" || "$ans" =~ ^[Yy] ]]; then
      echo "  재부팅합니다…"
      sleep 2
      systemctl reboot
    else
      echo "  준비되면 'sudo reboot' 로 재부팅하세요."
    fi
  fi
  exit 0
fi

run_step "Docker"                      step_docker
run_step "방화벽 (80·443)"             step_firewall
run_step "채점 엔진 Judge0 (처음엔 오래 걸립니다)" step_judge0
run_step "채점 시험"                   step_judge_test
run_step "웹 서버 nginx · PHP ${PHP_VER}" step_web_pkg
run_step "소스 배치"                   step_source
run_step "nginx 설정"                  step_nginx
run_step "도메인 · SSL (https)"        step_ssl
run_step "채점 워커"                   step_worker
run_step "마무리 확인"                 step_final

remind_remove
touch "$STATE_DIR/install.done"

printf '\n########## 설치 끝 %s ##########\n' "$(date '+%F %T')" >> "$LOG"

# 내부 IP(공유기 안)인지 공인 IP(클라우드 등)인지에 따라 안내가 다르다
is_private_ip() {
  [[ "$1" =~ ^10\. || "$1" =~ ^192\.168\. || "$1" =~ ^172\.(1[6-9]|2[0-9]|3[01])\. \
     || "$1" =~ ^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\. ]]
}

IP=$(hostname -I | awk '{print $1}')
DOM=$(primary_domain)
echo
line
printf '  %s%s설치가 끝났습니다.%s\n' "$G" "$B" "$N"
echo
echo "  브라우저에서 접속하세요."
if ssl_ready; then
  printf '      인터넷 어디서나 %shttps://%s%s\n' "$C" "$DOM" "$N"
fi
printf '      이 컴퓨터에서   %shttp://localhost%s\n' "$C" "$N"
if [[ -z "$IP" ]] || is_private_ip "$IP"; then
  [[ -n "$IP" ]] && printf '      같은 공유기에서 %shttp://%s%s\n' "$C" "$IP" "$N"
  echo
  echo "  ● 공유기 설정에서 이 컴퓨터의 IP(${IP:-확인 필요})를 고정 할당하세요."
  echo "    재부팅할 때 주소가 바뀌면 포트포워딩이 엉뚱한 기기를 가리킵니다."
  if ssl_ready; then
    echo "  ● 공유기 안에서 https://$DOM 이 열리지 않으면, 공유기가 바깥 주소로"
    echo "    되돌아 들어오는 것을 지원하지 않는 것입니다. 안에서는 IP 주소로 접속하세요."
  fi
elif ! ssl_ready; then
  printf '      인터넷 어디서나 %shttp://%s%s\n' "$C" "$IP" "$N"
  echo
  echo "  ● 접속이 안 되면 서버 관리 화면(클라우드 콘솔)의 방화벽에서 80·443번이 열려 있는지 보세요."
  echo "  ● 도메인과 SSL(https)을 붙이기 전에는 비밀번호가 암호화되지 않고 오갑니다."
  echo "    그 전에는 시험용 계정만 쓰세요."
fi
if ssl_ready; then
  echo "  ● https 인증서는 우분투가 알아서 갱신합니다."
elif [[ -s "$STATE_DIR/ssl_error" ]]; then
  echo
  printf '  %s%s※ %s 의 https(SSL)를 붙이지 못했습니다. 사이트는 http 로 동작합니다.%s\n' "$Y" "$B" "$DOM" "$N"
  sed 's/^/     /' "$STATE_DIR/ssl_error"
  echo "     원인을 고친 뒤 같은 명령을 다시 실행하세요 (도메인은 기억해 두었습니다)."
  printf '         %scd "%s"%s\n' "$C" "$SRC" "$N"
  printf '         %ssudo bash install.sh%s\n' "$C" "$N"
else
  echo "  ● 도메인과 https 를 붙이려면 (도메인을 이 서버에 연결한 뒤):"
  printf '         %ssudo bash install.sh --domain 도메인 --email 메일%s\n' "$C" "$N"
fi
echo "  ● 관리자(admin) 비밀번호 정하기 — 처음 한 번, 그리고 잊었을 때:"
printf '         %scd /var/www/html && sudo -u www-data php reset-admin.php%s\n' "$C" "$N"
echo "  ● 새 버전으로 바꿀 때도 새 소스 폴더에서 같은 명령을 실행하면 됩니다."
echo "    설정·업로드 파일·DB 는 그대로 유지됩니다."
echo "  ● 기록: $LOG"
line
echo
