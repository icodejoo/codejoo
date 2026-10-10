import { compile } from "sass";
import { describe, expect, it } from "vitest";

/** 旧前缀（拆开写，避免全仓 grep 误报） */
const OLD_PREFIX = "x-" + "ske";

/** 全部 CSS 入口 */
const ALL_ENTRIES = ["base", "explicit", "global", "svg", "sweep", "tofu", "all"];

/** SVG 根规则的特征片段：只对 skz-engine=svg 的根生效 */
const SVG_ROOT = "[skz][skz-engine=svg][skz-effect=pulse],";

/** clip（默认文字模式）的根选择器：非 underline / leaf / tofu */
const CLIP_ROOT = "[skz]:not([skz-text=underline]):not([skz-text=leaf]):not([skz-text=tofu])";

/** 颜色由根上变量驱动的文字模式（underline / tofu），:where() 后缀 */
const COLOR_MODES = ":where([skz-text=underline], [skz-text=tofu])";

/** 降频时间函数（缺省值写在 var() 兜底里） */
const SHIMMER_TIMING = "var(--skz-shimmer-timing, steps(36))";

/** shimmer 的光带动画声明（只挂光带） */
const SHIMMER_ANIM = `skz-shimmer-root var(--skz-duration) ${SHIMMER_TIMING} infinite`;

/** underline / tofu / iOS 的 shimmer 额外挂的 pulse 动画 */
const PULSE_ANIM = `skz-pulse-root var(--skz-duration) ${SHIMMER_TIMING} infinite alternate`;

/**
 * 编译一个 SCSS 入口，并去掉注释（注释里会提到 @property 等字样，不应参与断言）
 * @param name 入口名（src/styles/entries 下）
 * @returns 不含注释的 CSS 文本
 */
const css = (name: string): string => compile(`src/styles/entries/${name}.scss`).css.replace(/\/\*[\s\S]*?\*\//g, "");

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

  it("global：带 @property 根驱动、防火墙和一份 SVG 根规则，没有老浏览器降级块、sweep 和 data URI", () => {
    const out = css("global");
    expect(out).toContain("@property --skz-shimmer-p");
    expect(out).toContain("[skz-fw]");
    expect(out).toContain(SVG_ROOT);
    expect(out).not.toContain("@supports not (color: rgb(");
    expect(out).not.toContain("skz-sweep");
    expect(out).not.toContain("data:image/svg");
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

describe("global 的根驱动动画", () => {
  it("降频时间函数只写在 var() 兜底里，不在根上声明 --skz-shimmer-timing（否则盖掉用户写在祖先上的覆盖）", () => {
    const out = css("global");
    expect(out).toContain(SHIMMER_TIMING);
    expect(out).not.toMatch(/--skz-shimmer-timing:/);
  });

  it("shimmer 根动画读 --skz-shimmer-timing，缺省 steps(36)（24 次/秒）", () => {
    const out = css("global");
    expect(rule(out, "[skz][skz-effect=shimmer]")).toContain(`animation: ${SHIMMER_ANIM};`);
  });

  it("clip（默认）根的 shimmer 不挂 skz-pulse-root，也不声明 --skz-ul-fill", () => {
    const body = rule(css("global"), "[skz][skz-effect=shimmer]");
    expect(body).not.toContain("skz-pulse-root");
    expect(body).not.toContain("--skz-ul-fill");
  });

  it("underline / tofu 根的 shimmer 额外挂 pulse，同样用 --skz-shimmer-timing 降频；:where() 保持低优先级", () => {
    const body = rule(css("global"), `[skz][skz-effect=shimmer]${COLOR_MODES}`);
    expect(body).toContain(SHIMMER_ANIM);
    expect(body).toContain(PULSE_ANIM);
  });

  it("--skz-ul-fill 只挂在 underline / tofu 根上（pulse、shimmer 都是），pulse 根自己不再声明", () => {
    const out = css("global");
    expect(rule(out, `[skz]:is([skz-effect=pulse], [skz-effect=shimmer])${COLOR_MODES}`)).toContain("--skz-ul-fill: var(--skz-pulse-c)");
    expect(rule(out, "[skz][skz-effect=pulse]")).not.toContain("--skz-ul-fill");
  });

  it("单独的 pulse 效果的时间函数不变（ease-in-out，不读降频变量）", () => {
    const body = rule(css("global"), "[skz][skz-effect=pulse]");
    expect(body).toContain("animation: skz-pulse-root var(--skz-duration) ease-in-out infinite alternate");
    expect(body).not.toContain("shimmer-timing");
  });

  it("iOS 分支：shimmer 去掉光带图、--skz-fill 读 pulse，仍然挂 pulse 动画，防火墙里同步钉住 --skz-fill", () => {
    const out = css("global");
    const i = out.indexOf("@supports (-webkit-touch-callout: none)");
    expect(i).toBeGreaterThanOrEqual(0);
    const ios = out.slice(i);
    expect(ios).toContain("--skz-bg-img: none");
    expect(ios).toContain("--skz-fill: var(--skz-pulse-c)");
    expect(ios).toContain(SHIMMER_ANIM);
    expect(ios).toContain(PULSE_ANIM);
    expect(ios).toMatch(/\[skz\]\[skz-effect=shimmer\] \[skz-fw\] \{\s*--skz-fill: var\(--skz-pulse-c\)/);
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
