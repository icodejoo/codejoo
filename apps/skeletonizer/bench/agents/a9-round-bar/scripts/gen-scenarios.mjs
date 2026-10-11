// 生成场景：scenarios/sc-smoke.json、sc-P.json（常速）、sc-C.json（4x 降速）。
// 组：ul = 纯下划线（text:underline）、clip = 现状默认、round = A 方案（全部）、roundi = A 混合。
// 卡片结构：inl = 全行内 span（A 适用结构，主表）；blk = 老结构 h3/p/span（副表，看 A 用在块元素上的代价）。
import fs from "node:fs";
let seq = 0;
const cell = (name, n, engine, group, o = {}) => {
  const tok = [engine, ...(group === "roundr" ? ["roundr"] : group === "round" ? ["round"] : group === "roundi" ? ["roundi"] : []), ...(o.struct === "inl" ? ["inl"] : []), `f${++seq}`];
  const attrs = { effect: "shimmer", ...(group === "ul" ? { text: "underline" } : {}) };
  return { name, css: tok.join(","), n, attrs, toggle: true, toggleN: o.toggleN || 7, probe: engine === "global" && !o.cpu, snap: true, ...(o.cpu ? { cpu: o.cpu } : {}) };
};
const out = (f, a) => fs.writeFileSync(new URL(`../scenarios/${f}.json`, import.meta.url), JSON.stringify(a, null, 1));
out("sc-smoke", [["ul", "clip", "round", "roundi"].map((g) => cell(`smoke ${g} global`, 30, "global", g, { struct: "inl", toggleN: 2 })), ["clip", "round"].map((g) => cell(`smoke ${g} svg`, 30, "svg", g, { struct: "inl", toggleN: 2 }))].flat());
// 轮次 r（0 = 第一轮，即 sc-P / sc-C）：组顺序轮转、n 顺序反转，抵消批内漂移（热 / 冷）；每轮首尾各一个金丝雀
const rot = (a, r) => a.map((_, i) => a[(i + r) % a.length]);
const buildP = (r) => {
  const P = [cell(`CAN-a clip global inl @2000 r${r}`, 2000, "global", "clip", { struct: "inl" })];
  const ns = r % 2 ? [2000, 500] : [500, 2000];
  for (const n of ns) for (const e of rot(["global", "svg"], r)) for (const g of rot(["ul", "clip", "round"], r)) P.push(cell(`P ${e} ${g} inl @${n}`, n, e, g, { struct: "inl" }));
  for (const e of rot(["global", "svg"], r)) for (const g of rot(["clip", "round", "roundi"], r)) P.push(cell(`P ${e} ${g} blk @2000`, 2000, e, g, { struct: "blk" }));
  P.push(cell(`CAN-b clip global inl @2000 r${r}`, 2000, "global", "clip", { struct: "inl" }));
  return P;
};
const buildC = (r) => {
  const o = { struct: "inl", cpu: 4, toggleN: 3 };
  const C = [cell(`CAN-a 4x clip global inl @2000 r${r}`, 2000, "global", "clip", o)];
  for (const e of rot(["global", "svg"], r)) for (const g of rot(["ul", "clip", "round"], r)) C.push(cell(`C4 ${e} ${g} inl @2000`, 2000, e, g, o));
  for (const e of rot(["global", "svg"], r)) for (const g of rot(["clip", "round"], r)) C.push(cell(`C4 ${e} ${g} blk @2000`, 2000, e, g, { ...o, struct: "blk" }));
  C.push(cell(`CAN-b 4x clip global inl @2000 r${r}`, 2000, "global", "clip", o));
  return C;
};
out("sc-P", buildP(0)); out("sc-C", buildC(0));
for (const r of [1, 2]) { out(`sc-P${r + 1}`, buildP(r)); out(`sc-C${r + 1}`, buildC(r)); }

// 补测批：R = 常速 2000 卡 inl，clip / round（叠加）/ roundr（替换）；D = 4x 降速 inl，ul / clip / round / roundr。每批开头一个热身格（不测 trace / 开启），三轮轮转顺序。
const warm = (cpu) => ({ ...cell("WARM", 2000, "global", "clip", { struct: "inl", cpu }), noTrace: true, toggle: false, probe: false, snap: false });
const buildR = (r) => { const R = [warm(0)]; for (const e of rot(["global", "svg"], r)) for (const g of rot(["clip", "round", "roundr"], r)) R.push(cell(`R ${e} ${g} inl @2000`, 2000, e, g, { struct: "inl" })); R.push(cell(`CAN-b clip global inl @2000 R${r}`, 2000, "global", "clip", { struct: "inl" })); return R; };
const buildD = (r) => { const o = { struct: "inl", cpu: 4, toggleN: 3 }; const D = [warm(4)]; for (const e of rot(["global", "svg"], r)) for (const g of rot(["ul", "clip", "round", "roundr"], r)) D.push(cell(`D4 ${e} ${g} inl @2000`, 2000, e, g, o)); D.push(cell(`CAN-b 4x clip global inl @2000 D${r}`, 2000, "global", "clip", o)); return D; };
for (const r of [0, 1, 2]) { out(`sc-R${r + 1}`, buildR(r)); out(`sc-D${r + 1}`, buildD(r)); }
