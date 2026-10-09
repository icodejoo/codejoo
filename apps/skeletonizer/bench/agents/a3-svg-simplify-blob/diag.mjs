import fs from "node:fs";
import { runLocked, sleep } from "./lock.mjs";
await runLocked(9343, "diag", async ({ send, ev }) => {
  await send("Page.navigate", { url: "http://localhost:5188/demo/.tmp-a3/diag.html" });
  await sleep(1500);
  console.log(await ev("document.visibilityState + ' hasFocus=' + document.hasFocus()"));
  for (let k = 0; k < 3; k++) { const s = (await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 700, height: 260, scale: 1 } })).result.data; fs.writeFileSync(`diag-v2-${k}.png`, Buffer.from(s, "base64")); await sleep(350); }
});
