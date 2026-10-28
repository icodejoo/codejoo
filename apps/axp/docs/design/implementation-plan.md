---
title: axp 洋葱管线重构实施计划（Codex 实现、Claude 终审）
status: draft
updated: 2026-10-28
summary: 重构分几批做、每批改哪些文件、交付什么、怎么验收，以及 Codex 派发约束和评审关卡
---
## TL;DR

- 在新分支上分 8 批（B0–B7）推进，每批结束时 `vp test` 全绿，Codex 先自审，Claude 终审后再进入下一批。
- 顺序：基线 → 内核 → 无状态插件 → retry/auth → source 三件套 → 测试收尾 → 文档与产物 → 验收。
- Codex 只写代码不提交；提交和分支操作由主会话做。
- 依据：[决策 0001](../decisions/0001-core-redesign.md)、[核心架构](core-architecture.md)、[插件规格](plugin-spec.md)、[测试方案](test-plan.md)。

## 1. 前置条件

1. 已确认（2026-10-28）：[核心架构 §13](core-architecture.md#13-新增设计选择已确认) 的 N1–N13 全部采纳；devDependency `@vitest/coverage-v8` 已引入。
2. 从 main 拉分支 `jelon/axp-pipeline`，`git push -u origin jelon/axp-pipeline`。
3. 现有测试移到 `test/legacy/` 并从 vitest `include` 排除（B0 完成），新旧用例互不干扰。

## 2. 批次

| 批次 | 内容 | 主要文件 | 交付与验收 |
|---|---|---|---|
| B0 基线 | 量性能、体积、用例数；建行为清单 | `bench/*.bench.ts`、`docs/reference/test-migration-map-pipeline.md` | 基线数字；822 处旧用例声明（执行 1002 条）逐条标 keep/change/drop，**主会话评审清单后再继续** |
| B1 内核 | 归一化响应（含 `isAxpResponse`、判定 getter）、上下文、管线、传输、落定（含 bug 透传、`reject`、调用点 stack）、客户端、key、取消、日志开关 | `src/{client,pipeline,context,transport,response,key,types}.ts` | 测试方案 §3 全部单元用例；客户端与取消的 rule/boundary；类型测试中与插件无关的部分 |
| B2 无状态插件 | loading、notify、repath、filter、envs | `src/plugins/{loading,notify,repath,filter,envs}.ts` | 各插件 rule/boundary；loading 与 notify 的 I2、I4 |
| B3 重试与鉴权 | retry、auth、TokenManager（O4） | `src/plugins/{retry,auth}.ts`、`src/objects/TokenManager.ts` | rule/boundary；auth + retry、loading + auth、notify + auth 组合 |
| B4 结果来源 | mock、share、cache（O3、O6） | `src/plugins/{mock,share,cache}.ts` | rule/boundary；§5.2 余下组合 |
| B5 测试收尾 | powerset、不变量、类型测试补齐、覆盖率门槛、删 `test/legacy/` 和旧源码 | `test/combo/powerset.combo.test.ts`、`vitest.config.ts`；删除 `src/{core,install,helper,bag}.ts`、`src/objects/Response.ts`、`src/plugins/{cancel,key,logger,normalize}.ts` | 覆盖率达标；映射核对公式成立；I1–I7 全部生效 |
| B6 文档与产物 | README 中英文、ARCHITECTURE.md 重写、CHANGELOG（含迁移指南）、`package.json` exports、e2e playground | 同左 | `vp pack` 成功；子路径检查通过；性能与体积达到门槛并写进报告 |
| B7 验收 | 改造执行器，跑 `npm run accept` | `accept/lib/*`、`accept/mapping.md` | 达到测试方案 §9.3；验收报告；testkit 台账在 api-ws-demo 单独提交 |

批次之间的依赖是线性的；B2 和 B3 都只依赖 B1，但它们共用 `test/helpers/` 和组合用例，**不并行**。

## 3. 每批的工作方式

1. 主会话把本批范围、相关文档章节、上一批终审结论写进派发 prompt，派给 Codex。
2. Codex 实现，跑 `vp test`、tsgo、`vp check`，然后 `codex review --uncommitted` 自审一轮，修掉成立的问题。
3. 主会话终审：
   - 对照文档逐条核对行为；
   - 检查有没有偷偷保留旧机制（字符串保活键、`delete config.xxx`、包装 transform、`instanceof`）；
   - 检查注释是否符合规范（中文、简短，公共 API 写契约、参数、返回和示例）；
   - 检查新增函数是否都有单测。
4. 终审通过后由主会话提交，格式 `refactor(axp): …` / `test(axp): …`。不通过先写清理由，再决定自己改还是退回重做。

## 4. Codex 派发约束（每份 prompt 都要写）

- 自己执行，不要再转派。
- 不得 `git commit`、`git push`、切分支；误提交了不要回滚，只汇报 hash。
- 每一步开始前先说一句在做什么、为什么。
- 跑测试、构建要等拿到最终结果再汇报，不停在"等待构建"。
- 不新增依赖；需要时停下来说明理由。
- 注释规范：每个函数、类、属性都要有中文简短注释；公共 API 写契约、参数、返回值和示例。
- 同一字面量出现 2 次以上就提取常量；沿用项目现有命名（`I` 前缀接口、`T` 前缀类型别名、`axpXxx` 插件工厂）。
- 体积统一用 `gzip -9` 测。
- 改动范围只限 `apps/axp/`（B7 另有说明）。

## 5. 风险与应对

| 风险 | 应对 |
|---|---|
| 一次重写面太大，Codex 产出偏离文档 | 小批次 + 每批终审；B0 的行为清单先评审，后续评审以清单为准 |
| 类型层（两个泛型、`WithData`、插件泛型推断）写不出来或拖慢 IDE | B1 先做类型原型并用 `expectTypeOf` 锁住；IDE 卡顿时退回"`R` 只在客户端级生效、插件回调用 `IAxpResponse`"的简化方案，退回前先问用户 |
| 行为变化（N1–N12）在验收里暴露意外 | B7 失败项逐条归因：是实现 bug 就修，是方案问题就回到文档改，再同步 CHANGELOG |
| testkit 台账和执行器要跨仓改 | 只改 axp 相关文件；api-ws-demo 单独提交，提交前问用户 |
| 性能门槛不达标 | 先用 bench 定位热点（上下文分配、patch 合并、key 计算），优化不得破坏不变量 |

## 6. 收尾

- `docs/README.md` 索引：设计文档状态从 draft 改为 active；ARCHITECTURE.md 重写后去掉"已过期"标注。
- 记忆：更新 axp 待优化清单，标明 O1–O6 已由本次重构解决。
- push 前先 `git status`，确认没有范围外的改动。
