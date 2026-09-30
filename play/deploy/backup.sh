#!/usr/bin/env bash
# KAIT-PLAY 자료 백업 (문제 은행 · 게임 기록 · 교사 비밀번호 · 설정)
#   bash /opt/kait-play/deploy/backup.sh
#   → /opt/kait-play/data/backup/game-날짜_시각.db (최근 30개만)
# 매일 새벽 3시에 자동으로 하려면 (root 에서 한 번):
#   (crontab -l 2>/dev/null; echo '0 3 * * * bash /opt/kait-play/deploy/backup.sh >/dev/null 2>&1') | crontab -
set -euo pipefail
docker exec kait-play node scripts/backup.js
