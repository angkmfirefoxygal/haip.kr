#!/bin/bash
# EC2에서 실행: bash deploy.sh
#
# 저장소를 받아 dist/ 를 다시 만들고 nginx 를 리로드한다.
# nginx 의 웹 루트는 /var/www/haip/dist 이므로, 저장소의 내부 파일
# (.git/ · CLAUDE.md · deploy.sh · nginx/)은 애초에 서빙 대상이 아니다.
set -e

BRANCH="${1:-v2}"
cd /var/www/haip

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 가 없습니다. 먼저 설치하세요:  sudo yum install -y python3" >&2
  exit 1
fi

echo "코드 가져오는 중... (브랜치: $BRANCH)"
sudo git fetch origin "$BRANCH"
sudo git checkout "$BRANCH"
sudo git reset --hard "origin/$BRANCH"
sudo git clean -fd --exclude=dist    # 구버전 잔여 파일 제거

echo "현재 커밋: $(git rev-parse --short HEAD)"

echo "빌드 중 (주석 제거)..."
sudo python3 build.py

echo "Nginx 설정 확인 중..."
sudo nginx -t

echo "Nginx 재시작 중..."
sudo systemctl reload nginx

echo "배포 완료."
