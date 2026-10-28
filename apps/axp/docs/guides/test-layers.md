---
title: axp 测试六层分类、去重与迁移映射规范
status: draft
updated: 2026-10-27
summary: 测试用例按单元/规则/边界/组合/集成/验收矩阵六层归档的判定规则、目录命名、去重原则和旧→新映射的记录规则。
---
## TL;DR

- 六层自底向上：**单元 → 规则 → 边界 → 组合 → 集成 → 验收矩阵**。一个行为只在**最低的、能证明它的那一层**测一次。
- 按"测什么"分层，不按"从哪来"命名：`*.review`、`dioman-*` 这类来源补丁文件迁移后不再存在。
- 用例标题以 `[API id]` 开头，id 与 testkit 的覆盖台账同一套，台账脚本可据此统计单测层覆盖。
- 去重靠"同层同 id 同输入同期望"判重；验收矩阵层允许与下层语义相同，但必须登记 `mirror`。
- 每次迁移同一提交更新 [旧→新映射](../reference/test-migration-map.md)；先搬后改，分两次提交。

## 1. 六层定义

| 层 | 测什么 | 不测什么 | 依赖 | 目录 |
|---|---|---|---|---|
| 单元 `unit` | 单个纯函数、类、对象（`helper`、`objects/*`、`TokenManager`、`Bag`、工具函数） | 插件行为、axios 实例 | 无 axios 实例、无网络仿真 | `test/unit/` |
| 规则 `rule` | **单个插件**对外 API 的契约行为：每个选项、请求级开关、回调、导出函数的**正常路径与声明过的行为** | 极端输入、其它插件 | `Axp` + `makeNetwork` 假 adapter | `test/rule/` |
| 边界 `boundary` | **单个插件**规则的边缘与反例：0/负数/空/超大、`undefined`、竞态与时序、取消时机、容量溢出、异常回调 | 两个插件的交互 | 同规则层 | `test/boundary/` |
| 组合 `combo` | **两个及以上插件**的语义交互：顺序、互相覆盖、状态传递、重放/重发时开关是否保留；含 powerset 扫描 | 单插件自身行为、装配细节 | 同规则层，装多个插件 | `test/combo/` |
| 集成 `integration` | **装配与真实环境**：`Axp.create`/`install` 顺序、类型回归（`expectTypeOf`）、真实 axios adapter、`dist` 产物、`e2e` 页面 | 单个行为的细节 | 真实 axios / 构建产物 / 浏览器 | `test/integration/`、`e2e/` |
| 验收矩阵 `acceptance` | **黑盒**：testkit 场景 × 网络 × 风格 × adapter，真实服务器 + netem | 白盒内部状态 | api-ws-demo、netem | `accept/` + testkit 场景 |

不属于六层的两类：
- `accept/unit/*`：验收**执行器自身**的单测（loader、classify、mapping…），归"工具自测"，保持原位。
- `test/helpers/*`：测试支撑代码，不放用例。

### 判定顺序（从下往上，命中即停）

1. 只用一个对象/函数就能证明？→ **unit**
2. 一个插件、声明过的正常行为？→ **rule**
3. 一个插件、极端输入或时序？→ **boundary**
4. 两个及以上插件的交互？→ **combo**
5. 装配、类型、产物、真实浏览器？→ **integration**
6. 必须真实服务器或网络条件才成立？→ **acceptance**

边界与规则的区分：**文档或类型里写明的行为归规则，文档没写、靠"推一推"才暴露的归边界。** 拿不准放规则。

## 2. 目录与命名

```
test/
├── unit/          <模块>.unit.test.ts            例：token-manager.unit.test.ts
├── rule/          <插件>.rule.test.ts            例：retry.rule.test.ts
├── boundary/      <插件>.boundary.test.ts        例：cache.boundary.test.ts
├── combo/         <a>+<b>[+<c>…].combo.test.ts   插件名按字母序，可多段；例：auth+retry.combo.test.ts、cancel+key+share.combo.test.ts
│                  powerset.combo.test.ts         全插件幂集扫描
├── integration/   <主题>.integration.test.ts     例：install-order.integration.test.ts
└── helpers/       不放用例
e2e/               浏览器端到端（playwright），保持现状
accept/            验收执行器；场景在 testkit
```

- 文件名只写**主题**，不写来源（不出现 `review`、`coverage`、`dioman`、`fix` 等字样）。
- 一个文件 ≤ 约 400 行；超过按主题拆，如 `retry.rule.test.ts` → `retry.rule.delay.test.ts`。
- `vitest` 的 include 用 `test/**/*.test.ts`，不需要为分层改配置；想单独跑一层用目录过滤：`vp test test/rule`。

### 用例标题约定

```ts
describe('retry', () => {
  it('[retry.opt.max] 超过 max 次后停止并抛出最后一次错误', () => { … });
  it('[retry.req.retry=false] 请求级关闭后不重试', () => { … });
});
```

- 标题以 `[API id]` 开头，id 取自 testkit 覆盖台账（`testkit/coverage/axp-api.json`）。一条用例涉及多个 API 时写多个：`[retry.opt.max][retry.opt.delay]`。
- 组合层用 `[a.opt.x × b.opt.y]`，如 `[retry.opt.max × cache.req.cache]`。
- unit 层没有台账 id 时写 `[模块.函数]`，如 `[TokenManager.clear]`。
- 没有 id 的用例允许存在，但迁移时要在映射里标注，后续由台账补 id。

## 3. 去重规则

1. **单一归属**：同一个行为只在最低的、能证明它的层写一次。上层只测下层测不到的**新增性质**。
2. **判重标准**：同层 + 同 API id + 同输入 + 同期望 = 重复，删后者。同 id 不同输入是变体，保留；变体多时用 `it.each` 合并。
3. **跨层重复**：同一断言出现在多个层，保留最低层，高层删除，或改成只验证上层新增的性质（例：规则层已证明 `max` 生效，组合层只证明"装了 cache 之后 `max` 仍生效"）。
4. **验收矩阵层例外**：黑盒场景允许与 rule/combo 语义相同，因为它独有"真实服务器、跨 adapter、跨网络"的价值。但必须在映射表里登记 `mirror`（见 §4），不算重复，也不能互相替代。
5. **补丁文件并入**：`*.review.test.ts`、`dioman-coverage`、`dioman-powerset` 按内容拆进对应层与文件，用 `git mv` / 拆分时保留历史。
6. **it.skip 处理**：有 axp 对应 API 但暂缺实现 → 保留，写原因，并在映射里标 `skip`；axp 根本没有对应 API（如 dioman 的 `registerDownstreamSettler`）→ 不留 skip，映射里标 `N/A` 并写原因，用例删除。
7. **删除必须有依据**：`drop` 必须指向保留的那条用例（新位置全名），否则不许删。

## 4. 旧 → 新映射记录规则

记录文件：[test-migration-map.md](../reference/test-migration-map.md)。

### 每条记录

| 字段 | 含义 |
|---|---|
| 旧位置 | `文件::describe > it` 全名（迁移前的路径，不改写） |
| 新位置 | `层/文件::describe > it` 全名；`drop`/`N/A` 时写保留者或 `—` |
| 动作 | `move` 原样搬 / `rename` 改标题 / `merge` 多合一 / `split` 一拆多 / `drop` 重复删除 / `N/A` 无对应 API / `skip` 暂缺保留 |
| 依据 | 为什么落在这一层；`drop`/`merge` 写明保留者与相同点；`N/A` 写原因 |
| mirror | 对应的验收场景 id（若有），无则留空 |

一对多、多对一就写多行，旧位置或新位置重复出现即可。

### 流程规则

1. **冻结基线**：迁移开始前记录 `用例总数` 与 `通过数`（`vp test` 输出），写在映射文件头部。基线在所有进行中的修复合入后再冻结，迁移期间不并行改动测试。
2. **分批迁移**：按插件或按层分批，每批一个提交，**同一提交更新映射**。
3. **先搬后改**：迁移提交只允许移动、改名、改标题、拆合文件，**不改断言内容**；断言要改另起提交，避免"搬了又改"无法审计。
4. **核对公式**：每批结束核对
   `新总数 = 旧总数 − drop − N/A − (merge 合并减少数) + split 增加数 + 新增用例`，
   不平就是漏记或误删，不许提交。
5. **通过数不降**：每批迁移后 `vp test` 全量通过，通过数不低于该批开始前减去 `drop`/`N/A`/`merge` 的数。
6. **保留历史**：搬文件用 `git mv`，拆合文件在提交信息写明来源。
7. **映射永久保留**：迁移完成后映射文件状态改为 `archived`，不删；后续新增用例不必补映射，只有再次迁移才续写。

## 5. 与覆盖台账的关系

- testkit 的 `COVERAGE.md` 目前只统计**验收场景**对 API 的触达。标题带 `[API id]` 后，台账脚本可再扫描 `test/` 统计单测层覆盖，在明细里分列 `rule / boundary / combo / acceptance` 四列。该脚本扩展不在本规范范围，迁移完成后另做。
- "100% 覆盖"的口径：**每个 API 至少一条 rule 用例 + 一条 boundary 用例**（或写明"无边界"的理由），再加台账里标出的有交互风险的 combo 对；验收矩阵是在此之上的黑盒复核，不替代下层。

## 6. 迁移顺序

1. 等当前 B1~B5 缺陷修复合入，冻结基线。
2. 起映射文件，按 §3 判定每个现有文件的目标层（初步归属见下，迁移时逐用例复核）。
3. 先迁**纯搬运**的文件（单插件的 `*.test.ts` → `rule/`），再拆 `*.review`、`dioman-*`，最后处理 integration。
4. 迁移完成后，再依据台账缺口**补**缺失的 rule/boundary/combo 用例。补用例与迁移分开提交。

### 现有文件初步归属

| 现有文件 | 初步去向 | 备注 |
|---|---|---|
| `auth.test.ts`、`retry.test.ts`、`loading.test.ts`、`share.test.ts`、`cache.test.ts`、`mock.test.ts`、`repath.test.ts`、`filter.test.ts`、`cancel.test.ts`、`normalize.test.ts`、`notify.test.ts`、`envs.test.ts`、`key.test.ts` | `rule/<插件>.rule.test.ts` | 其中的极端/时序用例逐条挑出放 `boundary/` |
| `cache.review.test.ts`、`key.review.test.ts`、`share.review.test.ts` | 拆进对应插件的 `rule/` 与 `boundary/` | 标题里的 `#11` 等 review 编号保留在注释 |
| `dioman-coverage.test.ts`（48） | 按内容拆进各插件 `rule/`、`boundary/` | `it.skip` 按 §3.6 处理 |
| `dioman-powerset.test.ts` | `combo/powerset.combo.test.ts` | |
| `auth.integration.test.ts`（21） | 拆：单插件行为进 `rule/auth`，`auth+retry`、`auth+cache` 等进 `combo/` | 名叫 integration，实质多是组合 |
| `integration.test.ts` | 逐条判：多插件语义交互进 `combo/`，装配类进 `integration/` | |
| `attempt.test.ts`、`adapter-layers.test.ts` | `combo/`（auth+retry）、`integration/`（adapter 分层） | 复核 |
| `axp-install.test.ts`、`types.test.ts`、`e2e.test.ts` | `integration/` | |
| `accept/unit/*` | 不动，归"工具自测" | |

## 7. 待你确认的默认值

文档按下面的默认值写，不反对就按此执行：

1. `accept/unit` 不计入六层，保持原位。
2. 映射用 Markdown 表，不上 JSON/生成脚本（量级约 600 行，够用）。
3. 用例标题统一加 `[API id]` 前缀。
