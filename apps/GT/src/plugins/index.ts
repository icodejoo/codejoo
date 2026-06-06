let l = 1;
let e: HTMLElement;
const c1 = "digi";
const c2 = "amount";
const down: Keyframe[] = [
  { transform: "translateY(0)" },
  { transform: "translateY(-33.333%)" },
];
const down2: Keyframe[] = [
  { transform: "translateY(0)" },
  { transform: "translateY(-66.666%)" },
];
const config: KeyframeAnimationOptions = {
  duration: 100, // 动画时长 (毫秒)，对应 animation-duration
  iterations: 1, // 循环次数，Infinity 对应 infinite
  // direction: "alternate", // 动画方向，对应 animation-direction
  // easing: "ease-in-out", // 缓动函数，对应 animation-timing-function
//   fill: "forwards", // 结束停留在最后一帧，对应 animation-fill-mode
};
function render(el: HTMLElement, value = "0") {
  let len = value.length - 1;
  let i = len + 1 - l;
  while (i > 0 && i--) {
    e = $();
    el.prepend(e);
    $amounts(e, value[i]);
  }

  l = len;

  while (len--) {
    el.children[len].animate(down, config).onfinish = function (e) {
      const el = e.target.effect.target as HTMLElement;
    //   el.children[0].textContent = el.children[1].textContent;
    };
  }
}

function $fill(el: HTMLElement, l: number) {
  //   $digi(el, tl - l);
}

function $digi(el: HTMLElement, i: number) {
  while (i--) {
    e = $();
    el.appendChild(e);
    $amounts(e);
  }
}

function $remove(el: HTMLElement) {
  return;
}

function $amounts(el: HTMLElement, t: string = "0") {
  e = $("span", c2, t);
  el.appendChild(e);
  e = $("span", c2, t);
  el.appendChild(e);
  e = $("span", c2);
  el.appendChild(e);
}

function $(tag: string = "div", cls = c1, t?: string) {
  e = document.createElement(tag);
  e.className = cls;
  if (t) {
    e.textContent = t;
  }
  return e;
}

export default render;
