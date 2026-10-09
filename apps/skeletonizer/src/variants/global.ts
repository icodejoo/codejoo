/**
 * global 方案（根驱动）的运行时：继承防火墙 + JS 计时器。导入即注册到核心。
 * - 找得到列表项：启用继承防火墙，视口外的项不参与逐帧样式重算；
 * - 找不到：按 fps 选项启用 JS 计时器；
 * 两者互斥：计时器写根的内联变量会穿过防火墙，让整棵子树重算（实测 16000 元素 60 → 27~39 帧）。
 * 不支持根驱动（@property + 相对颜色语法）的老浏览器：改由 applySvg 挂 blob SVG（fallback 为 "fade" 时不挂，保持基底 fade）。
 */
import { registerExtension } from "../enable.js";
import type { EnableOptions } from "../enable.js";
import { releaseSvg, applySvg } from "../svg.js";
import { startFirewall, stopFirewall } from "../firewall.js";
import { canTick, startTick, stopTick } from "../ticker.js";

/** 根驱动支持检测的缓存，首次用到时才计算（SSR 安全） */
let rootDriven: boolean | undefined;

/**
 * 当前浏览器能否用根驱动（@property 与相对颜色语法同版本落地，借后者判断；没有 CSS.supports 视为不支持）。
 * 惰性缓存，模块顶层不访问 CSS。
 * @returns 是否支持根驱动
 * @example if (!supportsRootDriven()) applySvg(el);
 */
export function supportsRootDriven(): boolean {
  rootDriven ??= typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("color", "rgb(from red r g b)");
  return rootDriven;
}

/** 清掉检测缓存，仅供测试切换 CSS.supports 的 mock 用 */
export function resetRootDrivenCache(): void {
  rootDriven = undefined;
}

/**
 * 按选项同步根：老浏览器改挂 SVG；否则先试防火墙，不成再看计时器。
 * @param el 骨架根元素
 * @param opts 骨架选项
 */
function sync(el: HTMLElement, opts: EnableOptions): void {
  if (!supportsRootDriven() && opts.fallback !== "fade") {
    stopFirewall(el);
    stopTick(el);
    applySvg(el);
    return;
  }
  releaseSvg(el);
  if (startFirewall(el)) {
    stopTick(el);
    return;
  }
  const { effect, fps } = opts;
  const rateOk = fps === "auto" || (typeof fps === "number" && fps > 0);
  if ((effect === "pulse" || effect === "shimmer") && rateOk && canTick()) startTick(el, effect, fps!);
  else stopTick(el);
}

/**
 * 撤掉防火墙、计时器和降级挂上的 SVG。
 * @param el 骨架根元素
 */
function release(el: HTMLElement): void {
  stopFirewall(el);
  stopTick(el);
  releaseSvg(el);
}

registerExtension({ engine: "global", sync, release });
