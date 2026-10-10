// 生成 scenarios/sc-S.json：simplify 后复测。2000 卡 × {pulse global, shimmer global} × {clip, underline}，首尾各一对金丝雀（同 gen-scenarios.mjs）
import fs from "node:fs";
const HERE = new URL("./", import.meta.url);
const G = "base,global,tofu";
const sc = (name, css, n, attrs, extra = {}) => ({ name, css, n, attrs, ...extra });
const canary = (t) => [sc(`CAN-${t} canary shimmer global clip @500`, G, 500, { effect: "shimmer" }, { probe: true }), sc(`CAN-${t}f canary fade clip @2000`, "base", 2000, { effect: "fade" })];
const rows = [];
for (const [mode, extra] of [["clip", {}], ["underline", { text: "underline" }]]) for (const eff of ["pulse", "shimmer"]) rows.push(sc(`S-${eff}-${mode} @2000`, G, 2000, { effect: eff, ...extra }, { probe: eff === "shimmer" }));
const list = [...canary("1"), ...rows, ...canary("2")];
fs.mkdirSync(new URL("scenarios/", HERE), { recursive: true });
fs.writeFileSync(new URL("scenarios/sc-S.json", HERE), JSON.stringify(list));
console.log("S", list.length);
