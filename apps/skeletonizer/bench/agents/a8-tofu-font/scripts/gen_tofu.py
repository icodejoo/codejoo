"""生成"全方块字体"（tofu）。用法：python gen_tofu.py <输出目录> [--ymin -100 --ymax 800 --narrow 550 --asc 850 --desc 150 --gap 200 --tag name]
同时输出三种 cmap 变体：fmt13（仅 format 13）、fmt4（手写 format 4，共享数组技巧）、both（4 + 13）。"""
import argparse, os, struct
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables.DefaultTable import DefaultTable
from fontTools.ttLib.tables._c_m_a_p import cmap_format_13, CmapSubtable

ap = argparse.ArgumentParser()
ap.add_argument("out"); ap.add_argument("--ymin", type=int, default=-100); ap.add_argument("--ymax", type=int, default=800)
ap.add_argument("--narrow", type=int, default=520); ap.add_argument("--wide", type=int, default=1000); ap.add_argument("--space", type=int, default=300)
ap.add_argument("--asc", type=int, default=850); ap.add_argument("--desc", type=int, default=150); ap.add_argument("--gap", type=int, default=200)
ap.add_argument("--overlap", type=int, default=80)  # 方块右侧多出 advance 的量（font units），消除小数像素位置造成的接缝
ap.add_argument("--blank-space", action="store_true")  # 默认空格也画成实心方块（整行连成一条）；加此开关则空格留白（保留词间隙）
ap.add_argument("--tag", default="tofu"); ap.add_argument("--chunk", type=int, default=256)
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)

ORDER = [".notdef", "space", "zero", "narrow", "wide", "space_wide"]
ADV = {".notdef": a.wide, "space": a.space, "zero": 0, "narrow": a.narrow, "wide": a.wide, "space_wide": a.wide}
GID = {n: i for i, n in enumerate(ORDER)}

def block(w):
    p = TTGlyphPen(None)
    p.moveTo((0, a.ymin)); p.lineTo((0, a.ymax)); p.lineTo((w + a.overlap, a.ymax)); p.lineTo((w + a.overlap, a.ymin)); p.closePath()
    return p.glyph()

def empty(): return TTGlyphPen(None).glyph()

# 码点区间 -> 字形名（后写覆盖先写）
R = []
def put(lo, hi, g): R.append((lo, hi, g))
put(0x0000, 0x001F, "zero"); put(0x09, 0x0A, "space"); put(0x0C, 0x0D, "space")
put(0x20, 0x20, "space"); put(0x21, 0x7E, "narrow"); put(0x7F, 0x9F, "zero"); put(0xA0, 0xA0, "space")
put(0xA1, 0x02FF, "narrow"); put(0x0300, 0x036F, "zero"); put(0x0370, 0x10FF, "narrow"); put(0x1100, 0x11FF, "wide")
put(0x1200, 0x1FFF, "narrow"); put(0x2000, 0x200A, "space"); put(0x200B, 0x200F, "zero"); put(0x2010, 0x2027, "narrow")
put(0x2028, 0x202E, "zero"); put(0x202F, 0x202F, "space"); put(0x2030, 0x205E, "narrow"); put(0x205F, 0x205F, "space")
put(0x2060, 0x206F, "zero"); put(0x2070, 0x2E7F, "narrow"); put(0x2E80, 0x2FFF, "wide"); put(0x3000, 0x3000, "space_wide")
put(0x3001, 0xD7FF, "wide"); put(0xE000, 0xF8FF, "wide"); put(0xF900, 0xFAFF, "wide"); put(0xFB00, 0xFDFF, "narrow")
put(0xFE00, 0xFE0F, "zero"); put(0xFE10, 0xFE6F, "wide"); put(0xFE70, 0xFEFE, "narrow"); put(0xFEFF, 0xFEFF, "zero")
put(0xFF00, 0xFF60, "wide"); put(0xFF61, 0xFFDF, "narrow"); put(0xFFE0, 0xFFE6, "wide"); put(0xFFE8, 0xFFFF, "narrow")
SUPP = [(0x10000, 0x1EFFF, "narrow"), (0x1F000, 0x1FAFF, "wide"), (0x1FB00, 0x1FFFF, "narrow"), (0x20000, 0x3FFFF, "wide"), (0xE0000, 0xE01EF, "zero")]

bmp = {}
for lo, hi, g in R:
    for cp in range(lo, hi + 1): bmp[cp] = GID[g]
bmp.pop(0xFFFE, None); bmp.pop(0xFFFF, None)

def runs(m, lo, hi):
    out = []; cp = lo
    while cp <= hi:
        if cp not in m: cp += 1; continue
        s = cp; g = m[cp]
        while cp + 1 <= hi and m.get(cp + 1) == g: cp += 1
        out.append((s, cp, g)); cp += 1
    return out

def cmap4_raw():
    """手写 format 4：同字形的长区间切成 <=chunk 的段，全部指向该字形的共享 glyphIdArray（每个字形一份 chunk 项）。"""
    segs = []
    for s, e, g in runs(bmp, 0, 0xFFFF):
        c = s
        while c <= e: segs.append((c, min(e, c + a.chunk - 1), g)); c = min(e, c + a.chunk - 1) + 1
    segs.append((0xFFFF, 0xFFFF, None))
    used = sorted({g for *_, g in segs if g is not None})
    arr_off = {g: i * a.chunk * 2 for i, g in zip(range(len(used)), used)}  # 字节偏移
    gia = b"".join(struct.pack(">H", g) * a.chunk for g in used)
    n = len(segs)
    hdr = 16 + 8 * n  # 到 idRangeOffset 之前的固定部分：14 + 2(pad) ... 下面按段计算
    end = b"".join(struct.pack(">H", e) for _, e, _ in segs)
    start = b"".join(struct.pack(">H", s) for s, _, _ in segs)
    delta = b"".join(struct.pack(">H", 1 if g is None else 0) for *_, g in segs)  # 末段 0xFFFF+1=0 -> 字形 0
    base_iro = 14 + 2 * n + 2 + 2 * n + 2 * n  # 子表内 idRangeOffset 数组起点
    base_gia = base_iro + 2 * n
    iro = b""
    for i, (s, e, g) in enumerate(segs):
        iro += struct.pack(">H", 0 if g is None else base_gia + arr_off[g] - (base_iro + 2 * i))
    import math
    sc2 = 2 * n; es = int(math.log2(n)); sr = 2 * (2 ** es); rs = sc2 - sr
    body = struct.pack(">HHH", 4, 0, 0)  # 占位，下面重写
    sub = struct.pack(">HHHHHHH", 4, 0, 0, sc2, sr, es, rs) + end + b"\0\0" + start + delta + iro + gia
    sub = sub[:2] + struct.pack(">H", len(sub)) + sub[4:]
    assert len(sub) < 65536, len(sub)
    return sub, n

def cmap13_raw():
    """format 13：many-to-one 分组，每组 12 字节。"""
    m = dict(bmp)
    groups = []
    for s, e, g in runs(m, 0, 0xFFFF): groups.append((s, e, g))
    for lo, hi, gname in SUPP: groups.append((lo, hi, GID[gname]))
    body = b"".join(struct.pack(">LLL", s, e, g) for s, e, g in groups)
    return struct.pack(">HHLLL", 13, 0, 16 + len(body), 0, len(groups)) + body, len(groups)

def cmap_table(kind):
    subs = []  # (plat, enc, bytes)
    if kind in ("fmt4", "both"): subs.append((3, 1, cmap4_raw()[0]))
    if kind in ("fmt13", "both"): subs.append((3, 10, cmap13_raw()[0]))
    off = 4 + 8 * len(subs); data = struct.pack(">HH", 0, len(subs)); body = b""
    for p, e, b in subs: data += struct.pack(">HHL", p, e, off + len(body)); body += b
    return data + body

def build(kind, path):
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(ORDER)
    sp = empty if a.blank_space else (lambda: block(a.space)); spw = empty if a.blank_space else (lambda: block(a.wide))
    fb.setupGlyf({".notdef": block(a.wide), "space": sp(), "zero": empty(), "narrow": block(a.narrow), "wide": block(a.wide), "space_wide": spw()})
    fb.setupHorizontalMetrics({n: (ADV[n], 0) for n in ORDER})
    fb.setupHorizontalHeader(ascent=a.asc, descent=-a.desc, lineGap=a.gap)
    fb.setupNameTable({"familyName": "Skz Tofu", "styleName": "Regular"})
    fb.setupCharacterMap({0x20: "space", 0x41: "narrow"})  # 临时 cmap，仅为让 OS/2 能计算；之后换成手写版
    fb.setupOS2(sTypoAscender=a.asc, sTypoDescender=-a.desc, sTypoLineGap=a.gap, usWinAscent=a.asc, usWinDescent=a.desc, version=4, fsSelection=0x40 | 0x80, achVendID="SKZ ")
    fb.setupPost(); fb.setupDummyDSIG() if False else None
    t = DefaultTable("cmap"); t.data = cmap_table(kind); fb.font["cmap"] = t
    fb.save(path)

for kind in ("fmt13", "fmt4", "both"):
    p = os.path.join(a.out, f"{a.tag}-{kind}.ttf"); build(kind, p)
    f = TTFont(p); f.flavor = "woff"; f.save(p[:-4] + ".woff")
    f.flavor = "woff2"
    try: f.save(p[:-4] + ".woff2"); w2 = os.path.getsize(p[:-4] + ".woff2")
    except Exception as e: w2 = f"n/a({e})"
    print(kind, "ttf", os.path.getsize(p), "woff", os.path.getsize(p[:-4] + ".woff"), "woff2", w2)
print("fmt4 segs", cmap4_raw()[1], "fmt13 groups", cmap13_raw()[1])
