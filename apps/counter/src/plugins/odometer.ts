import type { ICountupRenderContext, TCountupRender } from "../count-up/type";
import { maskOf } from "./shared";

export interface IOdometerRenderOptions {
  /**
   * 类名前缀，默认 "cd-"。生成 DOM：
   * `ul.cd-root.cd-odometer-root > (li.cd-cell.cd-odometer-cell > span.cd-num.cd-odometer-num | li.cd-sep)`。
   * 与翻页卡片共用 cd-* 样式体系（card.css）。
   */
  prefix?: string;
  /**
   * 进位滚动窗口，0~1，默认 0.2。
   * 每一位仅在其"步进"的最后这段比例内滚动到下一位，其余时间保持当前数字。
   * 越小越"数字化"（停得越干净）；设 1 则全程匀速滚动。
   */
  rollWindow?: number;
  /**
   * 是否保留前导零，默认 false。
   * 默认会隐藏高位的前导 0（及其左侧分组分隔符），数字随数值自然变长；
   * 设为 true 则按预建的最大宽度始终显示前导 0（如 0,000,123，里程表风格）。
   */
  leadingZeros?: boolean;
  /**
   * 长条模式，默认 "minimal"。两种模式都遵循"预建→只改 transform/文本→落定塌缩为单格"三步，
   * 落定后均塌缩为每位 1 格静态，差别只在动画期间：
   * - "minimal": 每位 2 格（当前/下一），进位时换文本——动画期 DOM 最省，但进位有定宽格内重绘。
   * - "full": 每位 0-9（含尾部补 0）共 11 格整体平移——动画期纯 transform 合成、零重绘，
   *   但动画期 DOM 约为 minimal 的数倍（落定塌缩后两者相同）。
   */
  strip?: "minimal" | "full";
}

interface IOCol {
  /** li.cd-cell，前导零隐藏时整格 display:none */
  li: HTMLElement;
  strip: HTMLElement;
  /** minimal 模式的上/下格文本节点（full 模式为 null，长条数字静态） */
  topText: Text | null;
  bottomText: Text | null;
  /** 位权指数：个位 0、十位 1…；小数第一位 -1，依此类推 */
  k: number;
  /** 预存的 10**k，避免热路径每帧 Math.pow */
  pow: number;
  lastDigit: number;
  /** 上次写入的量化平移输入（minimal=roll、full=digit+roll），用于跳过重复写 transform */
  lastT: number;
}

interface IOSep {
  el: HTMLElement;
  /** 左邻数字位的位权（无左邻数字的前缀符记 -Infinity，永不作前导零隐藏） */
  leftK: number;
  /** 是否是符号位（掩码首字符为 "-"）：随当前值的正负逐帧切换显隐，而非固定烘死 */
  isSign: boolean;
}

interface IOState {
  /** 结构掩码（数字位→#，其余原样），用于判断是否需要重建 */
  mask: string;
  cols: IOCol[];
  seps: IOSep[];
  /** 上次的整数位数，用于前导零隐藏的增量更新 */
  lastLen: number;
  /** 本结构服务的动画起止值，用于识别"新动画"以重建长条 */
  from: number;
  to: number;
  /** full 模式：动画结束后是否已塌缩为单格静态显示 */
  collapsed: boolean;
  /** 上次绘制的符号位显隐状态，跳过重复的 classList 写 */
  lastSign?: boolean;
}

/** 数值的整数位数（trunc 后），value<1 记 1（至少显示个位的 0）。整数循环，无字符串分配。 */
function intLen(value: number): number {
  let n = Math.trunc(Math.abs(value));
  let len = 1;
  while (n >= 10) {
    n = Math.floor(n / 10);
    len++;
  }
  return len;
}

// 平移以 CSS 变量 --cd-cell-height 为单位（默认 1.25em）；提取常量避免重复字面量
const TY_HEAD = "translateY(calc(var(--cd-cell-height, 1.25em) * ";
const ty = (n: number) => TY_HEAD + n + "))";

/**
 * 规划要构建的结构掩码：用 ctx.fmt 精确格式化 from/to 两端，
 * 取更长者（含分隔符/小数）的掩码作为最大宽度模板——无需猜测分组规则。
 */
function planMask(ctx: ICountupRenderContext): string {
  const a = ctx.fmt(ctx.from);
  const b = ctx.fmt(ctx.to);
  return maskOf(a.length >= b.length ? a : b);
}

export function createOdometerRender(options: IOdometerRenderOptions = {}): IOdometerRender {
  const { prefix = "cd-", rollWindow = 0.2, leadingZeros = false } = options;
  const cls = {
    root: prefix + "root",
    eRoot: prefix + "odometer-root",
    cell: prefix + "cell",
    eCell: prefix + "odometer-cell",
    sep: prefix + "sep",
    num: prefix + "num",
    eNum: prefix + "odometer-num",
    hidden: prefix + "hidden",
  };
  const T = 1 - Math.min(Math.max(rollWindow, 0.01), 1);
  const full = options.strip === "full";
  let states = new WeakMap<Element, IOState>();

  /** 按掩码构建 DOM（一次性）。掩码里的 # 是数字位、其余是分隔符字面量。 */
  function build(host: HTMLElement, mask: string): IOState {
    host.textContent = "";
    const root = document.createElement("ul");
    root.className = cls.root + " " + cls.eRoot;

    const dot = mask.indexOf(".");
    const intHashes: number[] = [];
    const fracHashes: number[] = [];
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] !== "#") continue;
      if (dot === -1 || i < dot) intHashes.push(i);
      else fracHashes.push(i);
    }
    const kAt = new Map<number, number>();
    for (let j = 0; j < intHashes.length; j++) kAt.set(intHashes[j], intHashes.length - 1 - j);
    for (let j = 0; j < fracHashes.length; j++) kAt.set(fracHashes[j], -(j + 1));

    const cols: IOCol[] = [];
    const seps: IOSep[] = [];
    let prevK = Number.NEGATIVE_INFINITY; // 最近一个数字位的位权，作为后续分隔符的左邻
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] !== "#") {
        const sep = document.createElement("li");
        sep.className = cls.sep;
        sep.textContent = mask[i];
        root.appendChild(sep);
        seps.push({ el: sep, leftK: prevK, isSign: i === 0 && mask[i] === "-" });
        continue;
      }
      const li = document.createElement("li");
      li.className = cls.cell + " " + cls.eCell;
      const strip = document.createElement("span");
      strip.className = cls.num + " " + cls.eNum;
      let topText: Text | null = null;
      let bottomText: Text | null = null;
      if (full) {
        // 0-9 再补一个 0：整条静态，靠平移显示，跨 9→0 落在尾部 0 上无缝
        for (let d = 0; d <= 10; d++) {
          const cell = document.createElement("span");
          cell.appendChild(document.createTextNode(String(d % 10)));
          strip.appendChild(cell);
        }
      } else {
        // 仅两格：当前 + 下一，进位时换文本
        const top = document.createElement("span");
        const bottom = document.createElement("span");
        topText = document.createTextNode("");
        bottomText = document.createTextNode("");
        top.appendChild(topText);
        bottom.appendChild(bottomText);
        strip.append(top, bottom);
      }
      li.appendChild(strip);
      root.appendChild(li);
      const k = kAt.get(i)!;
      prevK = k;
      cols.push({ li, strip, topText, bottomText, k, pow: 10 ** k, lastDigit: -1, lastT: -1 });
    }
    host.appendChild(root);
    return { mask, cols, seps, lastLen: -1, from: NaN, to: NaN, collapsed: false };
  }

  /** 落定：每位塌缩为当前数字单格、清掉 transform，回收内存（一次性 childList，两种模式通用） */
  function collapse(state: IOState, value: number) {
    const v = Math.abs(value);
    for (let i = 0; i < state.cols.length; i++) {
      const col = state.cols[i];
      const digit = Math.floor(v / col.pow) % 10;
      // full：索引 digit 的格即该数字；minimal：复用 top 格并写入最终数字
      const keep = full ? col.strip.children[digit] : col.strip.children[0];
      if (!full && col.topText) col.topText.data = String(digit);
      col.strip.replaceChildren(keep);
      col.strip.style.transform = "";
    }
    state.collapsed = true;
  }

  /** 按当前值正负切换符号位（掩码首字符 "-"）显隐；符号来自 from/to 中较长者时会被烘死在结构里，需逐帧按实际值纠正 */
  function updateSign(state: IOState, negative: boolean) {
    if (state.lastSign === negative) return;
    state.lastSign = negative;
    for (let i = 0; i < state.seps.length; i++) {
      const sep = state.seps[i];
      if (sep.isSign) sep.el.classList.toggle(cls.hidden, !negative);
    }
  }

  /**
   * 按当前整数位数隐藏前导零位（及其左侧分组分隔符），仅在位数变化时增量切换 class。
   * len 为可见整数位数（leadingZeros 时传 Infinity → 不隐藏）。
   */
  function reflow(state: IOState, len: number) {
    if (len === state.lastLen) return;
    state.lastLen = len;
    for (let i = 0; i < state.cols.length; i++) {
      const col = state.cols[i];
      col.li.classList.toggle(cls.hidden, col.k >= len); // k≥len 即前导零位（小数位 k<0 永不命中）
    }
    for (let i = 0; i < state.seps.length; i++) {
      const sep = state.seps[i];
      sep.el.classList.toggle(cls.hidden, sep.leftK >= len);
    }
  }

  /** 仅改数字与平移，不动结构；跳过隐藏（前导零）列。两种模式都只写 transform/文本、不读回布局。 */
  function paint(state: IOState, value: number, visibleLen: number) {
    const v = Math.abs(value);
    for (let i = 0; i < state.cols.length; i++) {
      const col = state.cols[i];
      if (col.k >= visibleLen) continue; // 隐藏列（display:none）不绘制
      const scaled = v / col.pow;
      const floor = Math.floor(scaled);
      const digit = floor % 10;
      const frac = scaled - floor;
      const roll = frac <= T ? 0 : (frac - T) / (1 - T);

      if (full) {
        // 整条静态，平移到 digit+roll（0~10，尾部补 0 实现 9→0 无缝）；纯 transform，零重绘
        const pos = digit + roll;
        const q = (pos * 1000) | 0;
        if (q !== col.lastT) {
          col.strip.style.transform = ty(-pos);
          col.lastT = q;
        }
        continue;
      }
      // minimal：进位时换文本（只改 .data 不替换节点），平移只表达 roll(0~1)
      if (digit !== col.lastDigit) {
        col.topText!.data = String(digit);
        col.bottomText!.data = String((digit + 1) % 10);
        col.lastDigit = digit;
      }
      const q = (roll * 1000) | 0;
      if (q !== col.lastT) {
        col.strip.style.transform = ty(-roll);
        col.lastT = q;
      }
    }
  }

  function rebuild(host: HTMLElement, mask: string, ctx: ICountupRenderContext): IOState {
    const state = build(host, mask);
    state.from = ctx.from;
    state.to = ctx.to;
    states.set(host, state);
    return state;
  }

  const render = (host: Element, _value: number, ctx: Parameters<TCountupRender>[2]) => {
    const el = host as HTMLElement;
    let state = states.get(host);
    const settle = ctx.value === ctx.to;

    // 结构只由 from/to 决定（一次预建）。动画中绝不按每帧 fmtValue 重建：
    // 中间值是缓动浮点，Intl 默认会带上变动的小数位，结构会抖动——但那些小数本就不该显示，
    // 定位用 ctx.value 现算（整数位滚动 + 小数驱动 roll）。新动画/塌缩后重滚才重建。
    if (!state || state.from !== ctx.from || state.to !== ctx.to || (state.collapsed && !settle)) {
      state = rebuild(el, planMask(ctx), ctx);
    }

    const visibleLen = leadingZeros ? Infinity : intLen(ctx.value);
    const negative = ctx.value < 0;

    if (settle) {
      // 落定：按目标值裁剪到实际宽度（倒数 9999→5 会移除多余前导位），再塌缩为单格静态。
      // 仅此一帧才需要格式化字符串 → 按需调用 ctx.formatter，动画期完全不格式化（见 TCountupRender）
      const live = maskOf(ctx.fmt(ctx.value, ctx));
      if (state.mask !== live) state = rebuild(el, live, ctx);
      updateSign(state, negative);
      reflow(state, visibleLen);
      if (!state.collapsed) collapse(state, ctx.value);
      return;
    }

    updateSign(state, negative);
    reflow(state, visibleLen);
    paint(state, ctx.value, visibleLen);
  };

  /** 释放引用、防内存泄漏。destroy(el) 断开该元素状态引用；destroy() 丢弃整张状态表。不改动宿主子节点。 */
  render.destroy = (el?: Element): void => {
    if (el) states.delete(el);
    else states = new WeakMap();
  };

  return render;
}

/** createOdometerRender 返回值：渲染函数 + destroy */
export type IOdometerRender = TCountupRender & { destroy: (el?: Element) => void };
