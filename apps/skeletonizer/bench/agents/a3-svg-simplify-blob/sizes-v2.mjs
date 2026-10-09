// 实验 2：各写法的体积（raw / 全转义 safe / 只转 # 的 short），含 2f（错版）、2g（修正最短版）
import * as S from "./svgs.mjs";
const list = { "cur 现役(浅色 .55)": S.curShimmer(0.55), "2a rect+animateTransform": S.band2a(0.5), "2b-1 渐变 x1/x2 animate": S.band2b1(0.5), "2b-2 gradientTransform": S.band2b2(0.5), "2c viewBox animate": S.band2c(0.5), "2e animate x": S.band2e(0.5), "2d reflect 两 stop + animate x": S.band2d(0.5), "2f(起点算错，作废)": S.band2f(), "2g 最短(α=1,to-only,viewBox 60)": S.band2g(), "1b 凹口(黑)": S.dip(0.074) };
for (const [k, v] of Object.entries(list)) console.log(k.padEnd(34), "raw", String(v.length).padStart(4), "safe", String(S.uri(v, "safe").length).padStart(4), "short", String(S.uri(v, "short").length).padStart(4), "(url(\"...\") 含 data:image/svg+xml, 头)");
console.log("\n2g 源码：\n" + S.band2g());
console.log("\n2g safe URI：\n" + S.uri(S.band2g(), "safe"));
