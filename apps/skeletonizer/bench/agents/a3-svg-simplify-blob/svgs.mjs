// 各种 SVG 写法的生成器（实验用，不进正式代码）。
// 约定：背景图尺寸 100vw 100vh，viewBox 100x100 且 preserveAspectRatio=none；光带宽 60，中心在 x∈[-30,140] 平移，周期 dur。
export const NS = "xmlns='http://www.w3.org/2000/svg'";
const HEAD = `<svg ${NS} viewBox='0 0 100 100' preserveAspectRatio='none'>`;

/** 编码成 data URI：mode "safe"=`<>#` 全转义（兼容旧 Firefox），"short"=只转 # */
export function uri(svg, mode = "safe") {
  let s = svg.replace(/#/g, "%23");
  if (mode === "safe") s = s.replace(/</g, "%3C").replace(/>/g, "%3E");
  return `url("data:image/svg+xml,${s}")`;
}

const stops = (a, c = "#fff") =>
  `<stop stop-color='${c}' stop-opacity='0'/><stop offset='.5' stop-color='${c}' stop-opacity='${a}'/><stop offset='1' stop-color='${c}' stop-opacity='0'/>`;

/** 2a：白色光带（rect + animateTransform），峰值不透明度 a */
export const band2a = (a = 0.5, dur = "1.5s", c = "#fff") =>
  `${HEAD}<defs><linearGradient id='g'>${stops(a, c)}</linearGradient></defs><rect width='60' height='100' fill='url(#g)'><animateTransform attributeName='transform' type='translate' from='-60 0' to='110 0' dur='${dur}' repeatCount='indefinite'/></rect></svg>`;

/** 1b：黑色"凹口"，光带中心透明，两侧不透明度 a（底色用高光色） */
export const dip = (a = 0.074, dur = "1.5s") =>
  `${HEAD}<defs><linearGradient id='g'><stop offset='.2' stop-opacity='${a}'/><stop offset='.5' stop-opacity='0'/><stop offset='.8' stop-opacity='${a}'/></linearGradient></defs><rect width='200' height='100' fill='url(#g)'><animateTransform attributeName='transform' type='translate' from='-130 0' to='40 0' dur='${dur}' repeatCount='indefinite'/></rect></svg>`;

/** 2b-1：渐变 x1/x2 各一个 animate，rect 铺满 */
export const band2b1 = (a = 0.5, dur = "1.5s") =>
  `${HEAD}<linearGradient id='g' x1='-.6' x2='0'><animate attributeName='x1' from='-.6' to='1.1' dur='${dur}' repeatCount='indefinite'/><animate attributeName='x2' from='0' to='1.7' dur='${dur}' repeatCount='indefinite'/>${stops(a)}</linearGradient><rect width='100' height='100' fill='url(#g)'/></svg>`;

/** 2b-2：gradientTransform 的 animateTransform，渐变向量 0~.6 */
export const band2b2 = (a = 0.5, dur = "1.5s") =>
  `${HEAD}<linearGradient id='g' x2='.6'><animateTransform attributeName='gradientTransform' type='translate' from='-.6 0' to='1.1 0' dur='${dur}' repeatCount='indefinite'/>${stops(a)}</linearGradient><rect width='100' height='100' fill='url(#g)'/></svg>`;

/** 2c：动 viewBox，矩形静止在 0~60 */
export const band2c = (a = 0.5, dur = "1.5s") =>
  `<svg ${NS} viewBox='60 0 100 100' preserveAspectRatio='none'><animate attributeName='viewBox' from='60 0 100 100' to='-110 0 100 100' dur='${dur}' repeatCount='indefinite'/><linearGradient id='g'>${stops(a)}</linearGradient><rect width='60' height='100' fill='url(#g)'/></svg>`;

/** 2e：rect 的 x 属性做 animate（比 animateTransform 短） */
export const band2e = (a = 0.5, dur = "1.5s") =>
  `${HEAD}<linearGradient id='g'>${stops(a)}</linearGradient><rect width='60' height='100' fill='url(#g)'><animate attributeName='x' from='-60' to='110' dur='${dur}' repeatCount='indefinite'/></rect></svg>`;

/** 2d：最短写法候选（reflect 渐变两个 stop；animate x；去 defs） */
export const band2d = (a = 0.5, dur = "1.5s") =>
  `${HEAD}<linearGradient id='g' x2='.5' spreadMethod='reflect'><stop stop-color='#fff' stop-opacity='0'/><stop offset='1' stop-color='#fff' stop-opacity='${a}'/></linearGradient><rect width='60' height='100' fill='url(#g)'><animate attributeName='x' from='-60' to='110' dur='${dur}' repeatCount='indefinite'/></rect></svg>`;

/** 现役 SVG（原样取自 effects.scss，用来对比） */
export const curShimmer = (a) =>
  `${HEAD}<defs><linearGradient id='g'><stop offset='0' stop-color='#fff' stop-opacity='0'/><stop offset='.5' stop-color='#fff' stop-opacity='${a}'/><stop offset='1' stop-color='#fff' stop-opacity='0'/></linearGradient></defs><rect width='60' height='100' fill='url(#g)'><animateTransform attributeName='transform' type='translate' from='-60 0' to='110 0' dur='1.5s' repeatCount='indefinite'/></rect></svg>`;

/** 2f：最短候选。viewBox 左移 60，rect 从 x=0 用 to-only 动画到 170；reflect 渐变两个 stop；峰值不透明度 1（省 stop-opacity）；white 比 #fff 短且不用转义 */
export const band2f = (dur = "1.5s") =>
  `<svg ${NS} viewBox='-60 0 100 100' preserveAspectRatio='none'><linearGradient id='g' x2='.5' spreadMethod='reflect'><stop stop-color='white' stop-opacity='0'/><stop offset='1' stop-color='white'/></linearGradient><rect width='60' height='100' fill='url(#g)'><animate attributeName='x' to='170' dur='${dur}' repeatCount='indefinite'/></rect></svg>`;

/** 2f 的"第一个 stop 不写 stop-color"版本：测透明黑 → 白插值会不会出黑边 */
export const band2fBlk = (dur = "1.5s") =>
  `<svg ${NS} viewBox='-60 0 100 100' preserveAspectRatio='none'><linearGradient id='g' x2='.5' spreadMethod='reflect'><stop stop-opacity='0'/><stop offset='1' stop-color='white'/></linearGradient><rect width='60' height='100' fill='url(#g)'><animate attributeName='x' to='170' dur='${dur}' repeatCount='indefinite'/></rect></svg>`;

/** 2g：2f 的修正版（2f 的 viewBox 起点算错，光带从屏幕中间出发）。viewBox 起点 60，rect 默认 x=0（即视口左缘外 60），to-only 动画到 170（行程 170，同 2a） */
export const band2g = (dur = "1.5s") =>
  `<svg ${NS} viewBox='60 0 100 100' preserveAspectRatio='none'><linearGradient id='g' x2='.5' spreadMethod='reflect'><stop stop-color='white' stop-opacity='0'/><stop offset='1' stop-color='white'/></linearGradient><rect width='60' height='100' fill='url(#g)'><animate attributeName='x' to='170' dur='${dur}' repeatCount='indefinite'/></rect></svg>`;
