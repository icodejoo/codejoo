const tabs = await (await fetch("http://127.0.0.1:9342/json")).json();
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
ws.addEventListener("message", (m) => { console.log(m.data.slice(0,400)); process.exit(0); });
ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "new Promise(r=>{let t=performance.now();requestAnimationFrame(()=>r('raf ok '+(performance.now()-t)+' vis='+document.visibilityState+' focus='+document.hasFocus()))})", awaitPromise:true, returnByValue: true } }));
setTimeout(() => { console.log("rAF timeout"); process.exit(1); }, 10000);
