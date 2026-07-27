#!/usr/bin/env python3
"""배포용 빌드 — 주석을 제거한 HTML 을 dist/ 에 만든다.

웹 루트를 dist/ 로 두면 .git/ · CLAUDE.md · deploy.sh · nginx/ 가
아예 서빙 대상 밖에 있게 되므로, 차단 규칙에 기대지 않아도 된다.

사용: python build.py
"""
import os, re, shutil, sys

SRC = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(SRC, 'dist')

PAGES = [f for f in os.listdir(SRC) if f.endswith('.html')]


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
    html = re.sub(r'(<script(?![^>]*\bsrc=)[^>]*>)(.*?)(</script>)', do_script, html, flags=re.S)
    html = re.sub(r'<!--(?!\[if).*?-->', '', html, flags=re.S)
    return tidy(html)


def main():
    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST)

    before = after = 0
    for name in sorted(PAGES):
        src = os.path.join(SRC, name)
        with open(src, encoding='utf-8') as f:
            raw = f.read()
        out = build_page(raw)
        with open(os.path.join(DIST, name), 'w', encoding='utf-8', newline='\n') as f:
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
