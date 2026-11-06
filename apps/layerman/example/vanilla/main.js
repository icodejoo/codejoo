import { createLayerman } from "@codejoo/layerman";

/** 管理器：gap 200ms，肉眼可见「一次一个」。 */
const om = createLayerman({ gap: 200 });
await om.ready(); // 等冷却状态从存储 hydrate 完

const root = document.getElementById("overlay-root");
const logEl = document.getElementById("log");
/** instanceKey → 已挂载的 DOM 节点，用于增量渲染。 */
const nodes = new Map();

/** 追加一行日志到页面。 */
function log(text) {
  logEl.textContent += `${text}\n`;
}

/** 按实例构建 DOM：toast 与对话框两种外观，按钮把结果交回管理器。 */
function build(inst) {
  const { kind, text } = inst.data;
  if (kind === "toast") {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    return el;
  }
  const mask = document.createElement("div");
  mask.className = "mask";
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<p>${text}</p>`;
  for (const [label, value] of [["确定", true], ["取消", false]]) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.onclick = () => {
      om.resolve(inst.id, value); // 投递结果（不关闭）
      om.close(inst.id); // 进入 closing，播放退场后自动 remove
    };
    card.append(btn);
  }
  mask.append(card);
  return mask;
}

/** 把 active 列表同步到 DOM：新增挂载、已有更新 phase/层级、消失的卸载。 */
function render(state) {
  const alive = new Set();
  for (const inst of state.active) {
    alive.add(inst.instanceKey); // instanceKey 当 render key：同 id 重开会重新挂载
    let el = nodes.get(inst.instanceKey);
    if (!el) {
      el = build(inst);
      nodes.set(inst.instanceKey, el);
      root.append(el);
    }
    el.dataset.phase = inst.phase; // open | closing，CSS 据此播放退场
    el.dataset.top = String(inst.isTopmost); // 非顶层不接收点击
    el.style.zIndex = String(1000 + inst.stackIndex); // headless：z-index 由宿主算
  }
  for (const [key, el] of nodes) {
    if (!alive.has(key)) {
      el.remove();
      nodes.delete(key);
    }
  }
}

om.subscribe(render, { immediate: true });

/** 把 result 的两种形态（宿主投递值 / 被动结束）打印出来。 */
function report(name, result) {
  void result.then((r) => {
    if (r && typeof r === "object" && "dismissed" in r) log(`${name} → 被动结束：${r.reason}`);
    else log(`${name} → 你选了：${r}`);
  });
}

/** 按钮 → 动作表。 */
const actions = {
  confirm: () => report("confirm", om.open({ id: "confirm", data: { kind: "dialog", text: "确认删除？" } }).result),
  queue: () => {
    for (const [id, priority] of [["低", 0], ["高", 10], ["中", 5]]) {
      report(id, om.open({ id: `q-${id}`, priority, data: { kind: "dialog", text: `队列项：${id}（priority ${priority}）` } }).result);
    }
  },
  toast: () => report("toast", om.open({ data: { kind: "toast", text: "已保存" }, duration: 1500, overlap: true }).result),
  overlap: () => om.open({ id: "alert", overlap: true, data: { kind: "dialog", text: "⚠ 全局告警（叠加显示）" } }),
  replace: () => om.open({ id: "urgent", replace: true, data: { kind: "dialog", text: "🔥 抢占当前弹窗" } }),
  route: () => report("vip", om.open({ id: "vip", route: "/vip", data: { kind: "dialog", text: "VIP 专属" } }).result),
  goVip: () => om.setContext({ route: "/vip" }),
  pause: () => {
    if (actions.paused) om.resumeAll();
    else om.pauseAll();
    actions.paused = !actions.paused;
    log(actions.paused ? "已 pauseAll" : "已 resumeAll");
  },
  clear: () => om.clear({ closeActive: true }),
};

document.addEventListener("click", (ev) => {
  const act = ev.target instanceof HTMLElement ? ev.target.dataset.act : undefined;
  if (act && actions[act]) actions[act]();
});

