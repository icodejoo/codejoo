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

/** 缺省混淆口令。 */
const DEFAULT_PW = "@codejoo/storage";
/** 共用 UTF-8 编码器。 */
const E = /*#__PURE__*/ new TextEncoder();
/** 保留明文开头 BOM 的共用 UTF-8 解码器。 */
const D = /*#__PURE__*/ new TextDecoder("utf-8", { ignoreBOM: true });
/** 原生 base64url 转换选项。 */
const B64 = { alphabet: "base64url", omitPadding: true } as const;
/** 分块转换码元，避免展开参数超过调用栈上限。 */
const CHUNK = 8192;
/** base64url 旋转位数，编码与解码保持对称。 */
const ROTATION = 7;

/** 旋转修饰及其逆：整串旋转 7 位，按 base64url 硬解也对不齐（≤7 字符时恒等，两侧对称） */
const rot = (t: string): string => t.slice(ROTATION) + t.slice(0, ROTATION);
/** 撤销 base64url 旋转修饰。 */
const unrot = (t: string): string => t.slice(-ROTATION) + t.slice(0, -ROTATION);

/** 字节 → base64url（atob/btoa polyfill 路径；输出与原生 toBase64(B64) 逐字符一致） */
const toB64Poly = (b: Uint8Array): string => {
  return btoa(toStr(b)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};
/**
 * 字节或 UTF-16 码元 → string，逐码元原样还原（不同 TextDecoder：不做 UTF-16 合法性校验/替换，落单代理码元也原样保留，
 * 因为 XOR 只保证合法输入 XOR 后仍合法，不保证输入本就合法——TextDecoder 会把不合法的落单代理换成 U+FFFD 破坏往返）
 */
const toStr = (buf: Uint8Array | Uint16Array): string => {
  let s = "";
  for (let i = 0; i < buf.length; i += CHUNK) s += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  return s;
};
/** base64url → 字节（atob/btoa polyfill 路径；非法输入抛错） */
const fromB64Poly = (s: string): Uint8Array => {
  const bin = atob(s.replaceAll("-", "+").replaceAll("_", "/")); // atob 宽容无 padding；非法字符抛错由 decode 捕获
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
};

/**
 * base64 系公共骨架：value+password → 字节 → base64url → 旋转；password 后缀即合法性标记。
 * 解码时用 `t.length - pw.length` 截取，空密码也能正确还原整串。
 */
const b64Codec = (pw: string, to: (b: Uint8Array) => string, from: (s: string) => Uint8Array): Codec => ({
  encode: (value) => rot(to(E.encode(value + pw))),
  decode: (value) => {
    try {
      const t = D.decode(from(unrot(value)));
      return t.endsWith(pw) ? t.slice(0, t.length - pw.length) : null;
    } catch {
      return null; // 非法 base64 字符/长度：外部数据
    }
  },
});

/**
 * 1. 原生 `Uint8Array.toBase64/fromBase64` 优先（Chrome/Edge 140+、Safari 18.2+、Firefox 133+、Node 25+），
 * 旧运行时自动回退 atob/btoa polyfill——两条路径输出逐字符一致、可互解。大体量 ASCII 吞吐最高。
 * @param password 混淆口令，缺省用内置默认值；空字符串也视为真实口令
 * @returns Codec；decode 遇错口令/外部数据返回 null
 * @example const c = codecBase64("pw"); c.decode(c.encode("abc")); // "abc"
 */
export function codecBase64(password?: string): Codec {
  const pw = password ?? DEFAULT_PW; // ?? 而非 ||——显式传入的空字符串密码须被当作真实密码，不能被静默换成默认值
  return typeof Uint8Array.prototype.toBase64 === "function"
    ? b64Codec(
        pw,
        (b) => b.toBase64(B64),
        (s) => Uint8Array.fromBase64(s, B64),
      )
    : b64Codec(pw, toB64Poly, fromB64Poly);
}

/**
 * 2. 全程 TextEncoder + atob/btoa：无特性检测分支、行为处处一致；与 codecBase64 同格式可互解。
 * @param password 混淆口令，缺省用内置默认值；空字符串也视为真实口令
 * @returns Codec；decode 遇错口令/外部数据返回 null
 * @example const c = codecAtob("pw"); c.decode(c.encode("abc")); // "abc"
 */
export function codecAtob(password?: string): Codec {
  return b64Codec(password ?? DEFAULT_PW, toB64Poly, fromB64Poly); // ?? 而非 ||——同 codecBase64，空字符串密码须被当作真实密码
}

/**
 * 3.（默认）UTF-16 码元级 10 位 XOR 掩码——极简极速形态：
 * - k 压到 10 位（≤0x3FF），XOR 只扰动码元低 10 位、高 6 位不变。代理区判定恰只看高 6 位
 *   （110110/110111），故非代理码元 XOR 后仍非代理、合法代理对仍是合法代理对——
 *   **输出天然合法 UTF-16，热循环零分支、无转义逻辑**；
 * - 输出 = 原文长度 + 1 码元（头部合法性标记 MAGIC^k）——无 base64 膨胀，中文体积零增长；
 * - 错 password 的检测是确定性的（k 不同标记必不匹配 → null）；外部数据误判率 1/65536，
 *   且非 raw 路径还有 deserialize 失败兜底（按损坏清除）。正文损坏不再校验（无校验和）。
 * @param password 混淆口令，缺省用内置默认值；空字符串也视为真实口令
 * @returns Codec；decode 遇错口令/外部数据返回 null
 * @example const c = codec("pw"); c.decode(c.encode("abc")); // "abc"
 */
export function codec(password?: string): Codec {
  // password 经 FNV-1a 折叠成 10 位 XOR 值；兜底非 0（0 会退化成明文直存）
  const pw = password ?? DEFAULT_PW; // ?? 而非 ||——显式传入的空字符串密码须被当作真实密码，不能被静默换成默认值
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
      return toStr(buf);
    },
    decode(value) {
      const n = value.length;
      if (n < 1 || value.charCodeAt(0) !== MAGIC) return null; // 标记不符：错 password/外部数据
      const buf = new Uint16Array(n - 1);
      for (let i = 1; i < n; i++) buf[i - 1] = value.charCodeAt(i) ^ k;
      return toStr(buf);
    },
  };
}
