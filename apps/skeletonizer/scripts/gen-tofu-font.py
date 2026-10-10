"""生成"全方块字体"（skz-tofu），写成 SCSS 变量文件 src/styles/_tofu-font.scss（woff2 的 base64）。

开发期工具，不进 npm 依赖、不参与构建：改字体参数时手动跑一次，把生成的 _tofu-font.scss 一起提交。
构建（sass / vite pack）只读这个已提交的 scss，所以 CI 和使用者都不需要 Python。
为什么生成 scss 而不是提交 woff2 再构建时转码：Sass 读不了二进制文件，转码就得多一道构建脚本；
提交生成物最简单，产物也完全可复现（脚本固定了时间戳，同一份参数每次输出逐字节相同）。

依赖：pip install fonttools brotli
用法：
    python scripts/gen-tofu-font.py                       # 默认参数，写 src/styles/_tofu-font.scss
    python scripts/gen-tofu-font.py --woff2 out.woff2     # 同时另存一份 woff2 便于肉眼 / 工具检查
    python scripts/gen-tofu-font.py --narrow 500          # 窄方块宽度 0.50em（更贴 Segoe / Arial）

参数（单位都是 1/1000 em）：
    --narrow  窄方块 advance，默认 520。西文 / 数字 / 半角用；0.52 兼顾微软雅黑与西文无衬线，0.50 更贴 Segoe / Arial
    --wide    宽方块 advance，默认 1000。CJK / 全角 / emoji 用，整 em
    --space   半角空白 advance，默认 300。空白字符也画成方块，整行连成一条，不留词间隙
    --ymin / --ymax  方块纵向范围，默认 -100 ~ 800（高 0.9em，居中在行盒中线附近）
    --overlap 每个方块右侧多出 advance 的量，默认 80（0.08em）。小数像素位置下相邻方块会出现淡色接缝，
              重叠 0.08em 后字号 10~24px、DPR 1~3 实测接缝亮度全部 <= 3/255
    --asc / --desc / --gap  ascent / descent / lineGap，默认 850 / 150 / 200（line-height: normal 约 1.2em）

字体结构：
    字形 6 个：.notdef（方块）、space（0.3em 方块）、zero（零宽：ZWJ / 变体选择符 / 组合记号）、
              narrow、wide、space_wide（U+3000，1em 方块）。
    cmap：format 4（手写，同字形的长区间共享一份 glyphIdArray，只覆盖 BMP）+ format 13（many-to-one，
          覆盖增补平面和 emoji）。format 12 没有多对一，不可取。
    Chrome 154 已验证 format 13 被接受；Firefox / Safari 没验证（有 format 4 兜底 BMP）。
"""

import argparse
import base64
import io
import math
import os
import struct

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables.DefaultTable import DefaultTable

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(HERE, "..", "src", "styles", "_tofu-font.scss")

ap = argparse.ArgumentParser(description="生成 skz-tofu 方块字体（SCSS base64）")
ap.add_argument("--out", default=DEFAULT_OUT, help="输出的 scss 路径")
ap.add_argument("--woff2", default=None, help="可选：另存一份 woff2")
ap.add_argument("--ymin", type=int, default=-100)
ap.add_argument("--ymax", type=int, default=800)
ap.add_argument("--narrow", type=int, default=520)
ap.add_argument("--wide", type=int, default=1000)
ap.add_argument("--space", type=int, default=300)
ap.add_argument("--asc", type=int, default=850)
ap.add_argument("--desc", type=int, default=150)
ap.add_argument("--gap", type=int, default=200)
ap.add_argument("--overlap", type=int, default=80)
ap.add_argument("--chunk", type=int, default=256, help="format 4 每段最多码点数")
a = ap.parse_args()

# 固定时间戳，保证同参数输出逐字节一致（距 1904-01-01 的秒数）
FIXED_TS = 3_944_678_400

# 字形清单：名字 -> advance（字形顺序即 GID，.notdef 必须第一个）。字形顺序、advance、glyf 都从这张表派生
GLYPHS = {".notdef": a.wide, "space": a.space, "zero": 0, "narrow": a.narrow, "wide": a.wide, "space_wide": a.wide}
ORDER = list(GLYPHS)
GID = {n: i for i, n in enumerate(ORDER)}


def block(w):
    """宽 w（右侧再多出 overlap）的实心方块字形。"""
    p = TTGlyphPen(None)
    p.moveTo((0, a.ymin))
    p.lineTo((0, a.ymax))
    p.lineTo((w + a.overlap, a.ymax))
    p.lineTo((w + a.overlap, a.ymin))
    p.closePath()
    return p.glyph()


def empty():
    """空字形（零宽字符用）。"""
    return TTGlyphPen(None).glyph()


# BMP 码点区间 (起, 止, 字形名)：后写覆盖先写（0x09~0x20 的空白盖在 0x00~0x1F 的零宽上）；0xFFFE / 0xFFFF 是非字符，不进 cmap
RANGES = [
    (0x0000, 0x001F, "zero"),
    (0x09, 0x0A, "space"),
    (0x0C, 0x0D, "space"),
    (0x20, 0x20, "space"),
    (0x21, 0x7E, "narrow"),
    (0x7F, 0x9F, "zero"),
    (0xA0, 0xA0, "space"),
    (0xA1, 0x02FF, "narrow"),
    (0x0300, 0x036F, "zero"),
    (0x0370, 0x10FF, "narrow"),
    (0x1100, 0x11FF, "wide"),
    (0x1200, 0x1FFF, "narrow"),
    (0x2000, 0x200A, "space"),
    (0x200B, 0x200F, "zero"),
    (0x2010, 0x2027, "narrow"),
    (0x2028, 0x202E, "zero"),
    (0x202F, 0x202F, "space"),
    (0x2030, 0x205E, "narrow"),
    (0x205F, 0x205F, "space"),
    (0x2060, 0x206F, "zero"),
    (0x2070, 0x2E7F, "narrow"),
    (0x2E80, 0x2FFF, "wide"),
    (0x3000, 0x3000, "space_wide"),
    (0x3001, 0xD7FF, "wide"),
    (0xE000, 0xF8FF, "wide"),
    (0xF900, 0xFAFF, "wide"),
    (0xFB00, 0xFDFF, "narrow"),
    (0xFE00, 0xFE0F, "zero"),
    (0xFE10, 0xFE6F, "wide"),
    (0xFE70, 0xFEFE, "narrow"),
    (0xFEFF, 0xFEFF, "zero"),
    (0xFF00, 0xFF60, "wide"),
    (0xFF61, 0xFFDF, "narrow"),
    (0xFFE0, 0xFFE6, "wide"),
    (0xFFE8, 0xFFFD, "narrow"),
]
SUPP = [
    (0x10000, 0x1EFFF, "narrow"),
    (0x1F000, 0x1FAFF, "wide"),
    (0x1FB00, 0x1FFFF, "narrow"),
    (0x20000, 0x3FFFF, "wide"),
    (0xE0000, 0xE01EF, "zero"),
]

bmp = {}
for lo, hi, g in RANGES:
    for cp in range(lo, hi + 1):
        bmp[cp] = GID[g]


def runs(m, lo, hi):
    """把码点 -> 字形映射压成连续同字形的 (起, 止, 字形) 区间。"""
    out = []
    cp = lo
    while cp <= hi:
        if cp not in m:
            cp += 1
            continue
        s = cp
        g = m[cp]
        while cp + 1 <= hi and m.get(cp + 1) == g:
            cp += 1
        out.append((s, cp, g))
        cp += 1
    return out


BMP_RUNS = runs(bmp, 0, 0xFFFF)  # cmap 4 / 13 共用，只算一次


def cmap4_raw():
    """手写 format 4：同字形的长区间切成 <=chunk 的段，全部指向该字形的共享 glyphIdArray（每个字形一份 chunk 项）。"""
    segs = []
    for s, e, g in BMP_RUNS:
        c = s
        while c <= e:
            segs.append((c, min(e, c + a.chunk - 1), g))
            c = min(e, c + a.chunk - 1) + 1
    segs.append((0xFFFF, 0xFFFF, None))
    used = sorted({g for *_, g in segs if g is not None})
    arr_off = {g: i * a.chunk * 2 for i, g in enumerate(used)}  # 字节偏移
    gia = b"".join(struct.pack(">H", g) * a.chunk for g in used)
    n = len(segs)
    end = b"".join(struct.pack(">H", e) for _, e, _ in segs)
    start = b"".join(struct.pack(">H", s) for s, _, _ in segs)
    delta = b"".join(struct.pack(">H", 1 if g is None else 0) for *_, g in segs)  # 末段 0xFFFF+1=0 -> 字形 0
    base_iro = 14 + 2 * n + 2 + 2 * n + 2 * n  # 子表内 idRangeOffset 数组起点
    base_gia = base_iro + 2 * n
    iro = b""
    for i, (_, _, g) in enumerate(segs):
        iro += struct.pack(">H", 0 if g is None else base_gia + arr_off[g] - (base_iro + 2 * i))
    sc2 = 2 * n
    es = int(math.log2(n))
    sr = 2 * (2**es)
    rs = sc2 - sr
    sub = struct.pack(">HHHHHHH", 4, 0, 0, sc2, sr, es, rs) + end + b"\0\0" + start + delta + iro + gia
    sub = sub[:2] + struct.pack(">H", len(sub)) + sub[4:]
    assert len(sub) < 65536, len(sub)
    return sub


def cmap13_raw():
    """format 13：many-to-one 分组，每组 12 字节。"""
    groups = list(BMP_RUNS)
    for lo, hi, gname in SUPP:
        groups.append((lo, hi, GID[gname]))
    body = b"".join(struct.pack(">LLL", s, e, g) for s, e, g in groups)
    return struct.pack(">HHLLL", 13, 0, 16 + len(body), 0, len(groups)) + body


def cmap_table():
    """format 4（3,1）+ format 13（3,10）。"""
    subs = [(3, 1, cmap4_raw()), (3, 10, cmap13_raw())]
    off = 4 + 8 * len(subs)
    data = struct.pack(">HH", 0, len(subs))
    body = b""
    for p, e, b in subs:
        data += struct.pack(">HHL", p, e, off + len(body))
        body += b
    return data + body


def build():
    """组装字体，返回 woff2 字节。"""
    fb = FontBuilder(1000, isTTF=True)
    fb.font.recalcTimestamp = False
    fb.setupGlyphOrder(ORDER)
    fb.setupGlyf({n: empty() if n == "zero" else block(w) for n, w in GLYPHS.items()})
    fb.setupHorizontalMetrics({n: (w, 0) for n, w in GLYPHS.items()})
    fb.setupHorizontalHeader(ascent=a.asc, descent=-a.desc, lineGap=a.gap)
    fb.setupNameTable({"familyName": "Skz Tofu", "styleName": "Regular"})
    fb.setupCharacterMap({0x20: "space", 0x41: "narrow"})  # 临时 cmap，仅为让 OS/2 能计算；之后换成手写版
    fb.setupOS2(
        sTypoAscender=a.asc,
        sTypoDescender=-a.desc,
        sTypoLineGap=a.gap,
        usWinAscent=a.asc,
        usWinDescent=a.desc,
        version=4,
        fsSelection=0x40 | 0x80,
        achVendID="SKZ ",
    )
    fb.setupPost()
    t = DefaultTable("cmap")
    t.data = cmap_table()
    fb.font["cmap"] = t
    fb.font["head"].created = FIXED_TS
    fb.font["head"].modified = FIXED_TS
    ttf = io.BytesIO()
    fb.font.save(ttf)
    f = TTFont(io.BytesIO(ttf.getvalue()), recalcTimestamp=False)
    f.flavor = "woff2"
    out = io.BytesIO()
    f.save(out)
    return out.getvalue()


woff2 = build()
b64 = base64.b64encode(woff2).decode("ascii")
header = (
    "// 由 scripts/gen-tofu-font.py 生成，请勿手改。改字体参数后重新运行脚本并提交本文件。\n"
    f"// woff2 {len(woff2)} 字节，参数：narrow={a.narrow} wide={a.wide} space={a.space} "
    f"ymin={a.ymin} ymax={a.ymax} overlap={a.overlap} asc={a.asc} desc={a.desc} gap={a.gap}\n"
)
os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
with open(a.out, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(header + f'$skz-tofu-woff2: "{b64}";\n')
if a.woff2:
    with open(a.woff2, "wb") as fh:
        fh.write(woff2)
print(f"woff2 {len(woff2)} B, base64 {len(b64)} B -> {os.path.relpath(a.out)}")
