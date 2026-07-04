# @codejoo/overlaymanager

框架无关的 **headless** overlay 队列管理器,适用于 dialog、modal、bottomsheet、drawer、toast。
它只负责「**该显示哪个 / 何时显示**」——串行「一次一个」队列、命名 slot、优先级 /
replace / overlap / affix、按弹窗的条件与冷却、后端数据驱动的异步取数、命令式 promise 结果、
两阶段关闭——**不渲染任何 UI**。渲染由你完成;本包是**零运行时依赖**的纯逻辑。

> English docs: [README.md](./README.md)。

## 安装

```bash
pnpm add @codejoo/overlaymanager
# 可选的 Vue 3 接入层在 /vue 子路径(vue 为可选 peer 依赖)
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
- **`overlap`**:**完全绕过串行队列,立即叠加显示**——用于无条件的紧急弹窗(全局错误、关键告警、阻塞 loading)。因为 overlap 弹窗**根本不入队**,它的条件/冷却只是 `open` 时的**一次性发射门**:通过 → 立即显示;**不通过 → 请求被丢弃**,`result` 兑现 `{ dismissed: true }`(不触发 `onShow`/`onClose`)。它是**「要么现在,要么不弹」**——没有队列能把它留到条件满足。

所以 `overlap` 会「丢弃」正是因为它**主动放弃了队列**:一个不排队、又不允许当下显示的弹窗,丢弃是唯一自洽的结果。若你要「**等条件满足后再显示**」,那正是队列的职责——用普通或 `replace` 弹窗(它们会等)。**别给 `overlap` 弹窗加可延迟的条件(`route`/`when`)**指望它被保留;但 `overlap` 加 cooldown 是合理的(能正确抑制「今天已弹过」)。

## 快速上手

```ts
import { createOverlayManager } from "@codejoo/overlaymanager";

const om = createOverlayManager({ gap: 300 });
await om.ready(); // 等冷却状态从存储 hydrate

const unsub = om.subscribe((state) => render(state.active)); // active 就是你要渲染的列表

// 入队,返回可 await 的句柄
const { id, result } = om.open({ id: "welcome", data: { text: "你好" } });

// 命令式结果:由你的 UI 通过 resolve 投递
const ok = await om.open({ id: "confirm", data: { msg: "确定删除?" } }).result;
// ok 是你的 UI 传给 om.resolve("confirm", ...) 的值,或 { dismissed: true }

om.close("welcome"); // → phase "closing";autoRemove(默认 300ms)后移除并推进
```

## Vue 3 接入

`/vue` 子路径是一层薄薄的响应式桥接——**只提供 composable,不含组件**。

```ts
// overlay.ts —— 全局创建一次
import { createOverlayManager } from "@codejoo/overlaymanager";
export const om = createOverlayManager();

// main.ts
import { createOverlayManagerPlugin } from "@codejoo/overlaymanager/vue";
await om.ready();
app.use(createOverlayManagerPlugin(om)); // 全应用注入默认实例(也可每次调用显式传 om)
```

管理器实例遵循「**插件默认 + 参数覆盖**」:给任意 composable 传 `om` 即优先用它,不传则回退到
`createOverlayManagerPlugin` / `provideOverlayManager` 注入的实例。

### 风格 A —— 命令式 + 中央渲染器 `<OverlayHost>`

弹窗把要渲染的组件放进 `data`,一个全局 host 遍历 `active` 渲染:

```vue
<!-- OverlayHost.vue —— 挂在 App 根部,全局唯一 -->
<script setup lang="ts">
import type { Component } from "vue";
import { useOverlays } from "@codejoo/overlaymanager/vue";
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

const ok = await om.open({
  id: "confirm-delete",
  data: { comp: ConfirmDialog, props: { message: "确定删除这一项?" } },
}).result;
if (ok) doDelete();
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
import { useOverlay } from "@codejoo/overlaymanager/vue";

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
const claimed = await promoRef.value.open({ priority: 10, cooldown: { day: 1 } });
```

`useOverlay(id, defaults?, om?)` 返回 `{ instance, visible, model, phase, open, close, remove,
resolve, reject, pause, resume }`(`defaults` 见下)。

**中央渲染器(风格 A)**:用小组件包裹每个渲染项、在其 setup 调 `provideCurrentOverlay(o.id)`,则 overlay
组件内部可用 `useCurrentOverlay()` 零透传拿到自身 `{ close, resolve, data, … }`。把组件放进 `data` 经
`<component :is>` 渲染时,用 `markRaw(Component)` 包一下,避免被转成响应式代理。

### 只暴露 `v-model` 的第三方弹窗

很多 UI 库(Element Plus、Vant、Ant Design Vue……)的可见性**只暴露 `v-model`**,你改不了它的
API。用可写的 `model`:

```vue
<script setup lang="ts">
import { useOverlay } from "@codejoo/overlaymanager/vue";
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

`model` get = 「是否在显示」;`set(true)` = `open()`;`set(false)` = **立即 `remove()`**(弹窗自带退场
动画,立即移除可避免 v-model 回弹)。

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
- **有条件的弹窗**:别依赖 `v-model`。要么把门控算在你自己这边、绑 `v-model="wanted && canShow"`;
  要么用 `open()` 触发、用 **`visible`** 渲染(`visible` 能如实表达「已入队但还没显示」的中间态,不会回弹)。

一句话:把 manager 的条件/冷却当作**队列门控**用(配 `open()` + `visible`),而不是硬塞进 v-model 的同步布尔。

## 验收 / 开发

```bash
pnpm test    # vitest(~91 用例:核心 + Vue/React/Svelte/Solid 适配层 + 类型级)
pnpm check   # oxfmt --check + type-aware oxlint
pnpm build   # vp pack → dist/esm(index + vue/react/svelte/solid 多入口)
```

## React / Svelte / Solid

同样的适配层形态也提供给其他框架(各为可选 peer 依赖、核心零依赖不含任何框架):

- **`@codejoo/overlaymanager/react`** —— `useSyncExternalStore`(SSR 安全):`useOverlays`、`useOverlay(id, defaults?, om?)`、`OverlayManagerProvider`/`useOverlayManager`、`useCurrentOverlay`。
- **`@codejoo/overlaymanager/svelte`** —— `svelte/store` readable(兼容 4/5):`overlayState`、`overlays`、`overlay(id, defaults?, om?)`、`setOverlayManager`/`getOverlayManager`。
- **`@codejoo/overlaymanager/solid`** —— signal:`useOverlayState`、`useOverlays`、`useOverlay(id, defaults?, om?)`、`OverlayManagerProvider`/`useOverlayManager`。

各自返回 `{ instance, visible, phase, open, close, remove, resolve, reject, pause, resume }`(Vue 另有可写 `model` 供 v-model)。另有 Flutter 版在 `dart-labs/overlaymanager`(拥抱 Flutter 的 `Overlay`,`show()` 返回 `Future<T?>`)。

## License

MIT
