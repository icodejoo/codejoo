# @codejoo/layerman

框架无关的 **headless** overlay 队列管理器,适用于 dialog、modal、bottomsheet、drawer、toast。
它只负责「**该显示哪个 / 何时显示**」——串行「一次一个」队列、命名 slot、优先级 /
replace / overlap / affix、按弹窗的条件与冷却、后端数据驱动的异步取数、命令式 promise 结果、
两阶段关闭——**不渲染任何 UI**。渲染由你完成;本包是**零运行时依赖**的纯逻辑。

> English docs: [README.md](./README.md)。

## 安装

```bash
pnpm add @codejoo/layerman
# 各框架适配层以子路径提供:/vue /react /svelte /solid,对应框架均为可选 peer 依赖
```

## 核心概念

- **一次一个 + slot**:每个 `slot` 一条独立串行队列,各自「一次一个」互不阻塞;`overlap` 是全局叠加层,绕过串行。
- **活跃态是列表**:各 slot 串行槽(0~1)+ 若干 overlap 叠加。经 `subscribe` + `getSnapshot` + `get(id)` 暴露。
- **越权行为**:`priority` 排序插队;`replace` 替换当前(被替换者退回队列,跳过 gap);`overlap` 叠加显示;`affix` 固定展示(只挡 replace,被拦的 replace 进队首等待)。
- **条件**:`when(ctx)` 覆盖式最高优先;否则 `route`(string|string[]|RegExp)**AND** `requiresAuth`,读上下文保留键 `ctx.route`/`ctx.auth`。唯一入口 `setContext(partial)`(push 模型,自动触发重评)。
- **冷却**:`{ session, total, day, hour, minute, days/hours/minutes/seconds(minGap) }`,出现字段全部 **AND**,真正显示时 +1;`day/hour/minute` 本地自然边界对齐,`minGap` 滚动;`session` 仅内存,其余可持久化(可注入异步存储)。
- **后端驱动** `resolve(signal)`:轮到且通过同步条件/冷却后才调用,返回 `null` 跳过;不被插队打断。
- **命令式结果**:`open()` 返回 `{ id, result }`,宿主用 `resolve(id, v)` / `reject(id, e)` 投递;被动关闭兑现 `{ dismissed: true }`。
- **两阶段关闭**:`close(id)` 标记 `closing`(播退场动画)→ `remove(id)` 真正移除并推进队列;`autoRemove`(`true`=300ms | 数字 | `false`)兜底。
- **`beforeClose`**:每弹窗关闭守卫,`close` 前调用,返回(或 Promise resolve)`false` 则**取消本次关闭**(未保存确认等),其余值放行。
- **`dismissWhenUnmet`(默认 `true`)**:已展示的弹窗,若 `setContext` 后其条件(route/when/requiresAuth)不再满足,**自动撤下并推进下一个**;设 `false` 则保留。(pending 队列项永不删除,只是等待。)
- **`update(id, patch)`**:就地把 `patch` 浅合并进活跃弹窗的 `data` 并重渲染,不触发队列变更(区别于 `replace`)。
- **`clear(select?)`**:传 `(ctx, records) => id[]` 精确清理(records = `{id,data,slot,phase,active}[]`);返回非数组 ⇒ 全部清理。或 `clear({ closeActive })` 传统式。("按 group 批量关"用 `data.group` 过滤即可,不需专门 group 字段。)
- **`OverlayInstance.stackIndex` / `isTopmost`**:叠加层序;headless 不设 z-index,宿主据此算 z-index / 给非顶层加 `pointer-events`。

### `overlap` vs `replace` vs 队列 —— 以及 `overlap` 为什么会「丢弃」

- **普通** `open`:进入该 slot 的串行队列;轮到它、**且**条件/冷却通过时才显示。还不满足就**在队列里等**。
- **`replace`**:抢占该 slot 当前活跃者(仅当替换者自己够资格),立即显示、跳过 `gap`;仍一次一个。
- **`overlap`**:**完全绕过串行队列,立即叠加显示**——用于无条件的紧急弹窗(全局错误、关键告警、阻塞 loading)。因为 overlap 弹窗**根本不入队**,它的条件/冷却只是 `open` 时的**一次性发射门**:通过 → 立即显示;**不通过 → 请求被丢弃**,`result` 兑现 `{ dismissed: true, reason: 'unmet' }`(不触发 `onShow`/`onClose`)。它是**「要么现在,要么不弹」**——没有队列能把它留到条件满足。

所以 `overlap` 会「丢弃」正是因为它**主动放弃了队列**:一个不排队、又不允许当下显示的弹窗,丢弃是唯一自洽的结果。若你要「**等条件满足后再显示**」,那正是队列的职责——用普通或 `replace` 弹窗(它们会等)。**别给 `overlap` 弹窗加可延迟的条件(`route`/`when`)**指望它被保留;但 `overlap` 加 cooldown 是合理的(能正确抑制「今天已弹过」)。

## 快速上手

```ts
import { createLayerman } from "@codejoo/layerman";

const om = createLayerman({ gap: 300 });
await om.ready(); // 等冷却状态从存储 hydrate

const unsub = om.subscribe((state) => render(state.active)); // active 就是你要渲染的列表

// 入队,返回可 await 的句柄
const { id, result } = om.open({ id: "welcome", data: { text: "你好" } });

// 命令式结果:由你的 UI 通过 resolve 投递
const ok = await om.open({ id: "confirm", data: { msg: "确定删除?" } }).result;
// ok 是你的 UI 传给 om.resolve("confirm", ...) 的值,或 { dismissed: true }

om.close("welcome"); // → phase "closing";autoRemove(默认 300ms)后移除并推进
```

## 不用框架(纯 JS)

核心不依赖 Vue / React 或任何框架:`subscribe` 把最新状态交给你,你自己渲染 `state.active`。本包只决定
「哪个弹窗处于活跃、处于哪个阶段」,长什么样完全由你决定。

```js
import { createLayerman } from "@codejoo/layerman";

const om = createLayerman({ gap: 200 });
await om.ready();

const root = document.getElementById("overlay-root");
const nodes = new Map(); // instanceKey → DOM 节点

function render(state) {
  const alive = new Set();
  for (const inst of state.active) {
    alive.add(inst.instanceKey); // 当 render key:同 id 重开会换新 key → 重新挂载
    let el = nodes.get(inst.instanceKey);
    if (!el) {
      el = document.createElement("div");
      el.className = "mask";
      el.innerHTML = `<p>${inst.data.text}</p><button>确定</button>`;
      el.querySelector("button").onclick = () => {
        om.resolve(inst.id, true); // 投递结果(不会关闭)
        om.close(inst.id); // → phase "closing";300ms 后自动移除
      };
      nodes.set(inst.instanceKey, el);
      root.append(el);
    }
    el.dataset.phase = inst.phase; // "open" | "closing",用它驱动退场 CSS
    el.style.zIndex = String(1000 + inst.stackIndex); // headless:z-index 由你算
    el.style.pointerEvents = inst.isTopmost ? "auto" : "none";
  }
  for (const [key, el] of nodes) {
    if (!alive.has(key)) {
      el.remove();
      nodes.delete(key);
    }
  }
}

om.subscribe(render, { immediate: true }); // immediate:订阅时立刻用当前快照渲染一次

const ok = await om.open({ id: "confirm", data: { text: "确定删除?" } }).result;
```

完整可运行页面(toast、优先级队列、`overlap`、`replace`、路由条件、暂停、清空)见
[`example/vanilla/`](./example/vanilla):`pnpm --filter @codejoo/layerman-example dev`,再打开
`/vanilla/index.html`。

## API 参考

`@codejoo/layerman` 的全部导出:工厂 `createLayerman`、运行时常量 `DismissReason` / `OverlayPhase`,以及下列类型。
各框架适配层放在最后。

```ts
import {
  createLayerman, // 工厂
  DismissReason,
  OverlayPhase, // 运行时常量
  type Layerman,
  type LayermanOptions,
  type OverlayConfig,
  type OverlayHandle,
  type OverlayInstance,
  type OverlayState,
  type OverlayRecord,
  type OverlayContext,
  type ClearSelector,
  type DismissResult,
  type Cooldown,
  type Duration,
  type AsyncableStorage,
} from "@codejoo/layerman";
```

### `createLayerman(options?)`

返回一个独立的管理器(是工厂,**不是**单例——一个应用建一个,或一个测试建一个)。

| 选项         | 类型                        | 默认值                                   | 含义                                                                                       |
| ------------ | --------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| `gap`        | `number`                    | `0`                                      | 同一 slot 内,前一个结束到下一个开始之间的全局等待毫秒数;弹窗自己的 `delay` 优先。          |
| `autoRemove` | `boolean \| number`         | `true`                                   | `close()` 之后自动 `remove()`:`true` = 300ms,数字 = 自定义毫秒,`false` = 由你调 `remove`。 |
| `storage`    | `AsyncableStorage`          | 有 `localStorage` 用它,否则纯内存        | 持久化冷却状态的存储;`get` / `set` 可同步可异步。                                          |
| `storageKey` | `string`                    | `"layerman:v1"`                          | 存储键;跨 Tab 通道名为 `${storageKey}:sync`。                                              |
| `now`        | `() => number`              | `Date.now`                               | 时间源,测试时注入假时钟。                                                                  |
| `debug`      | `boolean`                   | `false`                                  | 输出生命周期日志 `[layerman]:<id>:<pending\|resolving\|open\|closing\|closed>`。           |
| `logger`     | `(message: string) => void` | `console.log`                            | `debug` 日志的去向;logger 抛错会被吞掉。                                                   |
| `crossTab`   | `boolean`                   | 有 `window` 和 `BroadcastChannel` 时开启 | 跨标签页同步冷却计数;Node / SSR / Worker 默认关闭。                                        |

```ts
const om = createLayerman({
  gap: 300,
  autoRemove: 200,
  storageKey: "myapp:overlays",
  debug: true,
  logger: (m) => analytics.debug(m),
});
await om.ready();
```

**自定义存储**(React Native 的 `AsyncStorage`、IndexedDB 封装、服务端会话存储……):

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";

const om = createLayerman({
  storage: {
    get: (key) => AsyncStorage.getItem(key), // string | null,同步或 Promise 均可
    set: (key, value) => AsyncStorage.setItem(key, value),
  },
});
await om.ready(); // hydrate 是异步的 → 等它完成(见「冷却」行为说明)
```

### `OverlayConfig` —— `open` 的入参

所有字段都可选。

| 字段               | 类型                                              | 默认值     | 含义                                                                                                            |
| ------------------ | ------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------- |
| `id`               | `string`                                          | 自动生成   | 唯一键。不传则生成 `__layerman_auto_n`(必不冲突,跳过同 id 覆盖判定)。同时是冷却持久化的键。                     |
| `data`             | `TData`                                           | —          | 给渲染层用的不透明载荷,对应 `instance.data`。                                                                   |
| `slot`             | `string`                                          | `""`       | 命名串行队列。每个 slot 同一时刻只显示**一个**,各 slot 互不影响。                                               |
| `priority`         | `number`                                          | `0`        | 等待中的条目里,数值大的先显示;同级 FIFO。                                                                       |
| `delay`            | `number`(ms)                                      | 全局 `gap` | 距该 slot 上次空出后再等多久才显示,覆盖 `gap`。                                                                 |
| `duration`         | `number`(ms)                                      | 无(常驻)   | 显示后经过这么久自动 `close()`(`beforeClose` 守卫依然生效)。                                                    |
| `autoRemove`       | `boolean \| number`                               | 全局值     | 按弹窗覆盖 `close` 后的自动移除。                                                                               |
| `overlap`          | `boolean`                                         | `false`    | 绕过串行队列,**立即叠加显示**(见上文 `overlap` vs `replace`)。                                                  |
| `replace`          | `boolean`                                         | `false`    | 抢占该 slot 当前弹窗(被抢者退回队列),跳过 `gap`。                                                               |
| `affix`            | `boolean`                                         | `false`    | 不会被 `replace` 顶掉(替换者改为排到队首);显式 `close` / `remove` / `clear` 仍然有效。                          |
| `route`            | `string \| string[] \| RegExp`                    | —          | 条件糖:仅当 `context.route` 匹配时显示(字符串=全等,数组=包含,RegExp=test)。                                     |
| `requiresAuth`     | `boolean`                                         | —          | 条件糖:`true` 仅 `context.auth` 为真时显示,`false` 仅为假时显示。                                               |
| `when`             | `(ctx: OverlayContext) => boolean`                | —          | 自定义谓词,配了就**覆盖** `route` / `requiresAuth`。不得修改管理器;抛错视为「不满足」。                         |
| `dismissWhenUnmet` | `boolean`                                         | `true`     | 已展示时,`setContext` 后条件不再满足就自动撤下(`reason: "unmet"`)。                                             |
| `cooldown`         | `Cooldown`                                        | —          | 频次限制,见下节。                                                                                               |
| `resolve`          | `(signal: AbortSignal) => Promise<TData \| null>` | —          | 轮到它时才去取数据;返回 `null` / `undefined` 或抛错 ⇒ 跳过,`reason: "empty"`。仅限串行(不能和 `overlap` 同用)。 |
| `beforeClose`      | `() => boolean \| Promise<boolean>`               | —          | 关闭守卫:返回(或 resolve)`false`(或抛错)取消本次 `close()`。**不**拦 `remove` / `clear` / 自动撤下。            |
| `onShow`           | `() => void`                                      | —          | 弹窗变为可见(phase `open`)时调用。                                                                              |
| `onClose`          | `() => void`                                      | —          | 进入 `closing` 时调用。                                                                                         |
| `onRemove`         | `() => void`                                      | —          | 因任何原因被移除时调用一次,无论是否展示过。                                                                     |

上下文保留键:`route`、`auth`(供 `route` / `requiresAuth` 糖读取)。其他键随便用,配合你自己的 `when(ctx)`。

### 冷却与时长(Cooldown / Duration)

`cooldown` 限制同一个 `id` 的出现频率。你写的所有字段必须**同时**满足(AND),计数在弹窗真正打开时 +1。

| 字段      | 类型       | 持久化 | 含义                                      |
| --------- | ---------- | ------ | ----------------------------------------- |
| `session` | `number`   | 否     | 本次页面会话最多 N 次(仅内存)。           |
| `total`   | `number`   | 是     | 累计最多 N 次。                           |
| `day`     | `number`   | 是     | 每个**本地自然日**最多 N 次。             |
| `hour`    | `number`   | 是     | 每个本地自然小时最多 N 次。               |
| `minute`  | `number`   | 是     | 每个本地自然分钟最多 N 次。               |
| `minGap`  | `Duration` | 是     | 距上次展示的最小间隔(滚动,不按自然边界)。 |

`Duration` = `{ days?, hours?, minutes?, seconds? }`,各项相加:`{ hours: 1, minutes: 30 }` = 90 分钟。

```ts
om.open({ id: "promo", cooldown: { day: 1 } }); // 每天一次
om.open({ id: "rate-us", cooldown: { total: 3, minGap: { days: 7 } } }); // 累计 ≤3 次,间隔 ≥7 天
om.open({ id: "tip", cooldown: { session: 1 } }); // 每次打开页面一次
```

`session` / `total` 用完是永久性的 → 该条目立即以 `{ dismissed: true, reason: "capped" }` 兑现,不会永远排队。
`day` / `hour` / `minute` / `minGap` 会自行恢复,所以条目只是等待(冷却到期**不会**唤醒调度器,见「冷却:持久化、跨 Tab 与唤醒」)。

### 管理器方法

| 方法                                       | 作用                                            |
| ------------------------------------------ | ----------------------------------------------- |
| `open(config)`                             | 入队 / 展示弹窗,返回 `{ id, result }`。         |
| `resolve(id, value)` / `reject(id, error)` | 向 `result` 投递成功值 / 错误。                 |
| `update(id, patch)`                        | 就地更新已展示弹窗的 `data`。                   |
| `close(id)`                                | 进入退场阶段(`closing`),受 `beforeClose` 守卫。 |
| `remove(id)`                               | 彻底移除并推进队列。                            |
| `clear(select?)`                           | 批量移除。                                      |
| `pauseAll()` / `resumeAll()`               | 冻结 / 解冻整个管理器。                         |
| `pause(id)` / `resume(id)`                 | 冻结 / 解冻单个弹窗的计时器。                   |
| `setContext(partial)`                      | 推入条件上下文并重评。                          |
| `subscribe(listener, options?)`            | 订阅状态变化。                                  |
| `getSnapshot()` / `getServerSnapshot()`    | 同步读取状态。                                  |
| `get(id)`                                  | 按 id 取一个活跃实例。                          |
| `ready()`                                  | 等冷却状态 hydrate 完成。                       |
| `destroy()`                                | 整体销毁。                                      |

`subscribe`、`getSnapshot`、`getServerSnapshot`、`get` 已绑定实例,可以当裸引用传递(例如给 React 的 `useSyncExternalStore`)。

#### `open(config)`

```ts
open<TData = unknown, TResult = unknown>(config: OverlayConfig<TData>): OverlayHandle<TResult>
// OverlayHandle<TResult> = { id: string; result: Promise<TResult | DismissResult> }
```

登记弹窗并立即返回;轮到它、**且**条件 / 冷却通过时才会显示。`result` 只会兑现一次——要么是你的 UI 传给
`resolve` / `reject` 的值,要么在任何被动结束时兑现为 `{ dismissed: true, reason }`。

```ts
// 1. 发了就不管
om.open({ id: "welcome", data: { text: "你好" } });

// 2. 等用户决定(给结果标类型;只有 `=== true` 才算确认)
const ok = await om.open<{ msg: string }, boolean>({ id: "del", data: { msg: "确定删除?" } }).result;
if (ok === true) doDelete();

// 3. 优先级 + slot + 条件 + 冷却 + 钩子
om.open({
  id: "vip-promo",
  slot: "banner",
  priority: 10,
  route: ["/home", /^\/shop/],
  requiresAuth: true,
  cooldown: { day: 1 },
  onShow: () => track("promo_show"),
});

// 4. 后端驱动的载荷
om.open<Offer>({
  id: "offer",
  resolve: async (signal) => (await fetch("/api/offer", { signal })).json(), // 返回 null → 跳过
});
```

同 `id` 规则:重开一个**正在展示**的 id,会丢弃旧实例(其 `result` → `reason: "replaced"`),新实例用新的
`instanceKey` 接管(不额外计冷却);重开一个**在队列中**的 id,则覆盖队列里那条。`destroy()` 之后 `open()` 什么也不显示,
并返回已兑现 `reason: "destroyed"` 的 `result`。

#### `resolve(id, value)` / `reject(id, error)`

投递命令式结果。它们**不会关闭**弹窗——关闭是独立的一步(`close`),所以你可以先 resolve、播退场动画、再 remove。
id 不存在、已兑现、或**从未展示过**(还在排队 / 还在 resolving)时被忽略:请等弹窗真正显示出来再由 UI 投递。

```ts
om.resolve("confirm", true); // result → true
om.reject("upload", new Error("网络断了")); // result 被 reject
try {
  await om.open({ id: "upload" }).result;
} catch (e) {
  /* 就是上面那个 Error */
}
```

#### `update(id, patch)`

把 `patch` 浅合并进弹窗的 `data`(非对象数据则整体替换),不触发队列变更。只有弹窗处于 `open` / `closing`
且确有值变化(`Object.is`)时才通知订阅者。排队中的更新是静默的;处于 `resolve(signal)` 期间的补丁会被保留,
数据落地时再应用。

```ts
om.open({ id: "upload", data: { percent: 0 } });
om.update("upload", { percent: 60 }); // data = { percent: 60 };订阅者重渲染
```

#### `close(id)` / `remove(id)`

两阶段关闭。`close` 把**已展示**(`open`)的弹窗转入 `closing`——它仍留在 `active` 里,你的 UI 可以播退场动画——
随后由 `remove`(`autoRemove` 到点自动调,或你手动调)把它摘掉并让下一个进场。对排队中 / resolving / 已在 closing 的
id 调 `close` 是空操作。

- 有 `beforeClose` 时先过守卫;返回 `false`(或抛错 / Promise reject)取消关闭。守卫结果在微任务里等待,
  所以带守卫的弹窗一定是**异步**进入 `closing`。守卫未决期间重复调用 `close()` 不会再次触发守卫。
- `remove` 在任何阶段(排队、resolving、已展示)都有效,且**不**过守卫。其 `result` 在弹窗已到 `closing` 时以
  `reason: "closed"` 兑现,否则为 `"removed"`。

```ts
om.open({ id: "form", beforeClose: () => confirm("放弃修改?") });
om.close("form"); // 先询问;用户同意才进入 "closing"
om.remove("form"); // 强制移除,不会询问

// 让移除与自己的退场动画对齐:
om.open({ id: "modal", autoRemove: false });
// ……CSS 过渡结束时:
el.addEventListener("transitionend", () => om.remove("modal"), { once: true });
```

#### `clear(select?)`

```ts
clear(arg?: ClearSelector | { closeActive?: boolean }): void
// ClearSelector = (ctx: OverlayContext, records: OverlayRecord[]) => string[] | void
// OverlayRecord = { id; data; slot; phase: "pending"|"resolving"|"open"|"closing"; active: boolean }
```

每个被清理的弹窗都以 `reason: "cleared"` 兑现,并触发 `onRemove`。

```ts
om.clear(); // 清掉所有还在等待的(已展示的保留)
om.clear({ closeActive: true }); // 等待的和已展示的一起清
om.clear(
  (
    ctx,
    records, // 精确清理:只移除返回的这些 id
  ) => records.filter((r) => (r.data as { group?: string })?.group === "marketing").map((r) => r.id),
);
om.clear(() => {}); // 选择器返回非数组 = 全部清理
```

#### `pauseAll()` / `resumeAll()` / `pause(id)` / `resume(id)`

- `pauseAll()` 是**全量冻结**:不会有新弹窗变成活跃(串行调度停止,`replace` 不会顶掉当前,`overlap` 被持有),
  所有 `duration` / `autoRemove` 倒计时也停止。`resumeAll()` 放行被持有的 overlap 和已落地的 `resolve` 结果,
  重启倒计时并重新调度。暂停期间 `close` / `remove` / `clear` 仍然有效。典型场景:全局新手引导、系统权限弹窗。
- `pause(id)` / `resume(id)` 只冻结该弹窗自己的计时器(`duration` 与 `close` 后的自动移除),例如用户悬停 toast 时。

```ts
om.open({ id: "toast", duration: 3000, overlap: true });
toastEl.onmouseenter = () => om.pause("toast");
toastEl.onmouseleave = () => om.resume("toast");

om.pauseAll(); // ……引导进行中……
om.resumeAll();
```

#### `setContext(partial)`

把 `partial` 浅合并进条件读取的上下文,然后重评:已展示但条件不再满足的弹窗被撤下(除非 `dismissWhenUnmet: false`,
`reason: "unmet"`),等待中的弹窗获得新的机会。这是输入上下文的唯一途径——没有 `context` 构造参数。

```ts
om.open({ id: "checkout-tip", route: "/cart", requiresAuth: true });
om.setContext({ route: "/cart", auth: true }); // 现在满足 → 显示
om.setContext({ route: "/home" }); // 已展示的被撤下(unmet)

om.open({ id: "beta", when: (ctx) => ctx.plan === "pro" });
om.setContext({ plan: "pro" }); // 自定义键配合 `when` 使用
```

#### `subscribe(listener, options?)`

```ts
subscribe(listener: (state: OverlayState) => void, options?: { immediate?: boolean }): () => void
```

每次状态变化后 `listener` 收到新的 `OverlayState`;返回值用于取消订阅。`immediate: true` 会在订阅时立刻用当前快照调用一次。
一次公共操作最多通知一次,且每个订阅者最终都拿到最新快照——见「钩子与通知」。

```ts
const unsub = om.subscribe(
  ({ active, queued }) => {
    console.log(
      "可见:",
      active.map((o) => o.id),
      "等待:",
      queued,
    );
  },
  { immediate: true },
);
unsub();
```

#### `getSnapshot()` / `getServerSnapshot()` / `get(id)`

- `getSnapshot(): OverlayState` —— 当前状态;变化之前返回**同一个引用**(可安全用于 `useSyncExternalStore`)。
- `getServerSnapshot(): OverlayState` —— SSR / hydration 用的恒定冻结空状态。
- `get(id): OverlayInstance | undefined` —— 取该 id 的**活跃**(open / closing)实例;排队中的 id 返回 `undefined`。

#### `ready()`

`Promise<void>`,冷却状态从存储 hydrate 完成后兑现(无论读取成功、失败还是数据损坏)。建议在第一次 `open` 之前 `await` ——
配了持久化冷却字段的条目本来也会等它。

#### `destroy()`

幂等销毁:清空所有弹窗(`reason: "destroyed"`,各自触发 `onRemove`),关闭跨 Tab 通道,发出一次最终的空快照,然后丢弃所有订阅者。
之后 `open()` 什么也不显示,其他变更方法都是空操作。

### 返回与观测到的类型

```ts
interface OverlayState {
  active: readonly OverlayInstance[]; // 照着它渲染,保持顺序
  queued: readonly string[]; // 仍在等待的 id(仅供观测)
}

interface OverlayInstance<TData = unknown> {
  id: string;
  data: TData;
  slot: string;
  phase: "open" | "closing"; // 对外只有这两个阶段
  priority: number;
  overlapping: boolean; // 是否经 `overlap` 进来
  stackIndex: number; // 入场层序(从 0 起)→ 你的 z-index
  isTopmost: boolean; // stackIndex 最大 → 其余的加 pointer-events: none
  instanceKey: number; // 每次 open 递增 → 当 render key
}
```

`OverlayPhase`(`{ open, closing }`)和 `DismissReason`(见上文 `DismissResult` 表)都以 `as const` 对象加同名联合类型导出,
既能在运行时比较,也能当类型标注。

```ts
import { OverlayPhase } from "@codejoo/layerman";
const leaving = inst.phase === OverlayPhase.closing;
```

### 框架适配层

所有适配层都是 `subscribe` + `getSnapshot` 之上的薄桥(可选 peer 依赖,各自独立子路径),形状一致:管理器来自 context(或作为最后一个参数传入)、
状态桥、按 id 绑定的 `useOverlay(id, defaults?, om?)`,以及给中央渲染器用的「当前 overlay」助手。

| 子路径                     | 状态桥                           | 按 id 绑定                       | 注入管理器                                                                | 当前 overlay                                                                              |
| -------------------------- | -------------------------------- | -------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `@codejoo/layerman/vue`    | `useOverlayState`, `useOverlays` | `useOverlay(id, defaults?, om?)` | `createLayermanPlugin(om)`, `provideLayerman(om)`                         | `provideCurrentOverlay(id)` + `useCurrentOverlay(om?)`                                    |
| `@codejoo/layerman/react`  | `useOverlayState`, `useOverlays` | `useOverlay(id, defaults?, om?)` | `<LayermanProvider manager>`, `createLayermanProvider(om)`, `useLayerman` | `<CurrentOverlayProvider id>` + `useCurrentOverlay(om?)`                                  |
| `@codejoo/layerman/svelte` | `overlayState`, `overlays`       | `overlay(id, defaults?, om?)`    | `setLayerman(om)` / `getLayerman()`                                       | `provideCurrentOverlay(id)` + `currentOverlay(om?)`                                       |
| `@codejoo/layerman/solid`  | `useOverlayState`, `useOverlays` | `useOverlay(id, defaults?, om?)` | `<LayermanProvider value>`, `provideLayerman(om)`                         | `<CurrentOverlayProvider value>` / `provideCurrentOverlay(id)` + `useCurrentOverlay(om?)` |

所有按 id 绑定都返回 `{ instance, visible, phase, open, close, remove, resolve, reject, pause, resume }`
(响应式值在 Vue 里是 `ComputedRef`、React 里是普通值、Svelte 里是 `Readable` store、Solid 里是 accessor;Vue 额外有给 `v-model` 用的可写 `model`)。
`defaults` 是去掉 `id` 的完整 `OverlayConfig`,会合并进每一次 `open()`;`open(config)` 再覆盖它。`useOverlays()` / `overlays()` 返回 `{ active, queued }`。
Vue 的详细用法见下文「Vue 3 接入」,其余框架的精简示例:

```tsx
// React
import { LayermanProvider, CurrentOverlayProvider, useOverlays, useOverlay, useCurrentOverlay } from "@codejoo/layerman/react";

function Host() {
  const { active } = useOverlays();
  return active.map((o) => (
    <CurrentOverlayProvider key={o.instanceKey} id={o.id}>
      <Layer />
    </CurrentOverlayProvider>
  ));
}

function Layer() {
  const { instance, resolve, close } = useCurrentOverlay<{ text: string }>(); // 不用层层传 id
  return (
    <div data-phase={instance?.phase}>
      {instance?.data.text}
      <button
        onClick={() => {
          resolve(true);
          close();
        }}
      >
        确定
      </button>
    </div>
  );
}

function PromoButton() {
  const { open, visible } = useOverlay("promo", { replace: true, cooldown: { day: 1 } });
  return (
    <button disabled={visible} onClick={() => open({ data: { text: "优惠!" } })}>
      促销
    </button>
  );
}
// <LayermanProvider manager={om}><Host /><PromoButton /></LayermanProvider>
```

```svelte
<!-- Svelte 4 / 5:store,模板里加 $ 前缀 -->
<script>
  import { overlays, overlay, setLayerman } from "@codejoo/layerman/svelte";
  import { om } from "./overlay";

  setLayerman(om); // 组件初始化时调用一次
  const { active } = overlays();
  const promo = overlay("promo", { replace: true });
</script>

{#each $active as o (o.instanceKey)}
  <div data-phase={o.phase}>{o.data.text}</div>
{/each}
<button on:click={() => promo.open({ data: { text: "优惠!" } })}>促销</button>
```

```tsx
// Solid:返回值是 accessor,要调用
import { LayermanProvider, useOverlays, useOverlay } from "@codejoo/layerman/solid";
import { For, Show } from "solid-js";

function Host() {
  const { active } = useOverlays();
  return <For each={active()}>{(o) => <div data-phase={o.phase}>{(o.data as { text: string }).text}</div>}</For>;
}

function PromoButton() {
  const promo = useOverlay("promo", { replace: true });
  return (
    <Show when={!promo.visible()}>
      <button onClick={() => promo.open({ data: { text: "优惠!" } })}>促销</button>
    </Show>
  );
}
// <LayermanProvider value={om}><Host /><PromoButton /></LayermanProvider>
```

## 行为说明

### 判断函数(`when` 等)里不要修改管理器

条件判断函数(`when(ctx)`,以及 `route` / `requiresAuth` 的求值)里**不要调用任何变更方法**(`open` / `close` /
`remove` / `resolve` / `reject` / `update` / `clear` / `setContext` / `pause*` / `resume*` / `destroy`)。
它会在改动任何状态**之前**抛错;而条件求值本身是防御式的,这个异常会被捕获,该弹窗按**条件不满足**处理
(`debug: true` 时会打一行日志)。只读调用(`getSnapshot`、`get`、`subscribe`)不受限。生命周期钩子
(`onShow` / `onClose` / `onRemove`)和订阅者里**可以**调用管理器。

### 钩子与通知

先提交状态,再按顺序**同步**执行 `onShow` / `onClose` / `onRemove`,且**在公开方法返回之前**完成——不会发生在
状态迁移的中途。一次公开操作**最多通知订阅者一次**(例如一次 `clear()` 清掉多个弹窗也只通知一次);若钩子或
订阅者在其中又修改了管理器,会在其后追加一轮通知。钩子或订阅者抛错不会破坏管理器。

"在公开方法返回之前"只对**最外层**调用成立。在钩子或订阅者**里面**发起的变更会并入外层操作:它自己的钩子和快照
要等当前回调返回后才生效,所以嵌套调用返回后立即读 `getSnapshot()` / `get()` 仍是旧状态。每个订阅者最终都会收到
最新快照(与 `getSnapshot()` 同一引用),即使前面的订阅者又改了管理器也不会漏收,同一快照也不会重复收到。通知
过程中新加的订阅者收不到本轮快照(订阅后自己读一次 `getSnapshot()` 即可,各适配器都是这么做的)。

无变化时也不通知:`clear()` 没摘除任何条目;`update()` 作用于 open / closing 项且补丁值与现值 `Object.is` 全部相同。
**订阅者里发起的变更必须有收敛条件**,请加变化判断。若订阅者每次通知都在改管理器(例如每次 `update()` 都给不同的值),
会一直追加通知,直到每次最外层调用共 100 轮通知(含首轮)的上限,之后停止补发,并向每个订阅者最后投递一次最新快照(这次投递期间再发生的变更只静默改状态、不再通知),同时输出一条诊断(配置了 `logger` 走 logger,否则 `console.warn`,与 `debug` 无关)。合法但需要超过 100 轮才收敛的级联会被截断。

### 冷却:持久化、跨 Tab 与唤醒

- **跨 Tab 是最终一致,不提供严格的全局额度。** 冷却计数经 `BroadcastChannel` 同步给其他标签页;两个标签页在
  广播送达**之前**同时 open 同一个弹窗,可能都会显示。
- **`crossTab` 默认值**:浏览器里开启(`window` 与 `BroadcastChannel` 同时存在),**Node / SSR 默认关闭**。可传
  `crossTab: true` / `false` 强制指定。
- **关闭 `crossTab`(或环境不支持)时,多个 Tab 会互相覆盖**:每个 Tab 把自己的快照写进存储,后写者胜出,
  其他 Tab 记下的计数可能丢失。
- **冷却到期不会自动唤醒调度。** 只被 `minGap` / `day` / `hour` / `minute` 卡住的弹窗,窗口过去后不会自己弹出;
  它在下一次触发(`open`、`remove`、`clear`、`setContext`、gap 计时、`resume`)时才重评。需要「到点重评」时,
  自己调用 `om.setContext({})`。
- **第一次 `open` 之前建议先 `await om.ready()`。** 冷却状态是异步从存储 hydrate 的。`cooldown` 里用了持久化字段
  (`total` / `day` / `hour` / `minute` / `minGap`)的条目,若在 hydrate 完成前 open,会**先等待**(串行条目留在队列;
  `overlap` 条目被持有、不丢弃),hydrate 结束(成功、失败或坏数据)后立即重新调度。因此不会「盲」展示,也不会少计。
  只配 `session` 或没有冷却的条目不受影响。存储的 `get` Promise 仍必须最终 settle,否则 hydrate 永远无法完成,
  被门控的条目会一直等。
- 非法的持久化 / 广播记录按单条丢弃;存储写入失败被忽略。

### `destroy()` 之后

`destroy()` 会清空一切(每个弹窗的 `result` 兑现 `{ dismissed: true, reason: 'destroyed' }`、触发 `onRemove`)、关闭跨 Tab 通道,**先向订阅者发出一次最终的空快照**(`active` 为空;管理器本来就是空的则不通知),再丢弃订阅者。
之后不再有任何通知,且 `open()` **不会展示任何东西**:它返回的句柄 `result` 立即兑现 `{ dismissed: true, reason: 'destroyed' }`;其余变更方法全部是空操作。

### `DismissResult` 与 `DismissReason`

被动结束(不是你自己调用 `resolve` / `reject`)时,`result` 兑现 `{ dismissed: true, reason }`。类型上 `reason` 是
可选字段(所以 `{ dismissed: true }` 仍能通过类型检查),但内核总会带上它。`DismissReason` 是 `as const` 对象加同名
联合类型,从 `@codejoo/layerman` 导出。

| `reason`    | 何时                                                                      |
| ----------- | ------------------------------------------------------------------------- |
| `removed`   | 显式 `remove()`,条目尚未进入 `closing`                                    |
| `closed`    | 仅「已展示条目经 `close()` 进入 `closing` 后被移除」                      |
| `cleared`   | `clear()`,含选择器清理                                                    |
| `replaced`  | 同 id `open()` 覆盖旧实例,或 `replace` 丢弃 `closing` 实例                |
| `unmet`     | 上下文变化触发 `dismissWhenUnmet`;`overlap` 发射门(条件 / 时间冷却)未通过 |
| `capped`    | `session` / `total` 永久耗尽(见下)                                        |
| `destroyed` | `destroy()`,以及销毁期间或之后的 `open()`                                 |
| `empty`     | `resolve(signal)` 后端返回 `null` / `undefined` 或抛错                    |

```ts
import { DismissReason } from "@codejoo/layerman";

const r = await om.open<unknown, boolean>({ id: "promo", cooldown: { total: 1 } }).result;
if (typeof r === "object" && r !== null && "dismissed" in r) {
  switch (r.reason) {
    case DismissReason.capped: // 展示额度已用完:不要再重试
    case DismissReason.destroyed: // 应用正在退出
      break;
    case DismissReason.replaced: // 被新实例取代:忽略
      break;
    default: // removed / closed / cleared / unmet / empty
      break;
  }
} else {
  // r 是你的 UI 传给 om.resolve("promo", ...) 的值
}
```

### 行为变更(本次版本)

标 **breaking** 的条目可能改变既有代码观察到的行为,其余为非 breaking。

1. **钩子在提交后执行,嵌套调用被延后**(对正确用法非 breaking)。先提交状态,再在最外层公开方法返回之前执行
   `onShow` / `onClose` / `onRemove`。在钩子或订阅者里再次修改管理器,会并入外层操作:嵌套调用之后立刻读
   `getSnapshot()` / `get()` 仍是旧状态。
2. **通知合并并设上限**(非 breaking)。一次公开操作最多通知一次;重入的变更会追加后续轮次,每次最外层调用总共最多 `MAX_NOTIFY_ROUNDS`
   (100)轮通知(含首轮),之后停止补发,向每个订阅者最后投递一次最新快照(其间的变更不再通知),并输出一条诊断(`logger`,否则 `console.warn`,与 `debug` 无关)。订阅者里的变更务必有收敛条件。
3. **判断函数内不得修改管理器**(对已有此类写法的代码 **breaking**)。在 `when` / `route` / `requiresAuth` 求值中调用
   变更方法,会在改动状态之前抛错;异常被捕获,该条目按条件不满足处理。
4. **`destroy()` 之后**(依赖「销毁后 `open()` 仍入队」的代码 **breaking**):`open()` 立即返回
   `{ dismissed: true, reason: 'destroyed' }`;订阅者收到一次最终的空快照(管理器本来就是空的则不通知),随后被丢弃。
5. **`crossTab` 默认值**(仅非浏览器环境 breaking):只有 `window` 与 `BroadcastChannel` 同时存在才默认开启;
   Node、Bun、Deno、Worker 里**默认关**。需要时传 `crossTab: true`。
6. **`stackIndex` 按实际入场序**(非 breaking)。反映弹窗真正进入的先后(串行槽与 overlap 交错),而不是内部列表的插入序。
7. **`update()` 对排队项不通知**(非 breaking):只有 `open` / `closing` 的弹窗才有已渲染的数据需要刷新。
8. **`capped`(breaking)。** 串行条目因 `session` 或 `total` 永久耗尽而不可能再展示时,不再永远排队,而是在状态可能变化的每个检查点复检:提交时、hydrate 完成后、`resolve(signal)` 结果落地时、跨 Tab 更新合并后(被 `pauseAll` 持有的 `overlap` 若变为 capped,会立即兑现,不等 `resumeAll`),一旦命中就在
   当场以 `{ dismissed: true, reason: 'capped' }` 兑现,不展示、不计数。`overlap` 条目同样带该
   reason。`minGap` / `day` / `hour` / `minute` 到期会自行解除,**不算** capped,仍然排队(冷却到期仍不会自动唤醒调度)。
   _迁移:_ 以前永远等不到的 `result` 现在会兑现;请处理 `reason === 'capped'`。
9. **`DismissResult.reason`**(仅对严格相等判断 **breaking**)。运行时对象由 `{ dismissed: true }` 变为
   `{ dismissed: true, reason }`。对结构类型是增量改动,但严格相等判断(如 `toEqual({ dismissed: true })`)需要更新;
   推荐用 `'dismissed' in r` 或 `r.dismissed === true`。
10. **hydrate 门控**(对旧的「提前 open 可能绕过」规避写法 **breaking**)。hydrate 完成前,带持久化冷却字段的条目会
    先等待(见上文「冷却」),完成后立即重新调度。此前「提前 `open` 可能绕过或少计额度」的警告不再成立;仍建议
    `await ready()` 以免等待。
11. **`resolve` / `reject` 对从未展示过的条目无效**(对提前投递结果的代码 **breaking**)。对从未展示过的条目(排队、
    `resolve(signal)` 仍在请求中、被暂停或 hydrate 持有的 `overlap`),`resolve(id, v)` / `reject(id, e)` 是空操作,
    不会提前兑现 `result`。请在弹窗真正展示后再由 UI 投递结果。

12. **`resolve(signal)` 期间的 `update()` 不再丢失**(非 breaking,缺陷修复)。后端请求进行中打的补丁会合并进
    最终落地的数据,而不是被覆盖。
13. **冷却存储加固**(非 breaking,缺陷修复)。存储与广播里的记录都会校验(坏记录只丢弃该条,不影响其他 id);
    写入串行且总是写最新快照;hydrate 按 id 合并(旧的磁盘快照不会回退内存里更新的计数);`__proto__` 之类的 id 也能正确持久化。
14. **诊断不再破坏状态**(非 breaking)。`logger` 抛出的异常会被吞掉;判断函数(`when` 等)抛出的异常在开启
    `debug` 时经 `logger` 上报,并按"条件不满足"处理。
15. **React 适配器**(非 breaking)。推荐使用 `CurrentOverlayProvider`;旧的小写导出 `provideCurrentOverlay`
    作为 deprecated 别名保留。没有 provider 时 `useCurrentOverlay()` 的报错信息改为指向推荐组件。

16. **过期的 `beforeClose` 决议被忽略**(非 breaking,缺陷修复)。守卫未决期间弹窗被顶掉、又重新展示时,
    旧守卫迟到的结果不会再把新的这次展示关掉。
17. **Vue `model.set(false)` 带 `beforeClose` 守卫**(非 breaking;与 Vue 小节一直承诺的一致)。守卫放行后
    实例立即被移除,而不是停在 `closing` 等 `autoRemove` 触发。

## Vue 3 接入

`/vue` 子路径是一层薄薄的响应式桥接——**只提供 composable,不含组件**。

```ts
// overlay.ts —— 全局创建一次
import { createLayerman } from "@codejoo/layerman";
export const om = createLayerman();

// main.ts
import { createLayermanPlugin } from "@codejoo/layerman/vue";
await om.ready();
app.use(createLayermanPlugin(om)); // 全应用注入默认实例(也可每次调用显式传 om)
```

管理器实例遵循「**插件默认 + 参数覆盖**」:给任意 composable 传 `om` 即优先用它,不传则回退到
`createLayermanPlugin` / `provideLayerman` 注入的实例。

### 风格 A —— 命令式 + 中央渲染器 `<OverlayHost>`

弹窗把要渲染的组件放进 `data`,一个全局 host 遍历 `active` 渲染:

```vue
<!-- OverlayHost.vue —— 挂在 App 根部,全局唯一 -->
<script setup lang="ts">
import type { Component } from "vue";
import { useOverlays } from "@codejoo/layerman/vue";
import { om } from "./overlay";

type OverlayData = { comp: Component; props?: Record<string, unknown> };
const { active } = useOverlays(om);
</script>

<template>
  <!-- 每个活跃 overlay 一层蒙层;overlap 叠加天然堆叠 -->
  <div v-for="o in active" :key="o.instanceKey" class="overlay-mask">
    <component :is="(o.data as OverlayData).comp" v-bind="(o.data as OverlayData).props" :data-phase="o.phase" @resolve="(v: unknown) => om.resolve(o.id, v)" @close="() => om.close(o.id)" />
  </div>
</template>

<style scoped>
.overlay-mask {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.45);
}
</style>
```

```ts
// 业务逻辑任意处
import { om } from "./overlay";
import ConfirmDialog from "./ConfirmDialog.vue";

// result 是 boolean | { dismissed: true }:被动关闭(replace/clear/destroy)的 { dismissed: true } 也是真值,
// 所以只有显式的 true 才算确认。
const ok = await om.open<unknown, boolean>({
  id: "confirm-delete",
  data: { comp: ConfirmDialog, props: { message: "确定删除这一项?" } },
}).result;
if (ok === true) doDelete();
```

`ConfirmDialog.vue` 内部 emit 结果:

```vue
<button @click="$emit('resolve', true)">确定</button>
<button @click="$emit('resolve', false)">取消</button>
```

**退场动画(两阶段)。** 默认 `close()` 会在 300ms 后自动 `remove`——够一个 CSS 淡出。要与动画
精确同步,把该弹窗设 `autoRemove: false`,在离场过渡结束时调 `om.remove(id)`:

```vue
<Transition name="pop" @after-leave="() => om.remove(o.id)">
  <component v-if="o.phase === 'open'" :is="(o.data as OverlayData).comp" ... />
</Transition>
```

### 风格 B —— 声明式 `template + ref`,用 `useOverlay`

已经写在模板里的常驻组件,把「可见权」托管给管理器:

```vue
<script setup lang="ts">
import { useOverlay } from "@codejoo/layerman/vue";

const { visible, phase, open, resolve } = useOverlay("promo");
defineExpose({ open }); // 父组件可 promoRef.open()
</script>

<template>
  <div v-if="visible" class="overlay-mask" :data-phase="phase">
    <div class="card">
      <p>限时优惠!</p>
      <button @click="resolve(true)">领取</button>
    </div>
  </div>
</template>
```

```ts
// 调用方 —— 同样走队列/优先级/冷却规则
// open() 返回 OverlayHandle,结果在它的 `.result` Promise 上
const claimed = await promoRef.value.open({ priority: 10, cooldown: { day: 1 } }).result;
```

`useOverlay(id, defaults?, om?)` 返回 `{ instance, visible, model, phase, open, close, remove,
resolve, reject, pause, resume }`(`defaults` 见下)。本层每个 composable(`useOverlayState`、
`useOverlays`、`useOverlay`、`useCurrentOverlay`)都必须在活跃的 effect scope 内调用——`setup()`
内,或显式 `effectScope()` 内——否则订阅创建后无处挂自动退订,会在管理器整个生命周期里泄漏;在
scope 外调用会直接抛错,而不是静默泄漏。

**中央渲染器(风格 A)**:用小组件包裹每个渲染项、在其 setup 调 `provideCurrentOverlay(o.id)`,则 overlay
组件内部可用 `useCurrentOverlay()` 零透传拿到自身 `{ close, resolve, data, … }`。把组件放进 `data` 经
`<component :is>` 渲染时,用 `markRaw(Component)` 包一下,避免被转成响应式代理。

### 只暴露 `v-model` 的第三方弹窗

很多 UI 库(Element Plus、Vant、Ant Design Vue……)的可见性**只暴露 `v-model`**,你改不了它的
API。用可写的 `model`:

```vue
<script setup lang="ts">
import { useOverlay } from "@codejoo/layerman/vue";
const { model, resolve } = useOverlay("confirm");
</script>

<template>
  <!-- 第三方弹窗自带动画;model 打通两个方向 -->
  <ElDialog v-model="model" title="确认">
    <p>确定删除这一项?</p>
    <template #footer>
      <ElButton @click="resolve(true)">确定</ElButton>
    </template>
  </ElDialog>
</template>
```

`model` get = 「是否在显示」;`set(true)` = `open()`;`set(false)` = 先 `close()`(尊重配置的
`beforeClose` 守卫),关闭生效后紧跟**立即 `remove()`**;若弹窗还在排队中则直接 `remove()`。弹窗自带
退场动画,立即移除可避免 v-model 回弹。

**`set(false)` 且配了 `beforeClose` 守卫。** `model` 会订阅状态,等**同一个实例**进入 `closing` 后再 `remove`。
守卫规则与核心一致:只有返回(或兑现)`false`、抛错、Promise 拒绝才取消本次关闭,其他值(包括 `undefined`)放行;
取消时什么都不移除;期间若该弹窗被替换成了新实例,挂起的关闭请求会被丢弃,
不会误伤新实例。注意:**带 `beforeClose` 的 `close()` 总是异步进入 `closing`**(守卫结果在微任务里等待——
即使守卫同步返回 `true` 也一样),这是有意的设计取舍,所以配了守卫时,`model.value = false` 之后 getter 可能
还会读到一个 tick 的 `true`;没有 `beforeClose` 时则立即翻转。

**已知限制。** `model` 只能观测经由**本** `useOverlay` 的 `open()` / `defaults` 配置的守卫。若守卫是在别处配的
(外部直接 `om.open()`,或另一个 `useOverlay` 实例),它拒绝了 `model = false` 的关闭时,`model` 观测不到,其监听会
残留;之后同一实例因其他原因(`close()`、`duration`)进入 `closing`,会被立即 `remove`,跳过退场动画。
请通过同一个 `useOverlay` 的 `open()` / `defaults` 配置守卫。

**让 v-model 弹窗立即显示 / 插队。** `v-model="model"`(或 `ref = true`)只是**入队**——若被排在
别的弹窗或 `gap` 后面,`model` 的 getter 会读回 `false`,第三方弹窗随即回弹关闭。把该 overlay 的
**固有行为**声明在 `useOverlay` 的第二个参数 `defaults` 里(会合并进每一次 open——`model=true`、
`open()`、ref 触发都算):

```ts
// overlap：叠加在最上层、绕过串行槽 → 立即进入 active，getter 立刻为 true
const { model } = useOverlay("alert", { overlap: true });
// replace：抢占该 slot 当前占用者 → 同样立即，且仍保持一次一个
const { model: promo } = useOverlay("promo", { replace: true, priority: 10, cooldown: { day: 1 } });
```

`open(config)` 仍会逐次覆盖 `defaults`。经验法则:**v-model 驱动的弹窗应带 `overlap` 或 `replace`**
(才能同步进入 active);而普通排队弹窗和 v-model 的同步布尔天生不兼容——那种请用 `open()` 触发、
用 `visible` 渲染。

`defaults` **支持响应式**——可传普通对象、`ref` 或 getter 函数,每次 open 用 `toValue` 求值取最新
(每次唤起读一次,不是持续追踪)。函数型字段(`when`/`resolve`/钩子)写在返回对象里,不会被误当
getter 调用:

```ts
const pri = ref(0);
const { model } = useOverlay("x", () => ({ priority: pri.value, when: () => store.vip, overlap: true }));
```

### `v-model` vs 条件门控 —— 选对工具

v-model 的布尔只有 true/false,**没有「我想要但被门挡着」的第三态**,所以它适合**无条件**弹窗,
不适合条件门控的。若 `model = true` 但 `when`/`route`/冷却不满足:getter 恒为 `false`(v-model 回弹
关闭);普通弹窗会**排队等待**(条件满足后再弹),`overlap` 弹窗则被**丢弃**(不会自动补弹)——两者都不直观。

建议:

- **无条件、必须立即显示**(全局 alert/confirm):`v-model` + `defaults: { overlap: true }`(或 `replace`)。干净。
- **有条件的弹窗**:别依赖 `v-model`。要么把门控算在你自己这边——写一个可写 computed:`const gated = computed({ get: () => wanted.value && canShow.value, set: (v) => (wanted.value = v) })`,再绑 `v-model="gated"`;
  要么用 `open()` 触发、用 **`visible`** 渲染(`visible` 能如实表达「已入队但还没显示」的中间态,不会回弹)。

一句话:把 manager 的条件/冷却当作**队列门控**用(配 `open()` + `visible`),而不是硬塞进 v-model 的同步布尔。

## 验收 / 开发

```bash
pnpm test    # vitest(14 文件,863 通过:核心 + 不变量 + fuzz + 冷却存储 + Vue/React/Svelte/Solid 适配层 + 类型级)
pnpm check   # oxfmt --check + type-aware oxlint
pnpm build   # vp pack → dist/esm(index + vue/react/svelte/solid 多入口)
```

## React / Svelte / Solid

其他框架提供同样形态的适配层——完整对照表与示例见上文 API 参考的「框架适配层」。React 的中央渲染器里请用
**`<CurrentOverlayProvider id={o.id}>`**(首字母大写,可直接用于 JSX);`provideCurrentOverlay` 是**已弃用**的别名,
它的小写名字会被 JSX 当成原生标签。另有 Flutter 版在 `dart-labs/layerman`(拥抱 Flutter 的 `Overlay`,`show()` 返回 `Future<T?>`)。

## License

MIT
