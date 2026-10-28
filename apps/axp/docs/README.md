# axp 文档索引

项目的设计说明见根目录的 [README](../README.md) 和 [ARCHITECTURE](../ARCHITECTURE.md)。这里收录的是过程文档。

## 报告（带日期的结果）

- [2026-10-27 Codex 全量 review：终审与修复记录](reports/2026-10-27-codex-full-review.md) — 30 条问题的终审结论、修复方式、对外行为变化。active。

## 外部关联

- 黑盒验收设施 testkit = 验收工程 = api-ws-demo `/t/*` + netem。契约、测试矩阵和决策记录都在 `E:\workspaces\api-ws-demo\testkit\`，入口是那里的 `README.md`。AI 要排查验收失败、扩展测试范围时，读那里的 `AGENTS.md`。

## 操作手册（怎么做）

- [测试六层分类、去重与迁移映射规范](guides/test-layers.md) — 单元/规则/边界/组合/集成/验收矩阵的判定、目录命名、去重和映射记录规则。现行规范。active。

## 参考记录

- [测试用例旧→新映射记录](reference/test-migration-map.md) — 2026-10-28 首次六层迁移的逐条去向、每批核对数和 drop/N/A 清单，已冻结。archived。
