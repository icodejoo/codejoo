const tabs = await (await fetch("http://127.0.0.1:9345/json")).json();
const t = tabs.find(t=>t.type==="page");
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener("open",r));
let id=0;const p=new Map();
ws.addEventListener("message",m=>{const d=JSON.parse(m.data);if(d.id&&p.has(d.id)){p.get(d.id)(d);p.delete(d.id)}});
const send=(method,params={})=>new Promise(r=>{const i=++id;p.set(i,r);ws.send(JSON.stringify({id:i,method,params}))});
for (const e of ["window.ready","document.visibilityState","document.getElementById('root').children.length","typeof setup"]) {
  const r = await Promise.race([send("Runtime.evaluate",{expression:e,returnByValue:true}), new Promise(r=>setTimeout(()=>r("timeout"),5000))]);
  console.log(e, JSON.stringify(r.result?.result ?? r));
}
process.exit(0);
