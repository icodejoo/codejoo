import { compile } from "sass";
import { describe, expect, it } from "vitest";

/** 旧前缀（拆开写，避免全仓 grep 误报） */
const OLD_PREFIX = "x-" + "ske";

/** 全部 CSS 入口 */
const ALL_ENTRIES = ["base", "explicit", "global", "svg", "sweep", "all"];

/** SVG 根规则的特征片段：只对 skz-engine=svg 的根生效 */
const SVG_ROOT = "[skz][skz-engine=svg][skz-effect=pulse],";

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

describe("样式入口的组成", () => {
  it("六个入口都能编译", () => {
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
  });

  it("sweep：只有一种，没有 skz-sweep 属性；深色走容器色（无混合模式、无遮罩），默认光带竖直", () => {
    const out = css("sweep");
    expect(out).not.toContain("skz-sweep=");
    expect(out).not.toContain("soft-light");
    expect(out).toContain("--skz-sweep-bg-rgb: 31, 41, 55");
    expect(out).toContain("--skz-sweep-skew: 0deg");
    expect(out).toContain("--skz-sweep-blend: normal");
    expect(out).toContain("--skz-sweep-mask: none");
    expect(out.match(/@keyframes skz-sweep/g)).toHaveLength(1);
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

  it("tier1 不再逐标签撤销背景，改成根上的变量开关", () => {
    const out = css("base");
    expect(out).toMatch(/\[skz\]:not\(\[skz-text=leaf\]\)\s*\{\s*--skz-tbg: transparent;\s*--skz-timg: none;\s*--skz-tradius: 0px;/);
    expect(out).not.toMatch(/:not\(\[skz-text=leaf\]\) p:not\(/);
    expect(out).not.toContain("border-radius: 0;");
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
