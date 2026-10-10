import { launch } from "./lib.mjs"; import fs from "node:fs";
const c = await launch({ headless: true });
await c.goto("http://localhost:5198/bench/agents/a8-tofu-font/fonttest.html");
const out = [];
for (const [f, fmt] of [["tofu-fmt13.ttf","truetype"],["tofu-fmt4.ttf","truetype"],["tofu-both.ttf","truetype"],["tofu-fmt13.woff","woff"],["tofu-fmt13.woff2","woff2"],["tofu-fmt4.woff2","woff2"],["tofu-both.woff2","woff2"]]) {
  const r = await c.ev(`test("/bench/agents/a8-tofu-font/fonts/${f}","${fmt}")`); out.push(r); console.log(f, JSON.stringify(r));
}
fs.writeFileSync("data/cmaptest.jsonl", out.map((o) => JSON.stringify(o)).join("\n") + "\n");
console.log(await c.ev("navigator.userAgent"));
await c.close();
