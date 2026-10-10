import { launch, sleep } from "./lib.mjs";
const c = await launch({ headless: false });
await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
for (const eff of ["solid", "pulse", "shimmer", "fade"]) {
  await c.goto("http://localhost:5198/bench/agents/a8-tofu-font/demo.html?css=base,global,tofu", "window.ready===true");
  await c.ev(`apply({effect:"${eff}",text:"tofu"})`); await sleep(500);
  console.log(eff, await c.ev(`(()=>{const e=document.querySelector("#cards .btn");const s=getComputedStyle(e);return JSON.stringify({bg:s.backgroundColor,tbg:s.getPropertyValue("--skz-tbg"),attrs:document.querySelector("#cards").getAttributeNames().join()})})()`));
}
await c.close();
