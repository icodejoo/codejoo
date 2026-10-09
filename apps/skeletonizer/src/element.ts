import { disable, toggle } from "./enable.js";
import type { SkzEffect, SkzEngine, SkzFallback, SkzTextMode } from "./enable.js";

/** 非浏览器环境（SSR）没有 HTMLElement，用空类占位，保证 import 不报错 */
const BaseElement: typeof HTMLElement = typeof HTMLElement !== "undefined" ? HTMLElement : (class {} as unknown as typeof HTMLElement);

/** 宿主上的加载开关属性名 */
const ATTR_LOADING = "loading";

/** 假值字面量：loading="false" 视为关闭 */
const FALSE_LITERAL = "false";

/**
 * <skz-box loading> 自定义元素：light DOM、不用 shadow，子节点仍归你的框架管。
 * 属性：loading（布尔开关，属性存在且值不为 "false" 即为开启）、effect（fade|solid|sweep|pulse|shimmer，默认 fade）、
 * text（underline|leaf）、fallback（svg|fade，默认 svg）、engine（global|svg）、fit（存在且不为 "false" 即开启）。
 * 宿主只负责读取 loading 开关和选项，实际的骨架状态（skz 属性等）作用在【第一个元素子节点】上。
 * 使用前先调用一次 defineSkzBox()。
 * 注意：不带 MutationObserver，子根被框架替换后需要由用户自己处理（例如切一下 loading）。
 *
 * SSR / 无 JS：直接在子根上写 skz，浏览器仅靠 CSS 兜底层就能显示骨架；JS 起来后 enable 是幂等的。
 *
 * @example
 * <skz-box loading effect="pulse"><div>……</div></skz-box>
 * @example
 * <!-- SSR / 无 JS：子根自带 skz -->
 * <skz-box loading><div skz>……</div></skz-box>
 */
export class SkzBox extends BaseElement {
  /** 当前接管的子根元素 */
  #activeChild: HTMLElement | null = null;

  /** 需要监听的属性 */
  static get observedAttributes(): string[] {
    return [ATTR_LOADING, "effect", "text", "fallback", "engine", "fit"];
  }

  /**
   * 是否处于加载态：loading 属性存在且值不是 "false" 即为开启。
   * @returns 当前是否开启
   * @example el.loading; // true
   */
  get loading(): boolean {
    return this.hasAttribute(ATTR_LOADING) && this.getAttribute(ATTR_LOADING) !== FALSE_LITERAL;
  }

  /**
   * 开关加载态，读写的就是 loading 属性。
   * @param v 是否开启
   * @example el.loading = true;
   */
  set loading(v: boolean) {
    this.toggleAttribute(ATTR_LOADING, !!v);
  }

  /** 挂载时同步一次状态 */
  connectedCallback(): void {
    this.#sync();
  }

  /** 卸载时对当前子根解除骨架，但不改变宿主自己的 loading 属性（从而在移动节点后能自然恢复） */
  disconnectedCallback(): void {
    if (this.#activeChild) {
      disable(this.#activeChild);
      this.#activeChild = null;
    }
  }

  /** 属性变化时同步状态 */
  attributeChangedCallback(): void {
    if (this.isConnected) this.#sync();
  }

  /** 按属性开关当前子根的骨架 */
  #sync(): void {
    const target = this.firstElementChild as HTMLElement | null;
    if (this.#activeChild && this.#activeChild !== target) {
      disable(this.#activeChild);
      this.#activeChild = null;
    }
    if (!target) return;
    this.#activeChild = target;

    if (this.loading) {
      toggle(target, true, {
        effect: (this.getAttribute("effect") ?? undefined) as SkzEffect | undefined,
        text: (this.getAttribute("text") ?? undefined) as SkzTextMode | undefined,
        fallback: (this.getAttribute("fallback") ?? undefined) as SkzFallback | undefined,
        engine: (this.getAttribute("engine") ?? undefined) as SkzEngine | undefined,
        fit: this.hasAttribute("fit") && this.getAttribute("fit") !== FALSE_LITERAL,
      });
    } else {
      disable(target);
    }
  }
}

/**
 * 注册 <skz-box>；重复注册是安全的。
 * @param tag 标签名，默认 skz-box
 * @example defineSkzBox();
 */
export function defineSkzBox(tag: string = "skz-box"): void {
  if (typeof customElements !== "undefined" && !customElements.get(tag)) {
    customElements.define(tag, SkzBox);
  }
}
