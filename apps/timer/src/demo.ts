import { Timer } from "./index";

const timer = new Timer();

const cuEl = document.getElementById("cu")!;
const cdEl = document.getElementById("cd")!;
const intLog = document.getElementById("intLog")!;

let cuCtrl: ReturnType<Timer["countUp"]> | null = null;

document.getElementById("cuStart")!.addEventListener("click", () => {
  cuCtrl?.remove();
  cuCtrl = timer.countUp(99999, { el: cuEl, prefix: "₱", duration: 1500 });
});

document.getElementById("cuUpdate")!.addEventListener("click", () => {
  cuCtrl?.update(999999);
});

document.getElementById("cdStart")!.addEventListener("click", () => {
  timer.countDown(60_000, (txt) => (cdEl.textContent = txt));
});

let intId: number | null = null;
let counter = 0;
document.getElementById("setInt")!.addEventListener("click", () => {
  if (intId !== null) timer.remove(intId);
  counter = 0;
  intId = timer.setInterval(() => {
    counter++;
    intLog.textContent = String(counter);
  }, 1000);
});

document.getElementById("pause")!.addEventListener("click", () => timer.pause());
document.getElementById("resume")!.addEventListener("click", () => timer.resume());
document.getElementById("stop")!.addEventListener("click", () => {
  timer.stop();
  if (intId !== null) {
    timer.remove(intId);
    intId = null;
  }
});
