/**
 * `<prog-img>` custom element: a framework-agnostic wrapper around load(),
 * rendering an internal shadow <img> that swaps through progimg's stages.
 *
 * `<prog-img>` 自定义元素:围绕 load() 的框架无关封装,内部 shadow <img> 随 progimg 各阶段切换。
 */

import { load } from "../page/load";

/**
 * `<prog-img src alt>` — renders `<img>` that auto-swaps placeholder → first-frame → full image.
 *
 * `<prog-img src alt>`——渲染会自动从占位 → 首帧 → 全图切换的 `<img>`。
 * @example
 * <prog-img src="/big.gif" alt="demo"></prog-img>
 */
export class ProgimgElement extends HTMLElement {
  /** 需要监听变更的属性:src 触发重新加载,alt 同步到内部 img */
  static observedAttributes = ["src", "alt"];

  /** Internal shadow <img> — 内部 shadow <img> */
  private img: HTMLImageElement | null = null;
  /** Bumped on each (re)connect/attribute change to discard stale async callbacks — 每次(重新)连接/属性变更时自增,用于丢弃过期异步回调 */
  private generation = 0;

  /** 挂载到 DOM 时:首次创建 shadow 内的 img,并按当前 src 发起加载 */
  connectedCallback(): void {
    if (!this.shadowRoot) {
      const root = this.attachShadow({ mode: "open" });
      const img = document.createElement("img");
      img.style.width = "100%";
      img.style.height = "auto";
      img.style.display = "block";
      root.append(img);
      this.img = img;
    }
    this.startLoad();
  }

  /** 从 DOM 卸载时:自增 generation,让进行中的加载回调失效 */
  disconnectedCallback(): void {
    this.generation++;
  }

  /**
   * 属性变更时:src 重新加载,alt 同步到内部 img;未挂载时忽略。
   * @param name - 变更的属性名
   */
  attributeChangedCallback(name: string): void {
    if (!this.isConnected) return;
    if (name === "src") this.startLoad();
    else if (name === "alt" && this.img) this.img.alt = this.getAttribute("alt") ?? "";
  }

  /**
   * (Re)start a load() for the current src attribute, discarding stage
   * callbacks from any prior load once superseded.
   *
   * 为当前 src 属性(重新)发起 load(),一旦被取代就丢弃此前 load 的阶段回调。
   */
  private startLoad(): void {
    const src = this.getAttribute("src");
    const img = this.img;
    // 先自增使旧回调失效,即使 src 被移除也不能让旧加载把图写回
    const myGeneration = ++this.generation;
    if (!img) return;
    if (!src) {
      img.removeAttribute("src");
      return;
    }

    img.alt = this.getAttribute("alt") ?? "";

    load(src).onStage((_stage, displayUrl) => {
      if (this.generation !== myGeneration) return;
      img.src = displayUrl;
    });
  }
}

/**
 * Register `<prog-img>` (or a custom tag name) as a custom element. Safe to
 * call more than once — a second call with the same tag is a no-op.
 *
 * 把 `<prog-img>`(或自定义标签名)注册为自定义元素。可重复调用——同名标签的第二次调用为空操作。
 * @param tag - Tag name, default 'prog-img' — 标签名,默认 'prog-img'
 * @example
 * defineProgimg() // then use <prog-img src="..."></prog-img> anywhere
 */
export function defineProgimg(tag = "prog-img"): void {
  if (customElements.get(tag)) return;
  // 同一构造函数不能注册到多个标签名,故每次用匿名子类
  customElements.define(tag, class extends ProgimgElement {});
}
