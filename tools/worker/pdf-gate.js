/* 회사소개서 다운로드 게이트 — Cloudflare Worker
 *
 * 왜 Worker 인가:
 * 예전 게이트는 브라우저에서 Formspree 로 바로 POST 했다. action URL 이 HTML 에
 * 그대로 노출돼 있어서, 봇은 모달·검증을 전부 건너뛰고 Formspree 엔드포인트에
 * 직접 POST 할 수 있었다 — 가짜 리드가 쌓인 경로가 이것이다.
 * 캡차를 프론트에만 붙여도 이 경로는 그대로 열려 있다. 토큰을 서버에서 검증해야
 * 실효가 생기는데 정적 사이트에는 서버가 없어서, Cloudflare 앞단에 이 Worker 를 둔다.
 *
 * 이 Worker 가 하는 일:
 *   1. 같은 출처(haip.kr)에서 온 요청인지 확인
 *   2. 허니팟(_gotcha) 검사 — 사람 눈에 안 보이는 칸을 채웠으면 봇이다
 *   3. Turnstile 토큰을 Cloudflare 에 서버 대 서버로 검증
 *   4. 통과한 리드만 Formspree 로 전달 (엔드포인트는 시크릿 — HTML 에 없다)
 *   5. 성공했을 때만 PDF 를 응답 본문으로 흘려보낸다
 *
 * PDF 는 /assets/ 밖(/_gated/)으로 옮겼고, 오리진 nginx 는 공유 시크릿 헤더가
 * 붙은 요청에만 내준다. 즉 이 Worker 를 거치지 않고는 파일에 닿을 수 없다.
 *
 * 배포: tools/worker/README.md 참고 (wrangler deploy + secret put 3개)
 */

const SITE = 'https://haip.kr';
const GATE_PATH = '/api/pdf-gate';
const PDF_URL = SITE + '/_gated/haip-company-profile.pdf';
const FILENAME = '하입(HaiP) 회사소개서.pdf';
const SUBJECT = '[HaiP] 회사소개서 다운로드';

/* 폼의 name 속성과 같아야 한다 (partials/pdfgate.html). Formspree 메일에
   그대로 필드명으로 찍히므로 한글을 유지한다. */
const REQUIRED = ['이메일', '성함', '기업명', '전화번호'];
const MAX_LEN = 200;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FAIL_SEND =
  '전송에 실패했습니다. 잠시 후 다시 시도하시거나 haip.office@gmail.com 으로 보내주세요.';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': SITE,
    },
  });
}

/* 요청이 우리 사이트에서 출발했는지. 이것만으로 봇을 막지는 못하지만
   (헤더는 위조된다) 아무 생각 없이 긁는 스크립트는 여기서 걸러진다. */
function sameOrigin(req) {
  const origin = req.headers.get('Origin');
  if (origin) return origin === SITE;
  const ref = req.headers.get('Referer') || '';
  return ref === SITE || ref.startsWith(SITE + '/');
}

async function verifyTurnstile(token, ip, secret) {
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  let res;
  try {
    res = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      { method: 'POST', body }
    );
  } catch (e) {
    return false;
  }
  if (!res.ok) return false;
  const data = await res.json();
  return data.success === true;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname !== GATE_PATH) {
      return json(404, { error: '없는 주소입니다.' });
    }
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': SITE,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    if (req.method !== 'POST') {
      return json(405, { error: 'POST 만 받습니다.' });
    }
    if (!sameOrigin(req)) {
      return json(403, { error: '잘못된 요청입니다.' });
    }

    let form;
    try {
      form = await req.formData();
    } catch (e) {
      return json(400, { error: '요청 형식이 올바르지 않습니다.' });
    }

    const str = (k) => (form.get(k) || '').toString().trim();

    /* 허니팟 — CSS 로 화면 밖에 치워둔 칸이라 사람은 채울 수 없다.
       봇은 폼의 모든 input 을 채우는 경향이 있어서 여기서 잡힌다. */
    if (str('_gotcha')) {
      return json(403, { error: '잘못된 요청입니다.' });
    }

    const ip = req.headers.get('CF-Connecting-IP') || '';
    const token = str('cf-turnstile-response');
    if (!token || !(await verifyTurnstile(token, ip, env.TURNSTILE_SECRET))) {
      return json(403, {
        error: '자동 입력 방지 확인에 실패했습니다. 잠시 후 다시 시도해 주세요.',
      });
    }

    const lead = {};
    for (const key of REQUIRED) {
      const v = str(key);
      if (!v) return json(400, { error: '필수 항목을 모두 입력해 주세요.' });
      if (v.length > MAX_LEN) return json(400, { error: '입력값이 너무 깁니다.' });
      lead[key] = v;
    }
    if (!EMAIL.test(lead['이메일'])) {
      return json(400, { error: '이메일 형식을 확인해 주세요.' });
    }
    if (str('개인정보동의') !== '동의') {
      return json(400, { error: '정보 수집 및 제공 동의가 필요합니다.' });
    }
    lead['개인정보동의'] = '동의';
    lead['접속IP'] = ip;
    lead['_subject'] = SUBJECT;

    /* Formspree 는 브라우저가 아니라 여기서 호출한다. 엔드포인트가 시크릿이라
       HTML 어디에도 없으므로 봇이 직접 POST 할 대상 자체가 사라진다. */
    let sent;
    try {
      sent = await fetch(env.FORMSPREE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Referer: SITE + '/contact.html',
        },
        body: JSON.stringify(lead),
      });
    } catch (e) {
      return json(502, { error: FAIL_SEND });
    }
    if (!sent.ok) {
      return json(502, { error: FAIL_SEND });
    }

    /* 오리진은 이 헤더가 없으면 404 를 준다 (tools/nginx/haip.conf 의 /_gated/).
       본문은 버퍼링하지 않고 그대로 흘려보낸다 — 11MB 를 Worker 메모리에 올릴 이유가 없다. */
    let pdf;
    try {
      pdf = await fetch(PDF_URL, {
        headers: { 'X-HaiP-Gate': env.ORIGIN_GATE_SECRET },
        cf: { cacheEverything: false },
      });
    } catch (e) {
      return json(502, { error: FAIL_SEND });
    }
    if (!pdf.ok) {
      return json(502, { error: '문서를 불러오지 못했습니다. ' + FAIL_SEND });
    }

    const headers = new Headers({
      'Content-Type': 'application/pdf',
      /* RFC 5987 — 한글 파일명은 filename* 로만 안전하게 전달된다 */
      'Content-Disposition':
        "attachment; filename*=UTF-8''" + encodeURIComponent(FILENAME),
      'Cache-Control': 'private, no-store',
      'Access-Control-Allow-Origin': SITE,
    });
    /* 있으면 넘겨준다 — 브라우저가 다운로드 진행률을 표시할 수 있다.
       오리진이 청크 전송으로 주면 없을 수도 있어서 조건부로 붙인다. */
    const len = pdf.headers.get('Content-Length');
    if (len) headers.set('Content-Length', len);

    return new Response(pdf.body, { status: 200, headers });
  },
};
