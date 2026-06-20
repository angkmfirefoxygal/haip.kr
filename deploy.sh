#!/bin/bash
# EC2에서 실행: bash deploy.sha
set -e

cd /var/www/haip

echo "코드 가져오는 중..."
sudo git pull

echo "Nginx 설정 확인 중..."
sudo nginx -t

echo "Nginx 재시작 중..."
sudo systemctl reload nginx

echo "배포 완료."
