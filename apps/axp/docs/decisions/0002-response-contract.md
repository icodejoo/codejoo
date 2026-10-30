---
title: axp 响应契约精简：HTTP 状态与内核失败事实
status: active
updated: 2026-10-29
summary: 记录终审时用户拍板的四字段响应契约、内核失败标记、业务风格配置与 parse 扩展点，取代 0001 的相关条款
---

## TL;DR

> 2026-10-29 更新：接口可选字段、原生诊断数据、完整 request 与失败标记 error 的相关条款已被 [0003 原生诊断数据移入上下文](0003-native-data-on-ctx.md) 取代。本文保持 active，其余决定继续有效。

- 必需字段只留 `ok`、`status`（HTTP）、`code<C>`、`data`；message 留在默认类，原生诊断数据按 [0003](0003-native-data-on-ctx.md) 管理。
- `kind` 改为内核私有的失败事实，使用者不能填写；读取用 `failureOf`，取消用 `api.isCancel`。
- 不再把业务码转换为逻辑状态。业务风格由使用者配置判定回调，撤回 0001/O5 的“业务风格零适配”。
- 业务风格用客户端选项 `statusOf(r) => number` 给出“有效状态”，`ctx.statusOf(r)` 供 retry、auth 默认规则读取；`r.status` 仍是 HTTP 状态（2026-10-30 补）。
- 默认类通过 `parse(body, raw)` 适配响应体，工厂通过 `type` 接受子类，也保留接口实现的 `create` 路径。

## 背景与范围

2026-10-29 终审中，用户在三次拍板后确定此契约。以[终审报告 §4](../reports/2026-10-29-final-review.md#4-设计取舍2026-10-29-已拍板)的后续结论及源码为准。

本决策取代 [0001 D3、D5](0001-core-redesign.md) 中关于 `kind`、逻辑状态和成功扩展点的部分；D4、D6 中对应字段的写法也按本决策解释。0001 保持 active，洋葱管线、阶段排序、归一化与落定分离、失败抛 R 和 bug 抛原始异常的决定继续有效。

## 决定

### 使用者只负责业务转换

`IAxpResponse<D, C extends string | number = number>` 的必需字段为 `ok: boolean`、`status: number`、`code: C`、`data: D`。`status` 是 HTTP 状态，无响应时为 0；缺业务码为 0，缺数据为 null。原“可选字段为 message?/raw?/error?”条款已被 [0003](0003-native-data-on-ctx.md) 取代：接口只声明这四个字段，message 留在默认类；原生对象默认由 ctx 持有，仅请求级 raw 开启时附到响应副本。

`request`、`stack`、`toJSON`、`parse` 只属于默认类 `AxpResponse`，不要求接口实现者提供。默认 message 为空串，也允许 null。

request 的完整配置语义已被 [0003](0003-native-data-on-ctx.md) 取代：默认仅保留 method、url，开启 raw 后才在副本上附完整配置，raw 开启时由内核把 raw/error/request 附到任意 R 的副本上；brandResponse 不再为接口实现补 message。

HTTP 失败、业务失败通过 `ok`、`status`、`code` 表达，不再由使用者填写 `kind`，也不再提供 `AXP_KINDS`、`httpStatus` 或响应顶层的 reason。

### 内核负责失败事实

内核在传输边界及 `ctx.fail({ failure, reason, from })` 判定取消、超时、网络、解析、鉴权和程序异常。在响应工厂返回后，通过不可枚举的 `AXP_FAILURE` 写入事实，并强制 `ok === false`，用户的 getter 不能把内核失败改成成功。

原“`failureOf(r)` 只读返回 `{ type, reason? } | undefined`”条款已被 [0003](0003-native-data-on-ctx.md) 扩展取代：公开导出的 `IAxpFailure` 增加仅供 internal 保留原始异常的 error 字段，以 `failureOf(r)?.error` 读取；`toJSON` 中 failure 仍只投影 `{ type, reason }`。类别常量是 `AXP_FAILURES`；取消判断用 `isAxpCancel(e)` 或 `api.isCancel(e)`。工厂负责转换和构造，不负责重新解释这些内核事实。程序异常仍以 internal 标记穿过管线收尾，在落定时抛原始异常。

### 取消逻辑状态，显式配置业务风格

HTTP 200 加业务码 401 仍是 `status === 200`。`r.status` 不被改写。auth 默认读 `ctx.statusOf(r)` 的 401、403，retry 默认按 `ctx.statusOf(r)` 及内核网络/超时失败判定；未配置 `statusOf` 时有效状态等于 HTTP 状态。

使用者最省事的做法是配置 `createAxp({ statusOf })`，把业务码映射成有效状态，例如 `(r) => (r.status === 200 && Number(r.code) !== 0 ? Number(r.code) : r.status)`；`statusOf` 是纯函数，抛错按程序 bug 处理。也可以用 auth 的 `onFailure`、retry 的 `shouldRetry` 和 `respectRetryAfter` 逐项适配，或者写子类集中配置。只改响应的 `ok` 不会把业务码转换成插件的规则。这一条补充而不推翻本节“不改写 status、不自动转换业务码”的决定：不配置 `statusOf` 时行为与此前一致。完整用法放在 [README 的业务风格示例](../../README.zh-CN.md#使用警告与业务风格)。

### 解析钩子与构造路径

默认类提供受保护的 `parse(body, raw)`，返回业务字段；基类补默认值，默认成功规则为 HTTP 2xx 且 code 为 0 或 `'0000'`。字段名或业务协议不同就覆盖 parse，用 `axpResponse({ type: MyResponse })` 接入；成功规则不同覆盖 ok。删除 `envelope` 选项，保留 `expectJson`。

也可以直接实现接口，通过 `axpResponse({ create })` 构造对象，内核补品牌和缺失业务字段。缓存命中时从快照经同一工厂重建，业务扩展字段从 init 恢复；此时没有原始 raw。

## 理由

- 响应对象负责转换，库不猜后端协议。HTTP 状态和业务码各有一个明确含义，排错时不用追查状态被谁改写。
- 把内核分类交给使用者填写，填错会影响重试、刷新和 bug 透传。由内核保存事实，才能保护这些边界。
- 四个必需字段足以让插件协作；接口实现者不必补齐默认类的诊断能力。
- parse/type 与 create 两条路径分别照顾继承和纯对象实现，不需要继续堆字段映射选项。

## 放弃的方案

- 保留公开 `kind` 并自动推导：接口实现者仍要承担内部枚举，业务与传输事实仍然混在一起。
- 保留逻辑 status，把 HTTP 200 加业务码 401 视作 401：能少写配置，但默认实现绑定了某一种后端约定。
- 扩大 `envelope` 字段映射配置：处理不了协议转换与复杂成功规则，继续交给 parse 更直接。

## 代价与迁移

明确撤回 0001 的“业务风格零适配”。使用者和验收执行器都需要配置业务码判定；旧 `r.kind`、`r.httpStatus`、逻辑状态和 `envelope` 用法需要迁移，见[迁移指南](../guides/migrating-to-pipeline.md#020-终审后的变化)。自定义缓存仓也需要保存快照，而不是活的响应实例。

接口更小，但内核要额外保护标记与 ok，工厂和缓存重建也要保留缺省值及扩展字段。这些成本由库承担，避免每位使用者重复实现。
