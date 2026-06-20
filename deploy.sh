#!/bin/bash
# EC2에서 실행: bash deploy.sh
set -e

cd /var/www/haip

echo "코드 가져오는 중..."
sudo git pull

# CSS/JS 캐시 버스팅 — git hash로 버전 자동 갱신
VER=$(git rev-parse --short HEAD)
for f in index.html services.html contact.html about.html portfolio.html; do
  [ -f "$f" ] && sudo sed -i "s/style\.css?v=[^\"']*/style.css?v=$VER/g; s/main\.js?v=[^\"']*/main.js?v=$VER/g" "$f"
done
echo "캐시 버전: $VER"

echo "Nginx 설정 확인 중..."
sudo nginx -t

echo "Nginx 재시작 중..."
sudo systemctl reload nginx

echo "배포 완료."
