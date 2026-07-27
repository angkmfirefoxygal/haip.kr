#!/bin/bash
# EC2에서 실행: bash deploy.sh
#
# v2 브랜치를 웹 루트에 그대로 반영한다.
# (v1 과 달리 외부 css/js 파일이 없고 모든 스타일·스크립트가 HTML 안에 있어
#  캐시 버스팅 치환 단계가 필요 없다.)
set -e

BRANCH="${1:-v2}"
cd /var/www/haip

echo "코드 가져오는 중... (브랜치: $BRANCH)"
sudo git fetch origin "$BRANCH"
sudo git checkout "$BRANCH"
sudo git reset --hard "origin/$BRANCH"
sudo git clean -fd            # 이전 버전에 있던 css/ js/ 등 잔여 파일 제거

echo "현재 커밋: $(git rev-parse --short HEAD)"

echo "Nginx 설정 확인 중..."
sudo nginx -t

echo "Nginx 재시작 중..."
sudo systemctl reload nginx

echo "배포 완료."
