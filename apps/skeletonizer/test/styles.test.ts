import { readdirSync, readFileSync } from "node:fs";
import { compile, compileString } from "sass";
import { describe, expect, it } from "vitest";
import { buildHostCss } from "../src/full/hosts.ts";

/** 旧前缀（拆开写，避免全仓 grep 误报） */
const OLD_PREFIX = "x-" + "ske";

/** 全部 CSS 入口：取 src/styles/entries 下的 *.scss 文件名（与 vite.config.ts 的 CSS_ENTRIES 同一来源） */
const ALL_ENTRIES = readdirSync("src/styles/entries")
  .filter((f) => f.endsWith(".scss"))
  .map((f) => f.slice(0, -".scss".length));

/** SVG 根规则的特征片段：只对 skz-engine=svg 的根生效 */
const SVG_ROOT = "[skz][skz-engine=svg][skz-effect=pulse],";

/** 文字条家族（round 默认 / clip）的根限定后缀：没写 skz-text-mode、明写 round、明写 clip（正向选择，其他取值都不在家族里）；core / explicit / 完整版共用 */
const CLIP_MOD = ":is(:not([skz-text-mode]), [skz-text-mode=round], [skz-text-mode=clip])";

/** 文字条家族的根选择器 */
const CLIP_ROOT = `[skz]${CLIP_MOD}`;

/** round（默认文字模式）的根限定后缀：没写 skz-text-mode，或明写 round */
const ROUND_MOD = ":is(:not([skz-text-mode]), [skz-text-mode=round])";

/** round 的特性查询：box-decoration-break（Chrome 130 前 / Safari 只认 -webkit- 前缀，两种写法都查） */
const ROUND_SUPPORTS = "@supports (box-decoration-break: clone) or (-webkit-box-decoration-break: clone) {";

/** 颜色由根上变量驱动的文字模式：有 skz-text-mode 且不是 round / clip / leaf（underline / tofu / 未知取值），:where() 后缀 */
const COLOR_MODES = ":where([skz-text-mode]:not([skz-text-mode=round]):not([skz-text-mode=clip]):not([skz-text-mode=leaf]))";

/**
 * 推导区域前缀（skz-auto 在根自身 / 根内后代两种写法；skz-auto 包在 :where() 里不计优先级），后面接空格 + 目标
 * @param mod 根上的限定后缀，如 ":not([skz-text-mode=leaf])"；不传 = 不限定
 * @returns 单个 :is() 选择器
 */
const auto = (mod = ""): string => `:is([skz]${mod}:where([skz-auto]), [skz]${mod} :where([skz-auto]))`;

/** 无限定的推导区域前缀 */
const AUTO = auto();

/** 非 leaf 根的限定（完整版） */
const NONLEAF_MOD = ":not([skz-text-mode=leaf])";

/**
 * 把空白（含换行 / 缩进）压成单个空格，便于跨缩进比对规则文本
 * @param text CSS 文本
 * @returns 压平后的文本
 */
const flat = (text: string): string => text.replace(/\s+/g, " ");

/**
 * 找出所有以 `:is(p, span` 开头的文字推导选择器里，前面没挂 skz-auto 区域前缀的（应为空）
 * @param out 不含注释的 CSS 文本
 * @returns 不带区域前缀的出处片段
 */
const unguardedText = (out: string): string[] => (out.match(/.{0,24}:is\(p, span/g) ?? []).filter((m) => !m.includes("[skz-auto])) :is(p, span"));

/** 带 :where() 后缀的 core 入口之外，所有基底入口（带根驱动） */
const DRIVER_ENTRIES = ["core", "explicit", "base"];

/** 文字模式取值名（underline / leaf / tofu）：core / explicit / global 里不应出现；round / clip 是 core 认的文字条家族，不在此列 */
const TEXT_MODE_VALUE = /skz-text-mode=(underline|leaf|tofu)/;

/** 降频时间函数（缺省值写在 var() 兜底里） */
const SHIMMER_TIMING = "var(--skz-shimmer-timing, var(--skz-tier-steps, steps(30)))";

/** shimmer 的时长兜底链：用户的 --skz-duration > 档位 > 2s */
const SHIMMER_DUR = "var(--skz-duration, var(--skz-tier-dur, 2s))";

/** pulse / fade / sweep 的时长：用户的 --skz-duration > 2s */
const PLAIN_DUR = "var(--skz-duration, 2s)";

/** shimmer 的光带动画声明（只挂光带） */
const SHIMMER_ANIM = `skz-shimmer-root ${SHIMMER_DUR} ${SHIMMER_TIMING} infinite`;

/** 按透明度取高光色的 color-mix 写法 */
const hl = (a: string): string => `color-mix(in srgb, var(--skz-highlight) ${a}, transparent)`;
/** shimmer 光带图：水平 90deg，透明 → 高光 → 透明，两侧按 smoothstep 缓动 */
const SHIMMER_IMG = `--skz-bg-img: linear-gradient(90deg, transparent 0, ${hl("15.6%")} 12.5%, ${hl("50%")} 25%, ${hl("84.4%")} 37.5%, var(--skz-highlight) 50%, ${hl("84.4%")} 62.5%, ${hl("50%")} 75%, ${hl("15.6%")} 87.5%, transparent 100%);`;

/** underline / tofu / iOS 的 shimmer 额外挂的 pulse 动画 */
const PULSE_ANIM = `skz-pulse-root ${SHIMMER_DUR} ${SHIMMER_TIMING} infinite alternate`;

/** 已编译入口的缓存：同一个入口在多个用例里反复取，只编译一次 */
const cssCache = new Map<string, string>();

/**
 * 编译一个 SCSS 入口，并去掉注释（注释里会提到 @property 等字样，不应参与断言）；结果按入口名缓存
 * @param name 入口名（src/styles/entries 下）
 * @returns 不含注释的 CSS 文本
 */
const css = (name: string): string => {
  let out = cssCache.get(name);
  if (out === undefined) {
    out = compile(`src/styles/entries/${name}.scss`).css.replace(/\/\*[\s\S]*?\*\//g, "");
    cssCache.set(name, out);
  }
  return out;
};

/**
 * 统计子串出现次数
 * @param text 全文
 * @param part 子串
 * @returns 出现次数
 */
const count = (text: string, part: string): number => text.split(part).length - 1;

/**
 * 取某个选择器的第一条规则体（从 `选择器 {` 到第一个 `}`），找不到直接让用例失败
 * @param out 不含注释的 CSS 文本
 * @param selector 规则的完整选择器（和编译输出里的写法一致）
 * @returns 花括号里的声明文本
 */
const rule = (out: string, selector: string): string => {
  const i = out.indexOf(`${selector} {`);
  expect(i, selector).toBeGreaterThanOrEqual(0);
  return out.slice(i, out.indexOf("}", i));
};

describe("样式入口的组成", () => {
  it("所有入口都能编译", () => {
    for (const name of ALL_ENTRIES) expect(css(name).length).toBeGreaterThan(100);
  });

  it("core：现代档用一个 @supports 同时要求 text-decoration-thickness 和 :has()，没有撤回分支，只认 round / clip 两个文字模式取值", () => {
    const core = css("core");
    expect(count(core, "@supports (text-decoration-thickness: 1em) and selector(:has(*)) {")).toBe(1);
    // 门槛已保证 background-clip:text，不带撤回分支；只有现代档 / round 的 box-decoration-break 门控 / 根驱动 / iOS / 忽略区撤销 fade（默认 fade 与 pulse、shimmer 退回 fade 共用一个 :has）五个 @supports
    expect(core).not.toContain("@supports not");
    expect(count(core, "@supports")).toBe(5);
    expect(count(core, ROUND_SUPPORTS)).toBe(1);
    // clip 的填充仍是 background-clip:text，只是读 --skz-bgclip（round 根上切成 border-box）
    expect(core).toContain("background-clip: var(--skz-bgclip, text)");
    expect(core).not.toMatch(TEXT_MODE_VALUE);
    // 根选择器只认文字条家族（没写 skz-text-mode / round / clip）：同时引完整版样式时，core 的规则碰不到 leaf / underline / tofu 根
    expect(core).toContain(`${auto(CLIP_MOD)} :is(p, span`);
    expect(rule(core, `[skz]${CLIP_MOD}`)).toContain("--skz-tradius: 0px");
    // 没有 underline / tofu 根要隔离，不写 --skz-tbg / --skz-timg
    expect(core).not.toMatch(/--skz-(tbg|timg): (initial|transparent|none)/);
  });

  it("core / explicit：不含兜底层、underline / leaf / tofu、防火墙、svg、sweep（懒渲染另见下）", () => {
    for (const name of ["core", "explicit"]) {
      const out = css(name);
      expect(out, name).not.toContain("[skz] > *:not([skz-ignore])");
      expect(out, name).not.toContain("[skz] > * *");
      expect(out, name).not.toMatch(/skz-fw|skz-engine|skz-svg|skz-sweep|skz-tofu|@font-face/);
      expect(out, name).not.toMatch(/--skz-(tbg|timg):/);
      expect(out, name).not.toMatch(TEXT_MODE_VALUE);
      // 根驱动里 underline / tofu 的纯色驱动不在这两个入口
      expect(out, name).not.toMatch(/--skz-ul-fill:/);
      expect(out, name).not.toContain("skz-text-mode=leaf");
    }
  });

  it("core / explicit / base：都含根驱动（@property、关键帧、pulse / shimmer、iOS 分支）、减少动态效果和 fit", () => {
    for (const name of DRIVER_ENTRIES) {
      const out = css(name);
      expect(out, name).toContain("@property --skz-shimmer-p");
      expect(out, name).toContain("@property --skz-pulse-c");
      expect(out, name).toContain("@keyframes skz-shimmer-root");
      expect(out, name).toContain("@keyframes skz-pulse-root");
      expect(rule(out, "[skz][skz-effect=shimmer]")).toContain(`animation: ${SHIMMER_ANIM};`);
      // 光带水平 90deg（倾斜会让 no-repeat 背景块的竖边被硬截断），两侧缓动色标
      expect(rule(out, "[skz][skz-effect=shimmer]"), name).toContain(SHIMMER_IMG);
      expect(out, name).toContain("@supports (-webkit-touch-callout: none)");
      expect(out, name).toContain("@media (prefers-reduced-motion: reduce)");
      expect(out, name).toContain("[skz-fit] {");
      expect(out, name).toContain("[skz-fit-hide]");
    }
  });

  it("core 入口 = 第 0 档 + 现代档 + 标记 + 根驱动：有 tier0 的文字标签骨头、图标启发式、控件整块（都在 skz-auto 区域里），没有 underline / leaf", () => {
    const core = css("core");
    expect(core).toContain(`${AUTO} :is(p, span, h1`);
    expect(core).toContain(`${AUTO} :is(i:empty, [class*=icon]:empty):not([skz-ignore]) {`);
    expect(core).toContain(`${auto(CLIP_MOD)} select:not([skz-ignore]) *`);
    expect(core).toContain("[skz] [skz-ignore] {");
    expect(core).toContain("[skz] [skz-leaf] * {");
    expect(core).not.toContain(":not(:has(> *))");
  });

  it("懒渲染（skz-paused）和 skz-cv 在 base / explicit，core / global / svg 没有；base 兜底层在最前，退出兜底层在第 0 档之前", () => {
    const base = css("base");
    expect(base).toContain("[skz][skz-paused]");
    expect(base).toContain("[skz][skz-cv] > *");
    const explicit = css("explicit");
    expect(explicit).toContain("[skz][skz-paused]");
    expect(explicit).toContain("[skz][skz-cv] > *");
    expect(explicit).toContain("animation: none !important");
    expect(explicit).toContain("--skz-bg-img: none !important");
    const fallback = base.indexOf("linear-gradient(rgba(128, 128, 128, 0.2)");
    const exit = base.indexOf(`${AUTO} > *:not([skz-ignore]) {\n  background-image: none`);
    const tier0 = base.indexOf(`${AUTO} :is(p, span, h1`);
    expect(fallback).toBeGreaterThanOrEqual(0);
    expect(fallback).toBeLessThan(exit);
    expect(exit).toBeLessThan(tier0);
    for (const name of ["core", "global", "svg"]) expect(css(name), name).not.toMatch(/skz-paused|skz-cv/);
  });

  it("base 含 core 的全部能力：根驱动、fade、marks、控件 / 图标 / 忽略区规则，另有完整的 tier1 / tier2（underline / leaf）", () => {
    const base = css("base");
    expect(base).toContain("text-decoration-thickness: 1em");
    expect(base).toContain(`${auto("[skz-text-mode=leaf]")} *:not([skz-ignore])`);
    expect(base).toContain("@supports selector(:has(*))");
    expect(base).toContain(`${AUTO} :is(i:empty, [class*=icon]:empty):not([skz-ignore]) {`);
    // core 的合并现代档只在 core.css，不重复叠进 base（同一批规则在 base 里由 tier1 / tier2 带完整根选择器生成）
    expect(base).not.toContain("@supports (text-decoration-thickness: 1em) and selector");
    // pulse / shimmer 的纯色驱动（underline / tofu）只在 base
    expect(rule(base, `[skz]:is([skz-effect=pulse], [skz-effect=shimmer])${COLOR_MODES}`)).toContain("--skz-ul-fill: var(--skz-pulse-c)");
  });

  it("base：pulse / shimmer 退回 fade 的规则在 :where() 里（优先级 0，不能压过变体）", () => {
    const out = css("base");
    expect(out).toContain(":where([skz][skz-effect=pulse], [skz][skz-effect=shimmer]) {\n  animation: skz-fade");
    // 不允许出现优先级高于 (0,2,0) 的 pulse / shimmer fade 规则
    expect(out).not.toMatch(/^\[skz\]\[skz-effect=(pulse|shimmer)\]:not/m);
  });

  it("explicit：不含任何推导规则（没有 skz-auto），只认显式标记：skz-bone / skz-leaf / skz-ignore 和 skz-text（默认 round，不支持时 clip）", () => {
    const out = css("explicit");
    expect(out).not.toMatch(/skz-auto|skz-mode|:is\(p, span/);
    expect(out).toContain("[skz] [skz-bone] *");
    expect(out).toContain("@supports (text-decoration-thickness: 1em) and selector(:has(*))");
    expect(out).toContain(`[skz]${CLIP_MOD} [skz-text]:where(`);
    expect(out).toContain("background-clip: var(--skz-bgclip, text)");
    expect(count(out, ROUND_SUPPORTS)).toBe(1);
  });

  it("skz-bone 的媒体处理在所有基底里都有：后代藏起来，img / video / canvas 把真实内容推出盒子（不依赖 skz-auto）", () => {
    for (const name of ["core", "base", "explicit", "all"]) {
      const out = flat(css(name));
      expect(out, name).toContain("[skz] [skz-bone] * { visibility: hidden !important; }");
      expect(out, name).toContain("[skz] img[skz-bone], [skz] video[skz-bone], [skz] canvas[skz-bone] { object-fit: none !important; object-position: 99999px 0 !important; }");
    }
  });

  it("svg：不依赖 @property，也不带根驱动和 sweep", () => {
    const out = css("svg");
    expect(out).not.toMatch(/@property|skz-shimmer-root|skz-sweep\b/);
    expect(out).toContain("--skz-svg-shimmer");
  });

  it("global：只剩继承防火墙和一份 SVG 根规则，没有根驱动（@property / 关键帧 / pulse、shimmer 根规则）、sweep 和 data URI", () => {
    const out = css("global");
    expect(out).toContain("[skz-fw]");
    expect(out).toContain(SVG_ROOT);
    expect(out).not.toMatch(/@property|@keyframes|skz-shimmer-root|skz-pulse-root/);
    expect(out).not.toContain("@supports not (color: rgb(");
    expect(out).not.toContain("skz-sweep");
    expect(out).not.toContain("data:image/svg");
    // 不含基底的东西：兜底层、第 0 档、marks、fade
    expect(out).not.toMatch(/skz-fade|\[skz-fit\]|skz-ignore|\[skz\] p:/);
    // 带 animation 的只有 svg 根规则里的 animation: none
    expect(out.match(/animation:[^;]*;/g)).toEqual(["animation: none;"]);
  });

  it("all：包含基底和全部变体，不含显式基底", () => {
    const out = css("all");
    expect(out).toContain("text-decoration-thickness");
    expect(out).toContain("@property");
    expect(out).toContain("skz-effect=sweep");
    expect(out).toContain("@font-face");
    expect(out).toContain("[skz][skz-text-mode=tofu]");
  });

  it("tofu：@font-face 带内联 woff2 + block，文字规则用方块字体、读 --skz-ul-fill、撤下划线，不碰控件和忽略区", () => {
    const out = css("tofu");
    expect(out).toMatch(/@font-face\s*\{[^}]*font-family: skz-tofu;[^}]*font-display: block;[^}]*src: url\("data:font\/woff2;base64,[A-Za-z0-9+/=]{500,}"\) format\("woff2"\)/);
    for (const decl of [
      "font-family: skz-tofu !important",
      "color: var(--skz-ul-fill, var(--skz-color)) !important",
      "-webkit-text-fill-color: currentColor !important",
      "text-decoration: none !important",
      "letter-spacing: 0 !important",
      "word-spacing: 0 !important",
      "font-kerning: none !important",
      "font-variant-ligatures: none !important",
      "font-synthesis: none !important",
    ]) {
      expect(out, decl).toContain(decl);
    }
    // 只对 tofu 根生效（自动推导只在 skz-auto 区域里，显式 skz-text 标记在区域内外都生效）；排除忽略区 / 骨头 / 叶子 / 媒体与控件内部
    expect(out).toContain(`${auto("[skz-text-mode=tofu]")} :is(p, span`);
    expect(out).toContain("[skz][skz-text-mode=tofu] [skz-text]:where(");
    // 含 skz-ignore 的文字元素不套方块（行内忽略区否则会被画成骨头）：只靠 skz-ignore 一个标记、纯 CSS。
    // 守卫写成 :not(:where(:has()))：:where() 宽容解析，不认 :has 的浏览器里 :not() 恒真、规则照常生效，所以全部目标只输出一份，没有 @supports 分支
    expect(out).not.toContain("@supports");
    expect(count(out, ":not(:where(:has([skz-ignore])))")).toBe(4);
    expect(out).not.toMatch(/:not\(:has\(/);
    // 显式标记的目标只补「不在媒体里」：忽略区 / 骨头 / 叶子已由 :where() 里的排除项承担，不再重复套 :not([skz-ignore])...
    expect(out).toContain(
      "[skz][skz-text-mode=tofu] [skz-text]:where(:not([skz-ignore], [skz-bone], [skz-leaf], [skz-leaf] *, [skz-ignore] *)):not(:is(img, video, canvas, picture, iframe, svg, input, textarea, select, button) *):not(:where(:has([skz-ignore])))",
    );
    expect(out).not.toContain("skz-has-ignore");
    expect(out).toContain(":not([skz-ignore] *)");
    expect(out).toMatch(/:not\(:is\(img, video, canvas, picture, iframe, svg, input, textarea, select, button\) \*\)/);
    // 不画下划线也不用 background-clip
    expect(out).not.toContain("background-clip");
  });

  it("tofu 压缩产物里忽略区守卫仍是 :not(:where(:has()))：压缩器不能把它拆成裸 :not(:has())（否则不认 :has 的浏览器会整条规则作废）", () => {
    const dist = readFileSync("dist/tofu.css", "utf8");
    expect(dist.split(":not(:where(:has([skz-ignore])))").length - 1).toBe(4);
    expect(dist).not.toContain(":not(:has(");
    expect(dist).not.toContain("@supports");
  });

  it("tofu 字体只在 tofu.css / all.css 里，base / global / svg / sweep / explicit 不带", () => {
    for (const name of ["base", "explicit", "global", "svg", "sweep"]) {
      const out = css(name);
      expect(out, name).not.toContain("@font-face");
      expect(out, name).not.toContain("data:font");
      expect(out, name).not.toContain("skz-tofu");
    }
    expect(css("all")).toContain("data:font/woff2;base64,");
    expect(count(css("all"), "@font-face")).toBe(1);
  });

  it("sweep：只有一种，没有 skz-sweep 属性；深色走容器色（无混合模式、无遮罩），倾斜角由变量决定（默认 -12deg）", () => {
    const out = css("sweep");
    expect(out).not.toContain("skz-sweep=");
    expect(out).not.toContain("soft-light");
    expect(out).toContain("--skz-sweep-bg-rgb: 31, 41, 55");
    expect(out).toContain("--skz-sweep-skew: -12deg");
    expect(out).toContain("--skz-sweep-blend: normal");
    expect(out).toContain("--skz-sweep-mask: none");
    expect(out.match(/@keyframes skz-sweep/g)).toHaveLength(1);
  });

  it("base：clip 是默认文字模式（非 underline 非 leaf），不支持 background-clip:text 时撤回", () => {
    const out = css("base");
    expect(out).toContain(`${CLIP_ROOT} {`);
    expect(out).toMatch(/--skz-ul-thickness: 1\.22em/);
    // 下划线上移 0.07em（底边不变），盖住 █ 方块字形顶部，避免含 █ 的行比普通文字行高、空格处出现缺口
    expect(out).toMatch(/--skz-ul-offset: -0\.92em/);
    expect(out).toContain("background-clip: text");
    // 装饰线颜色走 --skz-dc：clip 根设透明（继承给后代），不再有 clip 专用的通配规则；
    // tbg / timg 只置为静态的 initial（防嵌套在 underline / tofu 根里时继承 transparent），不再转发逐帧变化的 --skz-fill
    expect(rule(out, CLIP_ROOT)).toContain("--skz-dc: transparent");
    expect(rule(out, CLIP_ROOT)).toContain("--skz-tbg: initial");
    expect(rule(out, CLIP_ROOT)).not.toMatch(/--skz-(tbg|timg): var\(/);
    expect(out).not.toContain(`${CLIP_ROOT} *:not([skz-ignore])`);
    expect(out).toContain("text-decoration-color: var(--skz-dc, var(--skz-ul-fill, var(--skz-color))) !important");
    expect(out).toMatch(/@supports not \(\(-webkit-background-clip: text\) or \(background-clip: text\)\)|@supports not \(-webkit-background-clip: text\) or \(background-clip: text\)/);
    // 撤回分支：clip 根恢复 underline 的值（--skz-dc 清掉，装饰线颜色读 --skz-ul-fill / --skz-color）
    const fallback = out.slice(out.indexOf("@supports not"));
    expect(fallback).toContain("--skz-tbg: transparent");
    expect(fallback).toContain("--skz-timg: none");
    expect(fallback).toContain("--skz-dc: initial");
  });

  it("所有入口：不含 data URI 和 skz-mode；all、global 不含 skz-fallback", () => {
    for (const name of ALL_ENTRIES) {
      const out = css(name);
      expect(out, name).not.toContain("data:image/svg");
      expect(out, name).not.toContain("skz-mode");
    }
    expect(css("all")).not.toContain("skz-fallback");
    expect(css("global")).not.toContain("skz-fallback");
  });

  it("SVG 根规则：global、svg、all 都有，all 里只有一份（Sass 同模块只输出一次）", () => {
    for (const name of ["global", "svg", "all"]) expect(css(name), name).toContain(SVG_ROOT);
    expect(count(css("all"), SVG_ROOT)).toBe(1);
  });
});

describe("base 的推导规则", () => {
  it("tier0 圆角用 :is() 收拢成单条 :where 规则，读 --skz-tradius", () => {
    const out = css("base");
    const i = out.indexOf(`:where(${AUTO} :is(p, span`);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(out.slice(i, out.indexOf("}", i))).toContain("border-radius: var(--skz-tradius");
  });

  it("tier1 不再逐标签撤销背景，改成根上的变量开关：圆角归零写在文字条根（sk-clip-root）和 underline / tofu 根里，背景开关只挂 underline / tofu 根", () => {
    const out = css("base");
    // 不再有单独对非 leaf 根写 --skz-tradius: 0px 的规则（sk-text-radius 已并入两处）
    expect(out).not.toMatch(/\[skz\]:not\(\[skz-text-mode=leaf\]\)\s*\{/);
    expect(rule(out, CLIP_ROOT)).toContain("--skz-tradius: 0px");
    const colorBody = rule(out, `[skz]${COLOR_MODES}`);
    expect(colorBody).toContain("--skz-tradius: 0px");
    expect(colorBody).toContain("--skz-tbg: transparent");
    expect(colorBody).toContain("--skz-timg: none");
    expect(out).not.toMatch(/:not\(\[skz-text-mode=leaf\]\) p:not\(/);
    expect(out).not.toContain("border-radius: 0;");
  });

  it("button 是控件：走整块骨头规则，不在文字类（clip / 圆角）里，后代藏起来且不画下划线", () => {
    const out = css("base");
    // 整块骨头规则（media 那条）的选择器里有 button，文字类的 :is() 清单里没有
    const media = out.indexOf(`${AUTO} :is(img, video, canvas, picture, iframe, svg, input, textarea, select, button):not([skz-ignore]) {`);
    expect(media).toBeGreaterThanOrEqual(0);
    expect(out.slice(media, out.indexOf("}", media))).toContain("object-fit: none");
    expect(out).not.toMatch(/:is\(p, span[^)]*button/);
    // 后代藏起来；忽略区里的按钮后代恢复可见
    expect(out).toContain(`${AUTO} button:not([skz-ignore]) * {\n  visibility: hidden !important`);
    expect(out).toContain(`${AUTO} [skz-ignore] button * {\n  visibility: visible !important`);
    // 圆角：媒体与控件共用一条 :where 规则（含 button / canvas；元素自己写了 border-radius 就保留）
    expect(out).toContain(`:where(${AUTO} :is(img, video, canvas, picture, iframe, svg, input, textarea, select, button):not([skz-ignore])) {\n  border-radius: var(--skz-radius)`);
    expect(out).not.toContain(`:where(${AUTO} button:not([skz-ignore]))`);
    // 自身不画下划线，优先级(0,3,1)高于通配下划线规则(0,3,0)；后代只有 select 的 option 需要单独压（button 后代已藏起来，input / textarea 没有元素后代）
    expect(flat(out)).toContain(`${auto(NONLEAF_MOD)} :is(input, textarea, select, button):not([skz-ignore]), ${auto(NONLEAF_MOD)} select:not([skz-ignore]) * { text-decoration: none !important`);
    expect(out).not.toMatch(/:is\(input, textarea, select, button\):not\(\[skz-ignore\]\) \*/);
  });

  it("推导规则的根前缀是 skz-auto 区域：兜底层与退出兜底层都只作用于区域的直接子元素 / 后代", () => {
    const out = css("base");
    expect(count(out, `${AUTO} > *:not([skz-ignore]) {`)).toBe(2);
    expect(count(out, `${AUTO} > * * {`)).toBe(2);
    expect(out).not.toMatch(/(^|\n)\[skz\] > /);
  });

  it("所有入口：不含 [skz][skz]、skz-box[、旧前缀", () => {
    for (const name of ALL_ENTRIES) {
      const out = css(name);
      expect(out).not.toContain("[skz][skz]");
      expect(out).not.toContain("skz-box[");
      expect(out).not.toContain(OLD_PREFIX);
    }
  });

  it("base 和 explicit 编译结果里藏文字改用 text-fill-color，除了兜底", () => {
    // 兜底层 base.scss 有 1 处 color: transparent
    // tier2.scss (在 base 入口里) 的图标伪元素有 1 处
    // 使用带边界的正则，避免匹配到 background-color: transparent 等
    const countColorTransparent = (text: string) => {
      const matches = text.match(/(?<!-|\w)color:\s*transparent/g);
      return matches ? matches.length : 0;
    };
    expect(countColorTransparent(css("base"))).toBe(2);
    expect(countColorTransparent(css("explicit"))).toBe(0);

    expect(css("base")).toMatch(/-webkit-text-fill-color:\s*transparent/);
    expect(css("explicit")).toMatch(/-webkit-text-fill-color:\s*transparent/);
  });

  it("包含忽略区的 text-fill-color 撤销规则", () => {
    const out = css("base");
    // 不带 !important 的版本
    expect(out).toMatch(/\[skz\] \[skz-ignore\] \{\s*[^}]*-webkit-text-fill-color: currentColor;[^}]*\}/);
    // 带 !important 的版本 (后代撤销)
    expect(out).toMatch(/\[skz\] \[skz-ignore\] \*:not\(\[skz-ignore\]\):not\(\[skz-x\]\) \{\s*[^}]*-webkit-text-fill-color: currentColor !important;\s*\}/);
  });
});

describe("根驱动动画（core / explicit / base 共用）与防火墙（global）", () => {
  it("降频时间函数只写在 var() 兜底里，不在根上声明 --skz-shimmer-timing（否则盖掉用户写在祖先上的覆盖）", () => {
    const out = css("base");
    expect(out).toContain(SHIMMER_TIMING);
    expect(out).not.toMatch(/--skz-shimmer-timing:/);
  });

  it("shimmer 根动画读 --skz-shimmer-timing，其次档位档数，缺省 steps(30)（2s 下扫过段 24 次/秒）", () => {
    const out = css("base");
    expect(rule(out, "[skz][skz-effect=shimmer]")).toContain(`animation: ${SHIMMER_ANIM};`);
  });

  it("光带进度 0 → 1，扫过占 62.5%，之后停在屏幕外直到一轮结束；@property 初始值 0", () => {
    const out = css("base");
    expect(flat(out)).toContain("@keyframes skz-shimmer-root { from { --skz-shimmer-p: 0; } 62.5%, to { --skz-shimmer-p: 1; } }");
    expect(flat(out)).toMatch(/@property --skz-shimmer-p \{[^}]*initial-value: 0;/);
  });

  it("光带位置按光带宽换算：-光带宽 → 100vw，宽度默认 400px，背景尺寸 = 光带宽 × 100vh", () => {
    const out = css("base");
    const band = "var(--skz-band, 400px)";
    expect(flat(rule(out, "[skz][skz-effect=shimmer]"))).toContain(`--skz-bg-pos: calc(var(--skz-shimmer-p) * (100vw + ${band}) - ${band}) 0`);
    expect(out).toContain(`var(--skz-bg-size, ${band} 100vh)`);
    expect(out).not.toContain("60vw");
  });

  it("shimmer 三档（小屏优先）：< 640px 2s / steps(30)，≥ 640px 2.8s / steps(42)，≥ 1280px 3.6s / steps(54)；档位变量是内部变量", () => {
    const out = flat(css("base"));
    expect(out).toContain("[skz] { --skz-tier-dur: 2s; --skz-tier-steps: steps(30); }");
    expect(out).toMatch(/@media \(min-width: 640px\) \{ \[skz\] \{ --skz-tier-dur: 2\.8s; --skz-tier-steps: steps\(42\); \} \}/);
    expect(out).toMatch(/@media \(min-width: 1280px\) \{ \[skz\] \{ --skz-tier-dur: 3\.6s; --skz-tier-steps: steps\(54\); \} \}/);
  });

  it("时长兜底链：shimmer 用 --skz-duration > 档位 > 2s；pulse / fade / sweep 只有 --skz-duration > 2s；根上不声明 --skz-duration", () => {
    const base = css("base");
    expect(rule(base, "[skz][skz-effect=shimmer]")).toContain(SHIMMER_DUR);
    expect(rule(base, "[skz][skz-effect=pulse]")).toContain(`skz-pulse-root ${PLAIN_DUR}`);
    expect(base).toContain(`animation: skz-fade ${PLAIN_DUR}`);
    expect(css("sweep")).toContain(`skz-sweep ${PLAIN_DUR}`);
    for (const name of ["core", "explicit", "base", "global", "sweep"]) expect(css(name), name).not.toMatch(/--skz-duration:/);
  });

  it("clip（默认）根的 shimmer 不挂 skz-pulse-root，也不声明 --skz-ul-fill", () => {
    const body = rule(css("base"), "[skz][skz-effect=shimmer]");
    expect(body).not.toContain("skz-pulse-root");
    expect(body).not.toContain("--skz-ul-fill");
  });

  it("underline / tofu 根的 shimmer 额外挂 pulse，同样用 --skz-shimmer-timing 降频；:where() 保持低优先级", () => {
    const body = rule(css("base"), `[skz][skz-effect=shimmer]${COLOR_MODES}`);
    expect(body).toContain(SHIMMER_ANIM);
    expect(body).toContain(PULSE_ANIM);
  });

  it("--skz-ul-fill 只挂在 underline / tofu 根上（pulse、shimmer 都是），pulse 根自己不再声明", () => {
    const out = css("base");
    expect(rule(out, `[skz]:is([skz-effect=pulse], [skz-effect=shimmer])${COLOR_MODES}`)).toContain("--skz-ul-fill: var(--skz-pulse-c)");
    expect(rule(out, "[skz][skz-effect=pulse]")).not.toContain("--skz-ul-fill");
  });

  it("单独的 pulse 效果的时间函数不变（ease-in-out，不读降频变量）", () => {
    const body = rule(css("base"), "[skz][skz-effect=pulse]");
    expect(body).toContain(`animation: skz-pulse-root ${PLAIN_DUR} ease-in-out infinite alternate`);
    expect(body).not.toContain("shimmer-timing");
  });

  it("iOS 分支：shimmer 去掉光带图、--skz-fill 读 pulse，仍然挂 pulse 动画（core / explicit / base 都有）；防火墙里同步钉住 --skz-fill（global）", () => {
    for (const name of DRIVER_ENTRIES) {
      const out = css(name);
      const i = out.indexOf("@supports (-webkit-touch-callout: none)");
      expect(i, name).toBeGreaterThanOrEqual(0);
      const ios = out.slice(i, out.indexOf("}", i));
      expect(ios, name).toContain("--skz-bg-img: none");
      expect(ios, name).toContain("--skz-fill: var(--skz-pulse-c)");
      expect(ios, name).toContain(SHIMMER_ANIM);
      expect(ios, name).toContain(PULSE_ANIM);
    }
    const fw = css("global");
    // svg 的根规则里也有一个 iOS 分支，防火墙的在后面
    const j = fw.lastIndexOf("@supports (-webkit-touch-callout: none)");
    expect(j).toBeGreaterThanOrEqual(0);
    expect(fw.slice(j, fw.indexOf("}", j))).toMatch(/\[skz\]\[skz-effect=shimmer\] \[skz-fw\] \{\s*--skz-fill: var\(--skz-pulse-c\)/);
  });

  it("防火墙：根上没有 --skz-tbg / --skz-timg 别名了，不需要再为 clip 根钉它们；--skz-ul-fill 只为 underline / tofu 根钉", () => {
    const out = css("global");
    expect(out).not.toMatch(/--skz-(tbg|timg)/);
    // 原有的变量仍然钉着
    expect(rule(out, "[skz] [skz-fw]")).toContain("--skz-pulse-c: var(--skz-color)");
    const pulseFw = rule(out, "[skz][skz-effect=pulse] [skz-fw]");
    expect(pulseFw).toContain("--skz-fill: var(--skz-pulse-c)");
    expect(pulseFw).not.toContain("--skz-ul-fill");
    expect(rule(out, "[skz] [skz-fw]")).toContain("--skz-shimmer-p: 0");
    expect(rule(out, `[skz]:is([skz-effect=pulse], [skz-effect=shimmer])${COLOR_MODES} [skz-fw]`)).toContain("--skz-ul-fill: var(--skz-pulse-c)");
  });
});

describe("clip 正向选择器", () => {
  it("完整版：文字条家族根 = 没写 skz-text-mode / 明写 round / 明写 clip；不再用 :not(underline):not(leaf):not(tofu) 排除法", () => {
    const out = css("base");
    expect(out).toContain(`${CLIP_ROOT} {`);
    expect(out).not.toContain(":not([skz-text=underline])");
    expect(out).not.toContain(":not([skz-text=tofu])");
    // 作前缀拼后代选择器时用 :is() 收拢两个根（各自带 skz-auto 区域的两种写法）：自动推导的 clip 填充一处，显式 skz-text 标记的 clip 填充一处
    expect(out).toContain(`${auto(CLIP_MOD)} :is(p, span`);
    // 自动推导一处、显式 skz-text 标记一处，都读 --skz-bgclip；字面量 background-clip:text 只剩不支持时撤回分支的 @supports 条件里
    // （-webkit- 前缀一行 + 标准写法一行，各两处）
    expect(count(out, "background-clip: var(--skz-bgclip, text);")).toBe(4);
    expect(out).not.toMatch(/ background-clip: text;/);
  });

  it("未知取值（含 tofu 没引 tofu.css）落到 underline 外观：不是 clip，背景开关（--skz-tbg / --skz-timg）和纯色驱动按 color 处理；leaf 不受影响", () => {
    const out = css("base");
    // 背景色退场的开关挂在"有 skz-text 且不是 clip / leaf"的根上
    const color = rule(out, `[skz]${COLOR_MODES}`);
    expect(color).toContain("--skz-tbg: transparent");
    expect(color).toContain("--skz-timg: none");
    // 下划线形状对所有非 leaf 根生效（含未知取值），leaf 根被排除；圆角归零由文字条根和 color 根各自声明
    expect(color).toContain("--skz-tradius: 0px");
    expect(rule(out, CLIP_ROOT)).toContain("--skz-tradius: 0px");
    expect(out).toContain(`${auto(NONLEAF_MOD)} *:not([skz-ignore]),`);
    // clip 的透明装饰线、填充都不碰 underline / leaf / tofu / 未知取值
    expect(rule(out, CLIP_ROOT)).toContain("--skz-dc: transparent");
    // leaf 根自己的规则还在，且没写 skz-text=leaf 的根不会进去
    expect(out).toContain(`${auto("[skz-text-mode=leaf]")} *:not([skz-ignore]) {`);
    // 没引 tofu.css（base 不含方块字体）：tofu 根没有任何专属规则，只会走上面的 underline 外观
    expect(out).not.toContain("skz-tofu");
  });

  it("underline / tofu / 未知取值的根复位 round / clip 根写的 gradient 驱动变量，嵌套在文字条根里时才不会继承 --skz-ul-line: none / 透明装饰线", () => {
    const out = css("base");
    const body = rule(out, `[skz]${COLOR_MODES}`);
    for (const decl of ["--skz-ul-line: initial", "--skz-dc: initial", "--skz-bgclip: initial", "--skz-bdb: initial"]) expect(body, decl).toContain(decl);
    // core 不认 underline / tofu 根，没有这条规则
    expect(css("core")).not.toContain(COLOR_MODES);
  });

  it("自动推导和显式 skz-text 的下划线声明合并成一条规则（不再各写一份）；explicit 没有推导，只有标记那部分", () => {
    for (const name of ["core", "explicit", "base"]) expect(count(css(name), "text-decoration-skip-ink: none"), name).toBe(1);
    const mark = `${CLIP_ROOT} :where([skz-text]) *:not([skz-ignore]) {`;
    expect(css("explicit")).toContain(mark);
    expect(css("explicit")).not.toContain(`${auto(CLIP_MOD)} *:not([skz-ignore])`);
    expect(css("core")).toContain(`${auto(CLIP_MOD)} *:not([skz-ignore]),`);
    expect(css("core")).toContain(mark);
  });

  it("core：文字条根只认 round / clip 家族（没写 skz-text-mode、round、clip），没有 underline / leaf / tofu", () => {
    const out = css("core");
    expect(out).not.toContain("[skz][skz-text-mode");
    expect(out).toContain(`${auto(CLIP_MOD)} :is(p, span`);
    expect(out).not.toMatch(TEXT_MODE_VALUE);
  });
});

describe("round（默认文字模式）：同一批 clip 规则 + 根上变量切换，门控在 box-decoration-break", () => {
  /** round 根规则体：从特性查询开头到它里面第一条规则的结尾 */
  const roundBlock = (out: string): string => {
    const i = out.indexOf(ROUND_SUPPORTS);
    expect(i).toBeGreaterThanOrEqual(0);
    return out.slice(i, out.indexOf("}", i));
  };

  it("core / explicit / base：round 根规则只有一条，在 box-decoration-break 的 @supports 里（含 -webkit- 前缀写法），只认没写 skz-text-mode / 明写 round 的根", () => {
    for (const name of ["core", "explicit", "base", "all"]) {
      const out = css(name);
      expect(count(out, ROUND_SUPPORTS), name).toBe(1);
      const body = roundBlock(out);
      expect(body, name).toContain(`[skz]${ROUND_MOD} {`);
      expect(body, name).toContain("--skz-ul-line: none");
      expect(body, name).toContain("--skz-bgclip: border-box");
      expect(body, name).toContain("--skz-bdb: clone");
      // 圆角清掉 sk-clip-root 的 0px，回落到现有的 --skz-radius，不新造圆角变量
      expect(body, name).toContain("--skz-tradius: initial");
      expect(body, name).not.toMatch(/skz-text-mode=clip|skz-text-mode=leaf|skz-text-mode=underline|skz-text-mode=tofu/);
    }
    expect(css("global")).not.toContain("box-decoration-break");
    expect(css("sweep")).not.toContain("box-decoration-break");
  });

  it("round 排在 clip 根变量（含圆角归零）之后（同优先级靠顺序覆盖），clip 根的复位在 round 之前", () => {
    for (const name of ["core", "explicit", "base"]) {
      const out = css(name);
      const round = out.indexOf(ROUND_SUPPORTS);
      const clipRoot = out.indexOf(`${CLIP_ROOT} {`);
      expect(clipRoot, name).toBeGreaterThanOrEqual(0);
      expect(rule(out, CLIP_ROOT), name).toContain("--skz-tradius: 0px");
      expect(clipRoot, name).toBeLessThan(round);
      const radius0 = out.indexOf("--skz-tradius: 0px");
      const reset = out.indexOf("--skz-ul-line: initial");
      expect(radius0, name).toBeGreaterThanOrEqual(0);
      expect(radius0, name).toBeLessThan(round);
      expect(reset, name).toBeGreaterThanOrEqual(0);
      expect(reset, name).toBeLessThan(round);
    }
  });

  it("clip 根（明写 clip，以及 round 不支持时的默认）：文字条家族根上把三个开关复位成 clip 的值，嵌套在 round 根里的 clip 根才不继承 round", () => {
    for (const name of ["core", "explicit", "base"]) {
      const out = css(name);
      const i = out.indexOf("--skz-dc: transparent");
      expect(i, name).toBeGreaterThanOrEqual(0);
      // 声明所在的规则：选择器是文字条家族根
      expect(out.slice(out.lastIndexOf("}", i), i), name).toContain(`${CLIP_ROOT} {`);
      const body = out.slice(i, out.indexOf("}", i));
      expect(body, name).toContain("--skz-ul-line: initial");
      expect(body, name).toContain("--skz-bgclip: initial");
      expect(body, name).toContain("--skz-bdb: initial");
      // clip 原有的变量不变
      expect(body, name).toContain("--skz-ul-thickness: 1.22em");
      expect(body, name).toContain("--skz-ul-offset: -0.92em");
    }
  });

  it("目标规则只读变量、缺省值就是 clip 原来的写法：装饰线 underline、background-clip:text、box-decoration-break:slice；没有写死的 clone / border-box", () => {
    for (const name of ["core", "explicit", "base"]) {
      const out = css(name);
      expect(out, name).toContain("text-decoration-line: var(--skz-ul-line, underline) !important");
      expect(out, name).not.toMatch(/text-decoration-line: underline/);
      expect(out, name).toContain("box-decoration-break: var(--skz-bdb, slice)");
      expect(out, name).toContain("-webkit-box-decoration-break: var(--skz-bdb, slice)");
      // 写死的 clone 只出现在特性查询条件里；border-box 只出现在 round 根变量里
      expect(
        out
          .replace(roundBlock(out), "")
          .replace(ROUND_SUPPORTS, "")
          .match(/box-decoration-break: clone|--skz-bgclip: border-box/g) ?? [],
        name,
      ).toEqual([]);
    }
  });

  it("underline / leaf / tofu 根不受影响：round 根选择器不含它们；color 驱动的挂载选择器把 round 排除在外", () => {
    const base = css("base");
    expect(roundBlock(base)).not.toContain("leaf");
    expect(COLOR_MODES).toContain(":not([skz-text-mode=round])");
    expect(rule(base, `[skz]${COLOR_MODES}`)).toContain("--skz-tbg: transparent");
  });

  it("完整版：不支持 background-clip:text 的撤回分支排在 round 之后，同时把 --skz-ul-line 清回缺省（round 根同样退回 underline，不会文字透明又没形状）", () => {
    const out = css("base");
    const fallback = out.indexOf("@supports not");
    expect(fallback).toBeGreaterThan(out.indexOf(ROUND_SUPPORTS));
    const body = out.slice(fallback, out.indexOf("}", fallback));
    expect(body).toContain("--skz-ul-line: initial");
    expect(body).toContain(`${CLIP_ROOT} {`);
  });

  it("core 的门槛里没有 background-clip:text 的撤回分支，round 的降级只靠根变量缺省（不需要 @supports not）", () => {
    expect(css("core")).not.toContain("@supports not");
    expect(css("explicit")).not.toContain("@supports not");
  });
});

describe("默认即显式：skz-text 标记与 skz-auto 推导区域", () => {
  it("(c) 推导规则只在 skz-auto 区域前缀下出现：core / base 里没有不带 skz-auto 的文字类推导选择器，兜底层 / 图标 / 控件同理", () => {
    for (const name of ["core", "base", "all"]) {
      const out = css(name);
      expect(unguardedText(out), name).toEqual([]);
      // 根后面直接接空格 + 标签 / 通配的旧写法（[skz] p、[skz] > *、[skz] svg …）一条都不该有；显式标记（[skz] [skz-xxx]）除外
      expect(out, name).not.toMatch(/\[skz\](:not\([^)]*\))* (?!\[skz-)(\*|[a-z]+(:|\s|,|\{))/);
      expect(out, name).not.toMatch(/(^|\n|, )\[skz\] > /);
    }
    expect(css("explicit")).not.toContain("skz-auto");
    expect(css("global")).not.toContain("skz-auto");
  });

  it("(d) skz-auto 写在根自身和写在根内后代两种情况都能命中：前缀同时含 [skz]:where([skz-auto]) 与 [skz] :where([skz-auto])，根限定始终挂在 [skz] 根上", () => {
    const out = compileString('@use "lists" as *; @use "sass:string"; x { a: string.unquote(sk-auto()); b: string.unquote(sk-auto(":not([skz-text-mode=leaf])")); }', { loadPaths: ["src/styles"] }).css;
    expect(out).toContain(`a: ${AUTO};`);
    expect(out).toContain(`b: ${auto(NONLEAF_MOD)};`);
    expect(AUTO).toContain("[skz]:where([skz-auto])");
    expect(AUTO).toContain("[skz] :where([skz-auto])");
    // 区域自己的限定后缀写在 [skz] 上，不会拼到 skz-auto 后面
    expect(auto(NONLEAF_MOD)).toContain("[skz]:not([skz-text-mode=leaf]):where([skz-auto])");
    expect(auto(NONLEAF_MOD)).toContain("[skz]:not([skz-text-mode=leaf]) :where([skz-auto])");
    // skz-auto 在 :where() 里不计优先级：区域前缀的优先级和旧的单 [skz] 一样
    const out2 = css("core");
    expect(out2).not.toMatch(/\[skz\]\[skz-auto\]/);
  });

  it("(b) skz-text 标记：core / explicit 只有文字条家族（round / clip，根限定 CLIP_MOD），base 另有 leaf；标记元素读文字骨头变量，后代画（透明）下划线", () => {
    for (const name of ["core", "explicit"]) {
      const out = css(name);
      const target = `[skz]${CLIP_MOD} [skz-text]:where(:not([skz-ignore], [skz-bone], [skz-leaf], [skz-leaf] *, [skz-ignore] *))`;
      expect(flat(out), name).toContain(`${target} { background-color: var(--skz-tbg, var(--skz-fill, var(--skz-color))) !important;`);
      expect(out, name).toContain(`[skz]${CLIP_MOD} :where([skz-text]) *:not([skz-ignore])`);
      expect(rule(out, `[skz]${CLIP_MOD}`)).toBeTruthy();
      expect(out, name).not.toContain("[skz-text-mode=leaf] [skz-text]");
    }
    const base = css("base");
    expect(base).toContain(`${CLIP_ROOT} [skz-text]:where(`);
    expect(base).toContain(`[skz]${NONLEAF_MOD} :where([skz-text]) *:not([skz-ignore])`);
    // leaf 根：标记元素整块当骨头（同 skz-bone）
    const leaf = rule(base, "[skz][skz-text-mode=leaf] [skz-text]:where(:not([skz-ignore], [skz-bone], [skz-leaf], [skz-leaf] *, [skz-ignore] *))");
    expect(leaf).toContain("-webkit-text-fill-color: transparent !important");
    // clip 标记元素的背景读 --skz-tbg，所以不支持 background-clip:text 时同样退回 underline
    expect(base).toContain("@supports not");
    // 下划线形状是标记元素自己 + 后代，装饰线颜色走 --skz-dc
    expect(base).toMatch(/\[skz\]:not\(\[skz-text-mode=leaf\]\) \[skz-text\]:where\([^{]*\{[^}]*text-decoration-color: var\(--skz-dc/);
  });

  it("标记规则只认根的后代（[skz] [skz-text]），不认根自身，也没有不带 [skz] 的 [skz-text] 规则", () => {
    for (const name of ["core", "explicit", "base", "all"]) {
      const out = css(name);
      expect(out, name).not.toMatch(/(^|\n|, )\[skz-text\]/);
      expect(out, name).not.toMatch(/\[skz\]\[skz-text\]/);
    }
  });

  it("skz-has-ignore 已移除：所有入口都不再出现；忽略区不再关祖先的下划线，:has([skz-ignore]) 只剩根上的 fade 撤销和 tofu 守卫", () => {
    for (const name of ALL_ENTRIES) expect(css(name), name).not.toContain("skz-has-ignore");
    for (const name of ["core", "explicit", "base", "all"]) {
      const out = css(name);
      // 已删除的下划线修正：skz-auto 区域和 skz-text 子树里「含忽略区的祖先 text-decoration:none」都不再出现
      expect(flat(out), name).not.toMatch(/:has\(\[skz-ignore\]\):not\(\[skz-ignore\]\)\s*\{[^}]*text-decoration: none/);
      expect(out, name).not.toContain("*:has([skz-ignore]):not([skz-ignore])");
      // 其余 :has([skz-ignore]) 只出现在根上（默认 fade / pulse、shimmer 退回 fade 的撤销，每个根只检查一次）和 tofu 的 :not(:where(:has())) 守卫里
      const stray = (out.match(/[^\n{},]*:has\(\[skz-ignore\]\)[^\n{]*/g) ?? []).map((m) => m.trim()).filter((m) => !m.includes(":not(:where(:has([skz-ignore])))"));
      for (const m of stray)
        expect(m, name).toMatch(/^(\[skz\]:not\(\[skz-effect\]\):has\(\[skz-ignore\]\)|:where\(\[skz\]\[skz-effect=pulse\]:has\(\[skz-ignore\]\), \[skz\]\[skz-effect=shimmer\]:has\(\[skz-ignore\]\)\))$/);
    }
    const fade = css("core");
    expect(fade).toContain("@supports selector(:has(*)) {\n  [skz]:not([skz-effect]):has([skz-ignore]) {\n    animation: none;");
    // 老浏览器（不认 :has）仍保留默认 fade：撤销规则在 @supports 里，基础规则不带 :has
    expect(fade).toContain("[skz]:not([skz-effect]),\n[skz][skz-effect=fade] {\n  animation: skz-fade");
  });
});

describe("Sass 文字模式挂载与驱动 mixin", () => {
  /** 用 src/styles 做 loadPaths 编译一小段 SCSS，去掉注释 */
  const sassOut = (src: string): string => compileString(src, { loadPaths: ["src/styles"] }).css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("color 驱动的挂载选择器：排除 round / clip / leaf 三个 gradient 模式，其余（含未知取值）都挂", () => {
    const out = sassOut('@use "sass:string"; @use "lists" as *; x { m: string.unquote($color-modes); }');
    expect(out).toContain(`m: ${COLOR_MODES.split("=round").join('="round"').split("=clip").join('="clip"').split("=leaf").join('="leaf"')};`);
  });

  it("防火墙规则的派生变量与根规则共用驱动 mixin：gradient 的 pulse / shimmer 各一条，color 一条（pulse + shimmer 合并）", () => {
    const out = css("global");
    expect(rule(out, "[skz][skz-effect=pulse] [skz-fw]")).toContain("--skz-fill: var(--skz-pulse-c)");
    expect(rule(out, "[skz][skz-effect=shimmer] [skz-fw]")).toContain("--skz-bg-pos: calc(var(--skz-shimmer-p) * (100vw + var(--skz-band, 400px)) - var(--skz-band, 400px)) 0");
    expect(rule(out, "[skz] [skz-fw]")).toContain("--skz-shimmer-p: 0");
    expect(rule(out, `[skz]:is([skz-effect=pulse], [skz-effect=shimmer])${COLOR_MODES} [skz-fw]`)).toContain("--skz-ul-fill: var(--skz-pulse-c)");
    // 根规则里的派生变量用的是同一组 mixin：声明和防火墙里的一致
    const base = css("base");
    expect(rule(base, "[skz][skz-effect=pulse]")).toContain("--skz-fill: var(--skz-pulse-c)");
    expect(rule(base, "[skz][skz-effect=shimmer]")).toContain("--skz-bg-pos: calc(var(--skz-shimmer-p) * (100vw + var(--skz-band, 400px)) - var(--skz-band, 400px)) 0");
  });
});

/** 把规则体拆成 属性 -> 值（去掉所有空白，便于比对） */
const decls = (body: string): Map<string, string> => {
  const m = new Map<string, string>();
  for (const part of body.split(";")) {
    const i = part.indexOf(":");
    if (i > 0)
      m.set(
        part.slice(0, i).trim(),
        Array.from(part.slice(i + 1))
          .filter((ch) => ch.trim() !== "")
          .join(""),
      );
  }
  return m;
};

describe("Web Component 宿主样式与 sk-bone 不漂移", () => {
  /** 宿主里比 sk-bone 多出来的 var 兜底色（宿主在没有主题变量的 shadow 页面里也要有底色） */
  const HOST_EXTRA_FALLBACK = ",#d9dde3)";

  /**
   * 找出 sk-bone 里有、宿主 ::before 里没有（或值不同）的声明
   * @param bone sk-bone 编译出的声明
   * @param host 宿主 ::before 的声明
   * @returns 缺失 / 不一致的条目描述
   */
  const drift = (bone: Map<string, string>, host: Map<string, string>): string[] => {
    const out: string[] = [];
    for (const [prop, val] of bone) {
      const hv = host.get(prop)?.replace(HOST_EXTRA_FALLBACK, ")");
      if (hv !== val) out.push(`${prop}: sk-bone=${val} 宿主=${hv ?? "（没有）"}`);
    }
    return out;
  };

  /** sk-bone 编译出的声明 */
  const boneDecls = (extra = ""): Map<string, string> => {
    const out = compileString(`@use "mixins" as *; x { @include sk-bone; ${extra} }`, { loadPaths: ["src/styles"] }).css;
    return decls(out.slice(out.indexOf("{") + 1, out.indexOf("}")));
  };

  /** 宿主 ::before 规则的声明 */
  const hostDecls = (): Map<string, string> => {
    const hostCss = buildHostCss(["x-card"]);
    const i = hostCss.indexOf("::before{");
    expect(i, "宿主样式里要有 ::before 规则").toBeGreaterThan(0);
    return decls(hostCss.slice(i + "::before{".length, hostCss.indexOf("}", i)));
  };

  it("sk-bone 的每条声明（背景色 / 位置 / 图 / 重复 / 固定 / 尺寸）宿主 ::before 里都有，且值一致（允许宿主多出 content / 定位 / 圆角和底色兜底）", () => {
    const bone = boneDecls();
    expect(bone.size).toBeGreaterThanOrEqual(6);
    expect(drift(bone, hostDecls())).toEqual([]);
    // 宿主多出来的部分（不在 sk-bone 里）：占位和定位
    const host = hostDecls();
    for (const prop of ["content", "position", "top", "right", "bottom", "left", "border-radius"]) expect(host.has(prop), prop).toBe(true);
  });

  it("漂移检测本身有效：sk-bone 多一条声明或改了值，宿主没跟就会被报出来", () => {
    expect(drift(boneDecls("background-blend-mode: multiply;"), hostDecls())).toEqual(["background-blend-mode: sk-bone=multiply 宿主=（没有）"]);
    const tampered = hostDecls();
    tampered.set("background-size", "auto");
    expect(drift(boneDecls(), tampered)).toHaveLength(1);
  });
});
