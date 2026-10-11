// 跨轮汇总：同名格子取 3 轮中位数（也列出每轮值），金丝雀单列。用法：node aggregate.mjs [P|C]
import fs from "node:fs";
const kind = process.argv[2] || "P";
const files = { P: ["P", "P2", "P3"], C: ["C", "C2", "C3"], R: ["R1", "R2", "R3"], D: ["D1", "D2", "D3"] }[kind];
const rounds = files.map((f) => fs.readFileSync(new URL(`../results/${f}.jsonl`, import.meta.url), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)));
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const cells = new Map(), canary = [];
rounds.forEach((rows, ri) => rows.forEach((r) => { if (r.name === "WARM") return; if (r.name.startsWith("CAN")) canary.push({ round: ri + 1, ...r }); else { if (!cells.has(r.name)) cells.set(r.name, []); cells.get(r.name).push(r); } }));
const M = [["fps", "fps"], ["UpdateLayoutTree", "样式重算"], ["PrePaint", "PrePaint"], ["Paint", "Paint"], ["gpu", "GPU"], ["toggleMs", "开启ms"]];
const cellStr = (rs) => M.map(([k]) => { const v = rs.map((r) => r[k]).filter((x) => x !== undefined); return v.length ? (+med(v).toFixed(2)) : "—"; }).join(" / ");
const spread = (rs, k) => { const v = rs.map((r) => r[k]).filter((x) => x !== undefined); return v.length ? `${Math.min(...v)}–${Math.max(...v)}` : "—"; };
console.log(`### ${kind}：每格 ${M.map((m) => m[1]).join(" / ")}（${rounds.length} 轮中位数）\n`);
const groups = new Map();
for (const [name, rs] of cells) { const m = name.match(/^(P|C4|R|D4) (global|svg) (ul|clip|round|roundi|roundr) (inl|blk) @(\d+)$/); const key = `${m[2]} ${m[4]} @${m[5]}`; if (!groups.has(key)) groups.set(key, {}); groups.get(key)[m[3]] = rs; }
console.log("| 场景 | 纯下划线 ul | 现状 clip | A 叠加 round | A 混合 roundi | A 替换 roundr |\n|---|---|---|---|---|---|");
for (const [k, g] of groups) console.log(`| ${k} | ${g.ul ? cellStr(g.ul) : "—"} | ${g.clip ? cellStr(g.clip) : "—"} | ${g.round ? cellStr(g.round) : "—"} | ${g.roundi ? cellStr(g.roundi) : "—"} | ${g.roundr ? cellStr(g.roundr) : "—"} |`);
console.log("\n各格跨轮极差（fps / 样式重算 / PrePaint / GPU / 开启）：\n");
for (const [k, g] of groups) for (const [grp, rs] of Object.entries(g)) console.log(`- ${k} ${grp}：${spread(rs, "fps")} / ${spread(rs, "UpdateLayoutTree")} / ${spread(rs, "PrePaint")} / ${spread(rs, "gpu")} / ${spread(rs, "toggleMs")}`);
console.log("\n金丝雀（clip global inl @2000，每轮首尾各一）：\n\n| 轮 | 名称 | fps | 样式重算 | PrePaint | Paint | GPU | 开启ms |\n|---|---|---|---|---|---|---|---|");
for (const c of canary) console.log(`| ${c.round} | ${c.name} | ${c.fps} | ${c.UpdateLayoutTree} | ${c.PrePaint} | ${c.Paint} | ${c.gpu} | ${c.toggleMs} |`);
