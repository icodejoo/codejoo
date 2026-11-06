# Layerman 架构文档

> 本文只描述**当前实现**（以 `src/` 为准）。尚未实现、待拍板的设计放在文末「未实现 / 待拍板」一节，不要当作现有行为。
> 架构示意图见同目录 `ARCHITECTURE.svg`（与本文一致，细节以本文为准）。

## 1. 定位

`@codejoo/layerman` 是框架无关的 **headless** overlay 队列管理器：只管「谁该显示 / 何时显示 / 怎么关」，**不碰 DOM、动画、z-index**。宿主订阅状态、遍历 `active` 渲染。运行时零依赖，入口工厂是 `createLayerman(options)`（不是单例）。

对外 API 只有 `open / resolve / reject / update / close / remove / clear / pauseAll / resumeAll / pause / resume / setContext / subscribe / getSnapshot / getServerSnapshot / get / ready / destroy`。没有 `show/queue/dismiss`，也没有 `context` 构造参数——上下文只能经 `setContext(partial)` 推入。

## 2. 整体分层

```
宿主（渲染 active 列表；setContext 推入上下文；resolve/reject 投递结果）
   ▲ subscribe / getSnapshot / get                  ▼ open / close / remove / setContext …
┌──────────────────────────── src/index.ts（LayermanImpl）────────────────────────────┐
│ 公共 API → batch → 变更实现 → 状态（slots/serial/queues/overlapping/…）→ effects → emit │
│ 调度器 scheduleNow ─ evaluate（条件 → 冷却）─ activate / doOpen / doClose               │
└───────────────┬───────────────────────────────────────────────────────┬───────────┘
                │ canShow / record / mergeRemote / hydrate               │ BroadcastChannel
         src/cooldown.ts（CooldownStore，不是包入口）                     │ `${storageKey}:sync`
                │ get/set（可同步可异步）                                  ▼
            AsyncableStorage（默认 localStorage，否则纯内存）            其他标签页
```

| 文件                                           | 职责                                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/index.ts`                                 | 公共类型 + `LayermanImpl`：队列、调度、生命周期、批处理、通知、`destroy`、`checkInvariants()` |
| `src/cooldown.ts`                              | `CooldownStore`：冷却计数、桶、记录校验、hydrate 合并、串行写回；`defaultStorage()`           |
| `src/vue.ts` `react.ts` `solid.ts` `svelte.ts` | 四个适配器，各自独立子路径入口 + 可选 peer 依赖，只做 `subscribe`+`getSnapshot` 的响应式桥接  |

`cooldown.ts` 由 `index.ts` 内部引用，不单独导出为包入口（类型 `AsyncableStorage / Cooldown / Duration` 由 `index.ts` 转导出）。核心**不再是单文件**。

## 3. 数据结构（`LayermanImpl` 私有状态）

| 字段                                       | 含义                                                                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `byId: Map<id, Entry>`                     | 唯一的身份索引与事实来源。**条目在 `byId` 里 ⇔ 它还受管**；不在 `byId` 的条目必已结算（result 已兑现）                                   |
| `queues: Map<slot, Entry[]>`               | 每个 slot 的等待队列，条目 phase = `pending`。默认 slot 是 `""`                                                                          |
| `serial: Map<slot, Entry>`                 | 每个 slot 的串行占用者（0..1），phase ∈ `resolving / open / closing`                                                                     |
| `overlapping: Entry[]`                     | 已展示的 overlap 叠加条目（不占串行槽），phase ∈ `open / closing`，`entry.overlapping === true`                                          |
| `pendingOverlaps: Entry[]`                 | 因 `pauseAll` 冻结、或持久化冷却尚未 hydrate 而被持有的 overlap，phase = `pending`；暂停结束 / hydrate 完成后由 `resumePending` 逐个放行 |
| `openTimers: Map<slot, Timer>`             | 每个 slot 至多一个「gap/delay 等待后开场」计时器                                                                                         |
| `lastClosedAt: Map<slot, ms>`              | slot 上次串行占用者被移除的时间，用于算 gap；缺省回落到 `startedAt`                                                                      |
| `seqCounter / keyCounter / enteredCounter` | `seq`（FIFO 序）/ `instanceKey`（每次 open 递增，宿主当 render key）/ `enteredSeq`（真正入场序，决定 `stackIndex`）                      |
| `snap: OverlayState`                       | 已发布的快照，仅在发布时换引用；`getServerSnapshot()` 恒返回冻结的空态                                                                   |

每个条目恰好属于下列容器之一（不变量 a）：`queues[slot]` / `serial[slot]` / `overlapping` / `pendingOverlaps`。

`Entry` 的内部状态按职责分组：

- `phase`：`pending → resolving → open → closing → closed`（日志用的 5 态）。**对外 `OverlayInstance.phase` 只有 `open | closing`**。
- `timers`：`durationTimer/EndsAt/Remaining`、`autoRemoveTimer/EndsAt/Remaining`、`paused`（单条暂停）。
- `resolveState`：`abort`（请求的 `AbortController`）、`hasPendingResolve/pendingResolveData`（暂停期间缓存的请求结果）、`resolvePatches`（请求期间的 `update` 补丁，落地时依次合并）。
- `close.pending`：`beforeClose` 守卫决议中，避免重复调用。
- `epoch`：代次（见 §7）。`settled/settle/fail`：result 的兑现状态。

## 4. 条目生命周期

```
open() ─▶ pending（队列 / pendingOverlaps）
            │ 调度器选中（evaluate=pass，且 gap/delay 已过）
            ├─ 配了 resolve ─▶ resolving（占 serial 槽，发起请求）
            │                    ├─ 返回 null/undefined 或抛错 ─▶ 移除（reason=empty）
            │                    ├─ 落地时 evaluate=drop ─▶ 移除（reason=capped）
            │                    ├─ 落地时 evaluate=wait ─▶ 退回 pending 重新排队
            │                    └─ 落地通过 ─▶ open
            └─ 否则直接 ─▶ open（markShown：记冷却、起 duration、登记 onShow、emit）
open ─ close() ─▶ closing（beforeClose 守卫通过后；清 duration；登记 onClose）
closing ─ autoRemove 定时 / remove() ─▶ closed（finalizeRemoved：登记 onRemove，result 兑现 {dismissed:true, reason}）

提交时若条目已 capped（session/total 永久耗尽），不入队、不展示，立即以 `reason=capped` 兑现（见 §5.1）。
```

要点：

- **overlap 不入队**：`open` 时一次性 `evaluate`，通过则直接 `openOverlap`（暂停中则进 `pendingOverlaps` 冻结），**不通过则立即丢弃**并以 `{dismissed:true, reason}` 兑现（条件/时间冷却不过为 `unmet`，session/total 耗尽为 `capped`）。持久化冷却尚未 hydrate 时不丢弃，进 `pendingOverlaps` 持有，hydrate 完成后再判。overlap 不走 `resolve`，也不占串行槽。
- **replace**：仅当替换者自己 `evaluate=pass` 且未暂停才生效；当前占用者若 `affix` 则不被顶掉（替换者进队首的 replace-jumped 带）；否则当前者被 `displace`（退回队列，从 open 态退回则重开豁免冷却）；closing 态的直接丢弃。
- **同 id 重开**：目标正在展示 → `discardActive` 丢弃旧实例（不回队列，旧 result 兑现 `reason=replaced`），新实例豁免冷却计数、跳过 gap，且槽空闲/未暂停/非 overlap 时直接接管（不经 `evaluate`）；目标在队列 → 覆盖队列里那条。无 `id` 时自动生成 `__layerman_auto_n`，跳过同 id 判定。
- **result**：`resolve(id,v)` / `reject(id,e)` 只投递结果、**不关闭弹层**（settled 与 phase 正交）；被动结束以 `{dismissed:true, reason}` 兑现，`reason` 的来源见 §5.2；已兑现则忽略。**N5**：`resolve/reject` 只对「曾经展示过」的条目生效（`enteredSeq !== 0`）；排队、`resolving` 尚未展示、overlap 被持有中的条目一律 no-op，不会提前兑现 result，之后它照常展示。
- **关闭握手**：`close` 带 `beforeClose` 时，守卫结果经 `Promise.resolve(...).then` 回调，**即使守卫同步返回 `true` 也要等微任务才进入 closing**（设计取舍，已文档化）；守卫返回 `false` 或抛错则取消。`remove/clear/destroy/条件失效撤下` 不过守卫。
- **autoRemove**：`true`=300ms，数字=自定义毫秒，`false`=纯手动，可按条目覆盖；`pause/pauseAll` 同时冻结 duration 与 autoRemove 两个倒计时。

## 5. 调度器与 `evaluate()`

**`schedule(slot)` 只标脏**：把 slot 加入 `dirtySlots`，由 batch 在最外层结束时统一调用 `scheduleNow(slot)`。`remove` 永远重调度所在 slot（即使移除的是队列项，也要清掉过期的开场计时器）。

`scheduleNow(slot)`：

1. 先清掉该 slot 的开场计时器；销毁中则返回；随后把队列里已 capped 的条目移除（`reason=capped`，见 §5.1）；再判断暂停 / 槽被占用 / 队列空，满足则返回。
2. 队列按 `cmpEntry` 排序：replace-jumped 带在前 → `priority` 降序 → `seq` FIFO。
3. 依序 `evaluate`，取第一个 `pass` 的作为 `front`（等待期**不锁定候选**，任何触发都会重选）。
4. `wait = front.skipGap ? 0 : max(0, (front.delay ?? gap) - (now - (lastClosedAt[slot] ?? startedAt)))`；`wait>0` 则起开场计时器（到点再 `schedule`），否则 `activate(front)`。
5. 有 `resolve` 的先占槽进入 `resolving` 再发请求；落地入口 `land` 只校验 abort 身份（`ac.signal.aborted` 或 `resolveState.abort !== ac` 即丢弃；`abort` 仅在 resolving 占槽期间存在，所有离开该状态的路径都会清掉它，故等价于槽位校验），晚到/被顶掉的结果丢弃（见 §7）；暂停期间落地的结果缓存，`resumeAll` 时再处理。

**`evaluate(entry, options)`**：统一的只读资格判断，返回 `pass | wait | drop`。非 `conditionsOnly` 时短路顺序固定：hydrate 门控 → capped → 条件 → 冷却。

- hydrate 门控（`wait` 的来源之一）：条目配了持久化冷却字段（`total/day/hour/minute/minGap`）且 `CooldownStore` 尚未 hydrate 完成，返回 `wait`。只配 `session` 或没有冷却的条目不受影响。
- capped（`drop`）：`isCapped(entry)`：未带 `exemptCooldown`、已 hydrate、且 `session` 或 `total` 已耗尽。`minGap/day/hour/minute` 到期会自行解除，**不**算 capped。
- 条件：`when(ctx)` 是唯一权威（配了就忽略 `route/requiresAuth`）；否则 `route`（字符串全等 / 数组包含 / 正则，先重置 `lastIndex`）AND `requiresAuth`（读保留键 `ctx.route/ctx.auth`）。`when` 抛错视为不满足（`wait`）。
- 冷却：`entry.cfg.cooldown` 存在、该条目未带 `exemptCooldown`，才查 `CooldownStore.canShow`，不过为 `wait`。
- `conditionsOnly`：已展示项只复检条件，跳过门控与 capped（`setContext` 的 `dismissWhenUnmet` 撤下用）。`ignoreConditions`：`resolve` 落地时 `dismissWhenUnmet:false` 的条目忽略条件、冷却仍复检。
- 调用点：`scheduleNow`、overlap 的 open 发射门、`replace` 资格、`finishResolve`、`resumePending`、`setContext`。同 id 重开接管路径刻意绕过它（但提交时仍会先做 capped 检查，且门控中的条目不直接接管）。

### 5.1 capped 流程（D3）与 hydrate 门控（D5）

- **capped 检查点**：`openImpl` 登记后立刻查；`scheduleNow` 每次先清队列里的 capped 项；`finishResolve` 落地复检（`evaluate=drop`）；hydrate 完成回调里对 `pendingOverlaps` 中的 capped 项清理，并重调度全部 slot；跨 Tab 广播合并后，暂停期间被持有且变为 capped 的 overlap 立即以 `capped` 兑现（不等 `resumeAll`）；`resumePending` 放行 overlap 时也区分 capped 与 unmet。命中即 `removeImpl(id, capped)`：不展示、不计数、不调用 `onShow`，result 兑现 `{dismissed:true, reason:'capped'}`。
- **不残留队列**：串行条目一旦永久受阻就被移除，而不是永远排队（对应不变量 i）。
- **冷却到期仍不自唤醒**：`minGap/day/hour/minute` 只算 `wait`，留队列，等下一次触发（不变量 7 不变）。
- **hydrate 门控**：`ready()` 的 Promise 结束（成功、失败、坏数据都算）后，在一个 batch 里 `schedule` 全部 slot、清理 capped 的持有 overlap、`resumePending()`。hydrate 前持有的条目（队列里的串行项、`pendingOverlaps` 里的 overlap）是合法状态（对应不变量 j：叠加等待项必须有「暂停」或「待 hydrate」之一的原因）。同 id 重开接管、`resume` 路径同样遵守门控。

### 5.2 `DismissReason` 的来源

`removeImpl(id, reason?)`：未显式给出时，`closing` 态的条目记 `closed`，其余记 `removed`；`finalizeRemoved` → `settleDismiss` 兑现 `{dismissed:true, reason}`。

| reason      | 路径                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `removed`   | 显式 `remove`，条目尚未进入 closing                                                                                                             |
| `closed`    | 仅「已展示条目经 `close` 进入 closing 后被 remove」（autoRemove 或手动）；`close()` 对排队/请求中条目是 no-op，不会走到这里                     |
| `cleared`   | `clear`（含选择器；`clearImpl` 非销毁时）                                                                                                       |
| `replaced`  | 同 id 覆盖旧实例（队列项、活跃项）；`replace` 丢弃 closing 实例                                                                                 |
| `unmet`     | `setContext` 触发的 `dismissWhenUnmet` 撤下；overlap 发射门不过（条件/时间冷却）；`resumePending` 放行时不合格且非 capped                       |
| `capped`    | session/total 永久耗尽：提交时、`scheduleNow`、hydrate 后、跨 Tab 广播合并后（暂停被持有的 overlap）、`finishResolve` 落地复检、`resumePending` |
| `destroyed` | `destroy` 清理（`clearImpl` 在 destroying 时）；销毁期间或之后的 `open()`                                                                       |
| `empty`     | `resolve(signal)` 后端返回 null/undefined 或抛错                                                                                                |

`DismissReason` 是 `as const` 对象加同名联合类型；`DismissResult.reason` 在类型上可选（兼容 `{dismissed:true}`），但内核所有被动结束路径都会带上。

## 6. 批处理与通知

所有公开变更方法都包进 `batch(fn)`，用 `depth` 计数嵌套。最外层（`depth===1`）的 `fn` 返回后进入排空循环，直到下面四项全空才退出：

- `dirtySlots`：待重评的 slot（`schedule(slot)` 只标脏；在批次外调用则自己开一个空 batch 触发排空）。
- `effects`：已提交状态对应的宿主副作用（`onShow/onClose/onRemove`、`abort.abort()`、`resumePending` 的接续）。
- `needEmit`：需要刷新快照（`emit()` 只置此标记，不立即通知）。
- `pendingListeners`：当前快照尚未通知到的订阅者。

**排空顺序**：先清空 `dirtySlots`（逐个 `scheduleNow`，期间可能再标脏，循环到空）→ 取**一个** effect 执行（`safeInvoke`，抛错被隔离）→ 没有 effect 时，若 `needEmit` 或还有 `pendingListeners`，就 `emitNow` → 回到循环头。因此钩子和 abort **后置**：都在状态提交之后、最外层调用返回之前执行。嵌套在钩子或订阅者里的公开调用，`depth>1`，只提交状态、标脏、登记 effect，并入外层批次；调用返回后立即读 `getSnapshot()/get()` 看到的仍是旧快照，新状态在外层下一轮排空时发布。

**`emitNow` 与 `pendingListeners` 接续（R1）**：`needEmit` 为真时重算快照（活跃项按 `enteredSeq` 排序，附 `stackIndex/isTopmost`）并把 `pendingListeners` 设为全体订阅者的副本，然后逐个通知；每通知一个，若又出现了 `needEmit / dirtySlots / effects` 就先中断，让排空循环处理完它们，再接着通知 `pendingListeners` 里剩下的订阅者。`needEmit` 为假时（只是标脏或登记了 effect）不重算快照，只接续剩余订阅者。结果：每个订阅者最终收到的都是与 `getSnapshot()` 同一引用的快照，不重复、不漏发；中途被取消订阅的订阅者会被跳过。

**destroy 顺序（R2）**：`destroyImpl` 在批次内摘除全部条目并置 `destroyed`；批次排空时先执行已登记的钩子，向订阅者发出最终的空快照（管理器本来就是空的则不通知），**排空循环结束后**才 `subscribers.clear()`（在 `batch` 末尾，不在 `destroyImpl` 里）。

**无变化不通知（N1）**：`clear()` 没有命中任何条目时不调用 `emit`，不通知；`update()` 对 `open/closing` 条目提交与现有数据逐键 `Object.is` 相同的补丁时直接返回，不通知（对排队/请求中条目本来就不 emit）。

**通知轮数上限 `MAX_NOTIFY_ROUNDS = 100`**：一次最外层调用内，「`needEmit` 触发的通知轮」**总共**最多 100 轮（含首轮，不是首轮之外再补发 100 轮；只接续剩余订阅者的不计轮）。第 101 次需要通知时：停止补发循环，排空剩余调度与副作用后，把**当时最新快照**（同一引用）向每个订阅者**最终扇出**一次；扇出期间订阅者再发起的变更只改状态、静默排空，不再通知；随后输出一次诊断（与 `debug` 无关：配置了 `logger` 走 `logger`，否则 `console.warn`；logger 抛错被隔离，没有 `console` 时跳过）。因此订阅者里的变更必须有收敛条件；合法但需要超过 100 轮才收敛的级联订阅者会被截断。

## 7. epoch 代次

`epoch` 是条目级整数，在条目「进入新一段生命」时递增：`activate`（有 `resolve`，进入 resolving）、`doOpen`（串行展示）、`openOverlap`（叠加展示）。它用来让**异步任务**识别「我是不是上一代的遗留」：

- **duration 计时器**：`armDuration` 捕获当时的 epoch，回调里不一致则丢弃，再校验 `byId.get(id)===e` 才 `close`。
- **beforeClose 决议**：`closeImpl` 调守卫前捕获 epoch；守卫 Promise 的 resolve 与 reject 回调里都先比对，不一致（期间条目被 replace 退回并重新展示等）就丢弃，一致才改 `close.pending` / 进入 `doClose`（还要求仍在 `byId` 且 `open`）。
- **autoRemove 计时器**：**不带 epoch 检查**，只靠 `byId.get(id)===e` 身份校验——它只在 closing 时启动，closing 不会回到 open（epoch 不会变），离开 closing 的路径（`removeImpl`、`discardActive`）都经 `detach → clearTimers` 清掉计时器。
- **resolve 落地**：**不用 epoch**，由 `land` 校验 abort 身份：每次请求有独立的 `AbortController`，`land` 在 `ac.signal.aborted` 或 `resolveState.abort !== ac` 时丢弃。`abort` 只在 resolving 占槽期间存在，`detach / doOpen / openOverlap / finishResolve 的 wait 分支` 都会清掉它。因此顶掉、移除、同一条目重新激活后晚到的旧结果都落不了地。落地后 `onResolved` 不再重复校验。

另：`detach` 统一清掉计时器、`abort`（并登记 `abort.abort()` 副作用）、缓存的请求结果、`resolvePatches` 与 `close.pending`。新增任何会改变 phase 或槽位归属的路径，都必须同样清理（对应检查器 e/c/d）。

## 8. D1 契约：判断函数内禁止修改管理器

`when`（及 `route` 谓词求值）期间 `judging` 计数 > 0。此时调用任何公开变更方法（`open/close/remove/resolve/reject/update/clear/setContext/pause*/resume*/destroy`）会在**改动任何状态前**抛 `[layerman] 条件求值期间禁止修改管理器`。该异常被 `conditionsPass` 捕获，结果是**该条件被视为不满足**（`debug` 下打一行日志）。只读方法（`getSnapshot/get/subscribe/ready`）不受限。生命周期钩子（`onShow/onClose/onRemove`）与订阅者里调用管理器**允许**，由 §6 的批处理兜底。

## 9. destroy 语义

`destroy()`：置 `destroying` → 清所有开场计时器与条目计时器 → `clearImpl({closeActive:true})` 摘除全部条目（每条登记 `onRemove`，result 兑现 `{dismissed:true, reason:'destroyed'}`）→ 关闭并解除 `BroadcastChannel` → 置 `destroyed`。外层批次排空时先执行已登记的钩子，再向订阅者发出**一次最终的空快照**（`active` 为空），**然后**才清空订阅者（`subscribers.clear()` 在 `batch` 末尾，不在 `destroyImpl` 里），之后不会再有任何通知。幂等。

之后：

- `open(...)` **不展示、不登记、不写存储**，直接返回 `{ id, result: Promise.resolve({dismissed:true, reason:'destroyed'}) }`。
- 其余变更方法（`close/remove/resolve/…/setContext`）全部 no-op；跨 Tab 广播消息被忽略。
- 注意判断期保护优先：求值期间调用 `destroy` 同样先抛 D1 错误。

## 10. 冷却存储（`CooldownStore`）

**配置**：`session`（仅内存）、`total`（累计）、`day/hour/minute`（本地自然日/时/分桶内计数）、`minGap: Duration`（滚动间隔，持久化 `lastShownAt`）。出现的字段全部 AND；计数在条目**真正 open 时**（`markShown`）+1。同 id 自更新重开、从 open 态被 replace 退回再展示的重开，都带 `exemptCooldown`，不重复计数。

**持久化**：`total/day/hour/minute/minGap` 的记录以**整张表**（`{id: CooldownRecord}` 的 JSON）写在 `storageKey`（默认 `layerman:v1`）下；表用 `Object.create(null)` 构造，id 为 `__proto__` 也安全。`session` 不落盘。

**写入串行（write-through）**：`flush()` 先置 `dirty`；`hydrated` 前、或已有写在途时只标脏不写。同一时刻最多一个在途写，完成（成功或失败都一样）后若有新变动就补写最新快照。存储异常、拒绝一律静默忽略，不阻断后续写。

**hydrate 合并**：`ready()` 返回的就是 hydrate 的 Promise。读到的 JSON 逐条走 `mergeRecord`（与广播同一入口）：不是对象/坏 JSON 整体忽略；**单条**不合法（计数不是非负整数、`lastShownAt` 非有限数、桶标签格式/真实日期不对）只丢那一条；与内存里已有的更新记录合并而不是覆盖。`hydrated` 之前发生的 `open` 只改内存，hydrate 结束后再统一 flush，因此**不会用只含新 id 的表整表覆盖磁盘历史**。持久化字段（`needsHydration`：`total/day/hour/minute/minGap`）在 hydrate 完成前由 `evaluate` 门控为 `wait`，所以这些条目不会在 hydrate 前展示；`isCapped` 只在 hydrate 之后才可能为真。存储 `get` 的 Promise 必须最终 settle，否则门控条目永远等待。

**桶合并规则**（`mergeRecord`/`mergeBucket`）：`total` 取 max；`lastShownAt` 取 max；每个桶字段——同桶取 max 计数，跨桶取 `lastShownAt` 更新的一方（不依赖标签字典序，兼容时钟回拨/DST）。

**跨 Tab（`crossTab`）**：通道 `BroadcastChannel('${storageKey}:sync')`，消息 `{id, rec}`；收到后 `mergeRemote` 再重调度所有 slot。**没有用 `storage` 事件，也不依赖任何存储库。**

- 默认值：`BroadcastChannel` 与 `window` 同时存在才开（浏览器开；Node/SSR 默认关）。显式 `crossTab:true` 且有 `BroadcastChannel` 时才创建；通道会尝试 `unref?.()`，避免 Node 下挂住进程。
- 语义是**最终一致**：两个 Tab 在广播送达前同时 open，各自都会通过；不提供严格的全局额度（要做就得上 Web Locks 一类，见文末）。
- 关闭 `crossTab`（或环境不支持）时，各 Tab 持有各自的内存快照，**后写的 Tab 会整表覆盖先写的**，其他 Tab 的新增计数可能丢失。
- `mergeRemote` 只合并进内存，不立即写盘，下次本 Tab 有写入时才随整表落盘。

## 11. 内部不变量检查器与 fuzz 体系

**`checkInvariants()`**：`LayermanImpl` 的**私有只读**诊断方法，不进公共类型，不被生产路径引用（带 `@ts-expect-error`），测试经类型转换调用。不求值宿主谓词、不触发通知或调度。失败抛 `[layerman] invariant <code>: id=… …`。编号：

| 码  | 检查                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a   | 每个 `byId` 条目恰好属于一个容器；`byId` 键与 `entry.id` 一致                                                                                                                       |
| b   | 容器内条目满足 `byId.get(e.id) === e`（否则是游离条目/僵尸）                                                                                                                        |
| c   | 容器与 phase 一致：队列/`pendingOverlaps` 为 pending；serial 为 resolving/open/closing；overlap 为 open/closing 且 `overlapping` 为真                                               |
| d   | serial 的 key 与 `entry.slot` 一致                                                                                                                                                  |
| e   | 计时器与 phase 一致：`durationTimer`⇒open 且未暂停；`autoRemoveTimer`⇒closing 且未暂停；`*Remaining`⇒暂停中；`abort`⇒resolving；`close.pending`⇒open；`hasPendingResolve`⇒resolving |
| f   | `openTimers` 里的 slot：未暂停、`serial` 无占用、队列非空                                                                                                                           |
| g   | `snap.active` 的身份（id+instanceKey）与顺序等于由容器推导的结果                                                                                                                    |
| h   | `destroy` 之后所有容器为空、没有开场计时器                                                                                                                                          |
| i   | 等待容器（队列 / `pendingOverlaps`）里不得有永久耗尽（capped）的条目                                                                                                                |
| j   | `pendingOverlaps` 里的条目必须有「暂停中」或「尚未 hydrate」的原因                                                                                                                  |

**测试体系**（`pnpm test`：13 文件，844 passed，无 expected fail）：

- `test/layerman.test.ts`：核心行为（68）。`coverage-core.test.ts`、`coverage-adapters.test.ts`：覆盖率补充。
- `test/invariants.test.ts`：检查器本身 + **反向破坏用例**（直接改内部字段，断言检查器能抓到）+ 阶段修复的回归。
- `test/fuzz.test.ts`：**固定种子**（内联 `mulberry32`，零依赖）随机序列：4 个 id × 2 个 slot，每个种子 60 步，主序列使用固定种子集；操作池含 open（queue/replace/overlap/affix/backend/duration/cooldown/各种 beforeClose）、close、remove、clear（对象/选择器）、update、setContext、pause/resume、pauseAll/resumeAll、推进计时器、resolve/reject、destroy。每步后调 `checkInvariants()` 并校验模型不变量（result 至多兑现一次、onRemove 至多一次且与 onShow 配对、暂停期不新增 active、destroy 后全部兑现、慢 hydrate / 失败 / capped / 未展示投递的模型检查等）；末尾有「操作池与配置分支覆盖计数」用例。**重入随机源**独立（`callbackRandom`，开关 `ENABLE_REENTRANT_SUITE`，当前 `true`，另有独立种子集）：在钩子里随机 `remove/setContext/clear/open`。失败时抛出带 `seed` 与完整操作日志的错误，可按种子重放。
- `test/regressions.test.ts`：终审缺陷安全网。**约定**：尚未修复的缺陷用 `it.fails` 描述**修复后**的行为，修好后翻成 `it`。当前**没有** `it.fails`：此前的 N2/D5（hydrate 门控）、N3/D3（capped）、N5（未展示条目忽略 resolve/reject）均已实现并转为普通 `it`。
- `test/cooldown-store.test.ts`：写串行、记录校验、hydrate 合并、存储降级、桶合并。
- `test/adapters-contract.test.ts`：四个适配器共用一份契约；各适配器自有测试 `vue/react/svelte/solid.test.ts`；`types.test.ts` 类型级。

## 12. 适配器桥接与共同形状

四个适配器都是**薄桥**：核心 `subscribe + getSnapshot` → 各框架的响应式原语，不含任何渲染组件、不依赖框架编译器。共同形状：

- `useOverlayState` / `useOverlays` → `active`、`queued`
- `useOverlay(id, defaults?, om?)`（Svelte 为 `overlay(...)`）→ `{ instance, visible, phase, open, close, remove, resolve, reject, pause, resume }`；`defaults` 合并进**每次** open，`open(config)` 再覆盖；`id` 恒以 hook 的为准
- 管理器取得 = **默认注入 + 参数覆盖**：显式 `om` 优先，否则回退到注入实例，都没有则抛错
- 「当前 overlay」：中央渲染器逐条提供 id，组件内 `useCurrentOverlay()` 零透传取自身句柄

| 适配器             | 桥接原语                                                                                          | 注入                                                      | 备注                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Vue (`/vue`)       | `shallowRef`，`onScopeDispose` 退订（无活跃 effect scope 直接抛错，避免泄漏）                     | `createLayermanPlugin` / `provideLayerman`                | 额外 `model: WritableComputedRef<boolean>`                                                                         |
| React (`/react`)   | `useSyncExternalStore`（带 `getServerSnapshot`，抗 tearing、SSR 安全）                            | `LayermanProvider` / `createLayermanProvider`             | 当前 overlay：推荐 `CurrentOverlayProvider`（大写，可直接用于 JSX）；`provideCurrentOverlay` 是 `@deprecated` 别名 |
| Solid (`/solid`)   | `createSignal` + `onCleanup`；派生用普通访问器而非 `createMemo`（SSR 构建下 `createMemo` 会冻结） | `LayermanProvider`（Context.Provider）/ `provideLayerman` | 没有 `useLayerman`                                                                                                 |
| Svelte (`/svelte`) | Svelte store 契约 `readable` / `derived`（4/5 通用，不依赖 runes）                                | `setLayerman` / `getLayerman`                             | `setContext/getContext` 只能在组件初始化期调用，否则显式传 `om`                                                    |

**Vue `model` 的关闭契约**：`get` = 是否 open/closing；`set(true)` = 未展示、未排队、且没有在途 open 时才 `open()`（用本地 `opening` 闩锁挡掉 resolving 期间的重复 `set(true)`）；`set(false)`：已展示 → 调 `close()`，**订阅状态，等同一 `instanceKey` 进入 closing 再 `remove()`**（无 `beforeClose` 时同步完成，有则等守卫决议）；守卫返回 `false`/抛错取消订阅、实例被替换也取消订阅，不会误删新实例；仍在排队 → 直接 `remove()`。带 `beforeClose` 的 `close()` 总是异步进入 closing，所以此时 `model` 不会立刻变 `false`。

## 13. 未实现 / 待拍板（不是现有行为）

已实现并从本节移走的：D3（capped 与 `DismissResult.reason`，见 §5.1/§5.2）、D5（hydrate 门控，见 §5.1/§10）、N5（`resolve/reject` 对未展示条目 no-op，见 §4）。

以下仍**未实现**，代码里没有对应物：

- **D2 冷却计数时机**：现为「open 即计数」，未提供渲染确认后计数（visible 计数 / `confirmShown`）。
- **D4 冷却到期自唤醒**：没有 slot 级唤醒计时器；做了会推翻「冷却到期不是唤醒触发」这条不变量。
- **业务 gate / verdict API**、**ticket**：未做。
- **R4 根治方案**：核心 `close()` 返回 `Promise<boolean>`（让适配器不必订阅状态等 closing）；目前 Vue `model` 靠订阅 `instanceKey` 进入 closing 的间接方案。
- 不做的事：业务 gate/verdict API、严格全局跨 Tab 额度（Web Locks）、存储版本包络、Clock 抽象、按职责拆多个类。

## 参考

- [README.md](./README.md) / [README.zh-CN.md](./README.zh-CN.md)
- [源代码](./src)、[测试](./test)、[原始设计 design.md](./design.md)
