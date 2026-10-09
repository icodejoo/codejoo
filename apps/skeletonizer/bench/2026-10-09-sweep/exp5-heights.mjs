// 实验 5：交付截图。根高 5k/20k/40k/80k（37/148/296/591 张卡）x 两种模式 x orig/new：
// 在根的"光带应经过的位置"截图。orig 滚到根顶部（用户默认看到的位置），t=250ms 与 t=550ms 各一张；
// 用 md5 判断两张是否不同，并用与 t=0 的像素差给出光带像素数
import { launch, open, pauseAt, sleep, grab, diff } from "./cdp.mjs";
import crypto from "node:crypto";
import fs from "node:fs";
const out = [];
const b = await launch();
for (const v of ["orig", "new"]) {
  await open(b, `css=base,sweep&v=${v}`);
  for (const mode of ["blend", "bg"]) for (const [h, n] of [["5k", 37], ["20k", 148], ["40k", 296], ["80k", 591]]) {
    await b.ev(`setup(${n}, { effect: "sweep"${mode === "bg" ? ', _attrs: [["skz-sweep","bg"]]' : ""} })`); await sleep(400);
    const H = await b.ev('Math.round(document.getElementById("root").getBoundingClientRect().height)');
    await pauseAt(b, 0); await sleep(200); const a = await grab(b);
    const res = { v, mode, h, rootHeight: H };
    for (const t of [250, 550]) {
      await pauseAt(b, t); await sleep(200); const c = await grab(b, `h-${v}-${mode}-${h}-t${t}.png`);
      res[`t${t}`] = diff(a, c).n; res[`md5_${t}`] = crypto.createHash("md5").update(c.data).digest("hex").slice(0, 8);
    }
    res.movesBetween = res.md5_250 !== res.md5_550; out.push(res); console.log(JSON.stringify(res));
  }
}
fs.writeFileSync("results/exp5-heights.jsonl", out.map((o) => JSON.stringify(o)).join("\n") + "\n");
await b.close();
