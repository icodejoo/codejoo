// 实验 4：合成层证据。orig 根高 40049px 时 ::after 的合成层是否存在、多大、drawsContent；DPR 1 与 2
import { launch, open, sleep } from "./cdp.mjs";
import fs from "node:fs";
const v = process.argv[2] || "orig";
const b = await launch(); const out = [];
let layers = null; b.on((d) => { if (d.method === "LayerTree.layerTreeDidChange") layers = d.params.layers; });
for (const dpr of [1, 2]) {
  await open(b, `css=base,sweep&v=${v}`, [1200, 800, dpr]);
  await b.send("LayerTree.enable");
  for (const n of [37, 296]) {
    layers = null; await b.ev(`setup(${n}, { effect: "sweep" })`); await sleep(1200);
    await b.ev("window.scrollBy(0, 1)"); await sleep(600);
    const big = (layers || []).filter((l) => l.height > 3000 || l.width > 3000).map((l) => ({ w: l.width, h: l.height, drawsContent: l.drawsContent, anchorX: l.anchorX, transform: l.transform && l.transform.map((x) => +x.toFixed(2)) }));
    const r = { v, dpr, n, rootHeight: await b.ev('Math.round(document.getElementById("root").getBoundingClientRect().height)'), layerCount: (layers || []).length, bigLayers: big, gpu: dpr === 1 ? undefined : undefined };
    out.push(r); console.log(JSON.stringify(r));
  }
  await b.send("LayerTree.disable");
}
fs.writeFileSync(`results/exp4-layers-${v}.jsonl`, out.map((o) => JSON.stringify(o)).join("\n") + "\n");
await b.close();
