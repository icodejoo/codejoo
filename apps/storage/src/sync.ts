import type { SyncStore } from "./interface";
import type { Handlers } from "./proxy";
import { APPLY, COMMIT, STORE } from "./proxy";
import { Memory } from "./memory";

/** 复用消息操作名，保持插件体积精简。 */
const SET = "set",
  REMOVE = "remove",
  CLEAR = "clear";
/** 当前广播协议版本。 */
const VERSION = 2;
/** 可接收的广播操作，复用校验列表。 */
const OPERATIONS = [SET, REMOVE, CLEAR];
/** v2 使用绝对到期时间和原始落盘串，避免回放时重新计算 TTL。 */
interface Message {
  /** 协议版本。 */
  v: typeof VERSION;
  /** 提交类型。 */
  op: typeof SET | typeof REMOVE | typeof CLEAR;
  /** 转义后的命名空间前缀。 */
  ns: string;
  /** 逻辑键；clear 可以省略。 */
  key?: string;
  /** 原始落盘串；仅 set 必需。 */
  payload?: string;
  /** 绝对到期毫秒时间。 */
  expireAt?: number;
  /** 提交时间。 */
  ts: number;
  /** 当前挂载实例的随机身份。 */
  from: string;
}
/** 同时间戳按发送方身份排序。 */
type Stamp = Pick<Message, "ts" | "from">;
/** 通道占用检查。 */
const owners = /*#__PURE__*/ new Map<string, number>();
/** 当前已挂载处理器。 */
const mounted = /*#__PURE__*/ new WeakSet<object>();
/** session 处理器只警告一次。 */
const warned = /*#__PURE__*/ new WeakSet<object>();
/** 判断新提交是否严格晚于旧提交。 */
const newer = (next: Stamp, old?: Stamp): boolean => !old || next.ts > old.ts || (next.ts === old.ts && next.from > old.from);
/** 版本表只保存排序字段，避免长期持有整条消息及其落盘串。 */
const stampOf = ({ ts, from }: Stamp): Stamp => ({ ts, from });
/** 空操作停止函数。 */
const noop = (): void => {};

/**
 * 同步 local 内存兜底的真实提交；原生存储与 session 不参与。
 * @param handler 同步存储处理器
 * @param channel 同源广播通道名
 * @returns 幂等停止函数；再次挂载同一处理器返回空操作。
 * @example `const stop = crossTab(ls); stop();`
 */
export function crossTab(handler: Handlers<SyncStore>, channel = "@codejoo/storage:sync"): () => void {
  const store = handler[STORE];
  if (store?.kind === "session") {
    if (!warned.has(handler)) {
      warned.add(handler);
      console.warn("[storage] crossTab: sessionStorage is isolated per tab; synchronization disabled");
    }
    return noop;
  }
  if (store?.kind !== "local" || !(store instanceof Memory) || typeof BroadcastChannel === "undefined" || mounted.has(handler)) return noop;
  const group = owners.get(channel) ?? 0;
  if (group) console.warn(`[storage] crossTab: channel "${channel}" is already used by another handler; pass a distinct channel per handler.`);
  const bc = new BroadcastChannel(channel),
    from = crypto.randomUUID?.() ?? Math.random().toString(36) + Date.now().toString(36);
  owners.set(channel, group + 1);
  mounted.add(handler);
  const stamps = new Map<string, Map<string, Stamp>>(),
    clears = new Map<string, Stamp>();
  let stopped = false,
    clock = 0;
  /** 每个命名空间独立保存键版本，切换命名空间不会串扰。 */
  const versions = (ns: string): Map<string, Stamp> => {
    let keys = stamps.get(ns);
    if (!keys) stamps.set(ns, (keys = new Map()));
    return keys;
  };
  /** 按落盘串静默回放，并使缓存失效。 */
  const replay = (event: Message): void => {
    handler[APPLY](event.key!, event.op === SET ? event.payload! : null, event.op === SET ? event.expireAt : undefined);
  };
  /** clear 按键回放，保留比 clear 更新的键。 */
  const apply = (event: Message): void => {
    const keys = versions(event.ns),
      barrier = clears.get(event.ns);
    if (!newer(event, barrier)) return;
    const stamp = stampOf(event);
    if (event.op === CLEAR) {
      for (const key of handler.keys()) {
        if (newer(event, keys.get(key))) {
          replay({ ...event, op: REMOVE, key });
          keys.set(key, stamp);
        }
      }
      clears.set(event.ns, stamp);
    } else if (newer(event, keys.get(event.key!))) {
      replay(event);
      keys.set(event.key!, stamp);
    }
  };
  const unsubscribe = handler[COMMIT]((event) => {
    const msg: Message = { v: VERSION, op: event.op, ns: event.namespace, key: event.key, payload: event.payload ?? undefined, expireAt: event.expireAt, ts: (clock = Math.max(Date.now(), clock + 1)), from };
    const stamp = stampOf(msg);
    if (event.op === CLEAR) clears.set(msg.ns, stamp);
    else versions(msg.ns).set(event.key, stamp);
    try {
      bc.postMessage(msg);
    } catch (error) {
      console.warn("[storage] crossTab broadcast failed; local write is unaffected", error);
    }
  });
  bc.onmessage = (event: MessageEvent) => {
    try {
      const m = event.data as Message;
      if (
        !m ||
        m.v !== VERSION ||
        !OPERATIONS.includes(m.op) ||
        m.ns !== handler.namespace ||
        typeof m.from !== "string" ||
        m.from.length === 0 ||
        m.from === from ||
        !Number.isFinite(m.ts) ||
        (m.op !== CLEAR && typeof m.key !== "string") ||
        (m.op === SET && typeof m.payload !== "string") ||
        (m.expireAt !== undefined && !Number.isFinite(m.expireAt))
      )
        return;
      clock = Math.max(clock, m.ts);
      apply(m.op === SET && m.expireAt !== undefined && m.expireAt <= Date.now() ? { ...m, op: REMOVE } : m);
    } catch {
      /* 畸形消息或后端错误不得逸出消息回调。 */
    }
  };
  return () => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
    bc.close();
    mounted.delete(handler);
    const remaining = owners.get(channel)! - 1;
    if (remaining) owners.set(channel, remaining);
    else owners.delete(channel);
  };
}
