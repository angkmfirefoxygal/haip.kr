#!/usr/bin/env python3
"""배포용 빌드 — 주석을 제거한 HTML 을 dist/ 에 만든다.

웹 루트를 dist/ 로 두면 .git/ · CLAUDE.md · deploy.sh · nginx/ 가
아예 서빙 대상 밖에 있게 되므로, 차단 규칙에 기대지 않아도 된다.

사용: python build.py
"""
import os, re, shutil, sys

SRC = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(SRC, 'dist')

# 루트 + insight/ 하위까지 훑는다.
SKIP = {'dist', 'design', 'nginx', 'partials', '.git', '.wrangler', '.cf-dist'}


def _pages():
    out = []
    for root, dirs, files in os.walk(SRC):
        dirs[:] = [d for d in dirs if d not in SKIP and not d.startswith(('_bk_', '.'))]
        for f in files:
            if f.endswith('.html'):
                out.append(os.path.relpath(os.path.join(root, f), SRC).replace(os.sep, '/'))
    return sorted(out)


PAGES = _pages()


def strip_js(code):
    """JS 주석 제거. 문자열·정규식 리터럴 안의 슬래시를 건드리지 않도록
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
    """주석을 걷어낸 자리에 남는 빈 줄·후행 공백 정리."""
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


ACTIVE = {'index': 'index', 'services': 'services', 'insight': 'insight'}
PARTIALS = ('nav', 'footer', 'schema')


def rebase(html, depth):
    """루트 기준 상대경로를 depth 단 아래에서도 맞게 고친다.
    insight/guide/x.html 은 depth 2 이므로 ../../assets/... 가 된다."""
    if not depth:
        return html
    up = '../' * depth
    return re.sub(r'(href|src)="(?!https?:|//|#|mailto:|tel:|data:|\.\./)([^"/][^"]*)"',
                  lambda m: '%s="%s%s"' % (m.group(1), up, m.group(2)), html)


def render_partial(name, page, depth=0):
    """partials/<name>.html 을 페이지에 맞게 렌더. nav 는 현재 메뉴에 is-active 를 붙인다."""
    with open(os.path.join(SRC, 'partials', name + '.html'), encoding='utf-8') as f:
        html = f.read().strip()
    if name == 'nav':
        key = ACTIVE.get(page)
        if key:
            html = html.replace('class="nav-link" data-nav="%s"' % key,
                                'class="nav-link is-active" data-nav="%s"' % key)
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
            want = render_partial(part, page, depth)
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

    # css/ · js/ 도 주석을 제거해 dist 로 옮긴다
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

    # 남은 주석이 없는지 확인
    leftover = []
    for root, _dirs, files in os.walk(DIST):
        for name in files:
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
    return 0


if __name__ == '__main__':
    sys.exit(main())
