#!/usr/bin/env python3
"""PDF 이미지 다운샘플링 — 텍스트 레이어를 보존한다.

회사소개서(assets/haip-company-profile.pdf) 처럼 디자인 툴에서 뽑은 PDF 를 줄일 때 쓴다.

ghostscript 를 쓰지 않는 이유:
    gs -sDEVICE=pdfwrite 는 렌더링은 완벽하지만 서브셋 폰트의 ToUnicode CMap 을
    망가뜨린다. 글리프는 제대로 그려져서 눈으로는 안 보이지만 추출하면
    CASS -> CAS, Haip -> Hai 처럼 깨진다. 문서 내 검색과 구글의 PDF 텍스트
    색인이 죽는다.

이 스크립트는 이미지 스트림만 교체한다. 폰트/텍스트/구조는 건드리지 않는다.

크기를 정하는 방식:
    픽셀 수에 일괄 상한을 두지 않는다. pdfplumber 로 각 이미지가 페이지에서
    실제로 차지하는 크기(pt)를 재서, 그 배치 크기의 --target 배로 리사이즈한다.
    디자인 툴 출력은 배치 대비 4~6 배 오버샘플링된 경우가 흔해서 실측 쪽이
    훨씬 많이 줄어든다.

의존성 (시스템 python 에는 없다. venv 를 쓸 것):
    python3 -m venv .venv && .venv/bin/pip install pikepdf pillow pdfplumber

사용법:
    .venv/bin/python tools/shrink_pdf.py assets/haip-company-profile.pdf out.pdf
    .venv/bin/python tools/shrink_pdf.py in.pdf out.pdf --target 2.0 --quality 85

교체 후에는 반드시 검증한다 (텍스트가 한 글자도 달라지면 안 된다):
    gs -sDEVICE=txtwrite -o a.txt in.pdf
    gs -sDEVICE=txtwrite -o b.txt out.pdf
    diff a.txt b.txt

contact.html 의 용량/페이지 표기도 같이 고칠 것.
"""
import argparse
import collections
import io
import logging
import sys
import warnings
from pathlib import Path

logging.disable(logging.WARNING)          # pdfplumber 가 뿜는 색공간 경고를 막는다
warnings.filterwarnings("ignore")

try:
    import pikepdf
    import pdfplumber
    from PIL import Image
except ImportError as e:
    sys.exit(f"의존성 없음: {e.name}\n  python3 -m venv .venv && "
             ".venv/bin/pip install pikepdf pillow pdfplumber")

MIN_SIDE = 200      # 이보다 작은 이미지는 아이콘이다 — 건드리지 않는다
KEEP_IF  = 0.92     # 재인코딩이 8% 넘게 못 줄이면 원본을 유지한다
FALLBACK = 1920     # 배치 크기를 못 잰 이미지(Form XObject 안에 중첩된 것)의 상한


def measure_placements(path):
    """이미지 오브젝트 번호 -> 페이지에서 차지하는 최대 크기 (pt)."""
    place = {}
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for im in page.images:
                oid = getattr(im.get("stream"), "objid", None)
                if oid is None:
                    continue
                w = abs(im["x1"] - im["x0"])
                h = abs(im["bottom"] - im["top"])
                if w and h:
                    pw, ph = place.get(oid, (0, 0))
                    place[oid] = (max(pw, w), max(ph, h))
    return place


def shrink(src, dst, target, quality, dry_run=False):
    place = measure_placements(src)
    pdf = pikepdf.open(src)
    stat = collections.Counter()
    before = after = 0

    for obj in pdf.objects:
        if not isinstance(obj, pikepdf.Stream):
            continue
        if str(obj.get("/Subtype")) != "/Image":
            continue
        if obj.get("/ImageMask"):
            stat["건너뜀:마스크"] += 1
            continue
        try:
            raw = obj.read_raw_bytes()
        except Exception:
            stat["건너뜀:읽기실패"] += 1
            continue

        before += len(raw)
        w, h = int(obj.Width), int(obj.Height)

        if max(w, h) < MIN_SIDE:
            after += len(raw); stat["건너뜀:작음"] += 1; continue
        try:
            im = pikepdf.PdfImage(obj).as_pil_image()
        except Exception:
            after += len(raw); stat["건너뜀:디코드실패"] += 1; continue
        if im.mode not in ("RGB", "L"):
            # CMYK 는 Adobe 반전 규약이 얽혀 있어 잘못 건드리면 색이 뒤집힌다
            after += len(raw); stat[f"건너뜀:{im.mode}"] += 1; continue

        placed = place.get(obj.objgen[0])
        if placed:
            tw, th = round(placed[0] * target), round(placed[1] * target)
        else:
            s = min(1.0, FALLBACK / max(w, h))
            tw, th = round(w * s), round(h * s)
            stat["배치정보없음"] += 1
        tw, th = min(w, max(1, tw)), min(h, max(1, th))

        if (tw, th) != (w, h):
            im = im.resize((tw, th), Image.LANCZOS)

        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=quality, optimize=True)
        new = buf.getvalue()

        if len(new) >= len(raw) * KEEP_IF:
            after += len(raw); stat["유지"] += 1; continue

        after += len(new); stat["교체"] += 1
        if dry_run:
            continue
        obj.write(new, filter=pikepdf.Name("/DCTDecode"))
        obj.Width, obj.Height = im.size
        obj.ColorSpace = pikepdf.Name("/DeviceRGB" if im.mode == "RGB" else "/DeviceGray")
        obj.BitsPerComponent = 8
        for k in ("/DecodeParms", "/Decode"):
            if k in obj:
                del obj[k]

    print(f"  이미지 스트림  {before / 1048576:.1f} MB -> {after / 1048576:.1f} MB")
    for k, v in sorted(stat.items()):
        print(f"    {k:<16} {v}")

    if dry_run:
        print("  (--dry-run: 파일을 쓰지 않았다)")
        return

    pdf.save(dst, compress_streams=True, linearize=True,
             object_stream_mode=pikepdf.ObjectStreamMode.generate)
    a, b = Path(src).stat().st_size, Path(dst).stat().st_size
    print(f"  파일          {a / 1048576:.1f} MB -> {b / 1048576:.1f} MB "
          f"({(1 - b / a) * 100:.0f}% 감소)")
    print(f"  -> {dst}")
    print("\n  텍스트 레이어를 반드시 검증할 것:")
    print(f"    gs -sDEVICE=txtwrite -o /tmp/a.txt {src}")
    print(f"    gs -sDEVICE=txtwrite -o /tmp/b.txt {dst}")
    print( "    diff /tmp/a.txt /tmp/b.txt")


def main():
    ap = argparse.ArgumentParser(
        description="PDF 이미지만 다운샘플링한다 (텍스트/폰트 보존).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="ghostscript 로 압축하지 말 것 — 텍스트 레이어가 깨진다. 자세한 건 파일 상단 주석 참조.")
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--target", type=float, default=1.6,
                    help="배치 pt 당 목표 픽셀 배율 (기본 1.6). "
                         "2.0 이면 더 선명하고 파일이 커진다.")
    ap.add_argument("--quality", type=int, default=82, help="JPEG 품질 (기본 82)")
    ap.add_argument("--dry-run", action="store_true", help="줄어드는 양만 계산하고 쓰지 않는다")
    a = ap.parse_args()

    if not Path(a.src).is_file():
        sys.exit(f"없는 파일: {a.src}")
    print(f"{a.src}  (배율 {a.target}x, JPEG q{a.quality})")
    shrink(a.src, a.dst, a.target, a.quality, a.dry_run)


if __name__ == "__main__":
    main()
