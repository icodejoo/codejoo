// 实验 5：运行时按根上 --x-ske-color / --x-ske-highlight / --x-ske-duration 生成 SVG，经 Blob URL 写回根的 --x-ske-svg-shimmer / --x-ske-svg-pulse
(function () {
  const cache = new Map(); // key -> {shimmer, pulse}
  const NS = "xmlns='http://www.w3.org/2000/svg'";
  /** 把 "1.5s" / "300ms" / "2" 解析成毫秒 */
  function toMs(v) { v = String(v).trim(); return v.endsWith("ms") ? parseFloat(v) : v.endsWith("s") ? parseFloat(v) * 1000 : parseFloat(v) * 1000; }
  /** 读根上的三个主题变量（颜色经过计算样式规范化为 rgb()） */
  function read(root) {
    const probe = document.createElement("i");
    probe.style.cssText = "position:absolute;visibility:hidden;color:var(--x-ske-highlight);background:var(--x-ske-color)";
    root.appendChild(probe);
    const s = getComputedStyle(probe);
    const out = { hl: s.color, color: s.backgroundColor, ms: toMs(getComputedStyle(root).getPropertyValue("--x-ske-duration")) };
    probe.remove();
    return out;
  }
  const shimmerSvg = (hl, ms) => `<svg ${NS} viewBox='0 0 100 100' preserveAspectRatio='none'><linearGradient id='g'><stop stop-color='${hl}' stop-opacity='0'/><stop offset='.5' stop-color='${hl}'/><stop offset='1' stop-color='${hl}' stop-opacity='0'/></linearGradient><rect width='60' height='100' fill='url(#g)'><animate attributeName='x' from='-60' to='110' dur='${ms}ms' repeatCount='indefinite'/></rect></svg>`;
  const pulseSvg = (hl, ms) => `<svg ${NS} viewBox='0 0 10 10' preserveAspectRatio='none'><rect width='10' height='10' fill='${hl}' opacity='0'><animate attributeName='opacity' values='0;1;0' dur='${ms * 2}ms' calcMode='spline' keySplines='.42 0 .58 1;.42 0 .58 1' repeatCount='indefinite'/></rect></svg>`;
  const mk = (svg) => URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  /** 生成并写到根上；返回 {ms:总耗时, key, hit} */
  window.Blob5 = {
    read, cache, shimmerSvg, pulseSvg, mk,
    apply(root) {
      const t0 = performance.now();
      const p = read(root);
      const key = `${p.color}|${p.hl}|${p.ms}`;
      let e = cache.get(key), hit = !!e;
      if (!e) { e = { shimmer: mk(shimmerSvg(p.hl, p.ms)), pulse: mk(pulseSvg(p.hl, p.ms)) }; cache.set(key, e); }
      root.style.setProperty("--x-ske-svg-shimmer", `url("${e.shimmer}")`);
      root.style.setProperty("--x-ske-svg-pulse", `url("${e.pulse}")`);
      return { ms: performance.now() - t0, key, hit, url: e.shimmer };
    },
    revokeAll() { for (const e of cache.values()) { URL.revokeObjectURL(e.shimmer); URL.revokeObjectURL(e.pulse); } cache.clear(); },
  };
})();
