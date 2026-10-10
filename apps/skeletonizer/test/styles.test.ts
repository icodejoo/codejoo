import { readdirSync } from "node:fs";
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

/** clip（默认文字模式）的根选择器（完整版）：没写 skz-text，或明写 clip（正向选择，其他取值都不是 clip） */
const CLIP_ROOT = "[skz]:not([skz-text]), [skz][skz-text=clip]";

/** 颜色由根上变量驱动的文字模式：有 skz-text 且不是 clip / leaf（underline / tofu / 未知取值），:where() 后缀 */
const COLOR_MODES = ":where([skz-text]:not([skz-text=clip]):not([skz-text=leaf]))";

/** 带 :where() 后缀的 core 入口之外，所有基底入口（带根驱动） */
const DRIVER_ENTRIES = ["core", "explicit", "base"];

/** 文字模式取值名：core / explicit / global 里不应出现 */
const TEXT_MODE_VALUE = /skz-text=(clip|underline|leaf|tofu)/;

/** 降频时间函数（缺省值写在 var() 兜底里） */
const SHIMMER_TIMING = "var(--skz-shimmer-timing, steps(36))";

/** shimmer 的光带动画声明（只挂光带） */
const SHIMMER_ANIM = `skz-shimmer-root var(--skz-duration) ${SHIMMER_TIMING} infinite`;

/** underline / tofu / iOS 的 shimmer 额外挂的 pulse 动画 */
const PULSE_ANIM = `skz-pulse-root var(--skz-duration) ${SHIMMER_TIMING} infinite alternate`;

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

  it("core：现代档用一个 @supports 同时要求 text-decoration-thickness 和 :has()，没有撤回分支，没有文字模式取值名", () => {
    const core = css("core");
    expect(count(core, "@supports (text-decoration-thickness: 1em) and selector(:has(*)) {")).toBe(1);
    // 门槛已保证 background-clip:text，不带撤回分支；只有现代档 / 根驱动 / iOS 三个 @supports
    expect(core).not.toContain("@supports not");
    expect(count(core, "@supports")).toBe(3);
    expect(core).toContain("background-clip: text");
    expect(core).not.toMatch(TEXT_MODE_VALUE);
    // 根选择器只认没写 skz-text 的根：同时引完整版样式时，core 的规则碰不到 leaf / underline / tofu 根
    expect(core).toContain("[skz]:not([skz-text]) :is(p, span");
    expect(rule(core, "[skz]:not([skz-text])")).toContain("--skz-tradius: 0px");
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
      expect(out, name).not.toContain("skz-text=leaf");
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
      expect(out, name).toContain("@supports (-webkit-touch-callout: none)");
      expect(out, name).toContain("@media (prefers-reduced-motion: reduce)");
      expect(out, name).toContain("[skz-fit] {");
      expect(out, name).toContain("[skz-fit-hide]");
    }
  });

  it("core 入口 = 第 0 档 + 现代档 + 标记 + 根驱动：有 tier0 的文字标签骨头、图标启发式、控件整块，没有 underline / leaf", () => {
    const core = css("core");
    expect(core).toContain("[skz] p:not([skz-ignore])");
    expect(core).toContain("[skz] :is(i:empty, [class*=icon]:empty):not([skz-ignore]) {");
    expect(core).toContain("[skz][skz-has-ignore]:not([skz-text]) *:has([skz-ignore]):not([skz-ignore])");
    expect(core).toContain("[skz]:not([skz-text]) select:not([skz-ignore]) *");
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
    const exit = base.indexOf("[skz] > *:not([skz-ignore]) {\n  background-image: none");
    const tier0 = base.indexOf("[skz] p:not([skz-ignore])");
    expect(fallback).toBeGreaterThanOrEqual(0);
    expect(fallback).toBeLessThan(exit);
    expect(exit).toBeLessThan(tier0);
    for (const name of ["core", "global", "svg"]) expect(css(name), name).not.toMatch(/skz-paused|skz-cv/);
  });

  it("base 含 core 的全部能力：根驱动、fade、marks、控件 / 图标 / 忽略区规则，另有完整的 tier1 / tier2（underline / leaf）", () => {
    const base = css("base");
    expect(base).toContain("text-decoration-thickness: 1em");
    expect(base).toContain("[skz][skz-text=leaf] *:not([skz-ignore])");
    expect(base).toContain("@supports selector(:has(*))");
    expect(base).toContain("[skz] :is(i:empty, [class*=icon]:empty):not([skz-ignore]) {");
    // core 的合并现代档只在 core.css，不重复叠进 base（同一批规则在 base 里由 tier1 / tier2 带完整根选择器生成）
    expect(base).not.toContain("@supports (text-decoration-thickness: 1em) and selector");
    // pulse / shimmer 的纯色驱动（underline / tofu）只在 base
    expect(rule(base, `[skz]:is([skz-effect=pulse], [skz-effect=shimmer])${COLOR_MODES}`)).toContain("--skz-ul-fill: var(--skz-pulse-c)");
  });

  it("base：pulse / shimmer 退回 fade 的规则在 :where() 里（优先级 0，不能压过变体）", () => {
    const out = css("base");
    expect(out).toMatch(/:where\(\[skz\]\[skz-effect=pulse\]:not\(\[skz-has-ignore\]\)/);
    // 不允许出现优先级高于 (0,2,0) 的 pulse / shimmer fade 规则
    expect(out).not.toMatch(/^\[skz\]\[skz-effect=(pulse|shimmer)\]:not/m);
  });

  it("explicit：不含任何推导规则，只认显式标记", () => {
    const out = css("explicit");
    expect(out).not.toMatch(/text-decoration-thickness|:has\(|skz-mode/);
    expect(out).toContain("[skz] [skz-bone] *");
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
    expect(out).toContain("[skz][skz-text=tofu]");
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
    // 只对 tofu 根生效；排除忽略区 / 骨头 / 叶子 / 媒体与控件内部
    expect(out).toContain("[skz][skz-text=tofu]:not([skz-has-ignore]) :is(p, span");
    // 根上有忽略区时，含 skz-ignore 的文字元素不套方块（行内忽略区否则会被画成骨头），需要 :has
    expect(out).toMatch(/@supports selector\(:has\(\*\)\)\s*\{\s*\[skz\]\[skz-text=tofu\]\[skz-has-ignore\] :is\(p, span[^{]*:not\(:has\(\[skz-ignore\]\)\)/);
    expect(out).toContain(":not([skz-ignore] *)");
    expect(out).toMatch(/:not\(:is\(img, video, canvas, picture, iframe, svg, input, textarea, select, button\) \*\)/);
    // 不画下划线也不用 background-clip
    expect(out).not.toContain("background-clip");
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
    expect(out).toMatch(/--skz-ul-thickness: 1\.15em/);
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
    expect(out).toMatch(/:where\(\[skz\] :is\(p, span[^)]*\):not\(\[skz-ignore\]\)\)\s*\{\s*border-radius: var\(--skz-tradius/);
  });

  it("tier1 不再逐标签撤销背景，改成根上的变量开关：圆角归零对非 leaf 根，背景开关只挂 underline / tofu 根", () => {
    const out = css("base");
    expect(out).toMatch(/\[skz\]:not\(\[skz-text=leaf\]\)\s*\{\s*--skz-tradius: 0px;\s*\}/);
    const colorBody = rule(out, `[skz]${COLOR_MODES}`);
    expect(colorBody).toContain("--skz-tbg: transparent");
    expect(colorBody).toContain("--skz-timg: none");
    expect(out).not.toMatch(/:not\(\[skz-text=leaf\]\) p:not\(/);
    expect(out).not.toContain("border-radius: 0;");
  });

  it("button 是控件：走整块骨头规则，不在文字类（clip / 圆角）里，后代藏起来且不画下划线", () => {
    const out = css("base");
    // 整块骨头规则（media 那条）的选择器里有 button，文字类的 :is() 清单里没有
    expect(out).toMatch(/\[skz\] select:not\(\[skz-ignore\]\),\s*\[skz\] button:not\(\[skz-ignore\]\)\s*\{[^}]*object-fit: none/);
    expect(out).not.toMatch(/:is\(p, span[^)]*button/);
    // 后代藏起来；忽略区里的按钮后代恢复可见
    expect(out).toMatch(/\[skz\] button:not\(\[skz-ignore\]\) \*\s*\{\s*visibility: hidden !important/);
    expect(out).toMatch(/\[skz\] \[skz-ignore\] button \*\s*\{\s*visibility: visible !important/);
    // 圆角：独立的 :where 规则（按钮自己写了 border-radius 就保留）
    expect(out).toMatch(/:where\(\[skz\] button:not\(\[skz-ignore\]\)\)\s*\{\s*border-radius: var\(--skz-radius\)/);
    // 自身不画下划线，优先级(0,3,1)高于通配下划线规则(0,3,0)；后代只有 select 的 option 需要单独压（button 后代已藏起来，input / textarea 没有元素后代）
    expect(out).toMatch(
      /\[skz\]:not\(\[skz-text=leaf\]\) :is\(input, textarea, select, button\):not\(\[skz-ignore\]\),\s*\[skz\]:not\(\[skz-text=leaf\]\) select:not\(\[skz-ignore\]\) \*\s*\{\s*text-decoration: none !important/,
    );
    expect(out).not.toMatch(/:is\(input, textarea, select, button\):not\(\[skz-ignore\]\) \*/);
  });

  it("推导规则的根前缀现在是单 [skz]：退出兜底层的规则", () => {
    const out = css("base");
    expect(out).toContain("[skz] > *:not([skz-ignore]) {");
    expect(out).toContain("[skz] > * * {");
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

  it("shimmer 根动画读 --skz-shimmer-timing，缺省 steps(36)（24 次/秒）", () => {
    const out = css("base");
    expect(rule(out, "[skz][skz-effect=shimmer]")).toContain(`animation: ${SHIMMER_ANIM};`);
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
    expect(body).toContain("animation: skz-pulse-root var(--skz-duration) ease-in-out infinite alternate");
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
    expect(rule(out, `[skz]:is([skz-effect=pulse], [skz-effect=shimmer])${COLOR_MODES} [skz-fw]`)).toContain("--skz-ul-fill: var(--skz-pulse-c)");
  });
});

describe("clip 正向选择器", () => {
  it("完整版：clip 根 = 没写 skz-text 或明写 clip；不再用 :not(underline):not(leaf):not(tofu) 排除法", () => {
    const out = css("base");
    expect(out).toContain(`${CLIP_ROOT} {`);
    expect(out).not.toContain(":not([skz-text=underline])");
    expect(out).not.toContain(":not([skz-text=tofu])");
    // 作前缀拼后代选择器时用 :is() 收拢两个根，clip 填充只有这一处
    expect(out).toContain(":is([skz]:not([skz-text]), [skz][skz-text=clip]) :is(p, span");
    expect(count(out, " background-clip: text;")).toBe(1);
  });

  it("未知取值（含 tofu 没引 tofu.css）落到 underline 外观：不是 clip，背景开关（--skz-tbg / --skz-timg）和纯色驱动按 color 处理；leaf 不受影响", () => {
    const out = css("base");
    // 背景色退场的开关挂在"有 skz-text 且不是 clip / leaf"的根上
    const color = rule(out, `[skz]${COLOR_MODES}`);
    expect(color).toContain("--skz-tbg: transparent");
    expect(color).toContain("--skz-timg: none");
    // 下划线形状 / 圆角归零对所有非 leaf 根生效（含未知取值），leaf 根被排除
    expect(rule(out, "[skz]:not([skz-text=leaf])")).toContain("--skz-tradius: 0px");
    expect(out).toContain("[skz]:not([skz-text=leaf]) *:not([skz-ignore]) {");
    // clip 的透明装饰线、填充都不碰 underline / leaf / tofu / 未知取值
    expect(rule(out, CLIP_ROOT)).toContain("--skz-dc: transparent");
    // leaf 根自己的规则还在，且没写 skz-text=leaf 的根不会进去
    expect(out).toContain("[skz][skz-text=leaf] *:not([skz-ignore]) {");
    // 没引 tofu.css（base 不含方块字体）：tofu 根没有任何专属规则，只会走上面的 underline 外观
    expect(out).not.toContain("skz-tofu");
  });

  it("core：clip 根只认没写 skz-text 的根（core 里没有文字模式）", () => {
    const out = css("core");
    expect(out).not.toContain("[skz][skz-text");
    expect(out).toContain("[skz]:not([skz-text]) :is(p, span");
  });
});

describe("Sass 文字模式挂载与驱动 mixin", () => {
  /** 用 src/styles 做 loadPaths 编译一小段 SCSS，去掉注释 */
  const sassOut = (src: string): string => compileString(src, { loadPaths: ["src/styles"] }).css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("color 驱动的挂载选择器：排除 clip / leaf 两个 gradient 模式，其余（含未知取值）都挂", () => {
    const out = sassOut('@use "sass:string"; @use "lists" as *; x { m: string.unquote($color-modes); }');
    expect(out).toContain(`m: ${COLOR_MODES.split("=clip").join('="clip"').split("=leaf").join('="leaf"')};`);
  });

  it("防火墙规则的派生变量与根规则共用驱动 mixin：gradient 的 pulse / shimmer 各一条，color 一条（pulse + shimmer 合并）", () => {
    const out = css("global");
    expect(rule(out, "[skz][skz-effect=pulse] [skz-fw]")).toContain("--skz-fill: var(--skz-pulse-c)");
    expect(rule(out, "[skz][skz-effect=shimmer] [skz-fw]")).toContain("--skz-bg-pos: calc(var(--skz-shimmer-p) * 1vw) 0");
    expect(rule(out, `[skz]:is([skz-effect=pulse], [skz-effect=shimmer])${COLOR_MODES} [skz-fw]`)).toContain("--skz-ul-fill: var(--skz-pulse-c)");
    // 根规则里的派生变量用的是同一组 mixin：声明和防火墙里的一致
    const base = css("base");
    expect(rule(base, "[skz][skz-effect=pulse]")).toContain("--skz-fill: var(--skz-pulse-c)");
    expect(rule(base, "[skz][skz-effect=shimmer]")).toContain("--skz-bg-pos: calc(var(--skz-shimmer-p) * 1vw) 0");
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
