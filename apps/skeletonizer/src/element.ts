import { enable, disable } from "./enable.js";
import type { XSkeEffect, XSkeTextMode } from "./enable.js";

/** 非浏览器环境（SSR）没有 HTMLElement，用空类占位，保证 import 不报错 */
const BaseElement: typeof HTMLElement = typeof HTMLElement !== "undefined" ? HTMLElement : (class {} as unknown as typeof HTMLElement);

/**
 * <x-ske loading> 自定义元素：light DOM、不用 shadow，子节点仍归你的框架管。
 * 属性：loading（布尔，加载中）、effect（fade|solid|pulse|shimmer，默认 fade）、text（underline|leaf）。
 * 没升级成自定义元素的旧环境里，CSS 兜底层也能按 [loading] 命中。
 *
 * @example
 * <x-ske loading effect="pulse"><p>……</p></x-ske>
 */
export class XSke extends BaseElement {
  /** 需要监听的属性 */
  static get observedAttributes(): string[] {
    return ["loading", "effect", "text"];
  }

  /** 是否处于加载态，等价于 loading 属性（"false" 视为关闭） */
  get loading(): boolean {
    return this.hasAttribute("loading") && this.getAttribute("loading") !== "false";
  }

  /** @param v 设置加载态 */
  set loading(v: boolean) {
    if (v) this.setAttribute("loading", "");
    else this.removeAttribute("loading");
  }

  /** 挂载时同步一次状态 */
  connectedCallback(): void {
    this.#sync();
  }

  /** 卸载时清理 */
  disconnectedCallback(): void {
    disable(this);
  }

  /** 属性变化时同步状态 */
  attributeChangedCallback(): void {
    if (this.isConnected) this.#sync();
  }

  /** 按属性开关骨架 */
  #sync(): void {
    if (this.loading) {
      enable(this, {
        effect: (this.getAttribute("effect") ?? undefined) as XSkeEffect | undefined,
        text: (this.getAttribute("text") ?? undefined) as XSkeTextMode | undefined,
      });
    } else {
      disable(this);
    }
  }
}

/**
 * 注册 <x-ske>；重复注册是安全的。
 * @param tag 标签名，默认 x-ske
 * @example defineXSke();
 */
export function defineXSke(tag: string = "x-ske"): void {
  if (typeof customElements !== "undefined" && !customElements.get(tag)) {
    customElements.define(tag, XSke);
  }
}
