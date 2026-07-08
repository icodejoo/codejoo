import type { Directive, Plugin } from "vue";
import countdown, { remove as cdRemove } from "./count-down/count-down";
import countup, { remove as cuRemove } from "./count-up/count-up";
import { defaultLabel } from "./groups";
import type { TCountdownDeadline, ICountdownTaskOptions } from "./count-down/types";
import type { ICountupFullOptions } from "./count-up/type";

// ─────────────────────────────────────────────
//  公共工具
// ─────────────────────────────────────────────

type Entry = { id: number; label: string };

/** 浅比较两个绑定值是否发生变化（Date 按时间戳比，其余按引用/===） */
function shallowChanged(
  next: unknown,
  prev: unknown,
): boolean {
  if (next === prev) return false;
  if (prev == null) return true;
  if (next instanceof Date && prev instanceof Date) return next.getTime() !== prev.getTime();
  if (typeof next !== "object" || typeof prev !== "object") return next !== prev;
  const a = next as Record<string, unknown>;
  const b = prev as Record<string, unknown>;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return true;
  return ka.some((k) => {
    const va = a[k], vb = b[k];
    if (va instanceof Date && vb instanceof Date) return va.getTime() !== vb.getTime();
    return va !== vb;
  });
}

// ─────────────────────────────────────────────
//  v-count-down
// ─────────────────────────────────────────────

/** v-count-down 绑定值：截止时间 或 完整配置对象 */
export type VCountDownValue =
  | TCountdownDeadline
  | ({ deadline: TCountdownDeadline } & Omit<ICountdownTaskOptions, "el">);

const _cdStore = new WeakMap<Element, Entry>();

function isCdSimple(v: VCountDownValue): v is TCountdownDeadline {
  return typeof v === "number" || typeof v === "string" || v instanceof Date;
}

function resolveCd(
  value: VCountDownValue,
  modifiers: Partial<Record<string, boolean>>,
): { deadline: TCountdownDeadline; opts: ICountdownTaskOptions } {
  const deadline = isCdSimple(value) ? value : value.deadline;
  const config: Record<string, unknown> = isCdSimple(value) ? {} : { ...value };
  delete config.deadline;

  return {
    deadline,
    opts: {
      lazy: modifiers.lazy ?? false,
      showDays: modifiers.days ?? false,
      showMilliseconds: modifiers.ms ?? false,
      autoKill: !modifiers.keep,
      ...(config as ICountdownTaskOptions),
    },
  };
}

/**
 * `v-count-down` 指令
 *
 * **修饰符**
 * - `.lazy`  → `lazy: true`，进入视口才开始
 * - `.days`  → `showDays: true`
 * - `.ms`    → `showMilliseconds: true`
 * - `.keep`  → `autoKill: false`，归零后保留任务
 *
 * **绑定值**
 * - 截止时间（`number` ms / `string` 日期 / `Date`）
 * - 或完整配置 `{ deadline, fmt, label, render, onDone, ... }`
 *
 * @example
 * ```html
 * <span v-count-down="60000" />
 * <span v-count-down.lazy.days="targetDate" />
 * <span v-count-down="{ deadline, fmt: 'mm:ss', onDone: handleExpired }" />
 * ```
 */
export const vCountDown: Directive<Element, VCountDownValue> = {
  mounted(el, { value, modifiers }) {
    const { deadline, opts } = resolveCd(value, modifiers);
    const id = countdown(deadline, el, opts);
    _cdStore.set(el, { id, label: opts.label ?? defaultLabel });
  },

  updated(el, { value, oldValue, modifiers }) {
    if (!shallowChanged(value, oldValue)) return;
    const { deadline, opts } = resolveCd(value, modifiers);
    const id = countdown(deadline, el, opts);
    _cdStore.set(el, { id, label: opts.label ?? defaultLabel });
  },

  unmounted(el) {
    const entry = _cdStore.get(el);
    if (entry) {
      cdRemove(entry.id, entry.label);
      _cdStore.delete(el);
    }
  },
};

// ─────────────────────────────────────────────
//  v-count-up
// ─────────────────────────────────────────────

/** v-count-up 绑定值：目标数值 或 完整配置对象 */
export type VCountUpValue = number | Omit<ICountupFullOptions, "el">;

const _cuStore = new WeakMap<Element, Entry>();

function resolveCu(
  value: VCountUpValue,
  modifiers: Partial<Record<string, boolean>>,
): Omit<ICountupFullOptions, "el"> {
  const config = typeof value === "number" ? { to: value } : { ...value };
  return {
    lazy: modifiers.lazy ?? false,
    autoKill: !modifiers.keep,
    ...config,
  };
}

/**
 * `v-count-up` 指令
 *
 * **修饰符**
 * - `.lazy`  → `lazy: true`，进入视口才开始
 * - `.keep`  → `autoKill: false`，完成后保留任务
 *
 * **绑定值**
 * - 目标数值（`number`）
 * - 或完整配置 `{ to, from?, duration?, fmt, label, render, onDone, ... }`
 *
 * @example
 * ```html
 * <span v-count-up="9999" />
 * <span v-count-up.lazy="{ to: 1234567, duration: 2500 }" />
 * <span v-count-up="{ to, from: 0, fmt: n => '₱' + n, onDone: handleDone }" />
 * ```
 */
export const vCountUp: Directive<Element, VCountUpValue> = {
  mounted(el, { value, modifiers }) {
    const opts = resolveCu(value, modifiers);
    const id = countup({ ...opts, el });
    _cuStore.set(el, { id, label: opts.label ?? defaultLabel });
  },

  updated(el, { value, oldValue, modifiers }) {
    if (!shallowChanged(value, oldValue)) return;
    const opts = resolveCu(value, modifiers);
    // countup() 检测到同一元素，原地重定目标，返回新/旧 id
    const id = countup({ ...opts, el });
    _cuStore.set(el, { id, label: opts.label ?? defaultLabel });
  },

  unmounted(el) {
    const entry = _cuStore.get(el);
    if (entry) {
      cuRemove(entry.id, entry.label);
      _cuStore.delete(el);
    }
  },
};

// ─────────────────────────────────────────────
//  Plugin & 全局类型扩展
// ─────────────────────────────────────────────

/**
 * Vue 插件，全局注册所有指令：
 * ```ts
 * app.use(CounterPlugin)
 * ```
 */
export const CounterPlugin: Plugin = {
  install(app) {
    app.directive("count-down", vCountDown);
    app.directive("count-up", vCountUp);
  },
};

// import '@codejoo/counter/vue' 后即可在所有 .vue 文件中获得类型感知
declare module "vue" {
  interface GlobalDirectives {
    /** `v-count-down` — 倒计时指令，修饰符：.lazy .days .ms .keep */
    vCountDown: typeof vCountDown;
    /** `v-count-up` — 数字滚动指令，修饰符：.lazy .keep */
    vCountUp: typeof vCountUp;
  }
}
