// 极简 PNG 解码（8 位 RGB/RGBA、非隔行），供逐像素对比
import zlib from "node:zlib";
export function decode(buf) {
  let p = 8, w, h, ct; const idat = [];
  while (p < buf.length) { const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8); const d = buf.subarray(p + 8, p + 8 + len); if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; } else if (type === "IDAT") idat.push(d); p += 12 + len; }
  const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) { const f = raw[y * (stride + 1)], r = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), o = y * stride;
    for (let x = 0; x < stride; x++) { const a = x >= bpp ? out[o + x - bpp] : 0, b = y ? out[o - stride + x] : 0, c = x >= bpp && y ? out[o - stride + x - bpp] : 0; let v = r[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c), pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; v += pr; } out[o + x] = v & 255; } }
  return { w, h, bpp, data: out };
}
export const lum = (img, x, y) => { const i = (y * img.w + x) * img.bpp; return 0.3 * img.data[i] + 0.59 * img.data[i + 1] + 0.11 * img.data[i + 2]; };
