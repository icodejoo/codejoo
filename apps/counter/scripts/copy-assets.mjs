// 构建后把渲染插件的样式拷进 dist，随包分发（调用方自行引入 @codejoo/counter/card.css、/ring.css）。
import { copyFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const assets = ["card.css", "ring.css"];
await Promise.all(assets.map((f) => copyFile(resolve(dir, "../src/plugins", f), resolve(dir, "../dist", f))));
console.log("copied:", assets.join(", "));
