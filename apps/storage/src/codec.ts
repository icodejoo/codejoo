import type { Codec } from "./interface";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// 自定义字母表：在 URL-safe base64(用 -_ 取代 +/)基础上旋转打乱顺序。
// 效果：输出不是标准 base64，atob() 直接解不了、也没有 +/= 和 padding 这些一眼认出的特征。
// 注意：字母表本身在打包产物里，仍属混淆而非加密。
const SRC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const ALPHABET = SRC.slice(23) + SRC.slice(0, 23);
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

/** 字节 -> 自定义 base64（无 padding） */
function toText(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += ALPHABET[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += ALPHABET[n & 63];
  }
  return out;
}

/** 自定义 base64 -> 字节 */
function fromText(text: string): Uint8Array {
  const out = new Uint8Array((text.length * 3) >> 2);
  let p = 0;
  for (let i = 0; i < text.length; i += 4) {
    const c2 = i + 2 < text.length ? LOOKUP[text.charCodeAt(i + 2)] : -1;
    const c3 = i + 3 < text.length ? LOOKUP[text.charCodeAt(i + 3)] : -1;
    const n =
      (LOOKUP[text.charCodeAt(i)] << 18) |
      (LOOKUP[text.charCodeAt(i + 1)] << 12) |
      ((c2 < 0 ? 0 : c2) << 6) |
      (c3 < 0 ? 0 : c3);
    out[p++] = (n >> 16) & 255;
    if (c2 >= 0) out[p++] = (n >> 8) & 255;
    if (c3 >= 0) out[p++] = n & 255;
  }
  return out.subarray(0, p);
}

// 默认内置 key：不传 password 时用它，保证默认即有混淆且数据稳定。
// 它和 password 一样存在于打包产物里——纯混淆，非加密。
const DEFAULT_KEY = encoder.encode("@codejoo/storage");

// 内容校验和（FNV-1a 32 位）：写入时把明文校验和放在头 4 字节。
// 解码后重算内容校验和比对，不符 → decode 返回 null（不抛），让上层清除旧数据。
// 用「内容校验和」而非「固定魔数」：魔数只校验 key 前几字节，前缀相同的不同 key 会误判通过；
// 校验和耦合全部内容，key 不对时内容必为乱码 → 校验必然失败。
function fnv1a(bytes: Uint8Array, start: number): number {
  let h = 0x811c9dc5;
  for (let i = start; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 轻量同步混淆：重复密钥 XOR + 自定义 base64。
 * 目的是避免明文直接暴露在 devtools/localStorage 里，**不是强加密**。
 * 需要真正安全请用异步的 Web Crypto 方案。
 *
 * 注意：password 仅决定 XOR key。改 password 会导致旧数据无法解出（无迁移），
 * 且因 key 同样打包进产物，自定义 password 并不带来实质安全提升——按需使用。
 */
export function codec(password?: string): Codec {
  const key = password ? encoder.encode(password) : DEFAULT_KEY;

  /** XOR 是对合运算，加解密同一套逻辑 */
  function xor(bytes: Uint8Array): Uint8Array {
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ key[i % key.length];
    return out;
  }

  return {
    encode(value: string): string {
      const data = encoder.encode(value);
      const buf = new Uint8Array(4 + data.length); // 头 4 字节存内容校验和
      buf.set(data, 4);
      const h = fnv1a(buf, 4);
      buf[0] = h & 255;
      buf[1] = (h >>> 8) & 255;
      buf[2] = (h >>> 16) & 255;
      buf[3] = (h >>> 24) & 255;
      return toText(xor(buf));
    },
    decode(value: string): string | null {
      const buf = xor(fromText(value));
      if (buf.length < 4) return null;
      const stored = (buf[0] | (buf[1] << 8) | (buf[2] << 16) | (buf[3] << 24)) >>> 0;
      if (fnv1a(buf, 4) !== stored) return null; // 校验和不符：key 变更/数据损坏
      return decoder.decode(buf.subarray(4));
    },
  };
}
