# 开发规范

本子包内工作（含 Claude Code）必须遵守以下流程规则，优先于通用默认行为。

## 1. 提交前必须更新 CHANGELOG

每次提交（commit）本子包内的修改之前，必须先更新 `CHANGELOG.md`，记录本次改动（新增/修改/修复了什么）。不允许有代码改动但 CHANGELOG 无对应记录的提交。

## 2. 新需求必须落一份 docs 记录

每当出现新的需求或需求变更（不限于功能性需求，架构/流程调整也算），必须在 `docs/logs/` 下新增一份 markdown 文件，内容至少包含：

- **变更原因**：为什么会有这次变更（背景/触发点）
- **目的**：要达成什么效果
- **落地方案**：具体怎么做（涉及哪些模块/接口/文件）

命名规则：`{日期}-{当天自增id}.md`，日期格式 `YYYY-MM-DD`，id 从 1 开始按当天新增顺序递增，例如同一天内第 1~4 份记录分别是：

```
docs/logs/2026-01-02-1.md
docs/logs/2026-01-02-2.md
docs/logs/2026-01-02-3.md
docs/logs/2026-01-02-4.md
```

`docs/` 目录结构约定：需求现状文档 `docs/REQUIREMENTS.md`、变更流水账 `docs/logs/`、实施计划 `docs/plans/`（PLAN\*.md）、算法文档 `docs/algorithms/`、参考图片 `docs/images/`。流水账与 `REQUIREMENTS.md` 不互相替代——`REQUIREMENTS.md` 有变化时，应同时在 `docs/logs/` 新增一份日期命名的记录说明这次变化因何而来。

## 3. 始终用中文回答，对话中省略改动流水账

在本子包内交流一律用中文回答。对话里描述改了什么代码时尽量精简、不逐条罗列流水账，节省 token；这一条约束的是**对话输出**，不影响 `CHANGELOG.md`/`docs/` 里该记的内容仍要记全。

## 4. 全部使用 TypeScript，优先用新语法

本子包内所有代码一律用 TypeScript 编写（`.ts` / `.tsx`），不允许新增 `.js` / `.mjs` 源文件。

使用 TypeScript 7（已在 `pnpm-workspace.yaml` catalog 锁定 `^7.0.2`，各包通过 `"typescript": "catalog:"` 引用）及当前语言/框架下最新、地道的写法。拒绝老旧写法：不用 `var`、能用 `async/await` 就不写 Promise 链、不用已废弃或过时的 API。同等效果下选最新写法。

## 5. README 用自然语言撰写，禁止 AI 腔

编写/完善 README 时用自然语言描述功能和使用方式，像人写的说明文档，不要出现"一句话说明"这类模板占位式、AI 腔的表达，也不要堆砌套话。若有 humanizer 插件可用，输出前先过一遍它再定稿。

## 6. 注释规范：所有成员必须注释，对外 API 需完整 TSDoc

每个方法、属性、函数、类都要有注释说明其目的。对外暴露的 API（core 的导出函数/类型、插件接口、PanelOptions 等外部会直接使用的一切）还必须包含参数说明、返回值说明和使用示例，用 TSDoc 格式：

```ts
/**
 * 围绕焦点缩放视口，保证焦点处内容的屏幕位置不变。
 * @param s - 当前视口状态
 * @param focalX - 缩放焦点的面板 X 坐标（鼠标位置/双指中点）
 * @param nextScale - 目标缩放值，超出 [0.5, 3] 会被 clamp
 * @param bounds - 按 nextScale 重新计算后的边界
 * @returns 缩放后的新视口状态（不修改入参）
 * @example
 * const next = zoomAt(state, e.offsetX, e.offsetY, state.scale * 1.1, bounds)
 */
```

内部实现的注释说明目的即可，不强制完整 TSDoc；但不允许无注释的裸成员。存量代码在本轮触碰到哪个文件就补齐哪个文件。
