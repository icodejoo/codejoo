# axp 文档索引

使用说明见根目录的 [README](../README.md)，代码导读见 [ARCHITECTURE](../ARCHITECTURE.md)。两者已按新架构重写并对照实现定稿（B6）；规格细节以下面的「设计」为准。

## 决策（已拍板）

- [0001 核心重构的六条决策](decisions/0001-core-redesign.md) — 洋葱管线、具名阶段、归一化响应 `IAxpResponse`、不设错误类的取舍与理由。active。

## 设计（洋葱管线重构）

- [核心架构方案](design/core-architecture.md) — 新内核结构、数据流、阶段排序、上下文、归一化响应与错误、插件接口、客户端 API、性能设计。active。
- [内置插件与内核服务规格](design/plugin-spec.md) — 10 个插件和 4 项内核服务的选项、行为、相对现状的变化汇总。active。
- [测试方案](design/test-plan.md) — 六层用例要点、组合不变量、覆盖率与台账、性能门槛、验收矩阵、旧用例迁移。active。
- [实施计划](design/implementation-plan.md) — B0–B7 批次、Codex 派发约束、评审关卡与风险。active。

## 报告（带日期的结果）

- [2026-10-28 洋葱管线 B5 测试收尾](reports/2026-10-28-pipeline-b5.md) — 跨批组合、powerset 512 子集、删旧实现、新入口、覆盖率 100%、映射改标与终审修复。active。
- [2026-10-28 洋葱管线 B4 数据源插件](reports/2026-10-28-pipeline-b4.md) — mock/share/cache 实现、验收、API id、承接旧行与终审修复。active。
- [2026-10-28 洋葱管线 B3 重试与鉴权](reports/2026-10-28-pipeline-b3.md) — retry/auth/TokenManager 实现、验收、API id、承接旧行与终审修复。active。
- [2026-10-28 洋葱管线 B2 插件](reports/2026-10-28-pipeline-b2.md) — resolveOption 与 loading/notify/repath/filter/envs 的实现结果、验收、API id、承接的旧行为。active。
- [2026-10-28 洋葱管线 B1 内核](reports/2026-10-28-pipeline-b1.md) — 内核实现结果、验收数据、API id、bench 对比、终审修复记录。active。
- [2026-10-28 B1 承接的旧行为](reports/2026-10-28-pipeline-b1-behaviors.md) — B1 覆盖的旧用例清单行与对应新用例。active。
- [2026-10-28 洋葱管线 B0 基线](reports/2026-10-28-pipeline-baseline.md) — 旧 API 六场景性能、gzip -9 体积、836 处声明审计与 legacy 归档检查。active。
- [2026-10-27 Codex 全量 review：终审与修复记录](reports/2026-10-27-codex-full-review.md) — 30 条问题的终审结论、修复方式、对外行为变化；「待优化」O1–O6 由上面的重构解决。active。

## 外部关联

- 黑盒验收设施 testkit = 验收工程 = api-ws-demo `/t/*` + netem。契约、测试矩阵和决策记录都在 `E:\workspaces\api-ws-demo\testkit\`，入口是那里的 `README.md`。AI 要排查验收失败、扩展测试范围时，读那里的 `AGENTS.md`。

## 操作手册（怎么做）

- [迁移到洋葱管线](guides/migrating-to-pipeline.md) — 旧写法 → 新写法逐项对照：入口、错误处理、成功判定、删除的插件、默认值与回调签名变化。active。
- [测试六层分类、去重与迁移映射规范](guides/test-layers.md) — 单元/规则/边界/组合/集成/验收矩阵的判定、目录命名、去重和映射记录规则。现行规范。active。

## 参考记录

- [洋葱管线行为迁移总表](reference/pipeline-migration/README.md) — 分层计数、822 口径差异、删除机制及存疑行汇总。active。
- [洋葱管线 unit 行为清单](reference/pipeline-migration/unit.md) — 227 处旧单元用例的逐条去向与依据。active。
- [洋葱管线 rule 行为清单](reference/pipeline-migration/rule.md) — 254 处旧规则用例的逐条去向与依据。active。
- [洋葱管线 boundary 行为清单](reference/pipeline-migration/boundary.md) — 278 处旧边界用例的逐条去向与依据。active。
- [洋葱管线 combo 行为清单](reference/pipeline-migration/combo.md) — 33 处旧组合用例的逐条去向与依据。active。
- [洋葱管线 integration 行为清单](reference/pipeline-migration/integration.md) — 44 处旧集成用例的逐条去向与依据。active。
- [测试用例旧→新映射记录](reference/test-migration-map.md) — 2026-10-28 首次六层迁移的逐条去向、每批核对数和 drop/N/A 清单，已冻结。archived。
