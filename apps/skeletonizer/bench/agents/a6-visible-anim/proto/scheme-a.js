/**
 * 方案 A 原型：只给视口内的列表项挂动画。
 * - 列表项定位复用 firewallItems；共用一个 IntersectionObserver（rootMargin 200px）。
 * - 进入视口：打 skz-anim（CSS 在该项上挂动画），随后把它的所有动画 startTime 置 0，
 *   这样所有可见项都按 document.timeline 的同一个时间轴取相位，和进入时刻无关。
 * - 离开视口：撤掉 skz-anim，动画消失。
 * - MutationObserver 盯列表容器的子节点增删，新项自动纳入。
 */
import { firewallItems } from "../../src/firewall.ts";

const ANIM_ATTR = "skz-anim";
const ROOT_ATTR = "skz-a";
const MARGIN = "200px";
/** 动画周期（--skz-duration 默认 1.5s）；pulse 是 alternate，完整周期是它的 2 倍 */
const DURATION_MS = 1500;

/** 观察器回调的开销统计（原型用） */
export const stats = { calls: 0, entries: 0, enter: 0, ms: 0, maxMs: 0, log: [] };

let io = null;
/** root -> { box, mo, items } */
const state = new Map();

function observer() {
  io ??= new IntersectionObserver(
    (entries) => {
      const t0 = performance.now();
      const entered = [];
      const mode = globalThis.__skzSync || "waapi"; // 对照用：waapi（默认）/ delay（负 animation-delay）/ none（不对齐）
      const phase = mode === "delay" ? -(document.timeline.currentTime % (2 * DURATION_MS)) + "ms" : "";
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.setAttribute(ANIM_ATTR, "");
          if (mode === "delay") e.target.style.animationDelay = phase;
          entered.push(e.target);
        } else {
          e.target.removeAttribute(ANIM_ATTR);
          if (mode === "delay") e.target.style.animationDelay = "";
        }
      }
      // 第二遍才读动画：getAnimations 会强制样式刷新，必须等全部属性写完再读，免得每项各刷一次
      if (mode === "waapi") for (const el of entered) for (const a of el.getAnimations()) a.startTime = 0;
      const dt = performance.now() - t0;
      stats.calls++;
      stats.entries += entries.length;
      stats.enter += entered.length;
      stats.ms += dt;
      if (dt > stats.maxMs) stats.maxMs = dt;
      stats.log.push([+dt.toFixed(2), entries.length, entered.length]);
    },
    { rootMargin: MARGIN },
  );
  return io;
}

export function resetStats() {
  Object.assign(stats, { calls: 0, entries: 0, enter: 0, ms: 0, maxMs: 0, log: [] });
}

export function startSchemeA(root) {
  stopSchemeA(root);
  const items = firewallItems(root);
  if (!items.length) return false;
  const obs = observer();
  const box = items[0].parentElement;
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      m.removedNodes.forEach((n) => { if (n.nodeType === 1) { obs.unobserve(n); n.removeAttribute(ANIM_ATTR); } });
      m.addedNodes.forEach((n) => { if (n.nodeType === 1) obs.observe(n); });
    }
  });
  mo.observe(box, { childList: true });
  root.setAttribute(ROOT_ATTR, "");
  for (const it of items) obs.observe(it);
  state.set(root, { box, mo, items });
  return true;
}

export function stopSchemeA(root) {
  const s = state.get(root);
  if (!s) return;
  s.mo.disconnect();
  for (const it of s.box.children) { io?.unobserve(it); it.removeAttribute(ANIM_ATTR); }
  for (const it of s.items) { io?.unobserve(it); it.removeAttribute(ANIM_ATTR); }
  root.removeAttribute(ROOT_ATTR);
  state.delete(root);
}
