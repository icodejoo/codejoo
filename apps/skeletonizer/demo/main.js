// demo 页入口脚本：由 index.html 以 <script type="module" src> 引入（Vite 构建时才会打包它）
// 走完整版源码入口（等同 import "skeletonizer/full"）：demo 要用到 engine / text / sweep / registerCustomElements 全部能力
import { Bone, enable, disable, registerCustomElements, defineSkzBox } from "../src/full/index.ts";
// 注册 global / svg 两个方案（等同 import "skeletonizer/all/js"；样式由下方 loadTier 按档位加载）
import "../src/full/variants/global.ts";
import "../src/full/variants/svg.ts";

// ---------- 自带 shadow DOM 的演示组件 ----------
class DemoCard extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
:host { display: block; border: 1px solid #cbd5e1; border-radius: 10px; padding: 14px; background: #f1f5f9; color: #0f172a; }
h3 { margin: 0 0 6px; font-size: 16px; } p { margin: 0; font-size: 14px; }
.dot { display: inline-block; width: 28px; height: 28px; border-radius: 50%; background: #6366f1; margin-bottom: 6px; }
    </style><span class="dot"></span><h3>${this.getAttribute("heading")}</h3><p>${this.getAttribute("text")}</p>`;
  }
}
customElements.define("demo-card", DemoCard);
defineSkzBox();

// ---------- 内容填充 ----------
const $ = (s) => document.querySelector(s);
// 文字统一用 <span skz-text> 包在块元素内层：round 下行内元素逐行圆角条，直接标在块元素上会变整块；五个对比根各写自己的 skz-text-mode
const mixedContent = `
  <h1 class="big"><span skz-text>大标题：夏季新品发布</span></h1>
  <h3><span skz-text>三号标题：限时折扣信息</span></h3>
  <p style="max-width:300px"><span skz-text>这是一段比较长的正文，会在窄容器里折成好几行，最后一行应该明显比前面短，用来检查骨头是不是跟着真实文字行走。</span></p>
  <p class="tiny"><span skz-text>小字号：更新于昨天，共 128 条评论。</span></p>
  <div><span skz-text>价格：<b>¥ 5.00</b> 起，<em>包邮</em></span></div>
  <p><span skz-text>嵌套：<span>外层 <em>斜体中的 <strong>加粗</strong> 内容</em> 收尾</span></span></p>
  <ul><li><span skz-text>列表项一：第一条说明</span></li><li><span skz-text>列表项二：第二条说明比较长一点点</span></li></ul>`;
for (const id of ["round", "clip", "underline", "leaf", "tofu"]) $(`#cmp-${id}`).innerHTML = mixedContent;

$("#cards").innerHTML = [1, 2, 3]
  .map(
    (i) => `
  <div class="box card">
    <img class="avatar" skz-bone src="${Bone.image(48)}" alt="">
    <div class="body">
<h3><span skz-text>用户昵称 ${i}</span></h3>
<small skz-text>发布于 3 小时前</small>
<p><span skz-text>${i === 1 ? "一条很短的描述。" : "这里是一段稍长的个人简介，用来看多行文字在卡片里的骨头形状。"}</span></p>
<i class="icon-star" skz-bone></i>
<button class="btn" skz-bone>关注</button>
    </div>
  </div>`,
  )
  .join("");

const realImg =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#34d399"/><text x="20" y="58" font-size="22" fill="#064e3b">REAL IMG</text></svg>');
$("#img-mock").src = Bone.image(160, 100);
$("#img-real").src = realImg;
$("#vendor-img").src = realImg;
$("#media video").setAttribute("src", "");
for (const id of ["cv", "cv2"]) {
  const c = document.getElementById(id),
    g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, c.width, 0);
  grad.addColorStop(0, "#60a5fa");
  grad.addColorStop(1, "#a78bfa");
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#fff";
  g.font = "16px sans-serif";
  g.fillText("CANVAS", 10, 34);
}

$("#bones").innerHTML = `
  <div class="box"><h4 skz-ignore>Bone.text(24) / text(60)</h4>
    <code class="out"><span skz-text>${Bone.text(24)}</span></code>
    <p class="narrow"><span skz-text>${Bone.text(60)}</span></p></div>
  <div class="box"><h4 skz-ignore>Bone.lines(3)</h4><p class="narrow"><span skz-text>${Bone.lines(3, { perLine: 22 })}</span></p></div>
  <div class="box"><h4 skz-ignore>Bone.cjk(40)</h4><p class="narrow"><span skz-text>${Bone.cjk(40)}</span></p></div>
  <div class="box"><h4 skz-ignore>Bone.number(5)</h4><h3><span skz-text>余额：${Bone.number(5)} 元</span></h3></div>`;

// 列表项内层用 <span skz-text> 包文字，round 下按文字宽度出条
const list100 = Array.from({ length: 100 }, (_, i) => `<div style="padding: 10px; border-bottom: 1px solid var(--line)"><span skz-text>列表项 ${i + 1}</span></div>`).join("");
document.querySelectorAll("[data-demo-fit]").forEach((el) => (el.innerHTML = list100));

// ---------- 开关与控制 ----------
const roots = [...document.querySelectorAll("[data-demo-root]")];
const fitRoots = [...document.querySelectorAll("[data-demo-fit]")];
const state = { loading: true, dark: true, effect: "shimmer", engine: "global", tier: 3, text: "round", fit: true };
let hosts;

function apply() {
  document.documentElement.toggleAttribute("data-skz-theme", false);
  document.documentElement.setAttribute("data-skz-theme", state.dark ? "dark" : "light");
  roots.forEach((el) => {
    const text = el.dataset.fixedText ?? state.text;
    if (state.loading) enable(el, { effect: state.effect, text, engine: state.engine });
    else disable(el);
    el.setAttribute("skz-effect", state.effect);
    el.setAttribute("skz-text-mode", text);
  });
  fitRoots.forEach((el) => {
    if (state.loading) enable(el, { effect: state.effect, text: state.text, engine: state.engine, fit: state.fit });
    else disable(el);
  });
  $("#btn-loading").textContent = `loading：${state.loading ? "开" : "关"}`;
  $("#btn-dark").textContent = `深色：${state.dark ? "开" : "关"}`;
  $("#btn-fit").textContent = `fit：${state.fit ? "开" : "关"}`;
}

// 按层叠顺序排列的样式分片（与 src/styles/entries/all.scss 的输出顺序一致：base -> global（svg 先于 firewall，Sass 同一模块只输出一次）-> sweep -> tofu；
// core 的合并现代档 _modern 不在这里，demo 走完整版）。build-demo 脚本按这一行解析，保持单行
const CSS_FILES = ["base", "_theme", "_tier0-exit", "tier0", "_marks", "tier1", "tier2", "_effects-core", "_fit", "_driver", "_driver-color", "_lazy", "_svg", "_firewall", "_sweep", "_tofu"];
// 返回 Promise：样式表全部加载完才 resolve（fit 要按已生效的样式测量，所以 apply 要等它）
function loadTier(n) {
  document.querySelectorAll("link[data-skz-css]").forEach((l) => l.remove());
  // 档位只影响 skz-auto 区域里的推导；显式 skz-text 标记在 tier1 里，要 n>=2 才有文字骨头（skz-bone / skz-leaf / skz-ignore 在 _marks 里，各档都有）
  // n=0 仅兜底层（含主题、标记）；n=1 + 第 0 档和全部效果；n=2 + 第 1 档；n=3 + 第 2 档
  const want = ["base", "_theme", "_marks", "_fit"];
  if (n >= 1) want.push("_tier0-exit", "tier0", "_effects-core", "_driver", "_driver-color", "_lazy", "_svg", "_firewall", "_sweep");
  if (n >= 2) want.push("tier1", "_tofu");
  if (n >= 3) want.push("tier2");
  const loads = CSS_FILES.filter((f) => want.includes(f)).map(
    (f) =>
      new Promise((resolve) => {
        const l = document.createElement("link");
        l.rel = "stylesheet";
        // 开发服务直接吃 scss；静态构建用 build-demo 预编好的 css（带 base 前缀，子路径部署也能解析）
        l.href = import.meta.env.DEV ? `../src/styles/${f}.scss` : `${import.meta.env.BASE_URL}styles/${f}.css`;
        l.dataset.skzCss = f;
        l.onload = l.onerror = resolve;
        document.head.appendChild(l);
      }),
  );
  return Promise.all(loads);
}

$("#btn-loading").onclick = () => {
  state.loading = !state.loading;
  apply();
};
$("#btn-dark").onclick = () => {
  state.dark = !state.dark;
  apply();
};
$("#btn-fit").onclick = () => {
  state.fit = !state.fit;
  apply();
};
$("#sel-effect").onchange = (e) => {
  state.effect = e.target.value;
  apply();
};
$("#sel-engine").onchange = (e) => {
  state.engine = e.target.value;
  apply();
};
$("#sel-tier").onchange = (e) => {
  state.tier = +e.target.value;
  loadTier(state.tier).then(apply);
};
$("#sel-text").onchange = (e) => {
  state.text = e.target.value;
  apply();
};

await loadTier(state.tier);
hosts = registerCustomElements(document, { watch: true });
apply();
window.__sk = { state, apply, loadTier, hosts, enable, disable };
