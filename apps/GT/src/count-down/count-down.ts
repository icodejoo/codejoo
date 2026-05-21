import type {
  ICountdownOptions,
  TCountdownValue,
  ICountdownTask,
  ICountdownTaskOptions,
} from "./types";
import {
  countdownRender,
  fastRemove,
  resolveConfig,
  resolveDateParser,
  resolveFormatter,
  resolveParser,
} from "./helper";

import * as core from "../core";
import type { IPlugin } from "../core/types";
import { $ } from "../helper";

let updateAt = 0;
let diff = 0;
const defaultLabel = "default";
const defaults: Required<ICountdownOptions> & { timeOffset: number } = {
  // 服务器时间与客户端时间的时间差，用于
  _timeOffset: 0,
  get timeOffset() {
    return this._timeOffset;
  },
  set timeOffset(value: number) {
    this._timeOffset = value;
  },
  dateParser: "ms",
  formatter: "HH:mm:ss",
  parser: "array",
  showMilliseconds: false,
  showDays: true,
  render: countdownRender,
};

let groups: Map<
  string | string,
  { config?: ICountdownOptions; queue: ICountdownTask[] }
> = new Map();

groups.set(defaultLabel, {
  config: defaults,
  queue: [],
});

function add<T extends TCountdownValue>(
  deadline: any,
  el: string | Element,
  label?: string,
): number;
function add<T extends TCountdownValue>(
  deadline: any,
  el: string | Element,
  options?: ICountdownTaskOptions & { label: string },
): number;
function add<T extends TCountdownValue>(
  deadline: any,
  el: string | Element,
  options?: any,
): number {
  core.start();
  const s = typeof options === "string";
  const g = group(s ? options : options?.label);

  const {
    dateParser,
    formatter,
    parser,
    showDays,
    showMilliseconds,
    render,
    ...rest
  } = resolveConfig(defaults, g.config, s ? undefined : options);

  const task: ICountdownTask = {
    el: $(el),
    remaining: resolveDateParser(dateParser)(deadline),
    formatter: resolveFormatter(formatter, showDays, showMilliseconds),
    parser: resolveParser(parser, showDays),
    render: render,
    ...rest,
  };
  // 任务可能是中途加入的，所以需要修正剩余时间
  // 比如任务A的倒计时10秒,在当前循环周期内的第600毫秒加入，那么下次执行时，任务A只经过了400毫秒，
  // 统一减去一秒会导致多减，所以在加入任务时，加上当前循环周期内的时间差，这样下次执行时，减去一秒正好
  task.remaining += diff;
  return g.queue.push(task);
}

function remove(id: number, label = defaultLabel) {
  const group = groups.get(label);
  if (!group) return;
  fastRemove(group.queue, id);
  if (group.queue.length === 0 && label !== defaultLabel) {
    group.config = undefined;
    groups.delete(label);
  }
}

function clear(label = defaultLabel) {
  const group = groups.get(label);
  if (!group) return;
  group.queue.forEach((q) => {
    //@ts-ignore
    q.el = null;
    q.onDestroy?.(q.remaining);
    q.onDone?.(q.remaining);
  });
  group.queue = [];
  if (label !== defaultLabel) {
    group.config = undefined;
    groups.delete(label);
  }
}

function group(label = defaultLabel, options?: ICountdownOptions) {
  let g = groups.get(label);
  if (g) return g;
  g = {
    config: options,
    queue: [],
  };
  groups.set(label, g);
  return g;
}

function tick(elapsed: number) {
  diff = elapsed - updateAt;
  if (diff < 1000) return;
  updateAt = elapsed;
  groups.forEach((group) => {
    group.queue.forEach((task) => {
      task.remaining -= diff;
      if (task.remaining <= 0) {
        task.onDone?.(task.remaining);
      } else {
        task.onUpdate?.(task.remaining);
      }
      task.render(task.el, task.formatter, task.parser);
    });
  });
}

function install(options?: ICountdownOptions): IPlugin {
  return {
    name: "countdown",
    install(elapsed, dt) {},
  };
}

export { defaults, add, remove, clear, group, install as register };

function counter() {}
counter.remove = remove;
counter.clear = clear;
counter.group = group;
counter.install = install;
counter.defauls = defaults;

export default counter;

declare module "../core/types" {
  interface Counter {
    down: typeof counter;
  }
}
