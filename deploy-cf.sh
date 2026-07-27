#!/bin/bash
# Cloudflare Pages 배포: bash deploy-cf.sh
#
# wrangler pages deploy 는 .gitignore / .assetsignore 를 보지 않고
# 지정 디렉터리의 모든 파일을 업로드한다. 그래서 레포 루트를 그대로 올리면
# nginx/, deploy.sh, CLAUDE.md, design/ 같은 내부 파일까지 웹에 공개된다.
# 웹에 나갈 파일만 별도 디렉터리에 모아서 그것만 올린다.
set -e

PROJECT="haip-kr"
BRANCH="${1:-v2}"
OUT=".cf-dist"

rm -rf "$OUT" && mkdir -p "$OUT"

# 웹에 공개할 것만 복사
cp ./*.html            "$OUT"/
cp _headers _redirects "$OUT"/
cp -r assets           "$OUT"/

echo "업로드 대상:"
find "$OUT" -type f | sed 's|^|  |'

wrangler pages deploy "$OUT" --project-name "$PROJECT" --branch "$BRANCH"

rm -rf "$OUT"
echo "배포 완료."
