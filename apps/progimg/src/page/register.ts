/**
 * Register the prebuilt standalone Service Worker and start page-side takeover
 * in one call (SW-hosted assembly mode).
 *
 * 一步完成:注册预构建托管成品 Service Worker,并启动页面端零改造接管(SW 托管装配模式)。
 */

import { appendSWConfig } from "../shared/config-transport";
import type { ProgimgSWOptions } from "../shared/types";
import { auto } from "./auto";
import type { ProgimgAutoOptions } from "./types";

/** 等待 SW ready 的超时(毫秒):注册成功但安装失败时 ready 永不 resolve,超时后视为未控制继续启动 */
const READY_TIMEOUT_MS = 10000;

/**
 * Options accepted by {@link registerProgimgSW}: page-side takeover options
 * merged with the transferable subset of SW-side options.
 *
 * {@link registerProgimgSW} 接受的选项:页面端接管选项,并入可传输的 SW 端选项。
 *
 * 说明:SW 端选项中只有可序列化标量(`threshold`/`colorBlock`/`firstFrame` 等)会被
 * 编码进 SW 脚本 URL 的 query 生效;含正则的 `include`/`exclude` 与 SW 端 `onError`
 * 无法传进独立预构建 SW,如需定制请改用 `setupProgimg` 自建 SW。页面端 `onError`
 * 照常生效(SW 的错误会回传页面)。
 */
export type RegisterProgimgSWOptions = ProgimgAutoOptions & Partial<ProgimgSWOptions>;

/**
 * Result of {@link registerProgimgSW}.
 *
 * {@link registerProgimgSW} 的返回结果。
 */
export interface RegisterProgimgResult {
  /** Whether the current page is already controlled by the SW — 当前页面是否已被该 SW 控制 */
  controlled: boolean;
  /** Stop page-side takeover (disconnects observers, listeners) — 停止页面端接管(断开观察器与监听器) */
  stop: () => void;
}

/**
 * Register `swUrl` as a module Service Worker, wait for it to become ready, then
 * start page-side takeover automatically. Never throws; when Service Workers are
 * unsupported or registration fails it degrades gracefully — takeover still runs
 * but intercepted images simply load natively. Does not force a reload.
 *
 * 把 `swUrl` 注册为 module 类型 Service Worker,等待就绪后自动启动页面端接管。绝不抛异常;
 * 不支持 SW 或注册失败时优雅降级——接管照常运行,只是被接管的图片走原图正常加载。不会强制刷新。
 * @param swUrl - URL of the prebuilt SW script (e.g. '/progimg-sw.js') — 预构建 SW 脚本 URL(如 '/progimg-sw.js')
 * @param options - Page takeover + transferable SW options; see {@link RegisterProgimgSWOptions} — 页面接管 + 可传输 SW 选项
 * @returns Whether the page is SW-controlled, plus a `stop()` to end takeover — 页面是否被 SW 控制,以及结束接管的 `stop()`
 * @example
 * // 最简:注册即自动接管全站 <img>
 * const { controlled, stop } = await registerProgimgSW('/progimg-sw.js')
 * @example
 * // 带配置:页面端接管行为 + SW 端阈值/色块样式一起传
 * await registerProgimgSW('/progimg-sw.js', {
 *   videos: true,            // 页面端:一并接管 <video>
 *   offViewport: 'thumbnail',// 页面端:离开视口回退缩略图
 *   threshold: 200 * 1024,   // SW 端:大图阈值(经 query 传入)
 *   colorBlock: 'solid',     // SW 端:色块样式
 * })
 */
export async function registerProgimgSW(swUrl: string, options: RegisterProgimgSWOptions = {}): Promise<RegisterProgimgResult> {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) {
    return { controlled: false, stop: () => {} };
  }

  let controlled = false;
  try {
    await navigator.serviceWorker.register(appendSWConfig(swUrl, options), { type: "module" });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, READY_TIMEOUT_MS);
    });
    try {
      await Promise.race([navigator.serviceWorker.ready, timeout]);
    } finally {
      clearTimeout(timer);
    }
    controlled = !!navigator.serviceWorker.controller;
  } catch {
    // 注册失败降级:接管仍会挂上,被接管的图片走原图正常加载 — on failure, takeover degrades to native image loading
  }

  const stop = auto(options);
  return { controlled, stop };
}
