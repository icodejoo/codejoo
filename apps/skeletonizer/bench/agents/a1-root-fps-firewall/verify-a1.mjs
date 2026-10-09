// 正确性验证：防火墙 IO 版——视口内动、视口外静、滚回来立刻恢复。拿锁后跑，截图存 shots/
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const [port, profile, host] = process.argv.slice(2);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT = "C:/Users/jelon/AppData/Local/Temp/claude/E--workspaces-codejoo-apps-skeletonizer/e3f6b10e-1e75-45cc-b90b-f1592b13a871/scratchpad/bench-kit";
const LOCK = path.join(KIT, "bench.lock");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (file, ...args) => execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(KIT, file), ...args]).toString().trim();
fs.mkdirSync(path.join(HERE, "shots"), { recursive: true });
let waited = 0;
for (;;) { try { fs.mkdirSync(LOCK); break; } catch { if (waited % 30000 === 0) console.error(`[lock] wait ${waited / 1000}s`); await sleep(2000); waited += 2000; } }
fs.writeFileSync(path.join(LOCK, "owner.txt"), `${process.pid} ${new Date().toISOString()} verify-a1`);
const release = () => fs.rmSync(LOCK, { recursive: true, force: true });
try {
  const chrome = spawn(CHROME, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--window-size=1280,900", "about:blank"], { detached: true, stdio: "ignore" });
  chrome.unref(); await sleep(6000);
  let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(300); } }
  const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0; const pend = new Map();
  ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
  const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(HERE, "shots", name + ".png"), Buffer.from(r.result.data, "base64")); };
  await send("Page.enable"); await send("Page.bringToFront");
  for (const eff of ["shimmer", "pulse"]) {
    await send("Page.navigate", { url: `${host}?css=fw1` });
    for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250);
    await sleep(400);
    const n = await ev(`setup(2000, ${JSON.stringify([["x-ske-effect", eff], ["x-ske-text", "leaf"]])})`);
    await ev(`jsDrive("io", 0)`);
    // 取样：视口内第一张卡的骨头、视口外（第 1000 张）的骨头，某个样式值随时间的变化
    const probe = `(() => { const cs = __dbg.cards(); const p = (c) => { const b = c.querySelector("h3"); const s = getComputedStyle(b); return ${eff === "shimmer" ? "s.backgroundPosition" : "s.backgroundColor"}; }; return { vis: p(cs[0]), far: p(cs[1000]), fwVis: cs[0].hasAttribute("x-ske-fw"), fwFar: cs[1000].hasAttribute("x-ske-fw"), fwCount: cs.filter((c) => c.hasAttribute("x-ske-fw")).length, total: cs.length }; })()`;
    const samples = [];
    for (let i = 0; i < 5; i++) { samples.push(await ev(probe)); await sleep(130); }
    console.log(eff, "elements", n, "top samples", JSON.stringify(samples));
    await shot(`${eff}-top-a`); await sleep(300); await shot(`${eff}-top-b`);
    // 滚到中间
    await ev(`window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) / 2); (async()=>{for(let i=0;i<6;i++) await __dbg.nf();})()`);
    await sleep(300);
    const mid = await ev(`(() => { const cs = __dbg.cards(); const vis = cs.filter((c) => { const r = c.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }); return { visCount: vis.length, visFw: vis.filter((c) => c.hasAttribute("x-ske-fw")).length, fwCount: cs.filter((c) => c.hasAttribute("x-ske-fw")).length, total: cs.length }; })()`);
    console.log(eff, "mid", JSON.stringify(mid));
    const midSamples = []; for (let i = 0; i < 4; i++) { midSamples.push(await ev(`(() => { const cs = __dbg.cards(); const c = cs.find((c) => { const r = c.getBoundingClientRect(); return r.top > 100 && r.top < 300; }); const s = getComputedStyle(c.querySelector("h3")); return ${eff === "shimmer" ? "s.backgroundPosition" : "s.backgroundColor"}; })()`)); await sleep(130); }
    console.log(eff, "mid visible samples", JSON.stringify(midSamples));
    await shot(`${eff}-mid-a`); await sleep(300); await shot(`${eff}-mid-b`);
    // 滚回顶部：立刻（2 帧内）采样，应已恢复动画
    await ev(`window.scrollTo(0, 0)`);
    const back = []; for (let i = 0; i < 6; i++) { back.push(await ev(`(async () => { await __dbg.nf(); await __dbg.nf(); const cs = __dbg.cards(); const s = getComputedStyle(cs[0].querySelector("h3")); return { v: ${eff === "shimmer" ? "s.backgroundPosition" : "s.backgroundColor"}, fw: cs[0].hasAttribute("x-ske-fw") }; })()`)); }
    console.log(eff, "back-to-top samples", JSON.stringify(back));
    await shot(`${eff}-back`);
    // 对照：scrollTo 到 1/4 处再立刻截图，看快速跳转时有没有静止的卡片露出
    await ev(`window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) / 4)`);
    await shot(`${eff}-jump-immediate`);
  }
  await send("Browser.close").catch(() => {});
} finally { try { ps("kill-chrome.ps1", "-Port", port); } catch {} release(); }
process.exit(0);
