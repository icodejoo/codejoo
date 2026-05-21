import type { IPlugin } from "../core/types";
import { $, fastRemove } from "../helper";
import { buildCountupFormatter, ease } from "./helper";
import type { ICountupGroup, ICountupBaseOptions, ICountupTask, ICountupFullOptions } from "./type";

const defaultLabel = "default";

let diff = 0;
let updateAt = 0;
let id = 0;
let groups = new Map<string | number, ICountupGroup>();

/** 不含 formatter / end，须在 add 或 group.config 中提供 formatter */
export const defaults: Required<ICountupBaseOptions> = {
  duration: 1000,
  fps: 60,
  formatter: buildCountupFormatter(new Intl.NumberFormat()),
  easing: ease.easeCountup,
  render: countupRender,
};

export function countupRender(el: Element, formatted: string) {
  el.textContent = formatted;
}

export function group(label = defaultLabel, options?: ICountupBaseOptions): ICountupGroup {
  let g = groups.get(label);
  if (g) return g;
  g = { config: options, queue: [] };
  groups.set(label, g);
  return g;
}

export function remove(taskId: number, label = defaultLabel) {
  const g = groups.get(label);
  if (!g) return;
  fastRemove(g.queue, taskId);
  if (g.queue.length === 0 && label !== defaultLabel) {
    g.config = undefined;
    groups.delete(label);
  }
}

export function clear(label = defaultLabel) {
  const g = groups.get(label);
  if (!g) return;
  g.queue.length = 0;
  if (label !== defaultLabel) {
    g.config = undefined;
    groups.delete(label);
  }
}

export function tick(elapsed: number, _dt: number) {
  diff = elapsed - updateAt;
  updateAt = elapsed;

  groups.forEach((g) => {
    for (let i = g.queue.length - 1; i >= 0; i--) {
      const task = g.queue[i];

      if (task.startAt < 0) {
        task.startAt = elapsed;
        task.accum = 0;
      }

      const progress = Math.min(1, (elapsed - task.startAt) / task.duration);
      const interval = task.fps > 0 ? (1000 / task.fps) | 0 : 0;

      if (interval > 0 && progress < 1) {
        task.accum += diff;
        if (task.accum < interval) continue;
        task.accum = 0;
      }

      const range = task.to - task.from;
      task.value = task.from + range * task.easing(progress);

      if (progress >= 1) {
        task.value = task.to;
        task.onDone?.(task.value);
        fastRemove(g.queue, i);
      } else {
        task.onUpdate?.(task.value);
      }
      if (task.el) {
        task.render(task.el, task.formatter(task.value));
      }
    }
  });
}

function install(options?: ICountupBaseOptions): IPlugin {
  Object.assign(defaults, options);
  return {
    name: "count-up",
    install: tick,
  };
}

function addTask(options: ICountupFullOptions): void {
  options.label ||= defaultLabel;
  const g = groups.get(options.label);
  if (!g) throw new Error(`[count-up]:group not found by ${options.label},You must create the group before add`);

  const task: ICountupTask = {
    ...defaults,
    ...g.config,
    ...options,
    label: options.label,
    el: options.el ? $(options.el) : undefined,
    from: options.from ?? 0,
    value: options.from ?? 0,
    id: id++,
    accum: 0,
    startAt: -1,
    group: g,
  };
  g.queue.push(task);
}
function counter(options: ICountupFullOptions): void;
function counter(to: number, label?: string): void;
function counter(to: number, options?: ICountupBaseOptions): void;
function counter(from: number, to: number, label?: string): void;
function counter(from: number, to: number, options?: ICountupBaseOptions): void;
function counter(
  a: number | ICountupFullOptions,
  b?: number | string | ICountupBaseOptions,
  c?: string | ICountupBaseOptions,
): void {
  const len = arguments.length;

  if (len === 1) {
    if (typeof a === "number") return addTask({ to: a });
    return addTask(a);
  }

  // len >= 2 时 a 一定是 number（按重载契约）
  if (typeof a !== "number") return;

  if (len === 2) {
    if (typeof b === "number") return addTask({ from: a, to: b });
    if (typeof b === "string") return addTask({ to: a, label: b });
    return addTask({ ...b, to: a });
  }

  // len === 3，b 一定是 number
  if (typeof b !== "number") return;
  if (typeof c === "string") return addTask({ from: a, to: b, label: c });
  return addTask({ ...c, from: a, to: b });
}

counter.remove = remove;
counter.clear = clear;
counter.group = group;
counter.install = install;

export default counter;

declare module "../core/types" {
  interface Counter {
    up: typeof counter;
  }
}
