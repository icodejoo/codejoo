import type { Codec } from "./interface";

// 三种混淆 codec（均**非加密**，只防肉眼直读；需真安全请用 Web Crypto）。统一约定：
// - password 决定编码（不传用内置默认值）；错 password/外部数据/损坏 → decode 返回 null
//   （load 据此清脏数据回退默认值、enckey 的 owns 据此判键归属——此语义不可丢）；
// - 输出肉眼不可分辨，且不显形为 base64（base64 系经 base64url + 无 padding + 旋转修饰）。
//
// | 选择 | 方案 | 适用 |
// | codec（默认） | UTF-16 码元 10 位 XOR 掩码（零分支） | 体积最优（= 原文 + 1 码元，中文零膨胀）、延迟最低、无运行时要求 |
// | codecBase64 | 原生 toBase64 优先 + atob/btoa polyfill | 大体量 ASCII 吞吐最高（原生 SIMD）；体积 +33%（中文 3 倍） |
// | codecAtob | 全程 TextEncoder + atob/btoa | 行为处处一致（无特性检测分支）；与 codecBase64 同格式可互解 |

const DEFAULT_PW = "@codejoo/storage";
const D16 = new TextDecoder("utf-16le", { ignoreBOM: true }); // JS 引擎均为小端，与 Uint16Array 内存序一致
const E = new TextEncoder();
const D = new TextDecoder();
const B64 = { alphabet: "base64url", omitPadding: true } as const;

/** 旋转修饰及其逆：整串旋转 7 位，按 base64url 硬解也对不齐（≤7 字符时恒等，两侧对称） */
const rot = (t: string): string => t.slice(7) + t.slice(0, 7);
const unrot = (t: string): string => t.slice(-7) + t.slice(0, -7);

/** 字节 → base64url（atob/btoa polyfill 路径；输出与原生 toBase64(B64) 逐字符一致） */
const toB64Poly = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); // 分块防参数栈溢出
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};
const fromB64Poly = (s: string): Uint8Array => {
  const bin = atob(s.replaceAll("-", "+").replaceAll("_", "/")); // atob 宽容无 padding；非法字符抛错由 decode 捕获
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
};

/** base64 系公共骨架：value+password → 字节 → base64url → 旋转；password 后缀即合法性标记 */
const b64Codec = (pw: string, to: (b: Uint8Array) => string, from: (s: string) => Uint8Array): Codec => ({
  encode: (value) => rot(to(E.encode(value + pw))),
  decode: (value) => {
    try {
      const t = D.decode(from(unrot(value)));
      return t.endsWith(pw) ? t.slice(0, -pw.length) : null;
    } catch {
      return null; // 非法 base64 字符/长度：外部数据
    }
  },
});

/**
 * 1. 原生 `Uint8Array.toBase64/fromBase64` 优先（Chrome/Edge 140+、Safari 18.2+、Firefox 133+、Node 25+），
 * 旧运行时自动回退 atob/btoa polyfill——两条路径输出逐字符一致、可互解。大体量 ASCII 吞吐最高。
 */
export function codecBase64(password?: string): Codec {
  const pw = password || DEFAULT_PW;
  return typeof Uint8Array.prototype.toBase64 === "function"
    ? b64Codec(
        pw,
        (b) => b.toBase64(B64),
        (s) => Uint8Array.fromBase64(s, B64),
      )
    : b64Codec(pw, toB64Poly, fromB64Poly);
}

/** 2. 全程 TextEncoder + atob/btoa：无特性检测分支、行为处处一致；与 codecBase64 同格式可互解 */
export function codecAtob(password?: string): Codec {
  return b64Codec(password || DEFAULT_PW, toB64Poly, fromB64Poly);
}

/**
 * 3.（默认）UTF-16 码元级 10 位 XOR 掩码——极简极速形态：
 * - k 压到 10 位（≤0x3FF），XOR 只扰动码元低 10 位、高 6 位不变。代理区判定恰只看高 6 位
 *   （110110/110111），故非代理码元 XOR 后仍非代理、合法代理对仍是合法代理对——
 *   **输出天然合法 UTF-16，热循环零分支、无转义逻辑**；
 * - 输出 = 原文长度 + 1 码元（头部合法性标记 MAGIC^k）——无 base64 膨胀，中文体积零增长；
 * - 错 password 的检测是确定性的（k 不同标记必不匹配 → null）；外部数据误判率 1/65536，
 *   且非 raw 路径还有 deserialize 失败兜底（按损坏清除）。正文损坏不再校验（无校验和）。
 */
export function codec(password?: string): Codec {
  // password 经 FNV-1a 折叠成 10 位 XOR 值；兜底非 0（0 会退化成明文直存）
  const pw = password || DEFAULT_PW;
  let k = 0x811c9dc5;
  for (let i = 0; i < pw.length; i++) k = Math.imul(k ^ pw.charCodeAt(i), 0x01000193);
  k = (k ^ (k >>> 10) ^ (k >>> 20)) & 0x3ff || 0x155;
  const MAGIC = 0x2603 ^ k; // 头码元（落在杂项符号区，永不为代理/BOM）：错 password/外部数据 → decode null

  return {
    encode(value) {
      const n = value.length;
      const buf = new Uint16Array(n + 1);
      buf[0] = MAGIC;
      for (let i = 0; i < n; i++) buf[i + 1] = value.charCodeAt(i) ^ k;
      return D16.decode(buf);
    },
    decode(value) {
      const n = value.length;
      if (n < 1 || value.charCodeAt(0) !== MAGIC) return null; // 标记不符：错 password/外部数据
      const buf = new Uint16Array(n - 1);
      for (let i = 1; i < n; i++) buf[i - 1] = value.charCodeAt(i) ^ k;
      return D16.decode(buf);
    },
  };
}

console.log(codec().encode("hello world"));
console.log(codec().encode("你好世界"));
console.log(codec().decode(codec().encode("你好世界")));
