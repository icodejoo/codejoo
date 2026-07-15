import { decode as msgpackDecode } from "@msgpack/msgpack";
import { Stompsocket, type JsonMessage, type StompSub } from "@codejoo/stomp";
import { decompressSync as gunzipSync } from "fflate";
import { decompress as zstdDecompress } from "fzstd";

interface PresetTopic {
  destination: string;
  label: string;
}

// 前 1 个是普通 JSON topic（对照组），后 5 个是 api-ws-demo 的静态压缩测试 topic——
// SEND 什么内容都会被服务端忽略，一律广播固定的 gzip/zstd/msgpack 数据，用来测
// binaryDecoder 能不能正确解码。
const PRESET_TOPICS: PresetTopic[] = [
  { destination: "/topic/public/browser-demo", label: "公共 topic（普通 JSON，对照组）" },
  { destination: "/topic/compressed", label: "gzip 压缩 JSON" },
  { destination: "/topic/compressed-zstd", label: "zstd 压缩 JSON" },
  { destination: "/topic/compressed-mp", label: "msgpack（未压缩）" },
  { destination: "/topic/compressed-mp-gzip", label: "msgpack + gzip" },
  { destination: "/topic/compressed-mp-zstd", label: "msgpack + zstd" },
];

/**
 * 依次尝试 gzip/zstd 解压，再依次尝试 JSON/msgpack 解码——binaryDecoder 本身只拿到原始
 * 字节（没有 content-type/content-encoding），所以用"多试一次"的方式覆盖这 5 种组合。
 */
function decodeCompressed(bytes: Uint8Array): JsonMessage {
  const candidates: Uint8Array[] = [bytes];
  try {
    candidates.push(gunzipSync(bytes));
  } catch {
    /* 不是 gzip/zlib/deflate */
  }
  try {
    candidates.push(zstdDecompress(bytes));
  } catch {
    /* 不是 zstd */
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(new TextDecoder().decode(candidate)) as JsonMessage;
    } catch {
      /* 不是 JSON 文本 */
    }
    try {
      return msgpackDecode(candidate) as JsonMessage;
    } catch {
      /* 不是 msgpack */
    }
  }
  throw new Error("解码失败：既不是 gzip/zstd 压缩的 JSON，也不是 msgpack");
}

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

const logEl = $<HTMLDivElement>("log");
const stateEl = $<HTMLSpanElement>("state");
const presetsEl = $<HTMLTableElement>("presets");

function log(text: string, cls?: string): void {
  const line = document.createElement("div");
  if (cls) line.className = cls;
  const ts = new Date().toLocaleTimeString();
  line.textContent = `[${ts}] ${text}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

let client: Stompsocket | null = null;
const activeSubs = new Map<string, StompSub>(); // destination -> sub

function setConnectedUi(connected: boolean): void {
  $<HTMLButtonElement>("connectBtn").disabled = connected;
  $<HTMLButtonElement>("disconnectBtn").disabled = !connected;
  $<HTMLButtonElement>("subscribeBtn").disabled = !connected;
  $<HTMLInputElement>("url").disabled = connected;
  $<HTMLInputElement>("messageInput").disabled = !connected;
  $<HTMLButtonElement>("sendBtn").disabled = !connected;
  for (const btn of presetsEl.querySelectorAll<HTMLButtonElement>("button")) {
    btn.disabled = !connected;
  }
  if (!connected) {
    activeSubs.clear();
    renderPresetButtons();
  }
}

function renderPresetButtons(): void {
  for (const { destination } of PRESET_TOPICS) {
    const btn = presetsEl.querySelector<HTMLButtonElement>(`button[data-dest="${destination}"]`);
    if (!btn) continue;
    const subscribed = activeSubs.has(destination);
    btn.textContent = subscribed ? "取消订阅" : "订阅";
    btn.classList.toggle("subscribed", subscribed);
  }
}

function subscribeTo(destination: string): void {
  if (!client || activeSubs.has(destination)) return;
  const sub = client.subscribe(destination, (json) => log(`收到 [${destination}]: ${JSON.stringify(json)}`, "in"));
  activeSubs.set(destination, sub);
  log(`已订阅 ${destination}`, "sys");
  renderPresetButtons();
}

function unsubscribeFrom(destination: string): void {
  const sub = activeSubs.get(destination);
  if (!sub) return;
  sub.unsubscribe();
  activeSubs.delete(destination);
  log(`已取消订阅 ${destination}`, "sys");
  renderPresetButtons();
}

// 渲染预设 topic 列表
for (const { destination, label } of PRESET_TOPICS) {
  const tr = document.createElement("tr");
  const tdLabel = document.createElement("td");
  tdLabel.textContent = label;
  const tdDest = document.createElement("td");
  tdDest.className = "dest";
  tdDest.textContent = destination;
  const tdBtn = document.createElement("td");
  const btn = document.createElement("button");
  btn.dataset.dest = destination;
  btn.textContent = "订阅";
  btn.disabled = true;
  btn.addEventListener("click", () => {
    if (activeSubs.has(destination)) unsubscribeFrom(destination);
    else subscribeTo(destination);
  });
  tdBtn.appendChild(btn);
  tr.append(tdLabel, tdDest, tdBtn);
  presetsEl.appendChild(tr);
}

$<HTMLButtonElement>("connectBtn").addEventListener("click", () => {
  const brokerURL = $<HTMLInputElement>("url").value.trim();
  if (!brokerURL) return;

  client = new Stompsocket({
    brokerURL,
    debug: false,
    binaryDecoder: decodeCompressed,
    onStateChanged: (s) => {
      stateEl.textContent = s;
      stateEl.className = s;
    },
    onConnected: () => log("已连接到服务器", "sys"),
    onDisconnected: () => log("已断开连接", "sys"),
    onStompError: (frame) => log(`服务端 ERROR: ${frame.headers.message ?? ""}`, "err"),
    onWebSocketError: () => log("WebSocket 连接错误", "err"),
  });
  client.activate();
  setConnectedUi(true);
});

$<HTMLButtonElement>("disconnectBtn").addEventListener("click", () => {
  if (!client) return;
  void client.dispose().then(() => {
    client = null;
    setConnectedUi(false);
  });
});

$<HTMLButtonElement>("subscribeBtn").addEventListener("click", () => {
  const topic = $<HTMLInputElement>("topic").value.trim();
  if (topic) subscribeTo(topic);
});

function sendMessage(): void {
  if (!client) return;
  const destination = $<HTMLInputElement>("sendTopic").value.trim();
  const text = $<HTMLInputElement>("messageInput").value;
  if (!destination || !text) return;
  client.send(destination, { body: text });
  log(`发送 [${destination}]: ${text}`, "out");
  $<HTMLInputElement>("messageInput").value = "";
}

$<HTMLButtonElement>("sendBtn").addEventListener("click", sendMessage);
$<HTMLInputElement>("messageInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});
