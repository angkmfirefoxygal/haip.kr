# 회사소개서 게이트 Worker

`haip.kr/api/pdf-gate` 를 처리하는 Cloudflare Worker. 배포 스크립트(`deploy.sh`)와
무관하게 **로컬에서 wrangler 로 따로 배포**한다 — EC2 와 생명주기가 다르다.

## 왜 필요한가

예전 게이트는 브라우저에서 Formspree 로 바로 POST 했다. `action` URL 이 HTML 에
노출돼 있어 봇이 모달을 건너뛰고 엔드포인트에 직접 POST 할 수 있었고, PDF 도
`/assets/` 에 공개돼 있어 URL 만 알면 받아졌다. 캡차를 화면에만 붙여서는 둘 다 못 막는다.
토큰을 **서버에서** 검증해야 하는데 정적 사이트엔 서버가 없어서 앞단에 이 Worker 를 둔다.

```
브라우저 ──POST /api/pdf-gate──▶ Worker
                                  │ 1. Origin 확인
                                  │ 2. 허니팟(_gotcha)
                                  │ 3. Turnstile siteverify  ◀─ Cloudflare
                                  │ 4. 리드 전달             ──▶ Formspree
                                  │ 5. X-HaiP-Gate 헤더로    ──▶ nginx /_gated/
                                  ▼
                              PDF 본문 응답
```

## 최초 설정 (한 번만)

### 1. Turnstile 위젯 발급

Cloudflare 대시보드 → **Turnstile** → Add widget

| 항목 | 값 |
|------|-----|
| Widget name | `haip-pdf-gate` |
| Hostnames | `haip.kr` |
| Widget Mode | **Managed** (사람에겐 대부분 클릭조차 안 뜬다) |

발급되는 키 2개 중

- **Site Key** (공개) → `partials/pdfgate.html` 의 `data-sitekey="TURNSTILE_SITE_KEY"` 를 이 값으로 교체 후
  ```bash
  python3 tools/build.py --sync
  ```
  교체를 잊으면 빌드가 exit 1 로 막는다.
- **Secret Key** (비공개) → 아래 `TURNSTILE_SECRET` 로 넣는다. 레포에 커밋하지 않는다.

### 2. 오리진 공유 시크릿

Worker 와 nginx 가 맞춰 쓸 아무 문자열이나 만든다.

```bash
openssl rand -hex 32
```

- `tools/nginx/haip.conf` 의 `$http_x_haip_gate != "ORIGIN_GATE_SECRET"` 에서
  `ORIGIN_GATE_SECRET` 을 이 값으로 교체한다.
  **이 파일은 커밋되므로, 시크릿을 레포에 남기고 싶지 않으면 EC2 의
  `/etc/nginx/conf.d/haip.conf` 에서만 교체하고 레포에는 플레이스홀더를 둔다.**
  (레포 값은 그대로 두고 서버에서만 바꾸면, 다음에 `cp` 로 덮어쓸 때 다시 넣어야 한다 — 잊기 쉽다.)
- 같은 값을 아래 `ORIGIN_GATE_SECRET` 로 Worker 에 넣는다.

### 3. Worker 배포

```bash
cd tools/worker
wrangler login                       # 최초 1회
wrangler secret put TURNSTILE_SECRET      # 1번에서 받은 Secret Key
wrangler secret put FORMSPREE_ENDPOINT    # https://formspree.io/f/xdeooonz
wrangler secret put ORIGIN_GATE_SECRET    # 2번에서 만든 값
wrangler deploy
```

`wrangler.toml` 의 라우트(`haip.kr/api/*`)는 배포 시 자동으로 붙는다.
haip.kr 존이 이미 Cloudflare 에 있어야 한다.

### 4. 오리진 nginx 반영

```bash
ssh -i ~/Downloads/haip-home.pem ec2-user@13.221.115.180
sudo cp /var/www/haip/tools/nginx/haip.conf /etc/nginx/conf.d/haip.conf
sudo nginx -t && sudo systemctl reload nginx
```

### 5. Cloudflare 캐시 규칙

`/_gated/` 응답이 엣지에 캐시되면 헤더 검사를 건너뛴 요청에도 나갈 수 있다.
오리진이 `private, no-store` 를 보내므로 기본적으로는 캐시되지 않지만,
Standard 캐시 레벨이 `.pdf` 를 확장자로 잡으므로 Cache Rule 로 한 겹 더 막는다.

Caching → Cache Rules → Create rule
- 조건: `URI Path` `starts with` `/_gated/`
- 동작: **Bypass cache**

## 확인

```bash
# 1. PDF 직접 접근이 막혔는지 — 404 여야 한다
curl -sI https://haip.kr/_gated/haip-company-profile.pdf | head -1

# 2. 옛 주소는 문의 페이지로 301
curl -sI https://haip.kr/assets/haip-company-profile.pdf | head -2

# 3. 토큰 없는 POST 는 403
curl -s -X POST https://haip.kr/api/pdf-gate \
  -H 'Origin: https://haip.kr' -F '이메일=a@b.com' | head -1

# 4. 실제 다운로드는 브라우저에서 게이트를 통과해 확인
```

로그: `wrangler tail` (`tools/worker` 안에서).

## 알아둘 것

- **Formspree 로 가는 요청이 서버 대 서버 POST 로 바뀐다.** Formspree 가
  브라우저 밖 요청을 다르게 취급할 수 있으니 4번 항목(실제 다운로드)을 반드시
  한 번 통과시켜 메일이 들어오는지 확인할 것. 안 들어오면 Formspree 대시보드의
  도메인/CORS 설정을 확인한다.
- `contact.html` 의 일반 문의 폼(`xqeorrol`)은 아직 예전 방식 그대로다.
  거기도 스팸이 들어오면 같은 Worker 에 엔드포인트를 하나 더 붙이면 된다.
- Turnstile 스크립트는 게이트를 처음 열 때만 로드된다(`js/pdf-gate.js`).
  모달을 안 여는 방문자에게는 비용이 0 이다.
