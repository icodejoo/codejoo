/** 占位字符：全宽实心方块 */
const BLOCK = "█";

/** 零宽空格：给连续方块提供断行机会 */
const ZWSP = "​";

/**
 * 确定性整数哈希，同样的输入永远得到同样的输出（SSR 水合安全）。
 * @param n 输入整数
 * @returns 32 位无符号整数
 */
function hash(n: number): number {
  let x = Math.imul(n + 1, 2654435761) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  return x >>> 0;
}

/** 1×1 透明 GIF 的 data URI（模块级常量：类静态字段在 es2015 目标下会多带一套属性键 helper，这里改用静态 getter 暴露） */
const GIF_1PX = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** seed 的步长：不同 seed 落到哈希序列的不同区段 */
const SEED_STRIDE = 131;

/**
 * 第 i 个片段的长度：base + hash % span，由 (i, seed) 唯一决定。
 * @param i 片段序号
 * @param seed 分布种子
 * @param base 最小长度
 * @param span 长度变化范围
 * @returns 片段长度
 */
function pick(i: number, seed: number, base: number, span: number): number {
  return base + (hash(i + seed * SEED_STRIDE) % span);
}

/**
 * 骨架 mock 数据工具集：只造"数据"，不渲染；渲染仍由你自己的真实组件负责。
 * 全部是静态方法，不可实例化；所有结果都是确定性的，不使用 Math.random。
 * 用法：加载中把 mock 对象传给真实组件（`loading ? mock : data`），列表按预期条数造 mock 项；
 * 图片用 `Bone.image(w, h)` 保住盒子尺寸。
 *
 * @example
 * const user = { name: Bone.text(8), bio: Bone.lines(3), avatar: Bone.image(48, 48) };
 */
export class Bone {
  /** 禁止实例化 */
  constructor() {
    if (new.target === Bone) throw new TypeError("Bone 是抽象类，只能使用静态方法");
  }

  /**
   * 1×1 透明 GIF 的 data URI，没有尺寸参数时的兜底占位图（只读）。
   * @returns data URI 字符串
   */
  static get GIF_1PX(): string {
    return GIF_1PX;
  }

  /**
   * 生成 n 个字符的「方块词」文本，词与词之间用空格，长文本可以自然换行。
   * @param n 总字符数（含空格）
   * @param opts seed：改变词长分布，默认 0
   * @returns 恰好 n 个字符的占位文本；n<=0 返回空串
   * @example Bone.text(12) // "███ ████ ███"（词长为示意）
   */
  static text(n: number, opts: { seed?: number } = {}): string {
    const seed = opts.seed ?? 0;
    if (!(n > 0)) return "";
    let out = "";
    for (let i = 0; out.length < n; i++) {
      const wordLen = pick(i, seed, 2, 6);
      if (out) out += " ";
      out += BLOCK.repeat(wordLen);
    }
    return out.slice(0, n).replace(/ $/, BLOCK);
  }

  /**
   * 生成大约 k 行的占位段落，实际行数取决于容器宽度。
   * @param k 目标行数
   * @param opts perLine：每行预估字符数，默认 40；seed：同 text
   * @returns 占位文本
   * @example Bone.lines(3, { perLine: 30 })
   */
  static lines(k: number, opts: { perLine?: number; seed?: number } = {}): string {
    const perLine = opts.perLine ?? 40;
    return Bone.text(Math.max(0, k) * perLine, opts);
  }

  /**
   * 生成中日韩文本的占位串：纯方块，每隔 3~6 个字符放一个零宽空格用于断行。
   * @param n 方块字符数（不含零宽空格）
   * @param opts seed：改变断点分布
   * @returns 占位文本
   * @example Bone.cjk(20)
   */
  static cjk(n: number, opts: { seed?: number } = {}): string {
    const seed = opts.seed ?? 0;
    let out = "";
    let count = 0;
    for (let i = 0; count < n; i++) {
      const run = Math.min(pick(i, seed, 3, 4), n - count);
      out += BLOCK.repeat(run) + (count + run < n ? ZWSP : "");
      count += run;
    }
    return out;
  }

  /**
   * 生成数字占位（固定宽度方块）。
   * @param digits 位数，默认 3
   * @returns 占位文本
   * @example Bone.number(4)
   */
  static number(digits: number = 3): string {
    return BLOCK.repeat(Math.max(0, digits));
  }

  /**
   * 生成透明占位图（重载）：
   * - 不传参数：1×1 透明 GIF 的 base64 data URI，兼容性最好；没有固有宽高比，
   *   请用 img 的 width/height 属性或 CSS 给尺寸，否则会塌成 1px。
   * - 只传 width：height 默认等于 width，得到方形的透明 SVG（头像、图标常用）。
   * - 传 width 和 height：带固有宽高的透明 SVG，保留宽高比、避免布局跳动。
   * 参数非法（非正数）时退回 1px GIF。
   * 注意：严格 CSP 若不放行 img-src data:，请改用自己托管的透明图。
   * @param width 图片宽（像素），可选
   * @param height 图片高（像素），默认等于 width
   * @returns 可直接放进 img.src 的 data URI
   * @example <img :src="Bone.image()" width="120" height="80" />
   * @example <img :src="Bone.image(48)" />
   * @example <img :src="Bone.image(120, 80)" />
   */
  static image(width?: number, height: number | undefined = width): string {
    if (!width || !height || !(width > 0) || !(height > 0)) return GIF_1PX;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"/>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
}
