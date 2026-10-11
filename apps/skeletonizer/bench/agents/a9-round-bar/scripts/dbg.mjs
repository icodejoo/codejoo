import { launch } from "./lib.mjs";
const b = await launch({ headless: true });
try {
  await b.goto("http://localhost:5919/bench/agents/a9-round-bar/verify.html?cases=wrap", "window.ready===true");
  console.log(await b.ev(`JSON.stringify([...document.querySelectorAll("[skz-text]")].map(e=>{const c=getComputedStyle(e);return [e.closest("[skz]")?.getAttribute("skz-round"),c.backgroundClip,c.textDecorationLine,c.borderRadius]}))`));
  console.log(await b.ev(`document.querySelector('[skz-round="inline"]').outerHTML.slice(0,200)`));
} finally { await b.close(); }
