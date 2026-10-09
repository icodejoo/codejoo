// 在 gen-perf 的基础上追加 1d（单张 α=1 软光 + 衰减层）变体，输出 sc-all-v2.json
import fs from "node:fs";
import * as S from "./svgs.mjs";
const base = fs.readFileSync("base.css", "utf8");
const SEL = `[x-ske][x-ske-engine="svg"][x-ske-effect="shimmer"]`;
const att = "linear-gradient(color-mix(in srgb, var(--x-ske-color) 69%, transparent), color-mix(in srgb, var(--x-ske-color) 69%, transparent))";
fs.writeFileSync("p-1d-atten.css", `${base}\n${SEL}{--x-ske-bg-img:${att}, ${S.uri(S.band2a(1), "short")};--x-ske-bg-blend:normal, soft-light}\n`);
fs.writeFileSync("p-2f.css", `${base}
${SEL}{--x-ske-bg-img:${S.uri(S.band2g(), "short")};--x-ske-bg-blend:soft-light}
`);
const sc = JSON.parse(fs.readFileSync("sc-all.json", "utf8"));
const A = [["x-ske-effect", "shimmer"], ["x-ske-text", "leaf"], ["x-ske-engine", "svg"]];
sc.splice(sc.length - 1, 0, { name: "p-1d-atten", css: "p-1d-atten", n: 2000, attrs: A });
sc.splice(sc.length - 1, 0, { name: "p-2f", css: "p-2f", n: 2000, attrs: A });
fs.writeFileSync("sc-all-v2.json", JSON.stringify(sc, null, 1));
console.log(sc.map((s) => s.name).join(" | "));
