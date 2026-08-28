#!/usr/bin/env python3
"""배포용 빌드 — 주석을 제거한 HTML 을 dist/ 에 만든다.

웹 루트를 dist/ 로 두면 .git/, CLAUDE.md, deploy.sh, nginx/ 가
아예 서빙 대상 밖에 있게 되므로, 차단 규칙에 기대지 않아도 된다.

사용: python tools/build.py
"""
import os, re, shutil, subprocess, sys

# tools/ 안에 있으므로 프로젝트 루트는 한 단계 위다
SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(SRC, 'dist')

# 루트 + insight/ 하위까지 훑는다.
SKIP = {'dist', 'docs', 'tools', 'partials', '.git', '.wrangler', '.cf-dist'}

# 검색엔진 소유확인 파일 — 네이버 서치어드바이저와 구글 서치콘솔이 발급하는
# naver<해시>.html, google<해시>.html 같은 파일이다. 겉모습은 HTML 이지만
# 페이지가 아니다. 발급된 내용이 한 바이트라도 달라지면 확인이 실패하므로
# 주석 제거와 partials 동기화 대상에서 빼고 원본을 그대로 dist 로 옮긴다.
# 사이트맵 검사에서도 빠진다 (색인 대상이 아니다).
VERIFY = re.compile(
    r'^(naver[0-9a-z]{8,}\.html|google[0-9a-z]{8,}\.html'
    r'|BingSiteAuth\.xml|yandex_[0-9a-z]+\.html)$', re.I)


def _pages():
    out = []
    for root, dirs, files in os.walk(SRC):
        dirs[:] = [d for d in dirs if d not in SKIP and not d.startswith(('_bk_', '.'))]
        for f in files:
            if f.endswith('.html') and not VERIFY.match(f):
                out.append(os.path.relpath(os.path.join(root, f), SRC).replace(os.sep, '/'))
    return sorted(out)


def _verify_files():
    """루트에 놓인 소유확인 파일 목록."""
    return sorted(f for f in os.listdir(SRC)
                  if os.path.isfile(os.path.join(SRC, f)) and VERIFY.match(f))


PAGES = _pages()


def strip_js(code):
    """JS 주석 제거. 문자열, 정규식 리터럴 안의 슬래시를 건드리지 않도록
    한 글자씩 훑는다."""
    out = []
    i, n = 0, len(code)
    quote = None          # 현재 열려 있는 따옴표
    while i < n:
        c = code[i]
        nxt = code[i + 1] if i + 1 < n else ''
        if quote:
            out.append(c)
            if c == '\\':                     # 이스케이프는 다음 글자까지 통째로
                if i + 1 < n:
                    out.append(nxt)
                    i += 1
            elif c == quote:
                quote = None
            i += 1
            continue
        if c in '"\'`':
            quote = c
            out.append(c)
            i += 1
            continue
        if c == '/' and nxt == '/':           # 줄 주석
            while i < n and code[i] != '\n':
                i += 1
            continue
        if c == '/' and nxt == '*':           # 블록 주석
            end = code.find('*/', i + 2)
            i = n if end == -1 else end + 2
            continue
        out.append(c)
        i += 1
    return ''.join(out)


def strip_css(code):
    """CSS 블록 주석 제거. 문자열 안의 /* 는 남긴다."""
    out = []
    i, n = 0, len(code)
    quote = None
    while i < n:
        c = code[i]
        nxt = code[i + 1] if i + 1 < n else ''
        if quote:
            out.append(c)
            if c == '\\' and i + 1 < n:
                out.append(nxt)
                i += 1
            elif c == quote:
                quote = None
            i += 1
            continue
        if c in '"\'':
            quote = c
            out.append(c)
            i += 1
            continue
        if c == '/' and nxt == '*':
            end = code.find('*/', i + 2)
            i = n if end == -1 else end + 2
            continue
        out.append(c)
        i += 1
    return ''.join(out)


def tidy(text):
    """주석을 걷어낸 자리에 남는 빈 줄, 후행 공백 정리."""
    text = re.sub(r'[ \t]+(\r?\n)', r'\1', text)
    text = re.sub(r'(\r?\n)[ \t]*(\r?\n)[ \t]*(\r?\n)+', r'\1\2', text)
    return text


def build_page(html):
    # <style> / <script> 안쪽을 각각 처리한 뒤 HTML 주석을 제거한다.
    def do_style(m):
        return m.group(1) + strip_css(m.group(2)) + m.group(3)

    def do_script(m):
        return m.group(1) + strip_js(m.group(2)) + m.group(3)

    html = re.sub(r'(<style[^>]*>)(.*?)(</style>)', do_style, html, flags=re.S)
    # ld+json 은 건드리지 않는다. JSON 에는 주석이 없고, 잘못 훑으면 데이터가 깨진다.
    html = re.sub(r'(<script(?![^>]*\bsrc=)(?![^>]*ld\+json)[^>]*>)(.*?)(</script>)',
                  do_script, html, flags=re.S)
    html = re.sub(r'<!--(?!\[if).*?-->', '', html, flags=re.S)
    return tidy(html)


ACTIVE = {'index': 'index', 'services': 'services',
          'portfolio': 'portfolio', 'insight': 'insight'}
PARTIALS = ('nav', 'footer', 'schema', 'insight-side', 'insight-crumb', 'pdfgate')

SITE = 'https://haip.kr/'
# 사이트맵에 넣지 않는 페이지 — noindex 라서 넣으면 서치콘솔이 경고를 낸다
NO_INDEX = {'404.html'}


DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def _doc_dates():
    """각 문서 JSON-LD 의 dateModified {경로: 'YYYY-MM-DD'}.

    이게 1순위다. git 커밋일은 CSS 토큰 정리처럼 내용과 무관한 커밋에도 움직이는데,
    Google 은 lastmod 를 '의미 있는 변경' 기준으로 보길 권한다. 문서에 손으로 적은
    dateModified 가 곧 그 판단이므로 그대로 옮긴다."""
    pat = re.compile(r'"dateModified"\s*:\s*"([^"]+)"')
    out, bad = {}, []
    for name in PAGES:
        with open(os.path.join(SRC, name), encoding='utf-8') as f:
            m = pat.search(f.read())
        if not m:
            continue
        # ISO 날짜 뒤에 시각이 붙어 있어도 날짜만 쓴다 (sitemap 은 날짜로 충분)
        day = m.group(1)[:10]
        if DATE.match(day):
            out[name] = day
        else:
            bad.append('%s (%s)' % (name, m.group(1)))
    return out, bad


def _git_dates():
    """추적 중인 파일의 최종 커밋일 {경로: 'YYYY-MM-DD'}.
    dateModified 가 없는 페이지(홈, 서비스, 인사이트 허브, 문의)의 대체값이다.
    git 이 없거나 저장소가 아니면 빈 dict 를 돌려준다."""
    try:
        r = subprocess.run(['git', '-C', SRC, 'log', '--date=short',
                            '--pretty=format:@%cd', '--name-only'],
                           capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return {}
    if r.returncode != 0:
        return {}
    dates, cur = {}, None
    for line in r.stdout.splitlines():
        if line.startswith('@'):
            cur = line[1:]
        elif line and cur:
            # git log 는 최신순이므로 처음 본 날짜가 그 파일의 최종 수정일이다
            dates.setdefault(line, cur)
    return dates


def build_sitemap(xml):
    """<lastmod> 를 다시 쓰고, URL 목록이 실제 페이지와 맞는지 검사한다.
    (xml, 오류목록) 을 돌려준다.

    날짜 출처는 순서대로: 문서의 dateModified → git 최종 커밋일 → 소스에 적힌 수기 값.
    손으로 맞추면 반드시 어긋난다 — 문서를 고쳐 놓고 lastmod 를 그대로 두면
    크롤러는 '안 바뀐 페이지'로 보고 재방문을 미룬다. 그래서 빌드가 계산한다."""
    docs, bad_fmt = _doc_dates()
    git = _git_dates()
    seen, from_git, kept = [], [], []

    def fix(m):
        block = m.group(0)
        loc = re.search(r'<loc>\s*([^<\s]+)\s*</loc>', block)
        if not loc:
            return block
        path = loc.group(1)[len(SITE):] if loc.group(1).startswith(SITE) else loc.group(1)
        path = path or 'index.html'
        seen.append(path)
        day = docs.get(path)
        if not day:
            day = git.get(path)
            if day:
                from_git.append(path)
            else:
                kept.append(path)
                return block
        return re.sub(r'<lastmod>[^<]*</lastmod>', '<lastmod>%s</lastmod>' % day, block)

    xml = re.sub(r'<url>.*?</url>', fix, xml, flags=re.S)

    errs = []
    want = set(PAGES) - NO_INDEX
    got = set(seen)
    if len(seen) != len(got):
        dup = sorted({p for p in seen if seen.count(p) > 1})
        errs.append('sitemap.xml 에 중복 URL -> %s' % ', '.join(dup))
    for p in sorted(want - got):
        errs.append('sitemap.xml 에 빠진 페이지 -> %s' % p)
    for p in sorted(got - want):
        errs.append('sitemap.xml 에 없는 페이지 URL -> %s' % p)
    for b in bad_fmt:
        errs.append('dateModified 형식이 YYYY-MM-DD 가 아닙니다 -> %s' % b)

    if from_git:
        print('  %-24s dateModified 없음 → git 커밋일 사용: %s'
              % ('', ', '.join(sorted(set(from_git)))))
    if kept:
        # 새로 만들어 아직 커밋하지 않은 파일이면 정상이다
        print('  %-24s 날짜 출처 없음 → 수기 값 유지: %s'
              % ('', ', '.join(sorted(set(kept)))))
    return xml, errs


def rebase(html, depth):
    """루트 기준 상대경로를 depth 단 아래에서도 맞게 고친다.
    insight/guide/x.html 은 depth 2 이므로 ../../assets/... 가 된다."""
    if not depth:
        return html
    up = '../' * depth
    return re.sub(r'(href|src)="(?!https?:|//|#|mailto:|tel:|data:|\.\./)([^"/][^"]*)"',
                  lambda m: '%s="%s%s"' % (m.group(1), up, m.group(2)), html)


def render_partial(name, page, depth=0, section=None):
    """partials/<name>.html 을 페이지에 맞게 렌더. nav 는 현재 메뉴에 is-active 를 붙인다."""
    with open(os.path.join(SRC, 'partials', name + '.html'), encoding='utf-8') as f:
        html = f.read().strip()
    if name == 'nav':
        key = ACTIVE.get(page)
        if key:
            html = html.replace('class="nav-link" data-nav="%s"' % key,
                                'class="nav-link is-active" data-nav="%s"' % key)
    if name == 'insight-crumb':
        if section:
            # 하위 문서는 위치가 정적으로 확정된다 — 해당 섹션만 남기고 나머지는 지운다
            html = html.replace('<span class="crumb-sec" hidden>', '<span class="crumb-sec">')
            for k in ('guide', 'case', 'glossary'):
                if k == section:
                    html = html.replace(' data-crumb="%s" hidden>' % k,
                                        ' data-crumb="%s" aria-current="page">' % k)
                else:
                    html = re.sub(r'\s*<a [^>]*data-crumb="%s"[^>]*>.*?</a>' % k, '', html)
        # 허브(section 없음)는 해시로 뷰가 바뀌므로 감춘 채로 두고
        # js/insight.js 의 라우터가 현재 섹션을 켠다
    if name == 'insight-side' and section:
        # 현재 보고 있는 섹션을 표시한다 (문서 간 이동 편의 + 내부 링크 확보)
        html = html.replace('data-side="%s"' % section,
                            'data-side="%s" aria-current="page"' % section)
    return rebase(html, depth)


def sync_partials(write):
    """소스 HTML 의 <!-- @nav --> 구역을 partials 내용으로 맞춘다.
    write=False 면 어긋난 파일 목록만 돌려준다 (빌드 시 검사용).

    partials 를 원본으로 두고 소스에 써 넣는 방식이다. 소스 HTML 이 그대로 완결된
    문서라서 file:// 로 바로 열어볼 수 있고, 동시에 nav/footer 의 출처는 한 곳이다."""
    drift = []
    for name in sorted(PAGES):
        depth = name.count('/')
        # insight/guide/x.html 같은 하위 문서는 nav 에서 '인사이트'를 활성으로 둔다
        page = name.split('/')[0] if depth else name[:-5]
        path = os.path.join(SRC, name)
        with open(path, encoding='utf-8') as f:
            s = f.read()
        out = s
        for part in PARTIALS:
            pat = re.compile(r'(<!-- @%s -->\n)(.*?)(\n<!-- /@%s -->)' % (part, part), re.S)
            m = pat.search(out)
            if not m:
                continue
            # insight/guide/x.html → 'guide'. 허브(insight.html)는 섹션 없음
            sec = name.split('/')[1] if depth >= 2 else None
            want = render_partial(part, page, depth, sec)
            if m.group(2) != want:
                out = out[:m.start(2)] + want + out[m.end(2):]
        if out != s:
            drift.append(name)
            if write:
                with open(path, 'w', encoding='utf-8', newline='\n') as f:
                    f.write(out)
    return drift


def main():
    if '--sync' in sys.argv:
        changed = sync_partials(write=True)
        print('partials 반영: ' + (', '.join(changed) if changed else '변경 없음'))
        return 0

    drift = sync_partials(write=False)
    if drift:
        print('오류: partials/ 와 소스 HTML 이 다릅니다 -> %s' % ', '.join(drift), file=sys.stderr)
        print('      python build.py --sync 로 맞추세요.', file=sys.stderr)
        return 1

    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST)

    before = after = 0
    for name in sorted(PAGES):
        src = os.path.join(SRC, name)
        with open(src, encoding='utf-8') as f:
            raw = f.read()
        out = build_page(raw)
        dst = os.path.join(DIST, name)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, 'w', encoding='utf-8', newline='\n') as f:
            f.write(out)
        before += len(raw.encode('utf-8'))
        after += len(out.encode('utf-8'))
        print('  %-24s %7.1fKB -> %7.1fKB' % (
            name, len(raw.encode()) / 1024, len(out.encode()) / 1024))

    # css/, js/ 도 주석을 제거해 dist 로 옮긴다
    for sub, fn in (('css', strip_css), ('js', strip_js)):
        srcdir = os.path.join(SRC, sub)
        if not os.path.isdir(srcdir):
            continue
        os.makedirs(os.path.join(DIST, sub), exist_ok=True)
        for name in sorted(os.listdir(srcdir)):
            if not name.endswith('.' + ('css' if sub == 'css' else 'js')):
                continue
            with open(os.path.join(srcdir, name), encoding='utf-8') as f:
                raw = f.read()
            out = tidy(fn(raw))
            with open(os.path.join(DIST, sub, name), 'w',
                      encoding='utf-8', newline='\n') as f:
                f.write(out)
            before += len(raw.encode('utf-8'))
            after += len(out.encode('utf-8'))
            print('  %-24s %7.1fKB -> %7.1fKB' % (
                sub + '/' + name, len(raw.encode()) / 1024, len(out.encode()) / 1024))

    # robots.txt, sitemap.xml, llms.txt 는 웹 루트에 그대로 있어야 한다.
    # dist 로 복사하지 않으면 배포 직후 /robots.txt 가 404 가 되고
    # 사이트맵을 제출할 수 없어 색인 작업 전체가 막힌다.
    sitemap_errs = []
    for name in ('robots.txt', 'sitemap.xml', 'llms.txt'):
        src = os.path.join(SRC, name)
        if not os.path.exists(src):
            continue
        if name == 'sitemap.xml':
            with open(src, encoding='utf-8') as f:
                xml, sitemap_errs = build_sitemap(f.read())
            with open(os.path.join(DIST, name), 'w',
                      encoding='utf-8', newline='\n') as f:
                f.write(xml)
            print('  %-24s lastmod 갱신 (%d URL)' % (name, xml.count('<loc>')))
        else:
            shutil.copy2(src, os.path.join(DIST, name))
            print('  %-24s 그대로 복사' % name)

    for name in _verify_files():
        shutil.copy2(os.path.join(SRC, name), os.path.join(DIST, name))
        print('  %-24s 소유확인 파일, 원본 그대로 복사' % name)

    # 남은 주석이 없는지 확인
    # 검사 대상은 주석을 걷어낸 html/css/js 뿐이다. robots.txt 의 `Disallow: /*?q=`
    # 처럼 txt·xml 에는 `/*` 가 정상적으로 들어갈 수 있다.
    leftover = []
    for root, _dirs, files in os.walk(DIST):
        for name in files:
            if not name.endswith(('.html', '.css', '.js')):
                continue
            path = os.path.join(root, name)
            with open(path, encoding='utf-8') as f:
                s = f.read()
            if '<!--' in s or '/*' in s:
                leftover.append(os.path.relpath(path, DIST))
    print('\n  합계 %.1fKB -> %.1fKB (%.0f%% 감소)' % (
        before / 1024, after / 1024, (1 - after / before) * 100))
    if leftover:
        print('  경고: 주석이 남은 파일 ->', leftover)
        return 1
    print('  주석 잔여 없음')
    if sitemap_errs:
        for e in sitemap_errs:
            print('  오류: ' + e, file=sys.stderr)
        return 1
    print('  sitemap 정합성 확인 (%d 페이지)' % len(set(PAGES) - NO_INDEX))
    return 0


if __name__ == '__main__':
    sys.exit(main())
