/**
 * `<img-progress>` custom element: a framework-agnostic wrapper around load(),
 * rendering an internal shadow <img> that swaps through imgprogress's stages.
 *
 * `<img-progress>` 自定义元素:围绕 load() 的框架无关封装,内部 shadow <img> 随 imgprogress 各阶段切换。
 */

import { load } from "../page/load";

/**
 * `<img-progress src alt>` — renders `<img>` that auto-swaps placeholder → first-frame → full image.
 *
 * `<img-progress src alt>`——渲染会自动从占位 → 首帧 → 全图切换的 `<img>`。
 * @example
 * <img-progress src="/big.gif" alt="demo"></img-progress>
 */
export class ImgProgressElement extends HTMLElement {
  static observedAttributes = ["src", "alt"];

  /** Internal shadow <img> — 内部 shadow <img> */
  private img: HTMLImageElement | null = null;
  /** Bumped on each (re)connect/attribute change to discard stale async callbacks — 每次(重新)连接/属性变更时自增,用于丢弃过期异步回调 */
  private generation = 0;

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

  disconnectedCallback(): void {
    this.generation++;
  }

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
    if (!src || !img) return;

    img.alt = this.getAttribute("alt") ?? "";

    const myGeneration = ++this.generation;
    load(src).onStage((_stage, displayUrl) => {
      if (this.generation !== myGeneration) return;
      img.src = displayUrl;
    });
  }
}

/**
 * Register `<img-progress>` (or a custom tag name) as a custom element. Safe to
 * call more than once — a second call with the same tag is a no-op.
 *
 * 把 `<img-progress>`(或自定义标签名)注册为自定义元素。可重复调用——同名标签的第二次调用为空操作。
 * @param tag - Tag name, default 'img-progress' — 标签名,默认 'img-progress'
 * @example
 * defineImgProgress() // then use <img-progress src="..."></img-progress> anywhere
 */
export function defineImgProgress(tag = "img-progress"): void {
  if (customElements.get(tag)) return;
  customElements.define(tag, ImgProgressElement);
}
