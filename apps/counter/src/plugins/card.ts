import type { TCountdownRender } from "../count-down/types";
import { isDigit } from "./shared";

export type TCardEffect = "flip" | "slide" | "calendar";

export interface ICardRenderOptions {
  /**
   * 特效类型，默认 "flip"
   * - flip: 双面 3D 折叠（now=正面、next=背面绕轴翻 180°；字面量关键帧，多实例实测满 60fps）
   * - slide: 卡片上下位移
   * - calendar: 经典翻页钟（移植自 Babak-Gholamzadeh/flip-clock；上下半页折叠 + 折叠变暗）
   */
  effect?: TCardEffect;
  /**
   * 类名前缀，默认 "cd-"。生成的 DOM 形如
   * `ul.cd-root.cd-<effect> > li.cd-cell > span.cd-num.cd-num-next + span.cd-num.cd-num-now`。
   * 自定义前缀时需自行提供对应前缀的样式（复制 card.css 替换前缀即可）。
   *
   * 注：动画时长不在 JS 中设置，由 CSS 变量 --<prefix>duration 控制（默认 .9s）。
   */
  prefix?: string;
  /**
   * flip 翻转轴，默认 "x"（绕 X 轴上下翻 rotateX）。"y" 为绕 Y 轴左右翻 rotateY（根上加 .cd-flip-y）。
   * 用修饰类而非 CSS 变量：含 var() 的 transform 无法走 GPU 合成，会退主线程逐帧重绘。
   */
  axis?: "x" | "y";
  /**
   * slide 位移方向，默认 "down"（新值自上方进入）。"up" 向上（根上加 .cd-slide-up）。
   */
  direction?: "up" | "down";
}

interface ICell {
  /** li.cd-cell（数字）或 li.cd-sep（分隔符） */
  item: HTMLElement;
  /** 是否为分隔符格（: . 等非数字字符，不参与翻页动画） */
  sep: boolean;
  /** 动画开始前写入新值（写到"将翻入"的 next 面） */
  applyPre(value: string): void;
  /** 动画落定后写入新值（写到 now 面，使其复位即显示新值） */
  applyPost(value: string): void;
  /** 切换翻页状态类（加在 now/next 两个面上，驱动单层选择器的动画） */
  setFlipping(on: boolean): void;
  /** 监听 transition/animation 结束的元素（now 面） */
  watch: HTMLElement;
  /** 当前展示的目标字符 */
  value: string;
  /** 动画进行中 */
  busy: boolean;
  /** 断开该格的事件监听（destroy 时调用，防泄漏） */
  dispose?: () => void;
}

interface ICardState {
  text: string;
  cells: ICell[];
  /** 上次渲染时传入的原始 remaining，值未变时连 ctx.fmt 都不必调用 */
  lastRemaining?: number;
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/**
 * 创建 countdown 卡片渲染器：把格式化结果按字符拆成卡片，
 * 只有发生变化的字符卡片才触发翻转/位移/翻页动画，其余 DOM 零接触。
 *
 * 样式不随 JS 注入，请自行引入 `@codejoo/counter/card.css`（或基于它定制）。
 * 动画时长用 CSS 变量 `--<prefix>duration` 控制（默认 500ms），可设在任意祖先上继承生效。
 *
 * @example
 * import { countdown, createCardRender } from "@codejoo/counter";
 * import "@codejoo/counter/card.css";
 * countdown(deadline, "#timer", { render: createCardRender({ effect: "calendar" }) });
 */
export function createCardRender(options: ICardRenderOptions = {}): ICardRender {
  const { effect = "flip", prefix = "cd-", axis = "x", direction = "down" } = options;
  const e = prefix + effect + "-"; // 效果类前缀，如 "cd-flip-"
  // 方向修饰类（字面量 transform + 修饰类，避免 var() 破坏 GPU 合成）
  const dirClass = effect === "flip" && axis === "y" ? " " + prefix + "flip-y" : effect === "slide" && direction === "up" ? " " + prefix + "slide-up" : "";
  const cls = {
    root: prefix + "root",
    eRoot: e + "root",
    cell: prefix + "cell",
    eCell: e + "cell",
    sep: prefix + "sep",
    num: prefix + "num",
    eNum: e + "num",
    now: prefix + "now",
    eNow: e + "now",
    next: prefix + "next",
    eNext: e + "next",
    flipping: prefix + "flipping",
  };

  function buildCell(ch: string): ICell {
    // 非数字字符（: . 空格 天 等）作分隔符，纯文本展示、不参与翻页
    if (!isDigit(ch)) {
      const sep = el("li", cls.sep);
      sep.textContent = ch;
      return {
        item: sep,
        sep: true,
        applyPre: () => {},
        applyPost: (v) => (sep.textContent = v),
        setFlipping: () => {},
        watch: sep,
        value: ch,
        busy: false,
      };
    }

    const item = el("li", cls.cell + " " + cls.eCell);
    // 每个面带「公共类 + 效果类」；DOM 顺序：next 在前、now 在后（翻页钟绘制顺序）
    const next = el("span", [cls.num, cls.next, cls.eNum, cls.eNext].join(" "));
    const now = el("span", [cls.num, cls.now, cls.eNum, cls.eNow].join(" "));
    next.dataset.digit = ch;
    now.dataset.digit = ch;
    item.append(next, now);

    const cell: ICell = {
      item,
      sep: false,
      applyPre: (v) => (next.dataset.digit = v),
      applyPost: (v) => (now.dataset.digit = v),
      // 状态类加在两个面上，配合单层选择器 .cd-<effect>-now.cd-flipping 等
      setFlipping: (on) => {
        now.classList.toggle(cls.flipping, on);
        next.classList.toggle(cls.flipping, on);
      },
      watch: now,
      value: ch,
      busy: false,
    };
    // now 面承载完整时长动画（flip/slide 的 transition、calendar 的 ::before 动画），
    // 其结束即本轮完成；事件冒泡到 item，统一监听 transition/animation 两类
    const onEnd = (ev: Event) => {
      if (ev.target === cell.watch && cell.busy) finalize(cell);
    };
    item.addEventListener("transitionend", onEnd);
    item.addEventListener("animationend", onEnd);
    cell.dispose = () => {
      item.removeEventListener("transitionend", onEnd);
      item.removeEventListener("animationend", onEnd);
    };
    return cell;
  }

  function finalize(cell: ICell) {
    cell.applyPost(cell.value);
    cell.setFlipping(false);
    cell.busy = false;
  }

  function animate(cell: ICell, ch: string) {
    if (cell.busy) {
      // 上一轮动画未结束（连续变化/后台标签页）→ 立即落定，
      // 并强制一次样式刷新，让复位状态先生效，重新添加类名才能重启动画
      finalize(cell);
      void cell.item.offsetWidth;
    }
    cell.applyPre(ch);
    cell.value = ch;
    cell.busy = true;
    cell.setFlipping(true);
  }

  function build(host: HTMLElement, text: string): ICardState {
    host.textContent = "";
    const root = el("ul", cls.root + " " + cls.eRoot + dirClass);
    const cells: ICell[] = [];
    for (let i = 0; i < text.length; i++) {
      const cell = buildCell(text[i]);
      root.appendChild(cell.item);
      cells.push(cell);
    }
    host.appendChild(root);
    return { text, cells };
  }

  // 状态按元素隔离，同一个渲染器实例可被多个任务/分组复用
  let states = new WeakMap<Element, ICardState>();

  const render = (host: Element, remaining: number, _value: unknown, ctx: Parameters<TCountdownRender>[3]) => {
    let state = states.get(host);
    if (state && state.lastRemaining === remaining) return; // 原始剩余毫秒未变，连 ctx.fmt 都不必调用
    const fmtValue = ctx.fmt(remaining, ctx);
    // 首次渲染或字符数变化（如天数进位）→ 重建卡片，不播动画
    if (!state || state.cells.length !== fmtValue.length) {
      state?.cells.forEach((c) => c.dispose?.()); // 重建前断开旧监听
      state = build(host as HTMLElement, fmtValue);
      state.lastRemaining = remaining;
      states.set(host, state);
      return;
    }
    state.lastRemaining = remaining;
    if (state.text === fmtValue) return;
    for (let i = 0; i < fmtValue.length; i++) {
      const cell = state.cells[i];
      const ch = fmtValue[i];
      if (cell.value === ch) continue;
      // 种类一致才原地更新；数字↔分隔符切换（极少见，如格式变更）则整体重建
      if (cell.sep === !isDigit(ch)) {
        if (cell.sep) {
          cell.applyPost(ch);
          cell.value = ch;
        } else {
          animate(cell, ch);
        }
      } else {
        state.cells.forEach((c) => c.dispose?.());
        state = build(host as HTMLElement, fmtValue);
        state.lastRemaining = remaining;
        states.set(host, state);
        return;
      }
    }
    state.text = fmtValue;
  };

  /** 释放引用、断开事件监听，防内存泄漏（不改动宿主子节点）。destroy(el) 清单个元素；destroy() 丢弃整张状态表 */
  render.destroy = (el?: Element): void => {
    if (el) {
      states.get(el)?.cells.forEach((c) => c.dispose?.());
      states.delete(el);
    } else {
      states = new WeakMap();
    }
  };

  return render;
}

/** createCardRender 返回值：渲染函数 + destroy */
export type ICardRender = TCountdownRender & { destroy: (el?: Element) => void };
