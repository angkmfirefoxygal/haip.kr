#!/bin/bash
# EC2에서 실행: bash tools/deploy.sh
#
# 저장소를 받아 dist/ 를 다시 만들고 nginx 를 리로드한다.
# nginx 의 웹 루트는 /var/www/haip/dist 이므로, 저장소의 내부 파일
# (.git/, CLAUDE.md, deploy.sh, nginx/)은 애초에 서빙 대상이 아니다.
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
sudo python3 tools/build.py

echo "Nginx 설정 확인 중..."
sudo nginx -t

echo "Nginx 재시작 중..."
sudo systemctl reload nginx

# HTML 은 Cloudflare 엣지에 s-maxage=600 으로 캐시된다 (CLAUDE.md 의 CDN 절 참고).
# 퍼지 없이 두면 배포 후 최대 10분간 옛 HTML 이 보일 수 있어 배포마다 지운다.
# CF_API_TOKEN / CF_ZONE_ID 는 EC2 의 ~/.bashrc 등에 export 해둔다 — 레포에는 두지 않는다.
if [ -n "$CF_API_TOKEN" ] && [ -n "$CF_ZONE_ID" ]; then
  echo "Cloudflare 캐시 퍼지 중..."
  curl -s -o /dev/null -w "퍼지 응답 코드: %{http_code}\n" -X POST \
    "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data '{"purge_everything":true}'
else
  echo "CF_API_TOKEN / CF_ZONE_ID 미설정 — Cloudflare 캐시 퍼지를 건너뜁니다."
fi

echo "배포 완료."
