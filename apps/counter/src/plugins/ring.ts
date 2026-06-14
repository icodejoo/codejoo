import type { TCountdownRender, ICountdownContext } from "../count-down/types";

// ============================ 对外类型 ============================

/** 档位（最外圈/数码区/弧的当前色，及内圈末分钟三色） */
export type TRingZone = "normal" | "green" | "yellow" | "red" | "off";

export interface IRingColors {
  /** 分钟>0 时的常态色 */
  normal: string;
  green: string;
  yellow: string;
  red: string;
  /** 未点亮刻度色 */
  off: string;
}

/** colorAt 回调入参：自定义「当前主题色」 */
export interface IRingColorInfo {
  remaining: number;
  totalMin: number;
  sec: number;
  colors: IRingColors;
}

/** 逐刻度上色入参；返回 undefined 用内置档位色 */
export interface IRingTickInfo {
  index: number;
  total: number;
  on: boolean;
  finalMin: boolean;
  sec: number;
  remaining: number;
  colors: IRingColors;
}

/** 最内圈逐分钟上色入参（最后一分钟固定三色，不走此回调） */
export interface IRingMinuteInfo {
  /** 分钟序号：1 = 倒数第二分钟…N-1 = 最外那一分钟 */
  index: number;
  /** 总分钟数（由初始总时长决定，外部不可预知，故经回调下发） */
  count: number;
  fromMs: number;
  toMs: number;
  remaining: number;
  colors: IRingColors;
}

/** 各部件 render 自定义渲染共享的帧上下文（内部已算好，回调直接用） */
interface IPartFrame {
  /** 该部件的容器 <g>（跨帧持久，可首帧建、后续更新） */
  host: SVGElement;
  remaining: number;
  totalMin: number;
  sec: number;
  finalMin: boolean;
  colors: IRingColors;
}
export interface IRingTicksFrame extends IPartFrame {
  count: number;
  /** 点亮格数（= 当前秒位，归零为 0） */
  lit: number;
  /** 第 i 根刻度档位 */
  zoneAt: (i: number) => TRingZone;
}
export interface IRingArcFrame extends IPartFrame {
  radius: number;
  segments: number;
  /** 每段弧度（度） */
  span: number;
  /** 本帧旋转角（度） */
  rotation: number;
  /** 当前主题色 */
  color: string;
}
export interface IRingInnerFrame extends IPartFrame {
  radius: number;
  /** 初始总时长（ms） */
  total: number;
  redAt: number;
  yellowAt: number;
  /** 剩余时间 ms → 角度（弧度），用于画排空弧 */
  angleAt: (ms: number) => number;
}
export interface IRingDigitFrame extends IPartFrame {
  /** 已由 count-down 的 fmt 格式化的文本 */
  text: string;
  /** 已解析的当前主题色（含 colorAt 覆盖） */
  color: string;
}

/** 各部件配置基类：display:false 等价于把该字段设为 false（不生成 SVG） */
interface IPartBase {
  display?: boolean;
}

/** 最外圈刻度 */
export interface IRingTicks extends IPartBase {
  /** 刻度数量，默认 60 */
  count?: number;
  /** 外端半径，默认 46.5 */
  radius?: number;
  /** 粗细，默认 2.6 */
  width?: number;
  /** 长度，默认 8.5 */
  length?: number;
  /** 逐刻度上色；返回 undefined 用内置档位色 */
  colorAt?: (info: IRingTickInfo) => string | undefined;
  /** 自定义渲染：内部算好 lit/档位等，host 为持久 <g> */
  render?: (frame: IRingTicksFrame) => void;
}

/** 装饰弧（外2圈 / 外3圈通用） */
export interface IRingArc extends IPartBase {
  /** 半径 */
  radius?: number;
  /** 线宽 */
  width?: number;
  /** 段数，默认 3 */
  segments?: number;
  /** 每段弧度（度），默认 60 */
  span?: number;
  /** 自定义当前主题色 */
  colorAt?: (info: IRingColorInfo) => string;
  /** 自定义渲染：内部算好 rotation/color 等 */
  render?: (frame: IRingArcFrame) => void;
}

/** 最内圈进度环 */
export interface IRingInner extends IPartBase {
  /** 半径，默认 27.5 */
  radius?: number;
  /** 线宽，默认 2.8 */
  width?: number;
  /** 灰底色 */
  track?: string;
  /** 逐分钟上色（最后一分钟固定三色） */
  colorAt?: (info: IRingMinuteInfo) => string;
  /** 自定义渲染：内部给出 angleAt/total 等 */
  render?: (frame: IRingInnerFrame) => void;
}

/** 中心数码区 */
export interface IRingDigit extends IPartBase {
  /** "segment"(七段·默认) | "text"(文字字体) */
  mode?: "segment" | "text";
  /** 目标宽度，默认 46 */
  size?: number;
  /** text 模式字体 */
  font?: string;
  /** 自定义当前主题色 */
  colorAt?: (info: IRingColorInfo) => string;
  /** 完全自定义渲染（优先于 mode） */
  render?: (frame: IRingDigitFrame) => void;
}

/** 部件字段：false/null 隐藏；对象则按其配置（与默认合并） */
type TPart<T> = false | null | T;

/** createRingRender 返回值：渲染函数 + destroy（释放引用、防泄漏） */
export type IRingRender = TCountdownRender & { destroy: (el?: Element) => void };

export interface IRingRenderOptions {
  // —— 公用 ——
  /** 类名前缀，默认 "rg-" */
  prefix?: string;
  /** 进入红色档的秒数，默认 3 */
  redAt?: number;
  /** 进入黄色档的秒数，默认 10 */
  yellowAt?: number;
  /** 旋转 / 排空基准方向，true 顺时针（默认） */
  clockwise?: boolean;
  /** 是否发光（drop-shadow 滤镜，GPU 成本最高的部分），默认 false。多实例慎开 */
  glow?: boolean;
  /** 主题色（同时写成 CSS 变量；options 优先级高于样式表默认） */
  colors?: Partial<IRingColors>;

  // —— 各部件（分组；false/null 隐藏） ——
  /** 最外圈刻度 */
  ticks?: TPart<IRingTicks>;
  /** 外2圈装饰弧（跟随计时方向旋转） */
  arcA?: TPart<IRingArc>;
  /** 外3圈装饰弧（反向旋转；归零回基准位与外2圈重合） */
  arcB?: TPart<IRingArc>;
  /** 最内圈进度环 */
  inner?: TPart<IRingInner>;
  /** 中心数码区 */
  digit?: TPart<IRingDigit>;
}

// ============================ 常量 / 工具 ============================

const DEFAULT_COLORS: IRingColors = { normal: "#ff6a5a", green: "#37d67a", yellow: "#ffcf3a", red: "#ff3b30", off: "#3a2730" };

const DEF_TICKS: Required<Omit<IRingTicks, "display" | "colorAt" | "render">> = { count: 60, radius: 46.5, width: 2.6, length: 8.5 };
const DEF_ARCA: Required<Omit<IRingArc, "display" | "colorAt" | "render">> = { radius: 35.5, width: 2.4, segments: 3, span: 60 };
const DEF_ARCB: Required<Omit<IRingArc, "display" | "colorAt" | "render">> = { radius: 31.5, width: 1.3, segments: 3, span: 60 };
const DEF_INNER: Required<Omit<IRingInner, "display" | "colorAt" | "render">> = { radius: 27.5, width: 2.8, track: "rgba(150,140,148,0.22)" };
const DEF_DIGIT: Required<Omit<IRingDigit, "display" | "colorAt" | "render">> = { mode: "segment", size: 46, font: 'ui-monospace, "Cascadia Mono", Consolas, monospace' };

// 七段：a b c d e f g（段亮灭表）
const SEGMENTS: Record<string, number> = {
  "0": 0b1111110,
  "1": 0b0110000,
  "2": 0b1101101,
  "3": 0b1111001,
  "4": 0b0110011,
  "5": 0b1011011,
  "6": 0b1011111,
  "7": 0b1110000,
  "8": 0b1111111,
  "9": 0b1111011,
};

const SVGNS = "http://www.w3.org/2000/svg";
const el = (tag: string, attrs: Record<string, string | number> = {}): SVGElement => {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  return n;
};
const styleOf = (n: SVGElement) => (n as SVGElement & { style: CSSStyleDeclaration }).style;
const XLINK = "http://www.w3.org/1999/xlink";
const setHref = (n: SVGElement, id: string) => {
  n.setAttribute("href", "#" + id);
  n.setAttributeNS(XLINK, "xlink:href", "#" + id); // 兼容旧渲染器
};
let SID = 0; // 外圈弧复用源 id 自增，避免同页多实例/多元素的 id 冲突

// 渲染元素上挂的「上次写入值」缓存：未变化则跳过 DOM 写入（省样式重算 + 重光栅）
type TCacheEl = SVGElement & { style: CSSStyleDeclaration; __z?: TRingZone; __on?: boolean; __d?: string; __t?: string };

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

/** 以 (cx,cy) 为圆心、半径 r，画 a0→a1（弧度）的圆弧 path d */
function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const pt = (a: number) => `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  const sweep = a1 >= a0 ? 1 : 0;
  return `M${pt(a0)}A${r} ${r} 0 ${large} ${sweep} ${pt(a1)}`;
}

// 七段管几何：所有 cell 几何相同、只差平移 → 复用同一组点串。
const DW = 10,
  DH = 18,
  DT = 2.2,
  DM = 1;
function segPoints(): string[] {
  const b = DT / 2;
  const x0 = DM,
    x1 = DW - DM;
  const y0 = DM,
    ym = DH / 2,
    y1 = DH - DM;
  const horiz = (yc: number) => `${x0},${yc} ${x0 + b},${yc - b} ${x1 - b},${yc - b} ${x1},${yc} ${x1 - b},${yc + b} ${x0 + b},${yc + b}`;
  const vert = (xc: number, ya: number, yb: number) => `${xc},${ya} ${xc + b},${ya + b} ${xc + b},${yb - b} ${xc},${yb} ${xc - b},${yb - b} ${xc - b},${ya + b}`;
  return [horiz(y0), vert(x1, y0, ym), vert(x1, ym, y1), horiz(y1), vert(x0, ym, y1), vert(x0, y0, ym), horiz(ym)];
}
const BASE_PTS = segPoints();

const MINUTE = 60000;
const TAU = Math.PI * 2;
const TOP = -Math.PI / 2;

function maskOf(s: string): string {
  let m = "";
  for (let i = 0; i < s.length; i++) m += isDigit(s[i]) ? "#" : s[i];
  return m;
}

/** false/null/display:false → null（隐藏）；否则与默认合并 */
function resolvePart<D, T extends IPartBase>(opt: TPart<T> | undefined, def: D): (D & T) | null {
  if (opt === false || opt === null) return null;
  const merged = { ...def, ...(opt && typeof opt === "object" ? opt : {}) } as D & T;
  if (merged.display === false) return null;
  return merged;
}

interface ICell {
  digit: boolean;
  /** segment 模式数字位的 7 段 polygon（按 rg-on 亮灭）。几何复用 BASE_PTS，仅靠 <g> 平移定位 */
  segs?: SVGElement[];
  /** 分隔符文本节点 */
  sep?: SVGElement;
  /** 当前字符，跳过无变化写入 */
  ch?: string;
}
interface IMinute {
  el: SVGElement;
  from: number;
  to: number;
}
interface IRingState {
  svg: SVGElement;
  ticks: SVGElement[];
  ticksHost?: SVGElement; // 自定义 render 时的容器
  arcAHost?: SVGElement;
  arcBHost?: SVGElement;
  zones?: { red: SVGElement; yellow: SVGElement; green: SVGElement };
  minutes: IMinute[];
  innerHost?: SVGElement;
  digitG?: SVGElement;
  cells: ICell[];
  digitText?: SVGElement;
  /** 外3圈复用外2圈时的缩放系数（arcB.radius / arcA.radius）；独立绘制时为 undefined */
  arcBScale?: number;
  total: number;
  text: string;
  mask: string;
}

// ============================ 渲染器 ============================

/**
 * 圆形数码倒计时渲染器（count-down 的 render 插件）。四层同心环（外→内）：
 * 1. 最外圈刻度：当前分钟剩余秒，每秒灭一格；分钟>0 常态色，最后一分钟按秒变红/黄/绿。
 * 2. 外2圈：装饰弧，跟随计时方向每秒转 1 刻度；色取当前主题。
 * 3. 外3圈：更细的装饰弧，反向旋转；归零回基准位与外2圈重合。
 * 4. 最内圈：灰底环 + 彩色「剩余」逐帧排空；逐分钟上色，最后一分钟按阈值分红/黄/绿。
 *
 * 配置按部件分组：`ticks/arcA/arcB/inner/digit`，每个可设 false 隐藏、或给对象配置
 * （display/几何/colorAt/render 自定义渲染）；公用项（prefix/redAt/yellowAt/clockwise/glow/colors）在顶层。
 * 颜色/线宽尽量经 CSS 变量（`--rg-*`）控制，options 覆盖优先。
 *
 * @example
 * import { countdown, createRingRender } from "@codejoo/counter";
 * import "@codejoo/counter/ring.css";
 * countdown(300000, "#t", { fmt: "mm:ss", render: createRingRender() });
 */
export function createRingRender(options: IRingRenderOptions = {}): IRingRender {
  const { prefix = "rg-", redAt = 3, yellowAt = 10, clockwise = true, glow = false } = options;
  const colors: IRingColors = { ...DEFAULT_COLORS, ...options.colors };
  const tickCfg = resolvePart(options.ticks, DEF_TICKS);
  const arcACfg = resolvePart(options.arcA, DEF_ARCA);
  const arcBCfg = resolvePart(options.arcB, DEF_ARCB);
  const innerCfg = resolvePart(options.inner, DEF_INNER);
  const digitCfg = resolvePart(options.digit, DEF_DIGIT);
  const cw = clockwise ? 1 : -1;

  const cls = {
    root: prefix + "root",
    tick: prefix + "tick",
    on: prefix + "on",
    arc: prefix + "arc",
    inner: prefix + "inner",
    digits: prefix + "digits",
    seg: prefix + "seg",
    sep: prefix + "sep",
    fill: prefix + "fill",
    track: prefix + "track",
    dtext: prefix + "dtext",
    glow: glow ? " " + prefix + "glow" : "",
    aglow: glow ? " " + prefix + "aglow" : "",
  };
  const zCls: Record<TRingZone, string> = {
    normal: prefix + "zone-normal",
    green: prefix + "zone-green",
    yellow: prefix + "zone-yellow",
    red: prefix + "zone-red",
    off: prefix + "zone-off",
  };
  const ALL_ZONES = [zCls.normal, zCls.green, zCls.yellow, zCls.red, zCls.off];
  let states = new WeakMap<Element, IRingState>();

  function zoneName(secOrIndex: number): TRingZone {
    if (secOrIndex < redAt) return "red";
    if (secOrIndex < yellowAt) return "yellow";
    return "green";
  }
  function themeColor(remaining: number, totalMin: number, sec: number, cb?: (i: IRingColorInfo) => string): string {
    if (cb) return cb({ remaining, totalMin, sec, colors });
    return totalMin === 0 ? colors[zoneName(sec)] : colors.normal;
  }
  /**
   * 默认走 CSS 变量驱动的档位 class；override 则内联 style.color（优先级更高）。
   * 用 __z 缓存上次档位：未变化直接跳过 classList 写入——避免每帧重复改类触发的样式重算。
   */
  function applyColor(node: TCacheEl, zone: TRingZone, override?: string): void {
    if (override != null) {
      if (node.style.color !== override) node.style.color = override;
      node.__z = undefined; // 用过内联色，下次走档位需重置
      return;
    }
    if (node.style.color) node.style.color = "";
    if (node.__z === zone) return; // 档位未变，跳过
    if (node.__z) node.classList.remove(zCls[node.__z]);
    else node.classList.remove(...ALL_ZONES);
    node.classList.add(zCls[zone]);
    node.__z = zone;
  }
  /** options 显式提供的颜色/线宽/灰底写成内联 CSS 变量（优先于样式表默认） */
  function applyVars(svg: SVGElement): void {
    const s = styleOf(svg);
    const oc = options.colors;
    if (oc) for (const k in oc) s.setProperty(`--${prefix}${k}`, String(oc[k as keyof IRingColors]));
    const w = (opt: TPart<{ width?: number }> | undefined, name: string) => {
      if (opt && typeof opt === "object" && opt.width != null) s.setProperty(`--${prefix}w-${name}`, String(opt.width));
    };
    w(options.arcA, "arcA");
    w(options.arcB, "arcB");
    w(options.inner, "inner");
    if (options.inner && typeof options.inner === "object" && options.inner.track != null) s.setProperty(`--${prefix}track`, options.inner.track);
  }

  function build(host: HTMLElement, text: string, total: number): IRingState {
    host.textContent = "";
    const svg = el("svg", { class: cls.root, viewBox: "0 0 100 100" });
    applyVars(svg);

    // —— 1. 最外圈刻度 ——
    const tickEls: SVGElement[] = [];
    let ticksHost: SVGElement | undefined;
    if (tickCfg) {
      const g = el("g", { class: prefix + "ticks" });
      if (!tickCfg.render) {
        const step = 360 / tickCfg.count;
        const tw = tickCfg.width;
        for (let i = 0; i < tickCfg.count; i++) {
          const r = el("rect", { class: cls.tick + cls.glow, x: 50 - tw / 2, y: 50 - tickCfg.radius, width: tw, height: tickCfg.length, rx: tw * 0.42, transform: `rotate(${-cw * i * step} 50 50)` });
          g.appendChild(r);
          tickEls.push(r);
        }
      }
      svg.appendChild(g);
      ticksHost = g;
    }

    // —— 4. 最内圈 ——
    let zones: IRingState["zones"];
    const minutes: IMinute[] = [];
    let innerHost: SVGElement | undefined;
    if (innerCfg) {
      const g = el("g", { class: cls.inner });
      innerHost = g;
      if (!innerCfg.render) {
        g.appendChild(el("circle", { class: cls.track, cx: 50, cy: 50, r: innerCfg.radius, fill: "none" }));
        const mkFill = () => {
          const p = el("path", { class: cls.fill + cls.aglow, fill: "none", stroke: "currentColor" });
          g.appendChild(p);
          return p;
        };
        const N = Math.max(1, Math.ceil(total / MINUTE));
        for (let j = 1; j < N; j++) {
          const from = j * MINUTE,
            to = Math.min((j + 1) * MINUTE, total);
          const p = mkFill();
          applyColor(p, "normal", innerCfg.colorAt ? innerCfg.colorAt({ index: j, count: N, fromMs: from, toMs: to, remaining: total, colors }) : undefined);
          minutes.push({ el: p, from, to });
        }
        const green = mkFill(),
          yellow = mkFill(),
          red = mkFill();
        applyColor(green, "green");
        applyColor(yellow, "yellow");
        applyColor(red, "red");
        zones = { red, yellow, green };
      }
      svg.appendChild(g);
    }

    // —— 2/3. 外2圈 / 外3圈 ——
    // 段数/弧度相同时（只差粗细与半径），两圈复用同一份弧 path：<defs> 里建一个源 <g>，
    // arcA/arcB 都用 <use> 引用——arcB 再缩放到自身半径（非缩放描边保证线宽独立）。
    // 几何不同或带自定义 render 时，退化为各自独立绘制。
    const arcPaths = (g: SVGElement, cfg: NonNullable<typeof arcACfg>) => {
      const SPAN = (cfg.span * Math.PI) / 180;
      const pitch = TAU / cfg.segments;
      for (let k = 0; k < cfg.segments; k++) {
        const mid = TOP + k * pitch;
        g.appendChild(el("path", { d: arcPath(50, 50, cfg.radius, mid - SPAN / 2, mid + SPAN / 2), fill: "none", stroke: "currentColor", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" }));
      }
    };
    const mkArcGroup = (cfg: NonNullable<typeof arcACfg>, mod: string): SVGElement => {
      const g = el("g", { class: cls.arc + " " + prefix + mod + cls.aglow });
      if (!cfg.render) arcPaths(g, cfg);
      svg.appendChild(g);
      return g;
    };
    let arcAHost: SVGElement | undefined;
    let arcBHost: SVGElement | undefined;
    let arcBScale: number | undefined;
    const reuse = arcACfg && arcBCfg && !arcACfg.render && !arcBCfg.render && arcACfg.segments === arcBCfg.segments && arcACfg.span === arcBCfg.span;
    if (reuse) {
      const srcId = prefix + "arcsrc" + SID++;
      const defs = el("defs");
      const src = el("g", { id: srcId });
      arcPaths(src, arcACfg!); // 源按外2圈半径建，外3圈用缩放贴合
      defs.appendChild(src);
      svg.appendChild(defs);
      arcAHost = el("use", { class: cls.arc + " " + prefix + "arcA" + cls.aglow });
      arcBHost = el("use", { class: cls.arc + " " + prefix + "arcB" + cls.aglow });
      setHref(arcAHost, srcId);
      setHref(arcBHost, srcId);
      svg.append(arcAHost, arcBHost);
      arcBScale = arcBCfg!.radius / arcACfg!.radius;
    } else {
      arcAHost = arcACfg ? mkArcGroup(arcACfg, "arcA") : undefined;
      arcBHost = arcBCfg ? mkArcGroup(arcBCfg, "arcB") : undefined;
    }

    // —— 数码区 ——
    let digitG: SVGElement | undefined;
    const cells: ICell[] = [];
    let digitText: SVGElement | undefined;
    if (digitCfg) {
      digitG = el("g", { class: cls.digits });
      if (!digitCfg.render && digitCfg.mode === "segment") {
        // 七段数码管：每位 7 段 polygon（按 rg-on 亮灭，残影靠 CSS opacity）。
        // 几何只算一次（BASE_PTS），各位靠 <g translate> 复用——比 symbol+use 换字更省（无 shadow 重建）。
        let x = 0;
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          if (isDigit(ch)) {
            const cellG = el("g", { transform: `translate(${x} 0)` });
            const segs: SVGElement[] = [];
            for (let s = 0; s < 7; s++) {
              const poly = el("polygon", { class: cls.seg + cls.glow, points: BASE_PTS[s] });
              cellG.appendChild(poly);
              segs.push(poly);
            }
            digitG.appendChild(cellG);
            cells.push({ digit: true, segs });
            x += DW + 2;
          } else {
            const t = el("text", { class: cls.sep + cls.glow, x: x + 2.5, y: DH / 2 + 5, "text-anchor": "middle", "font-size": 16 });
            t.textContent = ch;
            digitG.appendChild(t);
            cells.push({ digit: false, sep: t });
            x += 6;
          }
        }
        const totalW = x - 2;
        const sc = Math.min(digitCfg.size / totalW, (digitCfg.size * 0.43) / DH);
        digitG.setAttribute("transform", `translate(${50 - (totalW * sc) / 2} ${50 - (DH * sc) / 2}) scale(${sc})`);
      } else if (!digitCfg.render && digitCfg.mode === "text") {
        const t = el("text", { class: cls.dtext + cls.glow, x: 50, y: 50, "text-anchor": "middle", "dominant-baseline": "central", "font-size": digitCfg.size * 0.5 });
        styleOf(t).fontFamily = digitCfg.font;
        digitG.appendChild(t);
        digitText = t;
      }
      svg.appendChild(digitG);
    }

    host.appendChild(svg);
    return { svg, ticks: tickEls, ticksHost, arcAHost, arcBHost, zones, minutes, innerHost, digitG, cells, digitText, arcBScale, total, text: "", mask: maskOf(text) };
  }

  function paint(state: IRingState, text: string, totalMin: number, sec: number, remaining: number) {
    const finalMin = totalMin === 0;
    const total = state.total > 0 ? state.total : Math.max(remaining, 1);
    // 点亮格数 = 秒位本身（= 数码管显示的秒），归零即灭——避免显示 0 时仍多亮一格
    const lit = remaining <= 0 ? 0 : Math.min(tickCfg ? tickCfg.count : 0, sec);
    const frameBase = (host: SVGElement) => ({ host, remaining, totalMin, sec, finalMin, colors });

    // 1. 刻度
    if (tickCfg && state.ticksHost) {
      const tickZone = (i: number): TRingZone => (i >= lit ? "off" : finalMin ? zoneName(i) : "normal");
      if (tickCfg.render) {
        tickCfg.render({ ...frameBase(state.ticksHost), count: tickCfg.count, lit, zoneAt: tickZone });
      } else {
        for (let i = 0; i < state.ticks.length; i++) {
          const t = state.ticks[i] as TCacheEl;
          const on = i < lit;
          const override = tickCfg.colorAt ? (tickCfg.colorAt({ index: i, total: tickCfg.count, on, finalMin, sec, remaining, colors }) ?? undefined) : undefined;
          applyColor(t, tickZone(i), override);
          if (t.__on !== on) {
            t.classList.toggle(cls.on, on); // 仅亮灭翻转时改类
            t.__on = on;
          }
        }
      }
    }

    // 4. 最内圈
    if (innerCfg && state.innerHost) {
      const angleAt = (ms: number) => TOP - cw * (ms / total) * TAU;
      if (innerCfg.render) {
        innerCfg.render({ ...frameBase(state.innerHost), radius: innerCfg.radius, total, redAt, yellowAt, angleAt });
      } else if (state.zones) {
        const rem = Math.max(0, Math.min(remaining, total));
        const drawSeg = (path: TCacheEl, t0: number, t1: number) => {
          const hi = Math.min(t1, rem);
          const d = hi <= t0 ? "" : arcPath(50, 50, innerCfg.radius, angleAt(t0), angleAt(hi));
          if (path.__d !== d) {
            path.setAttribute("d", d); // d 未变则跳过，避免重光栅
            path.__d = d;
          }
        };
        for (let i = 0; i < state.minutes.length; i++) drawSeg(state.minutes[i].el, state.minutes[i].from, state.minutes[i].to);
        drawSeg(state.zones.red, 0, redAt * 1000);
        drawSeg(state.zones.yellow, redAt * 1000, yellowAt * 1000);
        drawSeg(state.zones.green, yellowAt * 1000, MINUTE);
      }
    }

    // 2/3. 外2圈跟随、外3圈反向；按剩余秒算 → 归零回基准位重合。scale 仅外3圈复用时贴合半径
    const secRem = Math.round(remaining / 1000);
    const paintArc = (cfg: typeof arcACfg, host: SVGElement | undefined, dir: number, scale?: number) => {
      if (!cfg || !host) return;
      const color = themeColor(remaining, totalMin, sec, cfg.colorAt);
      const rotation = dir * secRem * 6;
      if (cfg.render) {
        cfg.render({ ...frameBase(host), radius: cfg.radius, segments: cfg.segments, span: cfg.span, rotation, color });
      } else {
        applyColor(host, finalMin ? zoneName(sec) : "normal", cfg.colorAt ? color : undefined);
        // scale 绕中心：rotate(50,50) ∘ translate(d,d) scale(k)，d=50(1-k)
        const xf = scale != null ? `rotate(${rotation} 50 50) translate(${50 * (1 - scale)} ${50 * (1 - scale)}) scale(${scale})` : `rotate(${rotation} 50 50)`;
        const hc = host as TCacheEl;
        if (hc.__t !== xf) {
          host.setAttribute("transform", xf); // transform 未变则跳过
          hc.__t = xf;
        }
      }
    };
    paintArc(arcACfg, state.arcAHost, -cw);
    paintArc(arcBCfg, state.arcBHost, cw, state.arcBScale);

    // 数码区
    if (digitCfg && state.digitG) {
      const color = themeColor(remaining, totalMin, sec, digitCfg.colorAt);
      if (digitCfg.render) {
        digitCfg.render({ ...frameBase(state.digitG), text, color });
      } else {
        applyColor(state.digitG, finalMin ? zoneName(sec) : "normal", digitCfg.colorAt ? color : undefined);
        if (state.digitText) {
          if (text !== state.text) state.digitText.textContent = text;
        } else if (text !== state.text) {
          // segment：仅文本变化时切换七段亮灭，分隔符改文本
          for (let i = 0; i < state.cells.length; i++) {
            const cell = state.cells[i];
            const ch = text[i] ?? " ";
            if (cell.ch === ch) continue;
            cell.ch = ch;
            if (cell.digit && cell.segs) {
              const bits = SEGMENTS[ch] ?? 0;
              for (let s = 0; s < 7; s++) cell.segs[s].classList.toggle(cls.on, !!(bits & (1 << (6 - s))));
            } else if (cell.sep) {
              cell.sep.textContent = ch;
            }
          }
        }
      }
    }
    state.text = text;
  }

  const render = (host: Element, remaining: number, _value: unknown, ctx: ICountdownContext) => {
    // 向上取整到整秒：5s 倒计时一开始就显示 5（而非 4），且文本/刻度/内圈/弧全程一致，
    // 在数码管读到 0 的同一刻一起归零——既不会少 1（起始）也不会多走一格（结尾）。
    const remMs = Math.ceil(Math.max(0, remaining) / 1000) * 1000;
    const text = ctx.fmt(remMs, ctx);
    const mask = maskOf(text);
    let state = states.get(host);
    if (!state || state.mask !== mask) {
      const total = state && state.total > 0 ? state.total : Math.max(remMs, 1);
      state = build(host as HTMLElement, text, total);
      states.set(host, state);
    }
    // 调用频率交给 count-down：非毫秒任务它本就只在秒位变化时回调，无需插件内再去重。
    const remSec = remMs / 1000;
    paint(state, text, Math.floor(remSec / 60), remSec % 60, remMs);
  };

  /**
   * 释放引用、防内存泄漏（不改动宿主子节点，DOM 去留交调用方）：
   * - destroy(el)：断开该元素的状态引用（其 DOM/内部引用随之可回收）
   * - destroy()：丢弃整张状态表（释放渲染器对所有已渲染元素状态的引用）
   */
  render.destroy = (el?: Element): void => {
    if (el) states.delete(el);
    else states = new WeakMap();
  };

  return render;
}
