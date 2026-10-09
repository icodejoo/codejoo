import * as S from "./svgs.mjs";
const list = { cur: S.curShimmer(0.55), "2a": S.band2a(0.5), "2b-1": S.band2b1(0.5), "2b-2": S.band2b2(0.5), "2c": S.band2c(0.5), "2e": S.band2e(0.5), "2d": S.band2d(0.5), dip: S.dip(0.074) };
for (const [k, v] of Object.entries(list)) console.log(k.padEnd(6), "raw", v.length, "safe", S.uri(v, "safe").length, "short", S.uri(v, "short").length);
