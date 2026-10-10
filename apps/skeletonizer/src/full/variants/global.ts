/**
 * global 方案（根驱动）的运行时：继承防火墙。导入即注册到 engine 方案表。
 * 找得到列表项时启用继承防火墙，视口外的项不参与逐帧样式重算；没有列表结构的大骨架建议改用 engine: "svg"。
 * 不支持根驱动（@property + 相对颜色语法）的老浏览器：改由 applySvg 挂 blob SVG（fallback 为 "fade" 时不挂，保持基底 fade）。
 */
import type { EnableOptions } from "../../core/types.js";
import { registerEngine } from "../engine.js";
import { releaseSvg, applySvg } from "../svg.js";
import { startFirewall, stopFirewall } from "../firewall.js";

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
 * 按选项同步根：老浏览器改挂 SVG；否则撤掉降级 SVG 并启动防火墙。
 * @param el 骨架根元素
 * @param opts 骨架选项
 */
function sync(el: HTMLElement, opts: EnableOptions): void {
  if (!supportsRootDriven() && opts.fallback !== "fade") {
    stopFirewall(el);
    applySvg(el);
    return;
  }
  releaseSvg(el);
  startFirewall(el);
}

/**
 * 撤掉防火墙和降级挂上的 SVG。
 * @param el 骨架根元素
 */
function release(el: HTMLElement): void {
  stopFirewall(el);
  releaseSvg(el);
}

registerEngine({ engine: "global", sync, release });
