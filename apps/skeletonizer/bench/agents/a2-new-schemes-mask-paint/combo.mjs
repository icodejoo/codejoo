// 同一把锁内顺序跑：trace3（补充场景，保留浏览器）+ shot（截图 / 像素分析，结束时关浏览器）
import { spawnSync } from "node:child_process";
import fs from "node:fs";
const cwd = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const r1 = spawnSync(process.execPath, ["trace3.mjs", "s-oneoff-v3.json", "3"], { env: { ...process.env, PERF_KEEP: "1" }, stdio: ["ignore", fs.openSync(cwd + "results-v3-oneoff.jsonl", "w"), "inherit"], cwd });
console.error("[combo] trace3 exit", r1.status);
const r2 = spawnSync(process.execPath, ["shot.mjs"], { env: process.env, stdio: ["ignore", fs.openSync(cwd + "results-shots.json", "w"), "inherit"], cwd });
console.error("[combo] shot exit", r2.status);
