import { IGNORE_SEL } from "../core/dom.js";
import { SKZ_BOX_TAG } from "../core/element.js";
import { ROOT_ATTR } from "../core/enable.js";

/** registerCustomElements 的选项 */
export interface RegisterOptions {
  /** 手动补充的自定义元素标签名 */
  tags?: string[];
  /** 监听 DOM 变化自动重扫 */
  watch?: boolean;
}

/** 宿主样式表的挂载句柄 */
interface HostSheet {
  /** 整体替换样式文本 */
  set(css: string): void;
  /** 从文档里摘掉 */
  remove(): void;
}

/**
 * 在 root 上挂一张宿主样式表：优先 adoptedStyleSheets，不支持时退回 <style>。
 * @param root 样式生效的范围（Document 或 ShadowRoot）
 * @returns 挂载句柄
 */
function mountHostSheet(root: Document | ShadowRoot): HostSheet {
  if ("adoptedStyleSheets" in root && typeof CSSStyleSheet !== "undefined" && "replaceSync" in CSSStyleSheet.prototype) {
    const sheet = new CSSStyleSheet();
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    return {
      set: (css) => sheet.replaceSync(css),
      remove: () => {
        root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => s !== sheet);
      },
    };
  }
  const doc = root.ownerDocument ?? (root as Document);
  const el = doc.createElement("style");
  el.setAttribute("data-skz-hosts", "");
  ("head" in root ? root.head : root).appendChild(el);
  return {
    set: (css) => {
      el.textContent = css;
    },
    remove: () => el.remove(),
  };
}

/**
 * 生成 Web Component 宿主的骨架样式：宿主 visibility:hidden 藏起 shadow 内容，
 * 再用宿主的 ::before 铺一块骨头（宿主自己的背景会被 visibility 一起藏掉，所以借伪元素）。
 * 骨头的画法与 _mixins.scss 的 sk-bone 一致：读根上动画驱动继承下来的 --skz-fill / --skz-bg-img / --skz-bg-pos，
 * 所以 pulse / shimmer（global 含降频、svg 引擎、防火墙）对宿主同样生效。
 * 仅供包内和测试使用，不从入口导出（test/styles.test.ts 会把它的背景声明和 sk-bone 逐项比对，防止两边漂移）。
 * @param tags 带连字符的自定义元素标签名
 * @returns CSS 文本
 */
export function buildHostCss(tags: string[]): string {
  if (!tags.length) return "";
  const sel = (suffix = ""): string => tags.map((t) => `[${ROOT_ATTR}] ${t}:not(${IGNORE_SEL})${suffix}`).join(",");
  return `${sel()}{visibility:hidden !important;position:relative}
${sel("::before")}{content:"" !important;visibility:visible !important;position:absolute !important;top:0 !important;right:0 !important;bottom:0 !important;left:0 !important;background-color:var(--skz-fill,var(--skz-color,#d9dde3)) !important;background-image:var(--skz-bg-img,none) !important;background-position:var(--skz-bg-pos,0 0);background-repeat:no-repeat !important;background-attachment:fixed !important;background-size:var(--skz-bg-size,60vw 100vh) !important;border-radius:var(--skz-radius,4px) !important}`;
}

/**
 * 扫描 root 里的自定义元素，生成宿主骨架样式表（adoptedStyleSheets，不支持时退回 <style>）。
 * 不改任何 DOM 节点；新增的自定义元素可调用 refresh() 或开启 watch 自动重扫。
 * 每次调用各自持有一张样式表，dispose 只清自己的。
 *
 * @param root 扫描范围兼样式生效范围，默认 document
 * @param opts tags：手动补充的标签名；watch：监听 DOM 变化自动重扫
 * @returns refresh 重扫并返回命中的标签名；dispose 停止监听并摘掉样式表
 * @example
 * const hosts = registerCustomElements(document, { tags: ['sl-button'], watch: true });
 */
export function registerCustomElements(root: Document | ShadowRoot = document, opts: RegisterOptions = {}): { refresh: () => string[]; dispose: () => void } {
  const extra = (opts.tags ?? []).map((t) => t.toLowerCase());
  const sheet = mountHostSheet(root);
  let lastCss = "";
  const refresh = (): string[] => {
    const found = new Set(extra);
    root.querySelectorAll("*").forEach((n) => {
      if (n.localName.includes("-") && n.localName !== SKZ_BOX_TAG) found.add(n.localName);
    });
    const tags = [...found].sort();
    const css = buildHostCss(tags);
    // 标签集合没变就不重建样式表，省掉一次整表失效
    if (css !== lastCss) {
      lastCss = css;
      sheet.set(css);
    }
    return tags;
  };
  refresh();

  let observer: MutationObserver | null = null;
  if (opts.watch) {
    let queued = false;
    observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        refresh();
      });
    });
    observer.observe((root as Document).documentElement ?? root, { childList: true, subtree: true });
  }

  const dispose = (): void => {
    observer?.disconnect();
    sheet.remove();
  };
  return { refresh, dispose };
}
