// 演示页入口，仅供 vite 开发服务器使用，不参与构建产物
import { counter, countup, countdown, createCardRender, createOdometerRender } from "./index";
// 卡片样式为独立文件，调用方自行引入
import "./plugins/card.css";

counter.use(countup.install());
counter.use(countdown.install());

const flip = createCardRender({ effect: "flip" });
const slide = createCardRender({ effect: "slide" });
const calendar = createCardRender({ effect: "calendar" });

function startCards(ms: number) {
  countdown.clear();
  countdown(ms, "#flip", { fmt: "mm:ss", render: flip });
  countdown(ms, "#slide", { fmt: "mm:ss", render: slide });
  countdown(ms, "#cal", { fmt: "mm:ss", render: calendar });
  countdown(ms + 1, "#ms", { fmt: "mm:ss.sss", showMilliseconds: true });
}

document.querySelector("#restart")!.addEventListener("click", () => startCards(90_000));
document.querySelector("#restart10")!.addEventListener("click", () => startCards(10_000));

document.querySelector("#cuRun")!.addEventListener("click", () => {
  countup.clear();
  countup({ to: 9_876_543.21, el: "#cu", duration: 2500 });
});

// count-up 滚动数字（odometer），复用 cd-* 样式体系。四个用例共用同一元素 #odo。
const odometer = createOdometerRender();
const play = (opts: { from?: number; to: number; duration: number }) => countup({ el: "#odo", label: "odo", render: odometer, ...opts });
const on = (sel: string, fn: () => void) => document.querySelector(sel)!.addEventListener("click", fn);

// 1. 增加：0 → 1,234,567
on("#odoUp", () => {
  countup.clear("odo");
  play({ from: 0, to: 1_234_567, duration: 1500 });
});

// 2. 减少：1,234,567 → 0
on("#odoDown", () => {
  countup.clear("odo");
  play({ from: 1_234_567, to: 0, duration: 1500 });
});

// 3. 半路增加：先冲 100 万，900ms 后向上改道到 500 万（同元素再调、不传 from → 从当前值续接）
on("#odoUpUp", () => {
  countup.clear("odo");
  play({ from: 0, to: 1_000_000, duration: 4000 });
  setTimeout(() => play({ to: 5_000_000, duration: 1500 }), 900);
});

// 4. 半路减少：先冲 500 万，900ms 后向下改道到 20 万（从当前值约 150 万平滑下降，不跳回 0）
on("#odoDownDown", () => {
  countup.clear("odo");
  play({ from: 0, to: 5_000_000, duration: 4000 });
  setTimeout(() => play({ to: 200_000, duration: 1500 }), 900);
});

startCards(90_000);
